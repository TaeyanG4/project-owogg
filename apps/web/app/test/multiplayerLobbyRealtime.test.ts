import assert from "node:assert/strict";
import test from "node:test";
import {
  MULTIPLAYER_HEARTBEAT_REQUEST,
  MULTIPLAYER_HEARTBEAT_RESPONSE,
  MULTIPLAYER_LOBBY_WEBSOCKET_PROTOCOL,
} from "@owogg/contracts";
import {
  multiplayerLobbySocketUrl,
  openMultiplayerLobbyRealtime,
  type MultiplayerLobbySocketLike,
} from "../features/game/runtime/multiplayerLobbyRealtime";

const INSTANCE_ID = "instance_lobby_test_01";

function socketHarness(selectedProtocol = MULTIPLAYER_LOBBY_WEBSOCKET_PROTOCOL) {
  let readyState = 0;
  const sent: string[] = [];
  const closes: Array<{ code?: number; reason?: string }> = [];
  const listeners = {
    open: new Set<(event: { readonly data?: unknown }) => void>(),
    message: new Set<(event: { readonly data?: unknown }) => void>(),
    close: new Set<(event: { readonly data?: unknown }) => void>(),
    error: new Set<(event: { readonly data?: unknown }) => void>(),
  };
  const socket: MultiplayerLobbySocketLike = {
    protocol: selectedProtocol,
    get readyState() {
      return readyState;
    },
    send(data) {
      sent.push(data);
    },
    close(code, reason) {
      closes.push({ ...(code !== undefined ? { code } : {}), ...(reason ? { reason } : {}) });
      readyState = 3;
    },
    addEventListener(type, listener) {
      listeners[type].add(listener);
    },
    removeEventListener(type, listener) {
      listeners[type].delete(listener);
    },
  };
  return {
    socket,
    sent,
    closes,
    open() {
      readyState = 1;
      for (const listener of [...listeners.open]) listener({});
    },
    message(data: unknown) {
      for (const listener of [...listeners.message]) listener({ data });
    },
    disconnect(type: "close" | "error") {
      readyState = 3;
      for (const listener of [...listeners[type]]) listener({});
    },
  };
}

test("lobby socket URL is credential-free and anchored to the configured API origin", () => {
  assert.equal(
    multiplayerLobbySocketUrl("https://api-stg.owogg.com", INSTANCE_ID),
    `wss://api-stg.owogg.com/api/multiplayer/instances/${INSTANCE_ID}/lobby-socket`,
  );
  assert.equal(
    multiplayerLobbySocketUrl("http://localhost:8787", INSTANCE_ID),
    `ws://localhost:8787/api/multiplayer/instances/${INSTANCE_ID}/lobby-socket`,
  );
  assert.throws(() => multiplayerLobbySocketUrl("https://user:secret@api.owogg.com", INSTANCE_ID));
  assert.throws(() => multiplayerLobbySocketUrl("https://api.owogg.com/path", INSTANCE_ID));
  assert.throws(() => multiplayerLobbySocketUrl("https://api.owogg.com", "../bad"));
});

test("valid increasing lobby invalidations refresh once and heartbeat stays transport-only", () => {
  const harness = socketHarness();
  const constructorInputs: Array<{ url: string; protocol: string }> = [];
  let connected = 0;
  let changed = 0;
  let disconnected = 0;
  let heartbeat: (() => void) | undefined;
  let cleared = 0;
  const timerHandle = 7 as unknown as ReturnType<typeof setInterval>;
  const handle = openMultiplayerLobbyRealtime(
    {
      instanceId: INSTANCE_ID,
      generation: 3,
      onConnected: () => (connected += 1),
      onChanged: () => (changed += 1),
      onDisconnected: () => (disconnected += 1),
    },
    {
      apiUrl: "https://api-stg.owogg.com",
      createSocket(url, protocol) {
        constructorInputs.push({ url, protocol });
        return harness.socket;
      },
      setInterval(callback, delay) {
        assert.equal(delay, 15_000);
        heartbeat = callback;
        return timerHandle;
      },
      clearInterval(timer) {
        assert.equal(timer, timerHandle);
        cleared += 1;
      },
    },
  );

  assert.deepEqual(constructorInputs, [
    {
      url: `wss://api-stg.owogg.com/api/multiplayer/instances/${INSTANCE_ID}/lobby-socket`,
      protocol: MULTIPLAYER_LOBBY_WEBSOCKET_PROTOCOL,
    },
  ]);
  harness.open();
  assert.equal(connected, 1);
  heartbeat?.();
  assert.deepEqual(harness.sent, [MULTIPLAYER_HEARTBEAT_REQUEST]);
  harness.message(MULTIPLAYER_HEARTBEAT_RESPONSE);
  harness.message(
    JSON.stringify({
      type: "LOBBY_CHANGED",
      v: 1,
      instanceId: INSTANCE_ID,
      generation: 3,
      sequence: 1,
    }),
  );
  harness.message(
    JSON.stringify({
      type: "LOBBY_CHANGED",
      v: 1,
      instanceId: INSTANCE_ID,
      generation: 3,
      sequence: 1,
    }),
  );
  harness.message(
    JSON.stringify({
      type: "LOBBY_CHANGED",
      v: 1,
      instanceId: INSTANCE_ID,
      generation: 4,
      sequence: 2,
    }),
  );
  harness.message("not-json");
  assert.equal(changed, 1);

  harness.disconnect("error");
  harness.disconnect("close");
  assert.equal(disconnected, 1);
  assert.equal(cleared, 1);
  handle.close();
});

test("intentional close is silent while a wrong selected protocol requests recovery", () => {
  const intentional = socketHarness();
  let intentionalDisconnects = 0;
  const intentionalHandle = openMultiplayerLobbyRealtime(
    {
      instanceId: INSTANCE_ID,
      generation: 1,
      onChanged() {},
      onDisconnected: () => (intentionalDisconnects += 1),
    },
    { createSocket: () => intentional.socket },
  );
  intentionalHandle.close();
  intentional.disconnect("close");
  assert.equal(intentionalDisconnects, 0);
  assert.deepEqual(intentional.closes, [{ code: 1000, reason: "lobby closed" }]);

  const wrongProtocol = socketHarness("unexpected.protocol");
  let protocolDisconnects = 0;
  openMultiplayerLobbyRealtime(
    {
      instanceId: INSTANCE_ID,
      generation: 1,
      onChanged() {},
      onDisconnected: () => (protocolDisconnects += 1),
    },
    { createSocket: () => wrongProtocol.socket },
  );
  wrongProtocol.open();
  assert.equal(protocolDisconnects, 1);
  assert.deepEqual(wrongProtocol.closes, [
    { code: 1002, reason: "invalid multiplayer lobby protocol" },
  ]);
});
