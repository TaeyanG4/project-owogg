import test from "node:test";
import assert from "node:assert/strict";
import { GameResultAcceptRequestSchema } from "@owogg/contracts";

const GS1_TOKEN = "gs1.payload.signature";
const GS2_TOKEN = "gs2.payload.signature";

test("gs1 result payload accepts declared facts but rejects client-owned identity", () => {
  assert.equal(
    GameResultAcceptRequestSchema.safeParse({
      token: GS1_TOKEN,
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
      token: GS1_TOKEN,
      score: 42,
      userId: 999,
    }).success,
    false,
  );
});

test("result payload rejects non-finite and incorrectly typed numeric facts", () => {
  for (const score of [Number.NaN, Number.POSITIVE_INFINITY, "42", null, {}]) {
    assert.equal(
      GameResultAcceptRequestSchema.safeParse({ token: GS1_TOKEN, score }).success,
      false,
    );
  }
});

test("gs2 result payload requires evidence and rejects every client-authored fact", () => {
  assert.equal(
    GameResultAcceptRequestSchema.safeParse({
      token: GS2_TOKEN,
      evidence: { frames: [{ at: 10 }] },
      playToken: "discord-play-token",
    }).success,
    true,
  );
  assert.equal(GameResultAcceptRequestSchema.safeParse({ token: GS2_TOKEN }).success, false);

  for (const clientFact of [
    { score: 42 },
    { outcome: "success" },
    { difficulty: "hard" },
    { progression: { value: 3 } },
    { metrics: { kills: 2 } },
    { events: { completed: 1 } },
  ]) {
    assert.equal(
      GameResultAcceptRequestSchema.safeParse({
        token: GS2_TOKEN,
        evidence: {},
        ...clientFact,
      }).success,
      false,
      JSON.stringify(clientFact),
    );
  }
});

test("result token versions cannot cross their exclusive request shapes", () => {
  assert.equal(
    GameResultAcceptRequestSchema.safeParse({ token: GS1_TOKEN, evidence: {} }).success,
    false,
  );
  assert.equal(
    GameResultAcceptRequestSchema.safeParse({ token: GS2_TOKEN, score: 1 }).success,
    false,
  );
  assert.equal(
    GameResultAcceptRequestSchema.safeParse({ token: "signed-attempt", score: 1 }).success,
    false,
  );
});
