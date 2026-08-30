import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  GAME_CANONICAL_SCHEMA_VERSION,
  MultiplayerRoomUseCases,
  createMultiplayerTicketKeyring,
  type MultiplayerInstanceRepository,
  type RuntimeGame,
  type RuntimeGameRegistry,
} from "@owogg/core";
import {
  D1MultiplayerInstanceRepository,
  D1MultiplayerMatchRepository,
  D1MultiplayerProfileRepository,
} from "../src/index.js";
import { createSqliteD1 } from "./helpers/sqliteD1.js";

const NOW = "2026-08-26T03:00:00.000Z";
const GAME_ID = 11;
const VERSION_ID = 12;
const PROFILE_ID = 13;
const GAME_SLUG = "relay-demo";
const CONTENT_HASH = "e".repeat(64);
const keyring = createMultiplayerTicketKeyring({
  kid: "room_test_key",
  secret: "room-use-case-ticket-secret-32-bytes-minimum",
});

function createDatabase() {
  const result = createSqliteD1("PRAGMA foreign_keys = ON;");
  const migrationUrl = new URL("../migrations/", import.meta.url);
  for (const filename of fs
    .readdirSync(migrationUrl)
    .filter((value) => value.endsWith(".sql"))
    .sort()) {
    result.raw.exec(fs.readFileSync(new URL(filename, migrationUrl), "utf8"));
  }
  return result;
}

