import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { parseMultiplayerRuntimeProfileRequestV1 } from "@owogg/core";
import {
  D1AccountMergeRepository,
  D1MultiplayerInstanceRepository,
  D1MultiplayerMatchRepository,
  D1MultiplayerProfileRepository,
  D1MultiplayerProfileRequestRepository,
  mapMultiplayerInstanceRow,
  mapMultiplayerProfileRow,
  mapMultiplayerProfileRequestRow,
} from "../src/index.js";
import { createSqliteD1 } from "./helpers/sqliteD1.js";

type RawDatabase = ReturnType<typeof createSqliteD1>["raw"];

const NOW = "2026-08-25T00:00:00.000Z";
const LATER = "2026-08-25T01:00:00.000Z";
const EXPIRES = "2026-08-26T00:00:00.000Z";
const REQUEST_HASH = "a".repeat(64);
const IDEMPOTENCY_HASH = "b".repeat(64);
const PAYLOAD_HASH = "c".repeat(64);
const TERMINAL_HASH = "d".repeat(64);
const CONTENT_HASH = "e".repeat(64);
const INDEX_INCLUSIVE_D1_WRITE_META = {
  rowsWrittenForChanges: (changes: number) => (changes === 0 ? 0 : changes + 3),
} as const;

function createMigratedDatabase(): RawDatabase {
  return createMigratedD1().raw;
}

function createMigratedD1(
  options?: Parameters<typeof createSqliteD1>[1],
): ReturnType<typeof createSqliteD1> {
  const result = createSqliteD1("PRAGMA foreign_keys = ON;", options);
  const { raw } = result;
  const migrationUrl = new URL("../migrations/", import.meta.url);
  const filenames = fs
    .readdirSync(migrationUrl)
    .filter((filename) => filename.endsWith(".sql"))
    .sort();
  for (const filename of filenames) {
    raw.exec(fs.readFileSync(new URL(filename, migrationUrl), "utf8"));
  }
  return result;
}

function seedUsers(raw: RawDatabase): void {
  raw
    .prepare(
      "INSERT INTO users (id, nickname) VALUES (1, 'Owner'), (2, 'Opponent'), (3, 'Merged'), (4, 'Admin')",
    )
    .run();
}

function seedAdmin(raw: RawDatabase): void {
  raw
    .prepare(
      `INSERT INTO admin_accounts (
         id, user_id, google_sub, username, password_hash, role, status,
         must_change_password, created_at, updated_at, password_changed_at
       ) VALUES (
         1, 4, 'google-admin-4', 'admin4', 'hash', 'ADMIN', 'ACTIVE',
         0, ?, ?, ?
       )`,
    )
    .run(NOW, NOW, NOW);
}

function relayRequest(maxPlayers = 8) {
  return parseMultiplayerRuntimeProfileRequestV1({
    version: 1,
    transport: { kind: "websocket", protocolVersion: 1 },
    runtime: { kind: "relay" },
    players: { min: 2, max: maxPlayers },
    features: {
      reconnect: "resume",
      directMessages: true,
      hostSnapshot: true,
      joinInProgress: false,
      spectators: false,
    },
  });
}

function seedGameVersion(
  raw: RawDatabase,
  input: {
    gameId: number;
    versionId: number;
    slug: string;
    publisherType?: "OWOGG" | "USER";
    publisherUserId?: number | null;
    moderationStatus?: "APPROVED" | null;
  },
): void {
  const publisherType = input.publisherType ?? "OWOGG";
  const publisherUserId = publisherType === "USER" ? (input.publisherUserId ?? 1) : null;
  raw
    .prepare(
      `INSERT INTO games (
         id, slug, publisher_type, publisher_user_id, visibility, live_version_id,
         deleted_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'PRIVATE', NULL, NULL, ?, ?)`,
    )
    .run(input.gameId, input.slug, publisherType, publisherUserId, NOW, NOW);
  raw
    .prepare(
      `INSERT INTO game_versions (
         id, game_id, object_key, content_hash, bundle_bytes, publish_status,
         uploaded_at, moderation_status
       ) VALUES (?, ?, ?, ?, 100, 'READY', ?, ?)`,
    )
    .run(
      input.versionId,
      input.gameId,
      "games/" + input.gameId + "/" + input.versionId + ".zip",
      CONTENT_HASH,
      NOW,
      input.moderationStatus ?? null,
    );
  raw
    .prepare("UPDATE games SET live_version_id = ?, updated_at = ? WHERE id = ?")
    .run(input.versionId, NOW, input.gameId);
}

function seedProfile(
  raw: RawDatabase,
  input: {
    profileId: number;
    gameId: number;
    versionId: number;
    revision?: number;
    enabled?: boolean;
    rewardPolicyId?: string | null;
    sourceRequestId?: number | null;
    sourceRequestHash?: string | null;
    allowedVisibilityJson?: string;
  },
): void {
  const sourceRequestId =
    "sourceRequestId" in input ? input.sourceRequestId : input.profileId + 10_000;
  const sourceRequestHash = input.sourceRequestHash ?? REQUEST_HASH;
  if (!("sourceRequestId" in input)) {
    raw
      .prepare(
        `INSERT OR IGNORE INTO admin_accounts (
           id, user_id, google_sub, username, password_hash, role, status,
           must_change_password, created_at, updated_at, password_changed_at
         ) VALUES (1, 4, 'google-admin-4', 'admin4', 'hash', 'ADMIN', 'ACTIVE', 0, ?, ?, ?)`,
      )
      .run(NOW, NOW, NOW);
    const publisher = raw
      .prepare("SELECT publisher_type, publisher_user_id FROM games WHERE id = ?")
      .get(input.gameId) as
      { publisher_type: string; publisher_user_id: number | null } | undefined;
    raw
      .prepare(
        `INSERT OR IGNORE INTO multiplayer_profile_requests (
           id, game_id, game_version_id, content_hash, request_schema_version, request_hash,
           request_json, requested_by_user_id, status, reviewed_by_admin_id, reviewed_at,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, 1, ?, '{}', ?, 'APPROVED', 1, ?, ?, ?)`,
      )
      .run(
        sourceRequestId,
        input.gameId,
        input.versionId,
        CONTENT_HASH,
        sourceRequestHash,
        publisher?.publisher_type === "USER" ? publisher.publisher_user_id : null,
        NOW,
        NOW,
        NOW,
      );
  }
  raw
    .prepare(
      `INSERT INTO multiplayer_profiles (
         id, source_request_id, source_request_hash, profile_version, game_id, game_version_id,
         profile_revision, protocol_version, resolved_class, simulation_model, runtime_backend,
         ruleset_key, ruleset_revision, resolved_config_json, lifecycle, persistence,
         latency_profile, reconnect_policy, min_players, max_players, allowed_visibility_json,
         allowed_join_policies_json, max_action_bytes, max_state_bytes, action_rate_limit,
         reward_policy_id, enabled, approved_at, updated_at, profile_kind, content_hash,
         transport_kind, runtime_kind, direct_messages, host_snapshot, host_departure_policy,
         result_trust, max_message_bytes, max_snapshot_bytes, messages_per_second,
         room_bytes_per_second, room_ttl_seconds
       ) VALUES (
         ?, ?, ?, 1, ?, ?, ?, 1, 'M1', 'event', 'durable-object',
         'legacy:disabled', 1, '{}', 'match', 'match',
         'relaxed', 'resume', 2, 2, ?, '["OPEN"]',
         4096, 1, 20, ?, 0, ?, ?, 'RELAY', ?, 'websocket', 'relay', 1, 1,
         'close', 'UNVERIFIED', 4096, 16384, 20, 262144, 7200
       )`,
    )
    .run(
      input.profileId,
      sourceRequestId ?? null,
      sourceRequestHash,
      input.gameId,
      input.versionId,
      input.revision ?? 1,
      input.allowedVisibilityJson ?? '["PRIVATE"]',
      input.rewardPolicyId ?? null,
      NOW,
      NOW,
      CONTENT_HASH,
    );
  if (input.enabled !== false) {
    raw
      .prepare("UPDATE multiplayer_profiles SET enabled = 1, updated_at = ? WHERE id = ?")
      .run(NOW, input.profileId);
  }
}

function seedInstance(
  raw: RawDatabase,
  input: {
    id?: string;
    publicCode?: string;
    creatorUserId?: number;
    idempotencyHash?: string;
    gameId?: number;
    versionId?: number;
    profileId?: number;
  } = {},
): string {
  const id = input.id ?? "instance_0000000000000000000001";
  raw
    .prepare(
      `INSERT INTO multiplayer_instances (
         id, public_code, created_by_user_id, create_idempotency_hash,
         game_id, game_version_id, content_hash, profile_id, profile_revision,
         visibility, join_policy, lifecycle, status, generation,
         participant_count, max_players, expires_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'PRIVATE', 'OPEN', 'match',
                 'CREATED', 1, 0, 2, ?, ?, ?)`,
    )
    .run(
      id,
      input.publicCode ?? "ROOMCODE00001",
      input.creatorUserId ?? 1,
      input.idempotencyHash ?? IDEMPOTENCY_HASH,
      input.gameId ?? 1,
      input.versionId ?? 10,
      CONTENT_HASH,
      input.profileId ?? 100,
      EXPIRES,
      NOW,
      NOW,
    );
  return id;
}

