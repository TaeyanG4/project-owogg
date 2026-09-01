import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { StreamerAdminWorkspaceDataSchema } from "@owogg/contracts";
import { hashSessionToken } from "@owogg/db";
import { createSqliteD1 } from "../../../packages/db/test/helpers/sqliteD1.js";
import { app } from "../src/app.js";

const USER_SESSION_TOKEN = "streamer-admin-user-session";
const ADMIN_SESSION_TOKEN = "streamer-admin-step-up-session";
const COOKIE = `owogg_session=${USER_SESSION_TOKEN}; owogg_admin_session=${ADMIN_SESSION_TOKEN}`;
const FRONTEND_URL = "http://localhost:5173";
const NOW = "2026-08-31T00:00:00.000Z";
const FUTURE = "2099-01-01T00:00:00.000Z";

function createMigratedD1() {
  const result = createSqliteD1("PRAGMA foreign_keys = ON;");
  const migrationUrl = new URL("../../../packages/db/migrations/", import.meta.url);
  for (const filename of fs
    .readdirSync(migrationUrl)
    .filter((value) => value.endsWith(".sql"))
    .sort()) {
    result.raw.exec(fs.readFileSync(new URL(filename, migrationUrl), "utf8"));
  }
  return result;
}

async function seedElevatedSession(
  raw: import("node:sqlite").DatabaseSync,
  input: { userId?: number; nickname?: string } = {},
) {
  const userId = input.userId ?? 1;
  const userSessionHash = await hashSessionToken(USER_SESSION_TOKEN);
  const adminSessionHash = await hashSessionToken(ADMIN_SESSION_TOKEN);
  raw
    .prepare("INSERT INTO users (id, nickname) VALUES (?, ?)")
    .run(userId, input.nickname ?? "Streamer Admin");
  raw
    .prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .run(userSessionHash, userId, NOW, FUTURE);
  raw
    .prepare(
      `INSERT INTO admin_sessions
         (token_hash, user_id, session_token_hash, created_at, expires_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, NULL)`,
    )
    .run(adminSessionHash, userId, userSessionHash, NOW, FUTURE);
}

function seedApplicant(
  raw: import("node:sqlite").DatabaseSync,
  suffix: string,
  platforms: Array<"YOUTUBE" | "TWITCH"> = ["YOUTUBE"],
) {
  const user = raw.prepare("INSERT INTO users (nickname) VALUES (?)").run(`applicant-${suffix}`);
  const userId = Number(user.lastInsertRowid);
  const profile = raw
    .prepare(
      `INSERT INTO streamer_profiles (user_id, status, created_at, updated_at)
       VALUES (?, 'UNVERIFIED', ?, ?)`,
    )
    .run(userId, NOW, NOW);
  const streamerId = Number(profile.lastInsertRowid);
  const accountIds: number[] = [];
  const reviewIds: number[] = [];

  for (const platform of platforms) {
    const account = raw
      .prepare(
        `INSERT INTO streamer_platform_accounts
           (streamer_id, platform, platform_user_id, channel_name, channel_url,
            verification_status, verified_at, ownership_expires_at, approval_status,
            audience_count, audience_count_known, channel_created_at, metrics_synced_at,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'VERIFIED', ?, ?, 'PENDING', 25000, 1, ?, ?, ?, ?)`,
      )
      .run(
        streamerId,
        platform,
        `${platform}-${suffix}`,
        `${platform} channel ${suffix}`,
        `https://example.com/${platform.toLowerCase()}/${suffix}`,
        NOW,
        FUTURE,
        "2020-01-01T00:00:00.000Z",
        NOW,
        NOW,
        NOW,
      );
    const accountId = Number(account.lastInsertRowid);
    accountIds.push(accountId);
    const review = raw
      .prepare(
        `INSERT INTO streamer_platform_reviews
           (streamer_platform_account_id, review_type, requested_by, work_state, priority,
            due_at, policy_version, evidence_json, created_at, updated_at)
         VALUES (?, 'INITIAL', 'USER', 'QUEUED', 'NORMAL', ?, 1, '{}', ?, ?)`,
      )
      .run(accountId, FUTURE, NOW, NOW);
    reviewIds.push(Number(review.lastInsertRowid));
  }

  return { userId, streamerId, accountIds, reviewIds };
}

function env(db: unknown, adminUserIds = "1") {
  return { DB: db, ADMIN_USER_IDS: adminUserIds, FRONTEND_URL } as any;
}

