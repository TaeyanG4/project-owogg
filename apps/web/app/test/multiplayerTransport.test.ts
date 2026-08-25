import assert from "node:assert/strict";
import test from "node:test";
import {
  MultiplayerTransportError,
  multiplayerSocketUrl,
  openMultiplayerParentTransport,
  type MultiplayerBrowserSocketLike,
} from "../features/game/runtime/multiplayerTransport";

const NOW = Date.parse("2026-08-26T00:00:00.000Z");
const INSTANCE_ID = "instance_transport_01";
const TICKET_PROTOCOL = "owogg.ticket.SECRET_BEARER_VALUE";

function admission(overrides: Record<string, unknown> = {}) {
  return {
    socketPath: `/api/multiplayer/instances/${INSTANCE_ID}/socket`,
    protocols: ["owogg.multiplayer.v1", TICKET_PROTOCOL],
    expiresAt: new Date(NOW + 30_000).toISOString(),
    connectionGeneration: 3,
    bootstrap: {
      type: "MULTI_INIT",
      v: 1,
      participantId: "participant_transport_01",
      gameVersionId: 18,
      profileRevision: 2,
      rulesetKey: "official:omok",
      rulesetRevision: 1,
      generation: 5,
    },
    ...overrides,
  };
}

function socketHarness(protocol = "owogg.multiplayer.v1") {
  let readyState = 0;
  const openListeners = new Set<() => void>();
  const messageListeners = new Set<(event: { data: unknown }) => void>();
  const closeListeners = new Set<(event: { code: number; reason?: string }) => void>();
  const errorListeners = new Set<() => void>();
  const closes: Array<{ code?: number; reason?: string }> = [];
  const socket: MultiplayerBrowserSocketLike = {
    protocol,
    get readyState() {
      return readyState;
    },
    send() {},
    close(code, reason) {
      closes.push({ ...(code !== undefined ? { code } : {}), ...(reason ? { reason } : {}) });
      readyState = 3;
    },
    addEventListener(type, listener) {
      if (type === "open") openListeners.add(listener as () => void);
      else if (type === "message") {
        messageListeners.add(listener as (event: { data: unknown }) => void);
      } else if (type === "close") {
        closeListeners.add(listener as (event: { code: number; reason?: string }) => void);
      } else errorListeners.add(listener as () => void);
    },
    removeEventListener(type, listener) {
      if (type === "open") openListeners.delete(listener as () => void);
      else if (type === "message") {
        messageListeners.delete(listener as (event: { data: unknown }) => void);
      } else if (type === "close") {
        closeListeners.delete(listener as (event: { code: number; reason?: string }) => void);
      } else errorListeners.delete(listener as () => void);
    },
  };
  return {
    socket,
    closes,
    openListenerCount: () => openListeners.size,
    open() {
      readyState = 1;
      for (const listener of [...openListeners]) listener();
    },
  };
}

test("parent exchanges the generation and puts the bearer only in WebSocket subprotocols", async () => {
  const harness = socketHarness();
  let requestInput: readonly [string, number] | null = null;
  const constructorInputs: Array<{ url: string; protocols: readonly [string, string] }> = [];

  const transport = await openMultiplayerParentTransport(
    { instanceId: INSTANCE_ID, expectedConnectionGeneration: 2 },
    {
      apiUrl: "https://api-stg.owogg.com",
      now: () => NOW,
      requestTicket: async (instanceId, expectedGeneration) => {
        requestInput = [instanceId, expectedGeneration];
        return admission();
      },
      createSocket: (url, protocols) => {
        constructorInputs.push({ url, protocols });
        return harness.socket;
      },
    },
  );

  assert.deepEqual(requestInput, [INSTANCE_ID, 2]);
  const constructorInput = constructorInputs[0];
  assert.ok(constructorInput);
  assert.equal(
    constructorInput.url,
    `wss://api-stg.owogg.com/api/multiplayer/instances/${INSTANCE_ID}/socket`,
  );
  assert.equal(constructorInput.url.includes("SECRET_BEARER_VALUE"), false);
  assert.equal(constructorInput.url.includes("?"), false);
  assert.deepEqual(constructorInput.protocols, ["owogg.multiplayer.v1", TICKET_PROTOCOL]);
  assert.equal("protocols" in transport, false);
  assert.equal("ticket" in transport, false);
  assert.equal(JSON.stringify(transport.bootstrap).includes("SECRET_BEARER_VALUE"), false);
  assert.equal(transport.connectionGeneration, 3);

  assert.equal(harness.openListenerCount(), 1);
  harness.open();
  assert.equal(harness.openListenerCount(), 0);
  assert.deepEqual(harness.closes, []);
});

