import {
  D1UserRepository,
  D1SessionRepository,
  D1ScoreRepository,
  D1PersonalizationRepository,
  D1AccountMergeRepository,
  D1ProgressionRepository,
  D1AchievementRepository,
  D1DiscordLinkRepository,
  D1DiscordGuildRepository,
  D1CreatorRepository,
  D1CreatorReviewRepository,
  D1AdminAuthRepository,
  D1AdminAccountRepository,
  D1GameSettingsRepository,
  D1AdminMonitoringRepository,
  D1UserModerationRepository,
  D1GameCreatorRepository,
  D1SandboxGameRepository,
  D1GameScoreAcceptanceRepository,
  D1GameResultAcceptanceRepository,
  D1GameAchievementRepository,
  D1GameIdentityRepository,
  D1GameVersionRepository,
  D1GameAssetRepository,
  D1OfficialGameUploadRepository,
  BackblazeB2GameBundleRepository,
  UnconfiguredGameBundleRepository,
  B2GameCanonicalRepository,
  type BackblazeB2Config,
} from "@owogg/db";
import {
  GenericScoreReadUseCases,
  PersonalizationUseCases,
  IdentityUseCases,
  AccountMergeUseCases,
  ProgressionUseCases,
  AchievementUseCases,
  ProfileUseCases,
  DiscordLinkUseCases,
  DiscordGuildRegistrationUseCases,
  DiscordGuildDirectoryUseCases,
  DiscordGuildManagementUseCases,
  DiscordGuildXpUseCases,
  CreatorUseCases,
  AdminAuthUseCases,
  AdminAccountUseCases,
  GameSettingsUseCases,
  UserModerationUseCases,
  GameCreatorUseCases,
  SandboxGameUseCases,
  OfficialGameUploadUseCases,
  GameScoreAcceptanceUseCases,
  GameResultAcceptanceUseCases,
  GameAchievementUseCases,
  GamePublicationService,
  SandboxGameVersionPublicationRepository,
  ComposedRuntimeGameRegistry,
  AvailableRuntimeGameCatalog,
  RuntimeGameAvailability,
  type UserRepository,
  type SessionRepository,
  type ScoreRepository,
  type PersonalizationRepository,
  type AccountMergeRepository,
  type ProgressionRepository,
  type AchievementRepository,
  type DiscordLinkRepository,
  type DiscordGuildRepository,
  type CreatorRepository,
  type CreatorReviewRepository,
  type AdminAuthRepository,
  type AdminAccountRepository,
  type GameSettingsRepository,
  type AdminMonitoringRepository,
  type UserModerationRepository,
  type GameCreatorAccessRepository,
  type GameCreatorApplicationRepository,
  type SandboxGameRepository,
  type GameBundleStorageRepository,
  type GameScoreAcceptanceRepository,
  type GameResultAcceptanceRepository,
  type GameAchievementRepository,
  type GameCanonicalRepository,
  type GameIdentityRepository,
  type GameVersionRepository,
  type GameAssetRepository,
  type RuntimeGameRegistry,
  type PublicGameCatalog,
} from "@owogg/core";
import type { D1Database } from "@cloudflare/workers-types";
import { FflateBundleArchiveReader } from "./infrastructure/games/FflateBundleArchiveReader.js";

