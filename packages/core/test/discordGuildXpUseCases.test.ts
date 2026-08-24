import test from "node:test";
import assert from "node:assert/strict";
import {
  DiscordGuildXpUseCases,
  ProgressionUseCases,
  getStartOfWeekKst,
  type DiscordGuildRepository,
  type UserRepository,
  type ProgressionRepository,
  type DiscordGuild,
  type DiscordPlayContext,
  type DiscordGuildXpEvent,
  type User,
  type OAuthAccount,
  type RecordCompletionOutcome,
  type UserProgress,
  type XpLeaderboardEntry,
  type GuildXpLeaderboardEntry,
  type GlobalGuildRankEntry,
  type ServerGameLeaderboardEntry,
  type GuildSummaryData,
  type PublicGameCatalog,
} from "../src/index.js";
import { runtimeGameFixture, TEST_GAME_SLUGS } from "./runtimeGameFixture.js";

const games: PublicGameCatalog = {
  async findBySlug(slug) {
    return TEST_GAME_SLUGS.includes(slug as (typeof TEST_GAME_SLUGS)[number])
      ? runtimeGameFixture(slug)
      : null;
  },
  async list() {
    return TEST_GAME_SLUGS.map((slug) => runtimeGameFixture(slug));
  },
};

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

class MockDiscordGuildRepo implements DiscordGuildRepository {
  public guilds: Map<string, DiscordGuild> = new Map();
  public playContexts: Map<string, DiscordPlayContext> = new Map();
  public guildXpEvents: DiscordGuildXpEvent[] = [];
  public managers: Map<string, Set<number>> = new Map();
  public scores: {
    id: number;
    userId: number;
    gameId: string;
    score: number;
    createdAt: string;
  }[] = [];
  private nextXpEventId = 1;

  async createPlayContext(input: {
    guildId: string;
    discordUserId: string;
    userId: number;
    gameId?: string | null;
    ttlSeconds?: number;
  }): Promise<{ token: string; expiresAt: string }> {
    const token = "mock_raw_play_token_" + Math.random().toString(36).substring(2);
    const tokenHash = await hashToken(token);
    const ttl = input.ttlSeconds ?? 900;
    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

    const ctx: DiscordPlayContext = {
      tokenHash,
      guildId: input.guildId,
      discordUserId: input.discordUserId,
      userId: input.userId,
      gameId: input.gameId ?? null,
      createdAt: new Date().toISOString(),
      expiresAt,
      consumedAt: null,
    };
    this.playContexts.set(tokenHash, ctx);
    return { token, expiresAt };
  }

  async findPlayContextByToken(token: string): Promise<DiscordPlayContext | null> {
    const tokenHash = await hashToken(token);
    return this.playContexts.get(tokenHash) ?? null;
  }

  async consumePlayContextByToken(token: string): Promise<void> {
    const tokenHash = await hashToken(token);
    const ctx = this.playContexts.get(tokenHash);
    if (ctx) {
      ctx.consumedAt = new Date().toISOString();
    }
  }

  async attributeGuildXp(input: {
    guildId: string;
    userId: number;
    sourceXpEventId: number;
    amount: number;
  }): Promise<DiscordGuildXpEvent | null> {
    const existing = this.guildXpEvents.find((e) => e.sourceXpEventId === input.sourceXpEventId);
    if (existing) {
      return existing;
    }

    const evt: DiscordGuildXpEvent = {
      id: this.nextXpEventId++,
      guildId: input.guildId,
      userId: input.userId,
      sourceXpEventId: input.sourceXpEventId,
      amount: input.amount,
      createdAt: new Date().toISOString(),
    };
    this.guildXpEvents.push(evt);
    return evt;
  }

  async getGuildUserXp(guildId: string, userId: number): Promise<number> {
    return this.guildXpEvents
      .filter((e) => e.guildId === guildId && e.userId === userId)
      .reduce((sum, e) => sum + e.amount, 0);
  }

  async getGuildTotalXp(guildId: string): Promise<number> {
    return this.guildXpEvents
      .filter((e) => e.guildId === guildId)
      .reduce((sum, e) => sum + e.amount, 0);
  }

  async findByGuildId(guildId: string): Promise<DiscordGuild | null> {
    return this.guilds.get(guildId) ?? null;
  }

  async findBySlug(slug: string): Promise<DiscordGuild | null> {
    for (const g of this.guilds.values()) {
      if (g.slug === slug) return g;
    }
    return null;
  }

