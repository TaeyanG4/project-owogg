import test from "node:test";
import assert from "node:assert/strict";
import {
  StreamerUseCases,
  type StreamerRepository,
  type StreamerProfile,
  type StreamerPlatformAccount,
  type StreamerRankEntry,
  type StreamerPlatformType,
  type StreamerStatusType,
  type FeaturedStatusType,
} from "../src/index.js";

class MockStreamerRepo implements StreamerRepository {
  public profiles: Map<number, StreamerProfile> = new Map();
  public platformAccounts: StreamerPlatformAccount[] = [];
  public users: Map<
    number,
    { nickname: string; avatarUrl?: string | null; country?: string | null }
  > = new Map();
  public scores: { userId: number; gameId: string; score: number; createdAt: string }[] = [];
  public userProgress: Map<number, number> = new Map(); // userId -> totalXp

  private nextProfileId = 1;
  private nextAccId = 1;

  async findProfileByUserId(
    userId: number,
  ): Promise<(StreamerProfile & { platformAccounts: StreamerPlatformAccount[] }) | null> {
    const prof = Array.from(this.profiles.values()).find((p) => p.userId === userId);
    if (!prof) return null;
    const accs = this.platformAccounts.filter((a) => a.streamerId === prof.id);
    return { ...prof, platformAccounts: accs };
  }

  async findProfileById(
    streamerId: number,
  ): Promise<(StreamerProfile & { platformAccounts: StreamerPlatformAccount[] }) | null> {
    const prof = this.profiles.get(streamerId);
    if (!prof) return null;
    const accs = this.platformAccounts.filter((a) => a.streamerId === streamerId);
    return { ...prof, platformAccounts: accs };
  }

  async findPlatformAccount(
    platform: StreamerPlatformType,
    platformUserId: string,
  ): Promise<StreamerPlatformAccount | null> {
    return (
      this.platformAccounts.find(
        (a) => a.platform === platform && a.platformUserId === platformUserId,
      ) || null
    );
  }

  async findPlatformAccountById(
    platformAccountId: number,
  ): Promise<StreamerPlatformAccount | null> {
    return this.platformAccounts.find((a) => a.id === platformAccountId) || null;
  }

  async updatePlatformAccountMetrics(
    platformAccountId: number,
    input: { audienceCount: number | null; channelCreatedAt: string | null; syncedAt: string },
  ): Promise<StreamerPlatformAccount> {
    const idx = this.platformAccounts.findIndex((a) => a.id === platformAccountId);
    if (idx < 0) throw new Error("platform account not found");
    this.platformAccounts[idx] = {
      ...this.platformAccounts[idx],
      audienceCount: input.audienceCount ?? 0,
      channelCreatedAt: input.channelCreatedAt ?? null,
      metricsSyncedAt: input.syncedAt,
      updatedAt: input.syncedAt,
    };
    return this.platformAccounts[idx];
  }

  async upsertProfile(input: {
    userId: number;
    status: StreamerStatusType;
    featuredStatus?: FeaturedStatusType;
    featuredReason?: string | null;
  }): Promise<StreamerProfile> {
    const existing = Array.from(this.profiles.values()).find((p) => p.userId === input.userId);
    const now = new Date().toISOString();

    if (existing) {
      existing.status = input.status;
      if (input.featuredStatus) existing.featuredStatus = input.featuredStatus;
      if (input.featuredReason !== undefined) existing.featuredReason = input.featuredReason;
      existing.updatedAt = now;
      return existing;
    }

    const prof: StreamerProfile = {
      id: this.nextProfileId++,
      userId: input.userId,
      status: input.status,
      featuredStatus: input.featuredStatus ?? "NONE",
      featuredReason: input.featuredReason ?? null,
      featuredSince: input.featuredStatus && input.featuredStatus !== "NONE" ? now : null,
      createdAt: now,
      updatedAt: now,
    };
    this.profiles.set(prof.id, prof);
    return prof;
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
    const existing = this.platformAccounts.find(
      (a) => a.platform === input.platform && a.platformUserId === input.platformUserId,
    );
    if (existing) {
      throw new Error(
        `Platform account ${input.platform}:${input.platformUserId} is already linked to another streamer`,
      );
    }

    const now = new Date().toISOString();
    const verStatus = input.verificationStatus ?? "VERIFIED";
    const acc: StreamerPlatformAccount = {
      id: this.nextAccId++,
      streamerId: input.streamerId,
      platform: input.platform,
      platformUserId: input.platformUserId,
      channelName: input.channelName,
      channelHandle: input.channelHandle ?? null,
      channelUrl: input.channelUrl,
      avatarUrl: input.avatarUrl ?? null,
      verificationStatus: verStatus,
      verifiedAt: verStatus === "VERIFIED" ? now : null,
      createdAt: now,
      updatedAt: now,
    };
    this.platformAccounts.push(acc);
    return acc;
  }

