import { levelForTotalXp } from "../domain/progression.js";
import type { PublicGameCatalog } from "./publicGameCatalog.js";
import {
  FEATURED_POLICY,
  evaluateFeaturedInitial,
  evaluateFeaturedRevalidation,
  evaluateFeaturedRecheck,
  type FeaturedReviewStatus,
  type FeaturedRevalidationDecision,
  type RecheckFeaturedDecision,
} from "../domain/featuredPolicy.js";
import type {
  StreamerReviewAction,
  StreamerManualReviewDecisionResult,
  StreamerReviewAuditResult,
  StreamerRepository,
  StreamerRankEntry,
  StreamerPlatformType,
  StreamerProfile,
  StreamerPlatformAccount,
  StreamerReviewRepository,
  StreamerReviewJob,
  StreamerReviewQueueResult,
} from "../ports/repositories.js";
import type { StreamerChannelInfo, StreamerProviderAdapter } from "../ports/streamerProvider.js";

export interface FeaturedReviewRunSummary {
  processed: number;
  featured: number;
  notEligible: number;
  manualReview: number;
  failed: number;
}

export interface FeaturedRevalidationRunSummary {
  processed: number;
  retained: number;
  revoked: number;
  manualReview: number;
  failed: number;
}

export class StreamerUseCases {
  constructor(
    private streamerRepo: StreamerRepository,
    private reviewRepo?: StreamerReviewRepository,
    private games?: PublicGameCatalog,
  ) {}

  async getStreamerRankings(options: {
    mode: "score" | "xp";
    gameId?: string;
    platform?: StreamerPlatformType;
    limit?: number;
    offset?: number;
  }): Promise<{ entries: StreamerRankEntry[]; total: number }> {
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const offset = Math.max(options.offset ?? 0, 0);

    const selectedGameId = options.gameId && options.gameId !== "all" ? options.gameId : undefined;
    const games = this.games ? await this.games.list() : [];
    const gamesBySlug = new Map(games.map((game) => [game.identity.slug, game]));
    const selectedGame = selectedGameId ? gamesBySlug.get(selectedGameId) : undefined;
    const direction = selectedGame?.canonical.policy.score?.direction ?? "desc";

    const queryOpts: {
      mode: "score" | "xp";
      gameId?: string;
      direction?: "asc" | "desc";
      rulesetRevision?: number;
      platform?: StreamerPlatformType;
      limit?: number;
      offset?: number;
    } = {
      mode: options.mode,
      direction,
      limit,
      offset,
    };
    if (selectedGameId !== undefined) queryOpts.gameId = selectedGameId;
    if (selectedGame !== undefined) {
      queryOpts.rulesetRevision = selectedGame.canonical.playConfig?.rulesetRevision ?? 1;
    }
    if (options.platform !== undefined) queryOpts.platform = options.platform;

    const res = await this.streamerRepo.getStreamerRankings(queryOpts);

    const entries: StreamerRankEntry[] = res.entries.map((entry) => {
      if (options.mode === "score" && entry.gameId && entry.score !== undefined) {
        const game = gamesBySlug.get(entry.gameId);
        const score = game?.canonical.policy.score;
        const formattedScore = score
          ? `${score.displayPrefix ?? ""}${entry.score.toLocaleString()}${score.displaySuffix ?? ` ${score.unit}`}`
          : String(entry.score);
        return {
          ...entry,
          formattedScore,
          gameTitle: game?.canonical.title ?? entry.gameId,
        };
      } else if (options.mode === "xp" && entry.totalXp !== undefined) {
        const level = levelForTotalXp(entry.totalXp);
        return {
          ...entry,
          level,
        };
      }
      return entry;
    });

    return { entries, total: res.total };
  }

  async getStreamerProfileByUserId(
    userId: number,
  ): Promise<(StreamerProfile & { platformAccounts: StreamerPlatformAccount[] }) | null> {
    return this.streamerRepo.findProfileByUserId(userId);
  }

