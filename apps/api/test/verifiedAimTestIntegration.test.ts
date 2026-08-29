import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  mapGameCreatorManifestToCanonical,
  parseGameCreatorManifest,
  serializeGameCanonicalDocument,
  verifyVerifiedGameSession,
} from "@owogg/core";
import { createSqliteD1 } from "../../../packages/db/test/helpers/sqliteD1.js";
import { app } from "../src/app.js";
import {
  VERIFIED_AIM_TEST_SLUG,
  VERIFIED_AIM_TEST_TIMING,
  createVerifiedAimTestTargets,
} from "../src/infrastructure/games/verifiers/VerifiedAimTestV1.js";

const SESSION_SECRET = "verified-aim-integration-session-secret";
const SESSION_ID = "verified-aim-integration-session";
const GAME_ID = 701;
const VERSION_ID = 702;
const PROFILE_ID = 703;
const CONTENT_HASH = "c".repeat(64);
const NOW_ISO = "2026-08-29T12:00:00.000Z";
const B2_ENV = {
  B2_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
  B2_REGION: "us-west-004",
  B2_BUCKET_NAME: "test",
  B2_KEY_ID: "test",
  B2_APPLICATION_KEY: "test",
};

function createDatabase() {
  const context = createSqliteD1("PRAGMA foreign_keys = ON;");
  const migrationDirectory = new URL("../../../packages/db/migrations/", import.meta.url);
  for (const filename of fs
    .readdirSync(migrationDirectory)
    .filter((value) => value.endsWith(".sql"))
    .sort()) {
    context.raw.exec(fs.readFileSync(new URL(filename, migrationDirectory), "utf8"));
  }

  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  context.raw
    .prepare("INSERT INTO users (id, nickname, email) VALUES (7, 'Aim Player', 'aim@example.com')")
    .run();
  context.raw
    .prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, 7, ?, ?)")
    .run(SESSION_ID, NOW_ISO, expiresAt);
  context.raw
    .prepare(
      `INSERT INTO games (
         id, slug, publisher_type, publisher_user_id, visibility, live_version_id,
         deleted_at, created_at, updated_at
       ) VALUES (?, ?, 'OWOGG', NULL, 'PRIVATE', NULL, NULL, ?, ?)`,
    )
    .run(GAME_ID, VERIFIED_AIM_TEST_SLUG, NOW_ISO, NOW_ISO);
  context.raw
    .prepare(
      `INSERT INTO game_versions (
         id, game_id, object_key, content_hash, bundle_bytes, publish_status,
         published_at, manifest_key, published_size_bytes, file_count, uploaded_at,
         moderation_status
       ) VALUES (?, ?, ?, ?, 6604, 'READY', ?, ?, 14847, 6, ?, NULL)`,
    )
    .run(
      VERSION_ID,
      GAME_ID,
      `games/${GAME_ID}/${VERSION_ID}.zip`,
      CONTENT_HASH,
      NOW_ISO,
      `games/${GAME_ID}/${VERSION_ID}/.owogg-manifest.json`,
      NOW_ISO,
    );
  context.raw
    .prepare("UPDATE games SET visibility = 'PUBLIC', live_version_id = ? WHERE id = ?")
    .run(VERSION_ID, GAME_ID);
  return context;
}

function referenceManifest() {
  const source = JSON.parse(
    fs.readFileSync(
      new URL("../../../examples/verified-aim-test/owogg.json", import.meta.url),
      "utf8",
    ),
  ) as unknown;
  return parseGameCreatorManifest(source);
}

function canonicalFor(manifest = referenceManifest()) {
  return mapGameCreatorManifestToCanonical({
    manifest,
    publisherOfficial: true,
    updatedAt: NOW_ISO,
  });
}