function seedParticipants(raw: RawDatabase, instanceId: string): void {
  raw
    .prepare(
      `INSERT INTO multiplayer_participants (
         id, instance_id, user_id, role, seat_index, status,
         connection_generation, joined_at, updated_at
       ) VALUES
         ('participant_host_0001', ?, 1, 'HOST', 0, 'JOINED', 0, ?, ?),
         ('participant_player_02', ?, 2, 'PLAYER', 1, 'JOINED', 0, ?, ?)`,
    )
    .run(instanceId, NOW, NOW, instanceId, NOW, NOW);
}

function closeCommittedGeneration(raw: RawDatabase, instanceId: string, matchId: string): void {
  raw
    .prepare(
      `UPDATE multiplayer_participants
       SET status = 'READY', ready_at = ?, updated_at = ?
       WHERE instance_id = ? AND status = 'JOINED'`,
    )
    .run(LATER, LATER, instanceId);
  raw
    .prepare("UPDATE multiplayer_instances SET status = 'STARTING', updated_at = ? WHERE id = ?")
    .run(LATER, instanceId);
  raw
    .prepare(
      `INSERT INTO multiplayer_matches (
         id, instance_id, generation, game_id, game_version_id, profile_id,
         profile_revision, status, state_revision, created_at, updated_at
       )
       SELECT ?, id, generation, game_id, game_version_id, profile_id,
              profile_revision, 'PENDING', 0, ?, ?
       FROM multiplayer_instances WHERE id = ?`,
    )
    .run(matchId, NOW, NOW, instanceId);
  raw
    .prepare(
      `INSERT INTO multiplayer_match_players (
         match_id, user_id, participant_id, result_status, reward_eligible, created_at
       )
       SELECT ?, user_id, id, 'PENDING', 0, ?
       FROM multiplayer_participants
       WHERE instance_id = ? AND status = 'READY'`,
    )
    .run(matchId, NOW, instanceId);
  raw
    .prepare("UPDATE multiplayer_instances SET status = 'ACTIVE', updated_at = ? WHERE id = ?")
    .run(LATER, instanceId);
  raw
    .prepare(
      `UPDATE multiplayer_matches
       SET status = 'FINALIZING', terminal_result_json = '{"completed":true}',
           terminal_result_hash = ?, finalizing_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(TERMINAL_HASH, LATER, LATER, matchId);
  raw
    .prepare(
      `UPDATE multiplayer_match_players
       SET result_status = 'COMMITTED', outcome = 'COMPLETED',
           result_json = '{"outcome":"COMPLETED"}', committed_at = ?
       WHERE match_id = ?`,
    )
    .run(LATER, matchId);
  raw
    .prepare(
      `UPDATE multiplayer_matches
       SET status = 'COMMITTED', committed_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(LATER, LATER, matchId);
  raw
    .prepare("UPDATE multiplayer_instances SET status = 'CLOSING', updated_at = ? WHERE id = ?")
    .run(LATER, instanceId);
}

test("0041 scopes trusted profiles to one exact READY version and keeps semantics immutable", () => {
  const raw = createMigratedDatabase();
  seedUsers(raw);
  seedAdmin(raw);
  seedGameVersion(raw, { gameId: 1, versionId: 10, slug: "relay-demo" });
  seedGameVersion(raw, { gameId: 2, versionId: 20, slug: "other-game" });

  assert.throws(
    () => seedProfile(raw, { profileId: 99, gameId: 1, versionId: 20 }),
    /exact version content hash/,
  );

  seedProfile(raw, { profileId: 100, gameId: 1, versionId: 10 });
  assert.throws(
    () => raw.prepare("UPDATE multiplayer_profiles SET ruleset_revision = 2 WHERE id = 100").run(),
    /semantics are immutable/,
  );
  assert.throws(
    () =>
      seedProfile(raw, {
        profileId: 101,
        gameId: 1,
        versionId: 10,
        revision: 2,
        sourceRequestId: 10_100,
        sourceRequestHash: REQUEST_HASH,
      }),
    /UNIQUE constraint failed/,
  );
  assert.throws(
    () =>
      seedProfile(raw, {
        profileId: 102,
        gameId: 2,
        versionId: 20,
        allowedVisibilityJson: '["PRIVATE","PRIVATE"]',
      }),
    /Invalid generic Relay profile policy/,
  );

  raw
    .prepare(
      "UPDATE multiplayer_profiles SET enabled = 0, disabled_at = ?, disabled_reason_code = 'ADMIN_DISABLED', disabled_by_admin_id = 1, updated_at = ? WHERE id = 100",
    )
    .run(LATER, LATER);
  raw
    .prepare("UPDATE multiplayer_profiles SET enabled = 1, updated_at = ? WHERE id = 101")
    .run(LATER);
  assert.equal(
    raw
      .prepare(
        "SELECT profile_revision FROM multiplayer_profiles WHERE game_version_id = 10 AND enabled = 1",
      )
      .get()?.profile_revision,
    2,
  );
});

test("0041 enforces idempotent instance creation, capacity, access, and rematch generation", () => {
  const raw = createMigratedDatabase();
  seedUsers(raw);
  seedGameVersion(raw, { gameId: 1, versionId: 10, slug: "relay-demo" });
  seedProfile(raw, { profileId: 100, gameId: 1, versionId: 10 });
  const instanceId = seedInstance(raw);

  assert.throws(
    () =>
      seedInstance(raw, {
        id: "instance_0000000000000000000002",
        publicCode: "ROOMCODE00002",
      }),
    /UNIQUE constraint failed/,
  );

  seedParticipants(raw, instanceId);
  assert.equal(
    raw.prepare("SELECT participant_count FROM multiplayer_instances WHERE id = ?").get(instanceId)
      ?.participant_count,
    2,
  );
  assert.throws(
    () =>
      raw
        .prepare(
          `INSERT INTO multiplayer_participants (
             id, instance_id, user_id, role, seat_index, status,
             connection_generation, joined_at, updated_at
           ) VALUES ('participant_third_003', ?, 3, 'PLAYER', 2, 'JOINED', 0, ?, ?)`,
        )
        .run(instanceId, NOW, NOW),
    /not joinable or is full/,
  );

  raw
    .prepare("UPDATE multiplayer_instances SET status = 'LOBBY', updated_at = ? WHERE id = ?")
    .run(LATER, instanceId);
  assert.throws(
    () =>
      raw
        .prepare(
          "UPDATE multiplayer_participants SET status = 'READY', updated_at = ? WHERE user_id = 2",
        )
        .run(LATER),
    /CHECK constraint failed/,
  );
  raw
    .prepare(
      "UPDATE multiplayer_participants SET status = 'READY', ready_at = ?, updated_at = ? WHERE user_id = 2",
    )
    .run(LATER, LATER);
  assert.throws(
    () =>
      raw
        .prepare(
          "UPDATE multiplayer_instances SET visibility = 'PUBLIC', updated_at = ? WHERE id = ?",
        )
        .run(LATER, instanceId),
    /visibility is not approved/,
  );
  assert.throws(
    () =>
      raw
        .prepare("UPDATE multiplayer_instances SET generation = 2, updated_at = ? WHERE id = ?")
        .run(LATER, instanceId),
    /status or generation transition|exact pending match/,
  );

  closeCommittedGeneration(raw, instanceId, "lifecycle_match_000000000000001");
  assert.throws(
    () =>
      raw
        .prepare("UPDATE multiplayer_instances SET status = 'LOBBY', updated_at = ? WHERE id = ?")
        .run(LATER, instanceId),
    /status or generation transition/,
  );
  raw
    .prepare(
      "UPDATE multiplayer_instances SET status = 'LOBBY', generation = 2, updated_at = ? WHERE id = ?",
    )
    .run(LATER, instanceId);
  assert.deepEqual(
    {
      ...raw
        .prepare(
          "SELECT status, generation, participant_count FROM multiplayer_instances WHERE id = ?",
        )
        .get(instanceId),
    },
    { status: "LOBBY", generation: 2, participant_count: 2 },
  );
});

test("0041 makes actions, final results, rewards, and identity remaps idempotent", () => {
  const raw = createMigratedDatabase();
  seedUsers(raw);
  seedGameVersion(raw, { gameId: 1, versionId: 10, slug: "relay-demo" });
  seedProfile(raw, {
    profileId: 100,
    gameId: 1,
    versionId: 10,
    rewardPolicyId: "relay:historical-match-v1",
  });
  const instanceId = seedInstance(raw);
  seedParticipants(raw, instanceId);
  raw
    .prepare("UPDATE multiplayer_instances SET status = 'LOBBY', updated_at = ? WHERE id = ?")
    .run(LATER, instanceId);
  raw
    .prepare(
      `UPDATE multiplayer_participants
       SET status = 'READY', ready_at = ?, updated_at = ?
       WHERE instance_id = ? AND status = 'JOINED'`,
    )
    .run(LATER, LATER, instanceId);
  raw
    .prepare("UPDATE multiplayer_instances SET status = 'STARTING', updated_at = ? WHERE id = ?")
    .run(LATER, instanceId);
  raw
    .prepare(
      `INSERT INTO multiplayer_matches (
         id, instance_id, generation, game_id, game_version_id, profile_id,
         profile_revision, status, state_revision, created_at, updated_at
       ) VALUES (
         'match_000000000000000000000001', ?, 1, 1, 10, 100,
         1, 'PENDING', 0, ?, ?
       )`,
    )
    .run(instanceId, NOW, NOW);
  raw
    .prepare(
      `INSERT INTO multiplayer_match_players (
         match_id, user_id, participant_id, result_status, reward_eligible, created_at
       ) VALUES
         ('match_000000000000000000000001', 1, 'participant_host_0001', 'PENDING', 0, ?),
         ('match_000000000000000000000001', 2, 'participant_player_02', 'PENDING', 0, ?)`,
    )
    .run(NOW, NOW);
  raw
    .prepare("UPDATE multiplayer_instances SET status = 'ACTIVE', updated_at = ? WHERE id = ?")
    .run(LATER, instanceId);
  raw
    .prepare(
      "UPDATE multiplayer_matches SET status = 'ACTIVE', started_at = ?, updated_at = ? WHERE id = 'match_000000000000000000000001'",
    )
    .run(LATER, LATER);
  raw
    .prepare(
      "UPDATE multiplayer_matches SET state_revision = 1, updated_at = ? WHERE id = 'match_000000000000000000000001'",
    )
    .run(LATER);

  const insertAction = () =>
    raw
      .prepare(
        `INSERT INTO multiplayer_match_actions (
           match_id, user_id, participant_id, client_seq, server_seq,
           client_action_id, payload_hash, expected_revision, result_revision,
           result_code, response_json, created_at
         ) VALUES (
           'match_000000000000000000000001', 1, 'participant_host_0001', 1, 1,
           'action_0000000001', ?, 0, 1, 'ACCEPTED', '{"accepted":true}', ?
         )`,
      )
      .run(PAYLOAD_HASH, NOW);
  insertAction();
  assert.throws(insertAction, /UNIQUE constraint failed/);
  assert.throws(
    () =>
      raw
        .prepare(
          `UPDATE multiplayer_match_actions SET response_json = '{"accepted":false}' WHERE id = 1`,
        )
        .run(),
    /action ledger is immutable/,
  );
  assert.throws(
    () =>
      raw
        .prepare(
          `UPDATE multiplayer_match_players
           SET result_status = 'COMMITTED', outcome = 'WIN', placement = 1,
               result_json = '{"outcome":"WIN"}', reward_eligible = 1, committed_at = ?
           WHERE match_id = 'match_000000000000000000000001' AND user_id = 1`,
        )
        .run(LATER),
    /requires a finalizing match/,
  );

  raw
    .prepare(
      `UPDATE multiplayer_matches
       SET status = 'FINALIZING', state_revision = 1,
           terminal_result_json = '{"winnerParticipantId":"participant_host_0001"}',
           terminal_result_hash = ?, finalizing_at = ?, updated_at = ?
       WHERE id = 'match_000000000000000000000001'`,
    )
    .run(TERMINAL_HASH, LATER, LATER);
  raw
    .prepare(
      `UPDATE multiplayer_match_players
       SET result_status = 'COMMITTED', outcome = 'WIN', placement = 1,
           result_json = '{"outcome":"WIN"}', reward_eligible = 1, committed_at = ?
       WHERE match_id = 'match_000000000000000000000001' AND user_id = 1`,
    )
    .run(LATER);
  assert.throws(
    () =>
      raw
        .prepare(
          "UPDATE multiplayer_matches SET status = 'COMMITTED', committed_at = ?, updated_at = ? WHERE id = 'match_000000000000000000000001'",
        )
        .run(LATER, LATER),
    /requires every player result/,
  );
  raw
    .prepare(
      `UPDATE multiplayer_match_players
       SET result_status = 'COMMITTED', outcome = 'LOSS', placement = 2,
           result_json = '{"outcome":"LOSS"}', reward_eligible = 0, committed_at = ?
       WHERE match_id = 'match_000000000000000000000001' AND user_id = 2`,
    )
    .run(LATER);

  const insertReward = () =>
    raw
      .prepare(
        `INSERT INTO multiplayer_reward_outbox (
           source_id, match_id, user_id, game_id, reward_policy_id,
           reward_payload_json, status, attempt_count, available_at, created_at, updated_at
         ) VALUES (
           'match_000000000000000000000001:1',
           'match_000000000000000000000001', 1, 1, 'relay:historical-match-v1',
           '{"xp":10}', 'PENDING', 0, ?, ?, ?
         )`,
      )
      .run(LATER, LATER, LATER);
  insertReward();
  assert.throws(insertReward, /UNIQUE constraint failed/);
  raw
    .prepare(
      "UPDATE multiplayer_matches SET status = 'COMMITTED', committed_at = ?, updated_at = ? WHERE id = 'match_000000000000000000000001'",
    )
    .run(LATER, LATER);

  raw
    .prepare(
      "UPDATE multiplayer_participants SET user_id = 3, updated_at = ? WHERE id = 'participant_host_0001'",
    )
    .run(LATER);
  assert.deepEqual(
    {
      playerUserId: raw
        .prepare(
          "SELECT user_id FROM multiplayer_match_players WHERE participant_id = 'participant_host_0001'",
        )
        .get()?.user_id,
      actionUserId: raw
        .prepare(
          "SELECT user_id FROM multiplayer_match_actions WHERE client_action_id = 'action_0000000001'",
        )
        .get()?.user_id,
      rewardUserId: raw
        .prepare("SELECT user_id FROM multiplayer_reward_outbox WHERE source_id LIKE 'match_%:1'")
        .get()?.user_id,
    },
    { playerUserId: 3, actionUserId: 3, rewardUserId: 3 },
  );
  assert.throws(
    () =>
      raw
        .prepare(
          "UPDATE multiplayer_match_players SET outcome = 'LOSS' WHERE participant_id = 'participant_host_0001'",
        )
        .run(),
    /result is immutable/,
  );
});

test("0041 blocks exact-version deletion until its active instance lease ends", () => {
  const raw = createMigratedDatabase();
  seedUsers(raw);
  seedGameVersion(raw, { gameId: 1, versionId: 10, slug: "relay-demo" });
  seedProfile(raw, { profileId: 100, gameId: 1, versionId: 10 });
  const instanceId = seedInstance(raw);
  raw
    .prepare(
      `INSERT INTO game_version_leases (
         game_version_id, instance_id, generation, status,
         acquired_at, expires_at, updated_at
       ) VALUES (10, ?, 1, 'ACTIVE', ?, ?, ?)`,
    )
    .run(instanceId, NOW, EXPIRES, NOW);
  raw.prepare("UPDATE games SET live_version_id = NULL, updated_at = ? WHERE id = 1").run(LATER);

  assert.throws(
    () => raw.prepare("DELETE FROM game_versions WHERE id = 10").run(),
    /active multiplayer lease/,
  );
  raw
    .prepare(
      `UPDATE multiplayer_instances
       SET status = 'ABORTED', closed_at = ?, abort_code = 'ADMIN_KILLED', updated_at = ?
       WHERE id = ?`,
    )
    .run(LATER, LATER, instanceId);
  assert.deepEqual(
    {
      ...raw
        .prepare(
          "SELECT status, ended_at, end_reason_code FROM game_version_leases WHERE instance_id = ?",
        )
        .get(instanceId),
    },
    { status: "KILLED", ended_at: LATER, end_reason_code: "ADMIN_KILLED" },
  );
  raw.prepare("DELETE FROM game_versions WHERE id = 10").run();
  assert.equal(raw.prepare("SELECT 1 FROM game_versions WHERE id = 10").get(), undefined);
  assert.equal(
    raw.prepare("SELECT 1 FROM multiplayer_instances WHERE id = ?").get(instanceId),
    undefined,
  );
});

test("0041 admin kill atomically aborts live match state, revokes invites, and kills the lease", () => {
  const raw = createMigratedDatabase();
  seedUsers(raw);
  seedGameVersion(raw, { gameId: 1, versionId: 10, slug: "relay-demo" });
  seedProfile(raw, { profileId: 100, gameId: 1, versionId: 10 });
  const instanceId = seedInstance(raw, { id: "admin_kill_instance_00000000001" });
  seedParticipants(raw, instanceId);
  raw
    .prepare(
      `INSERT INTO multiplayer_invites (
         instance_id, generation, token_hash, created_by_user_id, max_uses,
         used_count, expires_at, created_at, updated_at
       ) VALUES (?, 1, ?, 1, 1, 0, ?, ?, ?)`,
    )
    .run(instanceId, "1".repeat(64), EXPIRES, NOW, NOW);
  raw
    .prepare(
      `INSERT INTO game_version_leases (
         game_version_id, instance_id, generation, status,
         acquired_at, expires_at, updated_at
       ) VALUES (10, ?, 1, 'ACTIVE', ?, ?, ?)`,
    )
    .run(instanceId, NOW, EXPIRES, NOW);
  raw
    .prepare("UPDATE multiplayer_instances SET status = 'LOBBY', updated_at = ? WHERE id = ?")
    .run(LATER, instanceId);
  raw
    .prepare(
      `UPDATE multiplayer_participants
       SET status = 'READY', ready_at = ?, updated_at = ?
       WHERE instance_id = ?`,
    )
    .run(LATER, LATER, instanceId);
  raw
    .prepare("UPDATE multiplayer_instances SET status = 'STARTING', updated_at = ? WHERE id = ?")
    .run(LATER, instanceId);
  const matchId = "admin_kill_match_000000000000001";
  raw
    .prepare(
      `INSERT INTO multiplayer_matches (
         id, instance_id, generation, game_id, game_version_id, profile_id,
         profile_revision, status, state_revision, created_at, updated_at
       ) VALUES (?, ?, 1, 1, 10, 100, 1, 'PENDING', 0, ?, ?)`,
    )
    .run(matchId, instanceId, NOW, NOW);
  raw
    .prepare(
      `INSERT INTO multiplayer_match_players (
         match_id, user_id, participant_id, result_status, reward_eligible, created_at
       )
       SELECT ?, user_id, id, 'PENDING', 0, ?
       FROM multiplayer_participants WHERE instance_id = ?`,
    )
    .run(matchId, NOW, instanceId);
  raw
    .prepare("UPDATE multiplayer_instances SET status = 'ACTIVE', updated_at = ? WHERE id = ?")
    .run(LATER, instanceId);
  raw
    .prepare("UPDATE multiplayer_matches SET state_revision = 1, updated_at = ? WHERE id = ?")
    .run(LATER, matchId);
  raw
    .prepare(
      `INSERT INTO multiplayer_match_actions (
         match_id, user_id, participant_id, client_seq, server_seq,
         client_action_id, payload_hash, expected_revision, result_revision,
         result_code, response_json, created_at
       ) VALUES (?, 1, 'participant_host_0001', 1, 1,
                 'admin_kill_action_0001', ?, 0, 1,
                 'ACCEPTED', '{"accepted":true}', ?)`,
    )
    .run(matchId, "2".repeat(64), LATER);

  raw
    .prepare(
      `UPDATE multiplayer_instances
       SET status = 'ABORTED', closed_at = ?, abort_code = 'ADMIN_KILLED', updated_at = ?
       WHERE id = ?`,
    )
    .run(EXPIRES, EXPIRES, instanceId);

  assert.deepEqual(
    {
      matchStatus: raw.prepare("SELECT status FROM multiplayer_matches WHERE id = ?").get(matchId)
        ?.status,
      pendingPlayers: raw
        .prepare(
          "SELECT COUNT(*) AS count FROM multiplayer_match_players WHERE match_id = ? AND result_status <> 'ABORTED'",
        )
        .get(matchId)?.count,
      inviteRevokedAt: raw
        .prepare("SELECT revoked_at FROM multiplayer_invites WHERE instance_id = ?")
        .get(instanceId)?.revoked_at,
      leaseStatus: raw
        .prepare("SELECT status FROM game_version_leases WHERE instance_id = ?")
        .get(instanceId)?.status,
      actionCount: raw
        .prepare("SELECT COUNT(*) AS count FROM multiplayer_match_actions WHERE match_id = ?")
        .get(matchId)?.count,
    },
    {
      matchStatus: "ABORTED",
      pendingPlayers: 0,
      inviteRevokedAt: EXPIRES,
      leaseStatus: "KILLED",
      actionCount: 1,
    },
  );
  assert.deepEqual(raw.prepare("PRAGMA foreign_key_check").all(), []);
});

test("D1 lease sweep expires an ACTIVE match and performs terminal cleanup exactly once", async () => {
  const { db, raw } = createMigratedD1();
  seedUsers(raw);
  seedGameVersion(raw, { gameId: 1, versionId: 10, slug: "expiring-relay-demo" });
  seedProfile(raw, { profileId: 100, gameId: 1, versionId: 10 });
  const instanceId = seedInstance(raw, { id: "lease_expiry_instance_0000000001" });
  seedParticipants(raw, instanceId);
  raw
    .prepare(
      `INSERT INTO game_version_leases (
         game_version_id, instance_id, generation, status,
         acquired_at, expires_at, updated_at
       ) VALUES (10, ?, 1, 'ACTIVE', ?, ?, ?)`,
    )
    .run(instanceId, NOW, EXPIRES, NOW);
  raw
    .prepare(
      `INSERT INTO multiplayer_invites (
         instance_id, generation, token_hash, created_by_user_id, max_uses,
         used_count, expires_at, created_at, updated_at
       ) VALUES (?, 1, ?, 1, 1, 0, ?, ?, ?)`,
    )
    .run(instanceId, "9".repeat(64), EXPIRES, NOW, NOW);
  raw
    .prepare("UPDATE multiplayer_instances SET status = 'LOBBY', updated_at = ? WHERE id = ?")
    .run(LATER, instanceId);
  raw
    .prepare(
      `UPDATE multiplayer_participants
       SET status = 'READY', ready_at = ?, updated_at = ?
       WHERE instance_id = ?`,
    )
    .run(LATER, LATER, instanceId);
  raw
    .prepare("UPDATE multiplayer_instances SET status = 'STARTING', updated_at = ? WHERE id = ?")
    .run(LATER, instanceId);
  const matchId = "lease_expiry_match_00000000000001";
  raw
    .prepare(
      `INSERT INTO multiplayer_matches (
         id, instance_id, generation, game_id, game_version_id, profile_id,
         profile_revision, status, state_revision, created_at, updated_at
       ) VALUES (?, ?, 1, 1, 10, 100, 1, 'PENDING', 0, ?, ?)`,
    )
    .run(matchId, instanceId, NOW, NOW);
  raw
    .prepare(
      `INSERT INTO multiplayer_match_players (
         match_id, user_id, participant_id, result_status, reward_eligible, created_at
       )
       SELECT ?, user_id, id, 'PENDING', 0, ?
       FROM multiplayer_participants WHERE instance_id = ?`,
    )
    .run(matchId, NOW, instanceId);
  raw
    .prepare("UPDATE multiplayer_instances SET status = 'ACTIVE', updated_at = ? WHERE id = ?")
    .run(LATER, instanceId);

  const repository = new D1MultiplayerInstanceRepository(db);
  assert.deepEqual(await repository.expireDueInstances(EXPIRES, 10), [instanceId]);
  assert.deepEqual(await repository.expireDueInstances(EXPIRES, 10), []);
  assert.deepEqual(
    {
      instance: {
        ...raw
          .prepare("SELECT status, closed_at, abort_code FROM multiplayer_instances WHERE id = ?")
          .get(instanceId),
      },
      matchStatus: raw.prepare("SELECT status FROM multiplayer_matches WHERE id = ?").get(matchId)
        ?.status,
      pendingPlayers: raw
        .prepare(
          "SELECT COUNT(*) AS count FROM multiplayer_match_players WHERE match_id = ? AND result_status = 'PENDING'",
        )
        .get(matchId)?.count,
      inviteRevokedAt: raw
        .prepare("SELECT revoked_at FROM multiplayer_invites WHERE instance_id = ?")
        .get(instanceId)?.revoked_at,
      lease: {
        ...raw
          .prepare(
            "SELECT status, ended_at, end_reason_code FROM game_version_leases WHERE instance_id = ?",
          )
          .get(instanceId),
      },
    },
    {
      instance: { status: "EXPIRED", closed_at: EXPIRES, abort_code: null },
      matchStatus: "ABORTED",
      pendingPlayers: 0,
      inviteRevokedAt: EXPIRES,
      lease: {
        status: "EXPIRED",
        ended_at: EXPIRES,
        end_reason_code: "LEASE_EXPIRED",
      },
    },
  );
  assert.deepEqual(raw.prepare("PRAGMA foreign_key_check").all(), []);
});

test("D1 admin kill CAS is idempotent, audited, and closes the exact-version lease", async () => {
  const { db, raw } = createMigratedD1();
  seedUsers(raw);
  seedAdmin(raw);
  seedGameVersion(raw, { gameId: 1, versionId: 10, slug: "admin-cas-relay-demo" });
  seedProfile(raw, { profileId: 100, gameId: 1, versionId: 10 });
  const instanceId = seedInstance(raw, { id: "admin_cas_instance_0000000000001" });
  seedParticipants(raw, instanceId);
  raw
    .prepare(
      `INSERT INTO game_version_leases (
         game_version_id, instance_id, generation, status,
         acquired_at, expires_at, updated_at
       ) VALUES (10, ?, 1, 'ACTIVE', ?, ?, ?)`,
    )
    .run(instanceId, NOW, EXPIRES, NOW);
  const repository = new D1MultiplayerInstanceRepository(db);
  const input = {
    operationId: "admin_kill_operation_00000001",
    instanceId,
    expectedGeneration: 1,
    adminAccountId: 1,
    reasonCode: "SECURITY_INCIDENT",
    nowIso: LATER,
  } as const;

  const killed = await repository.adminKill(input);
  assert.equal(killed.status, "KILLED");
  assert.equal(killed.status === "KILLED" ? killed.instance.abortCode : null, "ADMIN_KILLED");
  assert.equal(killed.status === "KILLED" ? killed.action.previousStatus : null, "CREATED");
  assert.equal((await repository.adminKill(input)).status, "REPLAYED");
  assert.equal(
    (await repository.adminKill({ ...input, reasonCode: "POLICY_VIOLATION" })).status,
    "CONFLICT",
  );
  assert.deepEqual(
    {
      ...raw
        .prepare(
          "SELECT status, ended_at, end_reason_code FROM game_version_leases WHERE instance_id = ?",
        )
        .get(instanceId),
    },
    { status: "KILLED", ended_at: LATER, end_reason_code: "ADMIN_KILLED" },
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) AS count FROM multiplayer_instance_admin_actions").get()?.count,
    1,
  );
  assert.throws(
    () =>
      raw
        .prepare(
          "UPDATE multiplayer_instance_admin_actions SET reason_code = 'CHANGED' WHERE operation_id = ?",
        )
        .run(input.operationId),
    /append-only/,
  );
  assert.throws(
    () =>
      raw
        .prepare("DELETE FROM multiplayer_instance_admin_actions WHERE operation_id = ?")
        .run(input.operationId),
    /append-only/,
  );
  assert.deepEqual(raw.prepare("PRAGMA foreign_key_check").all(), []);
});