  /**
   * 프로필 단위로 가장 최근 Featured 심사/재심사 잡을 반환합니다 (UI 상태 표시용).
   */
  async getFeaturedReviewState(userId: number): Promise<StreamerReviewJob | null> {
    if (!this.reviewRepo) return null;
    const profile = await this.streamerRepo.findProfileByUserId(userId);
    if (!profile || profile.platformAccounts.length === 0) return null;
    return this.reviewRepo.findLatestJobByAccountIds(profile.platformAccounts.map((a) => a.id));
  }

  async listManualStreamerReviews(options: {
    limit?: number;
    offset?: number;
  }): Promise<StreamerReviewQueueResult & { audits: StreamerReviewAuditResult }> {
    if (!this.reviewRepo) {
      return { items: [], total: 0, audits: { entries: [], total: 0 } };
    }

    const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
    const offset = Math.max(options.offset ?? 0, 0);
    const [queue, audits] = await Promise.all([
      this.reviewRepo.listManualReviewQueue(limit, offset),
      this.reviewRepo.listAuditLogs(20, 0),
    ]);
    return { ...queue, audits };
  }

  async applyManualStreamerReview(input: {
    jobId: number;
    reviewerUserId: number;
    action: StreamerReviewAction;
    reason: string;
    now?: Date;
  }): Promise<StreamerManualReviewDecisionResult> {
    const reason = input.reason.trim();
    if (reason.length < 3) {
      return {
        applied: false,
        code: "INVALID_REASON",
        previousStatus: null,
        newStatus: null,
      };
    }
    if (!this.reviewRepo) {
      return {
        applied: false,
        code: "NOT_FOUND",
        previousStatus: null,
        newStatus: null,
      };
    }

    const nowMs = input.now?.getTime() ?? Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const publicProfileReason =
      input.action === "APPROVE_FEATURED"
        ? "운영진 심사 승인"
        : input.action === "REJECT_FEATURED"
          ? "운영진 심사 결과 기준 미달"
          : "운영진 추가 확인 대기";

    return this.reviewRepo.applyManualReviewDecision({
      jobId: input.jobId,
      reviewerUserId: input.reviewerUserId,
      action: input.action,
      reason,
      publicProfileReason,
      nextRevalidationAt: new Date(nowMs + FEATURED_POLICY.REVALIDATION_INTERVAL_MS).toISOString(),
      nowIso,
    });
  }

