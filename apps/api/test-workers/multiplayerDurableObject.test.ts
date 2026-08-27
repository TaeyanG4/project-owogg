import { env } from "cloudflare:workers";
import {
  applyD1Migrations,
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { beforeAll, test } from "vitest";
import { MULTIPLAYER_HEARTBEAT_REQUEST, MULTIPLAYER_HEARTBEAT_RESPONSE } from "@owogg/contracts";
import {
  MULTIPLAYER_PLAYER_CONNECTION_CHANGED_EVENT,
  MULTIPLAYER_REMATCH_CHANGED_EVENT,
} from "@owogg/game-sdk/bridge";
import {
  OMOK_ACTION_LEDGER_SCHEMA_VERSION,
  MULTIPLAYER_TICKET_AUDIENCE,
  MULTIPLAYER_TICKET_ISSUER,
  MULTIPLAYER_WEBSOCKET_PROTOCOL,
  MultiplayerRoomUseCases,
  applyOmokAction,
  createInitialOmokState,
  encodeOmokActionLedgerResponse,
  type RuntimeGame,
  type RuntimeGameRegistry,
  type MultiplayerJoinTicketClaims,
} from "@owogg/core";
import {
  D1MultiplayerInstanceRepository,
  D1MultiplayerMatchRepository,
  D1MultiplayerProfileRepository,
} from "@owogg/db";
import {
  MULTIPLAYER_INTERNAL_CLAIMS_HEADER,
  MULTIPLAYER_INTERNAL_CONNECT_PATH,
  MULTIPLAYER_INTERNAL_LEAVE_PATH,
  MULTIPLAYER_INTERNAL_PROTOCOL_HEADER,
  MULTIPLAYER_INTERNAL_REMATCH_NOTIFY_PATH,
  decodeVerifiedMultiplayerClaims,
  encodeVerifiedMultiplayerClaims,
} from "../src/multiplayer/internalProtocol.js";

const GAME_ID = 81_001;
const GAME_VERSION_ID = 81_002;
const PROFILE_ID = 81_003;
const HOST_USER_ID = 81_011;
const PLAYER_USER_ID = 81_012;
const GAME_SLUG = "workers-official-omok";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  const nowIso = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO users (id, nickname) VALUES (?, ?)").bind(
      HOST_USER_ID,
      "Workers Host",
    ),
    env.DB.prepare("INSERT OR IGNORE INTO users (id, nickname) VALUES (?, ?)").bind(
      PLAYER_USER_ID,
      "Workers Player",
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO games (
           id, slug, publisher_type, publisher_user_id, visibility, live_version_id,
           deleted_at, created_at, updated_at
         ) VALUES (?, ?, 'OWOGG', NULL, 'PRIVATE', NULL, NULL, ?, ?)`,
    ).bind(GAME_ID, GAME_SLUG, nowIso, nowIso),
  ]);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO game_versions (
         id, game_id, object_key, content_hash, bundle_bytes, publish_status,
         uploaded_at, moderation_status
       ) VALUES (?, ?, ?, ?, 100, 'READY', ?, NULL)`,
  )
    .bind(
      GAME_VERSION_ID,
      GAME_ID,
      "uploads/81001/workers-omok.zip",
      "workers-omok-content-hash",
      nowIso,
    )
    .run();
  await env.DB.prepare("UPDATE games SET live_version_id = ?, visibility = 'PUBLIC' WHERE id = ?")
    .bind(GAME_VERSION_ID, GAME_ID)
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO multiplayer_profiles (
         id, source_request_id, source_request_hash, profile_version, game_id, game_version_id,
         profile_revision, protocol_version, resolved_class, simulation_model, runtime_backend,
         ruleset_key, ruleset_revision, resolved_config_json, lifecycle, persistence,
         latency_profile, reconnect_policy, min_players, max_players, allowed_visibility_json,
         allowed_join_policies_json, max_action_bytes, max_state_bytes, action_rate_limit,
         reward_policy_id, enabled, approved_at, updated_at
       ) VALUES (
         ?, NULL, NULL, 1, ?, ?, 1, 1, 'M1', 'turn', 'durable-object',
         'official:omok', 1, '{"boardSize":15,"winLength":5}', 'match', 'match',
         'relaxed', 'resume', 2, 2, '["PRIVATE"]', '["OPEN"]',
         1024, 8192, 60, NULL, 1, ?, ?
       )`,
  )
    .bind(PROFILE_ID, GAME_ID, GAME_VERSION_ID, nowIso, nowIso)
    .run();
});

function runtimeGame(): RuntimeGame {
  const nowIso = new Date().toISOString();
  return {
    identity: {
      id: GAME_ID,
      slug: GAME_SLUG,
      publisher: { type: "OWOGG" },
      visibility: "PUBLIC",
      liveVersionId: GAME_VERSION_ID,
      deletedAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    liveVersion: {
      id: GAME_VERSION_ID,
      gameId: GAME_ID,
      objectKey: "uploads/81001/workers-omok.zip",
      contentHash: "workers-omok-content-hash",
      bundleBytes: 100,
      publishStatus: "READY",
      publishError: null,
      publishedAt: nowIso,
      manifestKey: "games/81001/81002/manifest.json",
      publishedSizeBytes: 100,
      fileCount: 3,
      uploadedAt: nowIso,
    },
    canonical: {
      schemaVersion: 3,
      slug: GAME_SLUG,
      title: "Workers 오목",
      shortDescription: "두 사용자 DO 통합 테스트",
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
        thumbnail: "/api/games/workers-official-omok/logo",
      },
      updatedAt: nowIso,
    },
  };
}

function roomHarness() {
  const instances = new D1MultiplayerInstanceRepository(env.DB);
  const matches = new D1MultiplayerMatchRepository(env.DB);
  const profiles = new D1MultiplayerProfileRepository(env.DB);
  const runtimeGames: RuntimeGameRegistry = {
    async findBySlug(slug) {
      return slug === GAME_SLUG ? runtimeGame() : null;
    },
    async listPublic() {
      return [runtimeGame()];
    },
  };
  return {
    instances,
    matches,
    rooms: new MultiplayerRoomUseCases({ runtimeGames, profiles, instances, matches }),
  };
}

function claims(
  instanceId: string,
  overrides: Partial<MultiplayerJoinTicketClaims> = {},
): MultiplayerJoinTicketClaims {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: MULTIPLAYER_TICKET_ISSUER,
    aud: MULTIPLAYER_TICKET_AUDIENCE,
    kid: "workers_test_key",
    iat: now,
    exp: now + 30,
    jti: crypto.randomUUID(),
    instanceId,
    participantId: "participant_workers_0001",
    userId: 7,
    gameVersionId: 12,
    profileId: 13,
    profileRevision: 2,
    rulesetKey: "official:omok",
    rulesetRevision: 1,
    generation: 1,
    connectionGeneration: 1,
    seatIndex: 0,
    role: "HOST",
    ...overrides,
  };
}

function internalRequest(ticketClaims: MultiplayerJoinTicketClaims): Request {
  return new Request(`https://example.com${MULTIPLAYER_INTERNAL_CONNECT_PATH}`, {
    headers: {
      Upgrade: "websocket",
      [MULTIPLAYER_INTERNAL_PROTOCOL_HEADER]: MULTIPLAYER_WEBSOCKET_PROTOCOL,
      [MULTIPLAYER_INTERNAL_CLAIMS_HEADER]: encodeVerifiedMultiplayerClaims(ticketClaims),
    },
  });
}

