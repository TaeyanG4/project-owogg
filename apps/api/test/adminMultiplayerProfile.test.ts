import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  AdminManagedMultiplayerProfileActivationResponseSchema,
  AdminManagedMultiplayerProfileListResponseSchema,
  AdminManagedMultiplayerProfileRequestListResponseSchema,
  AdminManagedMultiplayerProfileReviewResponseSchema,
} from "@owogg/contracts";
import { parseMultiplayerRuntimeProfileRequestV1 } from "@owogg/core";
import { D1MultiplayerProfileRequestRepository, hashSessionToken } from "@owogg/db";
import { createSqliteD1 } from "../../../packages/db/test/helpers/sqliteD1.js";
import { app } from "../src/app.js";

const USER_SESSION_TOKEN = "admin-multiplayer-user-session";
const ADMIN_SESSION_TOKEN = "admin-multiplayer-step-up-session";
const COOKIE = `owogg_session=${USER_SESSION_TOKEN}; owogg_admin_session=${ADMIN_SESSION_TOKEN}`;
const NOW = "2026-08-26T00:00:00.000Z";
const FUTURE = "2099-08-26T00:00:00.000Z";
const CONTENT_HASH = "e".repeat(64);
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

test("Relay request approval creates a disabled exact-bundle profile before separate activation", async () => {
  const { db, raw } = createMigratedD1();
  await seedElevatedSession({ raw, managed: true });
  raw.prepare("INSERT INTO users (id, nickname) VALUES (2, 'Creator')").run();
  raw
    .prepare(
      `INSERT INTO games (
         id, slug, publisher_type, publisher_user_id, visibility, live_version_id,
         deleted_at, created_at, updated_at
       ) VALUES (21, 'relay-demo', 'USER', 2, 'PRIVATE', NULL, NULL, ?, ?)`,
    )
    .run(NOW, NOW);
  raw
    .prepare(
      `INSERT INTO game_versions (
         id, game_id, object_key, content_hash, bundle_bytes, publish_status,
         uploaded_at, moderation_status
       ) VALUES (22, 21, 'games/21/22.zip', ?, 1024, 'READY', ?, 'APPROVED')`,
    )
    .run(CONTENT_HASH, NOW);
  raw.prepare("UPDATE games SET visibility = 'PUBLIC', live_version_id = 22 WHERE id = 21").run();
  const request = parseMultiplayerRuntimeProfileRequestV1({
    version: 1,
    transport: { kind: "websocket", protocolVersion: 1 },
    runtime: { kind: "relay" },
    players: { min: 2, max: 8 },
    features: {
      reconnect: "resume",
      directMessages: true,
      hostSnapshot: true,
      joinInProgress: false,
      spectators: false,
    },
  });
  const submitted = await new D1MultiplayerProfileRequestRepository(db).submit({
    gameId: 21,
    gameVersionId: 22,
    contentHash: CONTENT_HASH,
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
  assert.equal(list.requests[0]?.contentHash, CONTENT_HASH);
  assert.equal(list.requests[0]?.request.version, 1);
  assert.equal(list.requests[0]?.request.runtime.kind, "relay");
  assert.equal(list.requests[0]?.resolution.status, "SUPPORTED_V1");
  assert.equal(
    list.requests[0]?.resolution.status === "SUPPORTED_V1"
      ? list.requests[0].resolution.resultTrust
      : null,
    "UNVERIFIED",
  );

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
  assert.equal(reviewed.profile?.contentHash, CONTENT_HASH);
  assert.equal(reviewed.profile?.runtimeKind, "relay");
  assert.equal(reviewed.profile?.enabled, false);
  assert.equal(
    raw
      .prepare("SELECT status FROM multiplayer_profile_requests WHERE id = ?")
      .get(submitted.record.id)?.status,
    "APPROVED",
  );
  assert.ok(reviewed.profile);
  const profileId = reviewed.profile.id;
  assert.deepEqual(
    {
      ...(raw
        .prepare(
          "SELECT profile_kind, content_hash, enabled FROM multiplayer_profiles WHERE id = ?",
        )
        .get(profileId) as Record<string, unknown>),
    },
    { profile_kind: "RELAY", content_hash: CONTENT_HASH, enabled: 0 },
  );

  const profilesResponse = await app.request(
    "http://localhost/api/admin/games/multiplayer-profiles",
    { headers: { Cookie: COOKIE } },
    env,
  );
  assert.equal(profilesResponse.status, 200);
  const listedProfiles = AdminManagedMultiplayerProfileListResponseSchema.parse(
    await profilesResponse.json(),
  );
  assert.deepEqual(
    listedProfiles.profiles.map((profile) => profile.id),
    [profileId],
  );
  assert.equal(listedProfiles.profiles[0]?.enabled, false);

  const activate = async (enabled: boolean, reasonCode: string | null) =>
    app.request(
      `http://localhost/api/admin/games/multiplayer-profiles/${profileId}/activation`,
      {
        method: "POST",
        headers: {
          Cookie: COOKIE,
          Origin: "http://localhost:5173",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ enabled, reasonCode }),
      },
      env,
    );
  const enabledResponse = await activate(true, null);
  assert.equal(enabledResponse.status, 200);
  assert.equal(
    AdminManagedMultiplayerProfileActivationResponseSchema.parse(await enabledResponse.json())
      .profile.enabled,
    true,
  );
  const disabledResponse = await activate(false, "STAGING_TEST_COMPLETE");
  assert.equal(disabledResponse.status, 200);
  const disabled = AdminManagedMultiplayerProfileActivationResponseSchema.parse(
    await disabledResponse.json(),
  );
  assert.equal(disabled.profile.enabled, false);
  assert.deepEqual(
    {
      ...(raw
        .prepare(
          "SELECT enabled, disabled_reason_code, disabled_by_admin_id FROM multiplayer_profiles WHERE id = ?",
        )
        .get(profileId) as Record<string, unknown>),
    },
    { enabled: 0, disabled_reason_code: "STAGING_TEST_COMPLETE", disabled_by_admin_id: 9 },
  );
});
