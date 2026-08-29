import type {
  StreamerRepository,
  StreamerProfile,
  StreamerPlatformAccount,
  StreamerRankEntry,
  StreamerPlatformType,
  StreamerStatusType,
  FeaturedStatusType,
} from "@owogg/core";
import type { D1Database } from "./D1UserRepository.js";

function mapPlatformAccountRow(r: Record<string, unknown>): StreamerPlatformAccount {
  return {
    id: Number(r.id),
    streamerId: Number(r.streamer_id),
    platform: String(r.platform) as StreamerPlatformType,
    platformUserId: String(r.platform_user_id),
    channelName: String(r.channel_name),
    channelHandle: r.channel_handle ? String(r.channel_handle) : null,
    channelUrl: String(r.channel_url),
    avatarUrl: r.avatar_url ? String(r.avatar_url) : null,
    verificationStatus: String(r.verification_status),
    verifiedAt: r.verified_at ? String(r.verified_at) : null,
    // audience_count_known distinguishes "official API confirmed zero" from "never obtained" —
    // never coerce an unknown value to 0.
    audienceCount: Number(r.audience_count_known) === 1 ? Number(r.audience_count ?? 0) : null,
    channelCreatedAt: r.channel_created_at ? String(r.channel_created_at) : null,
    metricsSyncedAt: r.metrics_synced_at ? String(r.metrics_synced_at) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export class D1StreamerRepository implements StreamerRepository {
  constructor(private db: D1Database) {}

  async findProfileByUserId(
    userId: number,
  ): Promise<(StreamerProfile & { platformAccounts: StreamerPlatformAccount[] }) | null> {
    const row = await this.db
      .prepare(`SELECT * FROM streamer_profiles WHERE user_id = ?`)
      .bind(userId)
      .first<Record<string, unknown>>();

    if (!row) return null;

    const profile: StreamerProfile = {
      id: Number(row.id),
      userId: Number(row.user_id),
      status: String(row.status) as StreamerStatusType,
      featuredStatus: String(row.featured_status) as FeaturedStatusType,
      featuredReason: row.featured_reason ? String(row.featured_reason) : null,
      featuredSince: row.featured_since ? String(row.featured_since) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };

    const accRes = await this.db
      .prepare(`SELECT * FROM streamer_platform_accounts WHERE streamer_id = ? ORDER BY id ASC`)
      .bind(profile.id)
      .all<Record<string, unknown>>();

    const platformAccounts: StreamerPlatformAccount[] = (accRes.results || []).map(
      mapPlatformAccountRow,
    );

    return { ...profile, platformAccounts };
  }

  async findProfileById(
    streamerId: number,
  ): Promise<(StreamerProfile & { platformAccounts: StreamerPlatformAccount[] }) | null> {
    const row = await this.db
      .prepare(`SELECT * FROM streamer_profiles WHERE id = ?`)
      .bind(streamerId)
      .first<Record<string, unknown>>();

    if (!row) return null;

    const profile: StreamerProfile = {
      id: Number(row.id),
      userId: Number(row.user_id),
      status: String(row.status) as StreamerStatusType,
      featuredStatus: String(row.featured_status) as FeaturedStatusType,
      featuredReason: row.featured_reason ? String(row.featured_reason) : null,
      featuredSince: row.featured_since ? String(row.featured_since) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };

    const accRes = await this.db
      .prepare(`SELECT * FROM streamer_platform_accounts WHERE streamer_id = ? ORDER BY id ASC`)
      .bind(streamerId)
      .all<Record<string, unknown>>();

    const platformAccounts: StreamerPlatformAccount[] = (accRes.results || []).map(
      mapPlatformAccountRow,
    );

    return { ...profile, platformAccounts };
  }

  async findPlatformAccount(
    platform: StreamerPlatformType,
    platformUserId: string,
  ): Promise<StreamerPlatformAccount | null> {
    const row = await this.db
      .prepare(
        `SELECT * FROM streamer_platform_accounts WHERE platform = ? AND platform_user_id = ?`,
      )
      .bind(platform, platformUserId)
      .first<Record<string, unknown>>();

    if (!row) return null;
    return mapPlatformAccountRow(row);
  }

  async findPlatformAccountById(
    platformAccountId: number,
  ): Promise<StreamerPlatformAccount | null> {
    const row = await this.db
      .prepare(`SELECT * FROM streamer_platform_accounts WHERE id = ?`)
      .bind(platformAccountId)
      .first<Record<string, unknown>>();

    if (!row) return null;
    return mapPlatformAccountRow(row);
  }

  async updatePlatformAccountMetrics(
    platformAccountId: number,
    input: {
      audienceCount: number | null;
      channelCreatedAt: string | null;
      syncedAt: string;
    },
  ): Promise<StreamerPlatformAccount> {
    await this.db
      .prepare(
        `UPDATE streamer_platform_accounts
         SET audience_count = ?, audience_count_known = ?, channel_created_at = ?, metrics_synced_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        input.audienceCount,
        input.audienceCount !== null ? 1 : 0,
        input.channelCreatedAt,
        input.syncedAt,
        input.syncedAt,
        platformAccountId,
      )
      .run();

    const updated = await this.findPlatformAccountById(platformAccountId);
    if (!updated) throw new Error("Failed to update platform account metrics");
    return updated;
  }

  async upsertProfile(input: {
    userId: number;
    status: StreamerStatusType;
    featuredStatus?: FeaturedStatusType;
    featuredReason?: string | null;
  }): Promise<StreamerProfile> {
    const now = new Date().toISOString();
    const existing = await this.findProfileByUserId(input.userId);

    if (existing) {
      const featStatus = input.featuredStatus ?? existing.featuredStatus;
      const featSince =
        featStatus === "NONE"
          ? null
          : existing.featuredStatus === "NONE"
            ? now
            : existing.featuredSince;

      await this.db
        .prepare(
          `UPDATE streamer_profiles
           SET status = ?, featured_status = ?, featured_reason = ?, featured_since = ?, updated_at = ?
           WHERE user_id = ?`,
        )
        .bind(
          input.status,
          featStatus,
          input.featuredReason !== undefined ? input.featuredReason : existing.featuredReason,
          featSince,
          now,
          input.userId,
        )
        .run();

      return {
        id: existing.id,
        userId: input.userId,
        status: input.status,
        featuredStatus: featStatus,
        featuredReason:
          input.featuredReason !== undefined ? input.featuredReason : existing.featuredReason,
        featuredSince: featSince,
        createdAt: existing.createdAt,
        updatedAt: now,
      };
    }

    const featStatus = input.featuredStatus ?? "NONE";
    const featSince = featStatus !== "NONE" ? now : null;

    await this.db
      .prepare(
        `INSERT INTO streamer_profiles (user_id, status, featured_status, featured_reason, featured_since, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.userId,
        input.status,
        featStatus,
        input.featuredReason ?? null,
        featSince,
        now,
        now,
      )
      .run();

    const row = await this.db
      .prepare(`SELECT * FROM streamer_profiles WHERE rowid = last_insert_rowid()`)
      .first<Record<string, unknown>>();

    return {
      id: Number(row?.id ?? 0),
      userId: input.userId,
      status: input.status,
      featuredStatus: featStatus,
      featuredReason: input.featuredReason ?? null,
      featuredSince: featSince,
      createdAt: now,
      updatedAt: now,
    };
  }

  async addPlatformAccount(input: {
    streamerId: number;
    platform: StreamerPlatformType;
    platformUserId: string;
    channelName: string;
    channelHandle?: string | null;
    channelUrl: string;
    avatarUrl?: string | null;
    verificationStatus?: string;
  }): Promise<StreamerPlatformAccount> {
    return this.upsertPlatformAccount(input);
  }

  async upsertPlatformAccount(input: {
    streamerId: number;
    platform: StreamerPlatformType;
    platformUserId: string;
    channelName: string;
    channelHandle?: string | null;
    channelUrl: string;
    avatarUrl?: string | null;
    verificationStatus?: string;
    audienceCount?: number;
    channelCreatedAt?: string | null;
  }): Promise<StreamerPlatformAccount> {
    const now = new Date().toISOString();
    const verStatus = input.verificationStatus ?? "VERIFIED";
    const verAt = verStatus === "VERIFIED" ? now : null;
    const existing = await this.findPlatformAccount(input.platform, input.platformUserId);

    // A fresh provider response with no audience value must persist as UNKNOWN — never fall
    // back to a stale/previous value or coerce to a known zero.
    const audienceKnown = input.audienceCount !== undefined;
    const audienceValue = audienceKnown ? (input.audienceCount as number) : null;

    if (existing) {
      await this.db
        .prepare(
          `UPDATE streamer_platform_accounts
           SET streamer_id = ?, channel_name = ?, channel_handle = ?, channel_url = ?, avatar_url = ?,
               verification_status = ?, verified_at = ?, audience_count = ?, audience_count_known = ?,
               channel_created_at = ?, metrics_synced_at = ?, updated_at = ?
           WHERE platform = ? AND platform_user_id = ?`,
        )
        .bind(
          input.streamerId,
          input.channelName,
          input.channelHandle ?? null,
          input.channelUrl,
          input.avatarUrl ?? null,
          verStatus,
          verAt,
          audienceValue,
          audienceKnown ? 1 : 0,
          input.channelCreatedAt ?? existing.channelCreatedAt ?? null,
          now,
          now,
          input.platform,
          input.platformUserId,
        )
        .run();

      const updated = await this.findPlatformAccount(input.platform, input.platformUserId);
      if (updated) return updated;
    }

    await this.db
      .prepare(
        `INSERT INTO streamer_platform_accounts
         (streamer_id, platform, platform_user_id, channel_name, channel_handle, channel_url, avatar_url, verification_status, verified_at, audience_count, audience_count_known, channel_created_at, metrics_synced_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.streamerId,
        input.platform,
        input.platformUserId,
        input.channelName,
        input.channelHandle ?? null,
        input.channelUrl,
        input.avatarUrl ?? null,
        verStatus,
        verAt,
        audienceValue,
        audienceKnown ? 1 : 0,
        input.channelCreatedAt ?? null,
        now,
        now,
        now,
      )
      .run();

    const row = await this.db
      .prepare(`SELECT * FROM streamer_platform_accounts WHERE rowid = last_insert_rowid()`)
      .first<Record<string, unknown>>();

    if (row) return mapPlatformAccountRow(row);

    const created = await this.findPlatformAccount(input.platform, input.platformUserId);
    if (created) return created;

    throw new Error("Failed to insert platform account");
  }

  async getStreamerRankings(options: {
    mode: "score" | "xp";
    gameId?: string;
    direction?: "asc" | "desc";
    rulesetRevision?: number;
    platform?: StreamerPlatformType;
    limit?: number;
    offset?: number;
  }): Promise<{ entries: StreamerRankEntry[]; total: number }> {
    const limit = options.limit ?? 20;
    const offset = options.offset ?? 0;

    // EXISTS avoids joining streamer_platform_accounts directly onto the ranked row set, which
    // would duplicate a streamer's PB row once per matching platform account.
    //
    // Streamer ranking rule: a streamer qualifies once they have AT LEAST ONE ownership-VERIFIED
    // account on any supported platform (not all four). `cp.status = 'VERIFIED'` alone is never
    // trusted as the sole source of truth here — it can only ever legitimately be VERIFIED
    // because some platform account was verified, but this EXISTS check is what actually
    // guarantees it, defending against any future drift between the two.
    const platformFilterClause = options.platform
      ? `AND EXISTS (
           SELECT 1 FROM streamer_platform_accounts cpa
           WHERE cpa.streamer_id = cp.id AND cpa.platform = ? AND cpa.verification_status = 'VERIFIED'
         )`
      : `AND EXISTS (
           SELECT 1 FROM streamer_platform_accounts cpa
           WHERE cpa.streamer_id = cp.id AND cpa.verification_status = 'VERIFIED'
             AND cpa.platform IN ('YOUTUBE', 'CHZZK', 'SOOP', 'TWITCH')
         )`;

    if (options.mode === "score") {
      const selectedGameId = options.gameId && options.gameId !== "all" ? options.gameId : null;
      const orderClause = options.direction === "asc" ? "ASC" : "DESC";
      const gameFilterClause = selectedGameId ? `AND s.game_id = ? AND s.ruleset_revision = ?` : "";

      // One canonical PB row per eligible Streamer user is selected in SQL (ROW_NUMBER, before
      // LIMIT/OFFSET) so a single Streamer with hundreds of raw score rows can never crowd other
      // Streamers out of the page or corrupt the total count. Deterministic tie-break: score,
      // then earliest created_at, then row id.
      const rankedCte = `
        WITH eligible AS (
          SELECT s.id, s.user_id, s.game_id, s.score, s.created_at, cp.id AS streamer_id, cp.featured_status
          FROM scores s
          JOIN streamer_profiles cp ON cp.user_id = s.user_id
          JOIN games g ON g.slug = s.game_id
            AND g.deleted_at IS NULL
            AND g.leaderboard_generation = s.leaderboard_generation
          WHERE cp.status = 'VERIFIED' AND s.deleted_at IS NULL ${gameFilterClause} ${platformFilterClause}
        ),
        pb AS (
          SELECT *, ROW_NUMBER() OVER (
            PARTITION BY user_id
            ORDER BY score ${orderClause}, created_at ASC, id ASC
          ) AS rn
          FROM eligible
        )
        SELECT * FROM pb WHERE rn = 1
      `;

      const bindArgs: (string | number)[] = [];
      if (selectedGameId) {
        bindArgs.push(selectedGameId, options.rulesetRevision ?? 1);
      }
      if (options.platform) bindArgs.push(options.platform);

      const countQuery = `SELECT COUNT(*) as total FROM (${rankedCte})`;
      const countRow = await this.db
        .prepare(countQuery)
        .bind(...bindArgs)
        .first<{ total: number }>();
      const total = countRow?.total ?? 0;

      const dataQuery = `
        SELECT * FROM (${rankedCte})
        ORDER BY score ${orderClause}, created_at ASC, user_id ASC
        LIMIT ? OFFSET ?
      `;
      const res = await this.db
        .prepare(dataQuery)
        .bind(...bindArgs, limit, offset)
        .all<Record<string, unknown>>();
      const page = res.results || [];

      const userIds = page.map((r) => Number(r.user_id));
      const streamerIds = page.map((r) => Number(r.streamer_id));
      const [profileMap, platformMap] = await Promise.all([
        this.loadUsersByIds(userIds),
        this.loadPlatformsForStreamers(streamerIds),
      ]);

      const entries: StreamerRankEntry[] = page.map((row, idx) => {
        const gId = String(row.game_id);
        const userId = Number(row.user_id);
        const profile = profileMap.get(userId);

        return {
          userId,
          nickname: profile?.nickname ?? "",
          avatarUrl: profile?.avatarUrl ?? null,
          country: profile?.country ?? null,
          streamerId: Number(row.streamer_id),
          featuredStatus: String(row.featured_status) as FeaturedStatusType,
          platformAccounts: platformMap.get(Number(row.streamer_id)) || [],
          score: Number(row.score),
          gameId: gId,
          rank: offset + idx + 1,
        };
      });

      return { entries, total };
    } else {
      // Mode === "xp"
      const countQuery = `
        SELECT COUNT(DISTINCT cp.user_id) as total
        FROM streamer_profiles cp
        JOIN user_progress up ON up.user_id = cp.user_id
        WHERE cp.status = 'VERIFIED' ${platformFilterClause}
      `;

      const countStmt = options.platform
        ? this.db.prepare(countQuery).bind(options.platform)
        : this.db.prepare(countQuery);

      const countRow = await countStmt.first<{ total: number }>();
      const total = countRow?.total ?? 0;

      const dataQuery = `
        SELECT cp.user_id, u.nickname, u.avatar_url, u.country, up.total_xp,
               cp.id as streamer_id, cp.featured_status
        FROM streamer_profiles cp
        JOIN users u ON u.id = cp.user_id
        JOIN user_progress up ON up.user_id = cp.user_id
        WHERE cp.status = 'VERIFIED' ${platformFilterClause}
        ORDER BY up.total_xp DESC, cp.user_id ASC
        LIMIT ? OFFSET ?
      `;

      const dataStmt = options.platform
        ? this.db.prepare(dataQuery).bind(options.platform, limit, offset)
        : this.db.prepare(dataQuery).bind(limit, offset);

      const res = await dataStmt.all<Record<string, unknown>>();
      const page = res.results || [];

      const streamerIds = page.map((r) => Number(r.streamer_id));
      const platformMap = await this.loadPlatformsForStreamers(streamerIds);

      const entries: StreamerRankEntry[] = page.map((row, idx) => {
        const item = row;
        const totalXp = Number(item.total_xp);

        return {
          userId: Number(item.user_id),
          nickname: String(item.nickname),
          avatarUrl: item.avatar_url ? String(item.avatar_url) : null,
          country: item.country ? String(item.country) : null,
          streamerId: Number(item.streamer_id),
          featuredStatus: String(item.featured_status) as FeaturedStatusType,
          platformAccounts: platformMap.get(Number(item.streamer_id)) || [],
          totalXp,
          rank: offset + idx + 1,
        };
      });

      return { entries, total };
    }
  }

  private async loadPlatformsForStreamers(streamerIds: number[]): Promise<
    Map<
      number,
      Array<{
        platform: StreamerPlatformType;
        channelName: string;
        channelUrl: string;
        avatarUrl: string | null;
      }>
    >
  > {
    const map = new Map<
      number,
      Array<{
        platform: StreamerPlatformType;
        channelName: string;
        channelUrl: string;
        avatarUrl: string | null;
      }>
    >();

    if (streamerIds.length === 0) return map;

    const placeholders = streamerIds.map(() => "?").join(",");
    const query = `
      SELECT streamer_id, platform, channel_name, channel_url, avatar_url
      FROM streamer_platform_accounts
      WHERE verification_status = 'VERIFIED' AND streamer_id IN (${placeholders})
      ORDER BY id ASC
    `;

    const res = await this.db
      .prepare(query)
      .bind(...streamerIds)
      .all<Record<string, unknown>>();

    for (const r of res.results || []) {
      const cId = Number(r.streamer_id);
      const list = map.get(cId) ?? [];
      list.push({
        platform: String(r.platform) as StreamerPlatformType,
        channelName: String(r.channel_name),
        channelUrl: String(r.channel_url),
        avatarUrl: r.avatar_url ? String(r.avatar_url) : null,
      });
      map.set(cId, list);
    }

    return map;
  }

  private async loadUsersByIds(
    userIds: number[],
  ): Promise<Map<number, { nickname: string; avatarUrl: string | null; country: string | null }>> {
    const map = new Map<
      number,
      { nickname: string; avatarUrl: string | null; country: string | null }
    >();
    if (userIds.length === 0) return map;

    const placeholders = userIds.map(() => "?").join(",");
    const res = await this.db
      .prepare(`SELECT id, nickname, avatar_url, country FROM users WHERE id IN (${placeholders})`)
      .bind(...userIds)
      .all<Record<string, unknown>>();

    for (const r of res.results || []) {
      map.set(Number(r.id), {
        nickname: String(r.nickname),
        avatarUrl: r.avatar_url ? String(r.avatar_url) : null,
        country: r.country ? String(r.country) : null,
      });
    }
    return map;
  }
}
