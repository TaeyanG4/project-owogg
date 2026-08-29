import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { OWOGG_BROWSER_API_SOURCE } from "../src/bridge/browserApiSource.js";
import type { OwoggBrowserApi } from "../src/contracts/gameCreatorManifest.js";

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

const MULTIPLAYER_BOOTSTRAP = {
  type: "MULTI_INIT",
  v: 1,
  gameVersionId: 17,
  contentHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  profileRevision: 3,
  generation: 4,
  runtime: { kind: "relay", protocolVersion: 1, resultTrust: "UNVERIFIED" },
  self: { participantId: "participant_01", seatIndex: 0, role: "HOST" },
  roster: [
    { participantId: "participant_01", seatIndex: 0, role: "HOST" },
    { participantId: "participant_02", seatIndex: 1, role: "PLAYER" },
  ],
  capabilities: {
    reconnect: "resume",
    broadcast: true,
    directMessages: true,
    hostSnapshot: true,
  },
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
    connectGeneric(
      port: TestPort,
      playConfig?: typeof PLAY_CONFIG,
      playModes?: readonly ("single" | "local-multi" | "online-multi")[],
    ) {
      dispatch(
        {
          type: "HOST_INIT",
          ...(playConfig ? { playConfig } : {}),
          ...(playModes ? { playModes } : {}),
        },
        port,
      );
    },
    connectMultiplayer(port: TestPort, data: unknown = MULTIPLAYER_BOOTSTRAP) {
      dispatch(data, port);
    },
    dispatch,
  };
}

test("injected Simple API supports complete-before-start and queues until the generic bridge connects", () => {
  const { api, connectGeneric } = loadBrowserApi();
  const messages: unknown[] = [];

  api.complete({ outcome: "success", score: 42, progression: { value: 3 } });
  api.start();
  connectGeneric({ postMessage: (message) => messages.push(message) });

  assert.equal(Object.isFrozen(api), true);
  assert.deepEqual(plain(messages), [
    { type: "GAME_READY" },
    { type: "GAME_COMPLETE", outcome: "success", score: 42, progression: { value: 3 } },
  ]);
});

test("generic calls expose no host session state", () => {
  const { api, connectGeneric } = loadBrowserApi();
  const messages: unknown[] = [];
  connectGeneric({ postMessage: (message) => messages.push(message) });

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
    "playConfig",
    "playModes",
    "requestStart",
    "selectPlayMode",
    "start",
  ]);
  assert.deepEqual(Object.keys(api.multiplayer).sort(), [
    "bootstrap",
    "broadcast",
    "direct",
    "leave",
    "ready",
    "send",
    "snapshot",
    "subscribe",
  ]);
  assert.equal(Object.isFrozen(api.multiplayer), true);
  assert.equal(api.multiplayer.bootstrap, null);
  assert.equal(api.playConfig, null);
  assert.deepEqual(plain(api.playModes), []);
});

test("hybrid topology selection is host-approved before local lifecycle can begin", async () => {
  const { api, connectGeneric } = loadBrowserApi();
  const messages: unknown[] = [];
  const port: TestPort = { postMessage: (message) => messages.push(message) };
  connectGeneric(port, undefined, ["local-multi", "online-multi"]);
  assert.deepEqual(plain(api.playModes), ["local-multi", "online-multi"]);
  assert.equal(Object.isFrozen(api.playModes), true);

  api.start();
  api.complete({ outcome: "win" });
  assert.deepEqual(plain(messages), [{ type: "GAME_READY" }]);

  const selected = api.selectPlayMode("local-multi");
  assert.deepEqual(plain(messages.at(-1)), {
    type: "GAME_SELECT_PLAY_MODE",
    playMode: "local-multi",
  });
  assert.ok(port.onmessage);
  port.onmessage({ data: { type: "HOST_PLAY_MODE_SELECTED", playMode: "local-multi" } });
  assert.equal(await selected, "local-multi");
  api.start();
  api.complete({ outcome: "win" });
  assert.deepEqual(plain(messages.slice(-2)), [
    { type: "GAME_STARTED" },
    { type: "GAME_COMPLETE", outcome: "win" },
  ]);
});