function actionBody(
  action: "APPROVE_STREAMER" | "REJECT_STREAMER" | "DISCONNECT_PLATFORM_ACCOUNT",
  targetId: number,
  expectedVersion = 0,
) {
  return {
    action,
    targetId: String(targetId),
    expectedVersion,
    reason:
      action === "APPROVE_STREAMER"
        ? "소유권과 기준을 확인했습니다."
        : action === "DISCONNECT_PLATFORM_ACCOUNT"
          ? "계정 소유자의 연결 해제 요청을 확인했습니다."
          : "심사 기준을 충족하지 못했습니다.",
    internalNote: null,
    effectiveAt: null,
    policyValues: null,
  };
}

function adminPost(body: unknown, includeOrigin = true): RequestInit {
  return {
    method: "POST",
    headers: {
      Cookie: COOKIE,
      "Content-Type": "application/json",
      ...(includeOrigin ? { Origin: FRONTEND_URL } : {}),
    },
    body: JSON.stringify(body),
  };
}

test("admin Streamer workspace requires an eligible elevated administrator", async () => {
  const nonAdmin = createMigratedD1();
  await seedElevatedSession(nonAdmin.raw, { userId: 7, nickname: "Not Admin" });
  const denied = await app.request(
    "/api/admin/streamers/workspace",
    { headers: { Cookie: COOKIE } },
    env(nonAdmin.db),
  );
  assert.equal(denied.status, 403);

  const missingAllowlist = createMigratedD1();
  await seedElevatedSession(missingAllowlist.raw);
  const deniedByDefault = await app.request(
    "/api/admin/streamers/workspace",
    { headers: { Cookie: COOKIE } },
    { DB: missingAllowlist.db } as any,
  );
  assert.equal(deniedByDefault.status, 403);
});

test("workspace exposes live sections with 10, 20, 30, and 50 row page sizes", async () => {
  const { db, raw } = createMigratedD1();
  await seedElevatedSession(raw);
  seedApplicant(raw, "paged", ["YOUTUBE", "TWITCH"]);

  for (const pageSize of [10, 20, 30, 50] as const) {
    const params = new URLSearchParams({
      overviewPageSize: String(pageSize),
      rosterPageSize: String(pageSize),
      reviewPageSize: String(pageSize),
      policyPageSize: String(pageSize),
      auditPageSize: String(pageSize),
    });
    const response = await app.request(
      `/api/admin/streamers/workspace?${params}`,
      { headers: { Cookie: COOKIE } },
      env(db),
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const workspace = StreamerAdminWorkspaceDataSchema.parse(await response.json());
    assert.deepEqual(workspace.sectionSources, {
      OVERVIEW: "LIVE",
      STREAMERS: "LIVE",
      REVIEWS: "LIVE",
      POLICY: "LIVE",
      PROVIDERS: "LIVE",
      AUDIT: "LIVE",
    });
    assert.equal(workspace.overviewQueue.pageSize, pageSize);
    assert.equal(workspace.roster.pageSize, pageSize);
    assert.equal(workspace.reviews.pageSize, pageSize);
    assert.equal(workspace.policy?.history.pageSize, pageSize);
    assert.equal(workspace.audits.pageSize, pageSize);
    assert.equal(workspace.roster.total, 1);
    assert.equal(workspace.reviews.total, 2);
    assert.deepEqual(workspace.providers.map((provider) => provider.platform).sort(), [
      "CHZZK",
      "TWITCH",
      "YOUTUBE",
    ]);
  }
});

test("workspace rejects unsupported page sizes instead of silently slicing on the client", async () => {
  const { db, raw } = createMigratedD1();
  await seedElevatedSession(raw);
  const response = await app.request(
    "/api/admin/streamers/workspace?reviewPageSize=25",
    { headers: { Cookie: COOKIE } },
    env(db),
  );

  assert.equal(response.status, 400);
  assert.equal(((await response.json()) as any).error.code, "INVALID_QUERY");
});

test("two platforms owned by one user receive independent manual decisions", async () => {
  const { db, raw } = createMigratedD1();
  await seedElevatedSession(raw);
  const applicant = seedApplicant(raw, "multi", ["YOUTUBE", "TWITCH"]);

  const approved = await app.request(
    "/api/admin/streamers/actions",
    adminPost(actionBody("APPROVE_STREAMER", applicant.reviewIds[0]!)),
    env(db),
  );
  const rejected = await app.request(
    "/api/admin/streamers/actions",
    adminPost(actionBody("REJECT_STREAMER", applicant.reviewIds[1]!)),
    env(db),
  );

  assert.equal(approved.status, 200);
  assert.equal(rejected.status, 200);
  assert.deepEqual(
    raw
      .prepare(
        `SELECT platform, approval_status AS approvalStatus
         FROM streamer_platform_accounts WHERE streamer_id = ? ORDER BY platform`,
      )
      .all(applicant.streamerId)
      .map((row) => ({
        platform: String(row.platform),
        approvalStatus: String(row.approvalStatus),
      })),
    [
      { platform: "TWITCH", approvalStatus: "REJECTED" },
      { platform: "YOUTUBE", approvalStatus: "APPROVED" },
    ],
  );
  assert.equal(
    raw.prepare("SELECT status FROM streamer_profiles WHERE id = ?").get(applicant.streamerId)
      ?.status,
    "VERIFIED",
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) AS total FROM streamer_admin_audit_log").get()?.total,
    2,
  );

  const staleReplay = await app.request(
    "/api/admin/streamers/actions",
    adminPost(actionBody("APPROVE_STREAMER", applicant.reviewIds[0]!)),
    env(db),
  );
  assert.equal(staleReplay.status, 409);
  assert.equal(
    raw.prepare("SELECT COUNT(*) AS total FROM streamer_admin_audit_log").get()?.total,
    2,
  );
});

