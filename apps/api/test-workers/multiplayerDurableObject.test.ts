import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { test } from "vitest";
import {
  MULTIPLAYER_TICKET_AUDIENCE,
  MULTIPLAYER_TICKET_ISSUER,
  MULTIPLAYER_WEBSOCKET_PROTOCOL,
  type MultiplayerJoinTicketClaims,
} from "@owogg/core";
import {
  MULTIPLAYER_INTERNAL_CLAIMS_HEADER,
  MULTIPLAYER_INTERNAL_CONNECT_PATH,
  MULTIPLAYER_INTERNAL_PROTOCOL_HEADER,
  decodeVerifiedMultiplayerClaims,
  encodeVerifiedMultiplayerClaims,
} from "../src/multiplayer/internalProtocol.js";

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
    profileRevision: 2,
    generation: 1,
    connectionGeneration: 1,
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

async function nextMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("timed out waiting for WebSocket message")),
      2_000,
    );
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

test("socket attachment and SQLite authority survive Durable Object eviction", async ({
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
  expect((await closed).code).toBe(1000);
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

test("Phase 2 rejects gameplay messages and returns the instance to inert state", async ({
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
