import test from "node:test";
import assert from "node:assert/strict";
import {
  StreamerUseCases,
  FEATURED_POLICY,
  type StreamerRepository,
  type StreamerProfile,
  type StreamerPlatformAccount,
  type StreamerPlatformType,
  type StreamerReviewJob,
  type StreamerReviewRepository,
  type StreamerChannelMetrics,
  type StreamerProviderAdapter,
  type StreamerChannelInfo,
} from "../src/index.js";

const NOW_MS = new Date("2026-06-01T00:00:00.000Z").getTime();
const NOW_ISO = new Date(NOW_MS).toISOString();

function isoDaysAgo(days: number): string {
  return new Date(NOW_MS - days * 86_400_000).toISOString();
}

class MemoryReviewRepo implements StreamerReviewRepository {
  public jobs: StreamerReviewJob[] = [];
  private nextId = 1;

  async findLatestJobByAccountIds(ids: number[]): Promise<StreamerReviewJob | null> {
    const candidates = this.jobs.filter((j) => ids.includes(j.streamerPlatformAccountId));
    if (candidates.length === 0) return null;
    return candidates.reduce((a, b) => (a.id > b.id ? a : b));
  }

  async findActiveJobByAccountId(id: number): Promise<StreamerReviewJob | null> {
    return (
      this.jobs.find(
        (j) =>
          j.streamerPlatformAccountId === id &&
          (j.status === "AUTO_REVIEW_PENDING" || j.status === "FAILED_RETRYABLE"),
      ) || null
    );
  }

  async createOrResetJob(input: {
    streamerPlatformAccountId: number;
    initialAudience: number | null;
    initialChannelCreatedAt: string | null;
    nextCheckAt: string;
  }): Promise<StreamerReviewJob> {
    const existing = await this.findActiveJobByAccountId(input.streamerPlatformAccountId);
    if (existing) {
      existing.initialAudience = input.initialAudience;
      existing.initialChannelCreatedAt = input.initialChannelCreatedAt;
      existing.nextCheckAt = input.nextCheckAt;
      existing.attemptCount = 0;
      existing.lastError = null;
      existing.updatedAt = NOW_ISO;
      return existing;
    }
    const job: StreamerReviewJob = {
      id: this.nextId++,
      streamerPlatformAccountId: input.streamerPlatformAccountId,
      reviewType: "ACQUISITION",
      status: "AUTO_REVIEW_PENDING",
      initialAudience: input.initialAudience,
      initialChannelCreatedAt: input.initialChannelCreatedAt,
      nextCheckAt: input.nextCheckAt,
      attemptCount: 0,
      lastError: null,
      reviewReason: null,
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
      completedAt: null,
    };
    this.jobs.push(job);
    return job;
  }

  async findLatestRevalidationJobByAccountId(id: number): Promise<StreamerReviewJob | null> {
    const candidates = this.jobs.filter(
      (j) => j.streamerPlatformAccountId === id && j.reviewType === "REVALIDATION",
    );
    return candidates.length > 0 ? candidates[candidates.length - 1] : null;
  }

  async scheduleRevalidationJob(input: {
    streamerPlatformAccountId: number;
    nextCheckAt: string;
    nowIso: string;
  }): Promise<StreamerReviewJob> {
    const existing = await this.findLatestRevalidationJobByAccountId(
      input.streamerPlatformAccountId,
    );
    if (
      existing &&
      (existing.status === "REVALIDATION_PENDING" ||
        existing.status === "REVALIDATION_FAILED_RETRYABLE" ||
        existing.status === "MANUAL_REVIEW")
    ) {
      return existing;
    }
    const job: StreamerReviewJob = {
      id: this.nextId++,
      streamerPlatformAccountId: input.streamerPlatformAccountId,
      reviewType: "REVALIDATION",
      status: "REVALIDATION_PENDING",
      initialAudience: null,
      initialChannelCreatedAt: null,
      nextCheckAt: input.nextCheckAt,
      attemptCount: 0,
      lastError: null,
      reviewReason: null,
      createdAt: input.nowIso,
      updatedAt: input.nowIso,
      completedAt: null,
    };
    this.jobs.push(job);
    return job;
  }

