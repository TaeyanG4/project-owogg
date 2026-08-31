import type { AdminUserSearchPeriod, AdminUserSearchSort } from "../domain/adminUserQuery.js";

export interface User {
  id: number;
  nickname: string;
  email: string | null;
  avatar_url: string | null;
  /** OAuth provider whose verified avatar is currently exposed on public surfaces. */
  avatar_provider?: string | null;
  created_at: string;
  updated_at: string;
  providers?: string[];
  /** Self-reported ISO 3166-1 alpha-2 code ("국가/지역"), or null if unset. Not verified nationality. */
  country?: string | null;
  /** Timestamp of the last explicit nickname change; null before the first change. */
  nickname_updated_at?: string | null;
  /** Timestamp of the last explicit country/region change; null before the first change. */
  country_updated_at?: string | null;
  /** Saved UI locale preference (one of SUPPORTED_LOCALES), or null if never set. */
  locale?: string | null;
  /** Consecutive UTC-day activity streak — see domain/streak.ts. Defaults to 0/0/null for brand-new users. */
  current_streak?: number;
  longest_streak?: number;
  last_active_date?: string | null;
  /** Whether favorites/recent-plays (already stored server-side regardless) are disclosed on
   * the PUBLIC profile (/users/:id) to viewers other than the account owner. Both default to
   * false — see migration 0021_profile_visibility.sql for why. */
  show_favorites?: boolean;
  show_recent_plays?: boolean;
  /** Independent of login access (SUSPENDED/BANNED users never reach this far — findSession
   * rejects them first) — an otherwise-ACTIVE user can still be blocked from submitting new
   * scores. See UserModerationRepository. Defaults to false/absent for untouched accounts. */
  score_submission_blocked?: boolean;
}

export interface OAuthAccount {
  id: number;
  user_id: number;
  provider: string;
  provider_user_id: string;
  provider_email: string | null;
  /** Latest avatar observed from this exact verified OAuth identity. */
  avatar_url?: string | null;
  created_at: string;
}

export interface Session {
  id: string;
  user_id: number;
  created_at: string;
  expires_at: string;
}

export interface Score {
  id: number;
  user_id: number;
  nickname: string;
  avatar_url: string | null;
  game_id: string;
  score: number;
  /** "normal" for every game without a manifest `difficulty` config — see
   * domain/scoreValidation.ts's validateDifficulty for how this gets normalized on submission. */
  difficulty: string;
  variant_id: string;
  ruleset_revision: number;
  created_at: string;
}

export interface UserPersonalBestAggregate {
  game_id: string;
  ruleset_revision: number;
  min_score: number;
  max_score: number;
}

export interface UserRepository {
  findById(id: number): Promise<User | null>;
  findByOAuth(provider: string, providerUserId: string): Promise<User | null>;
  findOrCreateUser(data: {
    provider: string;
    providerUserId: string;
    email: string | null;
    nickname: string;
    avatarUrl: string | null;
  }): Promise<User>;
  getOAuthAccounts(userId: number): Promise<OAuthAccount[]>;
  findOAuthAccount(provider: string, providerUserId: string): Promise<OAuthAccount | null>;
  linkOAuthAccount(
    userId: number,
    provider: string,
    providerUserId: string,
    providerEmail: string | null,
    avatarUrl: string | null,
  ): Promise<void>;
  unlinkOAuthAccount(userId: number, provider: string): Promise<void>;
  updateAvatarPreference(
    userId: number,
    provider: string,
    avatarUrl: string,
    updatedAt: string,
  ): Promise<User>;
  updateNickname(userId: number, nickname: string, updatedAt: string): Promise<User>;
  updateCountry(userId: number, country: string | null, updatedAt: string): Promise<User>;
  updateLocale(userId: number, locale: string, updatedAt: string): Promise<User>;
  updateVisibility(
    userId: number,
    showFavorites: boolean,
    showRecentPlays: boolean,
    updatedAt: string,
  ): Promise<User>;
}

export interface SessionRepository {
  createSession(userId: number, ttlDays?: number): Promise<Session>;
  findSession(sessionId: string): Promise<{ session: Session; user: User } | null>;
  deleteSession(sessionId: string): Promise<void>;
  /** Revokes every active session for a user in one shot — used when an admin suspends/bans a
   * user, so an already-logged-in browser is kicked out immediately rather than only being
   * blocked on its next findSession call whenever that happens to occur. */
  deleteAllSessionsForUser(userId: number): Promise<void>;
}

