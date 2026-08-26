import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  MULTIPLAYER_TICKET_AUDIENCE,
  MULTIPLAYER_TICKET_ISSUER,
  MULTIPLAYER_TICKET_PROTOCOL_PREFIX,
  MULTIPLAYER_WEBSOCKET_PROTOCOL,
  createMultiplayerTicketKeyring,
  signMultiplayerJoinTicket,
  verifyMultiplayerJoinTicket,
} from "@owogg/core";
import {
  MultiplayerCreateInviteResponseSchema,
  MultiplayerGameAvailabilityResponseSchema,
  MultiplayerJoinTicketResponseSchema,
  MultiplayerRoomResponseSchema,
  MultiplayerRoomRosterResponseSchema,
} from "@owogg/contracts";
import { D1MultiplayerInstanceRepository } from "@owogg/db";
import { createSqliteD1 } from "../../../packages/db/test/helpers/sqliteD1.js";
import { app } from "../src/app.js";
import {
  MULTIPLAYER_INTERNAL_CLAIMS_HEADER,
  MULTIPLAYER_INTERNAL_CONNECT_PATH,
  MULTIPLAYER_INTERNAL_PROTOCOL_HEADER,
  decodeVerifiedMultiplayerClaims,
} from "../src/multiplayer/internalProtocol.js";

const SECRET = "api-multiplayer-ticket-secret-32-bytes-minimum";
const KEY_ID = "api_test_key";
const INSTANCE_ID = "instance_api_ticket_000000001";
const B2_ENV = {
  B2_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
  B2_REGION: "us-west-004",
  B2_BUCKET_NAME: "test",
  B2_KEY_ID: "test",
  B2_APPLICATION_KEY: "test",
};

function limiter(success = true) {
  return {
    calls: [] as string[],
    async limit(options: { key: string }) {
      this.calls.push(options.key);
      return { success };
    },
  };
}

function runtimeEnv(overrides: Record<string, unknown> = {}) {
  return {
    MULTIPLAYER_ENABLED: "true",
    MULTIPLAYER_TICKET_KEY_ID: KEY_ID,
    MULTIPLAYER_TICKET_SECRET: SECRET,
    MULTIPLAYER_SOCKET_ORIGIN: "http://localhost",
    FRONTEND_URL: "http://localhost:5173",
    MULTIPLAYER_RATE_LIMITER: limiter(),
    MULTIPLAYER_INSTANCES: {
      idFromName(value: string) {
        return value;
      },
      get() {
        return { fetch: async () => new Response(null, { status: 204 }) };
      },
    },
    ...overrides,
  };
}

async function websocketTicket(
  overrides: Partial<Parameters<typeof signMultiplayerJoinTicket>[0]> = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return signMultiplayerJoinTicket(
    {
      iss: MULTIPLAYER_TICKET_ISSUER,
      aud: MULTIPLAYER_TICKET_AUDIENCE,
      kid: KEY_ID,
      iat: now,
      exp: now + 30,
      jti: "api_socket_nonce_123456789",
      instanceId: INSTANCE_ID,
      participantId: "participant_api_12345678",
      userId: 7,
      gameVersionId: 12,
      profileId: 13,
      profileRevision: 2,
      rulesetKey: "official:omok",
      rulesetRevision: 1,
      generation: 3,
      connectionGeneration: 4,
      seatIndex: 1,
      role: "PLAYER",
      ...overrides,
    },
    createMultiplayerTicketKeyring({ kid: KEY_ID, secret: SECRET }),
  );
}

function socketRequest(token: string, origin = "http://localhost:5173") {
  return {
    headers: {
      Upgrade: "websocket",
      Origin: origin,
      "Sec-WebSocket-Protocol": `${MULTIPLAYER_WEBSOCKET_PROTOCOL}, ${MULTIPLAYER_TICKET_PROTOCOL_PREFIX}${token}`,
      "CF-Connecting-IP": "203.0.113.5",
    },
  };
}

