import type { ProgressionRepository, XpLeaderboardEntry } from "../ports/repositories.js";
import {
  XP_PER_ACCEPTED_COMPLETION,
  XP_DAILY_CAP_COMPLETIONS_PER_GAME,
  getProgressionSummary,
  type ProgressionSummary,
} from "../domain/progression.js";

export interface RecordCompletionResult {
  duplicate: boolean;
  xpAwarded: number;
  capped: boolean;
  eligibleCompletions: number;
  progress: ProgressionSummary;
  xpEventId?: number | undefined;
}

export class ProgressionUseCases {
  constructor(private repo: ProgressionRepository) {}

  /**
   * Records one accepted, authenticated game completion and returns the resulting
   * progression state. Guests never reach this — callers must only invoke this for a
   * session-authenticated userId. Server-authoritative: the amount is never supplied by
   * the caller.
   */
  async recordAcceptedGameCompletion(input: {
    userId: number;
    gameId: string;
    sourceId: string;
    /** Resolved from the generic canonical policy by the score acceptance caller. The default is
     * retained only for older internal callers/tests; generic runtime routes always provide it. */
    xpPerCompletion?: number;
    sourceType?: "score" | "result";
  }): Promise<RecordCompletionResult> {
    const outcome = await this.repo.recordGameCompletion({
      userId: input.userId,
      gameId: input.gameId,
      sourceType: input.sourceType ?? "score",
      sourceId: input.sourceId,
      xpPerCompletion: input.xpPerCompletion ?? XP_PER_ACCEPTED_COMPLETION,
      dailyCapPerGame: XP_DAILY_CAP_COMPLETIONS_PER_GAME,
    });

    return {
      duplicate: outcome.duplicate,
      xpAwarded: outcome.xpAwarded,
      capped: !outcome.duplicate && outcome.xpAwarded === 0,
      eligibleCompletions: outcome.eligibleCompletions,
      progress: getProgressionSummary(outcome.totalXp),
      xpEventId: outcome.xpEventId,
    };
  }

  async getProgressionSummary(
    userId: number,
  ): Promise<{ summary: ProgressionSummary; eligibleCompletions: number }> {
    const progress = await this.repo.getUserProgress(userId);
    return {
      summary: getProgressionSummary(progress?.total_xp ?? 0),
      eligibleCompletions: progress?.eligible_completions ?? 0,
    };
  }

  async getGlobalXpLeaderboard(limit = 20): Promise<XpLeaderboardEntry[]> {
    return this.repo.getXpLeaderboard(limit);
  }

  async getGlobalXpRank(userId: number): Promise<number | null> {
    return this.repo.getGlobalXpRank(userId);
  }
}
