import { formatScore } from "@owogg/game-sdk/contracts";
import type { RuntimeGameRegistry } from "../modules/game/ports/runtimeGameRegistry.js";
import type { ScoreRepository } from "../ports/repositories.js";

/**
 * Provider-neutral score reads used by personal-best/profile surfaces. This class resolves every
 * game through the generic
 * runtime identity + live version + canonical document join, so USER and OWOGG policies behave
 * identically and an unresolved historical slug is omitted rather than assigned a guessed order.
 */
export class GenericScoreReadUseCases {
  constructor(
    private readonly scoreRepo: ScoreRepository,
    private readonly runtimeGameRegistry: RuntimeGameRegistry,
  ) {}

  async getUserBests(userId: number): Promise<Record<string, number>> {
    const aggregates = await this.scoreRepo.getUserPersonalBests(userId);
    const bests: Record<string, number> = {};

    for (const item of aggregates) {
      const runtime = await this.runtimeGameRegistry.findBySlug(item.game_id);
      const scorePolicy = runtime?.canonical.policy.score;
      const currentRevision = runtime?.canonical.playConfig?.rulesetRevision ?? 1;
      if (!scorePolicy || item.ruleset_revision !== currentRevision) continue;
      bests[item.game_id] = scorePolicy.direction === "asc" ? item.min_score : item.max_score;
    }

    return bests;
  }

  async getUserBestsFormatted(
    userId: number,
  ): Promise<Array<{ gameId: string; score: number; formattedScore: string }>> {
    const aggregates = await this.scoreRepo.getUserPersonalBests(userId);
    const entries: Array<{ gameId: string; score: number; formattedScore: string }> = [];

    for (const item of aggregates) {
      const runtime = await this.runtimeGameRegistry.findBySlug(item.game_id);
      const scorePolicy = runtime?.canonical.policy.score;
      const currentRevision = runtime?.canonical.playConfig?.rulesetRevision ?? 1;
      if (!scorePolicy || item.ruleset_revision !== currentRevision) continue;

      const score = scorePolicy.direction === "asc" ? item.min_score : item.max_score;
      entries.push({
        gameId: item.game_id,
        score,
        formattedScore: formatScore(score, scorePolicy),
      });
    }

    return entries;
  }
}