  async createRegistrationChallenge(): Promise<{ token: string; expiresAt: string }> {
    throw new Error("Not implemented in mock");
  }
  async findRegistrationChallengeByToken(): Promise<null> {
    return null;
  }
  async consumeRegistrationChallengeByToken(): Promise<void> {}
  async registerGuild(input: any): Promise<DiscordGuild> {
    const g: DiscordGuild = {
      guild_id: input.guildId,
      slug: input.slug,
      name: input.name,
      icon_url: input.iconUrl ?? null,
      description: input.description ?? null,
      visibility: input.visibility,
      registration_status: "ACTIVE",
      registered_by_user_id: input.userId,
      registered_at: new Date().toISOString(),
      first_seen_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.guilds.set(input.guildId, g);
    return g;
  }
  async updateGuild(): Promise<DiscordGuild> {
    throw new Error("Not implemented in mock");
  }
  async searchPublicGuilds(): Promise<{ guilds: DiscordGuild[]; total: number }> {
    return { guilds: Array.from(this.guilds.values()), total: this.guilds.size };
  }
  async isGuildManager(guildId: string, userId: number): Promise<boolean> {
    return this.managers.get(guildId)?.has(userId) ?? false;
  }
  async addGuildManager(guildId: string, userId: number): Promise<void> {
    if (!this.managers.has(guildId)) this.managers.set(guildId, new Set());
    this.managers.get(guildId)!.add(userId);
  }
  async getUserManagedGuilds(): Promise<DiscordGuild[]> {
    return [];
  }
  async getActiveGuildCount(): Promise<number> {
    return Array.from(this.guilds.values()).filter((g) => g.registration_status === "ACTIVE")
      .length;
  }

  // Phase H2 Query Mock Methods
  async getGuildXpLeaderboard(
    guildId: string,
    startOfWeekIso?: string,
    limit = 20,
    offset = 0,
  ): Promise<{ entries: GuildXpLeaderboardEntry[]; total: number }> {
    let events = this.guildXpEvents.filter((e) => e.guildId === guildId);
    if (startOfWeekIso) {
      events = events.filter((e) => e.createdAt >= startOfWeekIso);
    }

    const map = new Map<number, number>();
    for (const e of events) {
      map.set(e.userId, (map.get(e.userId) ?? 0) + e.amount);
    }

    const sorted = Array.from(map.entries()).sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0] - b[0]; // deterministic user_id ASC
    });

    const total = sorted.length;
    const page = sorted.slice(offset, offset + limit);

    const entries: GuildXpLeaderboardEntry[] = page.map(([uId, xp], idx) => ({
      userId: uId,
      nickname: `User_${uId}`,
      avatarUrl: null,
      xp,
      rank: offset + idx + 1,
    }));

    return { entries, total };
  }

  async getGuildSummary(guildId: string, startOfWeekIso: string): Promise<GuildSummaryData> {
    const events = this.guildXpEvents.filter((e) => e.guildId === guildId);
    const totalXp = events.reduce((sum, e) => sum + e.amount, 0);
    const weeklyXp = events
      .filter((e) => e.createdAt >= startOfWeekIso)
      .reduce((sum, e) => sum + e.amount, 0);

    const users = new Set(events.map((e) => e.userId));

    return {
      totalXp,
      weeklyXp,
      participantCount: users.size,
    };
  }

  async getGlobalGuildActivityRanking(
    startOfWeekIso?: string,
    limit = 20,
    offset = 0,
  ): Promise<{ guilds: GlobalGuildRankEntry[]; total: number }> {
    const publicGuilds = Array.from(this.guilds.values()).filter(
      (g) => g.visibility === "PUBLIC" && g.registration_status === "ACTIVE",
    );

    const ranked = publicGuilds.map((g) => {
      const events = this.guildXpEvents.filter((e) => e.guildId === g.guild_id);
      const totalXp = events.reduce((sum, e) => sum + e.amount, 0);
      const weeklyXp = events
        .filter((e) => (startOfWeekIso ? e.createdAt >= startOfWeekIso : true))
        .reduce((sum, e) => sum + e.amount, 0);
      const participants = new Set(events.map((e) => e.userId)).size;

      return {
        guildId: g.guild_id,
        slug: g.slug,
        name: g.name,
        iconUrl: g.icon_url,
        totalXp,
        weeklyXp,
        participantCount: participants,
        rank: 0,
      };
    });

    ranked.sort((a, b) => {
      const aVal = startOfWeekIso ? a.weeklyXp : a.totalXp;
      const bVal = startOfWeekIso ? b.weeklyXp : b.totalXp;
      if (bVal !== aVal) return bVal - aVal;
      return a.guildId.localeCompare(b.guildId);
    });

    const page = ranked.slice(offset, offset + limit).map((g, idx) => ({
      ...g,
      rank: offset + idx + 1,
    }));

    return { guilds: page, total: publicGuilds.length };
  }

  async getGuildGameLeaderboard(
    guildId: string,
    gameId: string,
    direction: "asc" | "desc" = "desc",
    limit = 20,
  ): Promise<ServerGameLeaderboardEntry[]> {
    const guildUserIds = new Set(
      this.guildXpEvents.filter((e) => e.guildId === guildId).map((e) => e.userId),
    );

    let matchingScores = this.scores.filter(
      (s) => s.gameId === gameId && guildUserIds.has(s.userId),
    );

    matchingScores.sort((a, b) => {
      if (direction === "asc") return a.score - b.score;
      return b.score - a.score;
    });

    const seen = new Set<number>();
    const res: ServerGameLeaderboardEntry[] = [];

    for (const s of matchingScores) {
      if (seen.has(s.userId)) continue;
      seen.add(s.userId);

      res.push({
        id: s.id,
        userId: s.userId,
        nickname: `User_${s.userId}`,
        avatarUrl: null,
        gameId: s.gameId,
        score: s.score,
        formattedScore: String(s.score),
        createdAt: s.createdAt,
      });

      if (res.length >= limit) break;
    }

    return res;
  }

  async getGuildUserXpRank(
    guildId: string,
    userId: number,
    startOfWeekIso?: string,
  ): Promise<{ totalXp: number; rank: number | null }> {
    const { entries } = await this.getGuildXpLeaderboard(guildId, startOfWeekIso, 1000, 0);
    const entry = entries.find((e) => e.userId === userId);
    if (!entry || entry.xp <= 0) {
      return { totalXp: 0, rank: null };
    }
    return { totalXp: entry.xp, rank: entry.rank };
  }
}

