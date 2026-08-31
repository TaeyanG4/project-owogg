import { levelForTotalXp } from "../domain/progression.js";
import type {
  StreamerPlatformAccount,
  StreamerPlatformType,
  StreamerProfile,
  StreamerRankEntry,
  StreamerRepository,
  StreamerReviewJob,
  StreamerReviewRepository,
} from "../ports/repositories.js";
import type { StreamerAdminRepository, StreamerPolicyVersion } from "../ports/streamerAdmin.js";
import type { StreamerChannelInfo } from "../ports/streamerProvider.js";
import type { PublicGameCatalog } from "./publicGameCatalog.js";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

function channelAgeDays(channelCreatedAt: string | null, nowMs: number): number | null {
  if (!channelCreatedAt) return null;
  const createdAtMs = new Date(channelCreatedAt).getTime();
  if (!Number.isFinite(createdAtMs) || createdAtMs > nowMs) return null;
  return Math.floor((nowMs - createdAtMs) / DAY_MS);
}

function initialEvidence(
  account: StreamerPlatformAccount,
  policy: StreamerPolicyVersion,
  nowIso: string,
) {
  const ageDays = channelAgeDays(account.channelCreatedAt ?? null, new Date(nowIso).getTime());
  return {
    observedAt: nowIso,
    policyVersion: policy.version,
    audienceCount: account.audienceCount,
    channelAgeDays: ageDays,
    metricsSyncedAt: account.metricsSyncedAt ?? null,
    conditions: [
      {
        field: "OWNERSHIP",
        result: account.verificationStatus === "VERIFIED" ? "PASS" : "FAIL",
        actual: null,
        required: null,
        unit: null,
        reasonCode:
          account.verificationStatus === "VERIFIED"
            ? "OWNERSHIP_VERIFIED"
            : "OWNERSHIP_NOT_VERIFIED",
      },
      {
        field: "AUDIENCE",
        result:
          account.audienceCount === null
            ? "UNKNOWN"
            : account.audienceCount >= policy.values.minimumAudience
              ? "PASS"
              : "FAIL",
        actual: account.audienceCount,
        required: policy.values.minimumAudience,
        unit: "PEOPLE",
        reasonCode:
          account.audienceCount === null
            ? "AUDIENCE_UNKNOWN"
            : account.audienceCount >= policy.values.minimumAudience
              ? "AUDIENCE_MEETS_POLICY"
              : "AUDIENCE_BELOW_POLICY",
      },
      {
        field: "CHANNEL_AGE",
        result:
          ageDays === null
            ? "UNKNOWN"
            : ageDays >= policy.values.minimumChannelAgeDays
              ? "PASS"
              : "FAIL",
        actual: ageDays,
        required: policy.values.minimumChannelAgeDays,
        unit: "DAYS",
        reasonCode:
          ageDays === null
            ? "CHANNEL_AGE_UNKNOWN"
            : ageDays >= policy.values.minimumChannelAgeDays
              ? "CHANNEL_AGE_MEETS_POLICY"
              : "CHANNEL_AGE_BELOW_POLICY",
      },
      {
        field: "PROVIDER_CONTRACT",
        result: "UNKNOWN",
        actual: null,
        required: null,
        unit: null,
        reasonCode: "MANUAL_PROVIDER_REVIEW",
      },
    ],
  };
}

export class StreamerUseCases {
  constructor(
    private streamerRepo: StreamerRepository,
    private reviewRepo?: StreamerReviewRepository,
    private games?: PublicGameCatalog,
    private adminRepo?: StreamerAdminRepository,
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

    const query: Parameters<StreamerRepository["getStreamerRankings"]>[0] = {
      mode: options.mode,
      direction,
      limit,
      offset,
    };
    if (selectedGameId !== undefined) query.gameId = selectedGameId;
    if (selectedGame !== undefined) {
      query.rulesetRevision = selectedGame.canonical.playConfig?.rulesetRevision ?? 1;
    }
    if (options.platform !== undefined) query.platform = options.platform;

    const result = await this.streamerRepo.getStreamerRankings(query);
    return {
      total: result.total,
      entries: result.entries.map((entry) => {
        if (options.mode === "score" && entry.gameId && entry.score !== undefined) {
          const game = gamesBySlug.get(entry.gameId);
          const score = game?.canonical.policy.score;
          return {
            ...entry,
            formattedScore: score
              ? `${score.displayPrefix ?? ""}${entry.score.toLocaleString()}${score.displaySuffix ?? ` ${score.unit}`}`
              : String(entry.score),
            gameTitle: game?.canonical.title ?? entry.gameId,
          };
        }
        if (options.mode === "xp" && entry.totalXp !== undefined) {
          return { ...entry, level: levelForTotalXp(entry.totalXp) };
        }
        return entry;
      }),
    };
  }

