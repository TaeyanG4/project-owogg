import test from "node:test";
import assert from "node:assert/strict";
import {
  createGameBridgeHost,
  type GameBridgeIframeWindowLike,
} from "../features/game/runtime/gameBridgeHost";

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
 * createGameBridgeHost() only ever touches an injectable `contentWindow`-shaped object plus real
 * `MessageChannel`/`MessagePort` (native Node globals) — no `window`, no real iframe, no jsdom
 * needed. The fake below captures the one `postMessage(..., "*", [port2])` bootstrap call and
 * hands the captured port back to the test as "the game side", so every test here drives the
 * controller through a real, connected MessageChannel exactly the way a real iframe would.
 */

interface CapturedBootstrap {
  message: unknown;
  targetOrigin: string;
  transfer: readonly Transferable[];
}

function createFakeIframeWindow(): {
  windowLike: GameBridgeIframeWindowLike;
  getBootstrap(): CapturedBootstrap;
} {
  let captured: CapturedBootstrap | null = null;
  return {
    windowLike: {
      postMessage(message, targetOrigin, transfer) {
        captured = { message, targetOrigin, transfer };
      },
    },
    getBootstrap() {
      assert.ok(captured, "postMessage was never called");
      return captured;
    },
  };
}

function gamePortFrom(bootstrap: CapturedBootstrap): MessagePort {
  const port = bootstrap.transfer[0];
  assert.ok(port instanceof MessagePort, "bootstrap must transfer exactly a MessagePort");
  return port;
}

function captureHostMessages(port: MessagePort): unknown[] {
  const messages: unknown[] = [];
  port.onmessage = (event) => messages.push(event.data);
  return messages;
}

/**
 * Waits for `actual()` to reach `expected`, polling instead of sleeping one fixed duration —
 * a MessagePort always delivers asynchronously, and a hardcoded `setTimeout(10)` assumes
 * delivery never takes longer than that. Costs nothing extra when delivery is prompt; only
 * spends more time on a runner that's genuinely slower, which is exactly when a fixed wait
 * would otherwise flake.
 */
async function waitUntil(actual: () => number, expected: number, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (actual() < expected && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5));
  }
}

test("sends exactly one HOST_INIT bootstrap, wildcard target, carrying one port", () => {
  const fake = createFakeIframeWindow();
  const host = createGameBridgeHost(fake.windowLike, {});

  const bootstrap = fake.getBootstrap();
  assert.deepEqual(bootstrap.message, { type: "HOST_INIT" });
  assert.equal(bootstrap.targetOrigin, "*");
  assert.equal(bootstrap.transfer.length, 1);

  host.close();
  gamePortFrom(bootstrap).close();
});

test("sends the given difficultyId in HOST_INIT when one is passed", () => {
  const fake = createFakeIframeWindow();
  const host = createGameBridgeHost(fake.windowLike, {}, { difficultyId: "hard" });

  const bootstrap = fake.getBootstrap();
  assert.deepEqual(bootstrap.message, { type: "HOST_INIT", difficultyId: "hard" });

  host.close();
  gamePortFrom(bootstrap).close();
});

test("PlayConfig bootstrap exposes public choices and takes precedence over legacy difficultyId", () => {
  const fake = createFakeIframeWindow();
  const host = createGameBridgeHost(
    fake.windowLike,
    {},
    { difficultyId: "hard", playConfig: PLAY_CONFIG },
  );
  const bootstrap = fake.getBootstrap();
  assert.deepEqual(bootstrap.message, { type: "HOST_INIT", playConfig: PLAY_CONFIG });
  assert.equal(JSON.stringify(bootstrap.message).includes("verifier"), false);
  host.close();
  gamePortFrom(bootstrap).close();
});

test("hybrid bootstrap exposes approved local/online topology choices without granting online authority", () => {
  const fake = createFakeIframeWindow();
  const host = createGameBridgeHost(
    fake.windowLike,
    {},
    { playModes: ["local-multi", "online-multi"] },
  );
  const bootstrap = fake.getBootstrap();
  assert.deepEqual(bootstrap.message, {
    type: "HOST_INIT",
    playModes: ["local-multi", "online-multi"],
  });
  host.close();
  gamePortFrom(bootstrap).close();
});