class MockUserRepo implements UserRepository {
  public users: Map<number, User> = new Map();
  public oauthAccounts: OAuthAccount[] = [];

  async findOAuthAccount(provider: string, providerUserId: string): Promise<OAuthAccount | null> {
    return (
      this.oauthAccounts.find(
        (a) => a.provider === provider && a.provider_user_id === providerUserId,
      ) ?? null
    );
  }

  async findByOAuth(provider: string, providerUserId: string): Promise<User | null> {
    const acc = await this.findOAuthAccount(provider, providerUserId);
    if (!acc) return null;
    return this.users.get(acc.user_id) ?? null;
  }

  async findById(id: number): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async createUser(data: { nickname: string; avatarUrl?: string | null }): Promise<User> {
    const user: User = {
      id: this.users.size + 1,
      nickname: data.nickname,
      avatar_url: data.avatarUrl ?? null,
      country: null,
      nickname_updated_at: null,
      country_updated_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.users.set(user.id, user);
    return user;
  }

  async linkOAuthAccount(input: {
    userId: number;
    provider: string;
    providerUserId: string;
  }): Promise<void> {
    this.oauthAccounts.push({
      user_id: input.userId,
      provider: input.provider,
      provider_user_id: input.providerUserId,
      created_at: new Date().toISOString(),
    });
  }

  async getOAuthAccounts(): Promise<OAuthAccount[]> {
    return this.oauthAccounts;
  }
  async unlinkOAuthAccount(): Promise<void> {}
  async updateAvatarPreference(): Promise<User> {
    throw new Error("Not implemented");
  }
  async updateNickname(): Promise<User> {
    throw new Error("Not implemented");
  }
  async updateCountry(): Promise<User> {
    throw new Error("Not implemented");
  }
}

class MockProgressionRepo implements ProgressionRepository {
  public xpEvents: {
    id: number;
    userId: number;
    amount: number;
    sourceId: string;
    gameId: string;
  }[] = [];
  public userProgress: Map<number, { totalXp: number; completions: number }> = new Map();
  private nextEventId = 100;