test("online topology selection remains separate from generic result and PlayConfig flows", async () => {
  const { api, connectGeneric } = loadBrowserApi();
  const messages: unknown[] = [];
  const port: TestPort = { postMessage: (message) => messages.push(message) };
  connectGeneric(port, undefined, ["local-multi", "online-multi"]);
  await assert.rejects(
    api.selectPlayMode("single"),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "INVALID_PLAY_MODE",
  );
  const selected = api.selectPlayMode("online-multi");
  assert.ok(port.onmessage);
  port.onmessage({ data: { type: "HOST_PLAY_MODE_SELECTED", playMode: "online-multi" } });
  assert.equal(await selected, "online-multi");
  api.start();
  api.event("online_score", { value: 999 });
  api.complete({ score: 123 });
  assert.deepEqual(plain(messages), [
    { type: "GAME_READY" },
    { type: "GAME_SELECT_PLAY_MODE", playMode: "online-multi" },
  ]);
});

test("PlayConfig requestStart is bidirectional, one-shot, and exposes only frozen public choices", async () => {
  const { api, connectGeneric } = loadBrowserApi();
  const messages: unknown[] = [];
  const port: TestPort = { postMessage: (message) => messages.push(message) };
  connectGeneric(port, PLAY_CONFIG);

  assert.deepEqual(plain(api.playConfig), PLAY_CONFIG);
  assert.equal(Object.isFrozen(api.playConfig), true);
  assert.equal(Object.isFrozen(api.playConfig?.allowedConfigs), true);
  assert.equal("verifierId" in (api.playConfig ?? {}), false);

  const start = api.requestStart({ difficultyId: "hard", variantId: "standard" });
  assert.deepEqual(plain(messages), [
    { type: "GAME_READY" },
    {
      type: "GAME_REQUEST_START",
      playConfig: { difficultyId: "hard", variantId: "standard" },
    },
  ]);
  await assert.rejects(
    api.requestStart({ difficultyId: "hard", variantId: "standard" }),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ALREADY_REQUESTED",
  );
  assert.ok(port.onmessage);
  port.onmessage({ data: { type: "HOST_START", context: START_CONTEXT } });
  assert.deepEqual(plain(await start), START_CONTEXT);
});

test("PlayConfig blocks pre-authorization lifecycle and client-authored competitive facts", async () => {
  const { api, connectGeneric } = loadBrowserApi();
  const messages: unknown[] = [];
  const port: TestPort = { postMessage: (message) => messages.push(message) };
  connectGeneric(port, PLAY_CONFIG);

  const start = api.requestStart({ difficultyId: "hard", variantId: "standard" });
  api.start();
  api.complete({ evidence: { elapsedMs: 10 } });
  assert.equal(
    messages.length,
    2,
    "READY and REQUEST_START are the only pre-authorization messages",
  );

  assert.ok(port.onmessage);
  port.onmessage({ data: { type: "HOST_START", context: START_CONTEXT } });
  await start;
  api.complete({ score: 999_999, evidence: { elapsedMs: 10 } });
  api.start();
  api.complete({ evidence: { elapsedMs: 10, inputs: [1, 2, 3] } });
  assert.deepEqual(plain(messages.slice(2)), [
    { type: "GAME_STARTED" },
    { type: "GAME_COMPLETE", evidence: { elapsedMs: 10, inputs: [1, 2, 3] } },
  ]);
});