test("dispatches GAME_READY, GAME_STARTED, GAME_RESTART, and GAME_CANCEL to their callbacks", async () => {
  const fake = createFakeIframeWindow();
  const calls: string[] = [];
  const host = createGameBridgeHost(fake.windowLike, {
    onReady: () => calls.push("ready"),
    onStarted: () => calls.push("started"),
    onCancel: () => calls.push("cancel"),
    onRestart: () => calls.push("restart"),
  });

  const gamePort = gamePortFrom(fake.getBootstrap());
  gamePort.postMessage({ type: "GAME_READY" });
  gamePort.postMessage({ type: "GAME_STARTED" });
  gamePort.postMessage({ type: "GAME_RESTART" });
  gamePort.postMessage({ type: "GAME_CANCEL" });
  await waitUntil(() => calls.length, 3);

  assert.deepEqual(calls, ["ready", "started", "restart", "cancel"]);
  host.close();
  gamePort.close();
});

test("dispatches GAME_COMPLETE with score and metadata through unmodified", async () => {
  const fake = createFakeIframeWindow();
  let calls = 0;
  let received: unknown;
  const host = createGameBridgeHost(fake.windowLike, {
    onComplete: (result) => {
      calls += 1;
      received = result;
    },
  });

  const gamePort = gamePortFrom(fake.getBootstrap());
  gamePort.postMessage({ type: "GAME_COMPLETE", score: 777, metadata: { level: 5 } });
  await waitUntil(() => calls, 1);

  assert.deepEqual(received, { score: 777, metadata: { level: 5 } });
  host.close();
  gamePort.close();
});

test("a second GAME_COMPLETE is dropped at the host — the game side's own dedup is not trusted", async () => {
  const fake = createFakeIframeWindow();
  let callCount = 0;
  const host = createGameBridgeHost(fake.windowLike, {
    onComplete: () => {
      callCount += 1;
    },
  });

  const gamePort = gamePortFrom(fake.getBootstrap());
  // Simulates a compromised/buggy game bypassing the game-sdk client's own guard and posting
  // directly to the port — the host must still only accept the first one.
  gamePort.postMessage({ type: "GAME_COMPLETE", score: 1 });
  gamePort.postMessage({ type: "GAME_COMPLETE", score: 2 });
  await waitUntil(() => callCount, 1);
  await new Promise((r) => setTimeout(r, 50)); // give a wrongly-accepted second call room to show up

  assert.equal(callCount, 1);
  host.close();
  gamePort.close();
});

test("a malformed or unknown message is ignored, never throws, never reaches any callback", async () => {
  const fake = createFakeIframeWindow();
  let anyCallbackFired = false;
  const host = createGameBridgeHost(fake.windowLike, {
    onReady: () => {
      anyCallbackFired = true;
    },
    onComplete: () => {
      anyCallbackFired = true;
    },
    onError: () => {
      anyCallbackFired = true;
    },
  });

  const gamePort = gamePortFrom(fake.getBootstrap());
  assert.doesNotThrow(() => {
    gamePort.postMessage({ type: "HOST_INIT" }); // the game must not be able to send this back
    gamePort.postMessage({ type: "SOMETHING_UNKNOWN" });
    gamePort.postMessage("just a string");
    gamePort.postMessage({ type: "GAME_READY", sneaky: true }); // extra field
  });
  await new Promise((r) => setTimeout(r, 50));

  assert.equal(anyCallbackFired, false);
  host.close();
  gamePort.close();
});

test("close() stops delivering further messages", async () => {
  const fake = createFakeIframeWindow();
  let calls = 0;
  const host = createGameBridgeHost(fake.windowLike, {
    onReady: () => {
      calls += 1;
    },
  });

  const gamePort = gamePortFrom(fake.getBootstrap());
  host.close();
  gamePort.postMessage({ type: "GAME_READY" });
  await new Promise((r) => setTimeout(r, 50));

  assert.equal(calls, 0);
  gamePort.close();
});