  async recordGameCompletion(input: {
    userId: number;
    gameId: string;
    sourceType: string;
    sourceId: string;
    xpPerCompletion: number;
    dailyCapPerGame: number;
  }): Promise<RecordCompletionOutcome> {
    const existing = this.xpEvents.find((e) => e.sourceId === input.sourceId);
    if (existing) {
      const cur = this.userProgress.get(input.userId) ?? { totalXp: 0, completions: 0 };
      return {
        duplicate: true,
        xpAwarded: 0,
        totalXp: cur.totalXp,
        eligibleCompletions: cur.completions,
        xpEventId: existing.id,
      };
    }

    const todayCount = this.xpEvents.filter(
      (e) => e.userId === input.userId && e.gameId === input.gameId && e.amount > 0,
    ).length;

    const underCap = todayCount < input.dailyCapPerGame;
    const amount = underCap ? input.xpPerCompletion : 0;
    const id = this.nextEventId++;

    this.xpEvents.push({
      id,
      userId: input.userId,
      amount,
      sourceId: input.sourceId,
      gameId: input.gameId,
    });

    const cur = this.userProgress.get(input.userId) ?? { totalXp: 0, completions: 0 };
    const newTotal = cur.totalXp + amount;
    const newCompletions = cur.completions + 1;
    this.userProgress.set(input.userId, { totalXp: newTotal, completions: newCompletions });

    return {
      duplicate: false,
      xpAwarded: amount,
      totalXp: newTotal,
      eligibleCompletions: newCompletions,
      xpEventId: id,
    };
  }

  async getUserProgress(userId: number): Promise<UserProgress | null> {
    const p = this.userProgress.get(userId);
    if (!p) return null;
    return {
      user_id: userId,
      total_xp: p.totalXp,
      eligible_completions: p.completions,
      updated_at: new Date().toISOString(),
    };
  }