  async getStreamerProfileByUserId(
    userId: number,
  ): Promise<(StreamerProfile & { platformAccounts: StreamerPlatformAccount[] }) | null> {
    return this.streamerRepo.findProfileByUserId(userId);
  }

  async verifyChannelOwnership(
    userId: number,
    channelInfo: StreamerChannelInfo,
    now = new Date(),
  ): Promise<
    | {
        ok: true;
        profile: StreamerProfile;
        platformAccount: StreamerPlatformAccount;
        review: StreamerReviewJob | null;
      }
    | { ok: false; code: string; message: string }
  > {
    const existingAccount = await this.streamerRepo.findPlatformAccount(
      channelInfo.platform,
      channelInfo.platformUserId,
    );
    if (existingAccount) {
      const existingProfile = await this.streamerRepo.findProfileById(existingAccount.streamerId);
      if (existingProfile && existingProfile.userId !== userId) {
        return {
          ok: false,
          code: "CHANNEL_ALREADY_VERIFIED",
          message: "이 채널은 이미 다른 OwOGG 스트리머 계정에 연동되어 있습니다.",
        };
      }
    }

    const userProfile = await this.streamerRepo.findProfileByUserId(userId);
    const conflictingPlatform = userProfile?.platformAccounts.find(
      (account) =>
        account.platform === channelInfo.platform &&
        account.platformUserId !== channelInfo.platformUserId &&
        account.verificationStatus === "VERIFIED",
    );
    if (conflictingPlatform) {
      return {
        ok: false,
        code: "PLATFORM_ALREADY_CONNECTED",
        message: "이 플랫폼에는 이미 소유권이 확인된 다른 채널이 연결되어 있습니다.",
      };
    }

    if (!this.reviewRepo || !this.adminRepo) {
      return {
        ok: false,
        code: "STREAMER_REVIEW_UNAVAILABLE",
        message: "스트리머 심사 서비스를 사용할 수 없습니다.",
      };
    }
    const policy = await this.adminRepo.getActivePolicy();
    if (!policy) {
      return {
        ok: false,
        code: "STREAMER_POLICY_UNAVAILABLE",
        message: "활성 스트리머 심사 정책을 찾을 수 없습니다.",
      };
    }

    const nowMs = now.getTime();
    const nowIso = now.toISOString();
    const ownershipWasCurrent = Boolean(
      existingAccount?.verificationStatus === "VERIFIED" &&
      existingAccount.ownershipExpiresAt &&
      new Date(existingAccount.ownershipExpiresAt).getTime() > nowMs,
    );
    const ownershipReverifyRequired = Boolean(
      existingAccount && existingAccount.approvalStatus !== "REJECTED" && !ownershipWasCurrent,
    );
    const profile =
      userProfile ?? (await this.streamerRepo.upsertProfile({ userId, status: "UNVERIFIED" }));
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
      ownershipExpiresAt: new Date(
        nowMs + policy.values.ownershipValidityDays * DAY_MS,
      ).toISOString(),
      resetApprovalForOwnershipReview: ownershipReverifyRequired,
    });
    if (platformAccount.streamerId !== profile.id) {
      return {
        ok: false,
        code: "CHANNEL_ALREADY_VERIFIED",
        message: "이 채널은 이미 다른 OwOGG 스트리머 계정에 연동되어 있습니다.",
      };
    }

    const review =
      platformAccount.approvalStatus === "PENDING"
        ? await this.reviewRepo.createOwnershipReview({
            streamerPlatformAccountId: platformAccount.id,
            reviewType: ownershipReverifyRequired ? "OWNERSHIP_REVERIFY" : "INITIAL",
            dueAt: new Date(nowMs + policy.values.reviewSlaHours * HOUR_MS).toISOString(),
            policyVersion: policy.version,
            evidenceJson: JSON.stringify(initialEvidence(platformAccount, policy, nowIso)),
            nowIso,
          })
        : null;

    const currentProfile = ownershipReverifyRequired
      ? ((await this.streamerRepo.findProfileById(profile.id)) ?? profile)
      : profile;
    return { ok: true, profile: currentProfile, platformAccount, review };
  }
}
