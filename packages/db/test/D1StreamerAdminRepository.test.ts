import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { D1StreamerAdminRepository } from "../src/d1/D1StreamerAdminRepository.js";
import { D1StreamerRepository } from "../src/d1/D1StreamerRepository.js";
import type { StreamerAdminActionInput, StreamerAdminWorkspaceQuery } from "@owogg/core";
import { createSqliteD1 } from "./helpers/sqliteD1.js";

function migratedDb() {
  const { db, raw } = createSqliteD1("");
  const migrationUrl = new URL("../migrations/", import.meta.url);
  const files = fs
    .readdirSync(migrationUrl)
    .filter((filename) => filename.endsWith(".sql"))
    .sort();
  for (const filename of files) {
    raw.exec(fs.readFileSync(new URL(filename, migrationUrl), "utf8"));
  }
  return { db, raw };
}

function query(overrides: Partial<StreamerAdminWorkspaceQuery> = {}): StreamerAdminWorkspaceQuery {
  return {
    overviewPage: 1,
    overviewPageSize: 10,
    rosterPage: 1,
    rosterPageSize: 20,
    rosterQuery: "",
    rosterPlatform: "ALL",
    rosterApproval: "ALL",
    reviewPage: 1,
    reviewPageSize: 20,
    reviewQuery: "",
    reviewAssignment: "ALL",
    reviewState: "ALL",
    policyPage: 1,
    policyPageSize: 10,
    auditPage: 1,
    auditPageSize: 20,
    auditQuery: "",
    auditTarget: "ALL",
    ...overrides,
  };
}

function seedApplicant(
  raw: import("node:sqlite").DatabaseSync,
  suffix: string,
  platforms: Array<"YOUTUBE" | "CHZZK" | "SOOP" | "TWITCH"> = ["YOUTUBE"],
) {
  const now = "2026-08-31T00:00:00.000Z";
  const user = raw.prepare("INSERT INTO users (nickname) VALUES (?)").run(`applicant-${suffix}`);
  const userId = Number(user.lastInsertRowid);
  const profile = raw
    .prepare(
      `INSERT INTO streamer_profiles (user_id, status, created_at, updated_at)
       VALUES (?, 'UNVERIFIED', ?, ?)`,
    )
    .run(userId, now, now);
  const streamerId = Number(profile.lastInsertRowid);
  const reviewIds: number[] = [];
  const accountIds: number[] = [];
  for (const platform of platforms) {
    const account = raw
      .prepare(
        `INSERT INTO streamer_platform_accounts
           (streamer_id, platform, platform_user_id, channel_name, channel_url,
            verification_status, verified_at, ownership_expires_at, approval_status,
            audience_count, audience_count_known, channel_created_at, metrics_synced_at,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'VERIFIED', ?, '2027-02-27T00:00:00.000Z', 'PENDING',
                 25000, 1, '2020-01-01T00:00:00.000Z', ?, ?, ?)`,
      )
      .run(
        streamerId,
        platform,
        `${platform}-${suffix}`,
        `${platform} channel ${suffix}`,
        `https://example.com/${platform.toLowerCase()}/${suffix}`,
        now,
        now,
        now,
        now,
      );
    const accountId = Number(account.lastInsertRowid);
    accountIds.push(accountId);
    const review = raw
      .prepare(
        `INSERT INTO streamer_platform_reviews
           (streamer_platform_account_id, review_type, requested_by, work_state, priority,
            due_at, policy_version, evidence_json, created_at, updated_at)
         VALUES (?, 'INITIAL', 'USER', 'QUEUED', 'NORMAL',
                 '2026-09-01T00:00:00.000Z', 1, '{}', ?, ?)`,
      )
      .run(accountId, now, now);
    reviewIds.push(Number(review.lastInsertRowid));
  }
  return { userId, streamerId, accountIds, reviewIds };
}

