import type {
  PublicRankingPlatformAccount,
  PublicRankingRepository,
  PublicRankingRow,
  PublicRankingScope,
  StreamerPlatformType,
} from "@owogg/core";
import type { D1Database } from "./D1UserRepository.js";

interface ScopeSql {
  join: string;
  platformClause: string;
  streamerSelect: string;
  platformBinds: string[];
}

function scopeSql(scope: PublicRankingScope, platform?: StreamerPlatformType): ScopeSql {
  if (scope === "general") {
    return {
      join: "",
      platformClause: "",
      streamerSelect: "NULL AS streamer_id",
      platformBinds: [],
    };
  }

  return {
    join: "JOIN streamer_profiles sp ON sp.user_id = u.id AND sp.status = 'VERIFIED'",
    platformClause: `AND EXISTS (
      SELECT 1 FROM streamer_platform_accounts spa
      WHERE spa.streamer_id = sp.id
        AND spa.verification_status = 'VERIFIED'
        AND spa.approval_status = 'APPROVED'
        AND spa.ownership_expires_at IS NOT NULL
        AND datetime(spa.ownership_expires_at) > datetime('now')
        AND spa.platform IN ('YOUTUBE', 'CHZZK', 'TWITCH')
        ${platform ? "AND spa.platform = ?" : ""}
    )`,
    streamerSelect: "sp.id AS streamer_id",
    platformBinds: platform ? [platform] : [],
  };
}

function mapRows(rows: Record<string, unknown>[]): PublicRankingRow[] {
  return rows.map((row, index) => ({
    rank: index + 1,
    userId: Number(row.user_id),
    nickname: String(row.nickname),
    avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
    country: row.country ? String(row.country) : null,
    value: Number(row.ranking_value),
    achievedAt: String(row.achieved_at),
    ...(row.game_id ? { gameId: String(row.game_id) } : {}),
    ...(row.variant_id ? { variantId: String(row.variant_id) } : {}),
    ...(row.streamer_id ? { streamerId: Number(row.streamer_id) } : {}),
    platformAccounts: [],
  }));
}

export class D1PublicRankingRepository implements PublicRankingRepository {
  constructor(private readonly db: D1Database) {}

  async getScoreRanking(input: {
    scope: PublicRankingScope;
    gameId: string;
    difficulty: string;
    rulesetRevision: number;
    direction: "asc" | "desc";
    startAt: string;
    endAt: string;
    platform?: StreamerPlatformType;
    limit: number;
  }): Promise<PublicRankingRow[]> {
    const scope = scopeSql(input.scope, input.platform);
    const order = input.direction === "asc" ? "ASC" : "DESC";
    const result = await this.db
      .prepare(
        `WITH eligible AS (
           SELECT s.id, s.user_id, s.game_id, s.score, s.variant_id, s.created_at,
                  u.nickname, u.avatar_url, u.country, ${scope.streamerSelect}
           FROM scores s
           JOIN users u ON u.id = s.user_id
           ${scope.join}
           JOIN games g ON g.slug = s.game_id
             AND g.deleted_at IS NULL
             AND g.leaderboard_generation = s.leaderboard_generation
           WHERE s.user_id IS NOT NULL
             AND s.game_id = ?
             AND s.difficulty = ?
             AND s.ruleset_revision = ?
             AND s.created_at >= ? AND s.created_at < ?
             AND s.deleted_at IS NULL
             ${scope.platformClause}
         ),
         personal_bests AS (
           SELECT *, ROW_NUMBER() OVER (
             PARTITION BY user_id
             ORDER BY score ${order}, created_at ASC, id ASC
           ) AS personal_rank
           FROM eligible
         )
         SELECT *, score AS ranking_value, created_at AS achieved_at
         FROM personal_bests
         WHERE personal_rank = 1
         ORDER BY score ${order}, created_at ASC, id ASC
         LIMIT ?`,
      )
      .bind(
        input.gameId,
        input.difficulty,
        input.rulesetRevision,
        input.startAt,
        input.endAt,
        ...scope.platformBinds,
        input.limit,
      )
      .all<Record<string, unknown>>();

    return this.withPlatforms(mapRows(result.results));
  }