test("a non-application selected protocol is closed before it can be treated as connected", async () => {
  const harness = socketHarness(TICKET_PROTOCOL);
  const transport = await openMultiplayerParentTransport(
    { instanceId: INSTANCE_ID, expectedConnectionGeneration: 2 },
    {
      now: () => NOW,
      requestTicket: async () => admission(),
      createSocket: () => harness.socket,
    },
  );

  harness.open();
  assert.deepEqual(harness.closes, [{ code: 1002, reason: "invalid multiplayer protocol" }]);
  transport.releaseProtocolGuard();
  assert.equal(harness.openListenerCount(), 0);
});

test("expired or non-CAS admission responses never construct a socket", async () => {
  let socketCalls = 0;
  const dependencies = {
    now: () => NOW,
    createSocket: () => {
      socketCalls += 1;
      return socketHarness().socket;
    },
  };

  await assert.rejects(
    openMultiplayerParentTransport(
      { instanceId: INSTANCE_ID, expectedConnectionGeneration: 2 },
      {
        ...dependencies,
        requestTicket: async () => admission({ connectionGeneration: 4 }),
      },
    ),
    (error: unknown) =>
      error instanceof MultiplayerTransportError && error.code === "STALE_GENERATION",
  );
  await assert.rejects(
    openMultiplayerParentTransport(
      { instanceId: INSTANCE_ID, expectedConnectionGeneration: 2 },
      {
        ...dependencies,
        requestTicket: async () => admission({ expiresAt: new Date(NOW).toISOString() }),
      },
    ),
    (error: unknown) =>
      error instanceof MultiplayerTransportError && error.code === "TICKET_EXPIRED",
  );
  assert.equal(socketCalls, 0);
});

test("malformed admission and constructor failures are redacted", async () => {
  await assert.rejects(
    openMultiplayerParentTransport(
      { instanceId: INSTANCE_ID, expectedConnectionGeneration: 2 },
      {
        requestTicket: async () => ({ ...admission(), secret: "SHOULD_NOT_APPEAR" }),
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof MultiplayerTransportError);
      assert.equal(error.code, "CONTRACT_MISMATCH");
      assert.equal(error.message.includes("SHOULD_NOT_APPEAR"), false);
      return true;
    },
  );

  await assert.rejects(
    openMultiplayerParentTransport(
      { instanceId: INSTANCE_ID, expectedConnectionGeneration: 2 },
      {
        now: () => NOW,
        requestTicket: async () => admission(),
        createSocket: () => {
          throw new Error(TICKET_PROTOCOL);
        },
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof MultiplayerTransportError);
      assert.equal(error.code, "SOCKET_OPEN_FAILED");
      assert.equal(error.message.includes("SECRET_BEARER_VALUE"), false);
      return true;
    },
  );
});

test("socket URL construction rejects credentialed or response-controlled origins", () => {
  assert.equal(
    multiplayerSocketUrl(
      "http://localhost:8787",
      `/api/multiplayer/instances/${INSTANCE_ID}/socket`,
    ),
    `ws://localhost:8787/api/multiplayer/instances/${INSTANCE_ID}/socket`,
  );
  assert.throws(
    () =>
      multiplayerSocketUrl(
        "https://user:password@api.owogg.com",
        `/api/multiplayer/instances/${INSTANCE_ID}/socket`,
      ),
    (error: unknown) =>
      error instanceof MultiplayerTransportError && error.code === "INVALID_API_ORIGIN",
  );
  assert.throws(
    () =>
      multiplayerSocketUrl(
        "https://api.owogg.com/unexpected-prefix",
        `/api/multiplayer/instances/${INSTANCE_ID}/socket`,
      ),
    (error: unknown) =>
      error instanceof MultiplayerTransportError && error.code === "INVALID_API_ORIGIN",
  );
  assert.throws(
    () => multiplayerSocketUrl("https://api.owogg.com", "https://evil.example/socket"),
    (error: unknown) =>
      error instanceof MultiplayerTransportError && error.code === "CONTRACT_MISMATCH",
  );
});