test("workspace excludes reserved SOOP data before counts and pagination", async () => {
  const { db, raw } = migratedDb();
  raw.prepare("INSERT INTO users (id, nickname) VALUES (1, 'operator')").run();
  for (let index = 0; index < 12; index += 1) {
    seedApplicant(raw, `visible-${index}`);
    seedApplicant(raw, `reserved-${index}`, ["SOOP"]);
  }
  const mixed = seedApplicant(raw, "mixed", ["YOUTUBE", "SOOP"]);
  const reservedAction = seedApplicant(raw, "reserved-action", ["SOOP"]);
  raw
    .prepare(
      `INSERT INTO streamer_admin_audit_log
         (actor_user_id, action, target_type, target_id, target_label, public_reason_code,
          internal_note, change_summary, policy_version, correlation_id, created_at)
       VALUES
         (1, 'PAUSE_PROVIDER_CONNECTIONS', 'PROVIDER', 'SOOP', 'SOOP', 'reserved audit',
          NULL, 'SOOP connection paused', NULL, 'reserved-audit', '2026-08-31T02:00:00.000Z'),
         (1, 'PAUSE_PROVIDER_CONNECTIONS', 'PROVIDER', 'YOUTUBE', 'YOUTUBE', 'visible audit',
          NULL, 'YouTube connection paused', NULL, 'visible-audit', '2026-08-31T02:01:00.000Z')`,
    )
    .run();

  const repository = new D1StreamerAdminRepository(db);
  const workspace = await repository.getWorkspace(
    query({
      overviewPageSize: 10,
      rosterPageSize: 10,
      reviewPageSize: 10,
      auditPageSize: 10,
    }),
    1,
  );

  assert.equal(workspace.overview.totalApplicants, 13);
  assert.equal(workspace.overview.connectedPlatforms, 13);
  assert.equal(workspace.overview.pendingPlatformReviews, 13);
  assert.equal(workspace.overviewQueue.total, 13);
  assert.equal(workspace.overviewQueue.items.length, 10);
  assert.equal(workspace.roster.total, 13);
  assert.equal(workspace.roster.items.length, 10);
  assert.equal(workspace.reviews.total, 13);
  assert.equal(workspace.reviews.items.length, 10);
  assert.equal(workspace.audits.total, 1);
  assert.equal(workspace.audits.items[0]?.correlationId, "visible-audit");
  assert.deepEqual(
    workspace.providerSettings.map((provider) => provider.platform),
    ["CHZZK", "TWITCH", "YOUTUBE"],
  );
  assert.equal(
    [workspace.overviewQueue.items, workspace.reviews.items]
      .flat()
      .some((review) => review.platformAccount.platform === "SOOP"),
    false,
  );

  const mixedRosterItem = (
    await repository.getWorkspace(query({ rosterQuery: String(mixed.userId) }), 1)
  ).roster.items[0];
  assert.ok(mixedRosterItem);
  assert.deepEqual(
    mixedRosterItem.platformAccounts.map((account) => account.platform),
    ["YOUTUBE"],
  );

  const directSoopFilter = await repository.getWorkspace(query({ rosterPlatform: "SOOP" }), 1);
  assert.equal(directSoopFilter.roster.total, 0);
  assert.deepEqual(directSoopFilter.roster.items, []);

  assert.deepEqual(
    await repository.applyAction(
      actionInput("APPROVE_STREAMER", reservedAction.reviewIds[0]!, "reserved-review-action"),
    ),
    { applied: false, code: "NOT_FOUND", rowVersion: null },
  );
  assert.deepEqual(
    await repository.applyAction(
      actionInput("SUSPEND_STREAMER", reservedAction.streamerId, "reserved-profile-action"),
    ),
    { applied: false, code: "NOT_FOUND", rowVersion: null },
  );
  assert.deepEqual(
    await repository.applyAction(
      actionInput("PAUSE_PROVIDER_CONNECTIONS", "SOOP", "reserved-provider-action"),
    ),
    { applied: false, code: "NOT_FOUND", rowVersion: null },
  );
});

