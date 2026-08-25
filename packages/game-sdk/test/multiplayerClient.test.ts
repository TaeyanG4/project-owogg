import assert from "node:assert/strict";
import test from "node:test";
import {
  connectMultiplayerBridge,
  type MultiplayerBridgeWindowLike,
} from "../src/bridge/multiplayerClient.js";

const BOOTSTRAP = {
  type: "MULTI_INIT",
  v: 1,
  participantId: "participant_client_001",
  gameVersionId: 12,
  profileRevision: 2,
  rulesetKey: "official:omok",
  rulesetRevision: 1,
  generation: 3,
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

test("only the real parent can transfer an exact credential-free MULTI_INIT", async () => {
  const harness = createWindowHarness();
  const channel = new MessageChannel();
  const connected = connectMultiplayerBridge(harness.windowLike);

  harness.dispatch(harness.attacker, BOOTSTRAP, [channel.port2]);
  assert.equal(harness.listenerCount(), 1);
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

test("ready/action/input/leave use one monotonic client sequence and retry-stable action ids", async () => {
  const harness = createWindowHarness();
  const channel = new MessageChannel();
  const messages: unknown[] = [];
  channel.port1.onmessage = (event) => messages.push(event.data);
  const connected = connectMultiplayerBridge(harness.windowLike, {
    createActionId: () => "action_client_generated_0001",
  });
  harness.dispatch(harness.parent, BOOTSTRAP, [channel.port2]);
  const client = await connected;

  assert.equal(client.ready(), true);
  assert.equal(client.ready(), false);
  assert.equal(
    client.action({ expectedRevision: 0, payload: { type: "PLACE", row: 1, column: 2 } }),
    "action_client_generated_0001",
  );
  assert.equal(client.input({ cursor: [1, 2] }), true);
  client.leave();
  assert.equal(client.input({ after: "leave" }), false);
  await waitUntil(() => messages.length, 4);

  assert.deepEqual(messages, [
    { type: "MULTI_READY", v: 1, generation: 3 },
    {
      type: "MULTI_ACTION",
      v: 1,
      generation: 3,
      clientSeq: 1,
      clientActionId: "action_client_generated_0001",
      expectedRevision: 0,
      payload: { type: "PLACE", row: 1, column: 2 },
    },
    {
      type: "MULTI_INPUT",
      v: 1,
      generation: 3,
      clientSeq: 2,
      payload: { cursor: [1, 2] },
    },
    { type: "MULTI_LEAVE", v: 1, generation: 3 },
  ]);
  client.disconnect();
  channel.port1.close();
});

test("invalid outbound payloads do not consume sequence numbers", async () => {
  const harness = createWindowHarness();
  const channel = new MessageChannel();
  const messages: unknown[] = [];
  channel.port1.onmessage = (event) => messages.push(event.data);
  const connected = connectMultiplayerBridge(harness.windowLike);
  harness.dispatch(harness.parent, BOOTSTRAP, [channel.port2]);
  const client = await connected;

  assert.equal(
    client.action({
      clientActionId: "bad",
      expectedRevision: 0,
      payload: {},
    }),
    null,
  );
  assert.equal(client.input({ valid: true }), true);
  await waitUntil(() => messages.length, 1);
  assert.deepEqual(messages[0], {
    type: "MULTI_INPUT",
    v: 1,
    generation: 3,
    clientSeq: 1,
    payload: { valid: true },
  });
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
  assert.equal(client.input({ valid: true }), false);
  assert.equal(client.action(null as never), null);
  assert.equal(
    client.action({ expectedRevision: 0, payload: {}, clientActionId: "action_valid_123456789" }),
    null,
  );
  assert.doesNotThrow(() => (client.subscribe as (listener: unknown) => () => void)(null)());
  client.disconnect();
});

test("drops stale generation, duplicate server sequence, and port-level MULTI_INIT", async () => {
  const harness = createWindowHarness();
  const channel = new MessageChannel();
  const connected = connectMultiplayerBridge(harness.windowLike);
  harness.dispatch(harness.parent, BOOTSTRAP, [channel.port2]);
  const client = await connected;
  const received: unknown[] = [];
  client.subscribe((message) => received.push(message));

  channel.port1.postMessage({ ...BOOTSTRAP, generation: 4 });
  channel.port1.postMessage({
    type: "MULTI_STATE",
    v: 1,
    generation: 2,
    serverSeq: 1,
    revision: 1,
    payload: {},
  });
  channel.port1.postMessage({
    type: "MULTI_STATE",
    v: 1,
    generation: 3,
    serverSeq: 2,
    revision: 2,
    payload: { board: [] },
  });
  channel.port1.postMessage({
    type: "MULTI_EVENT",
    v: 1,
    generation: 3,
    serverSeq: 2,
    name: "DUPLICATE",
  });
  channel.port1.postMessage({
    type: "MULTI_EVENT",
    v: 1,
    generation: 3,
    serverSeq: 3,
    name: "NEXT",
  });
  await waitUntil(() => received.length, 2);

  assert.deepEqual(received, [
    {
      type: "MULTI_STATE",
      v: 1,
      generation: 3,
      serverSeq: 2,
      revision: 2,
      payload: { board: [] },
    },
    { type: "MULTI_EVENT", v: 1, generation: 3, serverSeq: 3, name: "NEXT" },
  ]);
  client.disconnect();
  channel.port1.close();
});