function internalRematchNotificationRequest(generation: number): Request {
  return new Request(`https://example.com${MULTIPLAYER_INTERNAL_REMATCH_NOTIFY_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [MULTIPLAYER_INTERNAL_PROTOCOL_HEADER]: MULTIPLAYER_WEBSOCKET_PROTOCOL,
    },
    body: JSON.stringify({ generation }),
  });
}

function internalLeaveRequest(instanceId: string, userId: number, generation: number): Request {
  return new Request(`https://example.com${MULTIPLAYER_INTERNAL_LEAVE_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [MULTIPLAYER_INTERNAL_PROTOCOL_HEADER]: MULTIPLAYER_WEBSOCKET_PROTOCOL,
    },
    body: JSON.stringify({ instanceId, userId, generation }),
  });
}

async function nextMessage(socket: WebSocket, label = "WebSocket message"): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), 2_000);
    socket.addEventListener(
      "message",
      (event) => {
        clearTimeout(timeout);
        try {
          resolve(JSON.parse(String(event.data)));
        } catch (error) {
          reject(error);
        }
      },
      { once: true },
    );
  });
}

async function nextRawMessage(socket: WebSocket, label = "raw WebSocket message"): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), 2_000);
    socket.addEventListener(
      "message",
      (event) => {
        clearTimeout(timeout);
        resolve(String(event.data));
      },
      { once: true },
    );
  });
}

async function collectMessages(socket: WebSocket, count: number): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const messages: unknown[] = [];
    const timeout = setTimeout(
      () =>
        reject(
          new Error(
            `timed out waiting for ${count} WebSocket messages; received=${JSON.stringify(messages)}`,
          ),
        ),
      4_000,
    );
    const listener = (event: MessageEvent) => {
      try {
        messages.push(JSON.parse(String(event.data)));
      } catch (error) {
        clearTimeout(timeout);
        socket.removeEventListener("message", listener);
        reject(error);
        return;
      }
      if (messages.length === count) {
        clearTimeout(timeout);
        socket.removeEventListener("message", listener);
        resolve(messages);
      }
    };
    socket.addEventListener("message", listener);
  });
}

async function nextMessageWhere(
  socket: WebSocket,
  label: string,
  predicate: (message: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const skipped: unknown[] = [];
    const timeout = setTimeout(() => {
      socket.removeEventListener("message", listener);
      reject(new Error(`timed out waiting for ${label}; skipped=${JSON.stringify(skipped)}`));
    }, 2_000);
    const listener = (event: MessageEvent) => {
      let message: unknown;
      try {
        message = JSON.parse(String(event.data));
      } catch (error) {
        clearTimeout(timeout);
        socket.removeEventListener("message", listener);
        reject(error);
        return;
      }
      if (
        typeof message === "object" &&
        message !== null &&
        !Array.isArray(message) &&
        predicate(message as Record<string, unknown>)
      ) {
        clearTimeout(timeout);
        socket.removeEventListener("message", listener);
        resolve(message as Record<string, unknown>);
      } else {
        skipped.push(message);
      }
    };
    socket.addEventListener("message", listener);
  });
}

async function nextClose(socket: WebSocket): Promise<CloseEvent> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("timed out waiting for WebSocket close")),
      2_000,
    );
    socket.addEventListener(
      "close",
      (event) => {
        clearTimeout(timeout);
        resolve(event);
      },
      { once: true },
    );
  });
}

async function connect(ticketClaims: MultiplayerJoinTicketClaims): Promise<{
  readonly socket: WebSocket;
  readonly response: Response;
}> {
  const id = env.MULTIPLAYER_INSTANCES.idFromName(ticketClaims.instanceId);
  const stub = env.MULTIPLAYER_INSTANCES.get(id);
  const request = internalRequest(ticketClaims);
  if (
    decodeVerifiedMultiplayerClaims(request.headers.get(MULTIPLAYER_INTERNAL_CLAIMS_HEADER)) ===
    null
  ) {
    throw new Error("test harness failed to round-trip verified claims");
  }
  const response = await stub.fetch(request.url, { headers: request.headers });
  const socket = response.webSocket;
  if (!socket) {
    throw new Error(`expected WebSocket upgrade, received ${response.status}`);
  }
  socket.accept();
  return { socket, response };
}

async function createConnectedRoom(key: string): Promise<{
  readonly instanceId: string;
  readonly hostClaims: MultiplayerJoinTicketClaims;
  readonly playerClaims: MultiplayerJoinTicketClaims;
  readonly hostSocket: WebSocket;
  readonly playerSocket: WebSocket;
  readonly matches: D1MultiplayerMatchRepository;
  readonly instances: D1MultiplayerInstanceRepository;
}> {
  const { rooms, instances, matches } = roomHarness();
  const created = await rooms.createRoom({
    userId: HOST_USER_ID,
    gameSlug: GAME_SLUG,
    visibility: "PRIVATE",
    joinPolicy: "OPEN",
    idempotencyKey: `workers_room_${key}_00000001`,
  });
  if (!created.ok) throw new Error(`room create failed: ${created.code}`);
  const joined = await rooms.joinRoom({
    userId: PLAYER_USER_ID,
    publicCode: created.instance.publicCode,
    inviteToken: null,
  });
  if (!joined.ok) throw new Error(`room join failed: ${joined.code}`);
  const started = await rooms.startRoom({
    userId: HOST_USER_ID,
    instanceId: created.instance.id,
    expectedGeneration: created.instance.generation,
  });
  if (!started.ok) throw new Error(`room start failed: ${started.code}`);

  const hostParticipant = await instances.advanceConnectionGeneration({
    instanceId: created.instance.id,
    expectedInstanceGeneration: created.instance.generation,
    userId: HOST_USER_ID,
    expectedConnectionGeneration: created.participant.connectionGeneration,
    nowIso: new Date().toISOString(),
  });
  const playerParticipant = await instances.advanceConnectionGeneration({
    instanceId: created.instance.id,
    expectedInstanceGeneration: created.instance.generation,
    userId: PLAYER_USER_ID,
    expectedConnectionGeneration: joined.participant.connectionGeneration,
    nowIso: new Date().toISOString(),
  });
  if (!hostParticipant || !playerParticipant) throw new Error("connection generation failed");

  const hostClaims = claims(created.instance.id, {
    participantId: hostParticipant.id,
    userId: HOST_USER_ID,
    gameVersionId: GAME_VERSION_ID,
    profileId: PROFILE_ID,
    profileRevision: 1,
    rulesetKey: "official:omok",
    rulesetRevision: 1,
    generation: created.instance.generation,
    connectionGeneration: hostParticipant.connectionGeneration,
    seatIndex: hostParticipant.seatIndex,
    role: "HOST",
  });
  const playerClaims = claims(created.instance.id, {
    participantId: playerParticipant.id,
    userId: PLAYER_USER_ID,
    gameVersionId: GAME_VERSION_ID,
    profileId: PROFILE_ID,
    profileRevision: 1,
    rulesetKey: "official:omok",
    rulesetRevision: 1,
    generation: created.instance.generation,
    connectionGeneration: playerParticipant.connectionGeneration,
    seatIndex: playerParticipant.seatIndex,
    role: "PLAYER",
  });
  const host = await connect(hostClaims);
  await nextMessage(host.socket, "host connected acknowledgement");
  const player = await connect(playerClaims);
  await nextMessage(player.socket, "player connected acknowledgement");
  return {
    instanceId: created.instance.id,
    hostClaims,
    playerClaims,
    hostSocket: host.socket,
    playerSocket: player.socket,
    matches,
    instances,
  };
}