function actionInput(
  action: StreamerAdminActionInput["action"],
  targetId: number | string,
  correlationId: string,
  overrides: Partial<StreamerAdminActionInput> = {},
): StreamerAdminActionInput {
  return {
    action,
    targetId: String(targetId),
    expectedVersion: 0,
    actorUserId: 1,
    reason: "manual review decision",
    internalNote: null,
    effectiveAt: null,
    policyValues: null,
    correlationId,
    nowIso: "2026-08-31T01:00:00.000Z",
    ...overrides,
  };
}

test("workspace pagination supports 10, 20, 30, and 50 without client-side slicing", async () => {
  const { db, raw } = migratedDb();
  raw.prepare("INSERT INTO users (id, nickname) VALUES (1, 'operator')").run();
  for (let index = 0; index < 55; index += 1) seedApplicant(raw, String(index));

  const repository = new D1StreamerAdminRepository(db);
  for (const pageSize of [10, 20, 30, 50] as const) {
    const workspace = await repository.getWorkspace(
      query({
        overviewPageSize: pageSize,
        rosterPageSize: pageSize,
        reviewPageSize: pageSize,
        auditPageSize: pageSize,
      }),
      1,
    );
    assert.equal(workspace.roster.items.length, pageSize);
    assert.equal(workspace.roster.total, 55);
    assert.equal(workspace.reviews.items.length, pageSize);
    assert.equal(workspace.reviews.total, 55);
    assert.equal(workspace.overviewQueue.items.length, pageSize);
  }
});

test("two platforms for one user keep fully independent manual decisions", async () => {
  const { db, raw } = migratedDb();
  raw.prepare("INSERT INTO users (id, nickname) VALUES (1, 'operator')").run();
  const applicant = seedApplicant(raw, "multi", ["YOUTUBE", "TWITCH"]);
  const repository = new D1StreamerAdminRepository(db);

  const approved = await repository.applyAction(
    actionInput("APPROVE_STREAMER", applicant.reviewIds[0], "approve-youtube"),
  );
  const rejected = await repository.applyAction(
    actionInput("REJECT_STREAMER", applicant.reviewIds[1], "reject-twitch"),
  );

  assert.equal(approved.applied, true);
  assert.equal(rejected.applied, true);
  const decisions = raw
    .prepare(
      `SELECT platform, approval_status FROM streamer_platform_accounts
         WHERE streamer_id = ? ORDER BY platform`,
    )
    .all(applicant.streamerId)
    .map((row) => ({
      platform: String(row.platform),
      approval_status: String(row.approval_status),
    }));
  assert.deepEqual(decisions, [
    { platform: "TWITCH", approval_status: "REJECTED" },
    { platform: "YOUTUBE", approval_status: "APPROVED" },
  ]);
  assert.equal(
    raw.prepare("SELECT status FROM streamer_profiles WHERE id = ?").get(applicant.streamerId)
      ?.status,
    "VERIFIED",
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) AS count FROM streamer_admin_audit_log").get()?.count,
    2,
  );
});

test("review claims use row-version compare-and-swap", async () => {
  const { db, raw } = migratedDb();
  raw.prepare("INSERT INTO users (id, nickname) VALUES (1, 'operator')").run();
  const applicant = seedApplicant(raw, "claim");
  const repository = new D1StreamerAdminRepository(db);

  const first = await repository.applyAction(
    actionInput("CLAIM_REVIEW", applicant.reviewIds[0], "claim-first"),
  );
  const stale = await repository.applyAction(
    actionInput("CLAIM_REVIEW", applicant.reviewIds[0], "claim-stale"),
  );

  assert.equal(first.applied, true);
  assert.deepEqual(stale, { applied: false, code: "CONFLICT", rowVersion: null });

  const decision = await repository.applyAction({
    ...actionInput("APPROVE_STREAMER", applicant.reviewIds[0], "claimed-decision"),
    expectedVersion: 1,
  });
  assert.equal(decision.applied, true);
  assert.deepEqual(
    {
      ...raw
        .prepare(
          `SELECT work_state, claimed_by_user_id, claim_expires_at
           FROM streamer_platform_reviews WHERE id = ?`,
        )
        .get(applicant.reviewIds[0]),
    },
    { work_state: "APPROVED", claimed_by_user_id: null, claim_expires_at: null },
  );
});

