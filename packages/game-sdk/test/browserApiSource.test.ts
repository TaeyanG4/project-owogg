import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { OWOGG_BROWSER_API_SOURCE } from "../src/bridge/browserApiSource.js";
import type { OwoggBrowserApi } from "../src/contracts/gameCreatorManifest.js";

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
  return {
    api,
    connect(port: { postMessage(message: unknown): void }) {
      assert.ok(listener);
      listener({ source: parent, data: { type: "HOST_INIT" }, ports: [port] });
    },
  };
}

test("injected Simple API supports complete-before-start and queues until the bridge connects", () => {
  const { api, connect } = loadBrowserApi();
  const messages: unknown[] = [];

  api.complete({ outcome: "success", score: 42, progression: { value: 3 } });
  api.start();
  connect({ postMessage: (message) => messages.push(message) });

  assert.equal(Object.isFrozen(api), true);
  assert.deepEqual(plain(messages), [
    { type: "GAME_READY" },
    { type: "GAME_COMPLETE", outcome: "success", score: 42, progression: { value: 3 } },
  ]);
});

test("injected Simple API forwards start/event/cancel without exposing host session state", () => {
  const { api, connect } = loadBrowserApi();
  const messages: unknown[] = [];
  connect({ postMessage: (message) => messages.push(message) });

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
  assert.deepEqual(Object.keys(api).sort(), ["cancel", "complete", "event", "start"]);
});
