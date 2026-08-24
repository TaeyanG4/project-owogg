import test from "node:test";
import assert from "node:assert/strict";
import { isGamePlayPath } from "../components/layout/Layout";

test("only a concrete live game route enables the overlay-only navigation", () => {
  assert.equal(isGamePlayPath("/games/reaction-time"), true);
  assert.equal(isGamePlayPath("/games/reaction-time/"), true);
  assert.equal(isGamePlayPath("/games"), false);
  assert.equal(isGamePlayPath("/games/reaction-time/ranking"), false);
  assert.equal(isGamePlayPath("/ranking"), false);
});
