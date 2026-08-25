import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { OWOGG_BROWSER_API_SOURCE } from "../src/bridge/browserApiSource.js";
import type { OwoggBrowserApi } from "../src/contracts/gameCreatorManifest.js";

const ACTION_ID = "123e4567-e89b-42d3-a456-426614174000";

const MULTIPLAYER_BOOTSTRAP = {
  type: "MULTI_INIT",
  v: 1,
  participantId: "participant_01",
  gameVersionId: 17,
  profileRevision: 3,
  rulesetKey: "turn-grid",
  rulesetRevision: 2,
  generation: 4,
} as const;

interface TestPort {
  postMessage(message: unknown): void;
  start?(): void;
  onmessage?: ((event: { data: unknown }) => void) | null;
}

function plain(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function loadBrowserApi() {
  let listener: ((event: Record<string, unknown>) => void) | null = null;
  const parent = {};
  const windowLike: Record<string, unknown> & { OWOGG?: OwoggBrowserApi } = {
    parent,
    crypto: {
      randomUUID: () => ACTION_ID,
    },
    addEventListener(type: string, next: (event: Record<string, unknown>) => void) {
      if (type === "message") listener = next;
    },
    removeEventListener(type: string, next: (event: Record<string, unknown>) => void) {
      if (type === "message" && listener === next) listener = null;
    },
  };
  vm.runInNewContext(OWOGG_BROWSER_API_SOURCE, { window: windowLike });
  const api = windowLike.OWOGG;
  assert.ok(api);

  function dispatch(data: unknown, port: TestPort, source: unknown = parent): void {
    assert.ok(listener, "a bridge bootstrap listener should still be installed");
    listener({ source, data, ports: [port] });
  }

  return {
    api,
    connectLegacy(port: TestPort) {
      dispatch({ type: "HOST_INIT" }, port);
    },
    connectMultiplayer(port: TestPort, data: unknown = MULTIPLAYER_BOOTSTRAP) {
      dispatch(data, port);
    },
    dispatch,
  };
}

test("injected Simple API supports complete-before-start and queues until the legacy bridge connects", () => {
  const { api, connectLegacy } = loadBrowserApi();
  const messages: unknown[] = [];

  api.complete({ outcome: "success", score: 42, progression: { value: 3 } });
  api.start();
  connectLegacy({ postMessage: (message) => messages.push(message) });

  assert.equal(Object.isFrozen(api), true);
  assert.deepEqual(plain(messages), [
    { type: "GAME_READY" },
    { type: "GAME_COMPLETE", outcome: "success", score: 42, progression: { value: 3 } },
  ]);
});

test("legacy calls remain compatible and the public surface exposes no host session state", () => {
  const { api, connectLegacy } = loadBrowserApi();
  const messages: unknown[] = [];
  connectLegacy({ postMessage: (message) => messages.push(message) });

  api.start();
  api.event("boss_defeated", { phase: 2 });
  api.event("invalid event");
  api.cancel();

  assert.deepEqual(plain(messages), [
    { type: "GAME_READY" },
    { type: "GAME_STARTED" },
    { type: "GAME_EVENT", name: "boss_defeated", data: { phase: 2 } },
    { type: "GAME_CANCEL" },
  ]);
  assert.deepEqual(Object.keys(api).sort(), [
    "cancel",
    "complete",
    "event",
    "multiplayer",
    "start",
  ]);
  assert.deepEqual(Object.keys(api.multiplayer).sort(), [
    "action",
    "bootstrap",
    "input",
    "leave",
    "ready",
    "subscribe",
  ]);
  assert.equal(Object.isFrozen(api.multiplayer), true);
  assert.equal(api.multiplayer.bootstrap, null);
});

test("managed API queues bounded intents, assigns monotonic sequences, and never mixes legacy messages", () => {
  const { api, connectMultiplayer } = loadBrowserApi();
  const messages: unknown[] = [];
  let starts = 0;
  const port: TestPort = {
    postMessage: (message) => messages.push(message),
    start: () => {
      starts += 1;
    },
  };

  api.start();
  assert.equal(api.multiplayer.ready(), true);
  assert.equal(api.multiplayer.ready(), false);
  assert.equal(
    api.multiplayer.action({ expectedRevision: 0, payload: { row: 7, column: 7 } }),
    ACTION_ID,
  );
  assert.equal(api.multiplayer.input({ direction: "left" }), true);
  connectMultiplayer(port);

  assert.equal(starts, 1);
  assert.deepEqual(plain(api.multiplayer.bootstrap), MULTIPLAYER_BOOTSTRAP);
  assert.deepEqual(Object.keys(api.multiplayer.bootstrap ?? {}).sort(), [
    "gameVersionId",
    "generation",
    "participantId",
    "profileRevision",
    "rulesetKey",
    "rulesetRevision",
    "type",
    "v",
  ]);
  assert.deepEqual(plain(messages), [
    { type: "MULTI_READY", v: 1, generation: 4 },
    {
      type: "MULTI_ACTION",
      v: 1,
      generation: 4,
      clientSeq: 1,
      clientActionId: ACTION_ID,
      expectedRevision: 0,
      payload: { row: 7, column: 7 },
    },
    {
      type: "MULTI_INPUT",
      v: 1,
      generation: 4,
      clientSeq: 2,
      payload: { direction: "left" },
    },
  ]);
  assert.equal(JSON.stringify(messages).includes("GAME_STARTED"), false);
  assert.equal(JSON.stringify(api.multiplayer.bootstrap).includes("ticket"), false);
});

test("invalid or oversized intents neither cross the port nor consume a client sequence", () => {
  const { api, connectMultiplayer } = loadBrowserApi();
  const messages: unknown[] = [];
  connectMultiplayer({ postMessage: (message) => messages.push(message) });

  assert.equal(api.multiplayer.action({ expectedRevision: -1, payload: {} }), null);
  assert.equal(
    api.multiplayer.action({ expectedRevision: 0, payload: { text: "한".repeat(2_000) } }),
    null,
  );
  assert.equal(api.multiplayer.input({ impossible: Number.POSITIVE_INFINITY }), false);
  const throwingRequest = new Proxy(
    { expectedRevision: 0, payload: {} },
    {
      get() {
        throw new Error("untrusted getter");
      },
    },
  );
  assert.doesNotThrow(() => {
    assert.equal(api.multiplayer.action(throwingRequest), null);
  });
  assert.equal(
    api.multiplayer.action({
      expectedRevision: 0,
      payload: { row: 1 },
      clientActionId: "too-short",
    }),
    null,
  );
  assert.equal(api.multiplayer.input({ direction: "right" }), true);

  assert.deepEqual(plain(messages), [
    {
      type: "MULTI_INPUT",
      v: 1,
      generation: 4,
      clientSeq: 1,
      payload: { direction: "right" },
    },
  ]);
});

test("host messages require exact shapes, matching generation, and increasing server sequence", () => {
  const { api, connectMultiplayer } = loadBrowserApi();
  const port: TestPort = { postMessage: () => undefined };
  const received: unknown[] = [];
  const unsubscribe = api.multiplayer.subscribe((message) => received.push(message));
  connectMultiplayer(port);
  assert.ok(port.onmessage);

  port.onmessage({
    data: {
      type: "MULTI_STATE",
      v: 1,
      generation: 4,
      serverSeq: 1,
      revision: 2,
      payload: { board: [0, 1] },
    },
  });
  port.onmessage({
    data: {
      type: "MULTI_STATE",
      v: 1,
      generation: 4,
      serverSeq: 1,
      revision: 3,
      payload: { duplicate: true },
    },
  });
  port.onmessage({
    data: {
      type: "MULTI_EVENT",
      v: 1,
      generation: 999,
      serverSeq: 2,
      name: "TURN_CHANGED",
    },
  });
  port.onmessage({
    data: {
      type: "MULTI_EVENT",
      v: 1,
      generation: 4,
      serverSeq: 2,
      name: "TURN_CHANGED",
      credential: "must-not-pass",
    },
  });
  port.onmessage({
    data: {
      type: "MULTI_EVENT",
      v: 1,
      generation: 4,
      serverSeq: 2,
      name: "TURN_CHANGED",
      payload: { participantId: "participant_02" },
    },
  });
  port.onmessage({ data: MULTIPLAYER_BOOTSTRAP });

  assert.deepEqual(plain(received), [
    {
      type: "MULTI_STATE",
      v: 1,
      generation: 4,
      serverSeq: 1,
      revision: 2,
      payload: { board: [0, 1] },
    },
    {
      type: "MULTI_EVENT",
      v: 1,
      generation: 4,
      serverSeq: 2,
      name: "TURN_CHANGED",
      payload: { participantId: "participant_02" },
    },
  ]);

  unsubscribe();
  port.onmessage({
    data: {
      type: "MULTI_TERMINAL_PENDING",
      v: 1,
      generation: 4,
      serverSeq: 3,
    },
  });
  assert.equal(received.length, 2);
});

test("a malformed bootstrap cannot steal the one-time parent handshake", () => {
  const { api, dispatch, connectMultiplayer } = loadBrowserApi();
  const attackerMessages: unknown[] = [];
  const realMessages: unknown[] = [];

  dispatch(
    { ...MULTIPLAYER_BOOTSTRAP, ticket: "secret" },
    { postMessage: (message) => attackerMessages.push(message) },
  );
  assert.equal(api.multiplayer.bootstrap, null);

  assert.equal(api.multiplayer.ready(), true);
  connectMultiplayer({ postMessage: (message) => realMessages.push(message) });
  assert.deepEqual(attackerMessages, []);
  assert.deepEqual(plain(realMessages), [{ type: "MULTI_READY", v: 1, generation: 4 }]);
});

test("the pre-bootstrap multiplayer queue is capped and leave closes further game intents", () => {
  const { api, connectMultiplayer } = loadBrowserApi();
  const messages: unknown[] = [];

  for (let index = 0; index < 32; index += 1) {
    assert.equal(api.multiplayer.input({ index }), true);
  }
  assert.equal(api.multiplayer.input({ index: 32 }), false);
  connectMultiplayer({ postMessage: (message) => messages.push(message) });
  assert.equal(messages.length, 32);
  assert.deepEqual(plain(messages.at(-1)), {
    type: "MULTI_INPUT",
    v: 1,
    generation: 4,
    clientSeq: 32,
    payload: { index: 31 },
  });

  api.multiplayer.leave();
  assert.deepEqual(plain(messages.at(-1)), { type: "MULTI_LEAVE", v: 1, generation: 4 });
  assert.equal(api.multiplayer.input({ afterLeave: true }), false);
  assert.equal(api.multiplayer.action({ expectedRevision: 0, payload: {} }), null);
});