  async ensureRevalidationJobs(): Promise<number> {
    return 0;
  }

  async listDuePendingJobs(limit: number, nowIso: string): Promise<StreamerReviewJob[]> {
    return this.jobs
      .filter(
        (j) =>
          (j.status === "AUTO_REVIEW_PENDING" || j.status === "FAILED_RETRYABLE") &&
          j.nextCheckAt <= nowIso,
      )
      .slice(0, limit);
  }

  async listDueRevalidationJobs(limit: number, nowIso: string): Promise<StreamerReviewJob[]> {
    return this.jobs
      .filter(
        (j) =>
          j.reviewType === "REVALIDATION" &&
          (j.status === "REVALIDATION_PENDING" || j.status === "REVALIDATION_FAILED_RETRYABLE") &&
          j.nextCheckAt <= nowIso,
      )
      .slice(0, limit);
  }

  async markJobFailed(
    id: number,
    error: string,
    nextCheckAt: string,
    nowIso: string,
  ): Promise<void> {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return;
    job.status =
      job.reviewType === "REVALIDATION" ? "REVALIDATION_FAILED_RETRYABLE" : "FAILED_RETRYABLE";
    job.attemptCount += 1;
    job.lastError = error;
    job.nextCheckAt = nextCheckAt;
    job.updatedAt = nowIso;
  }

  async completeJob(
    id: number,
    status: Exclude<StreamerReviewJob["status"], "AUTO_REVIEW_PENDING" | "FAILED_RETRYABLE">,
    completedAt: string,
    reason?: string,
  ): Promise<boolean> {
    const job = this.jobs.find((j) => j.id === id);
    if (
      !job ||
      job.status === "FEATURED" ||
      job.status === "NOT_ELIGIBLE" ||
      job.status === "MANUAL_REVIEW"
    ) {
      return false;
    }
    job.status = status;
    job.reviewReason = reason ?? job.reviewReason;
    job.completedAt = completedAt;
    job.updatedAt = completedAt;
    return true;
  }

  async listManualReviewQueue(): Promise<{ items: never[]; total: number }> {
    return { items: [], total: 0 };
  }

  async listAuditLogs(): Promise<{ entries: never[]; total: number }> {
    return { entries: [], total: 0 };
  }

  async applyManualReviewDecision(): Promise<{
    applied: false;
    code: "NOT_FOUND";
    previousStatus: null;
    newStatus: null;
  }> {
    return { applied: false, code: "NOT_FOUND", previousStatus: null, newStatus: null };
  }
}

class FakeProvider implements StreamerProviderAdapter {
  constructor(
    public platform: StreamerPlatformType,
    private metrics?: StreamerChannelMetrics,
    private refreshSupported = true,
    private failWith?: string,
  ) {}

  isConfigured(): boolean {
    return true;
  }

  getAuthorizeUrl(state: string, redirectUri: string): string {
    return `https://fake/${this.platform}?state=${state}&redirect=${redirectUri}`;
  }

  async verifyOwnershipCode(_code: string, _redirectUri: string): Promise<StreamerChannelInfo> {
    return {
      platform: this.platform,
      platformUserId: "fake_channel",
      channelName: "Fake Channel",
      channelHandle: null,
      channelUrl: "https://fake/channel",
      avatarUrl: null,
      audienceCount: 15000,
      channelCreatedAt: isoDaysAgo(400),
    };
  }

  supportsAutomaticMetricRefresh(): boolean {
    return this.refreshSupported;
  }

  async fetchChannelMetrics(_platformUserId: string): Promise<StreamerChannelMetrics> {
    if (this.failWith) throw new Error(this.failWith);
    if (!this.metrics) {
      return { audienceCount: 15000, channelCreatedAt: isoDaysAgo(400) };
    }
    return this.metrics;
  }
}

