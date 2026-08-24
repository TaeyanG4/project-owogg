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
  type StreamerChannelInfo,
} from "../src/index.js";

class MemoryStreamerRepo implements StreamerRepository {
  public profiles = new Map<number, StreamerProfile>();
  public platformAccounts: StreamerPlatformAccount[] = [];
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
    const now = new Date().toISOString();
    const existing = await this.findProfileByUserId(input.userId);
    if (existing) {
      const updated: StreamerProfile = {
        ...existing,
        status: input.status,
        featuredStatus: input.featuredStatus ?? existing.featuredStatus,
        updatedAt: now,
      };
      this.profiles.set(existing.id, updated);
      return updated;
    }

    const created: StreamerProfile = {
      id: this.nextProfileId++,
      userId: input.userId,
      status: input.status,
      featuredStatus: input.featuredStatus ?? "NONE",
      featuredReason: input.featuredReason ?? null,
      featuredSince: null,
      createdAt: now,
      updatedAt: now,
    };
    this.profiles.set(created.id, created);
    return created;
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
    const existingIdx = this.platformAccounts.findIndex(
      (a) => a.platform === input.platform && a.platformUserId === input.platformUserId,
    );

    if (existingIdx >= 0) {
      const updated: StreamerPlatformAccount = {
        ...this.platformAccounts[existingIdx],
        streamerId: input.streamerId,
        channelName: input.channelName,
        channelHandle: input.channelHandle ?? null,
        channelUrl: input.channelUrl,
        avatarUrl: input.avatarUrl ?? null,
        verificationStatus: input.verificationStatus ?? "VERIFIED",
        audienceCount: input.audienceCount ?? 0,
        channelCreatedAt: input.channelCreatedAt ?? null,
        metricsSyncedAt: now,
        updatedAt: now,
      };
      this.platformAccounts[existingIdx] = updated;
      return updated;
    }

    const created: StreamerPlatformAccount = {
      id: this.nextAccId++,
      streamerId: input.streamerId,
      platform: input.platform,
      platformUserId: input.platformUserId,
      channelName: input.channelName,
      channelHandle: input.channelHandle ?? null,
      channelUrl: input.channelUrl,
      avatarUrl: input.avatarUrl ?? null,
      verificationStatus: input.verificationStatus ?? "VERIFIED",
      verifiedAt: now,
      audienceCount: input.audienceCount ?? 0,
      channelCreatedAt: input.channelCreatedAt ?? null,
      metricsSyncedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    this.platformAccounts.push(created);
    return created;
  }

  async getStreamerRankings(): Promise<{ entries: StreamerRankEntry[]; total: number }> {
    return { entries: [], total: 0 };
  }
}

test("verifyChannelOwnership — successfully verifies new channel for user", async () => {
  const repo = new MemoryStreamerRepo();
  const useCases = new StreamerUseCases(repo);

  const info: StreamerChannelInfo = {
    platform: "YOUTUBE",
    platformUserId: "UC1234567890",
    channelName: "Test Gaming",
    channelHandle: "@testgaming",
    channelUrl: "https://youtube.com/@testgaming",
    avatarUrl: "https://avatar.png",
    audienceCount: 25000,
  };

  const res = await useCases.verifyChannelOwnership(101, info);

  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.profile.userId, 101);
    assert.equal(res.profile.status, "VERIFIED");
    assert.equal(res.platformAccount.platform, "YOUTUBE");
    assert.equal(res.platformAccount.platformUserId, "UC1234567890");
    assert.equal(res.platformAccount.audienceCount, 25000);
  }
});

test("verifyChannelOwnership — rejects duplicate channel verification across different users", async () => {
  const repo = new MemoryStreamerRepo();
  const useCases = new StreamerUseCases(repo);

  const info: StreamerChannelInfo = {
    platform: "CHZZK",
    platformUserId: "0123456789abcdef0123456789abcdef",
    channelName: "Popular Streamer",
    channelHandle: null,
    channelUrl: "https://chzzk.naver.com/0123456789abcdef0123456789abcdef",
    avatarUrl: null,
  };

  // User 1 verifies channel
  const res1 = await useCases.verifyChannelOwnership(1, info);
  assert.equal(res1.ok, true);

  // User 2 attempts to verify identical CHZZK channel
  const res2 = await useCases.verifyChannelOwnership(2, info);
  assert.equal(res2.ok, false);
  if (!res2.ok) {
    assert.equal(res2.code, "CHANNEL_ALREADY_VERIFIED");
    assert.match(res2.message, /이미 다른 OwOGG 스트리머/);
  }
});

test("verifyChannelOwnership — allows same user to re-verify or update their own channel", async () => {
  const repo = new MemoryStreamerRepo();
  const useCases = new StreamerUseCases(repo);

  const info1: StreamerChannelInfo = {
    platform: "SOOP",
    platformUserId: "soop_pro_gamer",
    channelName: "Old Nickname",
    channelHandle: "@soop_pro_gamer",
    channelUrl: "https://sooplive.co.kr/soop_pro_gamer",
    avatarUrl: null,
  };

  await useCases.verifyChannelOwnership(5, info1);

  const info2: StreamerChannelInfo = {
    ...info1,
    channelName: "New Nickname (Updated)",
  };

  const res2 = await useCases.verifyChannelOwnership(5, info2);
  assert.equal(res2.ok, true);
  if (res2.ok) {
    assert.equal(res2.platformAccount.channelName, "New Nickname (Updated)");
  }
});