test("multiplayer routes are inert before any environment is configured", async () => {
  const status = await app.request("http://localhost/api/multiplayer/status", {}, {
    MULTIPLAYER_ENABLED: "false",
  } as any);
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), { status: "DISABLED", protocolVersion: 1 });

  const ticket = await app.request(
    `http://localhost/api/multiplayer/instances/${INSTANCE_ID}/ticket`,
    { method: "POST", body: "this is deliberately never parsed" },
    { MULTIPLAYER_ENABLED: "false" } as any,
  );
  assert.equal(ticket.status, 503);
  assert.equal((await ticket.json()).error.code, "MULTIPLAYER_UNAVAILABLE");

  const socket = await app.request(
    `http://localhost/api/multiplayer/instances/${INSTANCE_ID}/socket`,
    { headers: { Upgrade: "websocket" } },
    { MULTIPLAYER_ENABLED: "false" } as any,
  );
  assert.equal(socket.status, 503);
});

test("enabled flag still reports NOT_READY and fails closed when a mandatory control is absent", async () => {
  const env = runtimeEnv({ MULTIPLAYER_RATE_LIMITER: undefined });
  const status = await app.request("http://localhost/api/multiplayer/status", {}, env as any);
  assert.deepEqual(await status.json(), { status: "NOT_READY", protocolVersion: 1 });
  const response = await app.request(
    `http://localhost/api/multiplayer/instances/${INSTANCE_ID}/socket`,
    socketRequest(await websocketTicket()),
    env as any,
  );
  assert.equal(response.status, 503);
});

test("socket edge rejects Origin and ticket failures before Durable Object lookup", async () => {
  const lookups: string[] = [];
  const env = runtimeEnv({
    MULTIPLAYER_INSTANCES: {
      idFromName(value: string) {
        lookups.push(value);
        return value;
      },
      get() {
        throw new Error("must not be reached");
      },
    },
  });
  const token = await websocketTicket();
  const badOrigin = await app.request(
    `http://localhost/api/multiplayer/instances/${INSTANCE_ID}/socket`,
    socketRequest(token, "https://evil.example"),
    env as any,
  );
  assert.equal(badOrigin.status, 403);
  assert.deepEqual(lookups, []);

  const badTicket = await app.request(
    `http://localhost/api/multiplayer/instances/${INSTANCE_ID}/socket`,
    socketRequest(`${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`),
    env as any,
  );
  assert.equal(badTicket.status, 401);
  assert.equal((await badTicket.json()).error.code, "TICKET_INVALID");
  assert.deepEqual(lookups, []);
});

test("socket edge strips the bearer ticket before self-bound Durable Object fetch", async () => {
  const forwarded: Request[] = [];
  const token = await websocketTicket();
  const env = runtimeEnv({
    MULTIPLAYER_INSTANCES: {
      idFromName(value: string) {
        assert.equal(value, INSTANCE_ID);
        return `id:${value}`;
      },
      get(id: string) {
        assert.equal(id, `id:${INSTANCE_ID}`);
        return {
          async fetch(request: Request) {
            forwarded.push(request);
            return new Response(null, {
              status: 204,
              headers: { "Sec-WebSocket-Protocol": MULTIPLAYER_WEBSOCKET_PROTOCOL },
            });
          },
        };
      },
    },
  });
  const response = await app.request(
    `http://localhost/api/multiplayer/instances/${INSTANCE_ID}/socket`,
    socketRequest(token),
    env as any,
  );
  assert.equal(response.status, 204);
  assert.equal(forwarded.length, 1);
  const internal = forwarded[0];
  assert.ok(internal);
  assert.equal(new URL(internal.url).pathname, MULTIPLAYER_INTERNAL_CONNECT_PATH);
  assert.equal(
    internal.headers.get(MULTIPLAYER_INTERNAL_PROTOCOL_HEADER),
    MULTIPLAYER_WEBSOCKET_PROTOCOL,
  );
  assert.equal(internal.headers.get("Sec-WebSocket-Protocol"), null);
  const allForwardedMetadata = `${internal.url}\n${[...internal.headers].flat().join("\n")}`;
  assert.equal(allForwardedMetadata.includes(token), false);
  assert.equal(allForwardedMetadata.includes(MULTIPLAYER_TICKET_PROTOCOL_PREFIX), false);
  const claims = decodeVerifiedMultiplayerClaims(
    internal.headers.get(MULTIPLAYER_INTERNAL_CLAIMS_HEADER),
  );
  assert.equal(claims?.instanceId, INSTANCE_ID);
  assert.equal(claims?.connectionGeneration, 4);
});