  async getStreamerRankings(options: {
    mode: "score" | "xp";
    gameId?: string;
    platform?: StreamerPlatformType;
    limit?: number;
    offset?: number;
  }): Promise<{ entries: StreamerRankEntry[]; total: number }> {
    const verifiedStreamers = Array.from(this.profiles.values()).filter(
      (p) => p.status === "VERIFIED",
    );

    const filtered = verifiedStreamers.filter((p) => {
      if (!options.platform) return true;
      return this.platformAccounts.some(
        (a) =>
          a.streamerId === p.id &&
          a.platform === options.platform &&
          a.verificationStatus === "VERIFIED",
      );
    });

    if (options.mode === "score") {
      const candidates: StreamerRankEntry[] = [];
      const gameIdFilter = options.gameId && options.gameId !== "all" ? options.gameId : null;

      for (const c of filtered) {
        const user = this.users.get(c.userId);
        if (!user) continue;

        const userScores = this.scores.filter(
          (s) => s.userId === c.userId && (!gameIdFilter || s.gameId === gameIdFilter),
        );
        if (userScores.length === 0) continue;

        // Best score (assume higher is better for test default)
        userScores.sort((a, b) => b.score - a.score);
        const best = userScores[0];

        const pAccs = this.platformAccounts
          .filter((a) => a.streamerId === c.id && a.verificationStatus === "VERIFIED")
          .map((a) => ({
            platform: a.platform,
            channelName: a.channelName,
            channelUrl: a.channelUrl,
            avatarUrl: a.avatarUrl,
          }));

        candidates.push({
          userId: c.userId,
          nickname: user.nickname,
          avatarUrl: user.avatarUrl ?? null,
          country: user.country ?? null,
          streamerId: c.id,
          featuredStatus: c.featuredStatus,
          platformAccounts: pAccs,
          score: best.score,
          formattedScore: String(best.score),
          gameId: best.gameId,
          rank: 0,
        });
      }

      candidates.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      const total = candidates.length;
      const limit = options.limit ?? 20;
      const offset = options.offset ?? 0;
      const page = candidates.slice(offset, offset + limit).map((e, idx) => ({
        ...e,
        rank: offset + idx + 1,
      }));

      return { entries: page, total };
    } else {
      // Mode === "xp"
      const candidates: StreamerRankEntry[] = [];

      for (const c of filtered) {
        const user = this.users.get(c.userId);
        if (!user) continue;

        const totalXp = this.userProgress.get(c.userId) ?? 0;
        const pAccs = this.platformAccounts
          .filter((a) => a.streamerId === c.id && a.verificationStatus === "VERIFIED")
          .map((a) => ({
            platform: a.platform,
            channelName: a.channelName,
            channelUrl: a.channelUrl,
            avatarUrl: a.avatarUrl,
          }));

        candidates.push({
          userId: c.userId,
          nickname: user.nickname,
          avatarUrl: user.avatarUrl ?? null,
          country: user.country ?? null,
          streamerId: c.id,
          featuredStatus: c.featuredStatus,
          platformAccounts: pAccs,
          totalXp,
          level: Math.floor(totalXp / 100) + 1,
          rank: 0,
        });
      }

      candidates.sort((a, b) => (b.totalXp ?? 0) - (a.totalXp ?? 0));
      const total = candidates.length;
      const limit = options.limit ?? 20;
      const offset = options.offset ?? 0;
      const page = candidates.slice(offset, offset + limit).map((e, idx) => ({
        ...e,
        rank: offset + idx + 1,
      }));

      return { entries: page, total };
    }
  }
}

