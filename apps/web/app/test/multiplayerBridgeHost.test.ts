import assert from "node:assert/strict";
import test from "node:test";
import type { MultiInitMessage } from "@owogg/game-sdk/bridge";
import {
  createMultiplayerBridgeHost,
  type MultiplayerBridgeIframeWindowLike,
  type MultiplayerBridgeSocketLike,
  type MultiplayerParentConnectionState,
} from "../features/game/runtime/multiplayerBridgeHost";

const BOOTSTRAP: MultiInitMessage = {
  type: "MULTI_INIT",
  v: 1,
  participantId: "participant_host_0001",
  gameVersionId: 12,
  profileRevision: 2,
  rulesetKey: "official:omok",
  rulesetRevision: 1,
  generation: 3,
};

function createIframeHarness() {
  let message: unknown;
  let targetOrigin = "";
  let transfer: Transferable[] = [];
  const windowLike: MultiplayerBridgeIframeWindowLike = {
    postMessage(nextMessage, nextTargetOrigin, nextTransfer) {
      message = nextMessage;
      targetOrigin = nextTargetOrigin;
      transfer = nextTransfer;
    },
  };
  return {
    windowLike,
    capture() {
      assert.ok(transfer[0] instanceof MessagePort);
      return { message, targetOrigin, port: transfer[0] };
    },
  };
}

function createSocketHarness(initialReadyState = 1, failSends = false) {
  let readyState = initialReadyState;
  const sent: string[] = [];
  const closes: Array<{ code?: number; reason?: string }> = [];
  const openListeners = new Set<() => void>();
  const messageListeners = new Set<(event: { data: unknown }) => void>();
  const closeListeners = new Set<(event: { code: number; reason?: string }) => void>();
  const errorListeners = new Set<() => void>();

  const socket: MultiplayerBridgeSocketLike = {
    get readyState() {
      return readyState;
    },
    send(data) {
      if (failSends) throw new Error("socket closed during send");
      sent.push(data);
    },
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
    sent,
    closes,
    open() {
      readyState = 1;
      for (const listener of [...openListeners]) listener();
    },
    message(data: unknown) {
      for (const listener of [...messageListeners]) listener({ data });
    },
    closeFromServer(code: number, reason?: string) {
      readyState = 3;
      for (const listener of [...closeListeners]) {
        listener({ code, ...(reason ? { reason } : {}) });
      }
    },
  };
}