test("manual queue controls claim, release, hold, and cancel with immutable audits", async () => {
  const { db, raw } = migratedDb();
  raw.prepare("INSERT INTO users (id, nickname) VALUES (1, 'operator')").run();
  const applicant = seedApplicant(raw, "queue-controls");
  const repository = new D1StreamerAdminRepository(db);
  const reviewId = applicant.reviewIds[0]!;

  assert.equal(
    (await repository.applyAction(actionInput("CLAIM_REVIEW", reviewId, "queue-claim"))).applied,
    true,
  );
  assert.equal(
    (
      await repository.applyAction(
        actionInput("RELEASE_REVIEW", reviewId, "queue-release", { expectedVersion: 1 }),
      )
    ).applied,
    true,
  );
  assert.equal(
    (
      await repository.applyAction(
        actionInput("HOLD_REVIEW", reviewId, "queue-hold", { expectedVersion: 2 }),
      )
    ).applied,
    true,
  );
  assert.deepEqual(
    {
      ...raw
        .prepare(
          `SELECT work_state, hold_until, claimed_by_user_id, row_version
           FROM streamer_platform_reviews WHERE id = ?`,
        )
        .get(reviewId),
    },
    {
      work_state: "ON_HOLD",
      hold_until: "2026-09-01T01:00:00.000Z",
      claimed_by_user_id: null,
      row_version: 3,
    },
  );
  assert.equal(
    (
      await repository.applyAction(
        actionInput("CANCEL_REVIEW", reviewId, "queue-cancel", { expectedVersion: 3 }),
      )
    ).applied,
    true,
  );
  assert.deepEqual(
    raw
      .prepare("SELECT action FROM streamer_admin_audit_log ORDER BY id ASC")
      .all()
      .map((row) => row.action),
    ["CLAIM_REVIEW", "RELEASE_REVIEW", "HOLD_REVIEW", "CANCEL_REVIEW"],
  );
});

test("cancelled reviews can be recreated while duplicate active reviews remain blocked", async () => {
  const { db, raw } = migratedDb();
  raw.prepare("INSERT INTO users (id, nickname) VALUES (1, 'operator')").run();
  const applicant = seedApplicant(raw, "recreate");
  const repository = new D1StreamerAdminRepository(db);

  const duplicate = await repository.applyAction(
    actionInput("CREATE_REVIEW", applicant.accountIds[0]!, "duplicate-active"),
  );
  assert.deepEqual(duplicate, {
    applied: false,
    code: "ACTIVE_REVIEW_EXISTS",
    rowVersion: null,
  });

  const cancelled = await repository.applyAction(
    actionInput("CANCEL_REVIEW", applicant.reviewIds[0]!, "cancel-before-recreate"),
  );
  assert.equal(cancelled.applied, true);
  const recreated = await repository.applyAction(
    actionInput("CREATE_REVIEW", applicant.accountIds[0]!, "recreate-after-cancel"),
  );
  assert.equal(recreated.applied, true);
  assert.deepEqual(
    raw
      .prepare(
        `SELECT review_type, requested_by, work_state
         FROM streamer_platform_reviews WHERE streamer_platform_account_id = ? ORDER BY id ASC`,
      )
      .all(applicant.accountIds[0])
      .map((row) => ({ ...row })),
    [
      { review_type: "INITIAL", requested_by: "USER", work_state: "CANCELLED" },
      { review_type: "INITIAL", requested_by: "ADMIN", work_state: "QUEUED" },
    ],
  );
});