async function readyConnectedRoom(
  room: Awaited<ReturnType<typeof createConnectedRoom>>,
  hostStone: "BLACK" | "WHITE" = "BLACK",
) {
  const hostPending = nextMessageWhere(
    room.hostSocket,
    "host pending stone selection",
    (message) =>
      message.type === "MULTI_SYNC" &&
      (message.payload as { stoneSelection?: { status?: string } } | undefined)?.stoneSelection
        ?.status === "PENDING",
  );
  const playerPending = nextMessageWhere(
    room.playerSocket,
    "player pending stone selection",
    (message) =>
      message.type === "MULTI_SYNC" &&
      (message.payload as { stoneSelection?: { status?: string } } | undefined)?.stoneSelection
        ?.status === "PENDING",
  );
  room.hostSocket.send(JSON.stringify({ type: "MULTI_READY", v: 1, generation: 1 }));
  room.playerSocket.send(JSON.stringify({ type: "MULTI_READY", v: 1, generation: 1 }));
  await Promise.all([hostPending, playerPending]);

  const hostSync = nextMessageWhere(
    room.hostSocket,
    "host locked stone selection",
    (message) =>
      message.type === "MULTI_SYNC" &&
      (message.payload as { stoneSelection?: { status?: string } } | undefined)?.stoneSelection
        ?.status === "LOCKED",
  );
  const playerSync = nextMessageWhere(
    room.playerSocket,
    "player locked stone selection",
    (message) =>
      message.type === "MULTI_SYNC" &&
      (message.payload as { stoneSelection?: { status?: string } } | undefined)?.stoneSelection
        ?.status === "LOCKED",
  );
  room.hostSocket.send(
    JSON.stringify({
      type: "MULTI_INPUT",
      v: 1,
      generation: 1,
      clientSeq: 1,
      payload: { kind: "OMOK_SELECT_STONE", stone: hostStone },
    }),
  );
  return Promise.all([hostSync, playerSync]);
}

async function playAcceptedMove(
  room: Awaited<ReturnType<typeof createConnectedRoom>>,
  input: {
    readonly actor: "HOST" | "PLAYER";
    readonly clientSeq: number;
    readonly clientActionId: string;
    readonly expectedRevision: number;
    readonly x: number;
    readonly y: number;
  },
): Promise<readonly [Record<string, unknown>, Record<string, unknown>]> {
  const revision = input.expectedRevision + 1;
  const hostState = nextMessageWhere(
    room.hostSocket,
    `host revision ${revision} state`,
    (message) => message.type === "MULTI_STATE" && message.revision === revision,
  );
  const playerState = nextMessageWhere(
    room.playerSocket,
    `player revision ${revision} state`,
    (message) => message.type === "MULTI_STATE" && message.revision === revision,
  );
  const actorSocket = input.actor === "HOST" ? room.hostSocket : room.playerSocket;
  actorSocket.send(
    JSON.stringify({
      type: "MULTI_ACTION",
      v: 1,
      generation: 1,
      clientSeq: input.clientSeq,
      clientActionId: input.clientActionId,
      expectedRevision: input.expectedRevision,
      payload: { x: input.x, y: input.y },
    }),
  );
  return Promise.all([hostState, playerState]);
}

test("SQLite DO consumes one nonce and persists only minimal connection authority", async ({
  expect,
}) => {
  const instanceId = "workers_nonce_instance_0001";
  const ticketClaims = claims(instanceId, { jti: "workers_nonce_123456789" });
  const { socket, response } = await connect(ticketClaims);
  expect(response.status).toBe(101);
  expect(response.headers.get("Sec-WebSocket-Protocol")).toBeNull();
  await expect(nextMessage(socket)).resolves.toEqual({
    type: "MULTI_CONNECTED",
    v: 1,
    generation: 1,
    connectionGeneration: 1,
  });
  const heartbeat = nextRawMessage(socket, "hibernation heartbeat response");
  socket.send(MULTIPLAYER_HEARTBEAT_REQUEST);
  await expect(heartbeat).resolves.toBe(MULTIPLAYER_HEARTBEAT_RESPONSE);

  const stub = env.MULTIPLAYER_INSTANCES.get(env.MULTIPLAYER_INSTANCES.idFromName(instanceId));
  const replay = await stub.fetch(internalRequest(ticketClaims));
  expect(replay.status).toBe(401);
  await runInDurableObject(stub, async (_instance, state) => {
    expect(state.storage.sql.exec("SELECT jti FROM consumed_ticket_nonces").toArray()).toEqual([
      { jti: "workers_nonce_123456789" },
    ]);
    expect(
      state.storage.sql
        .exec(
          `SELECT participant_id, user_id, generation, connection_generation, disconnected_at
           FROM participant_connections`,
        )
        .toArray(),
    ).toEqual([
      {
        participant_id: "participant_workers_0001",
        user_id: 7,
        generation: 1,
        connection_generation: 1,
        disconnected_at: null,
      },
    ]);
    expect(
      state.storage.sql
        .exec<{ name: string }>(
          `SELECT name FROM sqlite_master
           WHERE type = 'table'
             AND name IN ('participant_rate_windows', 'lobby_event_sequence', 'lobby_lifecycle')`,
        )
        .toArray(),
    ).toEqual([]);
  });
  socket.close(1000, "done");
});

test("new connection generation takes over and closes the old hibernatable socket", async ({
  expect,
}) => {
  const instanceId = "workers_takeover_instance_01";
  const first = await connect(
    claims(instanceId, {
      jti: "workers_takeover_nonce_0001",
      connectionGeneration: 1,
    }),
  );
  await nextMessage(first.socket);
  const oldSocketClosed = nextClose(first.socket);

  const second = await connect(
    claims(instanceId, {
      jti: "workers_takeover_nonce_0002",
      connectionGeneration: 2,
    }),
  );
  await nextMessage(second.socket);
  const closeEvent = await oldSocketClosed;
  expect(closeEvent.code).toBe(4001);
  expect(closeEvent.reason).toBe("replaced by newer connection");

  const stale = await env.MULTIPLAYER_INSTANCES.get(
    env.MULTIPLAYER_INSTANCES.idFromName(instanceId),
  ).fetch(
    internalRequest(
      claims(instanceId, {
        jti: "workers_takeover_nonce_0003",
        connectionGeneration: 1,
      }),
    ),
  );
  expect(stale.status).toBe(409);
  second.socket.close(1000, "done");
});

test("gameplay ingress closes a socket before repeated frames can grow authority work", async ({
  expect,
}) => {
  const room = await createConnectedRoom("ingress_guard");
  const closed = nextClose(room.hostSocket);
  for (let index = 0; index <= 12; index += 1) {
    room.hostSocket.send(JSON.stringify({ type: "MULTI_READY", v: 1, generation: 1 }));
  }
  await expect(closed).resolves.toMatchObject({ code: 1008, reason: "message rate exceeded" });
  room.playerSocket.close(1000, "done");
});

