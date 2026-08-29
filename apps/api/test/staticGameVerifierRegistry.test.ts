import assert from "node:assert/strict";
import test from "node:test";
import type { GameVerifier } from "@owogg/core";
import {
  StaticGameVerifierRegistry,
  createTrustedGameVerifierRegistry,
} from "../src/infrastructure/games/StaticGameVerifierRegistry.js";
import { VERIFIED_AIM_TEST_VERIFIER_ID } from "../src/infrastructure/games/verifiers/VerifiedAimTestV1.js";

const verifier: GameVerifier = {
  async verify() {
    return { accepted: true, facts: { score: 1 } };
  },
};

test("static verifier registry resolves only explicitly compiled entries", () => {
  const registry = new StaticGameVerifierRegistry([["test/score-v1", verifier]]);

  assert.equal(registry.has("test/score-v1"), true);
  assert.equal(registry.resolve("test/score-v1"), verifier);
  assert.equal(registry.has("test/missing"), false);
  assert.equal(registry.resolve("test/missing"), null);
});

test("static verifier registry rejects invalid and duplicate IDs", () => {
  assert.throws(() => new StaticGameVerifierRegistry([["Invalid ID", verifier]]), TypeError);
  assert.throws(
    () =>
      new StaticGameVerifierRegistry([
        ["test/score-v1", verifier],
        ["test/score-v1", verifier],
      ]),
    TypeError,
  );
});

test("production trusted verifier registry installs only the reviewed reference verifier", () => {
  const registry = createTrustedGameVerifierRegistry();
  assert.equal(registry.has(VERIFIED_AIM_TEST_VERIFIER_ID), true);
  assert.notEqual(registry.resolve(VERIFIED_AIM_TEST_VERIFIER_ID), null);
  assert.equal(registry.has("test/score-v1"), false);
  assert.equal(registry.resolve("test/score-v1"), null);
});
