import type {
  ProgressionRepository,
  RecordCompletionOutcome,
  UserProgress,
  XpLeaderboardEntry,
} from "@owogg/core";
import type { D1Database } from "./D1UserRepository.js";

export class D1ProgressionRepository implements ProgressionRepository {
  constructor(private db: D1Database) {}

  async recordGameCompletion(input: {
    userId: number;
    gameId: string;
    sourceType: string;
    sourceId: string;
    xpPerCompletion: number;
    dailyCapPerGame: number;
  }): Promise<RecordCompletionOutcome> {
    const existing = await this.db
      .prepare(`SELECT id, amount FROM xp_events WHERE source_type = ? AND source_id = ?`)
      .bind(input.sourceType, input.sourceId)
      .first<{ id: number; amount: number }>();

    if (existing) {
      const progress = await this.getUserProgress(input.userId);
      return {
        duplicate: true,
        xpAwarded: 0,
        totalXp: progress?.total_xp ?? 0,
        eligibleCompletions: progress?.eligible_completions ?? 0,
        xpEventId: Number(existing.id),
      };
    }

    const now = new Date();
    const createdAt = now.toISOString();
    const startOfUtcDay = createdAt.slice(0, 10) + "T00:00:00.000Z";
    const startOfNextUtcDay =
      new Date(now.getTime() + 86400000).toISOString().slice(0, 10) + "T00:00:00.000Z";

    // D1 batch is one SQLite transaction. The cap is calculated inside the INSERT after this
    // writer reaches its serialized transaction position. The aggregate SELECT is gated by
    // changes() from that immediately preceding INSERT, so a duplicate cannot advance progress
    // and an aggregate failure rolls the xp_events insert back too.
    const batchResults = await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO xp_events (
             user_id, amount, reason, source_type, source_id, game_id, created_at
           ) VALUES (
             ?,
             CASE WHEN (
               SELECT COUNT(*) FROM xp_events
               WHERE user_id = ? AND game_id = ? AND amount > 0
                 AND created_at >= ? AND created_at < ?
             ) < ? THEN ? ELSE 0 END,
             'GAME_COMPLETION', ?, ?, ?, ?
           )
           ON CONFLICT(source_type, source_id) DO NOTHING`,
        )
        .bind(
          input.userId,
          input.userId,
          input.gameId,
          startOfUtcDay,
          startOfNextUtcDay,
          input.dailyCapPerGame,
          input.xpPerCompletion,
          input.sourceType,
          input.sourceId,
          input.gameId,
          createdAt,
        ),
      this.db
        .prepare(
          `INSERT INTO user_progress (user_id, total_xp, eligible_completions, updated_at)
           SELECT ?, event.amount, 1, ?
           FROM xp_events event
           WHERE event.source_type = ? AND event.source_id = ? AND changes() = 1
           ON CONFLICT(user_id) DO UPDATE SET
             total_xp = total_xp + excluded.total_xp,
             eligible_completions = eligible_completions + 1,
             updated_at = excluded.updated_at`,
        )
        .bind(input.userId, createdAt, input.sourceType, input.sourceId),
    ]);

    const insertedCount = batchResults[0]?.meta?.rows_written ?? batchResults[0]?.meta?.changes;
    if (insertedCount !== 0 && insertedCount !== 1) {
      throw new Error("D1 progression write metadata is missing or invalid");
    }

    const [progress, createdEvent] = await Promise.all([
      this.getUserProgress(input.userId),
      this.db
        .prepare(`SELECT id, amount FROM xp_events WHERE source_type = ? AND source_id = ?`)
        .bind(input.sourceType, input.sourceId)
        .first<{ id: number; amount: number }>(),
    ]);
    if (!createdEvent) {
      throw new Error("D1 progression event is missing after atomic write");
    }

    if (insertedCount === 0) {
      return {
        duplicate: true,
        xpAwarded: 0,
        totalXp: progress?.total_xp ?? 0,
        eligibleCompletions: progress?.eligible_completions ?? 0,
        xpEventId: Number(createdEvent.id),
      };
    }

    const xpAwarded = Number(createdEvent.amount);
    return {
      duplicate: false,
      xpAwarded,
      totalXp: progress?.total_xp ?? xpAwarded,
      eligibleCompletions: progress?.eligible_completions ?? 1,
      xpEventId: Number(createdEvent.id),
    };
  }
  async getUserProgress(userId: number): Promise<UserProgress | null> {
    const row = await this.db
      .prepare(
        `SELECT user_id, total_xp, eligible_completions, updated_at FROM user_progress WHERE user_id = ?`,
      )
      .bind(userId)
      .first<Record<string, unknown>>();

    if (!row) return null;

    return {
      user_id: Number(row.user_id),
      total_xp: Number(row.total_xp),
      eligible_completions: Number(row.eligible_completions),
      updated_at: String(row.updated_at),
    };
  }

  async getXpLeaderboard(limit: number): Promise<XpLeaderboardEntry[]> {
    const res = await this.db
      .prepare(
        `SELECT u.id as user_id, u.nickname, u.avatar_url, p.total_xp
         FROM user_progress p
         JOIN users u ON u.id = p.user_id
         ORDER BY p.total_xp DESC, p.user_id ASC
         LIMIT ?`,
      )
      .bind(limit)
      .all<Record<string, unknown>>();

    return res.results.map((row) => ({
      userId: Number(row.user_id),
      nickname: String(row.nickname),
      avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
      totalXp: Number(row.total_xp),
    }));
  }

  async getGlobalXpRank(userId: number): Promise<number | null> {
    const progress = await this.getUserProgress(userId);
    if (!progress) return null;

    const row = await this.db
      .prepare(`SELECT COUNT(*) as ahead FROM user_progress WHERE total_xp > ?`)
      .bind(progress.total_xp)
      .first<{ ahead: number }>();

    return Number(row?.ahead ?? 0) + 1;
  }
}