test("socket attachment and SQLite authority survive eviction and fail closed without D1 room authority", async ({
  expect,
}) => {
  const instanceId = "workers_hibernate_instance_01";
  const ticketClaims = claims(instanceId, {
    jti: "workers_hibernate_nonce_01",
    connectionGeneration: 3,
  });
  const { socket } = await connect(ticketClaims);
  await nextMessage(socket);
  const stub = env.MULTIPLAYER_INSTANCES.get(env.MULTIPLAYER_INSTANCES.idFromName(instanceId));
  await evictDurableObject(stub);

  const closed = nextClose(socket);
  socket.send(JSON.stringify({ type: "MULTI_LEAVE", v: 1, generation: 1 }));
  expect((await closed).code).toBe(1013);
  await runInDurableObject(stub, async (_instance, state) => {
    const row = state.storage.sql
      .exec<{ disconnected_at: number | null }>(
        "SELECT disconnected_at FROM participant_connections WHERE participant_id = ?",
        ticketClaims.participantId,
      )
      .one();
    expect(typeof row.disconnected_at).toBe("number");
    expect(
      state.storage.sql
        .exec<{ lifecycle_status: string }>(
          "SELECT lifecycle_status FROM runtime_meta WHERE singleton = 1",
        )
        .one().lifecycle_status,
    ).toBe("INERT");
  });
});

test("runtime rejects gameplay without matching D1 control-plane state and returns to inert", async ({
  expect,
}) => {
  const instanceId = "workers_inert_instance_00001";
  const { socket } = await connect(
    claims(instanceId, {
      jti: "workers_inert_nonce_000001",
    }),
  );
  await nextMessage(socket);
  const disconnected = nextMessage(socket);
  const closed = nextClose(socket);
  socket.send(JSON.stringify({ type: "MULTI_READY", v: 1, generation: 1 }));
  await expect(disconnected).resolves.toEqual({
    type: "MULTI_DISCONNECTED",
    v: 1,
    generation: 1,
    code: "SERVER_UNAVAILABLE",
  });
  expect((await closed).code).toBe(1013);

  const stub = env.MULTIPLAYER_INSTANCES.get(env.MULTIPLAYER_INSTANCES.idFromName(instanceId));
  await runInDurableObject(stub, async (_instance, state) => {
    expect(
      state.storage.sql
        .exec<{ lifecycle_status: string }>(
          "SELECT lifecycle_status FROM runtime_meta WHERE singleton = 1",
        )
        .one().lifecycle_status,
    ).toBe("INERT");
  });
});

test("the host chooses white inside Omok and the server assigns black's first turn to the opponent", async ({
  expect,
}) => {
  const room = await createConnectedRoom("white-selection");
  const [hostView, playerView] = await readyConnectedRoom(room, "WHITE");
  expect(hostView).toMatchObject({
    type: "MULTI_SYNC",
    revision: 0,
    payload: {
      yourSeatIndex: 1,
      yourStone: "WHITE",
      nextSeatIndex: 0,
      stoneSelection: { status: "LOCKED", canSelect: false },
    },
  });
  expect(playerView).toMatchObject({
    type: "MULTI_SYNC",
    revision: 0,
    payload: {
      yourSeatIndex: 0,
      yourStone: "BLACK",
      nextSeatIndex: 0,
      stoneSelection: { status: "LOCKED", canSelect: false },
    },
  });

  const [hostState, playerState] = await playAcceptedMove(room, {
    actor: "PLAYER",
    clientSeq: 1,
    clientActionId: "workers_white_selection_move_01",
    expectedRevision: 0,
    x: 7,
    y: 7,
  });
  expect(hostState).toMatchObject({
    revision: 1,
    payload: { yourSeatIndex: 1, board: expect.stringContaining("B") },
  });
  expect(playerState).toMatchObject({
    revision: 1,
    payload: { yourSeatIndex: 0, board: expect.stringContaining("B") },
  });
  room.hostSocket.close(1000, "done");
  room.playerSocket.close(1000, "done");
});

test("two D1 participants ready, exchange authoritative Omok actions, reject replay abuse, and resume", async ({
  expect,
}) => {
  const room = await createConnectedRoom("actions");
  const [hostInitial, playerInitial] = await readyConnectedRoom(room);
  expect(hostInitial).toMatchObject({
    type: "MULTI_SYNC",
    generation: 1,
    revision: 0,
    payload: { yourSeatIndex: 0, yourStone: "BLACK", revision: 0 },
  });
  expect(playerInitial).toMatchObject({
    type: "MULTI_SYNC",
    generation: 1,
    revision: 0,
    payload: { yourSeatIndex: 1, yourStone: "WHITE", revision: 0 },
  });
  const activeMatch = await room.matches.findMatchByInstanceGeneration(room.instanceId, 1);
  expect(activeMatch).toMatchObject({
    status: "ACTIVE",
    stateRevision: 0,
  });
  expect(await room.matches.listPlayers(activeMatch?.id ?? "missing")).toHaveLength(2);

  const hostMove = nextMessageWhere(
    room.hostSocket,
    "host revision 1 state",
    (message) => message.type === "MULTI_STATE" && message.revision === 1,
  );
  const playerView = nextMessageWhere(
    room.playerSocket,
    "player revision 1 state",
    (message) => message.type === "MULTI_STATE" && message.revision === 1,
  );
  room.hostSocket.send(
    JSON.stringify({
      type: "MULTI_ACTION",
      v: 1,
      generation: 1,
      clientSeq: 1,
      clientActionId: "workers_action_0001",
      expectedRevision: 0,
      payload: { x: 7, y: 7 },
    }),
  );
  await expect(hostMove).resolves.toMatchObject({
    type: "MULTI_STATE",
    revision: 1,
    payload: { yourSeatIndex: 0, nextSeatIndex: 1, revision: 1 },
  });
  await expect(playerView).resolves.toMatchObject({
    type: "MULTI_STATE",
    revision: 1,
    payload: { yourSeatIndex: 1, nextSeatIndex: 1, revision: 1 },
  });

  const replaySync = nextMessageWhere(
    room.hostSocket,
    "idempotent replay sync",
    (message) => message.type === "MULTI_SYNC" && message.revision === 1,
  );
  room.hostSocket.send(
    JSON.stringify({
      type: "MULTI_ACTION",
      v: 1,
      generation: 1,
      clientSeq: 1,
      clientActionId: "workers_action_0001",
      expectedRevision: 0,
      payload: { y: 7, x: 7 },
    }),
  );
  await expect(replaySync).resolves.toMatchObject({ type: "MULTI_SYNC", revision: 1 });

  const reusedId = nextMessageWhere(
    room.hostSocket,
    "reused action id rejection",
    (message) => message.type === "MULTI_ACTION_REJECTED" && message.code === "ACTION_ID_REUSED",
  );
  room.hostSocket.send(
    JSON.stringify({
      type: "MULTI_ACTION",
      v: 1,
      generation: 1,
      clientSeq: 2,
      clientActionId: "workers_action_0001",
      expectedRevision: 1,
      payload: { x: 8, y: 8 },
    }),
  );
  await expect(reusedId).resolves.toMatchObject({
    type: "MULTI_ACTION_REJECTED",
    clientActionId: "workers_action_0001",
    code: "ACTION_ID_REUSED",
    currentRevision: 1,
  });

  const wrongTurn = nextMessageWhere(
    room.hostSocket,
    "wrong turn rejection",
    (message) => message.type === "MULTI_ACTION_REJECTED" && message.code === "NOT_YOUR_TURN",
  );
  room.hostSocket.send(
    JSON.stringify({
      type: "MULTI_ACTION",
      v: 1,
      generation: 1,
      clientSeq: 3,
      clientActionId: "workers_action_0002",
      expectedRevision: 1,
      payload: { x: 8, y: 8 },
    }),
  );
  await expect(wrongTurn).resolves.toMatchObject({
    type: "MULTI_ACTION_REJECTED",
    code: "NOT_YOUR_TURN",
    currentRevision: 1,
  });

  const hostSecondState = nextMessageWhere(
    room.hostSocket,
    "host revision 2 state",
    (message) => message.type === "MULTI_STATE" && message.revision === 2,
  );
  const playerSecondState = nextMessageWhere(
    room.playerSocket,
    "player revision 2 state",
    (message) => message.type === "MULTI_STATE" && message.revision === 2,
  );
  room.playerSocket.send(
    JSON.stringify({
      type: "MULTI_ACTION",
      v: 1,
      generation: 1,
      clientSeq: 1,
      clientActionId: "workers_action_0003",
      expectedRevision: 1,
      payload: { x: 7, y: 8 },
    }),
  );
  await expect(hostSecondState).resolves.toMatchObject({ type: "MULTI_STATE", revision: 2 });
  await expect(playerSecondState).resolves.toMatchObject({ type: "MULTI_STATE", revision: 2 });

  const match = await room.matches.findMatchByInstanceGeneration(room.instanceId, 1);
  expect(match?.stateRevision).toBe(2);
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM multiplayer_match_actions WHERE match_id = ?",
      )
        .bind(match?.id)
        .first<{ count: number }>()
    )?.count,
  ).toBe(2);

  room.hostSocket.close(1000, "reconnect");
  const nextParticipant = await room.instances.advanceConnectionGeneration({
    instanceId: room.instanceId,
    expectedInstanceGeneration: 1,
    userId: HOST_USER_ID,
    expectedConnectionGeneration: 1,
    nowIso: new Date().toISOString(),
  });
  expect(nextParticipant?.connectionGeneration).toBe(2);
  const stub = env.MULTIPLAYER_INSTANCES.get(env.MULTIPLAYER_INSTANCES.idFromName(room.instanceId));
  await evictDurableObject(stub);
  const resumed = await connect({
    ...room.hostClaims,
    jti: `workers_resume_${crypto.randomUUID()}`,
    connectionGeneration: 2,
  });
  await expect(
    nextMessage(resumed.socket, "resumed connected acknowledgement"),
  ).resolves.toMatchObject({
    type: "MULTI_CONNECTED",
    connectionGeneration: 2,
  });
  await expect(nextMessage(resumed.socket, "resumed state sync")).resolves.toMatchObject({
    type: "MULTI_SYNC",
    revision: 2,
    payload: { yourSeatIndex: 0, nextSeatIndex: 0 },
  });
  resumed.socket.close(1000, "done");
  room.playerSocket.close(1000, "done");
});

