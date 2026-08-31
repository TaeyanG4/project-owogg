import test from "node:test";
import assert from "node:assert/strict";
import {
  StreamerUseCases,
  type StreamerAdminActionInput,
  type StreamerAdminActionResult,
  type StreamerAdminRepository,
  type StreamerAdminWorkspaceQuery,
  type StreamerAdminWorkspaceSnapshot,
  type StreamerChannelInfo,
  type StreamerPlatformAccount,
  type StreamerPlatformType,
  type StreamerPolicyVersion,
  type StreamerProfile,
  type StreamerRankEntry,
  type StreamerRepository,
  type StreamerReviewJob,
  type StreamerReviewRepository,
  type StreamerStatusType,
} from "../src/index.js";

const POLICY: StreamerPolicyVersion = {
  version: 3,
  values: {
    minimumAudience: 10_000,
    minimumChannelAgeDays: 90,
    ownershipValidityDays: 180,
    reverificationNoticeDays: 30,
    verificationIntentTtlMinutes: 10,
    claimLeaseMinutes: 20,
    reviewSlaHours: 24,
    holdDefaultHours: 24,
    reconsiderationCooldownDays: 7,
    providerTimeoutSeconds: 10,
  },
  reason: "test policy",
  updatedAt: "2026-01-01T00:00:00.000Z",
  updatedBy: "test",
};

class MemoryStreamerRepo implements StreamerRepository {
  profiles = new Map<number, StreamerProfile>();
  platformAccounts: StreamerPlatformAccount[] = [];
  private nextProfileId = 1;
  private nextAccountId = 1;

  async findProfileByUserId(userId: number) {
    const profile = [...this.profiles.values()].find((item) => item.userId === userId);
    if (!profile) return null;
    return {
      ...profile,
      platformAccounts: this.platformAccounts.filter((item) => item.streamerId === profile.id),
    };
  }

  async findProfileById(streamerId: number) {
    const profile = this.profiles.get(streamerId);
    if (!profile) return null;
    return {
      ...profile,
      platformAccounts: this.platformAccounts.filter((item) => item.streamerId === profile.id),
    };
  }

  async findPlatformAccount(platform: StreamerPlatformType, platformUserId: string) {
    return (
      this.platformAccounts.find(
        (item) => item.platform === platform && item.platformUserId === platformUserId,
      ) ?? null
    );
  }

  async findPlatformAccountById(id: number) {
    return this.platformAccounts.find((item) => item.id === id) ?? null;
  }