test("reconsideration enforces cooldown and links a new review to the rejected decision", async () => {
  const { db, raw } = migratedDb();
  raw.prepare("INSERT INTO users (id, nickname) VALUES (1, 'operator')").run();
  const applicant = seedApplicant(raw, "reconsideration");
  const repository = new D1StreamerAdminRepository(db);
  const reviewId = applicant.reviewIds[0]!;

  const rejected = await repository.applyAction(
    actionInput("REJECT_STREAMER", reviewId, "reject-before-reconsideration"),
  );
  assert.equal(rejected.applied, true);
  const tooSoon = await repository.applyAction(
    actionInput("CREATE_RECONSIDERATION", reviewId, "reconsider-too-soon", {
      expectedVersion: 1,
    }),
  );
  assert.deepEqual(tooSoon, { applied: false, code: "CONFLICT", rowVersion: null });

  const afterCooldown = await repository.applyAction(
    actionInput("CREATE_RECONSIDERATION", reviewId, "reconsider-after-cooldown", {
      expectedVersion: 1,
      nowIso: "2026-09-08T01:00:01.000Z",
    }),
  );
  assert.equal(afterCooldown.applied, true);
  assert.deepEqual(
    {
      ...raw
        .prepare(
          `SELECT parent_review_id, review_type, requested_by, work_state
           FROM streamer_platform_reviews WHERE id <> ? ORDER BY id DESC LIMIT 1`,
        )
        .get(reviewId),
    },
    {
      parent_review_id: reviewId,
      review_type: "RECONSIDERATION",
      requested_by: "ADMIN",
      work_state: "QUEUED",
    },
  );
});

test("platform lifecycle actions never remove another platform approval", async () => {
  const { db, raw } = migratedDb();
  raw.prepare("INSERT INTO users (id, nickname) VALUES (1, 'operator')").run();
  const applicant = seedApplicant(raw, "platform-lifecycle", ["YOUTUBE", "TWITCH"]);
  const repository = new D1StreamerAdminRepository(db);

  assert.equal(
    (
      await repository.applyAction(
        actionInput("APPROVE_STREAMER", applicant.reviewIds[0]!, "approve-first-platform"),
      )
    ).applied,
    true,
  );
  assert.equal(
    (
      await repository.applyAction(
        actionInput("APPROVE_STREAMER", applicant.reviewIds[1]!, "approve-second-platform"),
      )
    ).applied,
    true,
  );
  assert.equal(
    (
      await repository.applyAction(
        actionInput("REVOKE_STREAMER_APPROVAL", applicant.accountIds[0]!, "revoke-first", {
          expectedVersion: 1,
        }),
      )
    ).applied,
    true,
  );
  assert.equal(
    raw.prepare("SELECT status FROM streamer_profiles WHERE id = ?").get(applicant.streamerId)
      ?.status,
    "VERIFIED",
  );
  assert.equal(
    (
      await repository.applyAction(
        actionInput("INVALIDATE_OWNERSHIP", applicant.accountIds[1]!, "invalidate-second", {
          expectedVersion: 1,
        }),
      )
    ).applied,
    true,
  );
  assert.equal(
    raw.prepare("SELECT status FROM streamer_profiles WHERE id = ?").get(applicant.streamerId)
      ?.status,
    "UNVERIFIED",
  );
  assert.deepEqual(
    raw
      .prepare(
        `SELECT platform, approval_status, verification_status
         FROM streamer_platform_accounts WHERE streamer_id = ? ORDER BY platform ASC`,
      )
      .all(applicant.streamerId)
      .map((row) => ({ ...row })),
    [
      { platform: "TWITCH", approval_status: "REJECTED", verification_status: "REJECTED" },
      { platform: "YOUTUBE", approval_status: "REJECTED", verification_status: "VERIFIED" },
    ],
  );
});