function makeAdapters(
  overrides: Partial<Record<StreamerPlatformType, FakeProvider>> = {},
): Record<StreamerPlatformType, StreamerProviderAdapter> {
  const base: Record<StreamerPlatformType, FakeProvider> = {
    YOUTUBE: new FakeProvider("YOUTUBE"),
    TWITCH: new FakeProvider("TWITCH"),
    CHZZK: new FakeProvider("CHZZK"),
    SOOP: new FakeProvider("SOOP"),
  };
  return { ...base, ...overrides };
}

// Reuse the in-memory streamer repo from streamerOwnership tests (minimal duplicate).
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
    status: "UNVERIFIED" | "VERIFIED" | "SUSPENDED";
    featuredStatus?: "NONE" | "FEATURED" | "PARTNER";
    featuredReason?: string | null;
  }): Promise<StreamerProfile> {
    const now = NOW_ISO;
    const existing = await this.findProfileByUserId(input.userId);
    if (existing) {
      const updated: StreamerProfile = {
        ...existing,
        status: input.status,
        featuredStatus: input.featuredStatus ?? existing.featuredStatus,
        featuredReason: input.featuredReason ?? existing.featuredReason,
        featuredSince:
          input.featuredStatus === "FEATURED"
            ? (existing.featuredSince ?? now)
            : input.featuredStatus === "NONE"
              ? null
              : existing.featuredSince,
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
      featuredSince: input.featuredStatus === "FEATURED" ? now : null,
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
    const now = NOW_ISO;
    const existingIdx = this.platformAccounts.findIndex(
      (a) => a.platform === input.platform && a.platformUserId === input.platformUserId,
    );
    if (existingIdx >= 0) {
      this.platformAccounts[existingIdx] = {
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
      return this.platformAccounts[existingIdx];
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

  async getStreamerRankings(): Promise<{ entries: never[]; total: number }> {
    return { entries: [], total: 0 };
  }
}

async function setupVerifiedAccount(
  repo: MemoryStreamerRepo,
  reviewRepo: MemoryReviewRepo,
  userId: number,
  opts: { audienceCount: number; channelCreatedAt: string } = {
    audienceCount: 15000,
    channelCreatedAt: isoDaysAgo(400),
  },
): Promise<{ useCases: StreamerUseCases; account: StreamerPlatformAccount }> {
  const useCases = new StreamerUseCases(repo, reviewRepo);
  const profile = await repo.upsertProfile({ userId, status: "VERIFIED" });
  const account = await repo.addPlatformAccount({
    streamerId: profile.id,
    platform: "YOUTUBE",
    platformUserId: `yt_${userId}`,
    channelName: `Channel ${userId}`,
    channelUrl: `https://youtube.com/@c${userId}`,
    audienceCount: opts.audienceCount,
    channelCreatedAt: opts.channelCreatedAt,
  });
  // 소유권 인증 시 createOrResetJob이 생성하는 잡과 동일하게, 예정 시각이 지난 상태로 생성
  await reviewRepo.createOrResetJob({
    streamerPlatformAccountId: account.id,
    initialAudience: opts.audienceCount,
    initialChannelCreatedAt: opts.channelCreatedAt,
    nextCheckAt: NOW_ISO,
  });
  return { useCases, account };
}

test("verifyChannelOwnership — qualified snapshot schedules AUTO_REVIEW_PENDING job (never FEATURED)", async () => {
  const repo = new MemoryStreamerRepo();
  const reviewRepo = new MemoryReviewRepo();
  const useCases = new StreamerUseCases(repo, reviewRepo);

  const res = await useCases.verifyChannelOwnership(101, {
    platform: "YOUTUBE",
    platformUserId: "UC123",
    channelName: "Test Gaming",
    channelHandle: null,
    channelUrl: "https://youtube.com/@testgaming",
    avatarUrl: null,
    audienceCount: 25000,
    channelCreatedAt: isoDaysAgo(200),
  });

  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.profile.featuredStatus, "NONE");
  assert.equal(res.featuredReview?.status, "AUTO_REVIEW_PENDING");
  assert.ok(
    res.featuredReview && res.featuredReview.nextCheckAt > new Date().toISOString(),
    "next check must be scheduled in the future",
  );
});

test("runDueFeaturedReviews — qualified recheck promotes profile to FEATURED and refreshes metrics", async () => {
  const repo = new MemoryStreamerRepo();
  const reviewRepo = new MemoryReviewRepo();
  const { useCases, account } = await setupVerifiedAccount(repo, reviewRepo, 7);

  const now = new Date(NOW_MS);
  const summary = await useCases.runDueFeaturedReviews({
    adapters: makeAdapters(),
    now,
    batchSize: 10,
  });

  assert.equal(summary.processed, 1);
  assert.equal(summary.featured, 1);
  assert.equal(summary.notEligible, 0);
  assert.equal(summary.manualReview, 0);
  assert.equal(summary.failed, 0);

  const profile = await repo.findProfileByUserId(7);
  assert.equal(profile?.featuredStatus, "FEATURED");
  assert.equal(profile?.featuredSince, NOW_ISO);

  const updated = await repo.findPlatformAccountById(account.id);
  assert.equal(updated?.audienceCount, 15000);
  assert.equal(updated?.metricsSyncedAt, NOW_ISO);

  const job = await reviewRepo.findLatestJobByAccountIds([account.id]);
  assert.equal(job?.status, "REVALIDATION_PENDING");
  assert.equal(
    reviewRepo.jobs.find(
      (candidate) =>
        candidate.streamerPlatformAccountId === account.id &&
        candidate.reviewType === "ACQUISITION",
    )?.status,
    "FEATURED",
  );
});

// ACQUISITION_AUDIENCE_MIN / ACQUISITION_CHANNEL_AGE_MIN_DAYS are TEMPORARILY 0 (see
// featuredPolicy.ts, 운영자 지시 2026-08-14), so a below-auto-threshold audience now routes to
// MANUAL_REVIEW instead of NOT_ELIGIBLE — nobody is silently rejected during the testing phase.
test("runDueFeaturedReviews — audience below auto threshold → MANUAL_REVIEW, badge not granted", async () => {
  const repo = new MemoryStreamerRepo();
  const reviewRepo = new MemoryReviewRepo();
  const { useCases, account } = await setupVerifiedAccount(repo, reviewRepo, 8);

  await useCases.runDueFeaturedReviews({
    adapters: makeAdapters({
      YOUTUBE: new FakeProvider("YOUTUBE", {
        audienceCount: 3000,
        channelCreatedAt: isoDaysAgo(400),
      }),
    }),
    now: new Date(NOW_MS),
    batchSize: 10,
  });

  const profile = await repo.findProfileByUserId(8);
  assert.equal(profile?.featuredStatus, "NONE");
  assert.match(profile?.featuredReason ?? "", /추가 확인/);
  const job = await reviewRepo.findLatestJobByAccountIds([account.id]);
  assert.equal(job?.status, "MANUAL_REVIEW");
});

test("runDueFeaturedReviews — missing metrics → MANUAL_REVIEW without guessing", async () => {
  const repo = new MemoryStreamerRepo();
  const reviewRepo = new MemoryReviewRepo();
  const { useCases, account } = await setupVerifiedAccount(repo, reviewRepo, 9);

  await useCases.runDueFeaturedReviews({
    adapters: makeAdapters({
      YOUTUBE: new FakeProvider("YOUTUBE", {
        audienceCount: null,
        channelCreatedAt: isoDaysAgo(400),
      }),
    }),
    now: new Date(NOW_MS),
    batchSize: 10,
  });

  const profile = await repo.findProfileByUserId(9);
  assert.equal(profile?.featuredStatus, "NONE");
  assert.match(profile?.featuredReason ?? "", /추가 확인/);
  const job = await reviewRepo.findLatestJobByAccountIds([account.id]);
  assert.equal(job?.status, "MANUAL_REVIEW");
});

test("runDueFeaturedReviews — unsupported automatic refresh platform → MANUAL_REVIEW", async () => {
  const repo = new MemoryStreamerRepo();
  const reviewRepo = new MemoryReviewRepo();
  const { useCases, account } = await setupVerifiedAccount(repo, reviewRepo, 10);

  await useCases.runDueFeaturedReviews({
    adapters: makeAdapters({ YOUTUBE: new FakeProvider("YOUTUBE", undefined, false) }),
    now: new Date(NOW_MS),
    batchSize: 10,
  });

  const profile = await repo.findProfileByUserId(10);
  assert.equal(profile?.featuredStatus, "NONE");
  assert.match(profile?.featuredReason ?? "", /미지원/);
  const job = await reviewRepo.findLatestJobByAccountIds([account.id]);
  assert.equal(job?.status, "MANUAL_REVIEW");
});

test("runDueFeaturedReviews — single provider failure is isolated and retried as FAILED_RETRYABLE", async () => {
  const repo = new MemoryStreamerRepo();
  const reviewRepo = new MemoryReviewRepo();
  const { useCases, account } = await setupVerifiedAccount(repo, reviewRepo, 11);

  const summary = await useCases.runDueFeaturedReviews({
    adapters: makeAdapters({ YOUTUBE: new FakeProvider("YOUTUBE", undefined, true, "api down") }),
    now: new Date(NOW_MS),
    batchSize: 10,
  });

  assert.equal(summary.processed, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.featured, 0);

  const job = await reviewRepo.findLatestJobByAccountIds([account.id]);
  assert.equal(job?.status, "FAILED_RETRYABLE");
  assert.equal(job?.attemptCount, 1);
  assert.match(job?.lastError ?? "", /api down/);
  assert.equal(
    job?.nextCheckAt,
    new Date(NOW_MS + FEATURED_POLICY.RETRY_INTERVAL_MS).toISOString(),
  );
});

test("runDueFeaturedReviews — retries exhausted → MANUAL_REVIEW", async () => {
  const repo = new MemoryStreamerRepo();
  const reviewRepo = new MemoryReviewRepo();
  const { useCases, account } = await setupVerifiedAccount(repo, reviewRepo, 12);

  for (let i = 0; i < FEATURED_POLICY.MAX_ATTEMPTS - 1; i++) {
    await useCases.runDueFeaturedReviews({
      adapters: makeAdapters({ YOUTUBE: new FakeProvider("YOUTUBE", undefined, true, "api down") }),
      now: new Date(NOW_MS + i * FEATURED_POLICY.RETRY_INTERVAL_MS),
      batchSize: 10,
    });
  }

  const jobBefore = await reviewRepo.findLatestJobByAccountIds([account.id]);
  assert.equal(jobBefore?.status, "FAILED_RETRYABLE");
  assert.equal(jobBefore?.attemptCount, FEATURED_POLICY.MAX_ATTEMPTS - 1);

  await useCases.runDueFeaturedReviews({
    adapters: makeAdapters({ YOUTUBE: new FakeProvider("YOUTUBE", undefined, true, "api down") }),
    now: new Date(NOW_MS + (FEATURED_POLICY.MAX_ATTEMPTS - 1) * FEATURED_POLICY.RETRY_INTERVAL_MS),
    batchSize: 10,
  });

  const job = await reviewRepo.findLatestJobByAccountIds([account.id]);
  assert.equal(job?.status, "MANUAL_REVIEW");
  const profile = await repo.findProfileByUserId(12);
  assert.match(profile?.featuredReason ?? "", /재시도 횟수 초과/);
});

test("runDueFeaturedReviews — duplicate run is idempotent (completed jobs are skipped)", async () => {
  const repo = new MemoryStreamerRepo();
  const reviewRepo = new MemoryReviewRepo();
  const { useCases, account } = await setupVerifiedAccount(repo, reviewRepo, 13);

  await useCases.runDueFeaturedReviews({
    adapters: makeAdapters(),
    now: new Date(NOW_MS),
    batchSize: 10,
  });
  const first = await reviewRepo.findLatestJobByAccountIds([account.id]);
  assert.equal(first?.status, "REVALIDATION_PENDING");

  const summary2 = await useCases.runDueFeaturedReviews({
    adapters: makeAdapters(),
    now: new Date(NOW_MS),
    batchSize: 10,
  });
  assert.equal(summary2.processed, 0);
});

test("runDueFeaturedReviews — unverified account can never become Featured", async () => {
  const repo = new MemoryStreamerRepo();
  const reviewRepo = new MemoryReviewRepo();
  const useCases = new StreamerUseCases(repo, reviewRepo);
  const profile = await repo.upsertProfile({ userId: 14, status: "UNVERIFIED" });
  const account = await repo.addPlatformAccount({
    streamerId: profile.id,
    platform: "YOUTUBE",
    platformUserId: "yt_14",
    channelName: "Unverified",
    channelUrl: "https://youtube.com/@u14",
    verificationStatus: "PENDING",
  });
  await reviewRepo.createOrResetJob({
    streamerPlatformAccountId: account.id,
    initialAudience: 99999,
    initialChannelCreatedAt: isoDaysAgo(500),
    nextCheckAt: NOW_ISO,
  });

  const summary = await useCases.runDueFeaturedReviews({
    adapters: makeAdapters(),
    now: new Date(NOW_MS),
    batchSize: 10,
  });
  assert.equal(summary.notEligible, 1);
  assert.equal(summary.featured, 0);

  const profileAfter = await repo.findProfileByUserId(14);
  assert.equal(profileAfter?.featuredStatus, "NONE");
  assert.match(profileAfter?.featuredReason ?? "", /소유권이 검증되지 않/);
});

test("getFeaturedReviewState — returns latest job for profile presentation", async () => {
  const repo = new MemoryStreamerRepo();
  const reviewRepo = new MemoryReviewRepo();
  const { useCases, account } = await setupVerifiedAccount(repo, reviewRepo, 15);

  const state = await useCases.getFeaturedReviewState(15);
  assert.equal(state?.streamerPlatformAccountId, account.id);
  assert.equal(state?.status, "AUTO_REVIEW_PENDING");
});

test("Featured processing never touches scores, XP or ranking inputs", async () => {
  const repo = new MemoryStreamerRepo();
  const reviewRepo = new MemoryReviewRepo();
  const { useCases } = await setupVerifiedAccount(repo, reviewRepo, 16);

  await useCases.runDueFeaturedReviews({
    adapters: makeAdapters(),
    now: new Date(NOW_MS),
    batchSize: 10,
  });

  const rankings = await useCases.getStreamerRankings({ mode: "score" });
  assert.equal(rankings.total, 0);
  const profile = await repo.findProfileByUserId(16);
  assert.equal(profile?.featuredStatus, "FEATURED");
});

async function setupFeaturedForRevalidation(userId: number) {
  const repo = new MemoryStreamerRepo();
  const reviewRepo = new MemoryReviewRepo();
  const { useCases, account } = await setupVerifiedAccount(repo, reviewRepo, userId);
  await useCases.runDueFeaturedReviews({
    adapters: makeAdapters(),
    now: new Date(NOW_MS),
    batchSize: 10,
  });
  const revalidationJob = reviewRepo.jobs.find(
    (job) => job.streamerPlatformAccountId === account.id && job.reviewType === "REVALIDATION",
  );
  assert.ok(revalidationJob);
  revalidationJob.nextCheckAt = NOW_ISO;
  return { repo, reviewRepo, useCases, account, revalidationJob };
}

test("runDueFeaturedRevalidations — fresh audience >= 8,000 retains Featured and schedules next cadence", async () => {
  const { repo, reviewRepo, useCases, account } = await setupFeaturedForRevalidation(30);
  const summary = await useCases.runDueFeaturedRevalidations({
    adapters: makeAdapters({
      YOUTUBE: new FakeProvider("YOUTUBE", {
        audienceCount: 8000,
        channelCreatedAt: isoDaysAgo(500),
        channelState: "ACTIVE",
      }),
    }),
    now: new Date(NOW_MS),
    batchSize: 10,
  });

  assert.deepEqual(summary, { processed: 1, retained: 1, revoked: 0, manualReview: 0, failed: 0 });
  assert.equal((await repo.findProfileByUserId(30))?.featuredStatus, "FEATURED");
  assert.equal(
    reviewRepo.jobs.filter(
      (job) => job.streamerPlatformAccountId === account.id && job.reviewType === "REVALIDATION",
    ).length,
    2,
  );
});

// RETENTION_AUDIENCE_FLOOR is TEMPORARILY 0 (see featuredPolicy.ts, 운영자 지시 2026-08-14), so a
// manually-approved low-subscriber test account is retained rather than auto-revoked at the
// 14-day revalidation checkpoint.
test("runDueFeaturedRevalidations — fresh audience below normal 8,000 floor still retains Featured (floor temporarily 0)", async () => {
  const { repo, useCases } = await setupFeaturedForRevalidation(31);
  const summary = await useCases.runDueFeaturedRevalidations({
    adapters: makeAdapters({
      YOUTUBE: new FakeProvider("YOUTUBE", {
        audienceCount: 7999,
        channelCreatedAt: isoDaysAgo(500),
        channelState: "ACTIVE",
      }),
    }),
    now: new Date(NOW_MS),
    batchSize: 10,
  });

  assert.equal(summary.retained, 1);
  const profile = await repo.findProfileByUserId(31);
  assert.equal(profile?.featuredStatus, "FEATURED");
});

test("runDueFeaturedRevalidations — temporary provider error preserves Featured and retries", async () => {
  const { repo, reviewRepo, useCases, account } = await setupFeaturedForRevalidation(32);
  const summary = await useCases.runDueFeaturedRevalidations({
    adapters: makeAdapters({
      YOUTUBE: new FakeProvider("YOUTUBE", undefined, true, "temporary outage"),
    }),
    now: new Date(NOW_MS),
    batchSize: 10,
  });

  assert.equal(summary.failed, 1);
  assert.equal((await repo.findProfileByUserId(32))?.featuredStatus, "FEATURED");
  assert.equal(
    reviewRepo.jobs.find(
      (job) => job.streamerPlatformAccountId === account.id && job.reviewType === "REVALIDATION",
    )?.status,
    "REVALIDATION_FAILED_RETRYABLE",
  );
});

test("runDueFeaturedRevalidations — unavailable metric routes to manual review without stripping badge", async () => {
  const { repo, reviewRepo, useCases, account } = await setupFeaturedForRevalidation(33);
  const summary = await useCases.runDueFeaturedRevalidations({
    adapters: makeAdapters({
      YOUTUBE: new FakeProvider("YOUTUBE", {
        audienceCount: null,
        channelCreatedAt: null,
        channelState: "ACTIVE",
      }),
    }),
    now: new Date(NOW_MS),
    batchSize: 10,
  });

  assert.equal(summary.manualReview, 1);
  assert.equal((await repo.findProfileByUserId(33))?.featuredStatus, "FEATURED");
  assert.equal(
    reviewRepo.jobs.find(
      (job) => job.streamerPlatformAccountId === account.id && job.reviewType === "REVALIDATION",
    )?.status,
    "MANUAL_REVIEW",
  );
});

test("runDueFeaturedRevalidations — authoritative deleted channel revokes eligibility", async () => {
  const { repo, useCases } = await setupFeaturedForRevalidation(34);
  const summary = await useCases.runDueFeaturedRevalidations({
    adapters: makeAdapters({
      YOUTUBE: new FakeProvider("YOUTUBE", {
        audienceCount: null,
        channelCreatedAt: null,
        channelState: "NOT_FOUND",
      }),
    }),
    now: new Date(NOW_MS),
    batchSize: 10,
  });

  assert.equal(summary.revoked, 1);
  assert.equal((await repo.findProfileByUserId(34))?.featuredStatus, "NONE");
});

test("runDueFeaturedRevalidations — bounded and idempotent after a completed revalidation", async () => {
  const { useCases } = await setupFeaturedForRevalidation(35);
  const adapters = makeAdapters();
  const first = await useCases.runDueFeaturedRevalidations({
    adapters,
    now: new Date(NOW_MS),
    batchSize: 1,
  });
  const second = await useCases.runDueFeaturedRevalidations({
    adapters,
    now: new Date(NOW_MS),
    batchSize: 1,
  });
  assert.equal(first.processed, 1);
  assert.equal(second.processed, 0);
});