  async upsertProfile(input: { userId: number; status: StreamerStatusType }) {
    const existing = await this.findProfileByUserId(input.userId);
    const now = "2026-08-31T00:00:00.000Z";
    if (existing) return existing;
    const profile: StreamerProfile = {
      id: this.nextProfileId++,
      userId: input.userId,
      status: input.status,
      suspendedUntil: null,
      rowVersion: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.profiles.set(profile.id, profile);
    return profile;
  }

  async addPlatformAccount(input: Parameters<StreamerRepository["addPlatformAccount"]>[0]) {
    return this.upsertPlatformAccount(input);
  }

  async upsertPlatformAccount(input: Parameters<StreamerRepository["upsertPlatformAccount"]>[0]) {
    const now = "2026-08-31T00:00:00.000Z";
    const existing = await this.findPlatformAccount(input.platform, input.platformUserId);
    const next: StreamerPlatformAccount = {
      id: existing?.id ?? this.nextAccountId++,
      streamerId: input.streamerId,
      platform: input.platform,
      platformUserId: input.platformUserId,
      channelName: input.channelName,
      channelHandle: input.channelHandle ?? null,
      channelUrl: input.channelUrl,
      avatarUrl: input.avatarUrl ?? null,
      verificationStatus: input.verificationStatus ?? "VERIFIED",
      verifiedAt: now,
      ownershipExpiresAt: input.ownershipExpiresAt ?? null,
      approvalStatus: existing?.approvalStatus ?? "PENDING",
      approvalReasonCode: existing?.approvalReasonCode ?? null,
      approvedAt: existing?.approvedAt ?? null,
      audienceCount: input.audienceCount ?? null,
      channelCreatedAt: input.channelCreatedAt ?? null,
      metricsSyncedAt: now,
      rowVersion: (existing?.rowVersion ?? -1) + 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (existing) {
      this.platformAccounts[this.platformAccounts.indexOf(existing)] = next;
    } else {
      this.platformAccounts.push(next);
    }
    return next;
  }

  async updatePlatformAccountMetrics(
    id: number,
    input: { audienceCount: number | null; channelCreatedAt: string | null; syncedAt: string },
  ) {
    const account = await this.findPlatformAccountById(id);
    if (!account) throw new Error("platform account not found");
    const updated = {
      ...account,
      audienceCount: input.audienceCount,
      channelCreatedAt: input.channelCreatedAt,
      metricsSyncedAt: input.syncedAt,
      updatedAt: input.syncedAt,
      rowVersion: account.rowVersion + 1,
    };
    this.platformAccounts[this.platformAccounts.indexOf(account)] = updated;
    return updated;
  }

  async getStreamerRankings(): Promise<{ entries: StreamerRankEntry[]; total: number }> {
    return { entries: [], total: 0 };
  }
}

class MemoryReviewRepo implements StreamerReviewRepository {
  reviews: StreamerReviewJob[] = [];

  async findActiveJobByAccountId(accountId: number) {
    return (
      this.reviews.find(
        (review) =>
          review.streamerPlatformAccountId === accountId &&
          (review.status === "QUEUED" || review.status === "ON_HOLD"),
      ) ?? null
    );
  }

  async createInitialReview(input: Parameters<StreamerReviewRepository["createInitialReview"]>[0]) {
    const existing = await this.findActiveJobByAccountId(input.streamerPlatformAccountId);
    if (existing) return existing;
    const review: StreamerReviewJob = {
      id: this.reviews.length + 1,
      streamerPlatformAccountId: input.streamerPlatformAccountId,
      reviewType: "INITIAL",
      status: "QUEUED",
      dueAt: input.dueAt,
      policyVersion: input.policyVersion,
      publicReasonCode: null,
      createdAt: input.nowIso,
      updatedAt: input.nowIso,
      completedAt: null,
      rowVersion: 0,
    };
    this.reviews.push(review);
    return review;
  }
}

class MemoryAdminRepo implements StreamerAdminRepository {
  async getActivePolicy() {
    return POLICY;
  }
  async isProviderConnectionPaused() {
    return false;
  }
  async getWorkspace(
    _query: StreamerAdminWorkspaceQuery,
    _reviewerUserId: number,
  ): Promise<StreamerAdminWorkspaceSnapshot> {
    throw new Error("not used");
  }
  async applyAction(_input: StreamerAdminActionInput): Promise<StreamerAdminActionResult> {
    throw new Error("not used");
  }
  async recordMetricRefresh(): Promise<StreamerAdminActionResult> {
    throw new Error("not used");
  }
}

function useCases(repo: MemoryStreamerRepo, reviews: MemoryReviewRepo) {
  return new StreamerUseCases(repo, reviews, undefined, new MemoryAdminRepo());
}

const youtube: StreamerChannelInfo = {
  platform: "YOUTUBE",
  platformUserId: "UC1234567890",
  channelName: "Test Gaming",
  channelHandle: "@testgaming",
  channelUrl: "https://youtube.com/@testgaming",
  avatarUrl: "https://example.com/avatar.png",
  audienceCount: 25_000,
  channelCreatedAt: "2020-01-01T00:00:00.000Z",
};

test("ownership verification creates a pending platform review, not an approved Streamer", async () => {
  const repo = new MemoryStreamerRepo();
  const reviews = new MemoryReviewRepo();
  const result = await useCases(repo, reviews).verifyChannelOwnership(
    101,
    youtube,
    new Date("2026-08-31T00:00:00.000Z"),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.profile.status, "UNVERIFIED");
  assert.equal(result.platformAccount.approvalStatus, "PENDING");
  assert.equal(result.review?.streamerPlatformAccountId, result.platformAccount.id);
  assert.equal(result.review?.policyVersion, POLICY.version);
  assert.equal(result.review?.dueAt, "2026-09-01T00:00:00.000Z");
  assert.equal(result.platformAccount.ownershipExpiresAt, "2027-02-27T00:00:00.000Z");
});

test("the same canonical channel cannot be connected by a second user", async () => {
  const repo = new MemoryStreamerRepo();
  const reviews = new MemoryReviewRepo();
  assert.equal((await useCases(repo, reviews).verifyChannelOwnership(1, youtube)).ok, true);

  const duplicate = await useCases(repo, reviews).verifyChannelOwnership(2, youtube);
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.equal(duplicate.code, "CHANNEL_ALREADY_VERIFIED");
});

test("an invalidated canonical channel keeps its original audit owner", async () => {
  const repo = new MemoryStreamerRepo();
  const reviews = new MemoryReviewRepo();
  const service = useCases(repo, reviews);
  const original = await service.verifyChannelOwnership(1, youtube);
  assert.equal(original.ok, true);
  if (!original.ok) return;
  repo.platformAccounts[0] = {
    ...original.platformAccount,
    verificationStatus: "REJECTED",
    ownershipExpiresAt: null,
  };

  const takeover = await service.verifyChannelOwnership(2, youtube);
  assert.equal(takeover.ok, false);
  if (!takeover.ok) assert.equal(takeover.code, "CHANNEL_ALREADY_VERIFIED");
  assert.equal(repo.platformAccounts[0]?.streamerId, original.profile.id);
});

test("one user cannot replace an already verified channel with another channel on the same platform", async () => {
  const repo = new MemoryStreamerRepo();
  const reviews = new MemoryReviewRepo();
  const service = useCases(repo, reviews);
  assert.equal((await service.verifyChannelOwnership(3, youtube)).ok, true);

  const conflicting = await service.verifyChannelOwnership(3, {
    ...youtube,
    platformUserId: "UC-DIFFERENT",
    channelName: "Different YouTube channel",
    channelUrl: "https://youtube.com/channel/UC-DIFFERENT",
  });

  assert.equal(conflicting.ok, false);
  if (!conflicting.ok) assert.equal(conflicting.code, "PLATFORM_ALREADY_CONNECTED");
  assert.equal(repo.platformAccounts.length, 1);
  assert.equal(reviews.reviews.length, 1);
});

test("re-verifying the same channel updates it without duplicating the active review", async () => {
  const repo = new MemoryStreamerRepo();
  const reviews = new MemoryReviewRepo();
  const service = useCases(repo, reviews);
  await service.verifyChannelOwnership(5, youtube);
  const result = await service.verifyChannelOwnership(5, { ...youtube, channelName: "New name" });

  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.platformAccount.channelName, "New name");
  assert.equal(reviews.reviews.length, 1);
});

test("re-verifying a rejected channel cannot bypass the reconsideration workflow", async () => {
  const repo = new MemoryStreamerRepo();
  const reviews = new MemoryReviewRepo();
  const service = useCases(repo, reviews);
  const first = await service.verifyChannelOwnership(7, youtube);
  assert.equal(first.ok, true);
  if (!first.ok) return;

  repo.platformAccounts[0] = {
    ...first.platformAccount,
    approvalStatus: "REJECTED",
    approvalReasonCode: "AUDIENCE_BELOW_POLICY",
  };
  reviews.reviews[0] = {
    ...reviews.reviews[0],
    status: "REJECTED",
    publicReasonCode: "AUDIENCE_BELOW_POLICY",
    completedAt: "2026-08-31T00:05:00.000Z",
  };

  const retried = await service.verifyChannelOwnership(7, youtube);
  assert.equal(retried.ok, true);
  if (!retried.ok) return;
  assert.equal(retried.platformAccount.approvalStatus, "REJECTED");
  assert.equal(retried.review, null);
  assert.equal(reviews.reviews.length, 1);
});

test("one user receives an independent review for every connected platform", async () => {
  const repo = new MemoryStreamerRepo();
  const reviews = new MemoryReviewRepo();
  const service = useCases(repo, reviews);
  await service.verifyChannelOwnership(9, youtube);
  await service.verifyChannelOwnership(9, {
    ...youtube,
    platform: "TWITCH",
    platformUserId: "twitch-9",
    channelName: "Twitch channel",
    channelUrl: "https://twitch.tv/channel9",
  });

  assert.equal(reviews.reviews.length, 2);
  assert.notEqual(
    reviews.reviews[0].streamerPlatformAccountId,
    reviews.reviews[1].streamerPlatformAccountId,
  );
});
