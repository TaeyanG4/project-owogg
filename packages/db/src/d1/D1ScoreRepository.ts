import type { Score, ScoreRepository, UserPersonalBestAggregate } from "@owogg/core";
import type { D1Database } from "./D1UserRepository.js";

function mapScoreRow(row: Record<string, unknown>): Score {
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    nickname: String(row.nickname),
    avatar_url: row.avatar_url ? String(row.avatar_url) : null,
    game_id: String(row.game_id),
    score: Number(row.score),
    difficulty: row.difficulty ? String(row.difficulty) : "normal",
    created_at: String(row.created_at),
  };
}

export class D1ScoreRepository implements ScoreRepository {
  constructor(private db: D1Database) {}

  async saveScore(data: {
    userId: number;
    nickname: string;
    avatarUrl?: string | null;
    gameId: string;
    score: number;
    /** Already validated/normalized against the game's manifest by the caller (see
     * domain/scoreValidation.ts's validateDifficulty) — "normal" for every game that doesn't
     * declare a difficulty config. */
    difficulty: string;
  }): Promise<Score> {
    if (!data.userId || typeof data.userId !== "number") {
      throw new Error("Valid userId is required to save score");
    }

    const createdAt = new Date().toISOString();

    await this.db
      .prepare(
        `INSERT INTO scores
           (user_id, nickname, avatar_url, game_id, score, difficulty, created_at,
            leaderboard_generation)
         VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE((
           SELECT leaderboard_generation FROM games WHERE slug = ? AND deleted_at IS NULL
         ), 0))`,
      )
      .bind(
        data.userId,
        data.nickname || "플레이어",
        data.avatarUrl ?? null,
        data.gameId,
        data.score,
        data.difficulty,
        createdAt,
        data.gameId,
      )
      .run();

    const row = await this.db
      .prepare(`SELECT * FROM scores WHERE rowid = last_insert_rowid()`)
      .first<Record<string, unknown>>();

    return {
      id: Number(row?.id ?? 0),
      user_id: data.userId,
      nickname: data.nickname || "플레이어",
      avatar_url: data.avatarUrl ?? null,
      game_id: data.gameId,
      score: data.score,
      difficulty: data.difficulty,
      created_at: createdAt,
    };
  }

  async getLeaderboard(
    gameId: string,
    limit = 20,
    direction: "asc" | "desc" = "desc",
    difficulty = "normal",
  ): Promise<Score[]> {
    // `direction` must only ever originate from the trusted game manifest (never from raw
    // user/query input) — it is interpolated directly into SQL below.
    const orderClause = direction === "asc" ? "ASC" : "DESC";

    if (gameId === "all") {
      // Recent-activity feed, not a per-user ranked leaderboard — no PB dedup semantics apply,
      // and difficulty doesn't apply either (mixes many games, each with its own tiers).
      const res = await this.db
        .prepare(
          `SELECT s.* FROM scores s
           JOIN games g ON g.slug = s.game_id
             AND g.deleted_at IS NULL
             AND g.leaderboard_generation = s.leaderboard_generation
           WHERE s.user_id IS NOT NULL AND s.deleted_at IS NULL
           ORDER BY s.created_at DESC LIMIT ?`,
        )
        .bind(limit)
        .all<Record<string, unknown>>();
      return res.results.map(mapScoreRow);
    }

    // One canonical personal-best row per user is selected IN SQL (via ROW_NUMBER, before
    // LIMIT), then the deduplicated PB set is ranked and paginated. This must never regress to
    // "ORDER BY score LIMIT N" followed by JS de-duplication — a single user holding many of the
    // top-N raw rows would otherwise crowd out every other player from the leaderboard.
    // Deterministic tie-break: score, then earliest created_at, then row id. Filtering by
    // difficulty happens in the WHERE clause, before the window function runs, so "one row per
    // user" is already scoped to just that difficulty tier — scores across tiers are never
    // comparable (see docs/GAME_CREATION_GUIDE.md §4) and must never rank against each other.
    const query = `
      WITH ranked AS (
        SELECT s.*, ROW_NUMBER() OVER (
          PARTITION BY s.user_id
          ORDER BY s.score ${orderClause}, s.created_at ASC, s.id ASC
        ) AS rn
        FROM scores s
        JOIN games g ON g.slug = s.game_id
          AND g.deleted_at IS NULL
          AND g.leaderboard_generation = s.leaderboard_generation
        WHERE s.user_id IS NOT NULL AND s.game_id = ? AND s.difficulty = ?
          AND s.deleted_at IS NULL
      )
      SELECT * FROM ranked
      WHERE rn = 1
      ORDER BY score ${orderClause}, created_at ASC, id ASC
      LIMIT ?
    `;

    const res = await this.db
      .prepare(query)
      .bind(gameId, difficulty, limit)
      .all<Record<string, unknown>>();

    return res.results.map(mapScoreRow);
  }

  async getUserPersonalBests(userId: number): Promise<UserPersonalBestAggregate[]> {
    const res = await this.db
      .prepare(
        `SELECT s.game_id, MIN(s.score) as min_score, MAX(s.score) as max_score
         FROM scores s
         JOIN games g ON g.slug = s.game_id
           AND g.deleted_at IS NULL
           AND g.leaderboard_generation = s.leaderboard_generation
         WHERE s.user_id = ? AND s.deleted_at IS NULL
         GROUP BY s.game_id`,
      )
      .bind(userId)
      .all<{ game_id: string; min_score: number; max_score: number }>();

    return res.results.map((row) => ({
      game_id: String(row.game_id),
      min_score: Number(row.min_score),
      max_score: Number(row.max_score),
    }));
  }
}