async function waitUntil(actual: () => number, expected: number, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (actual() < expected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("bootstrap carries only MULTI_INIT and the port; validated game intents reach only the socket", async () => {
  const iframe = createIframeHarness();
  const socket = createSocketHarness();
  let readyCalls = 0;
  let drops = 0;
  const host = createMultiplayerBridgeHost(iframe.windowLike, socket.socket, BOOTSTRAP, {
    onReady: () => (readyCalls += 1),
    onProtocolDrop: (direction) => {
      assert.equal(direction, "GAME_TO_HOST");
      drops += 1;
    },
  });
  const capture = iframe.capture();
  assert.deepEqual(capture.message, BOOTSTRAP);
  assert.equal(capture.targetOrigin, "*");
  assert.equal(JSON.stringify(capture.message).includes("ticket"), false);

  capture.port.postMessage({ type: "MULTI_READY", v: 1, generation: 3 });
  capture.port.postMessage({
    type: "MULTI_ACTION",
    v: 1,
    generation: 3,
    clientSeq: 1,
    clientActionId: "action_host_1234567890",
    expectedRevision: 0,
    payload: { type: "PLACE", row: 1, column: 2 },
  });
  capture.port.postMessage({
    type: "MULTI_INPUT",
    v: 1,
    generation: 3,
    clientSeq: 3,
    payload: {},
  });
  capture.port.postMessage({ type: "GAME_COMPLETE", score: 999_999 });
  await waitUntil(() => socket.sent.length + drops, 4);

  assert.equal(readyCalls, 1);
  assert.equal(drops, 2);
  assert.deepEqual(
    socket.sent.map((value) => JSON.parse(value)),
    [
      { type: "MULTI_READY", v: 1, generation: 3 },
      {
        type: "MULTI_ACTION",
        v: 1,
        generation: 3,
        clientSeq: 1,
        clientActionId: "action_host_1234567890",
        expectedRevision: 0,
        payload: { type: "PLACE", row: 1, column: 2 },
      },
    ],
  );
  host.close();
  capture.port.close();
});

test("queues bounded game messages while connecting and flushes in order on open", async () => {
  const iframe = createIframeHarness();
  const socket = createSocketHarness(0);
  const host = createMultiplayerBridgeHost(iframe.windowLike, socket.socket, BOOTSTRAP);
  const gamePort = iframe.capture().port;
  gamePort.postMessage({ type: "MULTI_READY", v: 1, generation: 3 });
  gamePort.postMessage({
    type: "MULTI_INPUT",
    v: 1,
    generation: 3,
    clientSeq: 1,
    payload: { cursor: 2 },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(socket.sent.length, 0);
  socket.open();
  assert.deepEqual(
    socket.sent.map((value) => JSON.parse(value)),
    [
      { type: "MULTI_READY", v: 1, generation: 3 },
      {
        type: "MULTI_INPUT",
        v: 1,
        generation: 3,
        clientSeq: 1,
        payload: { cursor: 2 },
      },
    ],
  );
  host.close();
  gamePort.close();
});

test("a socket state race drops the intent without escaping the parent bridge", async () => {
  const iframe = createIframeHarness();
  const socket = createSocketHarness(1, true);
  let drops = 0;
  const host = createMultiplayerBridgeHost(iframe.windowLike, socket.socket, BOOTSTRAP, {
    onProtocolDrop: (direction) => {
      assert.equal(direction, "GAME_TO_HOST");
      drops += 1;
    },
  });
  const gamePort = iframe.capture().port;
  gamePort.postMessage({ type: "MULTI_READY", v: 1, generation: 3 });
  await waitUntil(() => drops, 1);
  assert.equal(drops, 1);
  assert.deepEqual(socket.sent, []);
  host.close();
  gamePort.close();
});

test("server projections require current generation and strictly increasing server sequence", async () => {
  const iframe = createIframeHarness();
  const socket = createSocketHarness();
  const states: MultiplayerParentConnectionState[] = [];
  let drops = 0;
  const host = createMultiplayerBridgeHost(iframe.windowLike, socket.socket, BOOTSTRAP, {
    onConnectionState: (state) => states.push(state),
    onProtocolDrop: (direction) => {
      assert.equal(direction, "SERVER_TO_HOST");
      drops += 1;
    },
  });
  const gamePort = iframe.capture().port;
  const received: unknown[] = [];
  gamePort.onmessage = (event) => received.push(event.data);

  socket.message(
    JSON.stringify({
      type: "MULTI_CONNECTED",
      v: 1,
      generation: 3,
      connectionGeneration: 2,
    }),
  );
  socket.message(
    JSON.stringify({
      type: "MULTI_STATE",
      v: 1,
      generation: 3,
      serverSeq: 5,
      revision: 2,
      payload: { board: [] },
    }),
  );
  socket.message(
    JSON.stringify({
      type: "MULTI_EVENT",
      v: 1,
      generation: 3,
      serverSeq: 5,
      name: "DUPLICATE",
    }),
  );
  socket.message(
    JSON.stringify({
      type: "MULTI_EVENT",
      v: 1,
      generation: 4,
      serverSeq: 6,
      name: "STALE_GENERATION",
    }),
  );
  socket.message(JSON.stringify({ ...BOOTSTRAP, ticket: "must-not-enter-iframe" }));
  await waitUntil(() => received.length + drops, 5);

  assert.deepEqual(received, [
    { type: "MULTI_CONNECTED", v: 1, generation: 3, connectionGeneration: 2 },
    {
      type: "MULTI_STATE",
      v: 1,
      generation: 3,
      serverSeq: 5,
      revision: 2,
      payload: { board: [] },
    },
  ]);
  assert.equal(drops, 3);
  assert.deepEqual(states, [
    { status: "CONNECTING" },
    { status: "CONNECTED", connectionGeneration: 2 },
  ]);
  host.close();
  gamePort.close();
});

test("terminal state stays parent-owned and socket close maps to a typed disconnect", async () => {
  const iframe = createIframeHarness();
  const socket = createSocketHarness();
  const states: MultiplayerParentConnectionState[] = [];
  const terminal: unknown[] = [];
  const host = createMultiplayerBridgeHost(iframe.windowLike, socket.socket, BOOTSTRAP, {
    onConnectionState: (state) => states.push(state),
    onTerminalCommitted: (result) => terminal.push(result),
  });
  const gamePort = iframe.capture().port;
  const received: unknown[] = [];
  gamePort.onmessage = (event) => received.push(event.data);

  socket.message(
    JSON.stringify({
      type: "MULTI_TERMINAL_PENDING",
      v: 1,
      generation: 3,
      serverSeq: 7,
    }),
  );
  socket.message(
    JSON.stringify({
      type: "MULTI_TERMINAL_COMMITTED",
      v: 1,
      generation: 3,
      serverSeq: 8,
      result: { outcome: "win" },
    }),
  );
  socket.closeFromServer(4001);
  await waitUntil(() => received.length, 3);

  assert.deepEqual(terminal, [{ outcome: "win" }]);
  assert.deepEqual(states, [
    { status: "CONNECTING" },
    { status: "TERMINAL_PENDING" },
    { status: "TERMINAL_COMMITTED", result: { outcome: "win" } },
    { status: "DISCONNECTED", code: "REPLACED_BY_NEW_CONNECTION" },
  ]);
  assert.deepEqual(received[2], {
    type: "MULTI_DISCONNECTED",
    v: 1,
    generation: 3,
    code: "REPLACED_BY_NEW_CONNECTION",
  });
  host.close();
  gamePort.close();
});

test("invalid bootstrap is rejected before a port or socket listener is exposed", () => {
  const iframe = createIframeHarness();
  const socket = createSocketHarness();
  assert.throws(
    () =>
      createMultiplayerBridgeHost(iframe.windowLike, socket.socket, {
        ...BOOTSTRAP,
        apiUrl: "https://api.example.invalid",
      } as MultiInitMessage),
    /invalid multiplayer iframe bootstrap/,
  );
});