function runtimeGame(): RuntimeGame {
  return {
    identity: {
      id: GAME_ID,
      slug: GAME_SLUG,
      publisher: { type: "OWOGG" },
      visibility: "PUBLIC",
      liveVersionId: VERSION_ID,
      deletedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    liveVersion: {
      id: VERSION_ID,
      gameId: GAME_ID,
      objectKey: "uploads/11/relay-demo.zip",
      contentHash: CONTENT_HASH,
      bundleBytes: 100,
      publishStatus: "READY",
      publishError: null,
      publishedAt: NOW,
      manifestKey: "games/11/12/manifest.json",
      publishedSizeBytes: 100,
      fileCount: 3,
      uploadedAt: NOW,
    },
    canonical: {
      schemaVersion: GAME_CANONICAL_SCHEMA_VERSION,
      slug: GAME_SLUG,
      title: "Relay Demo",
      shortDescription: "두 명이 참여하는 Relay fixture",
      description: "게임 규칙을 해석하지 않는 Relay fixture",
      publisher: { official: true },
      policy: { score: null, leaderboard: false, xpPerCompletion: 0, requiresAuth: true },
      supportsReplay: false,
      catalog: {
        type: "TAXONOMY",
        categories: ["board"],
        tags: ["multiplayer"],
        modes: ["online-multi"],
        inputMethods: ["mouse", "touch"],
        minPlayers: 2,
        maxPlayers: 2,
        thumbnail: "/api/games/relay-demo/logo",
      },
      updatedAt: NOW,
    },
  };
}

function seedAuthority(
  raw: ReturnType<typeof createDatabase>["raw"],
  joinPolicy: "OPEN" = "OPEN",
): void {
  raw.prepare("INSERT INTO users (id, nickname) VALUES (1, 'Host One')").run();
  raw.prepare("INSERT INTO users (id, nickname) VALUES (2, 'Player Two')").run();
  raw.prepare("INSERT INTO users (id, nickname) VALUES (3, 'Player Three')").run();
  raw.prepare("INSERT INTO users (id, nickname) VALUES (4, 'Admin')").run();
  raw
    .prepare(
      `INSERT INTO games (
         id, slug, publisher_type, publisher_user_id, visibility, live_version_id,
         deleted_at, created_at, updated_at
       ) VALUES (?, ?, 'OWOGG', NULL, 'PRIVATE', NULL, NULL, ?, ?)`,
    )
    .run(GAME_ID, GAME_SLUG, NOW, NOW);
  raw
    .prepare(
      `INSERT INTO game_versions (
         id, game_id, object_key, content_hash, bundle_bytes, publish_status,
         uploaded_at, moderation_status
       ) VALUES (?, ?, 'uploads/11/relay-demo.zip', ?, 100, 'READY', ?, NULL)`,
    )
    .run(VERSION_ID, GAME_ID, CONTENT_HASH, NOW);
  raw
    .prepare("UPDATE games SET live_version_id = ?, visibility = 'PUBLIC' WHERE id = ?")
    .run(VERSION_ID, GAME_ID);
  raw
    .prepare(
      `INSERT INTO admin_accounts (
         id, user_id, google_sub, username, password_hash, role, status,
         must_change_password, created_at, updated_at, password_changed_at
       ) VALUES (1, 4, 'room-admin', 'roomadmin', 'hash', 'ADMIN', 'ACTIVE', 0, ?, ?, ?)`,
    )
    .run(NOW, NOW, NOW);
  raw
    .prepare(
      `INSERT INTO multiplayer_profile_requests (
         id, game_id, game_version_id, content_hash, request_schema_version, request_hash,
         request_json, requested_by_user_id, status, reviewed_by_admin_id, reviewed_at,
         created_at, updated_at
       ) VALUES (1, ?, ?, ?, 1, ?, '{}', NULL, 'APPROVED', 1, ?, ?, ?)`,
    )
    .run(GAME_ID, VERSION_ID, CONTENT_HASH, "a".repeat(64), NOW, NOW, NOW);
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
         ?, 1, ?, 1, ?, ?, 1, 1, 'M1', 'event', 'durable-object',
         'legacy:disabled', 1, '{}', 'match', 'match',
         'relaxed', 'resume', 2, 2, '["PRIVATE"]', ?,
         4096, 1, 20, NULL, 0, ?, ?, 'RELAY', ?, 'websocket', 'relay', 1, 1,
         'close', 'UNVERIFIED', 4096, 16384, 20, 262144, 7200
       )`,
    )
    .run(
      PROFILE_ID,
      "a".repeat(64),
      GAME_ID,
      VERSION_ID,
      JSON.stringify([joinPolicy]),
      NOW,
      NOW,
      CONTENT_HASH,
    );
  raw
    .prepare("UPDATE multiplayer_profiles SET enabled = 1, updated_at = ? WHERE id = ?")
    .run(NOW, PROFILE_ID);
}

function tokenFactory() {
  let counter = 0;
  return (byteLength: number) => {
    counter += 1;
    const outputLength = Math.ceil((byteLength * 4) / 3);
    const suffix = counter.toString(36);
    return `${"A".repeat(outputLength - suffix.length)}${suffix}`;
  };
}

function harness(
  joinPolicy: "OPEN" = "OPEN",
  decorateInstances?: (instances: D1MultiplayerInstanceRepository) => MultiplayerInstanceRepository,
) {
  const { db, raw } = createDatabase();
  seedAuthority(raw, joinPolicy);
  const storedInstances = new D1MultiplayerInstanceRepository(db);
  const instances = decorateInstances?.(storedInstances) ?? storedInstances;
  const matches = new D1MultiplayerMatchRepository(db);
  const profiles = new D1MultiplayerProfileRepository(db);
  let now = new Date(NOW);
  const runtimeGames: RuntimeGameRegistry = {
    async findBySlug(slug) {
      return slug === GAME_SLUG ? runtimeGame() : null;
    },
    async listPublic() {
      return [runtimeGame()];
    },
  };
  const rooms = new MultiplayerRoomUseCases({
    runtimeGames,
    profiles,
    instances,
    matches,
    now: () => now,
    randomToken: tokenFactory(),
  });
  return {
    raw,
    instances: storedInstances,
    matches,
    rooms,
    advance(milliseconds: number) {
      now = new Date(now.getTime() + milliseconds);
    },
  };
}

async function createRoom(
  rooms: MultiplayerRoomUseCases,
  userId = 1,
  idempotencyKey = "room_request_0000000001",
) {
  const result = await rooms.createRoom({
    userId,
    gameSlug: GAME_SLUG,
    visibility: "PRIVATE",
    joinPolicy: "OPEN",
    idempotencyKey,
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error(result.code);
  return result;
}

test("different idempotency keys create independent rooms with no global single-room lock", async () => {
  const { rooms, raw } = harness();
  const [first, second, third] = await Promise.all([
    createRoom(rooms, 1, "room_request_0000000001"),
    createRoom(rooms, 1, "room_request_0000000002"),
    createRoom(rooms, 2, "room_request_0000000001"),
  ]);
  assert.equal(new Set([first.instance.id, second.instance.id, third.instance.id]).size, 3);
  assert.equal(
    new Set([first.instance.publicCode, second.instance.publicCode, third.instance.publicCode])
      .size,
    3,
  );
  assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM multiplayer_instances").get()?.count, 3);
  assert.equal(
    raw
      .prepare("SELECT COUNT(*) AS count FROM multiplayer_instances WHERE created_by_user_id = 1")
      .get()?.count,
    2,
  );
});

test("room creation replays across time and refuses access outside the approved profile", async () => {
  const { rooms, advance } = harness();
  const created = await createRoom(rooms);
  advance(30_000);
  const replayed = await createRoom(rooms);
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.instance.id, created.instance.id);
  assert.equal(replayed.instance.expiresAt, created.instance.expiresAt);

  const conflict = await rooms.createRoom({
    userId: 1,
    gameSlug: GAME_SLUG,
    visibility: "PRIVATE",
    joinPolicy: "INVITE_ONLY",
    idempotencyKey: "room_request_0000000001",
  });
  assert.deepEqual(conflict, { ok: false, code: "FORBIDDEN" });
});

test("generic Relay rooms reject the retired invite-only credential path", async () => {
  const { rooms } = harness();
  const created = await createRoom(rooms);
  const inviteInput = {
    userId: 1,
    instanceId: created.instance.id,
    expectedGeneration: created.instance.generation,
    idempotencyKey: "invite_request_00000001",
    keyring,
  } as const;
  const invite = await rooms.createInvite(inviteInput);
  assert.deepEqual(invite, { ok: false, code: "FORBIDDEN" });
});

test("self-join replays the host seat instead of creating a self-match participant", async () => {
  const { rooms, instances } = harness();
  const created = await createRoom(rooms);
  const joined = await rooms.joinRoom({
    userId: 1,
    publicCode: created.instance.publicCode,
    inviteToken: null,
  });
  assert.equal(joined.ok, true);
  if (joined.ok) {
    assert.equal(joined.replayed, true);
    assert.equal(joined.participant.id, created.participant.id);
    assert.equal(joined.participant.status, "JOINED");
  }
  assert.equal((await instances.listParticipants(created.instance.id)).length, 1);
});

test("participants enter READY while only the host start request creates one ACTIVE match", async () => {
  const { rooms, matches, instances } = harness();
  const created = await createRoom(rooms);
  assert.equal(created.participant.status, "JOINED");
  const prematureStart = await rooms.startRoom({
    userId: 1,
    instanceId: created.instance.id,
    expectedGeneration: 1,
  });
  assert.deepEqual(prematureStart, { ok: false, code: "PLAYERS_NOT_READY" });
  const joined = await rooms.joinRoom({
    userId: 2,
    publicCode: created.instance.publicCode,
    inviteToken: null,
  });
  assert.equal(joined.ok, true);
  if (!joined.ok) return;
  assert.equal(joined.participant.status, "READY");
  const alreadyReady = await rooms.setParticipantReady({
    userId: 2,
    instanceId: created.instance.id,
    expectedGeneration: 1,
    ready: true,
  });
  assert.equal(alreadyReady.ok, true);
  if (!alreadyReady.ok) return;
  assert.equal(alreadyReady.changed, false);

  const hostReady = await rooms.setParticipantReady({
    userId: 1,
    instanceId: created.instance.id,
    expectedGeneration: 1,
    ready: true,
  });
  assert.deepEqual(hostReady, { ok: false, code: "FORBIDDEN" });
  assert.equal((await instances.findById(created.instance.id))?.status, "LOBBY");
  assert.equal(await matches.findMatchByInstanceGeneration(created.instance.id, 1), null);
  const playerStart = await rooms.startRoom({
    userId: 2,
    instanceId: created.instance.id,
    expectedGeneration: 1,
  });
  assert.deepEqual(playerStart, { ok: false, code: "FORBIDDEN" });
  const started = await rooms.startRoom({
    userId: 1,
    instanceId: created.instance.id,
    expectedGeneration: 1,
  });
  assert.equal(started.ok, true);
  if (!started.ok) return;
  assert.equal(started.participant.status, "READY");
  const instance = await instances.findById(created.instance.id);
  assert.equal(instance?.status, "ACTIVE");
  const match = await matches.findMatchByInstanceGeneration(created.instance.id, 1);
  assert.equal(match?.status, "ACTIVE");
  assert.equal((await matches.listPlayers(match?.id ?? "missing")).length, 2);

  const resumed = await rooms.joinRoom({
    userId: 2,
    publicCode: created.instance.publicCode,
    inviteToken: null,
  });
  assert.equal(resumed.ok, true);
  if (!resumed.ok) return;
  assert.equal(resumed.replayed, true);
  assert.equal(resumed.instance.status, "ACTIVE");
  assert.equal(resumed.participant.id, joined.participant.id);
  assert.equal(resumed.participant.seatIndex, 1);
  assert.equal(resumed.participant.status, "READY");
  assert.deepEqual(
    await rooms.joinRoom({
      userId: 3,
      publicCode: created.instance.publicCode,
      inviteToken: null,
    }),
    { ok: false, code: "INSTANCE_NOT_JOINABLE" },
  );

  const staleWaitingLeave = await rooms.leaveRoom({
    userId: 2,
    instanceId: created.instance.id,
    expectedGeneration: 1,
    expectedInstanceStatus: "LOBBY",
  });
  assert.deepEqual(staleWaitingLeave, { ok: false, code: "STALE_GENERATION" });
  assert.equal((await instances.findParticipant(created.instance.id, 2))?.status, "READY");
  assert.equal((await instances.findById(created.instance.id))?.status, "ACTIVE");

  const left = await rooms.leaveRoom({
    userId: 2,
    instanceId: created.instance.id,
    expectedGeneration: 1,
  });
  assert.equal(left.ok, true, JSON.stringify(left));
  assert.equal((await instances.findById(created.instance.id))?.status, "ABORTED");
  assert.equal((await matches.findMatch(match?.id ?? "missing"))?.status, "ABORTED");
});

test("a PRIVATE OPEN room accepts its opaque room code without an invite token", async () => {
  const { rooms, instances } = harness("OPEN");
  const created = await rooms.createRoom({
    userId: 1,
    gameSlug: GAME_SLUG,
    visibility: "PRIVATE",
    joinPolicy: "OPEN",
    idempotencyKey: "room_request_open_000001",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const joined = await rooms.joinRoom({
    userId: 2,
    publicCode: created.instance.publicCode,
    inviteToken: null,
  });
  assert.equal(joined.ok, true);
  if (!joined.ok) return;
  assert.equal(joined.participant.status, "READY");
  assert.deepEqual(
    (await instances.listParticipants(created.instance.id)).map(
      (participant) => participant.status,
    ),
    ["JOINED", "READY"],
  );
});

test("a voluntary lobby leave can rejoin while a host-closed room is no longer discoverable", async () => {
  const { rooms, instances } = harness();
  const created = await createRoom(rooms);
  const joined = await rooms.joinRoom({
    userId: 2,
    publicCode: created.instance.publicCode,
    inviteToken: null,
  });
  assert.equal(joined.ok, true);
  if (!joined.ok) return;
  const originalParticipantId = joined.participant.id;

  const left = await rooms.leaveRoom({
    userId: 2,
    instanceId: created.instance.id,
    expectedGeneration: 1,
    expectedInstanceStatus: "LOBBY",
  });
  assert.equal(left.ok, true);
  assert.equal((await instances.findById(created.instance.id))?.participantCount, 1);

  // The authenticated former participant may reclaim the same audited seat without consuming a
  // second one-use invite. It becomes READY through the ordinary join orchestration.
  const rejoined = await rooms.joinRoom({
    userId: 2,
    publicCode: created.instance.publicCode,
    inviteToken: null,
  });
  assert.equal(rejoined.ok, true);
  if (!rejoined.ok) return;
  assert.equal(rejoined.replayed, false);
  assert.equal(rejoined.participant.id, originalParticipantId);
  assert.equal(rejoined.participant.status, "READY");
  assert.equal((await instances.findById(created.instance.id))?.participantCount, 2);

  const hostLeft = await rooms.leaveRoom({
    userId: 1,
    instanceId: created.instance.id,
    expectedGeneration: 1,
    expectedInstanceStatus: "LOBBY",
  });
  assert.equal(hostLeft.ok, true);
  if (!hostLeft.ok) return;
  assert.equal(hostLeft.instance.status, "ABORTED");

  assert.deepEqual(
    await rooms.joinRoom({
      userId: 1,
      publicCode: created.instance.publicCode,
      inviteToken: null,
    }),
    { ok: false, code: "INSTANCE_NOT_FOUND" },
  );
  assert.deepEqual(
    await rooms.joinRoom({
      userId: 2,
      publicCode: created.instance.publicCode,
      inviteToken: null,
    }),
    { ok: false, code: "INSTANCE_NOT_FOUND" },
  );
});
