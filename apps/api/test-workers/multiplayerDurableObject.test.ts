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
  GAME_CANONICAL_SCHEMA_VERSION,
  MULTIPLAYER_TICKET_AUDIENCE,
  MULTIPLAYER_TICKET_ISSUER,
  MULTIPLAYER_WEBSOCKET_PROTOCOL,
  MultiplayerRoomUseCases,
  type RuntimeGame,
  type RuntimeGameRegistry,
  type MultiplayerJoinTicketClaims,
  type MultiplayerRelayJoinTicketClaims,
  type MultiplayerRelayTicketRuntimeV1,
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
  decodeVerifiedMultiplayerClaims,
  encodeVerifiedMultiplayerClaims,
} from "../src/multiplayer/internalProtocol.js";
import {
  classifyRelayDeliveryBackpressure,
  consumeRelayConnectionEnvelope,
  createRelayConnectionAttachment,
} from "../src/multiplayer/RelayRuntimeSession.js";

const GAME_ID = 81_001;
const GAME_VERSION_ID = 81_002;
const PROFILE_ID = 81_003;
const PROFILE_REQUEST_ID = 81_004;
const HOST_USER_ID = 81_011;
const PLAYER_USER_IDS = [81_012, 81_014, 81_015, 81_016, 81_017, 81_018, 81_019] as const;
const PLAYER_USER_ID = PLAYER_USER_IDS[0];
const ADMIN_USER_ID = 81_013;
const CONTENT_HASH = "a".repeat(64);
const REQUEST_HASH = "b".repeat(64);
const GAME_SLUG = "workers-relay-demo";

test("Relay delivery backpressure closes bounded and pathological consumers", ({ expect }) => {
  expect(classifyRelayDeliveryBackpressure(0)).toBe("send");
  expect(classifyRelayDeliveryBackpressure(32 * 1024 - 1)).toBe("send");
  expect(classifyRelayDeliveryBackpressure(32 * 1024)).toBe("close");
  expect(classifyRelayDeliveryBackpressure(Number.NaN)).toBe("close");
});

