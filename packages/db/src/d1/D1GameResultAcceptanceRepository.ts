import type { GameResultAcceptanceRepository, NormalizedGameCreatorResult } from "@owogg/core";
import type { D1Database } from "./D1UserRepository.js";

/** Atomic one-attempt result acceptance plus optional leaderboard score projection. */
export class D1GameResultAcceptanceRepository implements GameResultAcceptanceRepository {
  constructor(private readonly db: D1Database) {}

  async acceptResult(input: {
    attemptId: string;
    userId: number;
    gameId: number;
    versionId: number;
    slug: string;
    nickname: string;
    avatarUrl: string | null;
    difficulty: string;
    result: NormalizedGameCreatorResult;
    leaderboardEnabled: boolean;
    nowIso: string;
  }): Promise<{ accepted: boolean; resultId: number | null; scoreId: number | null }> {
    const results = (await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO game_attempt_consumptions (attempt_id, user_id, game_id, version_id, consumed_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(attempt_id) DO NOTHING`,
        )
        .bind(input.attemptId, input.userId, input.gameId, input.versionId, input.nowIso),
      this.db
        .prepare(
          `INSERT INTO game_results (
             attempt_id, user_id, game_id, version_id, outcome, raw_score, normalized_score,
             progression_value, metrics_json, events_json, difficulty, adjusted,
             adjustment_reason, reward_eligible, created_at
           )
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
           WHERE changes() = 1
           RETURNING id`,
        )
        .bind(
          input.attemptId,
          input.userId,
          input.gameId,
          input.versionId,
          input.result.outcome,
          input.result.rawScore,
          input.result.normalizedScore,
          input.result.progressionValue,
          JSON.stringify(input.result.metrics),
          JSON.stringify(input.result.events),
          input.difficulty,
          input.result.adjusted ? 1 : 0,
          input.result.adjustmentReason,
          input.result.rewardEligible ? 1 : 0,
          input.nowIso,
        ),
      this.db
        .prepare(
          `INSERT INTO scores (
             user_id, nickname, avatar_url, game_id, score, difficulty, created_at, result_id,
             leaderboard_generation
           )
           SELECT ?, ?, ?, ?, gr.normalized_score, ?, ?, gr.id, g.leaderboard_generation
           FROM game_results gr
           JOIN games g ON g.id = gr.game_id AND g.live_version_id = gr.version_id
           WHERE gr.attempt_id = ?
             AND g.deleted_at IS NULL
             AND gr.reward_eligible = 1
             AND gr.normalized_score IS NOT NULL
             AND ? = 1
           ON CONFLICT(result_id) WHERE result_id IS NOT NULL DO NOTHING
           RETURNING id`,
        )
        .bind(
          input.userId,
          input.nickname || "플레이어",
          input.avatarUrl,
          input.slug,
          input.difficulty,
          input.nowIso,
          input.attemptId,
          input.leaderboardEnabled ? 1 : 0,
        ),
    ])) as Array<{
      success: boolean;
      meta?: { rows_written?: number; last_row_id?: number };
      results?: Array<Record<string, unknown>>;
    }>;

    const resultInsert = results[1];
    const accepted = (resultInsert?.meta?.rows_written ?? 0) > 0;
    if (!accepted) return { accepted: false, resultId: null, scoreId: null };

    const resultRaw = resultInsert?.results?.[0]?.id ?? resultInsert?.meta?.last_row_id;
    const resultId = Number(resultRaw);
    if (!Number.isInteger(resultId) || resultId <= 0) {
      return { accepted: false, resultId: null, scoreId: null };
    }

    const scoreInsert = results[2];
    const scoreRaw = scoreInsert?.results?.[0]?.id ?? scoreInsert?.meta?.last_row_id;
    const scoreCandidate = Number(scoreRaw);
    const scoreId =
      (scoreInsert?.meta?.rows_written ?? 0) > 0 &&
      Number.isInteger(scoreCandidate) &&
      scoreCandidate > 0
        ? scoreCandidate
        : null;
    return { accepted: true, resultId, scoreId };
  }
}
