import assert from "node:assert/strict";
import test from "node:test";
import {
  canTransitionMultiplayerInstance,
  canTransitionMultiplayerMatch,
} from "../src/modules/multiplayer/domain/multiplayerLifecycle.js";

test("allows only explicit instance lifecycle transitions", () => {
  assert.equal(canTransitionMultiplayerInstance("CREATED", "LOBBY"), true);
  assert.equal(canTransitionMultiplayerInstance("LOBBY", "ACTIVE"), false);
  assert.equal(canTransitionMultiplayerInstance("ACTIVE", "CLOSING"), true);
  assert.equal(canTransitionMultiplayerInstance("STARTING", "EXPIRED"), true);
  assert.equal(canTransitionMultiplayerInstance("ACTIVE", "EXPIRED"), true);
  assert.equal(canTransitionMultiplayerInstance("CLOSING", "LOBBY"), true);
  assert.equal(canTransitionMultiplayerInstance("CLOSED", "ACTIVE"), false);
  assert.equal(canTransitionMultiplayerInstance("EXPIRED", "LOBBY"), false);
});

test("requires terminal finalization before a match is committed", () => {
  assert.equal(canTransitionMultiplayerMatch("PENDING", "ACTIVE"), true);
  assert.equal(canTransitionMultiplayerMatch("ACTIVE", "COMMITTED"), false);
  assert.equal(canTransitionMultiplayerMatch("ACTIVE", "FINALIZING"), true);
  assert.equal(canTransitionMultiplayerMatch("FINALIZING", "COMMITTED"), true);
  assert.equal(canTransitionMultiplayerMatch("COMMITTED", "ABORTED"), false);
});
