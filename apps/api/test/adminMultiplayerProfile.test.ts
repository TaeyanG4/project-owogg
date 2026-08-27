import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  AdminManagedMultiplayerProfileRequestListResponseSchema,
  AdminManagedMultiplayerProfileReviewResponseSchema,
  AdminOfficialMultiplayerProfileResponseSchema,
} from "@owogg/contracts";
import { parseManagedMultiplayerProfileRequestV1 } from "@owogg/core";
import { D1MultiplayerProfileRequestRepository, hashSessionToken } from "@owogg/db";
import { createSqliteD1 } from "../../../packages/db/test/helpers/sqliteD1.js";
import { app } from "../src/app.js";

const USER_SESSION_TOKEN = "admin-multiplayer-user-session";
const ADMIN_SESSION_TOKEN = "admin-multiplayer-step-up-session";
const COOKIE = `owogg_session=${USER_SESSION_TOKEN}; owogg_admin_session=${ADMIN_SESSION_TOKEN}`;
const NOW = "2026-08-26T00:00:00.000Z";
const FUTURE = "2099-08-26T00:00:00.000Z";
const B2_ENV = {
  B2_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
  B2_REGION: "us-west-004",
  B2_BUCKET_NAME: "owogg-game-bundles-staging",
  B2_KEY_ID: "staging-key-id",
  B2_APPLICATION_KEY: "staging-application-key",
} as const;

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

async function seedElevatedSession(input: {
  raw: ReturnType<typeof createMigratedD1>["raw"];
  managed: boolean;
}) {
  const userSessionHash = await hashSessionToken(USER_SESSION_TOKEN);
  const adminSessionHash = await hashSessionToken(ADMIN_SESSION_TOKEN);
  input.raw.prepare("INSERT INTO users (id, nickname) VALUES (1, 'Profile Admin')").run();
  input.raw
    .prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, 1, ?, ?)")
    .run(userSessionHash, NOW, FUTURE);
  if (input.managed) {
    input.raw
      .prepare(
        `INSERT INTO admin_accounts (
           id, user_id, google_sub, username, password_hash, role, status,
           must_change_password, created_at, updated_at, password_changed_at
         ) VALUES (9, 1, 'admin-google-sub', 'profile-admin', 'hash', 'ADMIN', 'ACTIVE', 0, ?, ?, ?)`,
      )
      .run(NOW, NOW, NOW);
  }
  input.raw
    .prepare(
      `INSERT INTO admin_sessions (
         token_hash, user_id, session_token_hash, created_at, expires_at, revoked_at
       ) VALUES (?, 1, ?, ?, ?, NULL)`,
    )
    .run(adminSessionHash, userSessionHash, NOW, FUTURE);
}

function seedOfficialOmok(raw: ReturnType<typeof createMigratedD1>["raw"]) {
  raw
    .prepare(
      `INSERT INTO games (
         id, slug, publisher_type, publisher_user_id, visibility, live_version_id,
         deleted_at, created_at, updated_at
       ) VALUES (11, 'official-omok', 'OWOGG', NULL, 'PRIVATE', NULL, NULL, ?, ?)`,
    )
    .run(NOW, NOW);
  raw
    .prepare(
      `INSERT INTO game_versions (
         id, game_id, object_key, content_hash, bundle_bytes, publish_status,
         uploaded_at, moderation_status
       ) VALUES (12, 11, 'games/11/12.zip', 'official-omok-content', 1024, 'READY', ?, NULL)`,
    )
    .run(NOW);
  raw.prepare("UPDATE games SET visibility = 'PUBLIC', live_version_id = 12 WHERE id = 11").run();
}

function canonicalOmok() {
  return {
    schemaVersion: 3,
    slug: "official-omok",
    title: "온라인 오목",
    shortDescription: "서버 권위형 2인 오목",
    description: "OWOGG 공식 온라인 오목입니다.",
    publisher: { official: true },
    policy: {
      score: null,
      leaderboard: false,
      xpPerCompletion: 0,
      requiresAuth: true,
    },
    supportsReplay: false,
    catalog: {
      type: "GENRE_MODE",
      genre: "board",
      mode: "multi",
      inputMethods: ["mouse", "touch"],
    },
    updatedAt: NOW,
  };
}