export interface AppContainer {
  userRepo: UserRepository;
  sessionRepo: SessionRepository;
  scoreRepo: ScoreRepository;
  personalizationRepo: PersonalizationRepository;
  accountMergeRepo: AccountMergeRepository;
  progressionRepo: ProgressionRepository;
  achievementRepo: AchievementRepository;
  discordLinkRepo: DiscordLinkRepository;
  discordGuildRepo: DiscordGuildRepository;
  creatorRepo: CreatorRepository;
  creatorReviewRepo: CreatorReviewRepository;
  adminAuthRepo: AdminAuthRepository;
  adminAccountRepo: AdminAccountRepository;
  gameSettingsRepo: GameSettingsRepository;
  adminMonitoringRepo: AdminMonitoringRepository;
  userModerationRepo: UserModerationRepository;
  /** Implements both GameCreatorAccessRepository and GameCreatorApplicationRepository — see
   * D1GameCreatorRepository's doc comment for why they share one D1 class. */
  gameCreatorRepo: GameCreatorAccessRepository & GameCreatorApplicationRepository;
  sandboxGameRepo: SandboxGameRepository;
  /** Provider-neutral atomic attempt consume + score insert (migration 0032). */
  gameScoreAcceptanceRepo: GameScoreAcceptanceRepository;
  gameResultAcceptanceRepo: GameResultAcceptanceRepository;
  gameAchievementRepo: GameAchievementRepository;
  gameBundleStorageRepo: GameBundleStorageRepository;
  /** True only when a complete Backblaze B2 config was passed to createContainer — routes should
   * check this (rather than try/catch-ing putBundle) to return a clean 503 before touching the
   * use case. */
  gameBundlesConfigured: boolean;
  /** Sole canonical repository for runtime reads and USER metadata control-plane writes. */
  gameCanonicalRepo: GameCanonicalRepository;
  gameIdentityRepo: GameIdentityRepository;
  gameVersionRepo: GameVersionRepository;
  gameAssetRepo: GameAssetRepository;
  runtimeGameRegistry: RuntimeGameRegistry;
  runtimeGameAvailability: RuntimeGameAvailability;
  publicGameCatalog: PublicGameCatalog;
  scoreReadUseCases: GenericScoreReadUseCases;
  personalizationUseCases: PersonalizationUseCases;
  identityUseCases: IdentityUseCases;
  accountMergeUseCases: AccountMergeUseCases;
  progressionUseCases: ProgressionUseCases;
  achievementUseCases: AchievementUseCases;
  profileUseCases: ProfileUseCases;
  discordLinkUseCases: DiscordLinkUseCases;
  discordGuildRegistrationUseCases: DiscordGuildRegistrationUseCases;
  discordGuildDirectoryUseCases: DiscordGuildDirectoryUseCases;
  discordGuildManagementUseCases: DiscordGuildManagementUseCases;
  discordGuildXpUseCases: DiscordGuildXpUseCases;
  creatorUseCases: CreatorUseCases;
  adminAuthUseCases: AdminAuthUseCases;
  adminAccountUseCases: AdminAccountUseCases;
  gameSettingsUseCases: GameSettingsUseCases;
  userModerationUseCases: UserModerationUseCases;
  gameCreatorUseCases: GameCreatorUseCases;
  sandboxGameUseCases: SandboxGameUseCases;
  officialGameUploadUseCases: OfficialGameUploadUseCases;
  gameScoreAcceptanceUseCases: GameScoreAcceptanceUseCases;
  gameResultAcceptanceUseCases: GameResultAcceptanceUseCases;
  gameAchievementUseCases: GameAchievementUseCases;
  gamePublicationService: GamePublicationService;
}

/**
 * `b2Config` is the optional Backblaze B2 credential/endpoint bundle (B2_ENDPOINT/B2_REGION/
 * B2_BUCKET_NAME/B2_KEY_ID/B2_APPLICATION_KEY — see apps/api/src/routes/auth.ts's ApiEnv and
 * apps/api/src/routes/devGames.ts's `readB2Config`), absent in any environment that hasn't set
 * those secrets yet. Unlike the R2 binding this replaced, B2 access is plain HTTPS (via
 * aws4fetch) rather than a Cloudflare binding declared in wrangler.jsonc — so there is no
 * resource that must exist before `wrangler deploy` will succeed; an unconfigured environment
 * just boots with uploads disabled. Every other dependency this container needs is D1-only; B2
 * config is the one exception, threaded through explicitly rather than via `c.env` reads
 * scattered across routes, so there is exactly one place that decides what "unconfigured" means
 * (UnconfiguredGameBundleRepository, see packages/db/src/storage).
 */
