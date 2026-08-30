import assert from "node:assert/strict";
import test from "node:test";
import type { GameVerifier } from "@owogg/core";
import {
  StaticGameVerifierRegistry,
  createTrustedGameVerifierRegistry,
} from "../src/infrastructure/games/StaticGameVerifierRegistry.js";
import { AIM_TEST_VERIFIER_ID } from "../src/infrastructure/games/verifiers/AimTestV1.js";
import { MEMORY_TEST_VERIFIER_ID } from "../src/infrastructure/games/verifiers/MemoryTestV1.js";
import { REACTION_TIME_VERIFIER_ID } from "../src/infrastructure/games/verifiers/ReactionTimeV1.js";
import { TYPING_TEST_VERIFIER_ID } from "../src/infrastructure/games/verifiers/TypingTestV1.js";
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

test("production trusted verifier registry installs only reviewed verifier IDs", () => {
  const registry = createTrustedGameVerifierRegistry();
  for (const verifierId of [
    AIM_TEST_VERIFIER_ID,
    MEMORY_TEST_VERIFIER_ID,
    REACTION_TIME_VERIFIER_ID,
    TYPING_TEST_VERIFIER_ID,
    VERIFIED_AIM_TEST_VERIFIER_ID,
  ]) {
    assert.equal(registry.has(verifierId), true);
    assert.notEqual(registry.resolve(verifierId), null);
  }
  assert.equal(registry.has("test/score-v1"), false);
  assert.equal(registry.resolve("test/score-v1"), null);
});
