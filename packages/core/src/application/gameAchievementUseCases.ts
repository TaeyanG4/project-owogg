import type {
  OwoggAchievementCondition,
  OwoggAchievementDefinition,
} from "@owogg/game-sdk/contracts";
import type { NormalizedCreatorResult } from "../domain/creatorResult.js";
import type { GameAchievementRepository } from "../ports/gameAchievements.js";

function compare(actual: number | string | boolean, condition: OwoggAchievementCondition): boolean {
  const expected = condition.value;
  switch (condition.operator) {
    case "==":
      return actual === expected;
    case "!=":
      return actual !== expected;
    case ">":
      return typeof actual === "number" && typeof expected === "number" && actual > expected;
    case ">=":
      return typeof actual === "number" && typeof expected === "number" && actual >= expected;
    case "<":
      return typeof actual === "number" && typeof expected === "number" && actual < expected;
    case "<=":
      return typeof actual === "number" && typeof expected === "number" && actual <= expected;
  }
}

function sessionFact(
  condition: OwoggAchievementCondition,
  result: NormalizedCreatorResult,
): number | string | null {
  switch (condition.source) {
    case "score":
      return result.normalizedScore;
    case "outcome":
      return result.outcome;
    case "progression":
      return result.progressionValue;
    case "metric":
      return condition.key ? (result.metrics[condition.key] ?? null) : null;
    case "event":
      return condition.key ? (result.events[condition.key] ?? 0) : null;
  }
}

export class GameAchievementUseCases {
  constructor(private readonly repository: GameAchievementRepository) {}

  async evaluate(input: {
    userId: number;
    gameId: number;
    resultId: number;
    result: NormalizedCreatorResult;
    achievements: readonly OwoggAchievementDefinition[];
  }): Promise<string[]> {
    // Any clamped fact excludes the entire result from achievements by default, matching the v1
    // guide's adjusted-result rule and preventing a forged extreme value from unlocking anything.
    if (!input.result.rewardEligible) return [];
    const unlocked: string[] = [];
    for (const achievement of input.achievements) {
      const condition = achievement.condition;
      let actual: number | string | boolean | null;
      if (
        achievement.scope === "lifetime" &&
        condition.aggregate &&
        condition.source !== "outcome"
      ) {
        actual = await this.repository.aggregate({
          userId: input.userId,
          gameId: input.gameId,
          source: condition.source,
          ...(condition.key ? { key: condition.key } : {}),
          aggregate: condition.aggregate,
        });
      } else {
        actual = sessionFact(condition, input.result);
      }
      if (actual === null || !compare(actual, condition)) continue;
      const didUnlock = await this.repository.unlock({
        userId: input.userId,
        gameId: input.gameId,
        achievementId: achievement.id,
        resultId: input.resultId,
        unlockedAt: new Date().toISOString(),
      });
      if (didUnlock) unlocked.push(achievement.id);
    }
    return unlocked;
  }
}