test("program suspension and provider pause are reversible compare-and-swap operations", async () => {
  const { db, raw } = migratedDb();
  raw.prepare("INSERT INTO users (id, nickname) VALUES (1, 'operator')").run();
  const applicant = seedApplicant(raw, "operations");
  const repository = new D1StreamerAdminRepository(db);
  await repository.applyAction(
    actionInput("APPROVE_STREAMER", applicant.reviewIds[0]!, "approve-before-suspend"),
  );

  const suspended = await repository.applyAction(
    actionInput("SUSPEND_STREAMER", applicant.streamerId, "suspend-program", {
      expectedVersion: 1,
      effectiveAt: "2026-09-30T00:00:00.000Z",
    }),
  );
  assert.equal(suspended.applied, true);
  assert.deepEqual(
    {
      ...raw
        .prepare("SELECT status, suspended_until FROM streamer_profiles WHERE id = ?")
        .get(applicant.streamerId),
    },
    { status: "SUSPENDED", suspended_until: "2026-09-30T00:00:00.000Z" },
  );
  const restored = await repository.applyAction(
    actionInput("RESTORE_STREAMER", applicant.streamerId, "restore-program", {
      expectedVersion: 2,
    }),
  );
  assert.equal(restored.applied, true);
  assert.equal(
    raw.prepare("SELECT status FROM streamer_profiles WHERE id = ?").get(applicant.streamerId)
      ?.status,
    "VERIFIED",
  );

  const paused = await repository.applyAction(
    actionInput("PAUSE_PROVIDER_CONNECTIONS", "YOUTUBE", "pause-youtube"),
  );
  assert.equal(paused.applied, true);
  assert.equal(await repository.isProviderConnectionPaused("YOUTUBE"), true);
  const resumed = await repository.applyAction(
    actionInput("RESUME_PROVIDER_CONNECTIONS", "YOUTUBE", "resume-youtube", {
      expectedVersion: 1,
    }),
  );
  assert.equal(resumed.applied, true);
  assert.equal(await repository.isProviderConnectionPaused("YOUTUBE"), false);
});

test("expired program suspension is effective immediately and can be suspended again", async () => {
  const { db, raw } = migratedDb();
  raw.prepare("INSERT INTO users (id, nickname) VALUES (1, 'operator')").run();
  const applicant = seedApplicant(raw, "expired-program-suspension");
  const repository = new D1StreamerAdminRepository(db);
  await repository.applyAction(
    actionInput("APPROVE_STREAMER", applicant.reviewIds[0]!, "approve-before-expiry"),
  );
  raw
    .prepare(
      `UPDATE streamer_profiles
       SET status = 'SUSPENDED', suspended_until = '2020-01-01T00:00:00.000Z', row_version = 2
       WHERE id = ?`,
    )
    .run(applicant.streamerId);

  const workspace = await repository.getWorkspace(query(), 1);
  assert.equal(workspace.overview.approvedStreamers, 1);
  assert.equal(workspace.overview.suspendedStreamers, 0);
  assert.equal(workspace.roster.items[0]?.programStatus, "VERIFIED");
  assert.equal(workspace.roster.items[0]?.suspendedUntil, null);

  const profile = await new D1StreamerRepository(db).findProfileById(applicant.streamerId);
  assert.equal(profile?.status, "VERIFIED");
  assert.equal(profile?.suspendedUntil, null);

  const suspendedAgain = await repository.applyAction(
    actionInput("SUSPEND_STREAMER", applicant.streamerId, "suspend-after-expiry", {
      expectedVersion: 2,
      effectiveAt: "2030-01-01T00:00:00.000Z",
    }),
  );
  assert.deepEqual(suspendedAgain, { applied: true, rowVersion: 3 });

  const suspendedWorkspace = await repository.getWorkspace(query(), 1);
  assert.equal(suspendedWorkspace.overview.approvedStreamers, 0);
  assert.equal(suspendedWorkspace.overview.suspendedStreamers, 1);
  assert.equal(suspendedWorkspace.roster.items[0]?.programStatus, "SUSPENDED");
  assert.equal(suspendedWorkspace.roster.items[0]?.suspendedUntil, "2030-01-01T00:00:00.000Z");
});