async function withCanonicalFetch<T>(
  canonical: ReturnType<typeof canonicalFor>,
  run: () => Promise<T>,
) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = input instanceof Request ? input.method : (init?.method ?? "GET");
    if (method !== "GET") throw new Error(`unexpected B2 method: ${method}`);
    return new Response(serializeGameCanonicalDocument(canonical), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function authJson(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: {
      Cookie: `owogg_session=${SESSION_ID}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };
}

function evidenceFor(challengeSeed: string) {
  const targets = createVerifiedAimTestTargets({
    challengeSeed,
    difficultyId: "normal",
    variantId: "precision",
  });
  const events = targets.map((target, index) => ({
    seq: index + 1,
    tMs: VERIFIED_AIM_TEST_TIMING.minFirstHitMs + index * VERIFIED_AIM_TEST_TIMING.minHitIntervalMs,
    x: target.x,
    y: target.y,
  }));
  return { version: 1, completedAtMs: events.at(-1)?.tMs ?? 0, events };
}

function runtimeEnvironment(db: unknown, overrides: Record<string, unknown> = {}) {
  return {
    DB: db,
    GAME_SESSION_SECRET: SESSION_SECRET,
    ...B2_ENV,
    ...overrides,
  } as never;
}

test("reference gs2 session verifies evidence and atomically persists server-derived score", async () => {
  const { db, raw } = createDatabase();
  const canonical = canonicalFor();

  await withCanonicalFetch(canonical, async () => {
    const sessionResponse = await app.request(
      `/api/games/${VERIFIED_AIM_TEST_SLUG}/session`,
      authJson({
        playMode: "single",
        playConfig: { difficultyId: "normal", variantId: "precision" },
      }),
      runtimeEnvironment(db),
    );
    assert.equal(sessionResponse.status, 200);
    const session = (await sessionResponse.json()) as {
      token: string;
      startContext: {
        challengeSeed: string;
        rewardFactor: number;
        playConfig: { difficultyId: string; variantId: string };
      };
    };
    assert.equal(session.token.startsWith("gs2."), true);
    assert.equal(session.startContext.rewardFactor, 1.1);
    assert.deepEqual(session.startContext.playConfig, {
      difficultyId: "normal",
      variantId: "precision",
    });

    const evidence = evidenceFor(session.startContext.challengeSeed);
    await new Promise((resolve) =>
      setTimeout(resolve, evidence.completedAtMs + VERIFIED_AIM_TEST_TIMING.minHitIntervalMs),
    );
    const resultResponse = await app.request(
      `/api/games/${VERIFIED_AIM_TEST_SLUG}/result`,
      authJson({ token: session.token, evidence }),
      runtimeEnvironment(db),
    );
    assert.equal(resultResponse.status, 200);
    const result = (await resultResponse.json()) as Record<string, unknown>;
    assert.equal(result.verified, true);
    assert.equal(result.rawScore, evidence.completedAtMs);
    assert.equal(result.normalizedScore, evidence.completedAtMs);
    assert.equal(result.competitiveScore, 382);
    assert.equal(result.score, 382);
    assert.equal(result.difficultyId, "normal");
    assert.equal(result.variantId, "precision");
    assert.equal(result.rulesetRevision, 1);

    const stored = raw
      .prepare(
        `SELECT id, raw_score, normalized_score, competitive_score, difficulty, variant_id,
                ruleset_revision, verifier_id, evidence_hash, progression_value,
                metrics_json, events_json
         FROM game_results`,
      )
      .get() as Record<string, unknown>;
    assert.equal(stored.raw_score, evidence.completedAtMs);
    assert.equal(stored.normalized_score, evidence.completedAtMs);
    assert.equal(stored.competitive_score, 382);
    assert.equal(stored.difficulty, "normal");
    assert.equal(stored.variant_id, "precision");
    assert.equal(stored.ruleset_revision, 1);
    assert.equal(stored.verifier_id, "verified-aim-test-v1");
    assert.match(String(stored.evidence_hash), /^[0-9a-f]{64}$/);
    assert.equal(stored.progression_value, 6);
    assert.deepEqual(JSON.parse(String(stored.metrics_json)), { hits: 6 });
    assert.deepEqual(JSON.parse(String(stored.events_json)), { target_hit: 6, completed: 1 });

    const score = raw
      .prepare("SELECT score, difficulty, variant_id, ruleset_revision, result_id FROM scores")
      .get() as Record<string, unknown>;
    assert.equal(score.score, 382);
    assert.equal(score.difficulty, "normal");
    assert.equal(score.variant_id, "precision");
    assert.equal(score.ruleset_revision, 1);
    assert.equal(score.result_id, stored.id);

    const replayResponse = await app.request(
      `/api/games/${VERIFIED_AIM_TEST_SLUG}/result`,
      authJson({ token: session.token, evidence }),
      runtimeEnvironment(db),
    );
    assert.equal(replayResponse.status, 200);
    const replay = (await replayResponse.json()) as Record<string, unknown>;
    assert.equal(replay.result_id, result.result_id);
    assert.equal(replay.score_id, result.score_id);
    assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM game_results").get().count, 1);
    assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM scores").get().count, 1);

    const changedEvidence = {
      ...evidence,
      events: evidence.events.map((event, index) =>
        index === 0 ? { ...event, x: event.x + 0.000_001 } : event,
      ),
    };
    const conflictResponse = await app.request(
      `/api/games/${VERIFIED_AIM_TEST_SLUG}/result`,
      authJson({ token: session.token, evidence: changedEvidence }),
      runtimeEnvironment(db),
    );
    assert.equal(conflictResponse.status, 409);
    assert.equal(
      ((await conflictResponse.json()) as { error: { code: string } }).error.code,
      "CLAIM_CONFLICT",
    );
  });

  const columns = raw.prepare("PRAGMA table_info(game_results)").all() as { name: string }[];
  assert.equal(
    columns.some((column) => column.name === "evidence"),
    false,
  );
  assert.equal(
    columns.some((column) => column.name === "evidence_hash"),
    true,
  );
});

test("one hybrid version keeps local gs2 and Relay-online admission on separate authorities", async () => {
  const { db, raw } = createDatabase();
  const source = JSON.parse(
    fs.readFileSync(
      new URL("../../../examples/verified-aim-test/owogg.json", import.meta.url),
      "utf8",
    ),
  ) as Record<string, unknown>;
  source.game = {
    ...(source.game as Record<string, unknown>),
    mode: "multi",
    playModes: ["local-multi", "online-multi"],
  };
  source.multiplayer = {
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
  };
  const canonical = canonicalFor(parseGameCreatorManifest(source));
  raw
    .prepare(
      `INSERT INTO admin_accounts (
         id, user_id, google_sub, username, password_hash, role, status,
         must_change_password, created_at, updated_at, password_changed_at
       ) VALUES (704, 7, 'aim-admin', 'aimadmin', 'hash', 'ADMIN', 'ACTIVE', 0, ?, ?, ?)`,
    )
    .run(NOW_ISO, NOW_ISO, NOW_ISO);
  raw
    .prepare(
      `INSERT INTO multiplayer_profile_requests (
         id, game_id, game_version_id, content_hash, request_schema_version, request_hash,
         request_json, requested_by_user_id, status, reviewed_by_admin_id, reviewed_at,
         created_at, updated_at
       ) VALUES (705, ?, ?, ?, 1, ?, '{}', NULL, 'APPROVED', 704, ?, ?, ?)`,
    )
    .run(GAME_ID, VERSION_ID, CONTENT_HASH, "d".repeat(64), NOW_ISO, NOW_ISO, NOW_ISO);
  raw
    .prepare(
      `INSERT INTO multiplayer_profiles (
         id, source_request_id, source_request_hash, profile_version, game_id, game_version_id,
         profile_revision, protocol_version, resolved_class, simulation_model, runtime_backend,
         ruleset_key, ruleset_revision, resolved_config_json, lifecycle, persistence,
         latency_profile, reconnect_policy, min_players, max_players, allowed_visibility_json,
         allowed_join_policies_json, max_action_bytes, max_state_bytes, action_rate_limit,
         reward_policy_id, enabled, created_by_admin_id, approved_at, updated_at,
         profile_kind, content_hash, transport_kind, runtime_kind, direct_messages,
         host_snapshot, host_departure_policy, result_trust, max_message_bytes,
         max_snapshot_bytes, messages_per_second, room_bytes_per_second, room_ttl_seconds
       ) VALUES (
         ?, 705, ?, 1, ?, ?, 2, 1, 'M1', 'event', 'durable-object',
         'legacy:disabled', 1, '{}', 'match', 'match',
         'relaxed', 'resume', 2, 8, '["PRIVATE"]', '["OPEN"]',
         4096, 1, 20, NULL, 0, 704, ?, ?, 'RELAY', ?, 'websocket', 'relay', 1, 1,
         'close', 'UNVERIFIED', 4096, 16384, 20, 262144, 7200
       )`,
    )
    .run(PROFILE_ID, "d".repeat(64), GAME_ID, VERSION_ID, NOW_ISO, NOW_ISO, CONTENT_HASH);
  raw
    .prepare("UPDATE multiplayer_profiles SET enabled = 1, updated_at = ? WHERE id = ?")
    .run(NOW_ISO, PROFILE_ID);

  const limiter = {
    async limit() {
      return { success: true };
    },
  };
  const multiplayerRuntime = {
    MULTIPLAYER_ENABLED: "true",
    MULTIPLAYER_TICKET_KEY_ID: "verified_aim_test_key",
    MULTIPLAYER_TICKET_SECRET: "verified-aim-multiplayer-secret-32-bytes-minimum",
    MULTIPLAYER_SOCKET_ORIGIN: "http://localhost",
    FRONTEND_URL: "http://localhost:5173",
    MULTIPLAYER_RATE_LIMITER: limiter,
    MULTIPLAYER_RECOVERY_RATE_LIMITER: limiter,
    MULTIPLAYER_INSTANCES: {
      idFromName(value: string) {
        return value;
      },
      get() {
        return { fetch: async () => new Response(null, { status: 204 }) };
      },
    },
    MULTIPLAYER_LOBBY_SIGNALS: {
      idFromName(value: string) {
        return value;
      },
      get() {
        return { fetch: async () => new Response(null, { status: 204 }) };
      },
    },
  };

  await withCanonicalFetch(canonical, async () => {
    const localResponse = await app.request(
      `/api/games/${VERIFIED_AIM_TEST_SLUG}/session`,
      authJson({
        playMode: "local-multi",
        playConfig: { difficultyId: "normal", variantId: "standard" },
      }),
      runtimeEnvironment(db, multiplayerRuntime),
    );
    assert.equal(localResponse.status, 200);
    const localSession = (await localResponse.json()) as { token: string };
    const verifiedToken = await verifyVerifiedGameSession(localSession.token, SESSION_SECRET);
    assert.equal(verifiedToken.ok, true);
    assert.equal(verifiedToken.ok ? verifiedToken.payload.playMode : null, "local-multi");

    const onlineGenericResponse = await app.request(
      `/api/games/${VERIFIED_AIM_TEST_SLUG}/session`,
      authJson({
        playMode: "online-multi",
        playConfig: { difficultyId: "normal", variantId: "standard" },
      }),
      runtimeEnvironment(db, multiplayerRuntime),
    );
    assert.equal(onlineGenericResponse.status, 400);
    assert.equal(
      ((await onlineGenericResponse.json()) as { error: { code: string } }).error.code,
      "INVALID_PAYLOAD",
    );

    const availabilityResponse = await app.request(
      `/api/multiplayer/games/${VERIFIED_AIM_TEST_SLUG}`,
      {},
      runtimeEnvironment(db, multiplayerRuntime),
    );
    assert.equal(availabilityResponse.status, 200);
    const availability = (await availabilityResponse.json()) as Record<string, unknown>;
    assert.equal(availability.status, "AVAILABLE");
    assert.equal((availability.profile as { contentHash: string }).contentHash, CONTENT_HASH);
    assert.equal((availability.profile as { runtimeKind: string }).runtimeKind, "relay");
  });

  assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM game_results").get().count, 0);
  assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM multiplayer_matches").get().count, 0);
});
