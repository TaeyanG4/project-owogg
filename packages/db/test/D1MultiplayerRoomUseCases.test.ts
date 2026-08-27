import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  MultiplayerRoomUseCases,
  createMultiplayerTicketKeyring,
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
const GAME_SLUG = "official-omok";
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
      objectKey: "uploads/11/omok.zip",
      contentHash: "omok-content-hash",
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
      schemaVersion: 3,
      slug: GAME_SLUG,
      title: "오목",
      shortDescription: "두 명이 두는 오목",
      description: "서버 권위형 오목",
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
        thumbnail: "/api/games/official-omok/logo",
      },
      updatedAt: NOW,
    },
  };
}

function seedAuthority(
  raw: ReturnType<typeof createDatabase>["raw"],
  joinPolicy: "OPEN" | "INVITE_ONLY" = "INVITE_ONLY",
): void {
  raw.prepare("INSERT INTO users (id, nickname) VALUES (1, 'Host One')").run();
  raw.prepare("INSERT INTO users (id, nickname) VALUES (2, 'Player Two')").run();
  raw.prepare("INSERT INTO users (id, nickname) VALUES (3, 'Player Three')").run();
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
       ) VALUES (?, ?, 'uploads/11/omok.zip', 'omok-content-hash', 100, 'READY', ?, NULL)`,
    )
    .run(VERSION_ID, GAME_ID, NOW);
  raw
    .prepare("UPDATE games SET live_version_id = ?, visibility = 'PUBLIC' WHERE id = ?")
    .run(VERSION_ID, GAME_ID);
  raw
    .prepare(
      `INSERT INTO multiplayer_profiles (
         id, source_request_id, source_request_hash, profile_version, game_id, game_version_id,
         profile_revision, protocol_version, resolved_class, simulation_model, runtime_backend,
         ruleset_key, ruleset_revision, resolved_config_json, lifecycle, persistence,
         latency_profile, reconnect_policy, min_players, max_players, allowed_visibility_json,
         allowed_join_policies_json, max_action_bytes, max_state_bytes, action_rate_limit,
         reward_policy_id, enabled, approved_at, updated_at
       ) VALUES (
         ?, NULL, NULL, 1, ?, ?, 1, 1, 'M1', 'turn', 'durable-object',
         'official:omok', 1, '{"boardSize":15,"winLength":5}', 'match', 'match',
         'relaxed', 'resume', 2, 2, '["PRIVATE"]', ?,
         1024, 8192, 5, NULL, 1, ?, ?
       )`,
    )
    .run(PROFILE_ID, GAME_ID, VERSION_ID, JSON.stringify([joinPolicy]), NOW, NOW);
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

async function sha256(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function harness(joinPolicy: "OPEN" | "INVITE_ONLY" = "INVITE_ONLY") {
  const { db, raw } = createDatabase();
  seedAuthority(raw, joinPolicy);
  const instances = new D1MultiplayerInstanceRepository(db);
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
    instances,
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
    joinPolicy: "INVITE_ONLY",
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
    joinPolicy: "OPEN",
    idempotencyKey: "room_request_0000000001",
  });
  assert.deepEqual(conflict, { ok: false, code: "FORBIDDEN" });
});

test("a host creates an idempotent one-use invite and exactly one other account can consume it", async () => {
  const { rooms, advance, instances } = harness();
  const created = await createRoom(rooms);
  const inviteInput = {
    userId: 1,
    instanceId: created.instance.id,
    expectedGeneration: created.instance.generation,
    idempotencyKey: "invite_request_00000001",
    keyring,
  } as const;
  const invite = await rooms.createInvite(inviteInput);
  assert.equal(invite.ok, true);
  if (!invite.ok) return;
  advance(10_000);
  const replay = await rooms.createInvite(inviteInput);
  assert.deepEqual(replay, { ...invite, replayed: true });

  const [second, third] = await Promise.all([
    rooms.joinRoom({
      userId: 2,
      publicCode: created.instance.publicCode,
      inviteToken: invite.inviteToken,
    }),
    rooms.joinRoom({
      userId: 3,
      publicCode: created.instance.publicCode,
      inviteToken: invite.inviteToken,
    }),
  ]);
  const successes = [second, third].filter((result) => result.ok);
  assert.equal(successes.length, 1);
  assert.equal((await instances.listParticipants(created.instance.id)).length, 2);
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
  }
  assert.equal((await instances.listParticipants(created.instance.id)).length, 1);
});

test("participants enter READY while only the host start request creates one ACTIVE match", async () => {
  const { rooms, matches, instances } = harness();
  const created = await createRoom(rooms);
  assert.equal(created.participant.status, "READY");
  const prematureStart = await rooms.startRoom({
    userId: 1,
    instanceId: created.instance.id,
    expectedGeneration: 1,
  });
  assert.deepEqual(prematureStart, { ok: false, code: "PLAYERS_NOT_READY" });
  const invite = await rooms.createInvite({
    userId: 1,
    instanceId: created.instance.id,
    expectedGeneration: 1,
    idempotencyKey: "invite_request_00000002",
    keyring,
  });
  assert.equal(invite.ok, true);
  if (!invite.ok) return;
  const joined = await rooms.joinRoom({
    userId: 2,
    publicCode: created.instance.publicCode,
    inviteToken: invite.inviteToken,
  });
  assert.equal(joined.ok, true);
  if (!joined.ok) return;
  assert.equal(joined.participant.status, "READY");

  const [hostReady, playerReady] = await Promise.all([
    rooms.readyParticipant({ userId: 1, instanceId: created.instance.id, expectedGeneration: 1 }),
    rooms.readyParticipant({ userId: 2, instanceId: created.instance.id, expectedGeneration: 1 }),
  ]);
  assert.equal(hostReady.ok, true);
  assert.equal(playerReady.ok, true);
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
  const instance = await instances.findById(created.instance.id);
  assert.equal(instance?.status, "ACTIVE");
  const match = await matches.findMatchByInstanceGeneration(created.instance.id, 1);
  assert.equal(match?.status, "ACTIVE");
  assert.equal((await matches.listPlayers(match?.id ?? "missing")).length, 2);

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
    ["READY", "READY"],
  );
});

test("one rematch request waits while two exact participants open one next generation", async () => {
  const { rooms, matches, instances } = harness();
  const created = await createRoom(rooms);
  const invite = await rooms.createInvite({
    userId: 1,
    instanceId: created.instance.id,
    expectedGeneration: 1,
    idempotencyKey: "invite_request_rematch_01",
    keyring,
  });
  assert.equal(invite.ok, true);
  if (!invite.ok) return;
  const joined = await rooms.joinRoom({
    userId: 2,
    publicCode: created.instance.publicCode,
    inviteToken: invite.inviteToken,
  });
  assert.equal(joined.ok, true);
  if (!joined.ok) return;
  await Promise.all([
    rooms.readyParticipant({ userId: 1, instanceId: created.instance.id, expectedGeneration: 1 }),
    rooms.readyParticipant({ userId: 2, instanceId: created.instance.id, expectedGeneration: 1 }),
  ]);

  const started = await rooms.startRoom({
    userId: 1,
    instanceId: created.instance.id,
    expectedGeneration: 1,
  });
  assert.equal(started.ok, true);

  const match = await matches.findMatchByInstanceGeneration(created.instance.id, 1);
  assert.equal(match?.status, "ACTIVE");
  if (!match) return;
  const participants = await instances.listParticipants(created.instance.id);
  const terminalResultJson = JSON.stringify({ kind: "DRAW", revision: 0 });
  const finalized = await matches.finalize({
    matchId: match.id,
    expectedStateRevision: 0,
    terminalResultJson,
    terminalResultHash: await sha256(terminalResultJson),
    players: participants.map((participant) => ({
      userId: participant.userId,
      participantId: participant.id,
      outcome: "DRAW" as const,
      placement: null,
      resultJson: JSON.stringify({ outcome: "DRAW", generation: 1 }),
      rewardEligible: false,
      reward: null,
    })),
    nowIso: NOW,
  });
  assert.equal(finalized.status, "COMMITTED");
  assert.equal(
    await instances.transition({
      instanceId: created.instance.id,
      expectedStatus: "ACTIVE",
      expectedGeneration: 1,
      nextStatus: "CLOSING",
      nextGeneration: 1,
      closedAt: null,
      abortCode: null,
      nowIso: NOW,
    }),
    true,
  );

  const hostRequest = await rooms.requestRematch({
    userId: 1,
    instanceId: created.instance.id,
    expectedGeneration: 1,
  });
  assert.equal(hostRequest.ok, true);
  if (!hostRequest.ok) return;
  assert.equal(hostRequest.state, "WAITING");
  assert.equal((await instances.findById(created.instance.id))?.generation, 1);

  const opponentStatus = await rooms.getRematchStatus({
    userId: 2,
    instanceId: created.instance.id,
    expectedGeneration: 1,
  });
  assert.equal(opponentStatus.ok, true);
  if (!opponentStatus.ok) return;
  assert.equal(opponentStatus.state, "OPPONENT_REQUESTED");

  const accepted = await rooms.requestRematch({
    userId: 2,
    instanceId: created.instance.id,
    expectedGeneration: 1,
  });
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;
  assert.equal(accepted.state, "STARTED");
  assert.equal(accepted.instance.generation, 2);
  assert.equal(accepted.instance.status, "LOBBY");
  assert.deepEqual(
    (await instances.listParticipants(created.instance.id)).map(
      (participant) => participant.status,
    ),
    ["READY", "READY"],
  );
  assert.equal((await instances.findLease(created.instance.id))?.generation, 2);

  const rematchStarted = await rooms.startRoom({
    userId: 1,
    instanceId: created.instance.id,
    expectedGeneration: 2,
  });
  assert.equal(rematchStarted.ok, true);
  assert.equal((await instances.findById(created.instance.id))?.status, "ACTIVE");
  assert.equal(
    (await matches.findMatchByInstanceGeneration(created.instance.id, 2))?.status,
    "ACTIVE",
  );
});
