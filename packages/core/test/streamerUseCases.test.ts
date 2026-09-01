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
  type PublicGameCatalog,
} from "../src/index.js";
import { runtimeGameFixture } from "./runtimeGameFixture.js";

class MockStreamerRepo implements StreamerRepository {
  public profiles: Map<number, StreamerProfile> = new Map();
  public platformAccounts: StreamerPlatformAccount[] = [];
  public users: Map<
    number,
    { nickname: string; avatarUrl?: string | null; country?: string | null }
  > = new Map();
  public scores: { userId: number; gameId: string; score: number; createdAt: string }[] = [];
  public userProgress: Map<number, number> = new Map(); // userId -> totalXp
  public lastRankingOptions:
    | {
        mode: "score" | "xp";
        gameId?: string;
        direction?: "asc" | "desc";
        rulesetRevision?: number;
        platform?: StreamerPlatformType;
        limit?: number;
        offset?: number;
      }
    | undefined;

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

  async disconnectPlatformAccount(
    input: Parameters<StreamerRepository["disconnectPlatformAccount"]>[0],
  ): Promise<boolean> {
    const profile = Array.from(this.profiles.values()).find((item) => item.userId === input.userId);
    if (!profile) return false;
    const accountIndex = this.platformAccounts.findIndex(
      (item) => item.streamerId === profile.id && item.platform === input.platform,
    );
    if (accountIndex < 0) return false;

    this.platformAccounts.splice(accountIndex, 1);
    const nowMs = Date.parse(input.nowIso);
    const hasCurrentApproval = this.platformAccounts.some(
      (item) =>
        item.streamerId === profile.id &&
        item.verificationStatus === "VERIFIED" &&
        item.approvalStatus === "APPROVED" &&
        Boolean(item.ownershipExpiresAt && Date.parse(item.ownershipExpiresAt) > nowMs),
    );
    this.profiles.set(profile.id, {
      ...profile,
      status:
        profile.status === "SUSPENDED"
          ? "SUSPENDED"
          : hasCurrentApproval
            ? "VERIFIED"
            : "UNVERIFIED",
      rowVersion: profile.rowVersion + 1,
      updatedAt: input.nowIso,
    });
    return true;
  }

  async upsertProfile(input: {
    userId: number;
    status: StreamerStatusType;
  }): Promise<StreamerProfile> {
    const existing = Array.from(this.profiles.values()).find((p) => p.userId === input.userId);
    const now = new Date().toISOString();

    if (existing) {
      existing.status = input.status;
      existing.updatedAt = now;
      existing.rowVersion += 1;
      return existing;
    }

    const prof: StreamerProfile = {
      id: this.nextProfileId++,
      userId: input.userId,
      status: input.status,
      suspendedUntil: null,
      rowVersion: 0,
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
      ownershipExpiresAt: "2030-01-01T00:00:00.000Z",
      approvalStatus: "APPROVED",
      approvalReasonCode: "TEST_APPROVED",
      approvedAt: now,
      audienceCount: null,
      channelCreatedAt: null,
      metricsSyncedAt: null,
      rowVersion: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.platformAccounts.push(acc);
    return acc;
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
    this.lastRankingOptions = options;
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

    // User 3: Verified Streamer (YouTube & Twitch)
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

    const c3 = await repo.upsertProfile({ userId: 3, status: "VERIFIED" });
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

  await t.test("5. Streamer approval never modifies canonical scores or XP", async () => {
    const c2 = await repo.upsertProfile({ userId: 2, status: "VERIFIED" });
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

  await t.test("7. A selected game forwards its canonical ruleset revision", async () => {
    const runtime = runtimeGameFixture("aim-test");
    const catalog: PublicGameCatalog = {
      async findBySlug(slug) {
        return slug === runtime.identity.slug ? runtime : null;
      },
      async list() {
        return [
          {
            ...runtime,
            canonical: {
              ...runtime.canonical,
              playConfig: {
                version: 1,
                rulesetRevision: 7,
                verifierId: "verified-aim-test-v1",
                defaultVariantId: "standard",
                variants: [{ id: "standard", label: "Standard" }],
                allowedConfigs: [
                  { difficultyId: "normal", variantId: "standard", rewardFactor: 1 },
                ],
              },
            },
          },
        ];
      },
    };

    await new StreamerUseCases(repo, undefined, catalog).getStreamerRankings({
      mode: "score",
      gameId: "aim-test",
    });

    assert.equal(repo.lastRankingOptions?.rulesetRevision, 7);
    assert.equal(repo.lastRankingOptions?.direction, "asc");
  });

  await t.test(
    "8. Disconnecting the final channel preserves scores but removes ranking eligibility",
    async () => {
      const profile = await repo.upsertProfile({ userId: 2, status: "VERIFIED" });
      await repo.addPlatformAccount({
        streamerId: profile.id,
        platform: "YOUTUBE",
        platformUserId: "yt_disconnect",
        channelName: "Disconnect channel",
        channelUrl: "https://youtube.com/@disconnect",
      });
      const scoreSnapshot = structuredClone(repo.scores);

      const before = await useCases.getStreamerRankings({ mode: "score", gameId: "aim-test" });
      assert.equal(before.total, 1);

      const disconnected = await useCases.disconnectPlatform(
        2,
        "YOUTUBE",
        new Date("2026-09-01T00:00:00.000Z"),
        "self-disconnect",
      );
      assert.deepEqual(disconnected, { ok: true, remainingConnections: 0 });
      assert.deepEqual(repo.scores, scoreSnapshot);

      const after = await useCases.getStreamerRankings({ mode: "score", gameId: "aim-test" });
      assert.equal(after.total, 0);
      assert.equal((await repo.findProfileByUserId(2))?.status, "UNVERIFIED");
    },
  );

  await t.test(
    "9. Disconnecting one of two channels keeps the other channel eligible",
    async () => {
      const profile = await repo.upsertProfile({ userId: 3, status: "VERIFIED" });
      for (const [platform, id] of [
        ["YOUTUBE", "yt_multi"],
        ["TWITCH", "tw_multi"],
      ] as const) {
        await repo.addPlatformAccount({
          streamerId: profile.id,
          platform,
          platformUserId: id,
          channelName: `${platform} multi channel`,
          channelUrl: `https://example.com/${id}`,
        });
      }

      const disconnected = await useCases.disconnectPlatform(
        3,
        "YOUTUBE",
        new Date("2026-09-01T00:00:00.000Z"),
        "partial-disconnect",
      );
      assert.deepEqual(disconnected, { ok: true, remainingConnections: 1 });
      assert.equal((await repo.findProfileByUserId(3))?.status, "VERIFIED");
      assert.equal((await useCases.getStreamerRankings({ mode: "score" })).total, 1);
    },
  );
});