test("0041 accepts a USER profile only from its owner-approved exact-version request", () => {
  const raw = createMigratedDatabase();
  seedUsers(raw);
  seedGameVersion(raw, {
    gameId: 1,
    versionId: 10,
    slug: "creator-relay-board",
    publisherType: "USER",
    publisherUserId: 1,
    moderationStatus: "APPROVED",
  });

  const insertRequest = (requesterUserId: number) =>
    raw
      .prepare(
        `INSERT INTO multiplayer_profile_requests (
           id, game_id, game_version_id, content_hash, request_schema_version, request_hash,
           request_json, requested_by_user_id, status, created_at, updated_at
         ) VALUES (
           1, 1, 10, ?, 1, ?, '{"template":"turn-grid"}', ?,
           'PENDING_REVIEW', ?, ?
         )`,
      )
      .run(CONTENT_HASH, REQUEST_HASH, requesterUserId, NOW, NOW);
  assert.throws(() => insertRequest(2), /submitted by the game owner/);
  insertRequest(1);
  assert.throws(
    () =>
      seedProfile(raw, {
        profileId: 100,
        gameId: 1,
        versionId: 10,
        sourceRequestId: 1,
        sourceRequestHash: REQUEST_HASH,
      }),
    /approved exact-version request and content hash/,
  );

  raw
    .prepare(
      `INSERT INTO admin_accounts (
         id, user_id, google_sub, username, password_hash, role, status,
         must_change_password, created_at, updated_at, password_changed_at
       ) VALUES (
         1, 4, 'google-admin-4', 'admin4', 'hash', 'ADMIN', 'ACTIVE',
         0, ?, ?, ?
       )`,
    )
    .run(NOW, NOW, NOW);
  raw
    .prepare(
      `UPDATE multiplayer_profile_requests
       SET status = 'APPROVED', reviewed_by_admin_id = 1, reviewed_at = ?, updated_at = ?
       WHERE id = 1`,
    )
    .run(LATER, LATER);
  assert.throws(
    () =>
      seedProfile(raw, {
        profileId: 100,
        gameId: 1,
        versionId: 10,
        sourceRequestId: 1,
        sourceRequestHash: "f".repeat(64),
      }),
    /approved exact-version request and content hash/,
  );
  seedProfile(raw, {
    profileId: 100,
    gameId: 1,
    versionId: 10,
    sourceRequestId: 1,
    sourceRequestHash: REQUEST_HASH,
  });
  assert.equal(
    raw.prepare("SELECT enabled FROM multiplayer_profiles WHERE id = 100").get()?.enabled,
    1,
  );
  assert.deepEqual(
    raw.prepare("PRAGMA foreign_key_check").all(),
    [],
    "the multiplayer foundation must leave no relational ownership drift",
  );
});