  async verifyChannelOwnership(
    userId: number,
    channelInfo: StreamerChannelInfo,
  ): Promise<
    | {
        ok: true;
        profile: StreamerProfile;
        platformAccount: StreamerPlatformAccount;
        featuredReview: StreamerReviewJob | null;
      }
    | {
        ok: false;
        code: string;
        message: string;
      }
  > {
    // 1. Single-owner invariant: Check if another OwOGG user has ALREADY verified this identical platform + platformUserId channel
    const existingPlatformAcc = await this.streamerRepo.findPlatformAccount(
      channelInfo.platform,
      channelInfo.platformUserId,
    );

    if (existingPlatformAcc && existingPlatformAcc.verificationStatus === "VERIFIED") {
      const existingProfile = await this.streamerRepo.findProfileById(
        existingPlatformAcc.streamerId,
      );
      if (existingProfile && existingProfile.userId !== userId) {
        return {
          ok: false,
          code: "CHANNEL_ALREADY_VERIFIED",
          message: "이 채널은 이미 다른 OwOGG 스트리머 계정에 연동되어 있습니다.",
        };
      }
    }

    // 2. Ensure Streamer profile exists / is updated for this user (status: 'VERIFIED')
    const profile = await this.streamerRepo.upsertProfile({
      userId,
      status: "VERIFIED",
    });

    // 3. Upsert platform account for this streamer with canonical ID.
    // Absent audienceCount in the provider snapshot = UNKNOWN, never a known zero — the
    // property is omitted entirely rather than passed as `undefined` (exactOptionalPropertyTypes).
    const platformAccount = await this.streamerRepo.upsertPlatformAccount({
      streamerId: profile.id,
      platform: channelInfo.platform,
      platformUserId: channelInfo.platformUserId,
      channelName: channelInfo.channelName,
      channelHandle: channelInfo.channelHandle,
      channelUrl: channelInfo.channelUrl,
      avatarUrl: channelInfo.avatarUrl,
      verificationStatus: "VERIFIED",
      ...(channelInfo.audienceCount !== undefined
        ? { audienceCount: channelInfo.audienceCount }
        : {}),
      channelCreatedAt: channelInfo.channelCreatedAt ?? null,
    });

    // 4. Featured qualification: 평가는 소유권 스냅샷만으로 FEATURED를 부여하지 않고,
    //    AUTO_REVIEW_PENDING / MANUAL_REVIEW / NOT_ELIGIBLE만 결정합니다.
    let featuredReview: StreamerReviewJob | null = null;
    if (this.reviewRepo) {
      const decision = evaluateFeaturedInitial({
        ownershipVerified: true,
        audienceCount: channelInfo.audienceCount !== undefined ? channelInfo.audienceCount : null,
        channelCreatedAt: channelInfo.channelCreatedAt ?? null,
      });

      featuredReview = await this.reviewRepo.createOrResetJob({
        streamerPlatformAccountId: platformAccount.id,
        initialAudience: channelInfo.audienceCount !== undefined ? channelInfo.audienceCount : null,
        initialChannelCreatedAt: channelInfo.channelCreatedAt ?? null,
        nextCheckAt: new Date(Date.now() + FEATURED_POLICY.REVIEW_INTERVAL_MS).toISOString(),
      });

      await this.streamerRepo.upsertProfile({
        userId,
        status: "VERIFIED",
        featuredReason: decision.reason,
      });
    }

    return {
      ok: true,
      profile,
      platformAccount,
      featuredReview,
    };
  }

  /**
   * 스케줄러(6시간) 진입점: 예정 시각이 지난 AUTO_REVIEW_PENDING / FAILED_RETRYABLE 잡을
   * 바운디드 배치로 처리합니다. 단일 잡/프로바이더 실패가 나머지 잡 처리를 막지 않습니다.
   */
  async runDueFeaturedReviews(options: {
    adapters: Record<StreamerPlatformType, StreamerProviderAdapter>;
    now?: Date;
    batchSize?: number;
  }): Promise<FeaturedReviewRunSummary> {
    if (!this.reviewRepo) {
      return { processed: 0, featured: 0, notEligible: 0, manualReview: 0, failed: 0 };
    }

    const nowMs = options.now?.getTime() ?? Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const batchSize = Math.min(
      Math.max(options.batchSize ?? FEATURED_POLICY.DEFAULT_BATCH_SIZE, 1),
      FEATURED_POLICY.MAX_BATCH_SIZE,
    );

    const jobs = await this.reviewRepo.listDuePendingJobs(batchSize, nowIso);
    const summary: FeaturedReviewRunSummary = {
      processed: jobs.length,
      featured: 0,
      notEligible: 0,
      manualReview: 0,
      failed: 0,
    };

    for (const job of jobs) {
      try {
        const outcome = await this.processReviewJob(job, options.adapters, nowMs);
        if (outcome === "FEATURED") summary.featured += 1;
        else if (outcome === "NOT_ELIGIBLE") summary.notEligible += 1;
        else if (outcome === "MANUAL_REVIEW") summary.manualReview += 1;
        else summary.failed += 1;
      } catch (err) {
        summary.failed += 1;
        const message = err instanceof Error ? err.message : String(err);
        const nextCheckAt = new Date(nowMs + FEATURED_POLICY.RETRY_INTERVAL_MS).toISOString();

        if (job.attemptCount + 1 >= FEATURED_POLICY.MAX_ATTEMPTS) {
          await this.completeAndSetProfileReason(
            job,
            "MANUAL_REVIEW",
            nowIso,
            "자동 심사 재시도 횟수 초과로 추가 확인이 필요합니다.",
          );
        } else {
          await this.reviewRepo.markJobFailed(job.id, message, nextCheckAt, nowIso);
        }
      }
    }

    return summary;
  }