export function createContainer(db: D1Database, b2Config?: BackblazeB2Config): AppContainer {
  const userRepo = new D1UserRepository(db);
  const sessionRepo = new D1SessionRepository(db);
  const scoreRepo = new D1ScoreRepository(db);
  const personalizationRepo = new D1PersonalizationRepository(db);
  const accountMergeRepo = new D1AccountMergeRepository(db);
  const progressionRepo = new D1ProgressionRepository(db);
  const achievementRepo = new D1AchievementRepository(db);
  const discordLinkRepo = new D1DiscordLinkRepository(db);
  const discordGuildRepo = new D1DiscordGuildRepository(db);
  const creatorRepo = new D1CreatorRepository(db);
  const creatorReviewRepo = new D1CreatorReviewRepository(db);
  const adminAuthRepo = new D1AdminAuthRepository(db);
  const adminAccountRepo = new D1AdminAccountRepository(db);
  const gameSettingsRepo = new D1GameSettingsRepository(db);
  const adminMonitoringRepo = new D1AdminMonitoringRepository(db);
  const userModerationRepo = new D1UserModerationRepository(db);
  const gameCreatorRepo = new D1GameCreatorRepository(db);
  const sandboxGameRepo = new D1SandboxGameRepository(db);
  const gameScoreAcceptanceRepo = new D1GameScoreAcceptanceRepository(db);
  const gameResultAcceptanceRepo = new D1GameResultAcceptanceRepository(db);
  const gameAchievementRepo = new D1GameAchievementRepository(db);
  const gameIdentityRepo = new D1GameIdentityRepository(db);
  const gameVersionRepo = new D1GameVersionRepository(db);
  const gameAssetRepo = new D1GameAssetRepository(db);
  const officialGameUploadRepo = new D1OfficialGameUploadRepository(db);
  const gameBundleStorageRepo: GameBundleStorageRepository = b2Config
    ? new BackblazeB2GameBundleRepository(b2Config)
    : new UnconfiguredGameBundleRepository();
  // One storage client and one canonical authority. Routes still fail closed when B2 is absent.
  const gameCanonicalRepo: GameCanonicalRepository = new B2GameCanonicalRepository(
    gameBundleStorageRepo,
  );
  const runtimeGameRegistry: RuntimeGameRegistry = new ComposedRuntimeGameRegistry(
    gameIdentityRepo,
    gameVersionRepo,
    gameCanonicalRepo,
  );
  const runtimeGameAvailability = new RuntimeGameAvailability(
    gameIdentityRepo,
    gameVersionRepo,
    gameSettingsRepo,
  );
  const publicGameCatalog = new AvailableRuntimeGameCatalog(
    runtimeGameRegistry,
    runtimeGameAvailability,
  );

  const scoreReadUseCases = new GenericScoreReadUseCases(scoreRepo, runtimeGameRegistry);
  const personalizationUseCases = new PersonalizationUseCases(
    personalizationRepo,
    publicGameCatalog,
  );
  const identityUseCases = new IdentityUseCases(userRepo);
  const accountMergeUseCases = new AccountMergeUseCases(
    accountMergeRepo,
    userRepo,
    adminAccountRepo,
  );
  const progressionUseCases = new ProgressionUseCases(progressionRepo);
  const achievementUseCases = new AchievementUseCases(achievementRepo, publicGameCatalog);
  const profileUseCases = new ProfileUseCases(userRepo);
  const discordLinkUseCases = new DiscordLinkUseCases(discordLinkRepo);
  const discordGuildRegistrationUseCases = new DiscordGuildRegistrationUseCases(discordGuildRepo);
  const discordGuildDirectoryUseCases = new DiscordGuildDirectoryUseCases(discordGuildRepo);
  const discordGuildManagementUseCases = new DiscordGuildManagementUseCases(discordGuildRepo);
  const discordGuildXpUseCases = new DiscordGuildXpUseCases(
    discordGuildRepo,
    userRepo,
    publicGameCatalog,
  );
  const creatorUseCases = new CreatorUseCases(creatorRepo, creatorReviewRepo, publicGameCatalog);
  const adminAuthUseCases = new AdminAuthUseCases(adminAuthRepo);
  const adminAccountUseCases = new AdminAccountUseCases(adminAccountRepo, adminAuthRepo);
  const gameSettingsUseCases = new GameSettingsUseCases(
    gameSettingsRepo,
    gameIdentityRepo,
    gameCanonicalRepo,
  );
  const userModerationUseCases = new UserModerationUseCases(
    userModerationRepo,
    sessionRepo,
    userRepo,
  );
  const gameCreatorUseCases = new GameCreatorUseCases(gameCreatorRepo, userRepo, gameCreatorRepo);
  const gamePublicationService = new GamePublicationService(
    new SandboxGameVersionPublicationRepository(sandboxGameRepo),
    gameBundleStorageRepo,
    new FflateBundleArchiveReader(),
  );
  const sandboxGameUseCases = new SandboxGameUseCases(
    sandboxGameRepo,
    gameBundleStorageRepo,
    gamePublicationService,
    gameCanonicalRepo,
  );
  const officialGamePublicationService = new GamePublicationService(
    officialGameUploadRepo,
    gameBundleStorageRepo,
    new FflateBundleArchiveReader(),
  );
  const officialGameUploadUseCases = new OfficialGameUploadUseCases(
    officialGameUploadRepo,
    gameBundleStorageRepo,
    gameCanonicalRepo,
    officialGamePublicationService,
  );
  const gameScoreAcceptanceUseCases = new GameScoreAcceptanceUseCases(
    runtimeGameRegistry,
    runtimeGameAvailability,
    gameSettingsRepo,
    gameScoreAcceptanceRepo,
  );
  const gameResultAcceptanceUseCases = new GameResultAcceptanceUseCases(
    runtimeGameRegistry,
    runtimeGameAvailability,
    gameSettingsRepo,
    gameResultAcceptanceRepo,
  );
  const gameAchievementUseCases = new GameAchievementUseCases(gameAchievementRepo);
  return {
    userRepo,
    sessionRepo,
    scoreRepo,
    personalizationRepo,
    accountMergeRepo,
    progressionRepo,
    achievementRepo,
    discordLinkRepo,
    discordGuildRepo,
    creatorRepo,
    creatorReviewRepo,
    adminAuthRepo,
    adminAccountRepo,
    gameSettingsRepo,
    adminMonitoringRepo,
    userModerationRepo,
    gameCreatorRepo,
    sandboxGameRepo,
    gameScoreAcceptanceRepo,
    gameResultAcceptanceRepo,
    gameAchievementRepo,
    gameIdentityRepo,
    gameVersionRepo,
    gameAssetRepo,
    gameBundleStorageRepo,
    gameBundlesConfigured: Boolean(b2Config),
    gameCanonicalRepo,
    runtimeGameRegistry,
    runtimeGameAvailability,
    publicGameCatalog,
    scoreReadUseCases,
    personalizationUseCases,
    identityUseCases,
    accountMergeUseCases,
    progressionUseCases,
    achievementUseCases,
    profileUseCases,
    discordLinkUseCases,
    discordGuildRegistrationUseCases,
    discordGuildDirectoryUseCases,
    discordGuildManagementUseCases,
    discordGuildXpUseCases,
    creatorUseCases,
    adminAuthUseCases,
    adminAccountUseCases,
    gameSettingsUseCases,
    userModerationUseCases,
    gameCreatorUseCases,
    sandboxGameUseCases,
    officialGameUploadUseCases,
    gameScoreAcceptanceUseCases,
    gameResultAcceptanceUseCases,
    gameAchievementUseCases,
    gamePublicationService,
  };
}