export interface ScoreRepository {
  saveScore(data: {
    userId: number;
    nickname: string;
    avatarUrl?: string | null;
    gameId: string;
    score: number;
    difficulty: string;
  }): Promise<Score>;
  getLeaderboard(
    gameId: string,
    limit?: number,
    direction?: "asc" | "desc",
    difficulty?: string,
    rulesetRevision?: number,
  ): Promise<Score[]>;
  getUserPersonalBests(userId: number): Promise<UserPersonalBestAggregate[]>;
}

export interface FavoriteItem {
  user_id: number;
  game_id: string;
  created_at: string;
}

export interface RecentPlayItem {
  user_id: number;
  game_id: string;
  last_played_at: string;
}

export interface PersonalizationRepository {
  getFavorites(userId: number): Promise<string[]>;
  addFavorite(userId: number, gameId: string): Promise<void>;
  removeFavorite(userId: number, gameId: string): Promise<void>;

  getRecentPlays(
    userId: number,
    limit?: number,
  ): Promise<{ gameId: string; lastPlayedAt: string }[]>;
  recordRecentPlay(userId: number, gameId: string, playedAt?: string): Promise<void>;

  importGuestData(
    userId: number,
    guestRecentPlays: { gameId: string; lastPlayedAt: string }[],
  ): Promise<void>;
}

export interface MergePreview {
  userId: number;
  nickname: string;
  provider: string;
  createdAt: string;
  scoreCount: number;
  favoriteCount: number;
  recentPlayCount: number;
}

export interface MergeChallenge {
  id: string;
  userA: number;
  userB: number;
  provider: string;
  providerUserId: string;
  expiresAt: string;
  consumedAt: string | null;
}