  private async processReviewJob(
    job: StreamerReviewJob,
    adapters: Record<StreamerPlatformType, StreamerProviderAdapter>,
    nowMs: number,
  ): Promise<RecheckFeaturedDecision | "FAILED_RETRYABLE"> {
    const nowIso = new Date(nowMs).toISOString();
    const reviewRepo = this.reviewRepo;
    if (!reviewRepo) return "FAILED_RETRYABLE";

    const account = await this.streamerRepo.findPlatformAccountById(job.streamerPlatformAccountId);
    if (!account) {
      await this.completeAndSetProfileReason(
        job,
        "NOT_ELIGIBLE",
        nowIso,
        "채널 계정이 존재하지 않습니다.",
      );
      return "NOT_ELIGIBLE";
    }

    const profile = await this.streamerRepo.findProfileById(account.streamerId);
    const userId = profile?.userId;

    // 소유권이 VERIFIED 상태가 아니면 Featured 자격 부여 불가
    if (account.verificationStatus !== "VERIFIED") {
      await this.completeAndSetProfileReason(
        job,
        "NOT_ELIGIBLE",
        nowIso,
        "채널 소유권이 검증되지 않아 Featured 자격을 부여할 수 없습니다.",
        userId,
      );
      return "NOT_ELIGIBLE";
    }

    // 사용자 토큰 없이 공식 app-level 지표 재조회가 불가능한 플랫폼 → 안전하게 MANUAL_REVIEW
    const adapter = adapters[account.platform];
    if (!adapter || !adapter.supportsAutomaticMetricRefresh()) {
      await this.completeAndSetProfileReason(
        job,
        "MANUAL_REVIEW",
        nowIso,
        "자동 재심사 미지원 플랫폼 — 추가 확인이 필요합니다.",
        userId,
      );
      return "MANUAL_REVIEW";
    }

    // 신선한 공식 지표 조회 (실패 시 상위 catch에서 FAILED_RETRYABLE 처리)
    const metrics = await adapter.fetchChannelMetrics(account.platformUserId);

    // 플랫폼이 필수 지표를 공식 API로 제공하지 않으면 추정 금지 → MANUAL_REVIEW
    if (metrics.audienceCount === null || metrics.channelCreatedAt === null) {
      await this.completeAndSetProfileReason(
        job,
        "MANUAL_REVIEW",
        nowIso,
        "공식 지표 일부를 제공하지 않는 플랫폼 — 추가 확인이 필요합니다.",
        userId,
      );
      return "MANUAL_REVIEW";
    }

    const decision = evaluateFeaturedRecheck({
      audienceCount: metrics.audienceCount,
      channelCreatedAt: metrics.channelCreatedAt,
      nowMs,
    });

    // 공식 지표 저장 (metrics_synced_at 갱신)
    await this.streamerRepo.updatePlatformAccountMetrics(account.id, {
      audienceCount: metrics.audienceCount,
      channelCreatedAt: metrics.channelCreatedAt,
      syncedAt: nowIso,
    });

    // 잡 전이: 이미 다른 실행에서 전이된 경우(멱등) 프로필 전이를 건너뜁니다.
    const transitioned = await reviewRepo.completeJob(
      job.id,
      decision.status,
      nowIso,
      decision.reason,
    );
    if (!transitioned) return decision.status;

    if (decision.status === "FEATURED" && userId !== undefined) {
      await this.streamerRepo.upsertProfile({
        userId,
        status: "VERIFIED",
        featuredStatus: "FEATURED",
        featuredReason: decision.reason,
      });
      try {
        await reviewRepo.scheduleRevalidationJob({
          streamerPlatformAccountId: account.id,
          nextCheckAt: new Date(nowMs + FEATURED_POLICY.REVALIDATION_INTERVAL_MS).toISOString(),
          nowIso,
        });
      } catch {
        // 다음 Cron의 보충 단계가 누락된 재검증 잡을 다시 예약합니다.
      }
    } else if (userId !== undefined) {
      await this.streamerRepo.upsertProfile({
        userId,
        status: "VERIFIED",
        featuredReason: decision.reason,
      });
    }

    return decision.status;
  }