  async getXpLeaderboard(): Promise<XpLeaderboardEntry[]> {
    return [];
  }
  async getGlobalXpRank(): Promise<number | null> {
    return 1;
  }
}

// ---------------------------------------------------------------------------
// TEST SUITES
// ---------------------------------------------------------------------------

test("Phase H1 Invariants & Play Context Tests", async (t) => {
  let guildRepo: MockDiscordGuildRepo;
  let userRepo: MockUserRepo;
  let progressionRepo: MockProgressionRepo;
  let guildXpUseCases: DiscordGuildXpUseCases;
  let progressionUseCases: ProgressionUseCases;

  t.beforeEach(async () => {
    guildRepo = new MockDiscordGuildRepo();
    userRepo = new MockUserRepo();
    progressionRepo = new MockProgressionRepo();

    guildXpUseCases = new DiscordGuildXpUseCases(guildRepo, userRepo, games);
    progressionUseCases = new ProgressionUseCases(progressionRepo);

    // Setup active Guild A & Guild B
    await guildRepo.registerGuild({
      guildId: "guild_A",
      slug: "guild-a",
      name: "Guild Alpha",
      visibility: "PUBLIC",
      userId: 1,
    });
    await guildRepo.registerGuild({
      guildId: "guild_B",
      slug: "guild-b",
      name: "Guild Beta",
      visibility: "PUBLIC",
      userId: 1,
    });

    // Create OwOGG user 1 linked to discord_user_1
    const user1 = await userRepo.createUser({ nickname: "PlayerOne" });
    await userRepo.linkOAuthAccount({
      userId: user1.id,
      provider: "discord",
      providerUserId: "discord_user_1",
    });

    // Give user 1 high global XP (e.g. 25,000)
    progressionRepo.userProgress.set(user1.id, { totalXp: 25000, completions: 2500 });
  });

  await t.test("1. User with 25,000 global XP joining Guild A has Guild A XP = 0", async () => {
    const guildAXp = await guildXpUseCases.getGuildUserXp("guild_A", 1);
    const guildATotal = await guildXpUseCases.getGuildTotalXp("guild_A");
    assert.equal(guildAXp, 0);
    assert.equal(guildATotal, 0);
  });

  await t.test(
    "2 & 3. Valid Guild A context + accepted +10 global XP => global +10, Guild A +10, Guild B remains 0",
    async () => {
      const ctx = await guildXpUseCases.createPlayContextFromInteraction({
        guildId: "guild_A",
        discordUserId: "discord_user_1",
        gameId: "reaction-time",
      });

      const completion = await progressionUseCases.recordAcceptedGameCompletion({
        userId: 1,
        gameId: "reaction-time",
        sourceId: "score_101",
      });

      assert.equal(completion.xpAwarded, 10);
      assert.ok(completion.xpEventId);

      const attr = await guildXpUseCases.attributeCompletionToGuild({
        userId: 1,
        gameId: "reaction-time",
        sourceXpEventId: completion.xpEventId!,
        xpAmount: completion.xpAwarded,
        playToken: ctx.token,
      });

      assert.equal(attr.attributed, true);
      assert.equal(attr.guildId, "guild_A");
      assert.equal(attr.amount, 10);

      const guildAXp = await guildXpUseCases.getGuildUserXp("guild_A", 1);
      const guildBXp = await guildXpUseCases.getGuildUserXp("guild_B", 1);
      assert.equal(guildAXp, 10);
      assert.equal(guildBXp, 0);
    },
  );

  await t.test("4. Same source replay => no duplicate global or guild XP", async () => {
    const ctx = await guildXpUseCases.createPlayContextFromInteraction({
      guildId: "guild_A",
      discordUserId: "discord_user_1",
    });

    const completion1 = await progressionUseCases.recordAcceptedGameCompletion({
      userId: 1,
      gameId: "aim-test",
      sourceId: "score_102",
    });
    assert.equal(completion1.duplicate, false);
    assert.equal(completion1.xpAwarded, 10);

    const attr1 = await guildXpUseCases.attributeCompletionToGuild({
      userId: 1,
      gameId: "aim-test",
      sourceXpEventId: completion1.xpEventId!,
      xpAmount: completion1.xpAwarded,
      playToken: ctx.token,
    });
    assert.equal(attr1.attributed, true);

    const completion2 = await progressionUseCases.recordAcceptedGameCompletion({
      userId: 1,
      gameId: "aim-test",
      sourceId: "score_102",
    });
    assert.equal(completion2.duplicate, true);
    assert.equal(completion2.xpAwarded, 0);

    const guildAXp = await guildXpUseCases.getGuildUserXp("guild_A", 1);
    assert.equal(guildAXp, 10);
  });
});

test("Phase H2 Leaderboard, Time Boundary & Command Tests", async (t) => {
  let guildRepo: MockDiscordGuildRepo;
  let userRepo: MockUserRepo;
  let guildXpUseCases: DiscordGuildXpUseCases;

  t.beforeEach(async () => {
    guildRepo = new MockDiscordGuildRepo();
    userRepo = new MockUserRepo();
    guildXpUseCases = new DiscordGuildXpUseCases(guildRepo, userRepo, games);

    // Register Guild A (PUBLIC), Guild B (UNLISTED), Guild C (PRIVATE)
    await guildRepo.registerGuild({
      guildId: "guild_A",
      slug: "guild-a",
      name: "Guild Alpha",
      visibility: "PUBLIC",
      userId: 1,
    });
    await guildRepo.registerGuild({
      guildId: "guild_B",
      slug: "guild-b",
      name: "Guild Beta",
      visibility: "UNLISTED",
      userId: 1,
    });
    await guildRepo.registerGuild({
      guildId: "guild_C",
      slug: "guild-c",
      name: "Guild Charlie",
      visibility: "PRIVATE",
      userId: 1,
    });

    // Create users 1, 2, 3
    const u1 = await userRepo.createUser({ nickname: "AlphaUser" });
    const u2 = await userRepo.createUser({ nickname: "BetaUser" });
    const u3 = await userRepo.createUser({ nickname: "CharlieUser" });

    await userRepo.linkOAuthAccount({
      userId: u1.id,
      provider: "discord",
      providerUserId: "discord_u1",
    });
    await userRepo.linkOAuthAccount({
      userId: u2.id,
      provider: "discord",
      providerUserId: "discord_u2",
    });
  });

  await t.test(
    "getStartOfWeekKst correctly computes Monday 00:00 KST boundary in UTC",
    async () => {
      // Thursday Aug 13 2026 08:10:22 UTC = Thursday Aug 13 2026 17:10:22 KST
      const testDate = new Date("2026-08-13T08:10:22.000Z");
      const weekStart = getStartOfWeekKst(testDate);
      // Expected Monday Aug 10 2026 00:00 KST = Sunday Aug 9 2026 15:00 UTC
      assert.equal(weekStart, "2026-08-09T15:00:00.000Z");

      // Sunday Aug 16 2026 14:59:59 UTC = Sunday Aug 16 2026 23:59:59 KST
      const endOfWeek = new Date("2026-08-16T14:59:59.000Z");
      assert.equal(getStartOfWeekKst(endOfWeek), "2026-08-09T15:00:00.000Z");

      // Sunday Aug 16 2026 15:00:00 UTC = Monday Aug 17 2026 00:00:00 KST
      const nextWeekStart = new Date("2026-08-16T15:00:00.000Z");
      assert.equal(getStartOfWeekKst(nextWeekStart), "2026-08-16T15:00:00.000Z");
    },
  );

  await t.test("Guild XP leaderboard ordering and tie handling", async () => {
    // Add XP events to Guild A: User 1: 50 XP, User 2: 50 XP, User 3: 100 XP
    guildRepo.guildXpEvents.push(
      {
        id: 1,
        guildId: "guild_A",
        userId: 1,
        sourceXpEventId: 101,
        amount: 50,
        createdAt: new Date().toISOString(),
      },
      {
        id: 2,
        guildId: "guild_A",
        userId: 2,
        sourceXpEventId: 102,
        amount: 50,
        createdAt: new Date().toISOString(),
      },
      {
        id: 3,
        guildId: "guild_A",
        userId: 3,
        sourceXpEventId: 103,
        amount: 100,
        createdAt: new Date().toISOString(),
      },
    );

    const lb = await guildXpUseCases.getGuildLeaderboard("guild_A", "alltime", 10, 0);
    assert.equal(lb.total, 3);
    // User 3 (100 XP) -> Rank 1
    assert.equal(lb.entries[0].userId, 3);
    assert.equal(lb.entries[0].rank, 1);
    // User 1 (50 XP) vs User 2 (50 XP): User 1 comes first due to user_id ASC tie-breaker
    assert.equal(lb.entries[1].userId, 1);
    assert.equal(lb.entries[1].rank, 2);
    assert.equal(lb.entries[2].userId, 2);
    assert.equal(lb.entries[2].rank, 3);
  });

  await t.test(
    "Global Guild Activity ranking includes PUBLIC guilds and excludes UNLISTED/PRIVATE",
    async () => {
      guildRepo.guildXpEvents.push(
        {
          id: 1,
          guildId: "guild_A",
          userId: 1,
          sourceXpEventId: 101,
          amount: 100,
          createdAt: new Date().toISOString(),
        },
        {
          id: 2,
          guildId: "guild_B",
          userId: 1,
          sourceXpEventId: 102,
          amount: 500,
          createdAt: new Date().toISOString(),
        }, // UNLISTED
        {
          id: 3,
          guildId: "guild_C",
          userId: 1,
          sourceXpEventId: 103,
          amount: 900,
          createdAt: new Date().toISOString(),
        }, // PRIVATE
      );

      const ranking = await guildXpUseCases.getGlobalGuildRanking("alltime", 10, 0);
      assert.equal(ranking.total, 1); // Only Guild A is PUBLIC
      assert.equal(ranking.guilds.length, 1);
      assert.equal(ranking.guilds[0].guildId, "guild_A");
    },
  );

  await t.test("Server Game ranking reuses canonical scores for guild participants", async () => {
    // Add XP event in Guild A for User 1 only
    guildRepo.guildXpEvents.push({
      id: 1,
      guildId: "guild_A",
      userId: 1,
      sourceXpEventId: 101,
      amount: 10,
      createdAt: new Date().toISOString(),
    });

    // Scores in DB for reaction-time (lower is better): User 1 (220ms), User 2 (150ms)
    guildRepo.scores.push(
      {
        id: 10,
        userId: 1,
        gameId: "reaction-time",
        score: 220,
        createdAt: new Date().toISOString(),
      },
      {
        id: 11,
        userId: 2,
        gameId: "reaction-time",
        score: 150,
        createdAt: new Date().toISOString(),
      },
    );

    const gameLb = await guildXpUseCases.getGuildGameLeaderboard("guild_A", "reaction-time", 10);
    // User 2 has not participated in Guild A (no XP event), so excluded from Guild A's game ranking
    assert.equal(gameLb.length, 1);
    assert.equal(gameLb[0].userId, 1);
    assert.equal(gameLb[0].score, 220);
  });

  await t.test("getUserGuildRankSummary for linked vs unlinked user", async () => {
    guildRepo.guildXpEvents.push({
      id: 1,
      guildId: "guild_A",
      userId: 1,
      sourceXpEventId: 101,
      amount: 40,
      createdAt: new Date().toISOString(),
    });

    // Linked user 1 (discord_u1)
    const summary1 = await guildXpUseCases.getUserGuildRankSummary("guild_A", "discord_u1");
    assert.equal(summary1.totalXp, 40);
    assert.equal(summary1.rank, 1);

    // Unlinked user
    const summaryUnlinked = await guildXpUseCases.getUserGuildRankSummary(
      "guild_A",
      "unknown_discord_id",
    );
    assert.equal(summaryUnlinked.totalXp, 0);
    assert.equal(summaryUnlinked.rank, null);
  });
});
