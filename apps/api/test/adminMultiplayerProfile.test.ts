import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { AdminOfficialMultiplayerProfileResponseSchema } from "@owogg/contracts";
import { hashSessionToken } from "@owogg/db";
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