test("server-authoritative Omok win commits exact D1 results and opens the rematch window", async ({
  expect,
}) => {
  const room = await createConnectedRoom("terminal");
  await readyConnectedRoom(room);
  const moves = [
    { actor: "HOST", clientSeq: 1, x: 0, y: 0 },
    { actor: "PLAYER", clientSeq: 1, x: 0, y: 1 },
    { actor: "HOST", clientSeq: 2, x: 1, y: 0 },
    { actor: "PLAYER", clientSeq: 2, x: 1, y: 1 },
    { actor: "HOST", clientSeq: 3, x: 2, y: 0 },
    { actor: "PLAYER", clientSeq: 3, x: 2, y: 1 },
    { actor: "HOST", clientSeq: 4, x: 3, y: 0 },
    { actor: "PLAYER", clientSeq: 4, x: 3, y: 1 },
    { actor: "HOST", clientSeq: 5, x: 4, y: 0 },
  ] as const;

  for (let index = 0; index < moves.length - 1; index += 1) {
    const move = moves[index];
    if (!move) throw new Error("missing terminal test move");
    const [hostState, playerState] = await playAcceptedMove(room, {
      ...move,
      clientActionId: `workers_terminal_action_${String(index + 1).padStart(2, "0")}`,
      expectedRevision: index,
    });
    expect(hostState).toMatchObject({
      type: "MULTI_STATE",
      revision: index + 1,
      payload: { status: "ACTIVE", revision: index + 1 },
    });
    expect(playerState).toMatchObject({
      type: "MULTI_STATE",
      revision: index + 1,
      payload: { status: "ACTIVE", revision: index + 1 },
    });
  }

  const hostTerminalMessages = collectMessages(room.hostSocket, 3);
  const playerTerminalMessages = collectMessages(room.playerSocket, 3);
  const finalMove = moves[8];
  room.hostSocket.send(
    JSON.stringify({
      type: "MULTI_ACTION",
      v: 1,
      generation: 1,
      clientSeq: finalMove.clientSeq,
      clientActionId: "workers_terminal_action_09",
      expectedRevision: 8,
      payload: { x: finalMove.x, y: finalMove.y },
    }),
  );
  const [hostMessages, playerMessages] = (await Promise.all([
    hostTerminalMessages,
    playerTerminalMessages,
  ])) as readonly [Record<string, unknown>[], Record<string, unknown>[]];
  for (const messages of [hostMessages, playerMessages]) {
    expect(messages.map((message) => message.type)).toEqual([
      "MULTI_STATE",
      "MULTI_TERMINAL_PENDING",
      "MULTI_TERMINAL_COMMITTED",
    ]);
    expect(messages[0]).toMatchObject({
      revision: 9,
      payload: { status: "WON", winnerSeatIndex: 0, revision: 9 },
    });
    expect(messages[2]).toMatchObject({
      result: { kind: "WIN", winnerSeatIndex: 0, loserSeatIndex: 1, revision: 9 },
    });
    const serverSequences = messages.map((message) => Number(message.serverSeq));
    expect(
      serverSequences.every(
        (serverSequence, index) => index === 0 || serverSequence > serverSequences[index - 1]!,
      ),
    ).toBe(true);
  }

  const match = await room.matches.findMatchByInstanceGeneration(room.instanceId, 1);
  expect(match).toMatchObject({ status: "COMMITTED", stateRevision: 9, abortCode: null });
  expect(JSON.parse(match?.terminalResultJson ?? "null")).toMatchObject({
    kind: "WIN",
    winnerSeatIndex: 0,
    loserSeatIndex: 1,
    revision: 9,
  });
  const players = await room.matches.listPlayers(match?.id ?? "missing");
  expect(Object.fromEntries(players.map((player) => [player.userId, player.outcome]))).toEqual({
    [HOST_USER_ID]: "WIN",
    [PLAYER_USER_ID]: "LOSS",
  });
  expect(players.every((player) => player.resultStatus === "COMMITTED")).toBe(true);
  expect(await room.instances.findById(room.instanceId)).toMatchObject({
    status: "CLOSING",
    abortCode: null,
  });
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM multiplayer_reward_outbox WHERE match_id = ?",
      )
        .bind(match?.id)
        .first<{ count: number }>()
    )?.count,
  ).toBe(0);

  const stub = env.MULTIPLAYER_INSTANCES.get(env.MULTIPLAYER_INSTANCES.idFromName(room.instanceId));
  await runInDurableObject(stub, async (_instance, state) => {
    expect(
      state.storage.sql
        .exec<{ lifecycle_status: string }>(
          "SELECT lifecycle_status FROM runtime_meta WHERE singleton = 1",
        )
        .one().lifecycle_status,
    ).toBe("CLOSED");
    expect(
      state.storage.sql
        .exec<{ revision: number; lifecycle_status: string }>(
          "SELECT revision, lifecycle_status FROM runtime_match",
        )
        .one(),
    ).toEqual({ revision: 9, lifecycle_status: "COMMITTED" });
    expect(
      state.storage.sql
        .exec<{ generation: number }>("SELECT generation FROM rematch_window WHERE singleton = 1")
        .one().generation,
    ).toBe(1);
  });
  const hostRematchChanged = nextMessageWhere(
    room.hostSocket,
    "host rematch changed event",
    (message) => message.name === MULTIPLAYER_REMATCH_CHANGED_EVENT,
  );
  const playerRematchChanged = nextMessageWhere(
    room.playerSocket,
    "player rematch changed event",
    (message) => message.name === MULTIPLAYER_REMATCH_CHANGED_EVENT,
  );
  expect((await stub.fetch(internalRematchNotificationRequest(1))).status).toBe(204);
  await expect(hostRematchChanged).resolves.toMatchObject({
    type: "MULTI_EVENT",
    generation: 1,
    name: MULTIPLAYER_REMATCH_CHANGED_EVENT,
    payload: {},
  });
  await expect(playerRematchChanged).resolves.toMatchObject({
    type: "MULTI_EVENT",
    generation: 1,
    name: MULTIPLAYER_REMATCH_CHANGED_EVENT,
    payload: {},
  });
  room.hostSocket.close(1000, "done");
  room.playerSocket.close(1000, "done");
});