test("Relay token bucket sustains 20Hz jitter while retaining a bounded burst", ({ expect }) => {
  let serialized: unknown;
  const socket = {
    serializeAttachment(value: unknown) {
      serialized = value;
    },
  } as unknown as WebSocket;
  let attachment = createRelayConnectionAttachment({
    participantId: "participant_rate_0001",
    generation: 1,
    connectionGeneration: 1,
  });
  let nowMs = 10_000;
  for (let clientSeq = 1; clientSeq <= 200; clientSeq += 1) {
    const next = consumeRelayConnectionEnvelope(socket, attachment, clientSeq, 20, nowMs);
    expect(next).not.toBeNull();
    attachment = next!;
    // Sustained 20Hz with only +/-1ms timer jitter can place 21 messages inside the fixed window
    // that begins with the first message. A token bucket accepts this while preserving 20Hz long
    // term: each 40-interval cycle remains exactly two seconds.
    nowMs += (clientSeq - 1) % 40 < 20 ? 49 : 51;
  }
  const cooldownControl = consumeRelayConnectionEnvelope(
    socket,
    attachment,
    201,
    20,
    nowMs + 1_500,
  );
  expect(cooldownControl).not.toBeNull();
  expect(serialized).toEqual(cooldownControl);

  let burstAttachment = createRelayConnectionAttachment({
    participantId: "participant_burst_0001",
    generation: 1,
    connectionGeneration: 1,
  });
  for (let clientSeq = 1; clientSeq <= 20; clientSeq += 1) {
    const next = consumeRelayConnectionEnvelope(socket, burstAttachment, clientSeq, 20, 20_000);
    expect(next).not.toBeNull();
    burstAttachment = next!;
  }
  expect(consumeRelayConnectionEnvelope(socket, burstAttachment, 21, 20, 20_000)).toBeNull();
});

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  const nowIso = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO users (id, nickname) VALUES (?, ?)").bind(
      HOST_USER_ID,
      "Workers Host",
    ),
    ...PLAYER_USER_IDS.map((userId, index) =>
      env.DB.prepare("INSERT OR IGNORE INTO users (id, nickname) VALUES (?, ?)").bind(
        userId,
        `Workers Player ${index + 1}`,
      ),
    ),
    env.DB.prepare("INSERT OR IGNORE INTO users (id, nickname) VALUES (?, ?)").bind(
      ADMIN_USER_ID,
      "Workers Admin",
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
    .bind(GAME_VERSION_ID, GAME_ID, "uploads/81001/workers-relay.zip", CONTENT_HASH, nowIso)
    .run();
  await env.DB.prepare("UPDATE games SET live_version_id = ?, visibility = 'PUBLIC' WHERE id = ?")
    .bind(GAME_VERSION_ID, GAME_ID)
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO admin_accounts (
       id, user_id, google_sub, username, password_hash, role, status,
       must_change_password, created_at, updated_at, password_changed_at
     ) VALUES (?, ?, 'workers-admin', 'workersadmin', 'hash', 'ADMIN', 'ACTIVE', 0, ?, ?, ?)`,
  )
    .bind(ADMIN_USER_ID, ADMIN_USER_ID, nowIso, nowIso, nowIso)
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO multiplayer_profile_requests (
       id, game_id, game_version_id, content_hash, request_schema_version, request_hash,
       request_json, requested_by_user_id, status, reviewed_by_admin_id, reviewed_at,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, 1, ?, '{}', NULL, 'APPROVED', ?, ?, ?, ?)`,
  )
    .bind(
      PROFILE_REQUEST_ID,
      GAME_ID,
      GAME_VERSION_ID,
      CONTENT_HASH,
      REQUEST_HASH,
      ADMIN_USER_ID,
      nowIso,
      nowIso,
      nowIso,
    )
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO multiplayer_profiles (
       id, source_request_id, source_request_hash, profile_version, game_id, game_version_id,
       profile_revision, protocol_version, resolved_class, simulation_model, runtime_backend,
       ruleset_key, ruleset_revision, resolved_config_json, lifecycle, persistence,
       latency_profile, reconnect_policy, min_players, max_players, allowed_visibility_json,
       allowed_join_policies_json, max_action_bytes, max_state_bytes, action_rate_limit,
       reward_policy_id, enabled, created_by_admin_id, approved_at, updated_at,
       profile_kind, content_hash, transport_kind, runtime_kind, direct_messages, host_snapshot,
       host_departure_policy, result_trust, max_message_bytes, max_snapshot_bytes,
       messages_per_second, room_bytes_per_second, room_ttl_seconds
     ) VALUES (
       ?, ?, ?, 1, ?, ?, 1, 1, 'M1', 'event', 'durable-object',
       'relay:transport-only', 1, '{}', 'match', 'match', 'relaxed', 'resume',
       2, 8, '["PRIVATE"]', '["OPEN"]', 4096, 1, 20, NULL, 0, ?, ?, ?,
       'RELAY', ?, 'websocket', 'relay', 1, 1, 'close', 'UNVERIFIED',
       4096, 16384, 20, 262144, 7200
     )`,
  )
    .bind(
      PROFILE_ID,
      PROFILE_REQUEST_ID,
      REQUEST_HASH,
      GAME_ID,
      GAME_VERSION_ID,
      ADMIN_USER_ID,
      nowIso,
      nowIso,
      CONTENT_HASH,
    )
    .run();
  await env.DB.prepare("UPDATE multiplayer_profiles SET enabled = 1, updated_at = ? WHERE id = ?")
    .bind(nowIso, PROFILE_ID)
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
      objectKey: "uploads/81001/workers-relay.zip",
      contentHash: CONTENT_HASH,
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
      schemaVersion: GAME_CANONICAL_SCHEMA_VERSION,
      slug: GAME_SLUG,
      title: "Workers Relay Demo",
      shortDescription: "2~8인 Relay DO 통합 테스트",
      description: "게임 규칙 비해석 Relay",
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
        maxPlayers: 8,
        thumbnail: "/api/games/workers-relay-demo/logo",
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

function relayClaims(
  instanceId: string,
  overrides: Partial<Omit<MultiplayerRelayJoinTicketClaims, "runtime">> = {},
  runtimeOverrides: Partial<MultiplayerRelayTicketRuntimeV1> = {},
): MultiplayerRelayJoinTicketClaims {
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
    gameVersionId: GAME_VERSION_ID,
    profileId: PROFILE_ID,
    profileRevision: 1,
    generation: 1,
    connectionGeneration: 1,
    seatIndex: 0,
    role: "HOST",
    contentHash: CONTENT_HASH,
    runtime: {
      kind: "relay",
      protocolVersion: 1,
      reconnect: "resume",
      directMessages: true,
      hostSnapshot: true,
      maxMessageBytes: 4 * 1024,
      maxSnapshotBytes: 16 * 1024,
      messagesPerSecond: 20,
      roomBytesPerSecond: 256 * 1024,
      roomTtlSeconds: 2 * 60 * 60,
      hostDeparturePolicy: "close",
      resultTrust: "UNVERIFIED",
      ...runtimeOverrides,
    },
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

async function createRelayRoomAuthority(
  key: string,
  runtimeOverrides: Partial<MultiplayerRelayTicketRuntimeV1> = {},
): Promise<{
  readonly instanceId: string;
  readonly hostClaims: MultiplayerRelayJoinTicketClaims;
  readonly playerClaims: MultiplayerRelayJoinTicketClaims;
  readonly matches: D1MultiplayerMatchRepository;
  readonly instances: D1MultiplayerInstanceRepository;
}> {
  const { rooms, instances, matches } = roomHarness();
  const created = await rooms.createRoom({
    userId: HOST_USER_ID,
    gameSlug: GAME_SLUG,
    visibility: "PRIVATE",
    joinPolicy: "OPEN",
    idempotencyKey: `workers_relay_${key}_00000001`,
  });
  if (!created.ok) throw new Error(`Relay room create failed: ${created.code}`);
  const joined = await rooms.joinRoom({
    userId: PLAYER_USER_ID,
    publicCode: created.instance.publicCode,
    inviteToken: null,
  });
  if (!joined.ok) throw new Error(`Relay room join failed: ${joined.code}`);
  const started = await rooms.startRoom({
    userId: HOST_USER_ID,
    instanceId: created.instance.id,
    expectedGeneration: created.instance.generation,
  });
  if (!started.ok) throw new Error(`Relay room start failed: ${started.code}`);

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
  if (!hostParticipant || !playerParticipant) {
    throw new Error("Relay connection generation failed");
  }
  const hostClaims = relayClaims(
    created.instance.id,
    {
      participantId: hostParticipant.id,
      userId: HOST_USER_ID,
      gameVersionId: GAME_VERSION_ID,
      profileId: PROFILE_ID,
      profileRevision: 1,
      generation: created.instance.generation,
      connectionGeneration: hostParticipant.connectionGeneration,
      seatIndex: hostParticipant.seatIndex,
      role: "HOST",
    },
    runtimeOverrides,
  );
  const playerClaims = relayClaims(
    created.instance.id,
    {
      participantId: playerParticipant.id,
      userId: PLAYER_USER_ID,
      gameVersionId: GAME_VERSION_ID,
      profileId: PROFILE_ID,
      profileRevision: 1,
      generation: created.instance.generation,
      connectionGeneration: playerParticipant.connectionGeneration,
      seatIndex: playerParticipant.seatIndex,
      role: "PLAYER",
    },
    runtimeOverrides,
  );
  return {
    instanceId: created.instance.id,
    hostClaims,
    playerClaims,
    matches,
    instances,
  };
}

async function createConnectedRelayRoom(
  key: string,
  runtimeOverrides: Partial<MultiplayerRelayTicketRuntimeV1> = {},
): Promise<{
  readonly instanceId: string;
  readonly hostClaims: MultiplayerRelayJoinTicketClaims;
  readonly playerClaims: MultiplayerRelayJoinTicketClaims;
  readonly hostSocket: WebSocket;
  readonly playerSocket: WebSocket;
  readonly matches: D1MultiplayerMatchRepository;
  readonly instances: D1MultiplayerInstanceRepository;
}> {
  const authority = await createRelayRoomAuthority(key, runtimeOverrides);
  const { hostClaims, playerClaims } = authority;
  const host = await connect(hostClaims);
  await nextMessage(host.socket, "Relay host connected acknowledgement");
  const player = await connect(playerClaims);
  await nextMessage(player.socket, "Relay player connected acknowledgement");

  const hostSync = nextMessageWhere(
    host.socket,
    "Relay host activation sync",
    (message) => message.type === "RELAY_SYNC",
  );
  const playerSync = nextMessageWhere(
    player.socket,
    "Relay player activation sync",
    (message) => message.type === "RELAY_SYNC",
  );
  host.socket.send(
    JSON.stringify({ type: "MULTI_READY", v: 1, generation: hostClaims.generation }),
  );
  player.socket.send(
    JSON.stringify({ type: "MULTI_READY", v: 1, generation: playerClaims.generation }),
  );
  await Promise.all([hostSync, playerSync]);
  return {
    ...authority,
    hostClaims,
    playerClaims,
    hostSocket: host.socket,
    playerSocket: player.socket,
  };
}

async function createConnectedRelayRoomForUsers(
  key: string,
  userIds: readonly number[],
): Promise<{
  readonly instanceId: string;
  readonly participants: readonly {
    readonly userId: number;
    readonly claims: MultiplayerRelayJoinTicketClaims;
    readonly socket: WebSocket;
  }[];
  readonly matches: D1MultiplayerMatchRepository;
  readonly instances: D1MultiplayerInstanceRepository;
}> {
  if (userIds.length < 2 || userIds.length > 8 || userIds[0] !== HOST_USER_ID) {
    throw new Error("Relay participant fixture requires the host first and 2~8 total users");
  }
  const { rooms, instances, matches } = roomHarness();
  const created = await rooms.createRoom({
    userId: HOST_USER_ID,
    gameSlug: GAME_SLUG,
    visibility: "PRIVATE",
    joinPolicy: "OPEN",
    idempotencyKey: `workers_relay_${key}_00000001`,
  });
  if (!created.ok) throw new Error(`Relay room create failed: ${created.code}`);

  const authoritySeeds: Array<{
    readonly userId: number;
    readonly participant: typeof created.participant;
  }> = [{ userId: HOST_USER_ID, participant: created.participant }];
  for (const userId of userIds.slice(1)) {
    const joined = await rooms.joinRoom({
      userId,
      publicCode: created.instance.publicCode,
      inviteToken: null,
    });
    if (!joined.ok) throw new Error(`Relay room join failed for ${userId}: ${joined.code}`);
    authoritySeeds.push({ userId, participant: joined.participant });
  }

  const started = await rooms.startRoom({
    userId: HOST_USER_ID,
    instanceId: created.instance.id,
    expectedGeneration: created.instance.generation,
  });
  if (!started.ok) throw new Error(`Relay room start failed: ${started.code}`);

  const claims: MultiplayerRelayJoinTicketClaims[] = [];
  for (const seed of authoritySeeds) {
    const participant = await instances.advanceConnectionGeneration({
      instanceId: created.instance.id,
      expectedInstanceGeneration: created.instance.generation,
      userId: seed.userId,
      expectedConnectionGeneration: seed.participant.connectionGeneration,
      nowIso: new Date().toISOString(),
    });
    if (!participant) throw new Error(`Relay connection generation failed for ${seed.userId}`);
    claims.push(
      relayClaims(created.instance.id, {
        participantId: participant.id,
        userId: seed.userId,
        gameVersionId: GAME_VERSION_ID,
        profileId: PROFILE_ID,
        profileRevision: 1,
        generation: created.instance.generation,
        connectionGeneration: participant.connectionGeneration,
        seatIndex: participant.seatIndex,
        role: participant.role,
      }),
    );
  }

  const sockets: WebSocket[] = [];
  for (const participantClaims of claims) {
    const connected = await connect(participantClaims);
    await nextMessage(
      connected.socket,
      `Relay participant ${participantClaims.seatIndex} connected acknowledgement`,
    );
    sockets.push(connected.socket);
  }
  const syncs = sockets.map((socket, index) =>
    nextMessageWhere(
      socket,
      `Relay participant ${index} activation sync`,
      (message) => message.type === "RELAY_SYNC",
    ),
  );
  for (let index = 0; index < sockets.length; index += 1) {
    sockets[index]!.send(
      JSON.stringify({ type: "MULTI_READY", v: 1, generation: claims[index]!.generation }),
    );
  }
  await Promise.all(syncs);

  return {
    instanceId: created.instance.id,
    participants: claims.map((participantClaims, index) => ({
      userId: userIds[index]!,
      claims: participantClaims,
      socket: sockets[index]!,
    })),
    matches,
    instances,
  };
}

async function waitUntilEpochMs(targetMs: number): Promise<void> {
  const delay = Math.max(0, targetMs - Date.now());
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
}

test("Relay stays INERT until every expected participant is connected and runtime-ready", async ({
  expect,
}) => {
  const room = await createRelayRoomAuthority("startup_quorum");
  const stub = env.MULTIPLAYER_INSTANCES.get(env.MULTIPLAYER_INSTANCES.idFromName(room.instanceId));
  const host = await connect(room.hostClaims);
  await nextMessage(host.socket, "Relay startup host acknowledgement");
  host.socket.send(
    JSON.stringify({ type: "MULTI_READY", v: 1, generation: room.hostClaims.generation }),
  );

  await expect
    .poll(() =>
      runInDurableObject(stub, async (_instance, state) => {
        const runtime = state.storage.sql
          .exec<{ lifecycle_status: string }>(
            "SELECT lifecycle_status FROM relay_runtime WHERE singleton = 1",
          )
          .toArray()[0];
        const missing = state.storage.sql
          .exec<{ connection_generation: number; disconnected_at: number | null }>(
            `SELECT connection_generation, disconnected_at FROM participant_connections
             WHERE participant_id = ? AND generation = ?`,
            room.playerClaims.participantId,
            room.playerClaims.generation,
          )
          .toArray()[0];
        return {
          lifecycle: runtime?.lifecycle_status,
          missingConnectionGeneration: missing?.connection_generation,
          missingDisconnected: missing ? missing.disconnected_at !== null : false,
        };
      }),
    )
    .toEqual({ lifecycle: "INERT", missingConnectionGeneration: 0, missingDisconnected: true });

  const player = await connect(room.playerClaims);
  await nextMessage(player.socket, "Relay startup player acknowledgement");
  expect(
    await runInDurableObject(
      stub,
      async (_instance, state) =>
        state.storage.sql
          .exec<{ lifecycle_status: string }>(
            "SELECT lifecycle_status FROM relay_runtime WHERE singleton = 1",
          )
          .one().lifecycle_status,
    ),
  ).toBe("INERT");

  const hostSync = nextMessageWhere(
    host.socket,
    "Relay startup host sync",
    (message) => message.type === "RELAY_SYNC",
  );
  const playerSync = nextMessageWhere(
    player.socket,
    "Relay startup player sync",
    (message) => message.type === "RELAY_SYNC",
  );
  player.socket.send(
    JSON.stringify({ type: "MULTI_READY", v: 1, generation: room.playerClaims.generation }),
  );
  for (const message of await Promise.all([hostSync, playerSync])) {
    expect(message).toMatchObject({ type: "RELAY_SYNC", generation: room.hostClaims.generation });
  }
});

test("Relay startup deadline closes a room whose expected participant never connects", async ({
  expect,
}) => {
  const room = await createRelayRoomAuthority("startup_deadline");
  const stub = env.MULTIPLAYER_INSTANCES.get(env.MULTIPLAYER_INSTANCES.idFromName(room.instanceId));
  const host = await connect(room.hostClaims);
  await nextMessage(host.socket, "Relay deadline host acknowledgement");
  host.socket.send(
    JSON.stringify({ type: "MULTI_READY", v: 1, generation: room.hostClaims.generation }),
  );
  await expect
    .poll(() =>
      runInDurableObject(
        stub,
        async (_instance, state) =>
          state.storage.sql
            .exec<{ count: number }>("SELECT COUNT(*) AS count FROM relay_connection_readiness")
            .one().count,
      ),
    )
    .toBe(1);
  await runInDurableObject(stub, async (_instance, state) => {
    state.storage.sql.exec(
      "UPDATE relay_startup_deadline SET expires_at = ? WHERE singleton = 1",
      Date.now() - 1,
    );
    await state.storage.setAlarm(Date.now() + 60_000);
  });
  const closed = nextMessageWhere(
    host.socket,
    "Relay startup deadline close",
    (message) => message.type === "RELAY_CLOSED",
  );
  expect(await runDurableObjectAlarm(stub)).toBe(true);
  expect(await closed).toMatchObject({ code: "PARTICIPANT_LEFT" });
  await expect
    .poll(() => room.instances.findById(room.instanceId))
    .toMatchObject({
      status: "ABORTED",
      abortCode: "PARTICIPANT_LEFT",
    });
});

test("Relay alarms ignore disconnected rows from an older generation", async ({ expect }) => {
  const room = await createConnectedRelayRoom("generation_scoped_alarm");
  const stub = env.MULTIPLAYER_INSTANCES.get(env.MULTIPLAYER_INSTANCES.idFromName(room.instanceId));
  await runInDurableObject(stub, async (_instance, state) => {
    const old = Math.floor(Date.now() / 1_000) - 120;
    state.storage.sql.exec(
      `INSERT INTO participant_connections (
         participant_id, user_id, role, generation, connection_generation,
         connected_at, last_seen_at, disconnected_at
       ) VALUES ('participant_stale_generation', 999999, 'PLAYER', 0, 1, ?, ?, ?)`,
      old,
      old,
      old,
    );
    await state.storage.setAlarm(Date.now() + 60_000);
  });
  expect(await runDurableObjectAlarm(stub)).toBe(true);
  expect(await room.instances.findById(room.instanceId)).toMatchObject({ status: "ACTIVE" });
  expect(
    await runInDurableObject(
      stub,
      async (_instance, state) =>
        state.storage.sql
          .exec<{ lifecycle_status: string }>(
            "SELECT lifecycle_status FROM relay_runtime WHERE singleton = 1",
          )
          .one().lifecycle_status,
    ),
  ).toBe("ACTIVE");
});

test("Relay retries a durable D1 close after a transient transition failure", async ({
  expect,
}) => {
  const room = await createConnectedRelayRoom("close_retry");
  const stub = env.MULTIPLAYER_INSTANCES.get(env.MULTIPLAYER_INSTANCES.idFromName(room.instanceId));
  const trigger = "test_relay_close_retry";
  await env.DB.prepare(
    `CREATE TRIGGER ${trigger}
     BEFORE UPDATE OF status ON multiplayer_instances
     WHEN OLD.id = '${room.instanceId}' AND NEW.status = 'ABORTED'
     BEGIN
       SELECT RAISE(ABORT, 'forced transient Relay close failure');
     END`,
  ).run();
  try {
    const closed = nextMessageWhere(
      room.playerSocket,
      "Relay retry close notice",
      (message) => message.type === "RELAY_CLOSED",
    );
    room.hostSocket.close(1000, "host left during transient D1 failure");
    expect(await closed).toMatchObject({ code: "HOST_LEFT" });
    await expect
      .poll(() =>
        runInDurableObject(
          stub,
          async (_instance, state) =>
            state.storage.sql
              .exec<{ attempts: number }>(
                "SELECT attempts FROM relay_close_pending WHERE singleton = 1",
              )
              .toArray()[0]?.attempts ?? -1,
        ),
      )
      .toBeGreaterThanOrEqual(1);
    expect(await room.instances.findById(room.instanceId)).toMatchObject({ status: "ACTIVE" });
  } finally {
    await env.DB.prepare(`DROP TRIGGER IF EXISTS ${trigger}`).run();
  }

  await runInDurableObject(stub, async (_instance, state) => {
    await state.storage.setAlarm(Date.now() + 60_000);
  });
  expect(await runDurableObjectAlarm(stub)).toBe(true);
  await expect
    .poll(() => room.instances.findById(room.instanceId))
    .toMatchObject({
      status: "ABORTED",
      abortCode: "PARTICIPANT_LEFT",
    });
  expect(
    await runInDurableObject(
      stub,
      async (_instance, state) =>
        state.storage.sql
          .exec<{ count: number }>("SELECT COUNT(*) AS count FROM relay_close_pending")
          .one().count,
    ),
  ).toBe(0);
});

test("game-agnostic Relay carries a four-participant room through ready, delivery, reconnect, and leave", async ({
  expect,
}) => {
  const room = await createConnectedRelayRoomForUsers("four_participant_flow", [
    HOST_USER_ID,
    ...PLAYER_USER_IDS.slice(0, 3),
  ]);
  expect(room.participants.map(({ claims }) => claims.seatIndex)).toEqual([0, 1, 2, 3]);
  await expect
    .poll(() => room.instances.findById(room.instanceId))
    .toMatchObject({
      status: "ACTIVE",
      participantCount: 4,
    });
  const match = await room.matches.findMatchByInstanceGeneration(room.instanceId, 1);
  expect(match?.status).toBe("ACTIVE");
  expect(await room.matches.listPlayers(match!.id)).toHaveLength(4);

  const broadcastMessages = room.participants.map(({ socket }, index) =>
    nextMessageWhere(
      socket,
      `four-participant broadcast delivery ${index}`,
      (message) => message.type === "RELAY_MESSAGE",
    ),
  );
  room.participants[0]!.socket.send(
    JSON.stringify({
      type: "RELAY_SEND",
      v: 1,
      generation: 1,
      clientSeq: 1,
      delivery: "broadcast",
      payload: { creatorProtocol: "opaque-turn-like", round: 1 },
    }),
  );
  for (const message of await Promise.all(broadcastMessages)) {
    expect(message).toMatchObject({
      type: "RELAY_MESSAGE",
      serverSeq: 1,
      delivery: "broadcast",
      sender: {
        participantId: room.participants[0]!.claims.participantId,
        seatIndex: 0,
        role: "HOST",
      },
      payload: { creatorProtocol: "opaque-turn-like", round: 1 },
    });
  }

  const directTarget = room.participants[3]!;
  const directMessage = nextMessageWhere(
    directTarget.socket,
    "four-participant direct delivery",
    (message) => message.type === "RELAY_MESSAGE" && message.delivery === "direct",
  );
  room.participants[2]!.socket.send(
    JSON.stringify({
      type: "RELAY_SEND",
      v: 1,
      generation: 1,
      clientSeq: 1,
      delivery: "direct",
      targetParticipantId: directTarget.claims.participantId,
      payload: { creatorProtocol: "opaque-simultaneous", input: 17 },
    }),
  );
  expect(await directMessage).toMatchObject({
    type: "RELAY_MESSAGE",
    serverSeq: 2,
    delivery: "direct",
    targetParticipantId: directTarget.claims.participantId,
    sender: {
      participantId: room.participants[2]!.claims.participantId,
      seatIndex: 2,
      role: "PLAYER",
    },
  });

  const reconnecting = room.participants[1]!;
  const stub = env.MULTIPLAYER_INSTANCES.get(env.MULTIPLAYER_INSTANCES.idFromName(room.instanceId));
  reconnecting.socket.close(1011, "four-participant network loss");
  await expect
    .poll(() =>
      runInDurableObject(
        stub,
        async (_instance, state) =>
          state.storage.sql
            .exec<{ count: number }>(
              `SELECT COUNT(*) AS count
               FROM participant_connections
               WHERE participant_id = ? AND disconnected_at IS NOT NULL`,
              reconnecting.claims.participantId,
            )
            .one().count,
      ),
    )
    .toBe(1);
  const advanced = await room.instances.advanceConnectionGeneration({
    instanceId: room.instanceId,
    expectedInstanceGeneration: 1,
    userId: reconnecting.userId,
    expectedConnectionGeneration: reconnecting.claims.connectionGeneration,
    nowIso: new Date().toISOString(),
  });
  expect(advanced?.connectionGeneration).toBe(2);
  const resumed = await connect({
    ...reconnecting.claims,
    jti: `workers_relay_four_resume_${crypto.randomUUID()}`,
    connectionGeneration: 2,
  });
  expect(
    await nextMessage(resumed.socket, "four-participant reconnect acknowledgement"),
  ).toMatchObject({
    type: "MULTI_CONNECTED",
    connectionGeneration: 2,
  });
  expect(
    await nextMessageWhere(
      resumed.socket,
      "four-participant reconnect sync",
      (message) => message.type === "RELAY_SYNC",
    ),
  ).toMatchObject({ type: "RELAY_SYNC", generation: 1, serverSeq: 2 });

  const activeSockets = [
    room.participants[0]!.socket,
    resumed.socket,
    room.participants[2]!.socket,
    room.participants[3]!.socket,
  ];
  const resumedBroadcasts = activeSockets.map((socket, index) =>
    nextMessageWhere(
      socket,
      `four-participant resumed broadcast ${index}`,
      (message) => message.type === "RELAY_MESSAGE" && message.serverSeq === 3,
    ),
  );
  resumed.socket.send(
    JSON.stringify({
      type: "RELAY_SEND",
      v: 1,
      generation: 1,
      clientSeq: 1,
      delivery: "broadcast",
      payload: { creatorProtocol: "opaque-realtime-like", frame: 42 },
    }),
  );
  for (const message of await Promise.all(resumedBroadcasts)) {
    expect(message).toMatchObject({
      type: "RELAY_MESSAGE",
      serverSeq: 3,
      sender: { participantId: reconnecting.claims.participantId, seatIndex: 1 },
      payload: { creatorProtocol: "opaque-realtime-like", frame: 42 },
    });
  }

  const closedMessages = activeSockets
    .slice(0, 3)
    .map((socket, index) =>
      nextMessageWhere(
        socket,
        `four-participant explicit leave close ${index}`,
        (message) => message.type === "RELAY_CLOSED",
      ),
    );
  const leaveRequest = internalLeaveRequest(
    room.instanceId,
    directTarget.userId,
    directTarget.claims.generation,
  );
  const leaveResponse = await stub.fetch(leaveRequest);
  expect(leaveResponse.status).toBe(200);
  expect(await leaveResponse.json()).toMatchObject({ ok: true, replayed: false });
  for (const message of await Promise.all(closedMessages)) {
    expect(message).toMatchObject({ type: "RELAY_CLOSED", code: "PARTICIPANT_LEFT" });
  }
  await expect
    .poll(() => room.instances.findById(room.instanceId))
    .toMatchObject({
      status: "ABORTED",
      abortCode: "PARTICIPANT_LEFT",
    });
});

test("Relay fans eight opaque broadcasts out to the full eight-participant bound without D1 action writes", async ({
  expect,
}) => {
  const room = await createConnectedRelayRoomForUsers("eight_participant_fanout", [
    HOST_USER_ID,
    ...PLAYER_USER_IDS,
  ]);
  expect(room.participants).toHaveLength(8);

  for (let round = 0; round < room.participants.length; round += 1) {
    const serverSeq = round + 1;
    const deliveries = room.participants.map(({ socket }, seatIndex) =>
      nextMessageWhere(
        socket,
        `eight-participant fanout round ${serverSeq} seat ${seatIndex}`,
        (message) => message.type === "RELAY_MESSAGE" && message.serverSeq === serverSeq,
      ),
    );
    const sender = room.participants[round]!;
    sender.socket.send(
      JSON.stringify({
        type: "RELAY_SEND",
        v: 1,
        generation: 1,
        clientSeq: 1,
        delivery: "broadcast",
        payload: { creatorProtocol: "opaque-load-probe", round: serverSeq },
      }),
    );
    for (const message of await Promise.all(deliveries)) {
      expect(message).toMatchObject({
        type: "RELAY_MESSAGE",
        serverSeq,
        delivery: "broadcast",
        sender: {
          participantId: sender.claims.participantId,
          seatIndex: sender.claims.seatIndex,
          role: sender.claims.role,
        },
        payload: { creatorProtocol: "opaque-load-probe", round: serverSeq },
      });
    }
  }

  const match = await room.matches.findMatchByInstanceGeneration(room.instanceId, 1);
  const actionCount = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM multiplayer_match_actions WHERE match_id = ?",
  )
    .bind(match?.id)
    .first<{ count: number }>();
  expect(actionCount?.count).toBe(0);

  const stub = env.MULTIPLAYER_INSTANCES.get(env.MULTIPLAYER_INSTANCES.idFromName(room.instanceId));
  expect(
    await runInDurableObject(stub, async (_instance, state) =>
      state.storage.sql
        .exec<{ server_seq: number; lifecycle_status: string }>(
          "SELECT server_seq, lifecycle_status FROM relay_runtime WHERE singleton = 1",
        )
        .one(),
    ),
  ).toEqual({ server_seq: 8, lifecycle_status: "ACTIVE" });
});

test("generic Relay broadcasts and directs server-attributed payloads without a ruleset ledger", async ({
  expect,
}) => {
  const room = await createConnectedRelayRoom("generic_delivery");
  const hostBroadcast = nextMessageWhere(
    room.hostSocket,
    "host Relay broadcast",
    (message) => message.type === "RELAY_MESSAGE",
  );
  const playerBroadcast = nextMessageWhere(
    room.playerSocket,
    "player Relay broadcast",
    (message) => message.type === "RELAY_MESSAGE",
  );
  room.hostSocket.send(
    JSON.stringify({
      type: "RELAY_SEND",
      v: 1,
      generation: 1,
      clientSeq: 1,
      delivery: "broadcast",
      payload: { kind: "creator-defined", value: 7 },
    }),
  );
  for (const message of await Promise.all([hostBroadcast, playerBroadcast])) {
    expect(message).toMatchObject({
      type: "RELAY_MESSAGE",
      generation: 1,
      serverSeq: 1,
      delivery: "broadcast",
      sender: {
        participantId: room.hostClaims.participantId,
        seatIndex: room.hostClaims.seatIndex,
        role: "HOST",
      },
      payload: { kind: "creator-defined", value: 7 },
    });
  }

  const unavailable = nextMessageWhere(
    room.playerSocket,
    "cross-room Relay target rejection",
    (message) => message.type === "RELAY_REJECTED",
  );
  room.playerSocket.send(
    JSON.stringify({
      type: "RELAY_SEND",
      v: 1,
      generation: 1,
      clientSeq: 1,
      delivery: "direct",
      targetParticipantId: "participant_other_room",
      payload: { hidden: true },
    }),
  );
  expect(await unavailable).toMatchObject({
    type: "RELAY_REJECTED",
    clientSeq: 1,
    code: "TARGET_UNAVAILABLE",
  });

  const hostDirect = nextMessageWhere(
    room.hostSocket,
    "host Relay direct message",
    (message) => message.type === "RELAY_MESSAGE" && message.delivery === "direct",
  );
  room.playerSocket.send(
    JSON.stringify({
      type: "RELAY_SEND",
      v: 1,
      generation: 1,
      clientSeq: 2,
      delivery: "direct",
      targetParticipantId: room.hostClaims.participantId,
      payload: { privateMove: 3 },
    }),
  );
  expect(await hostDirect).toMatchObject({
    type: "RELAY_MESSAGE",
    serverSeq: 2,
    delivery: "direct",
    targetParticipantId: room.hostClaims.participantId,
    sender: {
      participantId: room.playerClaims.participantId,
      seatIndex: room.playerClaims.seatIndex,
      role: "PLAYER",
    },
    payload: { privateMove: 3 },
  });

  const match = await room.matches.findMatchByInstanceGeneration(room.instanceId, 1);
  expect(match?.status).toBe("ACTIVE");
  const actionCount = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM multiplayer_match_actions WHERE match_id = ?",
  )
    .bind(match?.id)
    .first<{ count: number }>();
  expect(actionCount?.count).toBe(0);

  const stub = env.MULTIPLAYER_INSTANCES.get(env.MULTIPLAYER_INSTANCES.idFromName(room.instanceId));
  await runInDurableObject(stub, async (instance, state) => {
    const relayAuthority = state.storage.sql
      .exec<{ count: number }>("SELECT COUNT(*) AS count FROM relay_authority")
      .toArray()[0];
    expect(relayAuthority?.count).toBe(1);
    expect("deadlineTimer" in instance).toBe(false);
    expect("continuousTimer" in instance).toBe(false);
  });
});

test("parent-only latency reports synchronize every connected seat outside application rate", async ({
  expect,
}) => {
  const room = await createConnectedRelayRoom("latency_sync", { messagesPerSecond: 1 });
  const hostFirst = nextMessageWhere(
    room.hostSocket,
    "host latency sync",
    (message) => message.type === "MULTI_LATENCY_SYNC" && Array.isArray(message.samples),
  );
  const playerFirst = nextMessageWhere(
    room.playerSocket,
    "player latency sync",
    (message) => message.type === "MULTI_LATENCY_SYNC" && Array.isArray(message.samples),
  );
  room.hostSocket.send(
    JSON.stringify({
      type: "MULTI_LATENCY_REPORT",
      v: 1,
      generation: 1,
      rttMs: 42,
    }),
  );
  for (const sync of await Promise.all([hostFirst, playerFirst])) {
    expect(sync).toMatchObject({
      type: "MULTI_LATENCY_SYNC",
      generation: 1,
      samples: [
        {
          participantId: room.hostClaims.participantId,
          seatIndex: 0,
          rttMs: 42,
        },
      ],
    });
  }

  room.hostSocket.send(
    JSON.stringify({
      type: "MULTI_LATENCY_REPORT",
      v: 1,
      generation: 1,
      rttMs: 99,
    }),
  );
  const hostDelivery = nextMessageWhere(
    room.hostSocket,
    "application message after latency control",
    (message) => message.type === "RELAY_MESSAGE",
  );
  room.hostSocket.send(
    JSON.stringify({
      type: "RELAY_SEND",
      v: 1,
      generation: 1,
      clientSeq: 1,
      delivery: "broadcast",
      payload: { stillFirstApplicationSequence: true },
    }),
  );
  expect(await hostDelivery).toMatchObject({
    type: "RELAY_MESSAGE",
    serverSeq: 1,
    payload: { stillFirstApplicationSequence: true },
  });

  const bothSeats = nextMessageWhere(
    room.hostSocket,
    "two-seat latency sync",
    (message) =>
      message.type === "MULTI_LATENCY_SYNC" &&
      Array.isArray(message.samples) &&
      message.samples.length === 2,
  );
  room.playerSocket.send(
    JSON.stringify({
      type: "MULTI_LATENCY_REPORT",
      v: 1,
      generation: 1,
      rttMs: 85,
    }),
  );
  expect(await bothSeats).toMatchObject({
    samples: [
      { participantId: room.hostClaims.participantId, seatIndex: 0, rttMs: 42 },
      { participantId: room.playerClaims.participantId, seatIndex: 1, rttMs: 85 },
    ],
  });
});

test("host snapshot survives DO eviction and reconnect while non-host writes stay rejected", async ({
  expect,
}) => {
  const room = await createConnectedRelayRoom("snapshot_resume");
  const hostSync = nextMessageWhere(
    room.hostSocket,
    "host Relay snapshot sync",
    (message) => message.type === "RELAY_SYNC" && message.serverSeq === 1,
  );
  const playerSync = nextMessageWhere(
    room.playerSocket,
    "player Relay snapshot sync",
    (message) => message.type === "RELAY_SYNC" && message.serverSeq === 1,
  );
  room.hostSocket.send(
    JSON.stringify({
      type: "RELAY_SNAPSHOT_SET",
      v: 1,
      generation: 1,
      clientSeq: 1,
      payload: { world: { round: 4 }, opaqueRules: ["anything", 7] },
    }),
  );
  const snapshots = await Promise.all([hostSync, playerSync]);
  for (const message of snapshots) {
    expect(message).toMatchObject({
      type: "RELAY_SYNC",
      generation: 1,
      serverSeq: 1,
      snapshot: {
        revision: 1,
        payload: { world: { round: 4 }, opaqueRules: ["anything", 7] },
      },
    });
    expect((message.snapshot as { hash: string }).hash).toMatch(/^[a-f0-9]{64}$/);
  }

  const rejected = nextMessageWhere(
    room.playerSocket,
    "non-host Relay snapshot rejection",
    (message) => message.type === "RELAY_REJECTED",
  );
  room.playerSocket.send(
    JSON.stringify({
      type: "RELAY_SNAPSHOT_SET",
      v: 1,
      generation: 1,
      clientSeq: 1,
      payload: { forged: true },
    }),
  );
  expect(await rejected).toMatchObject({ code: "HOST_REQUIRED", clientSeq: 1 });

  const advanced = await room.instances.advanceConnectionGeneration({
    instanceId: room.instanceId,
    expectedInstanceGeneration: 1,
    userId: PLAYER_USER_ID,
    expectedConnectionGeneration: room.playerClaims.connectionGeneration,
    nowIso: new Date().toISOString(),
  });
  expect(advanced?.connectionGeneration).toBe(2);
  const stub = env.MULTIPLAYER_INSTANCES.get(env.MULTIPLAYER_INSTANCES.idFromName(room.instanceId));
  await evictDurableObject(stub);
  const resumed = await connect({
    ...room.playerClaims,
    jti: `workers_relay_resume_${crypto.randomUUID()}`,
    connectionGeneration: 2,
  });
  expect(await nextMessage(resumed.socket, "resumed Relay connected")).toMatchObject({
    type: "MULTI_CONNECTED",
    connectionGeneration: 2,
  });
  expect(
    await nextMessageWhere(
      resumed.socket,
      "resumed Relay snapshot",
      (message) => message.type === "RELAY_SYNC",
    ),
  ).toMatchObject({
    type: "RELAY_SYNC",
    serverSeq: 1,
    snapshot: {
      revision: 1,
      payload: { world: { round: 4 }, opaqueRules: ["anything", 7] },
    },
  });

  const hostAfterResume = nextMessageWhere(
    room.hostSocket,
    "host delivery after Relay hibernation",
    (message) => message.type === "RELAY_MESSAGE",
  );
  const playerAfterResume = nextMessageWhere(
    resumed.socket,
    "resumed player delivery after Relay hibernation",
    (message) => message.type === "RELAY_MESSAGE",
  );
  resumed.socket.send(
    JSON.stringify({
      type: "RELAY_SEND",
      v: 1,
      generation: 1,
      clientSeq: 1,
      delivery: "broadcast",
      payload: { afterResume: true },
    }),
  );
  for (const message of await Promise.all([hostAfterResume, playerAfterResume])) {
    expect(message).toMatchObject({
      type: "RELAY_MESSAGE",
      serverSeq: 2,
      sender: { participantId: room.playerClaims.participantId },
      payload: { afterResume: true },
    });
  }
});

test("Relay rejects reconnect after grace and closes the room at the bounded deadline", async ({
  expect,
}) => {
  const room = await createConnectedRelayRoom("reconnect_deadline");
  const stub = env.MULTIPLAYER_INSTANCES.get(env.MULTIPLAYER_INSTANCES.idFromName(room.instanceId));
  room.playerSocket.close(1011, "network lost");

  await expect
    .poll(() =>
      runInDurableObject(
        stub,
        async (_instance, state) =>
          state.storage.sql
            .exec<{ count: number }>(
              `SELECT COUNT(*) AS count
               FROM participant_connections
               WHERE participant_id = ? AND disconnected_at IS NOT NULL`,
              room.playerClaims.participantId,
            )
            .one().count,
      ),
    )
    .toBe(1);

  const advanced = await room.instances.advanceConnectionGeneration({
    instanceId: room.instanceId,
    expectedInstanceGeneration: room.playerClaims.generation,
    userId: PLAYER_USER_ID,
    expectedConnectionGeneration: room.playerClaims.connectionGeneration,
    nowIso: new Date().toISOString(),
  });
  expect(advanced?.connectionGeneration).toBe(2);
  await runInDurableObject(stub, async (_instance, state) => {
    state.storage.sql.exec(
      `UPDATE participant_connections
       SET disconnected_at = ?
       WHERE participant_id = ?`,
      Math.floor(Date.now() / 1_000) - 31,
      room.playerClaims.participantId,
    );
    // Prevent the runtime alarm queue from racing this test's explicit alarm invocation.
    await state.storage.setAlarm(Date.now() + 60_000);
  });

  const nowSeconds = Math.floor(Date.now() / 1_000);
  const lateClaims: MultiplayerRelayJoinTicketClaims = {
    ...room.playerClaims,
    iat: nowSeconds,
    exp: nowSeconds + 30,
    jti: `workers_relay_late_resume_${crypto.randomUUID()}`,
    connectionGeneration: 2,
  };
  const lateRequest = internalRequest(lateClaims);
  const lateResponse = await stub.fetch(lateRequest.url, { headers: lateRequest.headers });
  expect(lateResponse.status).toBe(409);
  expect(lateResponse.webSocket).toBeNull();

  const closedMessage = nextMessageWhere(
    room.hostSocket,
    "Relay reconnect deadline close notice",
    (message) => message.type === "RELAY_CLOSED",
  );
  expect(await runDurableObjectAlarm(stub)).toBe(true);
  expect(await closedMessage).toMatchObject({ code: "PARTICIPANT_LEFT" });
  await expect
    .poll(() => room.instances.findById(room.instanceId))
    .toMatchObject({
      status: "ABORTED",
      abortCode: "PARTICIPANT_LEFT",
    });
});

test("Relay rejects spoofed sender fields, stale generation, and replayed client sequence", async ({
  expect,
}) => {
  const spoofRoom = await createConnectedRelayRoom("spoof_guard");
  const spoofClosed = nextClose(spoofRoom.hostSocket);
  spoofRoom.hostSocket.send(
    JSON.stringify({
      type: "RELAY_SEND",
      v: 1,
      generation: 1,
      clientSeq: 1,
      delivery: "broadcast",
      sender: {
        participantId: spoofRoom.playerClaims.participantId,
        seatIndex: spoofRoom.playerClaims.seatIndex,
        role: "PLAYER",
      },
      payload: {},
    }),
  );
  expect((await spoofClosed).code).toBe(1008);

  const staleRoom = await createConnectedRelayRoom("stale_generation_guard");
  const staleClosed = nextClose(staleRoom.hostSocket);
  staleRoom.hostSocket.send(
    JSON.stringify({
      type: "RELAY_SEND",
      v: 1,
      generation: 2,
      clientSeq: 1,
      delivery: "broadcast",
      payload: { stale: true },
    }),
  );
  expect((await staleClosed).code).toBe(4002);

  const replayRoom = await createConnectedRelayRoom("sequence_guard");
  const hostDelivery = nextMessageWhere(
    replayRoom.hostSocket,
    "first sequenced Relay delivery",
    (message) => message.type === "RELAY_MESSAGE",
  );
  const playerDelivery = nextMessageWhere(
    replayRoom.playerSocket,
    "first sequenced Relay delivery for peer",
    (message) => message.type === "RELAY_MESSAGE",
  );
  const first = {
    type: "RELAY_SEND",
    v: 1,
    generation: 1,
    clientSeq: 1,
    delivery: "broadcast",
    payload: { once: true },
  };
  replayRoom.hostSocket.send(JSON.stringify(first));
  await Promise.all([hostDelivery, playerDelivery]);
  const replayClosed = nextClose(replayRoom.hostSocket);
  replayRoom.hostSocket.send(JSON.stringify(first));
  expect((await replayClosed).code).toBe(1008);
});

test("Relay enforces per-connection message rate and aggregate room byte policy", async ({
  expect,
}) => {
  const rateRoom = await createConnectedRelayRoom("message_rate", { messagesPerSecond: 1 });
  const rateHostDelivery = nextMessageWhere(
    rateRoom.hostSocket,
    "rate first host delivery",
    (message) => message.type === "RELAY_MESSAGE",
  );
  const ratePlayerDelivery = nextMessageWhere(
    rateRoom.playerSocket,
    "rate first player delivery",
    (message) => message.type === "RELAY_MESSAGE",
  );
  rateRoom.hostSocket.send(
    JSON.stringify({
      type: "RELAY_SEND",
      v: 1,
      generation: 1,
      clientSeq: 1,
      delivery: "broadcast",
      payload: { accepted: true },
    }),
  );
  await Promise.all([rateHostDelivery, ratePlayerDelivery]);
  const rateClosed = nextClose(rateRoom.hostSocket);
  rateRoom.hostSocket.send(
    JSON.stringify({
      type: "RELAY_SEND",
      v: 1,
      generation: 1,
      clientSeq: 2,
      delivery: "broadcast",
      payload: { rejected: true },
    }),
  );
  expect((await rateClosed).code).toBe(1008);

  const byteRoom = await createConnectedRelayRoom("room_bytes", { roomBytesPerSecond: 100 });
  const byteClosed = nextClose(byteRoom.hostSocket);
  byteRoom.hostSocket.send(
    JSON.stringify({
      type: "RELAY_SEND",
      v: 1,
      generation: 1,
      clientSeq: 1,
      delivery: "broadcast",
      payload: { data: "x".repeat(128) },
    }),
  );
  expect((await byteClosed).code).toBe(1008);
});

test("disabled direct and snapshot capabilities reject without expanding Relay authority", async ({
  expect,
}) => {
  const room = await createConnectedRelayRoom("disabled_features", {
    directMessages: false,
    hostSnapshot: false,
    maxSnapshotBytes: 0,
  });
  const directRejected = nextMessageWhere(
    room.playerSocket,
    "disabled direct rejection",
    (message) => message.type === "RELAY_REJECTED",
  );
  room.playerSocket.send(
    JSON.stringify({
      type: "RELAY_SEND",
      v: 1,
      generation: 1,
      clientSeq: 1,
      delivery: "direct",
      targetParticipantId: room.hostClaims.participantId,
      payload: {},
    }),
  );
  expect(await directRejected).toMatchObject({
    clientSeq: 1,
    code: "DIRECT_MESSAGES_DISABLED",
  });

  const snapshotRejected = nextMessageWhere(
    room.hostSocket,
    "disabled snapshot rejection",
    (message) => message.type === "RELAY_REJECTED",
  );
  room.hostSocket.send(
    JSON.stringify({
      type: "RELAY_SNAPSHOT_SET",
      v: 1,
      generation: 1,
      clientSeq: 1,
      payload: {},
    }),
  );
  expect(await snapshotRejected).toMatchObject({
    clientSeq: 1,
    code: "SNAPSHOT_DISABLED",
  });
});

test("Relay enforces profile-specific payload and snapshot byte ceilings", async ({ expect }) => {
  const messageRoom = await createConnectedRelayRoom("profile_message_bytes", {
    maxMessageBytes: 24,
  });
  const messageClosed = nextClose(messageRoom.hostSocket);
  messageRoom.hostSocket.send(
    JSON.stringify({
      type: "RELAY_SEND",
      v: 1,
      generation: 1,
      clientSeq: 1,
      delivery: "broadcast",
      payload: { data: "x".repeat(32) },
    }),
  );
  expect((await messageClosed).code).toBe(1008);

  const snapshotRoom = await createConnectedRelayRoom("profile_snapshot_bytes", {
    maxSnapshotBytes: 24,
  });
  const snapshotClosed = nextClose(snapshotRoom.hostSocket);
  snapshotRoom.hostSocket.send(
    JSON.stringify({
      type: "RELAY_SNAPSHOT_SET",
      v: 1,
      generation: 1,
      clientSeq: 1,
      payload: { data: "x".repeat(32) },
    }),
  );
  expect((await snapshotClosed).code).toBe(1008);
});

test("Relay host departure closes peers and terminalizes the D1 room without a game result", async ({
  expect,
}) => {
  const room = await createConnectedRelayRoom("host_departure");
  const playerClosedMessage = nextMessageWhere(
    room.playerSocket,
    "Relay host departure close notice",
    (message) => message.type === "RELAY_CLOSED",
  );
  const playerClosed = nextClose(room.playerSocket);
  room.hostSocket.close(1000, "host left");
  expect(await playerClosedMessage).toMatchObject({
    type: "RELAY_CLOSED",
    code: "HOST_LEFT",
  });
  expect((await playerClosed).code).toBe(1000);
  await expect
    .poll(() => room.instances.findById(room.instanceId))
    .toMatchObject({
      status: "ABORTED",
      abortCode: "PARTICIPANT_LEFT",
    });
  const match = await room.matches.findMatchByInstanceGeneration(room.instanceId, 1);
  expect(match?.terminalResultJson).toBeNull();
});

test("Relay uses one bounded TTL alarm and no gameplay timer", async ({ expect }) => {
  const room = await createConnectedRelayRoom("room_ttl", { roomTtlSeconds: 1 });
  const stub = env.MULTIPLAYER_INSTANCES.get(env.MULTIPLAYER_INSTANCES.idFromName(room.instanceId));
  let expiresAt = 0;
  await runInDurableObject(stub, async (instance, state) => {
    const runtime = state.storage.sql
      .exec<{ expires_at: number }>("SELECT expires_at FROM relay_runtime WHERE singleton = 1")
      .toArray()[0];
    expiresAt = runtime?.expires_at ?? 0;
    expect("deadlineTimer" in instance).toBe(false);
    expect("continuousTimer" in instance).toBe(false);
    // Keep the test runtime from auto-firing before runDurableObjectAlarm invokes the real handler.
    await state.storage.setAlarm(Date.now() + 60_000);
  });
  expect(expiresAt).toBeGreaterThan(Date.now());
  const closedMessage = nextMessageWhere(
    room.playerSocket,
    "Relay TTL close notice",
    (message) => message.type === "RELAY_CLOSED",
  );
  await waitUntilEpochMs(expiresAt + 5);
  expect(await runDurableObjectAlarm(stub)).toBe(true);
  expect(await closedMessage).toMatchObject({ code: "ROOM_EXPIRED" });
  await expect
    .poll(() => room.instances.findById(room.instanceId))
    .toMatchObject({
      status: "ABORTED",
    });
});