test("Phase D Streamer Domain & Ranking Invariants", async (t) => {
  let repo: MockStreamerRepo;
  let useCases: StreamerUseCases;

  t.beforeEach(() => {
    repo = new MockStreamerRepo();
    useCases = new StreamerUseCases(repo);

    // Register 3 users:
    // User 1: Normal player (no streamer profile)
    repo.users.set(1, { nickname: "NormalPlayer", country: "KR" });
    repo.scores.push({
      userId: 1,
      gameId: "aim-test",
      score: 9999,
      createdAt: new Date().toISOString(),
    });
    repo.userProgress.set(1, 50000);

    // User 2: Verified Streamer (CHZZK)
    repo.users.set(2, { nickname: "StreamerAlpha", country: "KR" });
    repo.scores.push({
      userId: 2,
      gameId: "aim-test",
      score: 8500,
      createdAt: new Date().toISOString(),
    });
    repo.userProgress.set(2, 20000);

    // User 3: Verified Streamer (YouTube & Twitch, Featured)
    repo.users.set(3, { nickname: "StreamerBeta", country: "JP" });
    repo.scores.push({
      userId: 3,
      gameId: "aim-test",
      score: 9200,
      createdAt: new Date().toISOString(),
    });
    repo.userProgress.set(3, 35000);
  });

  await t.test("1. Normal user (User 1) is excluded from Streamer rankings", async () => {
    const streamer2 = await repo.upsertProfile({ userId: 2, status: "VERIFIED" });
    await repo.addPlatformAccount({
      streamerId: streamer2.id,
      platform: "CHZZK",
      platformUserId: "chzzk_alpha",
      channelName: "Alpha Chzzk Channel",
      channelUrl: "https://chzzk.naver.com/alpha",
    });

    const res = await useCases.getStreamerRankings({ mode: "score", gameId: "aim-test" });
    assert.equal(res.total, 1);
    assert.equal(res.entries[0].userId, 2);
    // User 1 (9999 pts) is excluded because status !== 'VERIFIED'
  });

  await t.test("2. Verified streamers are included and ranked by canonical score", async () => {
    const c2 = await repo.upsertProfile({ userId: 2, status: "VERIFIED" });
    await repo.addPlatformAccount({
      streamerId: c2.id,
      platform: "CHZZK",
      platformUserId: "chzzk_alpha",
      channelName: "Alpha Channel",
      channelUrl: "https://chzzk.naver.com/alpha",
    });

    const c3 = await repo.upsertProfile({
      userId: 3,
      status: "VERIFIED",
      featuredStatus: "FEATURED",
    });
    await repo.addPlatformAccount({
      streamerId: c3.id,
      platform: "YOUTUBE",
      platformUserId: "yt_beta",
      channelName: "Beta YouTube Channel",
      channelUrl: "https://youtube.com/@beta",
    });

    const res = await useCases.getStreamerRankings({ mode: "score", gameId: "aim-test" });
    assert.equal(res.total, 2);
    // User 3 (9200 pts) > User 2 (8500 pts)
    assert.equal(res.entries[0].userId, 3);
    assert.equal(res.entries[0].score, 9200);
    assert.equal(res.entries[0].rank, 1);
    assert.equal(res.entries[1].userId, 2);
    assert.equal(res.entries[1].score, 8500);
    assert.equal(res.entries[1].rank, 2);
  });

  await t.test("3. Platform filter strictly filters streamer accounts", async () => {
    const c2 = await repo.upsertProfile({ userId: 2, status: "VERIFIED" });
    await repo.addPlatformAccount({
      streamerId: c2.id,
      platform: "CHZZK",
      platformUserId: "chzzk_alpha",
      channelName: "Alpha Channel",
      channelUrl: "https://chzzk.naver.com/alpha",
    });

    const c3 = await repo.upsertProfile({ userId: 3, status: "VERIFIED" });
    await repo.addPlatformAccount({
      streamerId: c3.id,
      platform: "YOUTUBE",
      platformUserId: "yt_beta",
      channelName: "Beta Channel",
      channelUrl: "https://youtube.com/@beta",
    });

    // Filter YOUTUBE only
    const ytRes = await useCases.getStreamerRankings({ mode: "score", platform: "YOUTUBE" });
    assert.equal(ytRes.total, 1);
    assert.equal(ytRes.entries[0].userId, 3);

    // Filter CHZZK only
    const chzzkRes = await useCases.getStreamerRankings({ mode: "score", platform: "CHZZK" });
    assert.equal(chzzkRes.total, 1);
    assert.equal(chzzkRes.entries[0].userId, 2);
  });

  await t.test("4. Duplicate platform account identity is blocked", async () => {
    const c2 = await repo.upsertProfile({ userId: 2, status: "VERIFIED" });
    await repo.addPlatformAccount({
      streamerId: c2.id,
      platform: "SOOP",
      platformUserId: "soop_shared_id",
      channelName: "Soop Channel 1",
      channelUrl: "https://soop.com/ch1",
    });

    const c3 = await repo.upsertProfile({ userId: 3, status: "VERIFIED" });

    await assert.rejects(
      async () => {
        await repo.addPlatformAccount({
          streamerId: c3.id,
          platform: "SOOP",
          platformUserId: "soop_shared_id", // Same platform & platformUserId
          channelName: "Soop Channel 2",
          channelUrl: "https://soop.com/ch2",
        });
      },
      (err: Error) => err.message.includes("already linked"),
    );
  });

  await t.test("5. Featured or Partner status never modifies scores or XP", async () => {
    const c2 = await repo.upsertProfile({
      userId: 2,
      status: "VERIFIED",
      featuredStatus: "PARTNER",
    });
    await repo.addPlatformAccount({
      streamerId: c2.id,
      platform: "TWITCH",
      platformUserId: "tw_2",
      channelName: "Twitch 2",
      channelUrl: "https://twitch.tv/tw2",
    });

    const scoreRes = await useCases.getStreamerRankings({ mode: "score" });
    assert.equal(scoreRes.entries[0].score, 8500); // Raw canonical score preserved

    const xpRes = await useCases.getStreamerRankings({ mode: "xp" });
    assert.equal(xpRes.entries[0].totalXp, 20000); // Raw global XP preserved
  });

  await t.test("6. Empty streamer database returns total 0 cleanly", async () => {
    const res = await useCases.getStreamerRankings({ mode: "score" });
    assert.equal(res.total, 0);
    assert.equal(res.entries.length, 0);
  });
});