  /** 기존 Featured 계정에 누락된 14일 재검증 잡을 제한된 수만큼 보충합니다. */
  async ensureFeaturedRevalidationJobs(options?: {
    now?: Date;
    batchSize?: number;
  }): Promise<number> {
    if (!this.reviewRepo) return 0;
    const nowMs = options?.now?.getTime() ?? Date.now();
    const limit = Math.min(
      Math.max(options?.batchSize ?? FEATURED_POLICY.DEFAULT_BATCH_SIZE, 1),
      FEATURED_POLICY.MAX_BATCH_SIZE,
    );
    const nowIso = new Date(nowMs).toISOString();
    return this.reviewRepo.ensureRevalidationJobs(
      limit,
      new Date(nowMs + FEATURED_POLICY.REVALIDATION_INTERVAL_MS).toISOString(),
      nowIso,
    );
  }

  /** 14일 Featured 재검증 파이프라인. 6시간 취득 심사와 별도 잡/배치로 실행합니다. */
  async runDueFeaturedRevalidations(options: {
    adapters: Record<StreamerPlatformType, StreamerProviderAdapter>;
    now?: Date;
    batchSize?: number;
  }): Promise<FeaturedRevalidationRunSummary> {
    if (!this.reviewRepo) {
      return { processed: 0, retained: 0, revoked: 0, manualReview: 0, failed: 0 };
    }

    const nowMs = options.now?.getTime() ?? Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const batchSize = Math.min(
      Math.max(options.batchSize ?? FEATURED_POLICY.DEFAULT_BATCH_SIZE, 1),
      FEATURED_POLICY.MAX_BATCH_SIZE,
    );
    const jobs = await this.reviewRepo.listDueRevalidationJobs(batchSize, nowIso);
    const summary: FeaturedRevalidationRunSummary = {
      processed: jobs.length,
      retained: 0,
      revoked: 0,
      manualReview: 0,
      failed: 0,
    };

    for (const job of jobs) {
      try {
        const outcome = await this.processRevalidationJob(job, options.adapters, nowMs);
        if (outcome === "RETAIN_FEATURED") summary.retained += 1;
        else if (outcome === "REVOKE_FEATURED") summary.revoked += 1;
        else summary.manualReview += 1;
      } catch {
        summary.failed += 1;
        const nextCheckAt = new Date(
          nowMs + FEATURED_POLICY.REVALIDATION_RETRY_INTERVAL_MS,
        ).toISOString();
        if (job.attemptCount + 1 >= FEATURED_POLICY.MAX_ATTEMPTS) {
          await this.completeAndSetProfileReason(
            job,
            "MANUAL_REVIEW",
            nowIso,
            "자동 Featured 재검증에 실패하여 추가 확인이 필요합니다.",
          );
        } else {
          await this.reviewRepo.markJobFailed(
            job.id,
            "재검증 공식 API 일시 실패",
            nextCheckAt,
            nowIso,
          );
        }
      }
    }

    return summary;
  }