test("close() is safe to call more than once", () => {
  const fake = createFakeIframeWindow();
  const host = createGameBridgeHost(fake.windowLike, {});
  assert.doesNotThrow(() => {
    host.close();
    host.close();
  });
  gamePortFrom(fake.getBootstrap()).close();
});

test("GAME_ERROR carries its optional message through", async () => {
  const fake = createFakeIframeWindow();
  let calls = 0;
  let received: unknown;
  const host = createGameBridgeHost(fake.windowLike, {
    onError: (message) => {
      calls += 1;
      received = message;
    },
  });

  const gamePort = gamePortFrom(fake.getBootstrap());
  gamePort.postMessage({ type: "GAME_ERROR", message: "engine crashed" });
  await waitUntil(() => calls, 1);

  assert.equal(received, "engine crashed");
  host.close();
  gamePort.close();
});

test("an oversized GAME_COMPLETE payload never reaches onComplete", async () => {
  const fake = createFakeIframeWindow();
  let fired = false;
  const host = createGameBridgeHost(fake.windowLike, {
    onComplete: () => {
      fired = true;
    },
  });

  const gamePort = gamePortFrom(fake.getBootstrap());
  gamePort.postMessage({ type: "GAME_COMPLETE", metadata: { blob: "x".repeat(20_000) } });
  await new Promise((r) => setTimeout(r, 50));

  assert.equal(fired, false);
  host.close();
  gamePort.close();
});

