import test from "node:test";
import assert from "node:assert/strict";
import {
  connectGameBridge,
  GamePlayModeSelectionError,
  GameStartRequestError,
  type GameBridgeWindowLike,
} from "../src/bridge/client.js";

const PLAY_CONFIG = {
  defaultDifficultyId: "normal",
  defaultVariantId: "standard",
  difficulties: [
    { id: "normal", label: "Normal" },
    { id: "hard", label: "Hard" },
  ],
  variants: [{ id: "standard", label: "Standard" }],
  allowedConfigs: [
    { difficultyId: "normal", variantId: "standard", rewardFactor: 1 },
    { difficultyId: "hard", variantId: "standard", rewardFactor: 1.25 },
  ],
} as const;

const START_CONTEXT = {
  ranked: true,
  playConfig: { difficultyId: "hard", variantId: "standard" },
  rulesetRevision: 7,
  challengeSeed: "challenge_seed_0001",
  rewardFactor: 1.25,
} as const;

/**
 * connectGameBridge() runs inside a game's iframe and needs `window`/`window.parent` — this suite
 * has no DOM, so every test drives it through the injectable `GameBridgeWindowLike` instead (see
 * that type's doc comment). This is real coverage of the actual bootstrap logic, not a stand-in
 * for it: the fake only replaces `addEventListener`/`removeEventListener`/`parent`, which is
 * exactly the surface connectGameBridge touches before it hands control to the MessagePort (a real
 * one — `MessageChannel`/`MessagePort` are native Node globals, not something this fake provides).
 */

interface FakeWindow extends GameBridgeWindowLike {
  dispatch(event: MessageEvent): void;
  listenerCount(): number;
}

function createFakeWindow(parent: unknown): FakeWindow {
  const listeners = new Set<(event: MessageEvent) => void>();
  return {
    parent,
    addEventListener(_type, listener) {
      listeners.add(listener);
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener);
    },
    dispatch(event) {
      for (const listener of [...listeners]) listener(event);
    },
    listenerCount() {
      return listeners.size;
    },
  };
}

function fakeMessageEvent(data: unknown, source: unknown, ports: readonly MessagePort[] = []) {
  return { data, source, ports } as unknown as MessageEvent;
}

/**
 * Waits for `received.length` to reach `length`, polling instead of sleeping a single fixed
 * duration. A MessagePort delivers asynchronously even on the same process — a hardcoded
 * `setTimeout(10)` assumes that delivery always lands inside 10ms, which held on a local
 * Windows/Node 24 run but was observed to miss on CI's Linux/Node 22 runner under load. This
 * still resolves in a handful of milliseconds on any machine where delivery is prompt; it only
 * costs more when the runner is genuinely slower, which is exactly when a fixed wait is wrong.
 */
async function waitForLength(
  received: readonly unknown[],
  length: number,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (received.length < length && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5));
  }
}

test("resolves once a valid HOST_INIT arrives from window.parent, carrying a port", async () => {
  const parent = {};
  const fakeWindow = createFakeWindow(parent);
  const channel = new MessageChannel();

  const clientPromise = connectGameBridge(fakeWindow);
  fakeWindow.dispatch(fakeMessageEvent({ type: "HOST_INIT" }, parent, [channel.port2]));

  const client = await clientPromise;
  assert.equal(typeof client.ready, "function");
  channel.port1.close();
  channel.port2.close();
});