test("D1 multiplayer profile repository maps trusted rows and fails closed", async () => {
  const { db, raw } = createMigratedD1();
  seedUsers(raw);
  seedAdmin(raw);
  seedGameVersion(raw, { gameId: 1, versionId: 10, slug: "relay-demo" });
  seedProfile(raw, { profileId: 100, gameId: 1, versionId: 10 });
  const repository = new D1MultiplayerProfileRepository(db);

  const record = await repository.findEnabledForExactVersion(1, 10);
  assert.ok(record);
  assert.equal(record.id, 100);
  assert.equal("runtimeKind" in record.profile ? record.profile.runtimeKind : null, "relay");
  assert.equal("contentHash" in record.profile ? record.profile.contentHash : null, CONTENT_HASH);
  assert.deepEqual(record.profile.allowedVisibility, ["PRIVATE"]);
  assert.equal(await repository.findEnabledForExactVersion(2, 10), null);
  assert.equal(await repository.findEnabledForExactVersion(1, 999), null);

  raw
    .prepare(
      "UPDATE multiplayer_profiles SET enabled = 0, disabled_at = ?, disabled_reason_code = 'ADMIN_DISABLED', disabled_by_admin_id = 1, updated_at = ? WHERE id = 100",
    )
    .run(LATER, LATER);
  assert.equal(await repository.findEnabledForExactVersion(1, 10), null);
  assert.equal((await repository.findById(100))?.profile.enabled, false);
  assert.equal(await repository.findById(999), null);

  const stored = raw.prepare("SELECT * FROM multiplayer_profiles WHERE id = 100").get() as Record<
    string,
    unknown
  >;
  assert.throws(() => mapMultiplayerProfileRow({ ...stored, enabled: 2 }), /Invalid enabled/);
  assert.throws(
    () =>
      mapMultiplayerProfileRow({
        ...stored,
        allowed_visibility_json: '["PRIVATE","CREDENTIALS"]',
      }),
    /allowedVisibility must be \[PRIVATE\]/,
  );
  assert.throws(
    () => mapMultiplayerProfileRow({ ...stored, source_request_hash: undefined }),
    /sourceRequestHash must be a lowercase SHA-256/,
  );
});