test("PlayConfig authorizes one exact start and then accepts evidence-only completion", async () => {
  const fake = createFakeIframeWindow();
  let started = 0;
  const completed: unknown[] = [];
  const requested: unknown[] = [];
  const host = createGameBridgeHost(
    fake.windowLike,
    {
      onRequestStart: (selection) => {
        requested.push(selection);
        return { ok: true, context: START_CONTEXT };
      },
      onStarted: () => {
        started += 1;
      },
      onComplete: (result) => completed.push(result),
    },
    { playConfig: PLAY_CONFIG },
  );
  const gamePort = gamePortFrom(fake.getBootstrap());
  const responses = captureHostMessages(gamePort);

  gamePort.postMessage({ type: "GAME_STARTED" });
  gamePort.postMessage({ type: "GAME_COMPLETE", evidence: { elapsedMs: 1 } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(started, 0);
  assert.deepEqual(completed, []);

  gamePort.postMessage({
    type: "GAME_REQUEST_START",
    playConfig: { difficultyId: "hard", variantId: "standard" },
  });
  await waitUntil(() => responses.length, 1);
  assert.deepEqual(requested, [{ difficultyId: "hard", variantId: "standard" }]);
  assert.deepEqual(responses, [{ type: "HOST_START", context: START_CONTEXT }]);

  gamePort.postMessage({ type: "GAME_COMPLETE", score: 999_999, evidence: { elapsedMs: 2 } });
  gamePort.postMessage({ type: "GAME_STARTED" });
  gamePort.postMessage({ type: "GAME_COMPLETE", evidence: { elapsedMs: 2, inputs: [1, 2] } });
  await waitUntil(() => completed.length, 1);
  assert.equal(started, 1);
  assert.deepEqual(completed, [{ evidence: { elapsedMs: 2, inputs: [1, 2] } }]);

  gamePort.postMessage({
    type: "GAME_REQUEST_START",
    playConfig: { difficultyId: "hard", variantId: "standard" },
  });
  await waitUntil(() => responses.length, 2);
  assert.deepEqual(responses.at(-1), {
    type: "HOST_START_ERROR",
    code: "ALREADY_REQUESTED",
  });
  host.close();
  gamePort.close();
});

test("PlayConfig rejects an unapproved pair without invoking session authorization", async () => {
  const fake = createFakeIframeWindow();
  let requests = 0;
  const host = createGameBridgeHost(
    fake.windowLike,
    {
      onRequestStart: () => {
        requests += 1;
        return { ok: true, context: START_CONTEXT };
      },
    },
    { playConfig: PLAY_CONFIG },
  );
  const gamePort = gamePortFrom(fake.getBootstrap());
  const responses = captureHostMessages(gamePort);
  gamePort.postMessage({
    type: "GAME_REQUEST_START",
    playConfig: { difficultyId: "impossible", variantId: "standard" },
  });
  await waitUntil(() => responses.length, 1);
  assert.equal(requests, 0);
  assert.deepEqual(responses, [{ type: "HOST_START_ERROR", code: "INVALID_PLAY_CONFIG" }]);
  host.close();
  gamePort.close();
});

test("PlayConfig rejects a mismatched authorization decision instead of trusting callback output", async () => {
  const fake = createFakeIframeWindow();
  const host = createGameBridgeHost(
    fake.windowLike,
    {
      onRequestStart: () => ({
        ok: true,
        context: { ...START_CONTEXT, rewardFactor: 99 },
      }),
    },
    { playConfig: PLAY_CONFIG },
  );
  const gamePort = gamePortFrom(fake.getBootstrap());
  const responses = captureHostMessages(gamePort);
  gamePort.postMessage({
    type: "GAME_REQUEST_START",
    playConfig: { difficultyId: "hard", variantId: "standard" },
  });
  await waitUntil(() => responses.length, 1);
  assert.deepEqual(responses, [{ type: "HOST_START_ERROR", code: "GAME_UNAVAILABLE" }]);
  host.close();
  gamePort.close();
});

test("closing the host discards a stale asynchronous start decision", async () => {
  const fake = createFakeIframeWindow();
  let resolveDecision: ((value: { ok: true; context: typeof START_CONTEXT }) => void) | undefined;
  let requests = 0;
  const host = createGameBridgeHost(
    fake.windowLike,
    {
      onRequestStart: () => {
        requests += 1;
        return new Promise((resolve) => {
          resolveDecision = resolve;
        });
      },
    },
    { playConfig: PLAY_CONFIG },
  );
  const gamePort = gamePortFrom(fake.getBootstrap());
  const responses = captureHostMessages(gamePort);
  gamePort.postMessage({
    type: "GAME_REQUEST_START",
    playConfig: { difficultyId: "hard", variantId: "standard" },
  });
  await waitUntil(() => requests, 1);
  host.close();
  assert.ok(resolveDecision);
  resolveDecision({ ok: true, context: START_CONTEXT });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(responses, []);
  gamePort.close();
});

test("hybrid topology must be host-selected before local lifecycle is accepted", async () => {
  const fake = createFakeIframeWindow();
  let started = 0;
  const completed: unknown[] = [];
  const host = createGameBridgeHost(
    fake.windowLike,
    {
      onSelectPlayMode: (playMode) => ({ ok: true, playMode }),
      onStarted: () => {
        started += 1;
      },
      onComplete: (result) => completed.push(result),
    },
    { playModes: ["local-multi", "online-multi"] },
  );
  const gamePort = gamePortFrom(fake.getBootstrap());
  const responses = captureHostMessages(gamePort);
  gamePort.postMessage({ type: "GAME_STARTED" });
  gamePort.postMessage({ type: "GAME_COMPLETE", outcome: "win" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(started, 0);
  assert.deepEqual(completed, []);

  gamePort.postMessage({ type: "GAME_SELECT_PLAY_MODE", playMode: "local-multi" });
  await waitUntil(() => responses.length, 1);
  assert.deepEqual(responses, [{ type: "HOST_PLAY_MODE_SELECTED", playMode: "local-multi" }]);
  gamePort.postMessage({ type: "GAME_STARTED" });
  gamePort.postMessage({ type: "GAME_COMPLETE", outcome: "win" });
  await waitUntil(() => completed.length, 1);
  assert.equal(started, 1);
  assert.deepEqual(completed, [{ outcome: "win" }]);
  host.close();
  gamePort.close();
});

test("runtime activation fires only after a successful play-mode acknowledgement", async () => {
  const fake = createFakeIframeWindow();
  const activated: string[] = [];
  const host = createGameBridgeHost(
    fake.windowLike,
    {
      onSelectPlayMode: (playMode) => ({ ok: true, playMode }),
      onPlayModeSelected: (playMode) => activated.push(playMode),
    },
    { playModes: ["local-multi", "online-multi"] },
  );
  const gamePort = gamePortFrom(fake.getBootstrap());
  const responses = captureHostMessages(gamePort);
  gamePort.postMessage({ type: "GAME_SELECT_PLAY_MODE", playMode: "online-multi" });
  await waitUntil(() => responses.length, 1);
  assert.deepEqual(responses, [{ type: "HOST_PLAY_MODE_SELECTED", playMode: "online-multi" }]);
  assert.deepEqual(activated, ["online-multi"]);
  host.close();
  gamePort.close();
});

test("rejected or stale play-mode decisions never activate a runtime", async () => {
  const rejectedFake = createFakeIframeWindow();
  const rejectedActivations: string[] = [];
  const rejectedHost = createGameBridgeHost(
    rejectedFake.windowLike,
    {
      onSelectPlayMode: () => ({ ok: false, code: "MODE_UNAVAILABLE" }),
      onPlayModeSelected: (playMode) => rejectedActivations.push(playMode),
    },
    { playModes: ["local-multi", "online-multi"] },
  );
  const rejectedPort = gamePortFrom(rejectedFake.getBootstrap());
  const rejectedResponses = captureHostMessages(rejectedPort);
  rejectedPort.postMessage({ type: "GAME_SELECT_PLAY_MODE", playMode: "online-multi" });
  await waitUntil(() => rejectedResponses.length, 1);
  assert.deepEqual(rejectedActivations, []);
  rejectedHost.close();
  rejectedPort.close();

  const staleFake = createFakeIframeWindow();
  const staleActivations: string[] = [];
  let resolveDecision: ((decision: { ok: true; playMode: "online-multi" }) => void) | undefined;
  const staleHost = createGameBridgeHost(
    staleFake.windowLike,
    {
      onSelectPlayMode: () =>
        new Promise((resolve) => {
          resolveDecision = resolve;
        }),
      onPlayModeSelected: (playMode) => staleActivations.push(playMode),
    },
    { playModes: ["local-multi", "online-multi"] },
  );
  const stalePort = gamePortFrom(staleFake.getBootstrap());
  stalePort.postMessage({ type: "GAME_SELECT_PLAY_MODE", playMode: "online-multi" });
  await waitUntil(() => (resolveDecision ? 1 : 0), 1);
  staleHost.close();
  resolveDecision?.({ ok: true, playMode: "online-multi" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(staleActivations, []);
  stalePort.close();
});

test("hybrid online selection never falls through to generic local completion", async () => {
  const fake = createFakeIframeWindow();
  let completed = 0;
  let events = 0;
  const host = createGameBridgeHost(
    fake.windowLike,
    {
      onSelectPlayMode: (playMode) => ({ ok: true, playMode }),
      onComplete: () => {
        completed += 1;
      },
      onEvent: () => {
        events += 1;
      },
    },
    { playModes: ["local-multi", "online-multi"] },
  );
  const gamePort = gamePortFrom(fake.getBootstrap());
  const responses = captureHostMessages(gamePort);
  gamePort.postMessage({ type: "GAME_SELECT_PLAY_MODE", playMode: "online-multi" });
  await waitUntil(() => responses.length, 1);
  gamePort.postMessage({ type: "GAME_EVENT", name: "online_score", data: { value: 999 } });
  gamePort.postMessage({ type: "GAME_COMPLETE", score: 123 });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(completed, 0);
  assert.equal(events, 0);

  gamePort.postMessage({ type: "GAME_SELECT_PLAY_MODE", playMode: "local-multi" });
  await waitUntil(() => responses.length, 2);
  assert.deepEqual(responses.at(-1), {
    type: "HOST_PLAY_MODE_ERROR",
    code: "ALREADY_SELECTED",
  });
  host.close();
  gamePort.close();
});