  private async processRevalidationJob(
    job: StreamerReviewJob,
    adapters: Record<StreamerPlatformType, StreamerProviderAdapter>,
    nowMs: number,
  ): Promise<FeaturedRevalidationDecision> {
    const nowIso = new Date(nowMs).toISOString();
    const reviewRepo = this.reviewRepo;
    if (!reviewRepo) return "MANUAL_REVIEW";

    const account = await this.streamerRepo.findPlatformAccountById(job.streamerPlatformAccountId);
    if (!account) {
      await this.completeAndSetProfileReason(
        job,
        "NOT_ELIGIBLE",
        nowIso,
        "채널 계정이 존재하지 않아 Featured 자격을 유지할 수 없습니다.",
      );
      return "REVOKE_FEATURED";
    }

    const profile = await this.streamerRepo.findProfileById(account.streamerId);
    const userId = profile?.userId;
    if (!profile || profile.featuredStatus !== "FEATURED") {
      await this.completeAndSetProfileReason(
        job,
        "NOT_ELIGIBLE",
        nowIso,
        "현재 Featured 상태가 아니므로 재검증을 종료합니다.",
        userId,
      );
      return "REVOKE_FEATURED";
    }

    if (account.verificationStatus !== "VERIFIED") {
      await this.completeAndSetProfileReason(
        job,
        "NOT_ELIGIBLE",
        nowIso,
        "채널 소유권 검증이 유효하지 않아 Featured 자격을 철회합니다.",
        userId,
        "NONE",
      );
      return "REVOKE_FEATURED";
    }

    const adapter = adapters[account.platform];
    if (!adapter || !adapter.supportsAutomaticMetricRefresh()) {
      await this.completeAndSetProfileReason(
        job,
        "MANUAL_REVIEW",
        nowIso,
        "자동 재검증 미지원 플랫폼 — Featured를 자동 변경하지 않고 추가 확인이 필요합니다.",
        userId,
      );
      return "MANUAL_REVIEW";
    }

    const metrics = await adapter.fetchChannelMetrics(account.platformUserId);
    const decision = evaluateFeaturedRevalidation({
      audienceCount: metrics.audienceCount,
      channelState: metrics.channelState,
    });

    await this.streamerRepo.updatePlatformAccountMetrics(account.id, {
      audienceCount: metrics.audienceCount ?? account.audienceCount ?? null,
      channelCreatedAt: metrics.channelCreatedAt ?? account.channelCreatedAt ?? null,
      syncedAt: nowIso,
    });

    const status =
      decision.status === "RETAIN_FEATURED"
        ? "FEATURED"
        : decision.status === "REVOKE_FEATURED"
          ? "NOT_ELIGIBLE"
          : "MANUAL_REVIEW";
    const transitioned = await reviewRepo.completeJob(job.id, status, nowIso, decision.reason);
    if (!transitioned) return decision.status;

    if (userId !== undefined) {
      await this.streamerRepo.upsertProfile({
        userId,
        status: "VERIFIED",
        ...(decision.status === "REVOKE_FEATURED" ? { featuredStatus: "NONE" as const } : {}),
        featuredReason: decision.reason,
      });
    }

    if (decision.status === "RETAIN_FEATURED") {
      try {
        await reviewRepo.scheduleRevalidationJob({
          streamerPlatformAccountId: account.id,
          nextCheckAt: new Date(nowMs + FEATURED_POLICY.REVALIDATION_INTERVAL_MS).toISOString(),
          nowIso,
        });
      } catch {
        // 다음 Cron의 보충 단계가 누락된 재검증 잡을 다시 예약합니다.
      }
    }

    return decision.status;
  }

  private async completeAndSetProfileReason(
    job: StreamerReviewJob,
    status: Exclude<FeaturedReviewStatus, "AUTO_REVIEW_PENDING" | "FAILED_RETRYABLE">,
    completedAt: string,
    reason: string,
    userId?: number,
    featuredStatus?: "NONE" | "FEATURED" | "PARTNER",
  ): Promise<void> {
    const reviewRepo = this.reviewRepo;
    if (!reviewRepo) return;
    const transitioned = await reviewRepo.completeJob(job.id, status, completedAt, reason);
    if (!transitioned) return;
    if (userId === undefined) {
      const account = await this.streamerRepo.findPlatformAccountById(
        job.streamerPlatformAccountId,
      );
      const profile = account ? await this.streamerRepo.findProfileById(account.streamerId) : null;
      userId = profile?.userId;
    }
    if (userId !== undefined) {
      await this.streamerRepo.upsertProfile({
        userId,
        status: "VERIFIED",
        ...(featuredStatus ? { featuredStatus } : {}),
        featuredReason: reason,
      });
    }
  }
}
