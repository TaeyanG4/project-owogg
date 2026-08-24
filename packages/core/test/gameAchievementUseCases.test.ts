import test from "node:test";
import assert from "node:assert/strict";
import {
  GameAchievementUseCases,
  type GameAchievementRepository,
  type NormalizedGameCreatorResult,
} from "../src/index.js";
import type { OwoggAchievementDefinition } from "@owogg/game-sdk/contracts";

const RESULT: NormalizedGameCreatorResult = {
  outcome: "success",
  rawScore: 80,
  normalizedScore: 80,
  progressionValue: 4,
  metrics: { kills: 3 },
  events: { boss_defeated: 1 },
  adjusted: false,
  adjustmentReason: null,
  rewardEligible: true,
};

const ACHIEVEMENTS: OwoggAchievementDefinition[] = [
  {
    id: "score-hero",
    title: "Score Hero",
    scope: "session",
    condition: { source: "score", operator: ">=", value: 75 },
  },
  {
    id: "successful",
    title: "Successful",
    scope: "session",
    condition: { source: "outcome", operator: "==", value: "success" },
  },
  {
    id: "kill-collector",
    title: "Kill Collector",
    scope: "lifetime",
    condition: { source: "metric", key: "kills", aggregate: "sum", operator: ">=", value: 10 },
  },
  {
    id: "boss-hunter",
    title: "Boss Hunter",
    scope: "lifetime",
    condition: {
      source: "event",
      key: "boss_defeated",
      aggregate: "count",
      operator: ">=",
      value: 3,
    },
  },
];

function setup() {
  const unlocked = new Set<string>();
  const repository: GameAchievementRepository = {
    async aggregate(input) {
      if (input.source === "metric" && input.key === "kills" && input.aggregate === "sum") {
        return 12;
      }
      if (
        input.source === "event" &&
        input.key === "boss_defeated" &&
        input.aggregate === "count"
      ) {
        return 3;
      }
      return null;
    },
    async unlock(input) {
      const key = `${input.userId}:${input.gameId}:${input.achievementId}`;
      if (unlocked.has(key)) return false;
      unlocked.add(key);
      return true;
    },
  };
  return new GameAchievementUseCases(repository);
}

test("achievements evaluate session facts and lifetime metric/event aggregates", async () => {
  const useCases = setup();
  const first = await useCases.evaluate({
    userId: 1,
    gameId: 9,
    resultId: 15,
    result: RESULT,
    achievements: ACHIEVEMENTS,
  });
  assert.deepEqual(first, ["score-hero", "successful", "kill-collector", "boss-hunter"]);

  const duplicate = await useCases.evaluate({
    userId: 1,
    gameId: 9,
    resultId: 16,
    result: RESULT,
    achievements: ACHIEVEMENTS,
  });
  assert.deepEqual(duplicate, []);
});

test("an adjusted result cannot unlock any achievement", async () => {
  const useCases = setup();
  const unlocked = await useCases.evaluate({
    userId: 1,
    gameId: 9,
    resultId: 15,
    result: { ...RESULT, adjusted: true, rewardEligible: false },
    achievements: ACHIEVEMENTS,
  });
  assert.deepEqual(unlocked, []);
});
