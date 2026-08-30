import assert from "node:assert/strict";
import test from "node:test";
import type { MultiInitMessage } from "@owogg/game-sdk/bridge";
import { MULTIPLAYER_HEARTBEAT_REQUEST, MULTIPLAYER_HEARTBEAT_RESPONSE } from "@owogg/contracts";
import {
  createMultiplayerBridgeHost,
  type MultiplayerBridgeIframeWindowLike,
  type MultiplayerBridgeSocketLike,
  type MultiplayerParentConnectionState,
} from "../features/game/runtime/multiplayerBridgeHost";

const BOOTSTRAP: MultiInitMessage = {
  type: "MULTI_INIT",
  v: 1,
  gameVersionId: 12,
  contentHash: "a".repeat(64),
  profileRevision: 2,
  generation: 3,
  runtime: { kind: "relay", protocolVersion: 1, resultTrust: "UNVERIFIED" },
  self: { participantId: "participant_host_0001", seatIndex: 0, role: "HOST" },
  roster: [
    { participantId: "participant_host_0001", seatIndex: 0, role: "HOST" },
    { participantId: "participant_player_0001", seatIndex: 1, role: "PLAYER" },
  ],
  capabilities: {
    reconnect: "resume",
    broadcast: true,
    directMessages: true,
    hostSnapshot: true,
  },
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

test("Relay bootstrap is credential-free and only strict Relay intents reach the socket", async () => {
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
  assert.doesNotMatch(JSON.stringify(capture.message), /ticket|socket|userId/i);

  capture.port.postMessage({ type: "MULTI_READY", v: 1, generation: 3 });
  capture.port.postMessage({
    type: "RELAY_SEND",
    v: 1,
    generation: 3,
    clientSeq: 1,
    delivery: "broadcast",
    payload: { move: [1, 2] },
  });
  capture.port.postMessage({
    type: "RELAY_SEND",
    v: 1,
    generation: 3,
    clientSeq: 3,
    delivery: "broadcast",
    payload: { skipped: true },
  });
  capture.port.postMessage({
    type: "MULTI_ACTION",
    v: 1,
    generation: 3,
    clientSeq: 2,
    payload: {},
  });
  await waitUntil(() => socket.sent.length + drops, 5);

  assert.equal(readyCalls, 1);
  assert.equal(drops, 2);
  assert.deepEqual(
    socket.sent.slice(1).map((value) => JSON.parse(value)),
    [
      { type: "MULTI_READY", v: 1, generation: 3 },
      {
        type: "RELAY_SEND",
        v: 1,
        generation: 3,
        clientSeq: 1,
        delivery: "broadcast",
        payload: { move: [1, 2] },
      },
    ],
  );
  assert.equal(socket.sent[0], MULTIPLAYER_HEARTBEAT_REQUEST);
  host.close();
  capture.port.close();
});

test("connecting sockets queue valid intents and flush them in order", async () => {
  const iframe = createIframeHarness();
  const socket = createSocketHarness(0);
  const host = createMultiplayerBridgeHost(iframe.windowLike, socket.socket, BOOTSTRAP);
  const port = iframe.capture().port;
  port.postMessage({ type: "MULTI_READY", v: 1, generation: 3 });
  port.postMessage({
    type: "RELAY_SNAPSHOT_SET",
    v: 1,
    generation: 3,
    clientSeq: 1,
    payload: { frame: 7 },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(socket.sent.length, 0);
  socket.open();
  assert.deepEqual(
    socket.sent.slice(0, 2).map((value) => JSON.parse(value)),
    [
      { type: "MULTI_READY", v: 1, generation: 3 },
      {
        type: "RELAY_SNAPSHOT_SET",
        v: 1,
        generation: 3,
        clientSeq: 1,
        payload: { frame: 7 },
      },
    ],
  );
  assert.equal(socket.sent[2], MULTIPLAYER_HEARTBEAT_REQUEST);
  host.close();
  port.close();
});

test("server deliveries require current generation and increasing server sequence", async () => {
  const iframe = createIframeHarness();
  const socket = createSocketHarness();
  let drops = 0;
  const host = createMultiplayerBridgeHost(iframe.windowLike, socket.socket, BOOTSTRAP, {
    onProtocolDrop: (direction) => {
      assert.equal(direction, "SERVER_TO_HOST");
      drops += 1;
    },
  });
  const port = iframe.capture().port;
  const received: unknown[] = [];
  port.onmessage = (event) => received.push(event.data);
  port.start();
  const delivery = {
    type: "RELAY_MESSAGE",
    v: 1,
    generation: 3,
    serverSeq: 1,
    sender: { participantId: "participant_player_0001", seatIndex: 1, role: "PLAYER" },
    delivery: "broadcast",
    payload: { event: "jump" },
  } as const;
  socket.message(JSON.stringify(delivery));
  socket.message(JSON.stringify(delivery));
  socket.message(JSON.stringify({ ...delivery, generation: 4, serverSeq: 2 }));
  socket.message(MULTIPLAYER_HEARTBEAT_RESPONSE);
  await waitUntil(() => received.length + drops, 3);

  assert.deepEqual(received, [delivery]);
  assert.equal(drops, 2);
  host.close();
  port.close();
});

test("Relay close and socket loss remain trusted parent connection states", async () => {
  const iframe = createIframeHarness();
  const socket = createSocketHarness();
  const states: MultiplayerParentConnectionState[] = [];
  const host = createMultiplayerBridgeHost(iframe.windowLike, socket.socket, BOOTSTRAP, {
    onConnectionState: (state) => states.push(state),
  });
  const port = iframe.capture().port;
  socket.message(
    JSON.stringify({ type: "MULTI_CONNECTED", v: 1, generation: 3, connectionGeneration: 4 }),
  );
  socket.message(
    JSON.stringify({ type: "RELAY_CLOSED", v: 1, generation: 3, code: "ROOM_EXPIRED" }),
  );
  socket.closeFromServer(1006);
  await waitUntil(() => states.length, 3);
  assert.deepEqual(states, [
    { status: "CONNECTING" },
    { status: "CONNECTED", connectionGeneration: 4 },
    { status: "CLOSED", code: "ROOM_EXPIRED" },
  ]);
  host.close();
  port.close();

  const iframe2 = createIframeHarness();
  const socket2 = createSocketHarness();
  const states2: MultiplayerParentConnectionState[] = [];
  const host2 = createMultiplayerBridgeHost(iframe2.windowLike, socket2.socket, BOOTSTRAP, {
    onConnectionState: (state) => states2.push(state),
  });
  const port2 = iframe2.capture().port;
  socket2.closeFromServer(4001);
  socket2.closeFromServer(4001);
  await waitUntil(() => states2.length, 2);
  assert.deepEqual(states2, [
    { status: "CONNECTING" },
    { status: "DISCONNECTED", code: "REPLACED_BY_NEW_CONNECTION" },
  ]);
  host2.close();
  port2.close();
});

test("heartbeat is parent-only and stops after an explicit leave", () => {
  const iframe = createIframeHarness();
  const socket = createSocketHarness();
  let tick: (() => void) | undefined;
  let cleared = 0;
  const host = createMultiplayerBridgeHost(
    iframe.windowLike,
    socket.socket,
    BOOTSTRAP,
    {},
    {
      setInterval(callback) {
        tick = callback;
        return 1 as unknown as ReturnType<typeof setInterval>;
      },
      clearInterval() {
        cleared += 1;
      },
    },
  );
  const port = iframe.capture().port;
  assert.deepEqual(socket.sent, [MULTIPLAYER_HEARTBEAT_REQUEST]);
  tick?.();
  assert.deepEqual(socket.sent, [MULTIPLAYER_HEARTBEAT_REQUEST, MULTIPLAYER_HEARTBEAT_REQUEST]);
  assert.equal(host.leave(), true);
  tick?.();
  assert.equal(socket.sent.length, 3);
  assert.equal(JSON.parse(socket.sent[2] ?? "null").type, "MULTI_LEAVE");
  assert.equal(cleared, 1);
  host.close();
  port.close();
});

test("heartbeat RTT is reported outside game traffic and synchronized per participant", async () => {
  const iframe = createIframeHarness();
  const socket = createSocketHarness();
  let nowMs = 10_000;
  let heartbeatTick: (() => void) | undefined;
  const samples: Array<readonly { participantId: string; seatIndex: number; rttMs: number }[]> = [];
  const host = createMultiplayerBridgeHost(
    iframe.windowLike,
    socket.socket,
    BOOTSTRAP,
    { onLatencySamples: (next) => samples.push(next) },
    {
      now: () => nowMs,
      setInterval: (callback) => {
        heartbeatTick = callback;
        return 1 as unknown as ReturnType<typeof setInterval>;
      },
      clearInterval: () => undefined,
    },
  );
  const port = iframe.capture().port;
  const gameMessages: unknown[] = [];
  port.onmessage = (event) => gameMessages.push(event.data);
  port.start();

  assert.deepEqual(socket.sent, [MULTIPLAYER_HEARTBEAT_REQUEST]);
  nowMs += 42;
  socket.message(MULTIPLAYER_HEARTBEAT_RESPONSE);
  assert.deepEqual(JSON.parse(socket.sent[1] ?? "null"), {
    type: "MULTI_LATENCY_REPORT",
    v: 1,
    generation: 3,
    rttMs: 42,
  });
  assert.deepEqual(samples[0], [
    {
      participantId: "participant_host_0001",
      seatIndex: 0,
      rttMs: 42,
      sampledAt: 10_042,
    },
  ]);

  nowMs = 10_100;
  heartbeatTick?.();
  nowMs = 10_170;
  socket.message(MULTIPLAYER_HEARTBEAT_RESPONSE);
  assert.equal(socket.sent.filter((value) => value.includes("MULTI_LATENCY_REPORT")).length, 1);

  nowMs = 40_100;
  heartbeatTick?.();
  nowMs = 40_170;
  socket.message(MULTIPLAYER_HEARTBEAT_RESPONSE);
  assert.equal(socket.sent.filter((value) => value.includes("MULTI_LATENCY_REPORT")).length, 2);
  assert.equal(JSON.parse(socket.sent.at(-1) ?? "null").rttMs, 70);

  socket.message(
    JSON.stringify({
      type: "MULTI_LATENCY_SYNC",
      v: 1,
      generation: 3,
      samples: [
        {
          participantId: "participant_host_0001",
          seatIndex: 0,
          rttMs: 42,
          sampledAt: 10_042,
        },
        {
          participantId: "participant_player_0001",
          seatIndex: 1,
          rttMs: 85,
          sampledAt: 10_050,
        },
      ],
    }),
  );
  await waitUntil(() => samples.at(-1)?.length ?? 0, 2);
  assert.equal(gameMessages.length, 0);
  assert.equal(samples.at(-1)?.[1]?.rttMs, 85);

  host.close();
  port.close();
});

test("invalid bootstrap is rejected before a port is exposed", () => {
  const iframe = createIframeHarness();
  const socket = createSocketHarness();
  assert.throws(
    () =>
      createMultiplayerBridgeHost(iframe.windowLike, socket.socket, {
        ...BOOTSTRAP,
        runtime: { kind: "relay", protocolVersion: 1, resultTrust: "UNVERIFIED", extra: true },
      } as unknown as MultiInitMessage),
    /invalid multiplayer iframe bootstrap/,
  );
  assert.equal(socket.sent.length, 0);
  assert.equal(socket.closes.length, 0);
});