test("policy changes are versioned, audited, and activated with compare-and-swap", async () => {
  const { db, raw } = migratedDb();
  raw.prepare("INSERT INTO users (id, nickname) VALUES (1, 'operator')").run();
  const repository = new D1StreamerAdminRepository(db);
  const current = await repository.getActivePolicy();
  assert.ok(current);

  const result = await repository.applyAction({
    action: "SAVE_POLICY",
    targetId: "POLICY",
    expectedVersion: current.version,
    actorUserId: 1,
    reason: "raise manual review threshold",
    internalNote: "approved by operations",
    effectiveAt: null,
    policyValues: { ...current.values, minimumAudience: 20_000 },
    correlationId: "policy-v2",
    nowIso: "2026-08-31T02:00:00.000Z",
  });

  assert.deepEqual(result, { applied: true, rowVersion: 2 });
  assert.equal(
    raw.prepare("SELECT active_version FROM streamer_policy_state WHERE singleton_id = 1").get()
      ?.active_version,
    2,
  );
  assert.equal(
    JSON.parse(
      String(
        raw.prepare("SELECT values_json FROM streamer_policy_versions WHERE version = 2").get()
          ?.values_json,
      ),
    ).minimumAudience,
    20_000,
  );
  assert.deepEqual(
    {
      ...raw
        .prepare(
          `SELECT action, target_type, policy_version FROM streamer_admin_audit_log
           WHERE correlation_id = 'policy-v2'`,
        )
        .get(),
    },
    { action: "SAVE_POLICY", target_type: "POLICY", policy_version: 2 },
  );
});

test("policy changes outside persisted min, max, or step constraints are rejected", async () => {
  const { db, raw } = migratedDb();
  raw.prepare("INSERT INTO users (id, nickname) VALUES (1, 'operator')").run();
  const repository = new D1StreamerAdminRepository(db);
  const current = await repository.getActivePolicy();
  assert.ok(current);

  for (const [correlationId, policyValues] of [
    ["policy-bad-step", { ...current.values, minimumAudience: 10_050 }],
    ["policy-too-large", { ...current.values, providerTimeoutSeconds: 121 }],
    [
      "policy-bad-notice",
      {
        ...current.values,
        ownershipValidityDays: 30,
        reverificationNoticeDays: 30,
      },
    ],
  ] as const) {
    const result = await repository.applyAction({
      action: "SAVE_POLICY",
      targetId: "POLICY",
      expectedVersion: current.version,
      actorUserId: 1,
      reason: "invalid policy should not persist",
      internalNote: null,
      effectiveAt: null,
      policyValues,
      correlationId,
      nowIso: "2026-08-31T02:00:00.000Z",
    });
    assert.deepEqual(result, { applied: false, code: "INVALID_ACTION", rowVersion: null });
  }

  assert.equal(
    raw.prepare("SELECT COUNT(*) AS count FROM streamer_policy_versions").get()?.count,
    1,
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) AS count FROM streamer_admin_audit_log").get()?.count,
    0,
  );
});