function createMultiplayerD1() {
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

test("authenticated ticket endpoint advances D1 generation and returns parent-only admission data", async () => {
  const { db, raw } = createMultiplayerD1();
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  const sessionToken = "api-multiplayer-session-token-123456";

  raw.prepare("INSERT INTO users (id, nickname) VALUES (7, 'Host')").run();
  raw
    .prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, 7, ?, ?)")
    .run(sessionToken, nowIso, expiresAt);
  raw
    .prepare(
      `INSERT INTO games (
         id, slug, publisher_type, publisher_user_id, visibility, live_version_id,
         deleted_at, created_at, updated_at
       ) VALUES (11, 'api-omok', 'OWOGG', NULL, 'PRIVATE', NULL, NULL, ?, ?)`,
    )
    .run(nowIso, nowIso);
  raw
    .prepare(
      `INSERT INTO game_versions (
         id, game_id, object_key, content_hash, bundle_bytes, publish_status,
         uploaded_at, moderation_status
       ) VALUES (12, 11, 'games/11/12.zip', 'api-content-12', 100, 'READY', ?, NULL)`,
    )
    .run(nowIso);
  raw.prepare("UPDATE games SET visibility = 'PUBLIC', live_version_id = 12 WHERE id = 11").run();
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
         13, NULL, NULL, 1, 11, 12, 2, 1, 'M1', 'turn', 'durable-object',
         'official:omok', 1, '{"boardSize":15,"winLength":5}', 'match', 'match',
         'relaxed', 'resume', 2, 2, '["PRIVATE"]', '["INVITE_ONLY"]',
         1024, 8192, 5, NULL, 1, ?, ?
       )`,
    )
    .run(nowIso, nowIso);

  const created = await new D1MultiplayerInstanceRepository(db).createWithHostAndLease({
    instanceId: INSTANCE_ID,
    publicCode: "APITICKET001",
    createdByUserId: 7,
    createIdempotencyHash: "f".repeat(64),
    gameId: 11,
    gameVersionId: 12,
    profileId: 13,
    profileRevision: 2,
    visibility: "PRIVATE",
    joinPolicy: "INVITE_ONLY",
    lifecycle: "match",
    maxPlayers: 2,
    instanceExpiresAt: expiresAt,
    hostParticipantId: "participant_api_host_0001",
    leaseExpiresAt: expiresAt,
    nowIso,
  });
  assert.equal(created.status, "CREATED");

  const env = runtimeEnv({ DB: db, ...B2_ENV });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        schemaVersion: 2,
        slug: "api-omok",
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
          type: "TAXONOMY",
          categories: ["board"],
          tags: ["omok"],
          modes: ["online-multi"],
          inputMethods: ["mouse", "touch"],
          minPlayers: 2,
          maxPlayers: 2,
          thumbnail: "/omok.svg",
        },
        updatedAt: nowIso,
      }),
      { status: 200 },
    )) as typeof fetch;
  try {
    const availabilityResponse = await app.request(
      "http://localhost/api/multiplayer/games/api-omok",
      {},
      env as any,
    );
    assert.equal(availabilityResponse.status, 200);
    assert.equal(availabilityResponse.headers.get("Cache-Control"), "no-store");
    const availability = MultiplayerGameAvailabilityResponseSchema.parse(
      await availabilityResponse.json(),
    );
    assert.equal(availability.status, "AVAILABLE");
    if (availability.status === "AVAILABLE") {
      assert.equal(availability.gameSlug, "api-omok");
      assert.equal(availability.profile.resolvedClass, "M1");
      assert.equal(availability.profile.rulesetKey, "official:omok");
      assert.deepEqual(availability.profile.allowedVisibility, ["PRIVATE"]);
      assert.deepEqual(availability.profile.allowedJoinPolicies, ["INVITE_ONLY"]);
    }
    const publicAvailability = JSON.stringify(availability);
    assert.equal(publicAvailability.includes("profileId"), false);
    assert.equal(publicAvailability.includes("ticket"), false);
    assert.equal(publicAvailability.includes("socket"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
  const request = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `owogg_session=${sessionToken}`,
      Origin: "http://localhost:5173",
      "CF-Connecting-IP": "203.0.113.7",
    },
    body: JSON.stringify({ expectedConnectionGeneration: 0 }),
  };
  const inviteRequest = {
    ...request,
    body: JSON.stringify({
      expectedGeneration: 1,
      idempotencyKey: "api-invite-idempotency-0001",
    }),
  };
  const inviteResponse = await app.request(
    `http://localhost/api/multiplayer/instances/${INSTANCE_ID}/invites`,
    inviteRequest,
    env as any,
  );
  assert.equal(inviteResponse.status, 201);
  assert.equal(inviteResponse.headers.get("Cache-Control"), "no-store");
  const inviteJson = await inviteResponse.json();
  assert.equal(Object.hasOwn(inviteJson, "ok"), false);
  const invite = MultiplayerCreateInviteResponseSchema.parse(inviteJson);
  assert.equal(invite.replayed, false);
  assert.equal(invite.maxUses, 1);

  const inviteReplayResponse = await app.request(
    `http://localhost/api/multiplayer/instances/${INSTANCE_ID}/invites`,
    inviteRequest,
    env as any,
  );
  assert.equal(inviteReplayResponse.status, 200);
  const inviteReplay = MultiplayerCreateInviteResponseSchema.parse(
    await inviteReplayResponse.json(),
  );
  assert.equal(inviteReplay.replayed, true);
  assert.equal(inviteReplay.inviteToken, invite.inviteToken);

  const rosterResponse = await app.request(
    `http://localhost/api/multiplayer/instances/${INSTANCE_ID}/roster`,
    {
      headers: {
        Cookie: `owogg_session=${sessionToken}`,
        Origin: "http://localhost:5173",
        "CF-Connecting-IP": "203.0.113.7",
      },
    },
    env as any,
  );
  assert.equal(rosterResponse.status, 200);
  const roster = MultiplayerRoomRosterResponseSchema.parse(await rosterResponse.json());
  assert.equal(roster.instanceId, INSTANCE_ID);
  assert.deepEqual(roster.players, [
    {
      participantId: "participant_api_host_0001",
      role: "HOST",
      seatIndex: 0,
      status: "JOINED",
      nickname: "Host",
      avatarUrl: null,
    },
  ]);
  assert.equal(JSON.stringify(roster).includes("userId"), false);

  const response = await app.request(
    `http://localhost/api/multiplayer/instances/${INSTANCE_ID}/ticket`,
    request,
    env as any,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const body = MultiplayerJoinTicketResponseSchema.parse(await response.json());
  assert.equal(body.connectionGeneration, 1);
  assert.equal(body.bootstrap.participantId, "participant_api_host_0001");
  assert.equal(body.bootstrap.rulesetKey, "official:omok");
  assert.equal(body.socketPath.includes("?"), false);
  assert.equal(body.socketPath.includes("ticket"), true); // route name only, never bearer value
  assert.equal(
    raw
      .prepare(
        "SELECT connection_generation FROM multiplayer_participants WHERE instance_id = ? AND user_id = 7",
      )
      .get(INSTANCE_ID)?.connection_generation,
    1,
  );

  const token = body.protocols[1].slice(MULTIPLAYER_TICKET_PROTOCOL_PREFIX.length);
  const verified = await verifyMultiplayerJoinTicket(
    token,
    createMultiplayerTicketKeyring({ kid: KEY_ID, secret: SECRET }),
    { instanceId: INSTANCE_ID, userId: 7, connectionGeneration: 1 },
  );
  assert.equal(verified.ok, true);

  const replay = await app.request(
    `http://localhost/api/multiplayer/instances/${INSTANCE_ID}/ticket`,
    request,
    env as any,
  );
  assert.equal(replay.status, 409);
  assert.equal((await replay.json()).error.code, "STALE_GENERATION");

  const leave = await app.request(
    `http://localhost/api/multiplayer/instances/${INSTANCE_ID}/leave`,
    {
      ...request,
      body: JSON.stringify({ expectedGeneration: 1 }),
    },
    env as any,
  );
  assert.equal(leave.status, 200);
  const left = MultiplayerRoomResponseSchema.parse(await leave.json());
  assert.equal(left.instance.status, "ABORTED");
  assert.equal(left.participant.status, "LEFT");
  assert.equal(
    raw.prepare("SELECT abort_code FROM multiplayer_instances WHERE id = ?").get(INSTANCE_ID)
      ?.abort_code,
    "INSUFFICIENT_PLAYERS",
  );
});
