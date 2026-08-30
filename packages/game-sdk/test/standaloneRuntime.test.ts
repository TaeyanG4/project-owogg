import test from "node:test";
import assert from "node:assert/strict";
import { createStandaloneBridgeRuntime, type GameBridgeClient } from "../src/bridge/index.js";

/**
 * The shared adapter behind every migrated SYSTEM game's standalone/bridgeRuntime.ts except
 * reaction-time's own hand-written copy (predates this file — see its own doc comment). Mirrors
 * games/reaction-time/tests/bridgeRuntime.test.ts's fake-client unit tests, since the two adapters
 * must behave identically for the fields they share.
 */

function createFakeClient(difficultyId?: string): {
  client: GameBridgeClient;
  calls: string[];
  completed: unknown[];
} {
  const calls: string[] = [];
  const completed: unknown[] = [];
  const client: GameBridgeClient = {
    ...(difficultyId !== undefined ? { difficultyId } : {}),
    playModes: [],
    selectPlayMode: async (playMode) => playMode,
    playConfig: null,
    requestStart: async () => {
      throw new Error("not configured");
    },
    ready: () => calls.push("ready"),
    started: () => calls.push("started"),
    event: () => calls.push("event"),
    complete: (result) => {
      calls.push("complete");
      completed.push(result);
    },
    restart: () => calls.push("restart"),
    cancel: () => calls.push("cancel"),
    error: () => calls.push("error"),
    disconnect: () => calls.push("disconnect"),
  };
  return { client, calls, completed };
}

test("no auth/token/API address anywhere on the runtime — user is null, sessionId is a throwaway id", () => {
  const { client } = createFakeClient();
  const runtime = createStandaloneBridgeRuntime(client);
  assert.equal(runtime.user, null);
  assert.equal(typeof runtime.sessionId, "string");
  assert.ok(runtime.sessionId.length > 0);
});

test("difficultyId falls back to the given default when the host's HOST_INIT carried none", () => {
  const { client } = createFakeClient(undefined);
  const runtime = createStandaloneBridgeRuntime(client, "normal");
  assert.equal(runtime.difficultyId, "normal");
});

test('difficultyId falls back to a plain "normal" default when the caller passes none either', () => {
  const { client } = createFakeClient(undefined);
  const runtime = createStandaloneBridgeRuntime(client);
  assert.equal(runtime.difficultyId, "normal");
});

test("difficultyId uses the host's HOST_INIT value when present, ignoring the fallback entirely", () => {
  const { client } = createFakeClient("hard");
  const runtime = createStandaloneBridgeRuntime(client, "normal");
  assert.equal(runtime.difficultyId, "hard");
});

test("runtime.emit(game_started) maps to client.started(), nothing else does", () => {
  const { client, calls } = createFakeClient();
  const runtime = createStandaloneBridgeRuntime(client);

  runtime.emit({ type: "checkpoint", name: "x", at: Date.now() });
  runtime.emit({ type: "game_completed", at: Date.now() });
  runtime.emit({ type: "game_abandoned", at: Date.now() });
  assert.deepEqual(calls, []);

  runtime.emit({ type: "game_started", at: Date.now() });
  assert.deepEqual(calls, ["started"]);
});

test("runtime.complete forwards Game Creator result facts and legacy metadata, dropping host-only fields", async () => {
  const { client, completed } = createFakeClient();
  const runtime = createStandaloneBridgeRuntime(client);

  await runtime.complete({
    gameId: "aim-test",
    sessionId: runtime.sessionId,
    outcome: "success",
    score: 4200,
    progression: { value: 3 },
    metrics: { targets: 30 },
    durationMs: 4200,
    metadata: { targets: 30, difficultyId: "hard" },
    clientStartedAt: 1000,
    clientEndedAt: 5200,
  });

  assert.deepEqual(completed, [
    {
      outcome: "success",
      score: 4200,
      progression: { value: 3 },
      metrics: { targets: 30 },
      metadata: { targets: 30, difficultyId: "hard" },
    },
  ]);
});

test("runtime.complete omits metadata entirely when the game result carried none", async () => {
  const { client, completed } = createFakeClient();
  const runtime = createStandaloneBridgeRuntime(client);

  await runtime.complete({
    gameId: "typing-test",
    sessionId: runtime.sessionId,
    score: 60,
    durationMs: 60000,
    clientStartedAt: 0,
    clientEndedAt: 60000,
  });

  assert.equal(completed.length, 1);
  assert.deepEqual(completed[0], { score: 60 });
  assert.equal("metadata" in (completed[0] as object), false);
});

test("runtime.cancel maps to client.cancel()", () => {
  const { client, calls } = createFakeClient();
  const runtime = createStandaloneBridgeRuntime(client);
  runtime.cancel();
  assert.deepEqual(calls, ["cancel"]);
});