  async getXpRanking(input: {
    scope: PublicRankingScope;
    startAt: string;
    endAt: string;
    platform?: StreamerPlatformType;
    limit: number;
  }): Promise<PublicRankingRow[]> {
    const scope = scopeSql(input.scope, input.platform);
    const result = await this.db
      .prepare(
        `SELECT xe.user_id, u.nickname, u.avatar_url, u.country, ${scope.streamerSelect},
                SUM(xe.amount) AS ranking_value, MAX(xe.created_at) AS achieved_at
         FROM xp_events xe
         JOIN users u ON u.id = xe.user_id
         ${scope.join}
         WHERE xe.amount > 0
           AND xe.created_at >= ? AND xe.created_at < ?
           ${scope.platformClause}
         GROUP BY xe.user_id, u.nickname, u.avatar_url, u.country${
           input.scope === "streamer" ? ", sp.id" : ""
         }
         ORDER BY ranking_value DESC, achieved_at ASC, xe.user_id ASC
         LIMIT ?`,
      )
      .bind(input.startAt, input.endAt, ...scope.platformBinds, input.limit)
      .all<Record<string, unknown>>();

    return this.withPlatforms(mapRows(result.results));
  }

  async getStreakRanking(input: {
    scope: PublicRankingScope;
    activeDates: readonly [string, string];
    platform?: StreamerPlatformType;
    limit: number;
  }): Promise<PublicRankingRow[]> {
    const scope = scopeSql(input.scope, input.platform);
    const result = await this.db
      .prepare(
        `SELECT u.id AS user_id, u.nickname, u.avatar_url, u.country, ${scope.streamerSelect},
                u.current_streak AS ranking_value, u.last_active_date AS achieved_at
         FROM users u
         ${scope.join}
         WHERE u.current_streak > 0
           AND u.last_active_date IN (?, ?)
           ${scope.platformClause}
         ORDER BY u.current_streak DESC, u.last_active_date ASC, u.id ASC
         LIMIT ?`,
      )
      .bind(...input.activeDates, ...scope.platformBinds, input.limit)
      .all<Record<string, unknown>>();

    return this.withPlatforms(mapRows(result.results));
  }

  private async withPlatforms(rows: PublicRankingRow[]): Promise<PublicRankingRow[]> {
    const streamerIds = rows.flatMap((row) =>
      row.streamerId === undefined ? [] : [row.streamerId],
    );
    if (streamerIds.length === 0) return rows;

    const placeholders = streamerIds.map(() => "?").join(",");
    const result = await this.db
      .prepare(
        `SELECT streamer_id, platform, channel_name, channel_url, avatar_url
         FROM streamer_platform_accounts
         WHERE verification_status = 'VERIFIED'
           AND approval_status = 'APPROVED'
           AND ownership_expires_at IS NOT NULL
           AND datetime(ownership_expires_at) > datetime('now')
           AND platform IN ('YOUTUBE', 'CHZZK', 'TWITCH')
           AND streamer_id IN (${placeholders})
         ORDER BY id ASC`,
      )
      .bind(...streamerIds)
      .all<Record<string, unknown>>();

    const accounts = new Map<number, PublicRankingPlatformAccount[]>();
    for (const row of result.results) {
      const streamerId = Number(row.streamer_id);
      const list = accounts.get(streamerId) ?? [];
      list.push({
        platform: String(row.platform) as StreamerPlatformType,
        channelName: String(row.channel_name),
        channelUrl: String(row.channel_url),
        avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
      });
      accounts.set(streamerId, list);
    }

    return rows.map((row) => ({
      ...row,
      platformAccounts: row.streamerId === undefined ? [] : (accounts.get(row.streamerId) ?? []),
    }));
  }
}