test("managed admin can activate, inspect, and audit-disable the exact live Omok profile", async () => {
  const { db, raw } = createMigratedD1();
  await seedElevatedSession({ raw, managed: true });
  seedOfficialOmok(raw);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(canonicalOmok()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

  const env = {
    DB: db,
    FRONTEND_URL: "http://localhost:5173",
    ...B2_ENV,
  } as any;
  const request = (enabled: boolean) =>
    app.request(
      "http://localhost/api/admin/games/official-omok/multiplayer-profile",
      {
        method: "POST",
        headers: {
          Cookie: COOKIE,
          Origin: "http://localhost:5173",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          preset: "OMOK_V1",
          enabled,
          ...(enabled ? {} : { reasonCode: "STAGING_TEST_COMPLETE" }),
        }),
      },
      env,
    );

  try {
    const enabledResponse = await request(true);
    assert.equal(enabledResponse.status, 200);
    const enabled = AdminOfficialMultiplayerProfileResponseSchema.parse(
      await enabledResponse.json(),
    );
    assert.equal(enabled.status, "ENABLED");
    assert.equal(enabled.profile?.leaderboardEnabled, false);
    assert.equal(enabled.profile?.rewardPolicyId, null);
    assert.deepEqual(enabled.profile?.allowedVisibility, ["PRIVATE"]);
    assert.deepEqual(enabled.profile?.allowedJoinPolicies, ["OPEN"]);

    const stored = raw
      .prepare(
        `SELECT enabled, ruleset_key, max_action_bytes, max_state_bytes,
                reward_policy_id, created_by_admin_id
         FROM multiplayer_profiles WHERE game_id = 11 AND game_version_id = 12`,
      )
      .get() as Record<string, unknown>;
    assert.deepEqual(
      { ...stored },
      {
        enabled: 1,
        ruleset_key: "official:omok",
        max_action_bytes: 512,
        max_state_bytes: 4096,
        reward_policy_id: null,
        created_by_admin_id: 9,
      },
    );

    const getResponse = await app.request(
      "http://localhost/api/admin/games/official-omok/multiplayer-profile",
      { headers: { Cookie: COOKIE } },
      env,
    );
    assert.equal(getResponse.status, 200);
    assert.equal(
      AdminOfficialMultiplayerProfileResponseSchema.parse(await getResponse.json()).status,
      "ENABLED",
    );

    const disabledResponse = await request(false);
    assert.equal(disabledResponse.status, 200);
    assert.equal(
      AdminOfficialMultiplayerProfileResponseSchema.parse(await disabledResponse.json()).status,
      "DISABLED",
    );
    assert.deepEqual(
      {
        ...(raw
          .prepare(
            `SELECT enabled, disabled_reason_code, disabled_by_admin_id
             FROM multiplayer_profiles WHERE game_id = 11 AND game_version_id = 12`,
          )
          .get() as Record<string, unknown>),
      },
      {
        enabled: 0,
        disabled_reason_code: "STAGING_TEST_COMPLETE",
        disabled_by_admin_id: 9,
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("legacy root eligibility cannot mutate a profile without a managed audit identity", async () => {
  const { db, raw } = createMigratedD1();
  await seedElevatedSession({ raw, managed: false });
  const response = await app.request(
    "http://localhost/api/admin/games/official-omok/multiplayer-profile",
    {
      method: "POST",
      headers: {
        Cookie: COOKIE,
        Origin: "http://localhost:5173",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ preset: "OMOK_V1", enabled: true }),
    },
    {
      DB: db,
      ADMIN_USER_IDS: "1",
      FRONTEND_URL: "http://localhost:5173",
      ...B2_ENV,
    } as any,
  );

  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "MANAGED_ADMIN_REQUIRED");
  assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM multiplayer_profiles").get().count, 0);
});

test("managed manifest requests are listed and approved only into a disabled exact-version profile", async () => {
  const { db, raw } = createMigratedD1();
  await seedElevatedSession({ raw, managed: true });
  raw.prepare("INSERT INTO users (id, nickname) VALUES (2, 'Creator')").run();
  raw
    .prepare(
      `INSERT INTO games (
         id, slug, publisher_type, publisher_user_id, visibility, live_version_id,
         deleted_at, created_at, updated_at
       ) VALUES (21, 'creator-grid', 'USER', 2, 'PRIVATE', NULL, NULL, ?, ?)`,
    )
    .run(NOW, NOW);
  raw
    .prepare(
      `INSERT INTO game_versions (
         id, game_id, object_key, content_hash, bundle_bytes, publish_status,
         uploaded_at, moderation_status
       ) VALUES (22, 21, 'games/21/22.zip', 'creator-grid-content', 1024, 'READY', ?, 'APPROVED')`,
    )
    .run(NOW);
  raw.prepare("UPDATE games SET visibility = 'PUBLIC', live_version_id = 22 WHERE id = 21").run();
  const request = parseManagedMultiplayerProfileRequestV1({
    requestVersion: 1,
    kind: "managed-template",
    template: { id: "turn-grid", version: 1 },
    players: { min: 2, max: 2 },
    requirements: {
      simulation: "turn",
      lifecycle: "match",
      persistence: "match",
      latency: "relaxed",
      reconnect: "resume",
      hiddenInformation: false,
      simultaneousResponse: false,
      joinInProgress: false,
      spectators: false,
    },
    config: { boardWidth: 15, boardHeight: 15, winLength: 5 },
    client: { protocolVersion: 1 },
  });
  const submitted = await new D1MultiplayerProfileRequestRepository(db).submit({
    gameId: 21,
    gameVersionId: 22,
    requestedByUserId: 2,
    request,
    nowIso: NOW,
  });
  assert.ok(submitted.status === "CREATED");
  const env = {
    DB: db,
    FRONTEND_URL: "http://localhost:5173",
    ...B2_ENV,
  } as any;

  const listResponse = await app.request(
    "http://localhost/api/admin/games/multiplayer-requests",
    { headers: { Cookie: COOKIE } },
    env,
  );
  assert.equal(listResponse.status, 200);
  const list = AdminManagedMultiplayerProfileRequestListResponseSchema.parse(
    await listResponse.json(),
  );
  assert.equal(list.requests.length, 1);
  assert.equal(list.requests[0]?.request.requestVersion, 1);
  assert.equal(list.requests[0]?.resolution.resolvedClass, "M1");

  const reviewedResponse = await app.request(
    `http://localhost/api/admin/games/multiplayer-requests/${submitted.record.id}/review`,
    {
      method: "POST",
      headers: {
        Cookie: COOKIE,
        Origin: "http://localhost:5173",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ decision: "APPROVED" }),
    },
    env,
  );
  assert.equal(reviewedResponse.status, 200);
  const reviewed = AdminManagedMultiplayerProfileReviewResponseSchema.parse(
    await reviewedResponse.json(),
  );
  assert.equal(reviewed.request.status, "APPROVED");
  assert.equal(reviewed.profile?.resolvedClass, "M1");
  assert.equal(reviewed.profile?.enabled, false);
  assert.equal(reviewed.profile?.rewardPolicyId, null);
  assert.deepEqual(
    {
      ...(raw
        .prepare(
          `SELECT enabled, source_request_id, ruleset_key, action_rate_limit, reward_policy_id
           FROM multiplayer_profiles WHERE game_id = 21 AND game_version_id = 22`,
        )
        .get() as Record<string, unknown>),
    },
    {
      enabled: 0,
      source_request_id: submitted.record.id,
      ruleset_key: "managed:turn-grid:v1",
      action_rate_limit: 5,
      reward_policy_id: null,
    },
  );
});