test("D1 multiplayer profile activation ignores index-inclusive rows_written billing counts", async () => {
  const { db, raw } = createMigratedD1(INDEX_INCLUSIVE_D1_WRITE_META);
  seedUsers(raw);
  seedAdmin(raw);
  seedGameVersion(raw, { gameId: 1, versionId: 10, slug: "relay-demo" });
  seedProfile(raw, {
    profileId: 100,
    gameId: 1,
    versionId: 10,
    enabled: false,
  });
  const repository = new D1MultiplayerProfileRepository(db);

  const activated = await repository.setEnabled({
    profileId: 100,
    enabled: true,
    changedByAdminId: 1,
    reasonCode: null,
    nowIso: LATER,
  });

  assert.equal(activated.status, "UPDATED");
  assert.equal(activated.record.profile.enabled, true);
  assert.equal((await repository.findEnabledForExactVersion(1, 10))?.id, 100);
});

test("D1 multiplayer request repository pins owner, canonical hash, review CAS, and withdrawal", async () => {
  const { db, raw } = createMigratedD1(INDEX_INCLUSIVE_D1_WRITE_META);
  seedUsers(raw);
  seedAdmin(raw);
  seedGameVersion(raw, {
    gameId: 1,
    versionId: 10,
    slug: "creator-turn-grid",
    publisherType: "USER",
    publisherUserId: 1,
    moderationStatus: "APPROVED",
  });
  seedGameVersion(raw, {
    gameId: 2,
    versionId: 20,
    slug: "creator-turn-grid-withdrawn",
    publisherType: "USER",
    publisherUserId: 1,
    moderationStatus: "APPROVED",
  });
  seedGameVersion(raw, {
    gameId: 3,
    versionId: 30,
    slug: "creator-turn-grid-rejected",
    publisherType: "USER",
    publisherUserId: 1,
    moderationStatus: "APPROVED",
  });
  const repository = new D1MultiplayerProfileRequestRepository(db);
  const request = relayRequest();
  const input = {
    gameId: 1,
    gameVersionId: 10,
    contentHash: CONTENT_HASH,
    requestedByUserId: 1,
    request,
    nowIso: NOW,
  } as const;

  assert.deepEqual(await repository.submit({ ...input, requestedByUserId: 2 }), {
    status: "REJECTED",
    code: "REQUESTER_NOT_OWNER",
  });
  assert.deepEqual(await repository.submit({ ...input, gameVersionId: 999 }), {
    status: "REJECTED",
    code: "GAME_VERSION_NOT_FOUND",
  });
  const created = await repository.submit(input);
  assert.equal(created.status, "CREATED");
  assert.ok(created.status === "CREATED");
  assert.equal(created.record.status, "PENDING_REVIEW");
  assert.equal(created.record.requestedByUserId, 1);
  assert.equal(created.record.contentHash, CONTENT_HASH);
  assert.match(created.record.requestHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(JSON.parse(created.record.requestJson), {
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
  assert.equal((await repository.submit(input)).status, "REPLAYED");
  assert.deepEqual(await repository.submit({ ...input, request: relayRequest(7) }), {
    status: "REJECTED",
    code: "REQUEST_CONFLICT",
  });
  assert.deepEqual(
    (await repository.listPending(10)).map((item) => item.gameVersionId),
    [10],
  );

  await assert.rejects(
    () =>
      repository.review({
        requestId: created.record.id,
        decision: "REJECTED",
        reviewedByAdminId: 1,
        decisionReasonCode: null,
        nowIso: LATER,
      }),
    /stable uppercase code/,
  );
  const approvalInput = {
    requestId: created.record.id,
    decision: "APPROVED",
    reviewedByAdminId: 1,
    decisionReasonCode: null,
    nowIso: LATER,
  } as const;
  const approved = await repository.review(approvalInput);
  assert.equal(approved.status, "UPDATED");
  assert.equal((await repository.review(approvalInput)).status, "REPLAYED");
  const conflictingDecision = await repository.review({
    ...approvalInput,
    decision: "REJECTED",
    decisionReasonCode: "UNSUPPORTED_RULESET",
  });
  assert.equal(conflictingDecision.status, "CONFLICT");
  assert.equal((await repository.listPending(10)).length, 0);

  const profiles = new D1MultiplayerProfileRepository(db);
  const relayProfile = {
    profileVersion: 1,
    gameId: 1,
    gameVersionId: 10,
    contentHash: CONTENT_HASH,
    sourceRequestHash: created.record.requestHash,
    profileRevision: 1,
    transportKind: "websocket",
    runtimeKind: "relay",
    protocolVersion: 1,
    lifecycle: "match",
    reconnectPolicy: "resume",
    directMessages: true,
    hostSnapshot: true,
    minPlayers: 2,
    maxPlayers: 8,
    allowedVisibility: ["PRIVATE"],
    allowedJoinPolicies: ["OPEN"],
    hostDeparturePolicy: "close",
    resultTrust: "UNVERIFIED",
    maxMessageBytes: 4096,
    maxSnapshotBytes: 16_384,
    messagesPerSecond: 20,
    roomBytesPerSecond: 256 * 1024,
    roomTtlSeconds: 2 * 60 * 60,
    enabled: false,
  } as const;
  const createdProfile = await profiles.createApprovedRevision({
    sourceRequestId: created.record.id,
    profile: relayProfile,
    createdByAdminId: 1,
    nowIso: LATER,
  });
  assert.equal(createdProfile.status, "CREATED");
  assert.ok(createdProfile.status === "CREATED");
  assert.equal(createdProfile.record.profile.enabled, false);
  assert.deepEqual(
    (await profiles.listManaged(10)).map((record) => record.id),
    [createdProfile.record.id],
  );
  const activatedProfile = await profiles.setEnabled({
    profileId: createdProfile.record.id,
    enabled: true,
    changedByAdminId: 1,
    reasonCode: null,
    nowIso: LATER,
  });
  assert.equal(activatedProfile.status, "UPDATED");
  assert.equal((await profiles.findEnabledForExactVersion(1, 10))?.id, createdProfile.record.id);
  const stored = raw
    .prepare("SELECT * FROM multiplayer_profile_requests WHERE id = ?")
    .get(created.record.id) as Record<string, unknown>;
  await assert.rejects(
    () => mapMultiplayerProfileRequestRow({ ...stored, request_hash: "f".repeat(64) }),
    /request_hash does not match/,
  );
  await assert.rejects(
    () =>
      mapMultiplayerProfileRequestRow({
        ...stored,
        request_json: "{\n" + stored.request_json + "\n}",
      }),
    /Invalid request_json JSON|INVALID_MULTIPLAYER_PROFILE_REQUEST|Non-canonical/,
  );

  const withdrawCreated = await repository.submit({
    ...input,
    gameId: 2,
    gameVersionId: 20,
  });
  assert.ok(withdrawCreated.status === "CREATED");
  assert.equal(
    (await repository.withdraw(withdrawCreated.record.id, 2, LATER)).status,
    "NOT_FOUND_OR_NOT_OWNER",
  );
  assert.equal((await repository.withdraw(withdrawCreated.record.id, 1, LATER)).status, "UPDATED");
  assert.equal((await repository.withdraw(withdrawCreated.record.id, 1, LATER)).status, "REPLAYED");

  const rejectedCreated = await repository.submit({
    ...input,
    gameId: 3,
    gameVersionId: 30,
  });
  assert.ok(rejectedCreated.status === "CREATED");
  const rejected = await repository.review({
    requestId: rejectedCreated.record.id,
    decision: "REJECTED",
    reviewedByAdminId: 1,
    decisionReasonCode: "UNSUPPORTED_RULESET",
    nowIso: LATER,
  });
  assert.equal(rejected.status, "UPDATED");
  assert.equal(
    rejected.status === "UPDATED" ? rejected.record.decisionReasonCode : null,
    "UNSUPPORTED_RULESET",
  );
  assert.deepEqual(raw.prepare("PRAGMA foreign_key_check").all(), []);
});

test("OWOGG Relay requests use the same exact-version boundary without claiming a user", async () => {
  const { db, raw } = createMigratedD1(INDEX_INCLUSIVE_D1_WRITE_META);
  seedUsers(raw);
  seedAdmin(raw);
  seedGameVersion(raw, { gameId: 1, versionId: 10, slug: "official-relay-game" });
  const requests = new D1MultiplayerProfileRequestRepository(db);
  const request = relayRequest();

  assert.deepEqual(
    await requests.submit({
      gameId: 1,
      gameVersionId: 10,
      contentHash: CONTENT_HASH,
      requestedByUserId: 1,
      request,
      nowIso: NOW,
    }),
    { status: "REJECTED", code: "REQUESTER_NOT_OWNER" },
  );
  const submitted = await requests.submit({
    gameId: 1,
    gameVersionId: 10,
    contentHash: CONTENT_HASH,
    requestedByUserId: null,
    request,
    nowIso: NOW,
  });
  assert.ok(submitted.status === "CREATED");
  assert.equal(submitted.record.requestedByUserId, null);
  assert.equal(submitted.record.request.runtime.kind, "relay");
  assert.deepEqual(raw.prepare("PRAGMA foreign_key_check").all(), []);
});
test("D1 multiplayer instance repository atomically creates, replays, conflicts, and CAS-transitions", async () => {
  const { db, raw } = createMigratedD1(INDEX_INCLUSIVE_D1_WRITE_META);
  seedUsers(raw);
  seedAdmin(raw);
  seedGameVersion(raw, { gameId: 1, versionId: 10, slug: "relay-demo" });
  seedProfile(raw, { profileId: 100, gameId: 1, versionId: 10 });
  const repository = new D1MultiplayerInstanceRepository(db);
  const input = {
    instanceId: "instance_repository_000000000001",
    publicCode: "REPOCODE00001",
    createdByUserId: 1,
    createIdempotencyHash: "e".repeat(64),
    gameId: 1,
    gameVersionId: 10,
    contentHash: CONTENT_HASH,
    profileId: 100,
    profileRevision: 1,
    visibility: "PRIVATE" as const,
    joinPolicy: "OPEN" as const,
    lifecycle: "match" as const,
    maxPlayers: 2,
    instanceExpiresAt: EXPIRES,
    hostParticipantId: "repository_host_0001",
    leaseExpiresAt: EXPIRES,
    nowIso: NOW,
  };

  const created = await repository.createWithHostAndLease(input);
  assert.equal(created.status, "CREATED");
  assert.ok("instance" in created);
  assert.equal(created.instance.participantCount, 1);
  assert.equal(created.host.role, "HOST");
  assert.equal(created.lease.status, "ACTIVE");
  assert.equal((await repository.findByPublicCode(input.publicCode))?.id, input.instanceId);
  assert.equal((await repository.listParticipants(input.instanceId)).length, 1);

  raw
    .prepare(
      "UPDATE multiplayer_profiles SET enabled = 0, disabled_at = ?, disabled_reason_code = 'ADMIN_DISABLED', disabled_by_admin_id = 1, updated_at = ? WHERE id = 100",
    )
    .run(LATER, LATER);
  const replay = await repository.createWithHostAndLease({
    ...input,
    instanceId: "new_generated_id_ignored_0000001",
    publicCode: "NEWCODE000001",
    hostParticipantId: "new_host_id_ignored",
    instanceExpiresAt: new Date(Date.parse(EXPIRES) + 60_000).toISOString(),
    leaseExpiresAt: new Date(Date.parse(EXPIRES) + 120_000).toISOString(),
    nowIso: LATER,
  });
  assert.equal(replay.status, "REPLAYED");
  assert.ok("instance" in replay);
  assert.equal(replay.instance.id, input.instanceId);
  assert.equal(replay.instance.expiresAt, EXPIRES);
  assert.equal(replay.lease.expiresAt, EXPIRES);

  const idempotencyConflict = await repository.createWithHostAndLease({
    ...input,
    maxPlayers: 3,
  });
  assert.deepEqual(idempotencyConflict, { status: "IDEMPOTENCY_CONFLICT" });

  raw
    .prepare(
      "UPDATE multiplayer_profiles SET enabled = 1, disabled_at = NULL, disabled_reason_code = NULL, disabled_by_admin_id = NULL, updated_at = ? WHERE id = 100",
    )
    .run(LATER);
  const identifierConflict = await repository.createWithHostAndLease({
    ...input,
    instanceId: "identifier_collision_0000000001",
    publicCode: input.publicCode,
    createIdempotencyHash: "f".repeat(64),
    hostParticipantId: "identifier_host_0001",
  });
  assert.deepEqual(identifierConflict, { status: "IDENTIFIER_CONFLICT" });
  assert.equal(await repository.findById("identifier_collision_0000000001"), null);

  assert.equal(
    await repository.transition({
      instanceId: input.instanceId,
      expectedStatus: "CREATED",
      expectedGeneration: 1,
      nextStatus: "LOBBY",
      nextGeneration: 1,
      closedAt: null,
      abortCode: null,
      nowIso: LATER,
    }),
    true,
  );
  assert.equal(
    await repository.transition({
      instanceId: input.instanceId,
      expectedStatus: "CREATED",
      expectedGeneration: 1,
      nextStatus: "LOBBY",
      nextGeneration: 1,
      closedAt: null,
      abortCode: null,
      nowIso: LATER,
    }),
    false,
  );
  assert.equal(
    await repository.transitionParticipant({
      instanceId: input.instanceId,
      expectedInstanceGeneration: 1,
      expectedInstanceStatus: "CREATED",
      userId: 1,
      expectedStatus: "JOINED",
      nextStatus: "LEFT",
      readyAt: null,
      leftAt: LATER,
      nowIso: LATER,
    }),
    null,
  );
  assert.equal((await repository.findParticipant(input.instanceId, 1))?.status, "JOINED");
  await assert.rejects(
    () =>
      repository.transition({
        instanceId: input.instanceId,
        expectedStatus: "LOBBY",
        expectedGeneration: 1,
        nextStatus: "ACTIVE",
        nextGeneration: 1,
        closedAt: null,
        abortCode: null,
        nowIso: LATER,
      }),
    /status or generation transition|exact pending match/,
  );

  const stored = raw
    .prepare("SELECT * FROM multiplayer_instances WHERE id = ?")
    .get(input.instanceId) as Record<string, unknown>;
  assert.throws(() => mapMultiplayerInstanceRow({ ...stored, status: "ROOT" }), /Invalid status/);
});

test("D1 multiplayer instance aggregate rolls back when its host identifier collides", async () => {
  const { db, raw } = createMigratedD1();
  seedUsers(raw);
  seedGameVersion(raw, { gameId: 1, versionId: 10, slug: "relay-demo" });
  seedProfile(raw, { profileId: 100, gameId: 1, versionId: 10 });
  const repository = new D1MultiplayerInstanceRepository(db);
  const base = {
    instanceId: "atomic_instance_000000000000001",
    publicCode: "ATOMICCODE001",
    createdByUserId: 1,
    createIdempotencyHash: "1".repeat(64),
    gameId: 1,
    gameVersionId: 10,
    contentHash: CONTENT_HASH,
    profileId: 100,
    profileRevision: 1,
    visibility: "PRIVATE" as const,
    joinPolicy: "OPEN" as const,
    lifecycle: "match" as const,
    maxPlayers: 2,
    instanceExpiresAt: EXPIRES,
    hostParticipantId: "shared_host_identifier",
    leaseExpiresAt: EXPIRES,
    nowIso: NOW,
  };
  assert.equal((await repository.createWithHostAndLease(base)).status, "CREATED");

  await assert.rejects(() =>
    repository.createWithHostAndLease({
      ...base,
      instanceId: "atomic_instance_000000000000002",
      publicCode: "ATOMICCODE002",
      createdByUserId: 2,
      createIdempotencyHash: "2".repeat(64),
    }),
  );
  assert.equal(await repository.findById("atomic_instance_000000000000002"), null);
  assert.equal(
    raw
      .prepare(
        "SELECT COUNT(*) AS count FROM game_version_leases WHERE instance_id = 'atomic_instance_000000000000002'",
      )
      .get()?.count,
    0,
  );
});

test("D1 generic Relay joins replay seats, advance connections, and enforce capacity", async () => {
  const { db, raw } = createMigratedD1();
  seedUsers(raw);
  seedGameVersion(raw, { gameId: 1, versionId: 10, slug: "relay-demo" });
  seedProfile(raw, { profileId: 100, gameId: 1, versionId: 10 });
  const repository = new D1MultiplayerInstanceRepository(db);
  const openInput = {
    instanceId: "open_instance_0000000000000001",
    publicCode: "OPENCODE00001",
    createdByUserId: 1,
    createIdempotencyHash: "3".repeat(64),
    gameId: 1,
    gameVersionId: 10,
    contentHash: CONTENT_HASH,
    profileId: 100,
    profileRevision: 1,
    visibility: "PRIVATE" as const,
    joinPolicy: "OPEN" as const,
    lifecycle: "match" as const,
    maxPlayers: 2,
    instanceExpiresAt: EXPIRES,
    hostParticipantId: "open_host_00001",
    leaseExpiresAt: EXPIRES,
    nowIso: NOW,
  };
  assert.equal((await repository.createWithHostAndLease(openInput)).status, "CREATED");

  const joined = await repository.join({
    participantId: "open_player_0002",
    instanceId: openInput.instanceId,
    userId: 2,
    expectedGeneration: 1,
    inviteTokenHash: null,
    nowIso: NOW,
  });
  assert.equal(joined.status, "JOINED");
  assert.equal((await repository.findById(openInput.instanceId))?.participantCount, 2);

  const replayedJoin = await repository.join({
    participantId: "ignored_retry_identifier",
    instanceId: openInput.instanceId,
    userId: 2,
    expectedGeneration: 1,
    inviteTokenHash: null,
    nowIso: LATER,
  });
  assert.equal(replayedJoin.status, "REPLAYED");

  assert.deepEqual(
    await repository.join({
      participantId: "open_player_0003",
      instanceId: openInput.instanceId,
      userId: 3,
      expectedGeneration: 1,
      inviteTokenHash: null,
      nowIso: LATER,
    }),
    { status: "REJECTED", code: "INSTANCE_FULL" },
  );

  const readyTooEarly = await repository.transitionParticipant({
    instanceId: openInput.instanceId,
    expectedInstanceGeneration: 1,
    userId: 2,
    expectedStatus: "JOINED",
    nextStatus: "READY",
    readyAt: LATER,
    leftAt: null,
    nowIso: LATER,
  });
  assert.equal(readyTooEarly, null);
  assert.equal(
    await repository.transition({
      instanceId: openInput.instanceId,
      expectedStatus: "CREATED",
      expectedGeneration: 1,
      nextStatus: "LOBBY",
      nextGeneration: 1,
      closedAt: null,
      abortCode: null,
      nowIso: LATER,
    }),
    true,
  );
  assert.equal(
    (
      await repository.transitionParticipant({
        instanceId: openInput.instanceId,
        expectedInstanceGeneration: 1,
        userId: 2,
        expectedStatus: "JOINED",
        nextStatus: "READY",
        readyAt: LATER,
        leftAt: null,
        nowIso: LATER,
      })
    )?.status,
    "READY",
  );
  assert.equal(
    (
      await repository.advanceConnectionGeneration({
        instanceId: openInput.instanceId,
        expectedInstanceGeneration: 1,
        userId: 2,
        expectedConnectionGeneration: 0,
        nowIso: LATER,
      })
    )?.connectionGeneration,
    1,
  );
  assert.equal(
    await repository.advanceConnectionGeneration({
      instanceId: openInput.instanceId,
      expectedInstanceGeneration: 1,
      userId: 2,
      expectedConnectionGeneration: 0,
      nowIso: LATER,
    }),
    null,
  );
  assert.deepEqual(raw.prepare("PRAGMA foreign_key_check").all(), []);
});

test("D1 Relay match shell creates the active participant roster without an action ledger", async () => {
  const { db, raw } = createMigratedD1(INDEX_INCLUSIVE_D1_WRITE_META);
  seedUsers(raw);
  seedGameVersion(raw, { gameId: 1, versionId: 10, slug: "relay-demo" });
  seedProfile(raw, {
    profileId: 100,
    gameId: 1,
    versionId: 10,
    rewardPolicyId: "relay:historical-match-v1",
  });
  const instances = new D1MultiplayerInstanceRepository(db);
  const matches = new D1MultiplayerMatchRepository(db);
  const instanceInput = {
    instanceId: "match_repo_instance_00000000001",
    publicCode: "MATCHREPO0001",
    createdByUserId: 1,
    createIdempotencyHash: "6".repeat(64),
    gameId: 1,
    gameVersionId: 10,
    contentHash: CONTENT_HASH,
    profileId: 100,
    profileRevision: 1,
    visibility: "PRIVATE" as const,
    joinPolicy: "OPEN" as const,
    lifecycle: "match" as const,
    maxPlayers: 2,
    instanceExpiresAt: EXPIRES,
    hostParticipantId: "match_repo_host_0001",
    leaseExpiresAt: EXPIRES,
    nowIso: NOW,
  };
  assert.equal((await instances.createWithHostAndLease(instanceInput)).status, "CREATED");
  assert.equal(
    (
      await instances.join({
        participantId: "match_repo_player_02",
        instanceId: instanceInput.instanceId,
        userId: 2,
        expectedGeneration: 1,
        inviteTokenHash: null,
        nowIso: NOW,
      })
    ).status,
    "JOINED",
  );
  assert.equal(
    await instances.transition({
      instanceId: instanceInput.instanceId,
      expectedStatus: "CREATED",
      expectedGeneration: 1,
      nextStatus: "LOBBY",
      nextGeneration: 1,
      closedAt: null,
      abortCode: null,
      nowIso: LATER,
    }),
    true,
  );
  for (const userId of [1, 2]) {
    assert.equal(
      (
        await instances.transitionParticipant({
          instanceId: instanceInput.instanceId,
          expectedInstanceGeneration: 1,
          userId,
          expectedStatus: "JOINED",
          nextStatus: "READY",
          readyAt: LATER,
          leftAt: null,
          nowIso: LATER,
        })
      )?.status,
      "READY",
    );
  }
  assert.equal(
    await instances.transition({
      instanceId: instanceInput.instanceId,
      expectedStatus: "LOBBY",
      expectedGeneration: 1,
      nextStatus: "STARTING",
      nextGeneration: 1,
      closedAt: null,
      abortCode: null,
      nowIso: LATER,
    }),
    true,
  );

  const matchId = "match_repository_000000000000001";
  const pending = await matches.createPendingWithPlayers({
    matchId,
    instanceId: instanceInput.instanceId,
    expectedGeneration: 1,
    nowIso: LATER,
  });
  assert.equal(pending.status, "CREATED");
  assert.equal("players" in pending ? pending.players.length : 0, 2);
  assert.equal(
    (
      await matches.createPendingWithPlayers({
        matchId,
        instanceId: instanceInput.instanceId,
        expectedGeneration: 1,
        nowIso: LATER,
      })
    ).status,
    "REPLAYED",
  );
  assert.equal(
    await instances.transition({
      instanceId: instanceInput.instanceId,
      expectedStatus: "STARTING",
      expectedGeneration: 1,
      nextStatus: "ACTIVE",
      nextGeneration: 1,
      closedAt: null,
      abortCode: null,
      nowIso: LATER,
    }),
    true,
  );
  assert.equal((await matches.findMatch(matchId))?.status, "ACTIVE");

  const persisted = await matches.findMatch(matchId);
  assert.equal(persisted?.terminalResultJson, null);
  assert.equal(persisted?.terminalResultHash, null);
  assert.equal(
    (
      await raw
        .prepare("SELECT COUNT(*) AS count FROM multiplayer_match_actions WHERE match_id = ?")
        .get(matchId)
    ).count,
    0,
  );
});

test("account merge blocks active multiplayer participation and same-instance identity collapse", async () => {
  const { db, raw } = createMigratedD1();
  seedUsers(raw);
  seedGameVersion(raw, { gameId: 1, versionId: 10, slug: "relay-demo" });
  seedProfile(raw, { profileId: 100, gameId: 1, versionId: 10 });
  const instanceId = seedInstance(raw, { creatorUserId: 2 });
  raw
    .prepare(
      `INSERT INTO multiplayer_participants (
         id, instance_id, user_id, role, seat_index, status,
         connection_generation, joined_at, updated_at
       ) VALUES ('merge_secondary_host', ?, 2, 'HOST', 0, 'JOINED', 0, ?, ?)`,
    )
    .run(instanceId, NOW, NOW);
  const repository = new D1AccountMergeRepository(db);

  assert.equal(
    await repository.findMergeIntegrityConflict(1, 2),
    "MULTIPLAYER_PARTICIPATION_CONFLICT",
  );

  raw
    .prepare(
      `INSERT INTO multiplayer_participants (
         id, instance_id, user_id, role, seat_index, status,
         connection_generation, joined_at, updated_at
       ) VALUES ('merge_primary_history', ?, 1, 'PLAYER', 1, 'JOINED', 0, ?, ?)`,
    )
    .run(instanceId, NOW, NOW);
  raw
    .prepare(
      `UPDATE multiplayer_participants
       SET status = 'LEFT', left_at = ?, updated_at = ?
       WHERE user_id IN (1, 2)`,
    )
    .run(LATER, LATER);
  raw
    .prepare(
      `UPDATE multiplayer_instances
       SET status = 'ABORTED', closed_at = ?, abort_code = 'ADMIN_KILLED', updated_at = ?
       WHERE id = ?`,
    )
    .run(LATER, LATER, instanceId);

  assert.equal(
    await repository.findMergeIntegrityConflict(1, 2),
    "MULTIPLAYER_PARTICIPATION_CONFLICT",
  );
});

test("account merge remaps terminal multiplayer ownership before deleting the secondary user", async () => {
  const { db, raw } = createMigratedD1();
  seedUsers(raw);
  seedGameVersion(raw, { gameId: 1, versionId: 10, slug: "relay-demo" });
  seedProfile(raw, { profileId: 100, gameId: 1, versionId: 10 });
  const instanceId = seedInstance(raw, { creatorUserId: 2 });
  raw
    .prepare(
      `INSERT INTO multiplayer_participants (
         id, instance_id, user_id, role, seat_index, status,
         connection_generation, joined_at, updated_at
       ) VALUES ('merge_terminal_host', ?, 2, 'HOST', 0, 'JOINED', 0, ?, ?)`,
    )
    .run(instanceId, NOW, NOW);
  raw
    .prepare(
      `INSERT INTO multiplayer_invites (
         instance_id, generation, token_hash, created_by_user_id, max_uses, used_count,
         expires_at, created_at, updated_at
       ) VALUES (?, 1, ?, 2, 1, 0, ?, ?, ?)`,
    )
    .run(instanceId, "9".repeat(64), EXPIRES, NOW, NOW);
  raw
    .prepare(
      "UPDATE multiplayer_participants SET status = 'LEFT', left_at = ?, updated_at = ? WHERE user_id = 2",
    )
    .run(LATER, LATER);
  raw
    .prepare(
      `UPDATE multiplayer_instances
       SET status = 'ABORTED', closed_at = ?, abort_code = 'ADMIN_KILLED', updated_at = ?
       WHERE id = ?`,
    )
    .run(LATER, LATER, instanceId);
  raw
    .prepare(
      `INSERT INTO account_merge_challenges (
         id, user_a, user_b, provider, provider_user_id, created_at, expires_at
       ) VALUES ('merge-terminal', 1, 2, 'discord', 'secondary-discord', ?, ?)`,
    )
    .run(NOW, EXPIRES);
  const repository = new D1AccountMergeRepository(db);

  assert.equal(await repository.findMergeIntegrityConflict(1, 2), null);
  assert.throws(
    () => raw.prepare("DELETE FROM users WHERE id = 2").run(),
    /FOREIGN KEY constraint failed/,
    "direct deletion must not orphan long-lived multiplayer identity",
  );
  await repository.mergeAccounts(1, 2, "merge-terminal");

  assert.equal(raw.prepare("SELECT 1 FROM users WHERE id = 2").get(), undefined);
  assert.deepEqual(
    {
      creator: raw
        .prepare("SELECT created_by_user_id FROM multiplayer_instances WHERE id = ?")
        .get(instanceId)?.created_by_user_id,
      participant: raw
        .prepare("SELECT user_id FROM multiplayer_participants WHERE id = 'merge_terminal_host'")
        .get()?.user_id,
      inviteCreator: raw
        .prepare("SELECT created_by_user_id FROM multiplayer_invites WHERE instance_id = ?")
        .get(instanceId)?.created_by_user_id,
    },
    { creator: 1, participant: 1, inviteCreator: 1 },
  );
  assert.ok(
    raw
      .prepare("SELECT consumed_at FROM account_merge_challenges WHERE id = 'merge-terminal'")
      .get()?.consumed_at,
  );
  assert.deepEqual(raw.prepare("PRAGMA foreign_key_check").all(), []);
});

test("account merge detects colliding Game Creator review slots", async () => {
  const { db, raw } = createMigratedD1();
  seedUsers(raw);
  seedGameVersion(raw, {
    gameId: 1,
    versionId: 10,
    slug: "primary-review-game",
    publisherType: "USER",
    publisherUserId: 1,
    moderationStatus: "APPROVED",
  });
  seedGameVersion(raw, {
    gameId: 2,
    versionId: 20,
    slug: "secondary-review-game",
    publisherType: "USER",
    publisherUserId: 2,
    moderationStatus: "APPROVED",
  });
  raw.prepare("UPDATE games SET review_slot = 1 WHERE id IN (1, 2)").run();

  assert.equal(
    await new D1AccountMergeRepository(db).findMergeIntegrityConflict(1, 2),
    "GAME_CREATOR_REVIEW_CONFLICT",
  );
});

test("account merge preserves Creator access, USER game ownership, and multiplayer request identity", async () => {
  const { db, raw } = createMigratedD1();
  seedUsers(raw);
  raw
    .prepare(
      `INSERT INTO game_creator_access (
         user_id, granted_by_admin_id, status, created_at, updated_at
       ) VALUES (2, 1, 'ACTIVE', ?, ?)`,
    )
    .run(NOW, NOW);
  raw
    .prepare(
      `INSERT INTO sandbox_games (
         id, slug, developer_user_id, title, genre, visibility, review_slot,
         created_at, updated_at
       ) VALUES (1, 'merged-creator-game', 2, 'Merged Creator Game', 'board',
                 'PRIVATE', NULL, ?, ?)`,
    )
    .run(NOW, NOW);
  raw
    .prepare(
      `INSERT INTO sandbox_game_versions (
         id, game_id, object_key, content_hash, bundle_bytes, status,
         uploaded_at, publish_status
       ) VALUES (10, 1, 'games/1/10.zip', ?, 100,
                 'APPROVED', ?, 'READY')`,
    )
    .run(CONTENT_HASH, NOW);
  raw
    .prepare("UPDATE sandbox_games SET live_version_id = 10, updated_at = ? WHERE id = 1")
    .run(NOW);
  raw
    .prepare(
      `INSERT INTO multiplayer_profile_requests (
         game_id, game_version_id, content_hash, request_schema_version, request_hash, request_json,
         requested_by_user_id, status, created_at, updated_at
       ) VALUES (1, 10, ?, 1, ?, '{"template":"turn-grid"}', 2,
                 'PENDING_REVIEW', ?, ?)`,
    )
    .run(CONTENT_HASH, REQUEST_HASH, NOW, NOW);
  raw
    .prepare(
      `INSERT INTO account_merge_challenges (
         id, user_a, user_b, provider, provider_user_id, created_at, expires_at
       ) VALUES ('merge-creator-owner', 1, 2, 'discord', 'creator-secondary', ?, ?)`,
    )
    .run(NOW, EXPIRES);

  const repository = new D1AccountMergeRepository(db);
  assert.equal(await repository.findMergeIntegrityConflict(1, 2), null);
  await repository.mergeAccounts(1, 2, "merge-creator-owner");

  assert.equal(raw.prepare("SELECT 1 FROM users WHERE id = 2").get(), undefined);
  assert.deepEqual(
    {
      accessOwner: raw.prepare("SELECT user_id FROM game_creator_access").get()?.user_id,
      controlPlaneOwner: raw
        .prepare("SELECT developer_user_id FROM sandbox_games WHERE id = 1")
        .get()?.developer_user_id,
      runtimeOwner: raw.prepare("SELECT publisher_user_id FROM games WHERE id = 1").get()
        ?.publisher_user_id,
      requestOwner: raw
        .prepare("SELECT requested_by_user_id FROM multiplayer_profile_requests")
        .get()?.requested_by_user_id,
    },
    { accessOwner: 1, controlPlaneOwner: 1, runtimeOwner: 1, requestOwner: 1 },
  );
  assert.deepEqual(raw.prepare("PRAGMA foreign_key_check").all(), []);
});
