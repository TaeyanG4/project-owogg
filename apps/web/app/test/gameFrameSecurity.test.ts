import test from "node:test";
import assert from "node:assert/strict";
import {
  GAME_IFRAME_ALLOW,
  GAME_IFRAME_REFERRER_POLICY,
  GAME_IFRAME_SANDBOX,
} from "../features/game/GameFrame";
import {
  getGameOrigin,
  gamePlayUrl,
  gamePreviewUrl,
  gameVersionPlayUrl,
  API_URL,
} from "../lib/api/config";

// The iframe sandbox policy is the boundary protecting the main app from uploaded third-party game
// code, so it is asserted rather than left to review — a well-meaning "just add allow-same-origin
// to make the engine work" is exactly the change this is here to catch.
test("the game iframe grants only scripts and pointer lock", () => {
  assert.equal(GAME_IFRAME_SANDBOX, "allow-scripts allow-pointer-lock");
});

test("the game iframe never grants allow-same-origin, which would collapse the origin boundary", () => {
  assert.ok(!GAME_IFRAME_SANDBOX.includes("allow-same-origin"));
});

test("the game iframe grants no capability beyond fullscreen presentation", () => {
  assert.equal(GAME_IFRAME_ALLOW, "fullscreen");
  for (const capability of ["camera", "microphone", "geolocation", "payment", "usb", "midi"]) {
    assert.ok(!GAME_IFRAME_ALLOW.includes(capability), capability);
  }
});

test("the game iframe does not grant top-level navigation, popups, or form submission", () => {
  for (const token of [
    "allow-top-navigation",
    "allow-popups",
    "allow-forms",
    "allow-modals",
    "allow-downloads",
  ]) {
    assert.ok(!GAME_IFRAME_SANDBOX.includes(token), token);
  }
});

test("the game origin is resolved from configuration, not hardcoded to one hostname", () => {
  // Without VITE_GAME_ORIGIN set (as in this test process) it falls back to the API origin, which
  // is itself configurable — so no play URL is ever pinned to a literal in a component.
  assert.equal(getGameOrigin(), API_URL);
});

test("the provider-neutral runtime URL is shared by OWOGG and USER games", () => {
  assert.equal(gamePlayUrl("reaction-time"), `${API_URL}/play/reaction-time`);
  assert.equal(gamePlayUrl("creator game"), `${API_URL}/play/creator%20game`);
});

test("multiplayer uses the immutable numeric version URL pinned by its room", () => {
  assert.equal(gameVersionPlayUrl(42, 17), `${API_URL}/games/42/17/index.html`);
  assert.throws(() => gameVersionPlayUrl(0, 17), RangeError);
  assert.throws(() => gameVersionPlayUrl(42, Number.NaN), RangeError);
});

test("private preview paths stay on the dedicated game origin", () => {
  assert.equal(
    gamePreviewUrl("/preview/gp1.payload.signature/index.html"),
    `${API_URL}/preview/gp1.payload.signature/index.html`,
  );
  assert.throws(() => gamePreviewUrl("/games/42/17/index.html"), RangeError);
});

test("the game iframe sends no referrer", () => {
  assert.equal(GAME_IFRAME_REFERRER_POLICY, "no-referrer");
});