test("PlayConfig forwards host failures and rejects an oversized evidence payload without consuming completion", async () => {
  const { api, connectGeneric } = loadBrowserApi();
  const messages: unknown[] = [];
  const port: TestPort = { postMessage: (message) => messages.push(message) };
  connectGeneric(port, PLAY_CONFIG);
  const start = api.requestStart({ difficultyId: "hard", variantId: "standard" });
  assert.ok(port.onmessage);
  port.onmessage({ data: { type: "HOST_START_ERROR", code: "SESSION_UNAVAILABLE" } });
  await assert.rejects(
    start,
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "SESSION_UNAVAILABLE",
  );

  const second = loadBrowserApi();
  const secondMessages: unknown[] = [];
  const secondPort: TestPort = { postMessage: (message) => secondMessages.push(message) };
  second.connectGeneric(secondPort, PLAY_CONFIG);
  const allowedStart = second.api.requestStart({ difficultyId: "hard", variantId: "standard" });
  assert.ok(secondPort.onmessage);
  secondPort.onmessage({ data: { type: "HOST_START", context: START_CONTEXT } });
  await allowedStart;
  second.api.complete({ evidence: { blob: "x".repeat(20_000) } });
  second.api.complete({ evidence: { elapsedMs: 10 } });
  assert.deepEqual(plain(secondMessages.at(-1)), {
    type: "GAME_COMPLETE",
    evidence: { elapsedMs: 10 },
  });
});

test("a queued requestStart is rejected if bootstrap does not authorize PlayConfig mode", async () => {
  const { api, connectGeneric } = loadBrowserApi();
  const start = api.requestStart({ difficultyId: "hard", variantId: "standard" });
  const messages: unknown[] = [];
  connectGeneric({ postMessage: (message) => messages.push(message) });
  await assert.rejects(
    start,
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "INVALID_PLAY_CONFIG",
  );
  assert.deepEqual(plain(messages), [{ type: "GAME_READY" }]);
});

test("Relay API queues strict intents and assigns monotonic sequences", () => {
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
  assert.equal(api.multiplayer.broadcast({ frame: 1 }), true);
  assert.equal(api.multiplayer.direct("participant_02", { direction: "left" }), true);
  connectMultiplayer(port);

  assert.equal(starts, 1);
  assert.deepEqual(plain(api.multiplayer.bootstrap), MULTIPLAYER_BOOTSTRAP);
  assert.deepEqual(Object.keys(api.multiplayer.bootstrap ?? {}).sort(), [
    "capabilities",
    "contentHash",
    "gameVersionId",
    "generation",
    "profileRevision",
    "roster",
    "runtime",
    "self",
    "type",
    "v",
  ]);
  assert.deepEqual(plain(messages), [
    { type: "MULTI_READY", v: 1, generation: 4 },
    {
      type: "RELAY_SEND",
      v: 1,
      generation: 4,
      clientSeq: 1,
      delivery: "broadcast",
      payload: { frame: 1 },
    },
    {
      type: "RELAY_SEND",
      v: 1,
      generation: 4,
      clientSeq: 2,
      delivery: "direct",
      targetParticipantId: "participant_02",
      payload: { direction: "left" },
    },
  ]);
  assert.equal(JSON.stringify(messages).includes("GAME_STARTED"), false);
  assert.equal(JSON.stringify(api.multiplayer.bootstrap).includes("ticket"), false);
});

test("Relay API exposes generic send helpers and rejects malformed requests", () => {
  const { api, connectMultiplayer } = loadBrowserApi();
  const messages: unknown[] = [];
  connectMultiplayer({ postMessage: (message) => messages.push(message) });
  assert.equal(
    api.multiplayer.send({ delivery: "broadcast", payload: {}, extra: true } as never),
    false,
  );
  assert.doesNotThrow(() => {
    assert.equal(
      api.multiplayer.send(
        new Proxy(
          { delivery: "broadcast", payload: {} },
          {
            get() {
              throw new Error("untrusted getter");
            },
          },
        ) as never,
      ),
      false,
    );
  });
  assert.equal(api.multiplayer.send({ delivery: "broadcast", payload: { frame: 1 } }), true);
  assert.equal(api.multiplayer.broadcast({ frame: 2 }), true);
  assert.equal(api.multiplayer.direct("participant_02", { move: "left" }), true);
  assert.equal(api.multiplayer.snapshot({ frame: 2, players: [] }), true);

  assert.deepEqual(plain(messages), [
    {
      type: "RELAY_SEND",
      v: 1,
      generation: 4,
      clientSeq: 1,
      delivery: "broadcast",
      payload: { frame: 1 },
    },
    {
      type: "RELAY_SEND",
      v: 1,
      generation: 4,
      clientSeq: 2,
      delivery: "broadcast",
      payload: { frame: 2 },
    },
    {
      type: "RELAY_SEND",
      v: 1,
      generation: 4,
      clientSeq: 3,
      delivery: "direct",
      targetParticipantId: "participant_02",
      payload: { move: "left" },
    },
    {
      type: "RELAY_SNAPSHOT_SET",
      v: 1,
      generation: 4,
      clientSeq: 4,
      payload: { frame: 2, players: [] },
    },
  ]);
});

