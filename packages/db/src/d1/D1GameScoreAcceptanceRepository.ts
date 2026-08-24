import type { GameScoreAcceptanceRepository } from "@owogg/core";
import type { D1Database } from "./D1UserRepository.js";

/**
 * Generic replacement for the old Game Creator-only acceptance adapter. Migration 0032 points
 * game_attempt_consumptions at `games`/`game_versions`, so OWOGG and USER attempts share this
 * exact transaction. The final SELECT is gated by the score INSERT's `changes()` result and
 * returns the stable score row id without a second, non-atomic lookup.
 */
export class D1GameScoreAcceptanceRepository implements GameScoreAcceptanceRepository {
  constructor(private readonly db: D1Database) {}

  async acceptScore(input: {
    attemptId: string;
    userId: number;
    gameId: number;
    versionId: number;
    slug: string;
    nickname: string;
    avatarUrl: string | null;
    score: number;
    difficulty: string;
    nowIso: string;
  }): Promise<{ accepted: boolean; scoreId: number | null }> {
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
          `INSERT INTO scores
             (user_id, nickname, avatar_url, game_id, score, difficulty, created_at,
              leaderboard_generation)
           SELECT ?, ?, ?, ?, ?, ?, ?, g.leaderboard_generation
           FROM games g
           WHERE g.id = ? AND g.live_version_id = ? AND g.deleted_at IS NULL
             AND changes() = 1`,
        )
        .bind(
          input.userId,
          input.nickname || "플레이어",
          input.avatarUrl,
          input.slug,
          input.score,
          input.difficulty,
          input.nowIso,
          input.gameId,
          input.versionId,
        ),
      this.db.prepare(
        `SELECT id FROM scores
           WHERE rowid = last_insert_rowid() AND changes() = 1`,
      ),
    ])) as Array<{
      success: boolean;
      meta?: { rows_written?: number; last_row_id?: number };
      results?: Array<Record<string, unknown>>;
    }>;

    const scoreInsert = results[1];
    const accepted = (scoreInsert?.meta?.rows_written ?? 0) > 0;
    if (!accepted) return { accepted: false, scoreId: null };

    const rawId = results[2]?.results?.[0]?.id ?? scoreInsert?.meta?.last_row_id;
    const scoreId = typeof rawId === "number" ? rawId : Number(rawId);
    if (!Number.isInteger(scoreId) || scoreId <= 0) {
      // A successful score write without a readable id is not safe to report as accepted: the
      // caller cannot attach progression to a stable source id, so fail closed.
      return { accepted: false, scoreId: null };
    }
    return { accepted: true, scoreId };
  }
}