test("ignores a message whose source is not window.parent — cannot be impersonated by a sibling frame", async () => {
  const parent = {};
  const impostor = {};
  const fakeWindow = createFakeWindow(parent);
  const channel = new MessageChannel();

  const clientPromise = connectGameBridge(fakeWindow);
  fakeWindow.dispatch(fakeMessageEvent({ type: "HOST_INIT" }, impostor, [channel.port2]));

  // Must not have resolved — prove it by racing against a microtask flush, then complete the real
  // bootstrap and confirm THAT resolves it.
  let resolvedEarly = false;
  void clientPromise.then(() => {
    resolvedEarly = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(resolvedEarly, false);

  fakeWindow.dispatch(fakeMessageEvent({ type: "HOST_INIT" }, parent, [channel.port2]));
  await clientPromise;
  channel.port1.close();
  channel.port2.close();
});

test("ignores a message that isn't a valid HOST_INIT shape", async () => {
  const parent = {};
  const fakeWindow = createFakeWindow(parent);
  const channel = new MessageChannel();

  const clientPromise = connectGameBridge(fakeWindow);
  fakeWindow.dispatch(fakeMessageEvent({ type: "GAME_READY" }, parent, [channel.port2]));
  fakeWindow.dispatch(fakeMessageEvent("HOST_INIT", parent, [channel.port2]));

  let resolvedEarly = false;
  void clientPromise.then(() => {
    resolvedEarly = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(resolvedEarly, false);

  fakeWindow.dispatch(fakeMessageEvent({ type: "HOST_INIT" }, parent, [channel.port2]));
  await clientPromise;
  channel.port1.close();
  channel.port2.close();
});

test("ignores a structurally-valid HOST_INIT with no port attached", async () => {
  const parent = {};
  const fakeWindow = createFakeWindow(parent);
  const channel = new MessageChannel();

  const clientPromise = connectGameBridge(fakeWindow);
  fakeWindow.dispatch(fakeMessageEvent({ type: "HOST_INIT" }, parent, []));

  let resolvedEarly = false;
  void clientPromise.then(() => {
    resolvedEarly = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(resolvedEarly, false);

  fakeWindow.dispatch(fakeMessageEvent({ type: "HOST_INIT" }, parent, [channel.port2]));
  await clientPromise;
  channel.port1.close();
  channel.port2.close();
});

test("removes the window message listener the instant bootstrap succeeds", async () => {
  const parent = {};
  const fakeWindow = createFakeWindow(parent);
  const channel = new MessageChannel();

  assert.equal(fakeWindow.listenerCount(), 0);
  const clientPromise = connectGameBridge(fakeWindow);
  assert.equal(fakeWindow.listenerCount(), 1);

  fakeWindow.dispatch(fakeMessageEvent({ type: "HOST_INIT" }, parent, [channel.port2]));
  await clientPromise;

  assert.equal(fakeWindow.listenerCount(), 0);
  channel.port1.close();
  channel.port2.close();
});

test("a duplicate HOST_INIT after bootstrap is a no-op — the listener is already gone", async () => {
  const parent = {};
  const fakeWindow = createFakeWindow(parent);
  const channelA = new MessageChannel();
  const channelB = new MessageChannel();

  const clientPromise = connectGameBridge(fakeWindow);
  fakeWindow.dispatch(fakeMessageEvent({ type: "HOST_INIT" }, parent, [channelA.port2]));
  const client = await clientPromise;

  // A second HOST_INIT (e.g. a buggy or malicious re-dispatch) must not swap the client's
  // underlying port out from under it. dispatch() itself is a no-op here since the listener was
  // already removed — this asserts that AND that the original channel is still what's live: a
  // message sent through the original port must still work.
  fakeWindow.dispatch(fakeMessageEvent({ type: "HOST_INIT" }, parent, [channelB.port2]));

  const received: unknown[] = [];
  channelA.port1.on("message", (data) => received.push(data));
  client.ready();
  await waitForLength(received, 1);
  assert.deepEqual(received, [{ type: "GAME_READY" }]);

  channelA.port1.close();
  channelA.port2.close();
  channelB.port1.close();
  channelB.port2.close();
});

// ── HOST_INIT's optional difficultyId (2026-08-19, aim-test) ─────────────────

test("client.difficultyId is undefined when the host's HOST_INIT carried none — every existing bootstrap", async () => {
  const parent = {};
  const fakeWindow = createFakeWindow(parent);
  const channel = new MessageChannel();

  const clientPromise = connectGameBridge(fakeWindow);
  fakeWindow.dispatch(fakeMessageEvent({ type: "HOST_INIT" }, parent, [channel.port2]));

  const client = await clientPromise;
  assert.equal(client.difficultyId, undefined);
  channel.port1.close();
  channel.port2.close();
});

test("client.difficultyId carries the host's HOST_INIT difficultyId when present", async () => {
  const parent = {};
  const fakeWindow = createFakeWindow(parent);
  const channel = new MessageChannel();

  const clientPromise = connectGameBridge(fakeWindow);
  fakeWindow.dispatch(
    fakeMessageEvent({ type: "HOST_INIT", difficultyId: "hard" }, parent, [channel.port2]),
  );

  const client = await clientPromise;
  assert.equal(client.difficultyId, "hard");
  channel.port1.close();
  channel.port2.close();
});

// ── the returned client's message-sending methods ────────────────────────────

async function connectedClient(
  init: {
    type: "HOST_INIT";
    difficultyId?: string;
    playConfig?: typeof PLAY_CONFIG;
    playModes?: readonly ("single" | "local-multi" | "online-multi")[];
  } = {
    type: "HOST_INIT",
  },
) {
  const parent = {};
  const fakeWindow = createFakeWindow(parent);
  const channel = new MessageChannel();
  const clientPromise = connectGameBridge(fakeWindow);
  fakeWindow.dispatch(fakeMessageEvent(init, parent, [channel.port2]));
  const client = await clientPromise;

  const received: unknown[] = [];
  channel.port1.on("message", (data) => received.push(data));

  return {
    client,
    hostPort: channel.port1,
    received,
    // For an assertion that a message DID arrive: poll (see waitForLength's comment).
    async waitForCount(count: number) {
      await waitForLength(received, count);
    },
    // For an assertion that nothing arrived: a message that was never going to come can't be
    // "waited for", so this stays a fixed, generous pause instead.
    async flush() {
      await new Promise((r) => setTimeout(r, 50));
    },
    close() {
      channel.port1.close();
      channel.port2.close();
    },
  };
}

test("ready()/started()/cancel() send their bare message with no extra fields", async () => {
  const { client, received, waitForCount, close } = await connectedClient();
  client.ready();
  client.started();
  client.cancel();
  await waitForCount(3);
  assert.deepEqual(received, [
    { type: "GAME_READY" },
    { type: "GAME_STARTED" },
    { type: "GAME_CANCEL" },
  ]);
  close();
});

test("complete() sends score and metadata through untouched", async () => {
  const { client, received, waitForCount, close } = await connectedClient();
  client.complete({ score: 4200, metadata: { wpm: 88 } });
  await waitForCount(1);
  assert.deepEqual(received, [{ type: "GAME_COMPLETE", score: 4200, metadata: { wpm: 88 } }]);
  close();
});

test("a second complete() call is ignored — one round can only finish once", async () => {
  const { client, received, waitForCount, close } = await connectedClient();
  client.complete({ score: 100 });
  client.complete({ score: 999 });
  await waitForCount(1);
  assert.equal(received.length, 1);
  assert.deepEqual(received[0], { type: "GAME_COMPLETE", score: 100 });
  close();
});

test("error() sends an optional message", async () => {
  const { client, received, waitForCount, close } = await connectedClient();
  client.error("something broke");
  await waitForCount(1);
  assert.deepEqual(received, [{ type: "GAME_ERROR", message: "something broke" }]);
  close();
});

test("an oversized complete() payload is silently dropped, not sent partially", async () => {
  const { client, received, flush, close } = await connectedClient();
  client.complete({ metadata: { blob: "x".repeat(20_000) } });
  await flush();
  assert.deepEqual(received, []);
  close();
});

// ── disconnect() ──────────────────────────────────────────────────────────────

test("disconnect() stops any further message from being sent", async () => {
  const { client, received, flush, close } = await connectedClient();
  client.disconnect();
  client.ready();
  client.complete({ score: 1 });
  await flush();
  assert.deepEqual(received, []);
  close();
});

test("disconnect() is safe to call more than once", async () => {
  const { client, close } = await connectedClient();
  assert.doesNotThrow(() => {
    client.disconnect();
    client.disconnect();
  });
  close();
});

test("hybrid topology is selected in-game before local lifecycle messages are accepted", async () => {
  const { client, hostPort, received, waitForCount, flush, close } = await connectedClient({
    type: "HOST_INIT",
    playModes: ["local-multi", "online-multi"],
  });
  assert.deepEqual(client.playModes, ["local-multi", "online-multi"]);
  assert.equal(Object.isFrozen(client.playModes), true);

  client.started();
  client.complete({ outcome: "win" });
  await flush();
  assert.deepEqual(received, [], "hybrid lifecycle is inert until the host accepts a topology");

  const selected = client.selectPlayMode("local-multi");
  await waitForCount(1);
  assert.deepEqual(received, [{ type: "GAME_SELECT_PLAY_MODE", playMode: "local-multi" }]);
  hostPort.postMessage({ type: "HOST_PLAY_MODE_SELECTED", playMode: "local-multi" });
  assert.equal(await selected, "local-multi");
  client.started();
  client.complete({ outcome: "win" });
  await waitForCount(3);
  assert.deepEqual(received.slice(1), [
    { type: "GAME_STARTED" },
    { type: "GAME_COMPLETE", outcome: "win" },
  ]);
  close();
});

test("topology selection rejects invalid, duplicate, and mismatched host decisions", async () => {
  const first = await connectedClient({
    type: "HOST_INIT",
    playModes: ["local-multi", "online-multi"],
  });
  await assert.rejects(
    first.client.selectPlayMode("single"),
    (error: unknown) =>
      error instanceof GamePlayModeSelectionError && error.code === "INVALID_PLAY_MODE",
  );
  const pending = first.client.selectPlayMode("online-multi");
  await first.waitForCount(1);
  await assert.rejects(
    first.client.selectPlayMode("local-multi"),
    (error: unknown) =>
      error instanceof GamePlayModeSelectionError && error.code === "ALREADY_SELECTED",
  );
  first.hostPort.postMessage({ type: "HOST_PLAY_MODE_SELECTED", playMode: "local-multi" });
  await assert.rejects(
    pending,
    (error: unknown) =>
      error instanceof GamePlayModeSelectionError && error.code === "MODE_UNAVAILABLE",
  );
  first.close();
});

test("selecting online topology never opens the generic local result lifecycle", async () => {
  const { client, hostPort, received, waitForCount, flush, close } = await connectedClient({
    type: "HOST_INIT",
    playModes: ["local-multi", "online-multi"],
  });
  const pending = client.selectPlayMode("online-multi");
  await waitForCount(1);
  hostPort.postMessage({ type: "HOST_PLAY_MODE_SELECTED", playMode: "online-multi" });
  assert.equal(await pending, "online-multi");
  client.started();
  client.event("online_score", { value: 999 });
  client.complete({ score: 123 });
  await flush();
  assert.deepEqual(received, [{ type: "GAME_SELECT_PLAY_MODE", playMode: "online-multi" }]);
  close();
});

test("PlayConfig is a frozen public descriptor and requestStart resolves only from HOST_START", async () => {
  const { client, hostPort, received, waitForCount, close } = await connectedClient({
    type: "HOST_INIT",
    playConfig: PLAY_CONFIG,
  });
  assert.deepEqual(client.playConfig, PLAY_CONFIG);
  assert.equal(Object.isFrozen(client.playConfig), true);
  assert.equal(Object.isFrozen(client.playConfig?.allowedConfigs), true);
  assert.equal("verifierId" in (client.playConfig ?? {}), false);

  const start = client.requestStart({ difficultyId: "hard", variantId: "standard" });
  await waitForCount(1);
  assert.deepEqual(received, [
    {
      type: "GAME_REQUEST_START",
      playConfig: { difficultyId: "hard", variantId: "standard" },
    },
  ]);
  hostPort.postMessage({ type: "HOST_START", context: START_CONTEXT });
  assert.deepEqual(await start, START_CONTEXT);
  close();
});

test("requestStart rejects invalid and duplicate requests with stable error codes", async () => {
  const { client, hostPort, waitForCount, close } = await connectedClient({
    type: "HOST_INIT",
    playConfig: PLAY_CONFIG,
  });
  await assert.rejects(
    client.requestStart({ difficultyId: "impossible", variantId: "standard" }),
    (error: unknown) =>
      error instanceof GameStartRequestError && error.code === "INVALID_PLAY_CONFIG",
  );

  const start = client.requestStart({ difficultyId: "hard", variantId: "standard" });
  await waitForCount(1);
  await assert.rejects(
    client.requestStart({ difficultyId: "hard", variantId: "standard" }),
    (error: unknown) =>
      error instanceof GameStartRequestError && error.code === "ALREADY_REQUESTED",
  );
  hostPort.postMessage({ type: "HOST_START_ERROR", code: "SESSION_UNAVAILABLE" });
  await assert.rejects(
    start,
    (error: unknown) =>
      error instanceof GameStartRequestError && error.code === "SESSION_UNAVAILABLE",
  );
  close();
});

test("PlayConfig blocks pre-authorization lifecycle and accepts evidence-only completion afterward", async () => {
  const { client, hostPort, received, waitForCount, flush, close } = await connectedClient({
    type: "HOST_INIT",
    playConfig: PLAY_CONFIG,
  });
  const start = client.requestStart({ difficultyId: "hard", variantId: "standard" });
  client.started();
  client.complete({ evidence: { elapsedMs: 10 } });
  await waitForCount(1);
  assert.equal(received.length, 1, "only GAME_REQUEST_START may cross before authorization");

  hostPort.postMessage({ type: "HOST_START", context: START_CONTEXT });
  await start;
  client.complete({ score: 999_999, evidence: { elapsedMs: 10 } });
  client.started();
  client.complete({ evidence: { elapsedMs: 10, inputs: [1, 2, 3] } });
  await waitForCount(3);
  assert.deepEqual(received.slice(1), [
    { type: "GAME_STARTED" },
    { type: "GAME_COMPLETE", evidence: { elapsedMs: 10, inputs: [1, 2, 3] } },
  ]);

  client.complete({ evidence: { elapsedMs: 999 } });
  await flush();
  assert.equal(received.length, 3, "duplicate completion stays one-shot");
  close();
});

test("a mismatched HOST_START context never authorizes the requested configuration", async () => {
  const { client, hostPort, waitForCount, close } = await connectedClient({
    type: "HOST_INIT",
    playConfig: PLAY_CONFIG,
  });
  const start = client.requestStart({ difficultyId: "hard", variantId: "standard" });
  await waitForCount(1);
  hostPort.postMessage({
    type: "HOST_START",
    context: {
      ...START_CONTEXT,
      playConfig: { difficultyId: "normal", variantId: "standard" },
      rewardFactor: 1,
    },
  });
  await assert.rejects(
    start,
    (error: unknown) => error instanceof GameStartRequestError && error.code === "GAME_UNAVAILABLE",
  );
  close();
});