test("reconnect repairs a D1-committed action missing from the DO checkpoint", async ({
  expect,
}) => {
  const room = await createConnectedRoom("recovery-gap");
  await readyConnectedRoom(room);
  await playAcceptedMove(room, {
    actor: "HOST",
    clientSeq: 1,
    clientActionId: "workers_gap_action_01",
    expectedRevision: 0,
    x: 7,
    y: 7,
  });
  await playAcceptedMove(room, {
    actor: "PLAYER",
    clientSeq: 1,
    clientActionId: "workers_gap_action_02",
    expectedRevision: 1,
    x: 7,
    y: 8,
  });

  const match = await room.matches.findMatchByInstanceGeneration(room.instanceId, 1);
  if (!match) throw new Error("active recovery match missing");
  let recoveryState = createInitialOmokState();
  for (const [seatIndex, action] of [
    [0, { x: 7, y: 7 }],
    [1, { x: 7, y: 8 }],
    [0, { x: 8, y: 7 }],
  ] as const) {
    const transition = applyOmokAction(recoveryState, seatIndex, action, recoveryState.revision);
    if (!transition.ok) throw new Error(`failed to build recovery fixture: ${transition.code}`);
    recoveryState = transition.state;
  }
  const latestAction = await room.matches.findLatestAction(match.id);
  const gapServerSeq = (latestAction?.serverSeq ?? 0) + 1;
  const recordedGap = await room.matches.recordAction({
    matchId: match.id,
    userId: HOST_USER_ID,
    participantId: room.hostClaims.participantId,
    clientSeq: 2,
    serverSeq: gapServerSeq,
    clientActionId: "workers_gap_action_03",
    payloadHash: "a".repeat(64),
    expectedRevision: 2,
    resultRevision: 3,
    resultCode: "ACCEPTED",
    responseJson: encodeOmokActionLedgerResponse({
      schemaVersion: OMOK_ACTION_LEDGER_SCHEMA_VERSION,
      kind: "ACCEPTED",
      generation: 1,
      serverSeq: gapServerSeq,
      clientActionId: "workers_gap_action_03",
      revision: 3,
      state: recoveryState,
    }),
    nowIso: new Date().toISOString(),
  });
  expect(recordedGap.status).toBe("RECORDED");
  expect((await room.matches.findMatch(match.id))?.stateRevision).toBe(3);

  const stub = env.MULTIPLAYER_INSTANCES.get(env.MULTIPLAYER_INSTANCES.idFromName(room.instanceId));
  await runInDurableObject(stub, async (_instance, state) => {
    expect(
      state.storage.sql.exec<{ revision: number }>("SELECT revision FROM runtime_match").one()
        .revision,
    ).toBe(2);
  });
  room.hostSocket.close(1000, "recovery");
  room.playerSocket.close(1000, "recovery");
  const nextParticipant = await room.instances.advanceConnectionGeneration({
    instanceId: room.instanceId,
    expectedInstanceGeneration: 1,
    userId: HOST_USER_ID,
    expectedConnectionGeneration: 1,
    nowIso: new Date().toISOString(),
  });
  expect(nextParticipant?.connectionGeneration).toBe(2);
  await evictDurableObject(stub);

  const resumed = await connect({
    ...room.hostClaims,
    jti: `workers_gap_resume_${crypto.randomUUID()}`,
    connectionGeneration: 2,
  });
  await expect(
    nextMessage(resumed.socket, "gap recovery connected acknowledgement"),
  ).resolves.toMatchObject({ type: "MULTI_CONNECTED", connectionGeneration: 2 });
  await expect(nextMessage(resumed.socket, "gap recovery state sync")).resolves.toMatchObject({
    type: "MULTI_SYNC",
    revision: 3,
    payload: {
      revision: 3,
      status: "ACTIVE",
      nextSeatIndex: 1,
      lastMove: { x: 8, y: 7, seatIndex: 0 },
    },
  });
  await runInDurableObject(stub, async (_instance, state) => {
    expect(
      state.storage.sql.exec<{ revision: number }>("SELECT revision FROM runtime_match").one()
        .revision,
    ).toBe(3);
  });
  resumed.socket.close(1000, "done");
});

test("explicit leave is an immediate server-authoritative forfeit without rewards", async ({
  expect,
}) => {
  const room = await createConnectedRoom("leave");
  await readyConnectedRoom(room);
  const hostTerminal = nextMessageWhere(
    room.hostSocket,
    "host participant-left terminal",
    (message) => message.type === "MULTI_TERMINAL_COMMITTED",
  );
  const playerTerminal = nextMessageWhere(
    room.playerSocket,
    "player participant-left terminal",
    (message) => message.type === "MULTI_TERMINAL_COMMITTED",
  );
  room.hostSocket.send(JSON.stringify({ type: "MULTI_LEAVE", v: 1, generation: 1 }));
  await expect(hostTerminal).resolves.toMatchObject({
    type: "MULTI_TERMINAL_COMMITTED",
    result: { kind: "FORFEIT", loserParticipantId: room.hostClaims.participantId, reason: "LEFT" },
  });
  await expect(playerTerminal).resolves.toMatchObject({
    type: "MULTI_TERMINAL_COMMITTED",
    result: {
      kind: "FORFEIT",
      winnerParticipantId: room.playerClaims.participantId,
      reason: "LEFT",
    },
  });

  await expect
    .poll(async () => (await room.instances.findById(room.instanceId))?.status)
    .toBe("CLOSED");
  expect(await room.instances.findById(room.instanceId)).toMatchObject({
    status: "CLOSED",
    abortCode: null,
  });
  const match = await room.matches.findMatchByInstanceGeneration(room.instanceId, 1);
  expect(match).toMatchObject({ status: "COMMITTED", abortCode: null });
  const players = await room.matches.listPlayers(match?.id ?? "missing");
  expect(players).toHaveLength(2);
  expect(
    players.find((player) => player.participantId === room.hostClaims.participantId),
  ).toMatchObject({
    resultStatus: "COMMITTED",
    outcome: "LOSS",
  });
  expect(
    players.find((player) => player.participantId === room.playerClaims.participantId),
  ).toMatchObject({
    resultStatus: "COMMITTED",
    outcome: "WIN",
  });
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM multiplayer_reward_outbox WHERE match_id = ?",
      )
        .bind(match?.id)
        .first<{ count: number }>()
    )?.count,
  ).toBe(0);
});