test("metric refresh keeps the active review pinned to its original policy version", async () => {
  const { db, raw } = migratedDb();
  raw.prepare("INSERT INTO users (id, nickname) VALUES (1, 'operator')").run();
  const applicant = seedApplicant(raw, "pinned-policy");
  const repository = new D1StreamerAdminRepository(db);
  const current = await repository.getActivePolicy();
  assert.ok(current);
  const policyResult = await repository.applyAction({
    action: "SAVE_POLICY",
    targetId: "POLICY",
    expectedVersion: current.version,
    actorUserId: 1,
    reason: "new applicants use a higher threshold",
    internalNote: null,
    effectiveAt: null,
    policyValues: { ...current.values, minimumAudience: 30_000 },
    correlationId: "policy-before-refresh",
    nowIso: "2026-08-31T02:00:00.000Z",
  });
  assert.equal(policyResult.applied, true);

  const workspaceBeforeRefresh = await repository.getWorkspace(query(), 1);
  assert.equal(workspaceBeforeRefresh.reviews.items[0]?.evidence.policyVersion, 1);
  assert.equal(
    workspaceBeforeRefresh.reviews.items[0]?.evidence.conditions.find(
      (condition) => condition.field === "AUDIENCE",
    )?.required,
    10_000,
  );

  const platformAccount = await new D1StreamerRepository(db).findPlatformAccountById(
    applicant.accountIds[0],
  );
  assert.ok(platformAccount);
  const refresh = await repository.recordMetricRefresh({
    platformAccount,
    expectedVersion: platformAccount.rowVersion,
    audienceCount: 25_000,
    channelCreatedAt: "2020-01-01T00:00:00.000Z",
    actorUserId: 1,
    reason: "manual provider refresh",
    internalNote: null,
    correlationId: "refresh-pinned-policy",
    nowIso: "2026-08-31T03:00:00.000Z",
  });
  assert.equal(refresh.applied, true);

  const review = raw
    .prepare("SELECT policy_version, evidence_json FROM streamer_platform_reviews WHERE id = ?")
    .get(applicant.reviewIds[0]);
  assert.equal(review?.policy_version, 1);
  const evidence = JSON.parse(String(review?.evidence_json)) as {
    policyVersion: number;
    conditions: Array<{ field: string; result: string; required: number | null }>;
  };
  assert.equal(evidence.policyVersion, 1);
  assert.deepEqual(
    evidence.conditions.find((condition) => condition.field === "AUDIENCE"),
    {
      field: "AUDIENCE",
      result: "PASS",
      actual: 25000,
      required: 10000,
      unit: "PEOPLE",
      reasonCode: "AUDIENCE_MEETS_POLICY",
    },
  );
  assert.equal(
    raw
      .prepare(
        "SELECT policy_version FROM streamer_admin_audit_log WHERE correlation_id = 'refresh-pinned-policy'",
      )
      .get()?.policy_version,
    1,
  );

  const decision = await repository.applyAction({
    action: "APPROVE_STREAMER",
    targetId: String(applicant.reviewIds[0]),
    expectedVersion: 1,
    actorUserId: 1,
    reason: "manual decision under pinned policy",
    internalNote: null,
    effectiveAt: null,
    policyValues: null,
    correlationId: "decision-pinned-policy",
    nowIso: "2026-08-31T03:05:00.000Z",
  });
  assert.equal(decision.applied, true);
  assert.equal(
    raw
      .prepare(
        "SELECT policy_version FROM streamer_admin_audit_log WHERE correlation_id = 'decision-pinned-policy'",
      )
      .get()?.policy_version,
    1,
  );
});

test("metric refresh cannot mutate a review claimed by another active operator", async () => {
  const { db, raw } = migratedDb();
  raw.prepare("INSERT INTO users (id, nickname) VALUES (1, 'operator-a')").run();
  raw.prepare("INSERT INTO users (id, nickname) VALUES (2, 'operator-b')").run();
  const applicant = seedApplicant(raw, "claimed-metrics");
  raw
    .prepare(
      `UPDATE streamer_platform_reviews
       SET claimed_by_user_id = 2, claim_expires_at = '2026-08-31T04:00:00.000Z'
       WHERE id = ?`,
    )
    .run(applicant.reviewIds[0]);
  const repository = new D1StreamerAdminRepository(db);
  const platformAccount = await new D1StreamerRepository(db).findPlatformAccountById(
    applicant.accountIds[0],
  );
  assert.ok(platformAccount);

  const refresh = await repository.recordMetricRefresh({
    platformAccount,
    expectedVersion: platformAccount.rowVersion,
    audienceCount: 99_999,
    channelCreatedAt: "2019-01-01T00:00:00.000Z",
    actorUserId: 1,
    reason: "attempt while another operator owns the claim",
    internalNote: null,
    correlationId: "refresh-claimed-by-other",
    nowIso: "2026-08-31T03:00:00.000Z",
  });

  assert.deepEqual(refresh, { applied: false, code: "CONFLICT", rowVersion: null });
  assert.deepEqual(
    {
      ...raw
        .prepare(
          `SELECT audience_count, row_version FROM streamer_platform_accounts
           WHERE id = ?`,
        )
        .get(applicant.accountIds[0]),
    },
    { audience_count: 25000, row_version: 0 },
  );
  assert.equal(
    raw
      .prepare("SELECT evidence_json FROM streamer_platform_reviews WHERE id = ?")
      .get(applicant.reviewIds[0])?.evidence_json,
    "{}",
  );
  assert.equal(
    raw
      .prepare(
        "SELECT COUNT(*) AS count FROM streamer_admin_audit_log WHERE correlation_id = 'refresh-claimed-by-other'",
      )
      .get()?.count,
    0,
  );
});
