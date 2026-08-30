import {
  previousServiceDateString,
  resolvePublicRankingPeriod,
  serviceDateString,
} from "../domain/publicRanking.js";
import type { PublicRankingPeriod } from "../domain/publicRanking.js";
import type {
  PublicRankingRepository,
  PublicRankingRow,
  PublicRankingScope,
} from "../ports/publicRanking.js";
import type { StreamerPlatformType } from "../ports/repositories.js";

export class PublicRankingUseCases {
  constructor(private readonly repository: PublicRankingRepository) {}

  async getRanking(input: {
    scope: PublicRankingScope;
    metric: "score" | "xp" | "streak";
    period: PublicRankingPeriod;
    gameId?: string | undefined;
    difficulty?: string | undefined;
    rulesetRevision?: number | undefined;
    direction?: "asc" | "desc" | undefined;
    platform?: StreamerPlatformType | undefined;
    limit: number;
    now?: Date | undefined;
  }): Promise<{ startAt: string; endAt: string; rows: PublicRankingRow[] }> {
    const now = input.now ?? new Date();
    const period = resolvePublicRankingPeriod(input.period, now);
    const shared = {
      scope: input.scope,
      startAt: period.startAt,
      endAt: period.endAt,
      ...(input.platform ? { platform: input.platform } : {}),
      limit: input.limit,
    };

    if (input.metric === "score") {
      if (!input.gameId || !input.difficulty || !input.direction || !input.rulesetRevision) {
        throw new Error("score ranking authority is incomplete");
      }
      const rows = await this.repository.getScoreRanking({
        ...shared,
        gameId: input.gameId,
        difficulty: input.difficulty,
        direction: input.direction,
        rulesetRevision: input.rulesetRevision,
      });
      return { ...period, rows };
    }

    if (input.metric === "xp") {
      const rows = await this.repository.getXpRanking(shared);
      return { ...period, rows };
    }

    const today = serviceDateString(now);
    const rows = await this.repository.getStreakRanking({
      scope: input.scope,
      activeDates: [today, previousServiceDateString(today)],
      ...(input.platform ? { platform: input.platform } : {}),
      limit: input.limit,
    });
    return { ...period, rows };
  }
}
