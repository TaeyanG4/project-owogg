import type {
  DiscordGuild,
  DiscordGuildRepository,
  DiscordGuildVisibility,
  DiscordGuildRegistrationStatus,
  DiscordCandidateGuild,
  DiscordRegistrationChallenge,
  DiscordPlayContext,
  DiscordGuildXpEvent,
  GuildXpLeaderboardEntry,
  GlobalGuildRankEntry,
  ServerGameLeaderboardEntry,
  GuildSummaryData,
} from "@owogg/core";
import type { D1Database } from "./D1UserRepository.js";

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function generateRandomToken(): string {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function mapGuildRow(row: Record<string, unknown>): DiscordGuild {
  return {
    guild_id: String(row.guild_id),
    slug: String(row.slug),
    name: String(row.name),
    icon_url: row.icon_url ? String(row.icon_url) : null,
    description: row.description ? String(row.description) : null,
    visibility: String(row.visibility) as DiscordGuildVisibility,
    registration_status: String(row.registration_status) as DiscordGuildRegistrationStatus,
    registered_by_user_id: Number(row.registered_by_user_id),
    registered_at: String(row.registered_at),
    first_seen_at: String(row.first_seen_at),
    last_seen_at: String(row.last_seen_at),
    updated_at: String(row.updated_at),
  };
}

export class D1DiscordGuildRepository implements DiscordGuildRepository {
  constructor(private db: D1Database) {}

  async createRegistrationChallenge(input: {
    userId: number;
    manageableGuilds: DiscordCandidateGuild[];
    ttlSeconds?: number;
  }): Promise<{ token: string; expiresAt: string }> {
    const token = generateRandomToken();
    const tokenHash = await hashToken(token);
    const createdAt = new Date().toISOString();
    const ttl = input.ttlSeconds ?? 900; // default 15 mins
    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
    const jsonStr = JSON.stringify(input.manageableGuilds);

    await this.db
      .prepare(
        `INSERT INTO discord_server_registration_challenges (token_hash, user_id, manageable_guilds_json, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(tokenHash, input.userId, jsonStr, createdAt, expiresAt)
      .run();

    return { token, expiresAt };
  }

  async findRegistrationChallengeByToken(
    token: string,
  ): Promise<DiscordRegistrationChallenge | null> {
    const tokenHash = await hashToken(token);
    const row = await this.db
      .prepare(
        `SELECT token_hash, user_id, manageable_guilds_json, created_at, expires_at, consumed_at
         FROM discord_server_registration_challenges WHERE token_hash = ?`,
      )
      .bind(tokenHash)
      .first<Record<string, unknown>>();

    if (!row) return null;

    let manageableGuilds: DiscordCandidateGuild[] = [];
    try {
      manageableGuilds = JSON.parse(String(row.manageable_guilds_json)) as DiscordCandidateGuild[];
    } catch {
      manageableGuilds = [];
    }

    return {
      tokenHash: String(row.token_hash),
      userId: Number(row.user_id),
      manageableGuilds,
      createdAt: String(row.created_at),
      expiresAt: String(row.expires_at),
      consumedAt: row.consumed_at ? String(row.consumed_at) : null,
    };
  }

  async consumeRegistrationChallengeByToken(token: string): Promise<void> {
    const tokenHash = await hashToken(token);
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `UPDATE discord_server_registration_challenges SET consumed_at = ? WHERE token_hash = ?`,
      )
      .bind(now, tokenHash)
      .run();
  }

  async registerGuild(input: {
    guildId: string;
    slug: string;
    name: string;
    iconUrl?: string | null;
    description?: string | null;
    visibility: DiscordGuildVisibility;
    userId: number;
  }): Promise<DiscordGuild> {
    const now = new Date().toISOString();
    const iconUrl = input.iconUrl ?? null;
    const description = input.description ?? null;

    const stmtGuild = this.db
      .prepare(
        `INSERT INTO discord_guilds (
        guild_id, slug, name, icon_url, description, visibility, registration_status,
        registered_by_user_id, registered_at, first_seen_at, last_seen_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.guildId,
        input.slug,
        input.name,
        iconUrl,
        description,
        input.visibility,
        input.userId,
        now,
        now,
        now,
        now,
      );

    const stmtManager = this.db
      .prepare(
        `INSERT INTO discord_guild_managers (guild_id, user_id, role, created_at, updated_at)
       VALUES (?, ?, 'OWNER', ?, ?)`,
      )
      .bind(input.guildId, input.userId, now, now);

    await this.db.batch([stmtGuild, stmtManager]);

    const created = await this.findByGuildId(input.guildId);
    if (!created) {
      throw new Error("Failed to create guild row");
    }
    return created;
  }

  async findByGuildId(guildId: string): Promise<DiscordGuild | null> {
    const row = await this.db
      .prepare(`SELECT * FROM discord_guilds WHERE guild_id = ?`)
      .bind(guildId)
      .first<Record<string, unknown>>();

    if (!row) return null;
    return mapGuildRow(row);
  }

  async findBySlug(slug: string): Promise<DiscordGuild | null> {
    const row = await this.db
      .prepare(`SELECT * FROM discord_guilds WHERE slug = ?`)
      .bind(slug)
      .first<Record<string, unknown>>();

    if (!row) return null;
    return mapGuildRow(row);
  }

  async updateGuild(
    guildId: string,
    updates: {
      slug?: string;
      description?: string | null;
      visibility?: DiscordGuildVisibility;
      registrationStatus?: DiscordGuildRegistrationStatus;
      name?: string;
      iconUrl?: string | null;
    },
  ): Promise<DiscordGuild> {
    const fields: string[] = [];
    const values: unknown[] = [];
    const now = new Date().toISOString();

    if (updates.slug !== undefined) {
      fields.push("slug = ?");
      values.push(updates.slug);
    }
    if (updates.name !== undefined) {
      fields.push("name = ?");
      values.push(updates.name);
    }
    if (updates.iconUrl !== undefined) {
      fields.push("icon_url = ?");
      values.push(updates.iconUrl);
    }
    if (updates.description !== undefined) {
      fields.push("description = ?");
      values.push(updates.description);
    }
    if (updates.visibility !== undefined) {
      fields.push("visibility = ?");
      values.push(updates.visibility);
    }
    if (updates.registrationStatus !== undefined) {
      fields.push("registration_status = ?");
      values.push(updates.registrationStatus);
    }

    fields.push("updated_at = ?");
    values.push(now);
    fields.push("last_seen_at = ?");
    values.push(now);

    values.push(guildId);

    const query = `UPDATE discord_guilds SET ${fields.join(", ")} WHERE guild_id = ?`;
    await this.db
      .prepare(query)
      .bind(...values)
      .run();

    const updated = await this.findByGuildId(guildId);
    if (!updated) {
      throw new Error("Guild not found after update");
    }
    return updated;
  }

  async searchPublicGuilds(
    query?: string,
    limit = 20,
    offset = 0,
  ): Promise<{ guilds: DiscordGuild[]; total: number }> {
    const trimmedQuery = query?.trim().toLowerCase() ?? "";

    if (trimmedQuery) {
      const searchPattern = `%${escapeLike(trimmedQuery)}%`;

      const countRow = await this.db
        .prepare(
          `SELECT COUNT(*) as total FROM discord_guilds
           WHERE visibility = 'PUBLIC' AND registration_status = 'ACTIVE'
            AND (LOWER(name) LIKE ? ESCAPE '\\' OR LOWER(slug) LIKE ? ESCAPE '\\')`,
        )
        .bind(searchPattern, searchPattern)
        .first<{ total: number }>();

      const rows = await this.db
        .prepare(
          `SELECT * FROM discord_guilds
           WHERE visibility = 'PUBLIC' AND registration_status = 'ACTIVE'
            AND (LOWER(name) LIKE ? ESCAPE '\\' OR LOWER(slug) LIKE ? ESCAPE '\\')
           ORDER BY name ASC LIMIT ? OFFSET ?`,
        )
        .bind(searchPattern, searchPattern, limit, offset)
        .all<Record<string, unknown>>();

      const guilds = (rows.results || []).map(mapGuildRow);
      return { guilds, total: countRow?.total ?? guilds.length };
    }

    const countRow = await this.db
      .prepare(
        `SELECT COUNT(*) as total FROM discord_guilds
         WHERE visibility = 'PUBLIC' AND registration_status = 'ACTIVE'`,
      )
      .first<{ total: number }>();

    const rows = await this.db
      .prepare(
        `SELECT * FROM discord_guilds
         WHERE visibility = 'PUBLIC' AND registration_status = 'ACTIVE'
         ORDER BY name ASC LIMIT ? OFFSET ?`,
      )
      .bind(limit, offset)
      .all<Record<string, unknown>>();

    const guilds = (rows.results || []).map(mapGuildRow);
    return { guilds, total: countRow?.total ?? guilds.length };
  }

  async isGuildManager(guildId: string, userId: number): Promise<boolean> {
    const row = await this.db
      .prepare(`SELECT 1 FROM discord_guild_managers WHERE guild_id = ? AND user_id = ?`)
      .bind(guildId, userId)
      .first();

    return Boolean(row);
  }

  async addGuildManager(guildId: string, userId: number, role = "MANAGER"): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO discord_guild_managers (guild_id, user_id, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(guildId, userId, role, now, now)
      .run();
  }

  async getUserManagedGuilds(userId: number): Promise<DiscordGuild[]> {
    const rows = await this.db
      .prepare(
        `SELECT g.* FROM discord_guilds g
         JOIN discord_guild_managers m ON g.guild_id = m.guild_id
         WHERE m.user_id = ? AND g.registration_status = 'ACTIVE'
         ORDER BY g.name ASC`,
      )
      .bind(userId)
      .all<Record<string, unknown>>();

    return (rows.results || []).map(mapGuildRow);
  }

  async getActiveGuildCount(): Promise<number> {
    const row = await this.db
      .prepare(`SELECT COUNT(*) AS total FROM discord_guilds WHERE registration_status = 'ACTIVE'`)
      .first<{ total: number }>();
    return Number(row?.total ?? 0);
  }

  async createPlayContext(input: {
    guildId: string;
    discordUserId: string;
    userId: number;
    gameId?: string | null;
    ttlSeconds?: number;
  }): Promise<{ token: string; expiresAt: string }> {
    const token = generateRandomToken();
    const tokenHash = await hashToken(token);
    const createdAt = new Date().toISOString();
    const ttl = input.ttlSeconds ?? 900; // default 15 mins
    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
    const gameId = input.gameId ?? null;

    await this.db
      .prepare(
        `INSERT INTO discord_play_contexts (token_hash, guild_id, discord_user_id, user_id, game_id, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        tokenHash,
        input.guildId,
        input.discordUserId,
        input.userId,
        gameId,
        createdAt,
        expiresAt,
      )
      .run();

    return { token, expiresAt };
  }

  async findPlayContextByToken(token: string): Promise<DiscordPlayContext | null> {
    const tokenHash = await hashToken(token);
    const row = await this.db
      .prepare(
        `SELECT token_hash, guild_id, discord_user_id, user_id, game_id, created_at, expires_at, consumed_at
         FROM discord_play_contexts WHERE token_hash = ?`,
      )
      .bind(tokenHash)
      .first<Record<string, unknown>>();

    if (!row) return null;

    return {
      tokenHash: String(row.token_hash),
      guildId: String(row.guild_id),
      discordUserId: String(row.discord_user_id),
      userId: Number(row.user_id),
      gameId: row.game_id ? String(row.game_id) : null,
      createdAt: String(row.created_at),
      expiresAt: String(row.expires_at),
      consumedAt: row.consumed_at ? String(row.consumed_at) : null,
    };
  }

  async consumePlayContextByToken(token: string): Promise<void> {
    const tokenHash = await hashToken(token);
    const now = new Date().toISOString();
    await this.db
      .prepare(`UPDATE discord_play_contexts SET consumed_at = ? WHERE token_hash = ?`)
      .bind(now, tokenHash)
      .run();
  }

  async attributeGuildXp(input: {
    guildId: string;
    userId: number;
    sourceXpEventId: number;
    amount: number;
  }): Promise<DiscordGuildXpEvent | null> {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO discord_guild_xp_events (guild_id, user_id, source_xp_event_id, amount, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(input.guildId, input.userId, input.sourceXpEventId, input.amount, now)
      .run();

    const row = await this.db
      .prepare(`SELECT * FROM discord_guild_xp_events WHERE source_xp_event_id = ?`)
      .bind(input.sourceXpEventId)
      .first<Record<string, unknown>>();

    if (!row) return null;
    return {
      id: Number(row.id),
      guildId: String(row.guild_id),
      userId: Number(row.user_id),
      sourceXpEventId: Number(row.source_xp_event_id),
      amount: Number(row.amount),
      createdAt: String(row.created_at),
    };
  }

  async getGuildUserXp(guildId: string, userId: number): Promise<number> {
    const row = await this.db
      .prepare(
        `SELECT SUM(amount) as total FROM discord_guild_xp_events WHERE guild_id = ? AND user_id = ?`,
      )
      .bind(guildId, userId)
      .first<{ total: number | null }>();

    return row?.total ?? 0;
  }

  async getGuildTotalXp(guildId: string): Promise<number> {
    const row = await this.db
      .prepare(`SELECT SUM(amount) as total FROM discord_guild_xp_events WHERE guild_id = ?`)
      .bind(guildId)
      .first<{ total: number | null }>();

    return row?.total ?? 0;
  }

  async getGuildXpLeaderboard(
    guildId: string,
    startOfWeekIso?: string,
    limit = 20,
    offset = 0,
  ): Promise<{ entries: GuildXpLeaderboardEntry[]; total: number }> {
    const hasWeekFilter = Boolean(startOfWeekIso);

    const countQuery = hasWeekFilter
      ? `SELECT COUNT(DISTINCT user_id) as total FROM discord_guild_xp_events WHERE guild_id = ? AND created_at >= ?`
      : `SELECT COUNT(DISTINCT user_id) as total FROM discord_guild_xp_events WHERE guild_id = ?`;

    const countStmt = hasWeekFilter
      ? this.db.prepare(countQuery).bind(guildId, startOfWeekIso)
      : this.db.prepare(countQuery).bind(guildId);

    const countRow = await countStmt.first<{ total: number }>();
    const total = countRow?.total ?? 0;

    const dataQuery = hasWeekFilter
      ? `SELECT e.user_id, u.nickname, u.avatar_url, SUM(e.amount) as xp
         FROM discord_guild_xp_events e
         JOIN users u ON u.id = e.user_id
         WHERE e.guild_id = ? AND e.created_at >= ?
         GROUP BY e.user_id
         ORDER BY xp DESC, e.user_id ASC
         LIMIT ? OFFSET ?`
      : `SELECT e.user_id, u.nickname, u.avatar_url, SUM(e.amount) as xp
         FROM discord_guild_xp_events e
         JOIN users u ON u.id = e.user_id
         WHERE e.guild_id = ?
         GROUP BY e.user_id
         ORDER BY xp DESC, e.user_id ASC
         LIMIT ? OFFSET ?`;

    const dataStmt = hasWeekFilter
      ? this.db.prepare(dataQuery).bind(guildId, startOfWeekIso, limit, offset)
      : this.db.prepare(dataQuery).bind(guildId, limit, offset);

    const res = await dataStmt.all<Record<string, unknown>>();

    const entries: GuildXpLeaderboardEntry[] = (res.results || []).map((row, idx) => ({
      userId: Number(row.user_id),
      nickname: String(row.nickname),
      avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
      xp: Number(row.xp),
      rank: offset + idx + 1,
    }));

    return { entries, total };
  }

  async getGuildSummary(guildId: string, startOfWeekIso: string): Promise<GuildSummaryData> {
    const row = await this.db
      .prepare(
        `SELECT
           COALESCE(SUM(amount), 0) as total_xp,
           COALESCE(SUM(CASE WHEN created_at >= ? THEN amount ELSE 0 END), 0) as weekly_xp,
           COUNT(DISTINCT user_id) as participant_count
         FROM discord_guild_xp_events
         WHERE guild_id = ?`,
      )
      .bind(startOfWeekIso, guildId)
      .first<{ total_xp: number; weekly_xp: number; participant_count: number }>();

    return {
      totalXp: Number(row?.total_xp ?? 0),
      weeklyXp: Number(row?.weekly_xp ?? 0),
      participantCount: Number(row?.participant_count ?? 0),
    };
  }

  async getGlobalGuildActivityRanking(
    startOfWeekIso?: string,
    limit = 20,
    offset = 0,
  ): Promise<{ guilds: GlobalGuildRankEntry[]; total: number }> {
    const countRow = await this.db
      .prepare(
        `SELECT COUNT(*) as total FROM discord_guilds
         WHERE visibility = 'PUBLIC' AND registration_status = 'ACTIVE'`,
      )
      .first<{ total: number }>();

    const total = countRow?.total ?? 0;

    const hasWeekFilter = Boolean(startOfWeekIso);
    const orderCol = hasWeekFilter ? "weekly_xp" : "total_xp";

    const query = `
      SELECT
        g.guild_id, g.slug, g.name, g.icon_url,
        COALESCE(SUM(e.amount), 0) as total_xp,
        COALESCE(SUM(CASE WHEN e.created_at >= ? THEN e.amount ELSE 0 END), 0) as weekly_xp,
        COUNT(DISTINCT e.user_id) as participant_count
      FROM discord_guilds g
      LEFT JOIN discord_guild_xp_events e ON e.guild_id = g.guild_id
      WHERE g.visibility = 'PUBLIC' AND g.registration_status = 'ACTIVE'
      GROUP BY g.guild_id
      ORDER BY ${orderCol} DESC, g.guild_id ASC
      LIMIT ? OFFSET ?
    `;

    const res = await this.db
      .prepare(query)
      .bind(startOfWeekIso ?? "", limit, offset)
      .all<Record<string, unknown>>();

    const guilds: GlobalGuildRankEntry[] = (res.results || []).map((row, idx) => ({
      guildId: String(row.guild_id),
      slug: String(row.slug),
      name: String(row.name),
      iconUrl: row.icon_url ? String(row.icon_url) : null,
      totalXp: Number(row.total_xp),
      weeklyXp: Number(row.weekly_xp),
      participantCount: Number(row.participant_count),
      rank: offset + idx + 1,
    }));

    return { guilds, total };
  }

  async getGuildGameLeaderboard(
    guildId: string,
    gameId: string,
    direction: "asc" | "desc" = "desc",
    limit = 20,
  ): Promise<ServerGameLeaderboardEntry[]> {
    const orderClause = direction === "asc" ? "ASC" : "DESC";

    const query = `
      SELECT s.id, s.user_id, u.nickname, u.avatar_url, s.game_id, s.score, s.created_at
      FROM scores s
      JOIN users u ON u.id = s.user_id
      JOIN games g ON g.slug = s.game_id
        AND g.deleted_at IS NULL
        AND g.leaderboard_generation = s.leaderboard_generation
      WHERE s.user_id IS NOT NULL AND s.game_id = ? AND s.deleted_at IS NULL
        AND s.user_id IN (SELECT DISTINCT user_id FROM discord_guild_xp_events WHERE guild_id = ?)
      ORDER BY s.score ${orderClause}, s.created_at ASC
      LIMIT 100
    `;

    const res = await this.db.prepare(query).bind(gameId, guildId).all<Record<string, unknown>>();

    const seen = new Set<number>();
    const leaderboard: ServerGameLeaderboardEntry[] = [];

    for (const row of res.results || []) {
      const userId = Number(row.user_id);
      if (isNaN(userId) || seen.has(userId)) continue;
      seen.add(userId);

      leaderboard.push({
        id: Number(row.id),
        userId,
        nickname: String(row.nickname),
        avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
        gameId: String(row.game_id),
        score: Number(row.score),
        formattedScore: String(row.score),
        createdAt: String(row.created_at),
      });

      if (leaderboard.length >= limit) break;
    }

    return leaderboard;
  }

  async getGuildUserXpRank(
    guildId: string,
    userId: number,
    startOfWeekIso?: string,
  ): Promise<{ totalXp: number; rank: number | null }> {
    const hasWeekFilter = Boolean(startOfWeekIso);

    const userXpQuery = hasWeekFilter
      ? `SELECT SUM(amount) as xp FROM discord_guild_xp_events WHERE guild_id = ? AND user_id = ? AND created_at >= ?`
      : `SELECT SUM(amount) as xp FROM discord_guild_xp_events WHERE guild_id = ? AND user_id = ?`;

    const userXpStmt = hasWeekFilter
      ? this.db.prepare(userXpQuery).bind(guildId, userId, startOfWeekIso)
      : this.db.prepare(userXpQuery).bind(guildId, userId);

    const userXpRow = await userXpStmt.first<{ xp: number | null }>();
    const totalXp = userXpRow?.xp ?? 0;

    if (totalXp <= 0) {
      return { totalXp: 0, rank: null };
    }

    const allUsersQuery = hasWeekFilter
      ? `SELECT user_id, SUM(amount) as xp FROM discord_guild_xp_events WHERE guild_id = ? AND created_at >= ? GROUP BY user_id ORDER BY xp DESC, user_id ASC`
      : `SELECT user_id, SUM(amount) as xp FROM discord_guild_xp_events WHERE guild_id = ? GROUP BY user_id ORDER BY xp DESC, user_id ASC`;

    const allUsersStmt = hasWeekFilter
      ? this.db.prepare(allUsersQuery).bind(guildId, startOfWeekIso)
      : this.db.prepare(allUsersQuery).bind(guildId);

    const res = await allUsersStmt.all<Record<string, unknown>>();

    const rows = res.results || [];
    let rank: number | null = null;
    for (let idx = 0; idx < rows.length; idx++) {
      const item = rows[idx];
      if (item && Number(item.user_id) === userId) {
        rank = idx + 1;
        break;
      }
    }

    return { totalXp, rank };
  }
}