test("authenticated HTTP leave uses the same authoritative forfeit path", async ({ expect }) => {
  const room = await createConnectedRoom("http-leave");
  await readyConnectedRoom(room);
  const playerTerminal = nextMessageWhere(
    room.playerSocket,
    "HTTP leave terminal",
    (message) => message.type === "MULTI_TERMINAL_COMMITTED",
  );
  const stub = env.MULTIPLAYER_INSTANCES.get(env.MULTIPLAYER_INSTANCES.idFromName(room.instanceId));

  const response = await stub.fetch(internalLeaveRequest(room.instanceId, HOST_USER_ID, 1));
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ ok: true, replayed: false });
  await expect(playerTerminal).resolves.toMatchObject({
    type: "MULTI_TERMINAL_COMMITTED",
    result: {
      kind: "FORFEIT",
      winnerParticipantId: room.playerClaims.participantId,
      loserParticipantId: room.hostClaims.participantId,
      reason: "LEFT",
    },
  });
  await expect
    .poll(async () => (await room.instances.findById(room.instanceId))?.status)
    .toBe("CLOSED");
  expect(await room.instances.findById(room.instanceId)).toMatchObject({
    status: "CLOSED",
    abortCode: null,
  });
  expect(await room.matches.findMatchByInstanceGeneration(room.instanceId, 1)).toMatchObject({
    status: "COMMITTED",
    abortCode: null,
  });
});

test("HTTP leave initializes authority before the first gameplay socket opens", async ({
  expect,
}) => {
  const { rooms, instances, matches } = roomHarness();
  const created = await rooms.createRoom({
    userId: HOST_USER_ID,
    gameSlug: GAME_SLUG,
    visibility: "PRIVATE",
    joinPolicy: "OPEN",
    idempotencyKey: "workers_http_no_socket_000001",
  });
  if (!created.ok) throw new Error(`room create failed: ${created.code}`);
  const joined = await rooms.joinRoom({
    userId: PLAYER_USER_ID,
    publicCode: created.instance.publicCode,
    inviteToken: null,
  });
  if (!joined.ok) throw new Error(`room join failed: ${joined.code}`);
  const started = await rooms.startRoom({
    userId: HOST_USER_ID,
    instanceId: created.instance.id,
    expectedGeneration: created.instance.generation,
  });
  if (!started.ok) throw new Error(`room start failed: ${started.code}`);

  const stub = env.MULTIPLAYER_INSTANCES.get(
    env.MULTIPLAYER_INSTANCES.idFromName(created.instance.id),
  );
  const response = await stub.fetch(
    internalLeaveRequest(created.instance.id, HOST_USER_ID, created.instance.generation),
  );
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ ok: true, replayed: false });
  expect(await instances.findById(created.instance.id)).toMatchObject({
    status: "CLOSED",
    abortCode: null,
  });
  const match = await matches.findMatchByInstanceGeneration(created.instance.id, 1);
  expect(match).toMatchObject({ status: "COMMITTED", abortCode: null });
  expect(JSON.parse(match?.terminalResultJson ?? "null")).toMatchObject({
    kind: "FORFEIT",
    loserParticipantId: created.participant.id,
    winnerParticipantId: joined.participant.id,
    reason: "LEFT",
  });
});

test("HTTP leave also closes a lobby that never created runtime state", async ({ expect }) => {
  const { rooms, instances } = roomHarness();
  const created = await rooms.createRoom({
    userId: HOST_USER_ID,
    gameSlug: GAME_SLUG,
    visibility: "PRIVATE",
    joinPolicy: "OPEN",
    idempotencyKey: "workers_lobby_leave_00000001",
  });
  if (!created.ok) throw new Error(`room create failed: ${created.code}`);
  const stub = env.MULTIPLAYER_INSTANCES.get(
    env.MULTIPLAYER_INSTANCES.idFromName(created.instance.id),
  );
  const response = await stub.fetch(
    internalLeaveRequest(created.instance.id, HOST_USER_ID, created.instance.generation),
  );
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ ok: true, replayed: false });
  expect(await instances.findById(created.instance.id)).toMatchObject({
    status: "ABORTED",
    abortCode: "INSUFFICIENT_PLAYERS",
  });
});

test("network loss announces a 30 second grace and then commits a forfeit win", async ({
  expect,
}) => {
  const room = await createConnectedRoom("disconnect-grace");
  await readyConnectedRoom(room);
  const reconnecting = nextMessageWhere(
    room.hostSocket,
    "opponent reconnect grace",
    (message) =>
      message.type === "MULTI_EVENT" &&
      message.name === MULTIPLAYER_PLAYER_CONNECTION_CHANGED_EVENT &&
      (message.payload as { status?: string } | undefined)?.status === "RECONNECTING",
  );
  const disconnectedAt = Date.now();
  room.playerSocket.close(1011, "network lost");
  const reconnectingMessage = await reconnecting;
  expect(reconnectingMessage).toMatchObject({
    payload: {
      participantId: room.playerClaims.participantId,
      status: "RECONNECTING",
    },
  });
  const reconnectDeadlineAt = (reconnectingMessage.payload as { reconnectDeadlineAt?: unknown })
    .reconnectDeadlineAt;
  expect(typeof reconnectDeadlineAt).toBe("string");
  expect(Date.parse(String(reconnectDeadlineAt))).toBeGreaterThanOrEqual(disconnectedAt + 30_000);

  const committed = nextMessageWhere(
    room.hostSocket,
    "disconnect forfeit commit",
    (message) => message.type === "MULTI_TERMINAL_COMMITTED",
  );
  const stub = env.MULTIPLAYER_INSTANCES.get(env.MULTIPLAYER_INSTANCES.idFromName(room.instanceId));
  await expect
    .poll(async () =>
      runInDurableObject(stub, async (_instance, state) => {
        const scheduled = await state.storage.getAlarm();
        return (
          typeof scheduled === "number" &&
          scheduled <= Date.parse(String(reconnectDeadlineAt)) + 1_000
        );
      }),
    )
    .toBe(true);
  await runInDurableObject(stub, async (_instance, state) => {
    state.storage.sql.exec(
      `UPDATE participant_connections
       SET disconnected_at = ?
       WHERE participant_id = ?`,
      Math.floor(Date.now() / 1_000) - 31,
      room.playerClaims.participantId,
    );
    // Keep it in the future so the test helper, rather than the runtime's immediate-alarm queue,
    // deterministically invokes the real alarm handler.
    await state.storage.setAlarm(Date.now() + 60_000);
  });
  expect(await runDurableObjectAlarm(stub)).toBe(true);
  await expect(committed).resolves.toMatchObject({
    type: "MULTI_TERMINAL_COMMITTED",
    result: {
      kind: "FORFEIT",
      winnerParticipantId: room.hostClaims.participantId,
      loserParticipantId: room.playerClaims.participantId,
      reason: "DISCONNECTED",
    },
  });
  expect(await room.matches.findMatchByInstanceGeneration(room.instanceId, 1)).toMatchObject({
    status: "COMMITTED",
  });
  room.hostSocket.close(1000, "done");
});