/**
 * Shared orchestration used by any route that may newly satisfy an achievement
 * (accepted game completion, adding a Favorite, ...). Gathers the current facts from the
 * already-composed use cases and delegates the actual eligibility/unlock decision to
 * AchievementUseCases, which stays the single source of truth for achievement rules.
 */
export async function evaluateAchievementsForUser(
  container: AppContainer,
  userId: number,
): Promise<string[]> {
  const [progress, bests, personalization] = await Promise.all([
    container.progressionUseCases.getProgressionSummary(userId),
    container.scoreReadUseCases.getUserBests(userId),
    container.personalizationUseCases.getPersonalizationState(userId),
  ]);

  return container.achievementUseCases.evaluateAndUnlock(userId, {
    eligibleCompletions: progress.eligibleCompletions,
    level: progress.summary.level,
    hasFavorite: personalization.favoriteGameIds.length > 0,
    playedGameIds: Object.keys(bests),
  });
}

/**
 * Aggregates the public-safe subset of a user's data for the public profile page
 * (GET /api/profile/public/:userId, no auth). Deliberately narrower than everything
 * evaluateAchievementsForUser/the private /profile page can see — never includes email,
 * linked-provider list, or unverified/pending creator platform attempts.
 */
export async function getPublicProfileData(
  container: AppContainer,
  userId: number,
  /** The currently-authenticated viewer's user id, if any — null for guests. Used only to
   * decide (a) whether to bypass the owner's own favorites/recent-plays privacy flags (owners
   * always see their own lists) and (b) whether to include visibilitySettings at all (only
   * ever returned to the owner). Never affects any other field. */
  viewerId: number | null,
): Promise<{
  id: number;
  nickname: string;
  avatarUrl: string | null;
  country: string | null;
  joinedAt: string;
  progression: import("@owogg/core").ProgressionSummary;
  globalRank: number | null;
  currentStreak: number;
  longestStreak: number;
  unlockedAchievementCodes: string[];
  totalAchievements: number;
  gameBests: Array<{ gameId: string; score: number; formattedScore: string }>;
  creatorBadges: Array<{
    platform: string;
    channelName: string;
    channelUrl: string;
    channelHandle: string | null;
  }>;
  favoriteGameIds: string[] | null;
  recentPlays: Array<{ gameId: string; lastPlayedAt: string }> | null;
  visibilitySettings: { showFavorites: boolean; showRecentPlays: boolean } | null;
} | null> {
  const user = await container.userRepo.findById(userId);
  if (!user) return null;

  const isOwner = viewerId !== null && viewerId === userId;
  const showFavorites = user.show_favorites ?? false;
  const showRecentPlays = user.show_recent_plays ?? false;
  const needsPersonalization = isOwner || showFavorites || showRecentPlays;

  const [progress, globalRank, achievements, gameBests, creatorProfile, personalization] =
    await Promise.all([
      container.progressionUseCases.getProgressionSummary(userId),
      container.progressionUseCases.getGlobalXpRank(userId),
      container.achievementUseCases.getSummary(userId),
      container.scoreReadUseCases.getUserBestsFormatted(userId),
      container.creatorUseCases.getCreatorProfileByUserId(userId),
      needsPersonalization
        ? container.personalizationUseCases.getPersonalizationState(userId)
        : null,
    ]);

  const creatorBadges = (creatorProfile?.platformAccounts ?? [])
    .filter((a) => a.verificationStatus === "VERIFIED")
    .map((a) => ({
      platform: a.platform,
      channelName: a.channelName,
      channelUrl: a.channelUrl,
      channelHandle: a.channelHandle,
    }));

  return {
    id: user.id,
    nickname: user.nickname,
    avatarUrl: user.avatar_url,
    country: user.country ?? null,
    joinedAt: user.created_at,
    progression: progress.summary,
    globalRank,
    currentStreak: user.current_streak ?? 0,
    longestStreak: user.longest_streak ?? 0,
    unlockedAchievementCodes: achievements.unlockedCodes,
    totalAchievements: achievements.totalAchievements,
    gameBests,
    creatorBadges,
    favoriteGameIds: isOwner || showFavorites ? (personalization?.favoriteGameIds ?? []) : null,
    recentPlays: isOwner || showRecentPlays ? (personalization?.recentPlays ?? []) : null,
    visibilitySettings: isOwner ? { showFavorites, showRecentPlays } : null,
  };
}