export interface AccountMergeRepository {
  getAccountMergePreview(userId: number): Promise<MergePreview>;
  createMergeChallenge(input: {
    userA: number;
    userB: number;
    provider: string;
    providerUserId: string;
    ttlSeconds: number;
  }): Promise<{ id: string; expiresAt: string }>;
  findMergeChallenge(id: string): Promise<MergeChallenge | null>;
  findPendingMergeChallenge(userA: number, userB: number): Promise<MergeChallenge | null>;
  /**
   * Returns a conflict when Streamer identities collide or when the secondary account has
   * active/conflicting multiplayer identity. The merge stops before destructive work.
   */
  findMergeIntegrityConflict(
    primaryId: number,
    secondaryId: number,
  ): Promise<
    | "STREAMER_PLATFORM_CONFLICT"
    | "MULTIPLAYER_PARTICIPATION_CONFLICT"
    | "GAME_CREATOR_REVIEW_CONFLICT"
    | "OAUTH_REGISTRATION_CONFLICT"
    | null
  >;
  /** Performs the complete Primary-Wins transfer/deletion in one database transaction. */
  mergeAccounts(primaryId: number, secondaryId: number, challengeId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Progression (XP / Level)
// ---------------------------------------------------------------------------

export interface UserProgress {
  user_id: number;
  total_xp: number;
  eligible_completions: number;
  updated_at: string;
}

export interface RecordCompletionOutcome {
  /** True when this exact source event was already recorded (idempotent no-op). */
  duplicate: boolean;
  /** 0 when duplicate, or when the daily per-user/per-game XP cap was already reached. */
  xpAwarded: number;
  totalXp: number;
  eligibleCompletions: number;
  xpEventId?: number | undefined;
}

export interface XpLeaderboardEntry {
  userId: number;
  nickname: string;
  avatarUrl: string | null;
  totalXp: number;
}

export interface ProgressionRepository {
  /**
   * Records one accepted, authenticated, XP-eligible game completion. Idempotent by
   * (sourceType, sourceId): replaying the same source event never re-awards XP or
   * re-increments eligibleCompletions. Applies the caller-supplied daily cap by only
   * awarding `xpPerCompletion` XP while fewer than `dailyCapPerGame` XP-awarding
   * completions have already been recorded for this user+game in the current UTC day.
   */
  recordGameCompletion(input: {
    userId: number;
    gameId: string;
    sourceType: string;
    sourceId: string;
    xpPerCompletion: number;
    dailyCapPerGame: number;
  }): Promise<RecordCompletionOutcome>;

  getUserProgress(userId: number): Promise<UserProgress | null>;
  getXpLeaderboard(limit: number): Promise<XpLeaderboardEntry[]>;
  /** 1-based global rank by total_xp, or null if the user has no progress row yet. */
  getGlobalXpRank(userId: number): Promise<number | null>;
}

// ---------------------------------------------------------------------------
// Achievements
// ---------------------------------------------------------------------------

export interface UnlockedAchievement {
  achievementCode: string;
  unlockedAt: string;
}

export interface AchievementRepository {
  getUnlockedAchievements(userId: number): Promise<UnlockedAchievement[]>;
  /** Idempotent: `unlocked` is false if the code was already unlocked for this user. */
  unlockAchievement(userId: number, code: string): Promise<{ unlocked: boolean }>;
}

// ---------------------------------------------------------------------------
// Discord account-linking challenges (/owogg link)
// ---------------------------------------------------------------------------

export interface DiscordLinkChallenge {
  discordUserId: string;
  discordUsername: string;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
}

export interface DiscordLinkRepository {
  /** Generates a random single-use token internally, persists only its hash, and returns
   * the raw token (shown to the Discord user exactly once, inside an ephemeral message). */
  createChallenge(input: {
    discordUserId: string;
    discordUsername: string;
    ttlSeconds: number;
  }): Promise<{ token: string; expiresAt: string }>;
  /** Looks up by the raw token; the repository hashes internally to match stored data. */
  findChallengeByToken(token: string): Promise<DiscordLinkChallenge | null>;
  consumeChallengeByToken(token: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Discord Guild Registration & Management (Phase G)
// ---------------------------------------------------------------------------

export type DiscordGuildVisibility = "PUBLIC" | "UNLISTED" | "PRIVATE";
export type DiscordGuildRegistrationStatus = "ACTIVE" | "DISABLED";

export interface DiscordGuild {
  guild_id: string;
  slug: string;
  name: string;
  icon_url: string | null;
  description: string | null;
  visibility: DiscordGuildVisibility;
  registration_status: DiscordGuildRegistrationStatus;
  registered_by_user_id: number;
  registered_at: string;
  first_seen_at: string;
  last_seen_at: string;
  updated_at: string;
}

export interface DiscordGuildManager {
  guild_id: string;
  user_id: number;
  role: string;
  created_at: string;
  updated_at: string;
}

export interface DiscordCandidateGuild {
  guildId: string;
  name: string;
  iconUrl: string | null;
}

export interface DiscordRegistrationChallenge {
  tokenHash: string;
  userId: number;
  manageableGuilds: DiscordCandidateGuild[];
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
}

export interface DiscordPlayContext {
  tokenHash: string;
  guildId: string;
  discordUserId: string;
  userId: number;
  gameId: string | null;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
}

export interface DiscordGuildXpEvent {
  id: number;
  guildId: string;
  userId: number;
  sourceXpEventId: number;
  amount: number;
  createdAt: string;
}

export interface GuildXpLeaderboardEntry {
  userId: number;
  nickname: string;
  avatarUrl: string | null;
  xp: number;
  rank: number;
}

export interface GlobalGuildRankEntry {
  guildId: string;
  slug: string;
  name: string;
  iconUrl: string | null;
  totalXp: number;
  weeklyXp: number;
  participantCount: number;
  rank: number;
}

export interface ServerGameLeaderboardEntry {
  id: number;
  userId: number;
  nickname: string;
  avatarUrl: string | null;
  gameId: string;
  score: number;
  variantId: string;
  rulesetRevision: number;
  formattedScore: string;
  createdAt: string;
}

export interface GuildSummaryData {
  totalXp: number;
  weeklyXp: number;
  participantCount: number;
}

export interface DiscordGuildRepository {
  createRegistrationChallenge(input: {
    userId: number;
    manageableGuilds: DiscordCandidateGuild[];
    ttlSeconds?: number;
  }): Promise<{ token: string; expiresAt: string }>;
  findRegistrationChallengeByToken(token: string): Promise<DiscordRegistrationChallenge | null>;
  consumeRegistrationChallengeByToken(token: string): Promise<void>;

  registerGuild(input: {
    guildId: string;
    slug: string;
    name: string;
    iconUrl?: string | null;
    description?: string | null;
    visibility: DiscordGuildVisibility;
    userId: number;
  }): Promise<DiscordGuild>;

  findByGuildId(guildId: string): Promise<DiscordGuild | null>;
  findBySlug(slug: string): Promise<DiscordGuild | null>;

  updateGuild(
    guildId: string,
    updates: {
      slug?: string | undefined;
      description?: string | null | undefined;
      visibility?: DiscordGuildVisibility | undefined;
      registrationStatus?: DiscordGuildRegistrationStatus | undefined;
      name?: string | undefined;
      iconUrl?: string | null | undefined;
    },
  ): Promise<DiscordGuild>;

  searchPublicGuilds(
    query?: string,
    limit?: number,
    offset?: number,
  ): Promise<{ guilds: DiscordGuild[]; total: number }>;

  isGuildManager(guildId: string, userId: number): Promise<boolean>;
  addGuildManager(guildId: string, userId: number, role?: string): Promise<void>;
  getUserManagedGuilds(userId: number): Promise<DiscordGuild[]>;
  getActiveGuildCount(): Promise<number>;

  createPlayContext(input: {
    guildId: string;
    discordUserId: string;
    userId: number;
    gameId?: string | null;
    ttlSeconds?: number;
  }): Promise<{ token: string; expiresAt: string }>;
  findPlayContextByToken(token: string): Promise<DiscordPlayContext | null>;
  consumePlayContextByToken(token: string): Promise<void>;

  attributeGuildXp(input: {
    guildId: string;
    userId: number;
    sourceXpEventId: number;
    amount: number;
  }): Promise<DiscordGuildXpEvent | null>;

  getGuildUserXp(guildId: string, userId: number): Promise<number>;
  getGuildTotalXp(guildId: string): Promise<number>;

  // Phase H2 Query Methods
  getGuildXpLeaderboard(
    guildId: string,
    startOfWeekIso?: string,
    limit?: number,
    offset?: number,
  ): Promise<{ entries: GuildXpLeaderboardEntry[]; total: number }>;

  getGuildSummary(guildId: string, startOfWeekIso: string): Promise<GuildSummaryData>;

  getGlobalGuildActivityRanking(
    startOfWeekIso?: string,
    limit?: number,
    offset?: number,
  ): Promise<{ guilds: GlobalGuildRankEntry[]; total: number }>;

  getGuildGameLeaderboard(
    guildId: string,
    gameId: string,
    direction?: "asc" | "desc",
    limit?: number,
    rulesetRevision?: number,
  ): Promise<ServerGameLeaderboardEntry[]>;

  getGuildUserXpRank(
    guildId: string,
    userId: number,
    startOfWeekIso?: string,
  ): Promise<{ totalXp: number; rank: number | null }>;
}

export type StreamerPlatformType = "YOUTUBE" | "CHZZK" | "SOOP" | "TWITCH";
export type StreamerStatusType = "UNVERIFIED" | "VERIFIED" | "SUSPENDED";
export type StreamerPlatformApprovalStatusType = "PENDING" | "APPROVED" | "REJECTED";
export type StreamerReviewType = "INITIAL" | "RECONSIDERATION" | "OWNERSHIP_REVERIFY";
export type StreamerReviewJobStatus = "QUEUED" | "ON_HOLD" | "APPROVED" | "REJECTED" | "CANCELLED";

export interface StreamerProfile {
  id: number;
  userId: number;
  status: StreamerStatusType;
  suspendedUntil: string | null;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface StreamerPlatformAccount {
  id: number;
  streamerId: number;
  platform: StreamerPlatformType;
  platformUserId: string;
  channelName: string;
  channelHandle: string | null;
  channelUrl: string;
  avatarUrl: string | null;
  verificationStatus: string;
  verifiedAt: string | null;
  ownershipExpiresAt: string | null;
  approvalStatus: StreamerPlatformApprovalStatusType;
  approvalReasonCode: string | null;
  approvedAt: string | null;
  /** null = UNKNOWN (official value never obtained/confirmed), not "zero". */
  audienceCount: number | null;
  channelCreatedAt?: string | null;
  metricsSyncedAt?: string | null;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface StreamerRankEntry {
  userId: number;
  nickname: string;
  avatarUrl: string | null;
  country: string | null;
  streamerId: number;
  platformAccounts: Array<{
    platform: StreamerPlatformType;
    channelName: string;
    channelUrl: string;
    avatarUrl: string | null;
  }>;
  score?: number | undefined;
  formattedScore?: string | undefined;
  gameId?: string | undefined;
  gameTitle?: string | undefined;
  totalXp?: number | undefined;
  level?: number | undefined;
  rank: number;
}

export interface StreamerReviewJob {
  id: number;
  streamerPlatformAccountId: number;
  reviewType: StreamerReviewType;
  status: StreamerReviewJobStatus;
  dueAt: string;
  policyVersion: number;
  publicReasonCode: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  rowVersion: number;
}

export interface StreamerReviewRepository {
  /** 플랫폼별 활성 수동 심사를 반환합니다. */
  findActiveJobByAccountId(streamerPlatformAccountId: number): Promise<StreamerReviewJob | null>;
  /** 새 연결의 INITIAL 수동 심사를 멱등적으로 생성합니다. */
  createInitialReview(input: {
    streamerPlatformAccountId: number;
    dueAt: string;
    policyVersion: number;
    evidenceJson: string;
    nowIso: string;
  }): Promise<StreamerReviewJob>;
}

export interface StreamerRepository {
  findProfileByUserId(
    userId: number,
  ): Promise<(StreamerProfile & { platformAccounts: StreamerPlatformAccount[] }) | null>;
  findProfileById(
    streamerId: number,
  ): Promise<(StreamerProfile & { platformAccounts: StreamerPlatformAccount[] }) | null>;
  findPlatformAccountById(platformAccountId: number): Promise<StreamerPlatformAccount | null>;
  findPlatformAccount(
    platform: StreamerPlatformType,
    platformUserId: string,
  ): Promise<StreamerPlatformAccount | null>;
  upsertProfile(input: { userId: number; status: StreamerStatusType }): Promise<StreamerProfile>;
  addPlatformAccount(input: {
    streamerId: number;
    platform: StreamerPlatformType;
    platformUserId: string;
    channelName: string;
    channelHandle?: string | null;
    channelUrl: string;
    avatarUrl?: string | null;
    verificationStatus?: string;
  }): Promise<StreamerPlatformAccount>;
  upsertPlatformAccount(input: {
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
    ownershipExpiresAt?: string | null;
  }): Promise<StreamerPlatformAccount>;
  /** 명시적인 운영자 요청으로 공식 지표와 metrics_synced_at를 갱신합니다. */
  updatePlatformAccountMetrics(
    platformAccountId: number,
    input: {
      audienceCount: number | null;
      channelCreatedAt: string | null;
      syncedAt: string;
    },
  ): Promise<StreamerPlatformAccount>;
  getStreamerRankings(options: {
    mode: "score" | "xp";
    gameId?: string;
    direction?: "asc" | "desc";
    rulesetRevision?: number;
    platform?: StreamerPlatformType;
    limit?: number;
    offset?: number;
  }): Promise<{ entries: StreamerRankEntry[]; total: number }>;
}

/** Live, DB-backed enable/disable override for a game — see migrations/0019_game_settings.sql. */
export interface GameSettingRecord {
  gameId: string;
  enabled: boolean;
  /** Server-owned presentation role. Upload metadata cannot self-assign INTERNAL_TOOL. */
  catalogRole: "GAME" | "INTERNAL_TOOL";
  disabledReason: string | null;
  updatedByAdminId: number | null;
  updatedAt: string;
}

export interface GameSettingsRepository {
  /** Only game_ids with an explicit `enabled = 0` row — used for the public availability check. */
  getDisabledGameIds(): Promise<string[]>;
  /** One read for every identity excluded from public catalog surfaces, whether by the emergency
   * safety switch or the server-owned internal-tool role. */
  getPublicCatalogExcludedGameIds(): Promise<string[]>;
  /** Every row that has ever been explicitly toggled (enabled or disabled) — used by the admin list. */
  getAllOverrides(): Promise<GameSettingRecord[]>;
  setEnabled(
    gameId: string,
    enabled: boolean,
    reason: string | null,
    adminId: number,
  ): Promise<GameSettingRecord>;
  setCatalogRole(
    gameId: string,
    catalogRole: "GAME" | "INTERNAL_TOOL",
    adminId: number,
  ): Promise<GameSettingRecord>;
}

export interface GamePlayCount {
  gameId: string;
  count: number;
}

/** Read-only aggregation for `/admin/monitoring` — deliberately has no business rules of its
 * own (no domain invariants to enforce over "how many users were active"), so unlike most
 * repositories here it's called directly from the route rather than through a UseCases layer,
 * matching how admin.ts's existing `/overview` route already calls discordGuildRepo directly. */
export type UserModerationStatus = "ACTIVE" | "SUSPENDED" | "BANNED";
export type UserSuspensionDurationDays = 7 | 30 | 180;

export type UserModerationAction =
  | "SUSPENDED"
  | "BANNED"
  | "UNSUSPENDED"
  | "SCORE_SUBMISSION_BLOCKED"
  | "SCORE_SUBMISSION_UNBLOCKED"
  | "SCORES_RESET"
  | "SCORES_RESTORED";

export interface UserModerationRecord {
  userId: number;
  status: UserModerationStatus;
  /** Only meaningful when status === 'SUSPENDED'. */
  suspendedUntil: string | null;
  scoreSubmissionBlocked: boolean;
  reason: string | null;
  updatedByAdminId: number | null;
  updatedAt: string;
}

export interface UserModerationAuditEntry {
  id: number;
  userId: number;
  actorAdminId: number;
  action: UserModerationAction;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface AdminUserSearchResult {
  id: number;
  nickname: string;
  email: string | null;
  createdAt: string;
  moderationStatus: UserModerationStatus;
  suspendedUntil: string | null;
  scoreSubmissionBlocked: boolean;
}

export interface AdminUserSearchOptions {
  /** Nickname/email substring or exact numeric id. Empty/omitted lists every user (subject to
   * `period`), which is what powers the plain "browse all users" list, not just ad-hoc search. */
  query?: string | undefined;
  period?: AdminUserSearchPeriod | undefined;
  sort?: AdminUserSearchSort | undefined;
  limit: number;
  offset: number;
}

export interface AdminUserSearchPage {
  users: AdminUserSearchResult[];
  /** Total rows matching `query`/`period`, ignoring `limit`/`offset` — for page-count UI. */
  total: number;
}

/**
 * Suspend/ban (blocks login — enforced by SessionRepository.findSession, not here), an
 * independent score-submission block (enforced by the scores route), and score reset/restore.
 * Score reset is a soft-delete (`scores.deleted_at`) specifically so it's reversible — see
 * migration 0023's comment. Every mutating method here writes exactly one
 * `user_moderation_audit_log` row; there is no update/delete path for that log anywhere.
 */
export interface UserModerationRepository {
  searchUsers(options: AdminUserSearchOptions): Promise<AdminUserSearchPage>;
  getModeration(userId: number): Promise<UserModerationRecord | null>;
  suspendUser(
    userId: number,
    adminId: number,
    suspendedUntil: string,
    durationDays: UserSuspensionDurationDays,
    reason: string,
  ): Promise<UserModerationRecord>;
  banUser(userId: number, adminId: number, reason: string): Promise<UserModerationRecord>;
  /** Clears SUSPENDED or BANNED back to ACTIVE ahead of a suspension's natural expiry. */
  unsuspendUser(userId: number, adminId: number): Promise<UserModerationRecord>;
  setScoreSubmissionBlocked(
    userId: number,
    adminId: number,
    blocked: boolean,
    reason: string | null,
  ): Promise<UserModerationRecord>;
  /** Soft-deletes every currently-visible score row for this user. Returns how many were hit so
   * the admin UI can confirm what just happened. */
  resetUserScores(
    userId: number,
    adminId: number,
    reason: string | null,
  ): Promise<{ affectedCount: number }>;
  /** Un-does resetUserScores — restores every currently soft-deleted row for this user. */
  restoreUserScores(userId: number, adminId: number): Promise<{ restoredCount: number }>;
  getAuditLog(userId: number, limit?: number): Promise<UserModerationAuditEntry[]>;
}

export interface AdminMonitoringRepository {
  /** Distinct users with at least one xp_events row in the last 1/7 days (rolling window from
   * "now", not calendar-day/week boundaries — good enough for an operator glance, not billing). */
  getActiveUserCounts(): Promise<{ dau: number; wau: number }>;
  /** Score submission counts per game over the last `sinceDays` days, most-played first. */
  getGamePlayCounts(sinceDays: number): Promise<GamePlayCount[]>;
  /** Round-trips a trivial query to D1 and times it — the closest this Worker can get to
   * "D1 query monitoring" on its own; per-query/per-route analytics live in Cloudflare's own
   * dashboard (Workers Observability / D1 metrics), not something this API can self-report. */
  checkD1Health(): Promise<{ healthy: boolean; latencyMs: number }>;
}
