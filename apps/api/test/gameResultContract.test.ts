import test from "node:test";
import assert from "node:assert/strict";
import { GameResultAcceptRequestSchema } from "@owogg/contracts";

test("result payload accepts declared facts but rejects client-owned identity", () => {
  assert.equal(
    GameResultAcceptRequestSchema.safeParse({
      token: "signed-attempt",
      outcome: "success",
      score: 42,
      progression: { value: 3 },
      metrics: { kills: 2 },
      events: { boss_defeated: 1 },
    }).success,
    true,
  );
  assert.equal(
    GameResultAcceptRequestSchema.safeParse({
      token: "signed-attempt",
      score: 42,
      userId: 999,
    }).success,
    false,
  );
});

test("result payload rejects non-finite and incorrectly typed numeric facts", () => {
  for (const score of [Number.NaN, Number.POSITIVE_INFINITY, "42", null, {}]) {
    assert.equal(
      GameResultAcceptRequestSchema.safeParse({ token: "signed-attempt", score }).success,
      false,
    );
  }
});
