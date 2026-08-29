import assert from "node:assert/strict";
import test from "node:test";
import {
  connectMultiplayerBridge,
  type MultiplayerBridgeWindowLike,
} from "../src/bridge/multiplayerClient.js";

const BOOTSTRAP = {
  type: "MULTI_INIT",
  v: 1,
  gameVersionId: 12,
  contentHash: "a".repeat(64),
  profileRevision: 2,
  generation: 3,
  runtime: { kind: "relay", protocolVersion: 1, resultTrust: "UNVERIFIED" },
  self: { participantId: "participant_client_001", seatIndex: 0, role: "HOST" },
  roster: [
    { participantId: "participant_client_001", seatIndex: 0, role: "HOST" },
    { participantId: "participant_client_002", seatIndex: 1, role: "PLAYER" },
  ],
  capabilities: {
    reconnect: "resume",
    broadcast: true,
    directMessages: true,
    hostSnapshot: true,
  },
} as const;

function createWindowHarness() {
  const parent = {};
  const attacker = {};
  const listeners = new Set<(event: MessageEvent) => void>();
  const windowLike: MultiplayerBridgeWindowLike = {
    parent,
    addEventListener(_type, listener) {
      listeners.add(listener);
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener);
    },
  };
  return {
    parent,
    attacker,
    windowLike,
    dispatch(source: unknown, data: unknown, ports: MessagePort[] = []) {
      const event = { source, data, ports } as unknown as MessageEvent;
      for (const listener of [...listeners]) listener(event);
    },
    listenerCount: () => listeners.size,
  };
}

async function waitUntil(actual: () => number, expected: number, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (actual() < expected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("only the real parent can transfer an exact credential-free Relay bootstrap", async () => {
  const harness = createWindowHarness();
  const channel = new MessageChannel();
  const connected = connectMultiplayerBridge(harness.windowLike);

  harness.dispatch(harness.attacker, BOOTSTRAP, [channel.port2]);
  harness.dispatch(harness.parent, { ...BOOTSTRAP, ticket: "must-not-enter-iframe" }, [
    channel.port2,
  ]);
  assert.equal(harness.listenerCount(), 1);
  harness.dispatch(harness.parent, BOOTSTRAP, [channel.port2]);

  const client = await connected;
  assert.deepEqual(client.bootstrap, BOOTSTRAP);
  assert.equal(harness.listenerCount(), 0);
  client.disconnect();
  channel.port1.close();
});

test("ready, send helpers, snapshot, and leave share one strict Relay channel", async () => {
  const harness = createWindowHarness();
  const channel = new MessageChannel();
  const messages: unknown[] = [];
  channel.port1.onmessage = (event) => messages.push(event.data);
  const connected = connectMultiplayerBridge(harness.windowLike);
  harness.dispatch(harness.parent, BOOTSTRAP, [channel.port2]);
  const client = await connected;

  assert.equal(client.ready(), true);
  assert.equal(client.ready(), false);
  assert.equal(client.send({ delivery: "broadcast", payload: { tick: 1 } }), true);
  assert.equal(client.broadcast({ tick: 2 }), true);
  assert.equal(client.direct("participant_client_002", { privateMove: 3 }), true);
  assert.equal(client.snapshot({ world: { tick: 2 } }), true);
  client.leave();
  assert.equal(client.broadcast({ after: "leave" }), false);
  await waitUntil(() => messages.length, 6);

  assert.deepEqual(messages, [
    { type: "MULTI_READY", v: 1, generation: 3 },
    {
      type: "RELAY_SEND",
      v: 1,
      generation: 3,
      clientSeq: 1,
      delivery: "broadcast",
      payload: { tick: 1 },
    },
    {
      type: "RELAY_SEND",
      v: 1,
      generation: 3,
      clientSeq: 2,
      delivery: "broadcast",
      payload: { tick: 2 },
    },
    {
      type: "RELAY_SEND",
      v: 1,
      generation: 3,
      clientSeq: 3,
      delivery: "direct",
      targetParticipantId: "participant_client_002",
      payload: { privateMove: 3 },
    },
    {
      type: "RELAY_SNAPSHOT_SET",
      v: 1,
      generation: 3,
      clientSeq: 4,
      payload: { world: { tick: 2 } },
    },
    { type: "MULTI_LEAVE", v: 1, generation: 3 },
  ]);
  client.disconnect();
  channel.port1.close();
});

test("invalid requests and disabled capabilities do not consume sequence numbers", async () => {
  const harness = createWindowHarness();
  const channel = new MessageChannel();
  const messages: unknown[] = [];
  channel.port1.onmessage = (event) => messages.push(event.data);
  const connected = connectMultiplayerBridge(harness.windowLike);
  harness.dispatch(
    harness.parent,
    {
      ...BOOTSTRAP,
      self: BOOTSTRAP.roster[1],
      capabilities: { ...BOOTSTRAP.capabilities, directMessages: false, hostSnapshot: false },
    },
    [channel.port2],
  );
  const client = await connected;

  assert.equal(client.send({ delivery: "broadcast", payload: {}, extra: true } as never), false);
  assert.equal(client.direct("participant_client_001", {}), false);
  assert.equal(client.snapshot({}), false);
  assert.equal(client.broadcast({ first: true }), true);
  await waitUntil(() => messages.length, 1);
  assert.deepEqual(messages[0], {
    type: "RELAY_SEND",
    v: 1,
    generation: 3,
    clientSeq: 1,
    delivery: "broadcast",
    payload: { first: true },
  });
  client.disconnect();
  channel.port1.close();
});

test("stale generations, duplicate server sequences, and port-level bootstrap are dropped", async () => {
  const harness = createWindowHarness();
  const channel = new MessageChannel();
  const connected = connectMultiplayerBridge(harness.windowLike);
  harness.dispatch(harness.parent, BOOTSTRAP, [channel.port2]);
  const client = await connected;
  const received: unknown[] = [];
  client.subscribe((message) => received.push(message));

  channel.port1.postMessage({ ...BOOTSTRAP, generation: 4 });
  const message = {
    type: "RELAY_MESSAGE",
    v: 1,
    generation: 3,
    serverSeq: 2,
    sender: { participantId: "participant_client_002", seatIndex: 1, role: "PLAYER" },
    delivery: "broadcast",
    payload: { value: 1 },
  } as const;
  channel.port1.postMessage({ ...message, generation: 2, serverSeq: 1 });
  channel.port1.postMessage(message);
  channel.port1.postMessage(message);
  channel.port1.postMessage({ ...message, serverSeq: 3, payload: { value: 2 } });
  await waitUntil(() => received.length, 2);
  assert.deepEqual(received, [message, { ...message, serverSeq: 3, payload: { value: 2 } }]);
  client.disconnect();
  channel.port1.close();
});

test("closed ports and malformed JavaScript calls fail without escaping the SDK", async () => {
  const harness = createWindowHarness();
  const port = {
    onmessage: null,
    postMessage() {
      throw new Error("closed port");
    },
    start() {},
    close() {},
  } as unknown as MessagePort;
  const connected = connectMultiplayerBridge(harness.windowLike);
  harness.dispatch(harness.parent, BOOTSTRAP, [port]);
  const client = await connected;

  assert.equal(client.ready(), false);
  assert.equal(client.broadcast({ valid: true }), false);
  assert.equal((client.send as (request: unknown) => boolean)(null), false);
  assert.doesNotThrow(() => (client.subscribe as (listener: unknown) => () => void)(null)());
  client.disconnect();
});