test("invalid or oversized intents neither cross the port nor consume a client sequence", () => {
  const { api, connectMultiplayer } = loadBrowserApi();
  const messages: unknown[] = [];
  connectMultiplayer({ postMessage: (message) => messages.push(message) });

  assert.equal(
    api.multiplayer.send({
      delivery: "direct",
      targetParticipantId: "short",
      payload: {},
    }),
    false,
  );
  assert.equal(api.multiplayer.broadcast({ impossible: Number.POSITIVE_INFINITY }), false);
  assert.equal(api.multiplayer.broadcast({ text: "한".repeat(2_000) }), false);
  const throwingRequest = new Proxy(
    { delivery: "broadcast", payload: {} },
    {
      get() {
        throw new Error("untrusted getter");
      },
    },
  );
  assert.doesNotThrow(() => {
    assert.equal(api.multiplayer.send(throwingRequest as never), false);
  });
  assert.equal(api.multiplayer.broadcast({ direction: "right" }), true);

  assert.deepEqual(plain(messages), [
    {
      type: "RELAY_SEND",
      v: 1,
      generation: 4,
      clientSeq: 1,
      delivery: "broadcast",
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

  const first = {
    type: "RELAY_MESSAGE",
    v: 1,
    generation: 4,
    serverSeq: 1,
    sender: { participantId: "participant_02", seatIndex: 1, role: "PLAYER" },
    delivery: "broadcast",
    payload: { frame: 1 },
  } as const;
  port.onmessage({ data: first });
  port.onmessage({ data: { ...first, payload: { duplicate: true } } });
  port.onmessage({
    data: {
      ...first,
      generation: 999,
      serverSeq: 2,
    },
  });
  port.onmessage({
    data: {
      ...first,
      serverSeq: 2,
      credential: "must-not-pass",
    },
  });
  const second = {
    type: "RELAY_MESSAGE",
    v: 1,
    generation: 4,
    serverSeq: 2,
    sender: { participantId: "participant_02", seatIndex: 1, role: "PLAYER" },
    delivery: "direct",
    targetParticipantId: "participant_01",
    payload: { frame: 2 },
  } as const;
  port.onmessage({ data: second });
  port.onmessage({ data: MULTIPLAYER_BOOTSTRAP });

  assert.deepEqual(plain(received), [first, second]);

  unsubscribe();
  port.onmessage({
    data: {
      type: "RELAY_SYNC",
      v: 1,
      generation: 4,
      serverSeq: 3,
      snapshot: null,
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
    assert.equal(api.multiplayer.broadcast({ index }), true);
  }
  assert.equal(api.multiplayer.broadcast({ index: 32 }), false);
  connectMultiplayer({ postMessage: (message) => messages.push(message) });
  assert.equal(messages.length, 32);
  assert.deepEqual(plain(messages.at(-1)), {
    type: "RELAY_SEND",
    v: 1,
    generation: 4,
    clientSeq: 32,
    delivery: "broadcast",
    payload: { index: 31 },
  });

  api.multiplayer.leave();
  assert.deepEqual(plain(messages.at(-1)), { type: "MULTI_LEAVE", v: 1, generation: 4 });
  assert.equal(api.multiplayer.broadcast({ afterLeave: true }), false);
});