test("streamers.manage can disconnect a platform through the administrator API", async () => {
  const { db, raw } = createMigratedD1();
  await seedElevatedSession(raw);
  const applicant = seedApplicant(raw, "admin-api-disconnect", ["YOUTUBE", "TWITCH"]);

  for (const reviewId of applicant.reviewIds) {
    const approved = await app.request(
      "/api/admin/streamers/actions",
      adminPost(actionBody("APPROVE_STREAMER", reviewId)),
      env(db),
    );
    assert.equal(approved.status, 200);
  }

  const disconnected = await app.request(
    "/api/admin/streamers/actions",
    adminPost(actionBody("DISCONNECT_PLATFORM_ACCOUNT", applicant.accountIds[0]!, 1)),
    env(db),
  );
  assert.equal(disconnected.status, 200);
  assert.equal(
    ((await disconnected.json()) as Record<string, unknown>).action,
    "DISCONNECT_PLATFORM_ACCOUNT",
  );
  assert.deepEqual(
    raw
      .prepare(
        `SELECT platform FROM streamer_platform_accounts
         WHERE streamer_id = ? ORDER BY platform`,
      )
      .all(applicant.streamerId)
      .map((row) => String(row.platform)),
    ["TWITCH"],
  );
  assert.equal(
    raw.prepare("SELECT status FROM streamer_profiles WHERE id = ?").get(applicant.streamerId)
      ?.status,
    "VERIFIED",
  );
  assert.equal(
    raw
      .prepare(
        `SELECT COUNT(*) AS count FROM streamer_platform_connection_history
         WHERE disconnect_actor_type = 'ADMIN' AND disconnected_by_user_id = 1`,
      )
      .get()?.count,
    1,
  );
});

test("manual approval requires an explicit reason and currently valid ownership", async () => {
  const { db, raw } = createMigratedD1();
  await seedElevatedSession(raw);
  const applicant = seedApplicant(raw, "ownership");

  const invalidBody = {
    ...actionBody("APPROVE_STREAMER", applicant.reviewIds[0]!),
    reason: "",
  };
  const missingReason = await app.request(
    "/api/admin/streamers/actions",
    adminPost(invalidBody),
    env(db),
  );
  assert.equal(missingReason.status, 400);

  raw
    .prepare(
      `UPDATE streamer_platform_accounts
       SET verification_status = 'UNVERIFIED', ownership_expires_at = NULL
       WHERE id = ?`,
    )
    .run(applicant.accountIds[0]);
  const invalidOwnership = await app.request(
    "/api/admin/streamers/actions",
    adminPost(actionBody("APPROVE_STREAMER", applicant.reviewIds[0]!)),
    env(db),
  );
  assert.equal(invalidOwnership.status, 409);
  assert.equal(((await invalidOwnership.json()) as any).error.code, "OWNERSHIP_NOT_VERIFIED");
  assert.equal(
    raw.prepare("SELECT COUNT(*) AS total FROM streamer_admin_audit_log").get()?.total,
    0,
  );
});

test("admin Streamer mutations require the trusted frontend origin", async () => {
  const { db, raw } = createMigratedD1();
  await seedElevatedSession(raw);
  const applicant = seedApplicant(raw, "origin");
  const response = await app.request(
    "/api/admin/streamers/actions",
    adminPost(actionBody("REJECT_STREAMER", applicant.reviewIds[0]!), false),
    env(db),
  );

  assert.equal(response.status, 403);
  assert.equal(
    raw.prepare("SELECT COUNT(*) AS total FROM streamer_admin_audit_log").get()?.total,
    0,
  );
});