test("two timed-out participants abort the match without inventing a winner", async ({
  expect,
}) => {
  const room = await createConnectedRoom("both-disconnected");
  await readyConnectedRoom(room);
  const stub = env.MULTIPLAYER_INSTANCES.get(env.MULTIPLAYER_INSTANCES.idFromName(room.instanceId));
  room.hostSocket.close(1011, "host network lost");
  room.playerSocket.close(1011, "player network lost");
  await expect
    .poll(() =>
      runInDurableObject(
        stub,
        async (_instance, state) =>
          state.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM participant_connections WHERE disconnected_at IS NOT NULL",
            )
            .one().count,
      ),
    )
    .toBe(2);

  await runInDurableObject(stub, async (instance, state) => {
    state.storage.sql.exec(
      "UPDATE participant_connections SET disconnected_at = ?",
      Math.floor(Date.now() / 1_000) - 31,
    );
    await instance.alarm();
  });
  expect(await room.instances.findById(room.instanceId)).toMatchObject({
    status: "ABORTED",
    abortCode: "PARTICIPANT_LEFT",
  });
  const match = await room.matches.findMatchByInstanceGeneration(room.instanceId, 1);
  expect(match).toMatchObject({
    status: "ABORTED",
    terminalResultJson: null,
    abortCode: "PARTICIPANT_LEFT",
  });
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM multiplayer_reward_outbox WHERE match_id = ?",
      )
        .bind(match?.id)
        .first<{ count: number }>()
    )?.count,
  ).toBe(0);
});

test("a terminal match never re-arms a reconnect deadline", async ({ expect }) => {
  const room = await createConnectedRoom("terminal-stale-disconnect");
  await readyConnectedRoom(room);
  const stub = env.MULTIPLAYER_INSTANCES.get(env.MULTIPLAYER_INSTANCES.idFromName(room.instanceId));

  await runInDurableObject(stub, async (instance, state) => {
    state.storage.sql.exec(
      "UPDATE runtime_match SET lifecycle_status = 'COMMITTED' WHERE singleton = 1",
    );
    state.storage.sql.exec(
      "UPDATE participant_connections SET disconnected_at = ?",
      Math.floor(Date.now() / 1_000),
    );
    state.storage.sql.exec("DELETE FROM consumed_ticket_nonces");
    state.storage.sql.exec("DELETE FROM rematch_window");
    await state.storage.deleteAlarm();

    await instance.alarm();

    expect(await state.storage.getAlarm()).toBeNull();
  });
  room.hostSocket.close(1000, "done");
  room.playerSocket.close(1000, "done");
});

test("a match participant who never establishes presence still receives the same grace", async ({
  expect,
}) => {
  const room = await createConnectedRoom("missing-presence");
  await readyConnectedRoom(room);
  const stub = env.MULTIPLAYER_INSTANCES.get(env.MULTIPLAYER_INSTANCES.idFromName(room.instanceId));

  await runInDurableObject(stub, async (_instance, state) => {
    for (const socket of state.getWebSockets(`participant:${room.playerClaims.participantId}`)) {
      socket.close(1011, "browser stopped before runtime mount");
    }
    state.storage.sql.exec(
      "DELETE FROM participant_connections WHERE participant_id = ?",
      room.playerClaims.participantId,
    );
  });

  const resumedHostParticipant = await room.instances.advanceConnectionGeneration({
    instanceId: room.instanceId,
    expectedInstanceGeneration: 1,
    userId: HOST_USER_ID,
    expectedConnectionGeneration: room.hostClaims.connectionGeneration,
    nowIso: new Date().toISOString(),
  });
  if (!resumedHostParticipant) throw new Error("host reconnection generation failed");
  const resumedHost = await connect(
    claims(room.instanceId, {
      ...room.hostClaims,
      jti: `workers_missing_presence_${crypto.randomUUID()}`,
      connectionGeneration: resumedHostParticipant.connectionGeneration,
    }),
  );
  await expect(
    nextMessage(resumedHost.socket, "resumed host acknowledgement"),
  ).resolves.toMatchObject({
    type: "MULTI_CONNECTED",
    connectionGeneration: resumedHostParticipant.connectionGeneration,
  });
  const missingPresence = await nextMessageWhere(
    resumedHost.socket,
    "missing player reconnect grace",
    (message) =>
      message.type === "MULTI_EVENT" &&
      message.name === MULTIPLAYER_PLAYER_CONNECTION_CHANGED_EVENT &&
      (message.payload as { participantId?: string; status?: string } | undefined)
        ?.participantId === room.playerClaims.participantId &&
      (message.payload as { status?: string } | undefined)?.status === "RECONNECTING",
  );
  expect(missingPresence).toMatchObject({
    payload: {
      participantId: room.playerClaims.participantId,
      status: "RECONNECTING",
    },
  });

  const committed = nextMessageWhere(
    resumedHost.socket,
    "missing player forfeit commit",
    (message) => message.type === "MULTI_TERMINAL_COMMITTED",
  );
  await runInDurableObject(stub, async (instance, state) => {
    state.storage.sql.exec(
      `UPDATE participant_connections
       SET disconnected_at = ?
       WHERE participant_id = ?`,
      Math.floor(Date.now() / 1_000) - 31,
      room.playerClaims.participantId,
    );
    await instance.alarm();
  });
  await expect(committed).resolves.toMatchObject({
    result: {
      kind: "FORFEIT",
      winnerParticipantId: room.hostClaims.participantId,
      loserParticipantId: room.playerClaims.participantId,
      reason: "DISCONNECTED",
    },
  });
  resumedHost.socket.close(1000, "done");
});

test("DO rejects expired and cross-instance claims without accepting a socket", async ({
  expect,
}) => {
  const instanceId = "workers_context_instance_001";
  const stub = env.MULTIPLAYER_INSTANCES.get(env.MULTIPLAYER_INSTANCES.idFromName(instanceId));
  const now = Math.floor(Date.now() / 1000);
  const expired = await stub.fetch(
    internalRequest(
      claims(instanceId, {
        iat: now - 20,
        exp: now - 1,
        jti: "workers_expired_nonce_001",
      }),
    ),
  );
  expect(expired.status).toBe(401);
  expect(expired.webSocket).toBeNull();

  const active = await connect(
    claims(instanceId, {
      jti: "workers_context_nonce_0001",
    }),
  );
  await nextMessage(active.socket);
  const mismatch = await stub.fetch(
    internalRequest(
      claims("different_instance_workers_01", {
        jti: "workers_context_nonce_0002",
      }),
    ),
  );
  expect(mismatch.status).toBe(409);
  expect(mismatch.webSocket).toBeNull();
  active.socket.close(1000, "done");
});
