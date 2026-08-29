import { getStartOfWeekKst } from "../domain/discordGuildPolicy.js";
import type {
  DiscordGuildRepository,
  UserRepository,
  GuildXpLeaderboardEntry,
  GlobalGuildRankEntry,
  ServerGameLeaderboardEntry,
  GuildSummaryData,
} from "../ports/repositories.js";
import type { PublicGameCatalog } from "./publicGameCatalog.js";
import type { RuntimeGame } from "../modules/game/domain/runtimeGame.js";

export class DiscordGuildXpUseCases {
  constructor(
    private guildRepo: DiscordGuildRepository,
    private userRepo: UserRepository,
    private games?: PublicGameCatalog,
  ) {}

  async createPlayContextFromInteraction(input: {
    guildId: string;
    discordUserId: string;
    gameId?: string | null;
  }): Promise<{
    token: string;
    expiresAt: string;
    guildName: string;
    slug: string;
    game?: RuntimeGame;
  }> {
    const guild = await this.guildRepo.findByGuildId(input.guildId);
    if (!guild || guild.registration_status !== "ACTIVE") {
      throw new Error(
        "이 Discord 서버는 아직 OwOGG에 등록되지 않았거나 비활성화되었습니다. 웹사이트(/discord/servers)에서 먼저 서버를 등록해 주세요.",
      );
    }

    const oauthAccount = await this.userRepo.findOAuthAccount("discord", input.discordUserId);
    if (!oauthAccount) {
      throw new Error(
        "OwOGG 계정이 Discord와 연결되어 있지 않습니다. /owogg link 명령어로 계정을 연결해 주세요.",
      );
    }

    let game: RuntimeGame | null = null;
    if (input.gameId) {
      const trimmed = input.gameId.trim();
      game = (await this.games?.findBySlug(trimmed)) ?? null;
      if (!game) {
        throw new Error(`존재하지 않는 게임 ID입니다: ${trimmed}`);
      }
    }

    const playCtx = await this.guildRepo.createPlayContext({
      guildId: input.guildId,
      discordUserId: input.discordUserId,
      userId: oauthAccount.user_id,
      gameId: input.gameId ? input.gameId.trim() : null,
    });

    return {
      token: playCtx.token,
      expiresAt: playCtx.expiresAt,
      guildName: guild.name,
      slug: guild.slug,
      ...(game ? { game } : {}),
    };
  }

  async attributeCompletionToGuild(input: {
    userId: number;
    gameId: string;
    sourceXpEventId: number;
    xpAmount: number;
    playToken: string;
  }): Promise<{
    attributed: boolean;
    reason?: string | undefined;
    guildId?: string | undefined;
    amount?: number | undefined;
  }> {
    if (!input.playToken || !input.playToken.trim()) {
      return { attributed: false, reason: "NO_PLAY_TOKEN" };
    }

    const trimmedToken = input.playToken.trim();
    const playCtx = await this.guildRepo.findPlayContextByToken(trimmedToken);
    if (!playCtx || playCtx.consumedAt !== null) {
      return { attributed: false, reason: "INVALID_OR_CONSUMED_TOKEN" };
    }

    const nowMs = Date.now();
    const expiresMs = new Date(playCtx.expiresAt).getTime();
    if (isNaN(expiresMs) || expiresMs <= nowMs) {
      return { attributed: false, reason: "EXPIRED_TOKEN" };
    }

    if (playCtx.userId !== input.userId) {
      return { attributed: false, reason: "USER_MISMATCH" };
    }

    if (playCtx.gameId && playCtx.gameId !== input.gameId) {
      return { attributed: false, reason: "GAME_MISMATCH" };
    }

    const guild = await this.guildRepo.findByGuildId(playCtx.guildId);
    if (!guild || guild.registration_status !== "ACTIVE") {
      return { attributed: false, reason: "GUILD_NOT_ACTIVE" };
    }

    // Mark play token as consumed
    await this.guildRepo.consumePlayContextByToken(trimmedToken);

    // Attribute XP to guild (1:1 with awarded global XP, 0 if capped)
    await this.guildRepo.attributeGuildXp({
      guildId: playCtx.guildId,
      userId: input.userId,
      sourceXpEventId: input.sourceXpEventId,
      amount: input.xpAmount,
    });

    return {
      attributed: true,
      guildId: playCtx.guildId,
      amount: input.xpAmount,
    };
  }

  async getGuildUserXp(guildId: string, userId: number): Promise<number> {
    return this.guildRepo.getGuildUserXp(guildId, userId);
  }

  async getGuildTotalXp(guildId: string): Promise<number> {
    return this.guildRepo.getGuildTotalXp(guildId);
  }

  async getGuildLeaderboard(
    guildId: string,
    period: "alltime" | "weekly" = "alltime",
    limit = 20,
    offset = 0,
  ): Promise<{ entries: GuildXpLeaderboardEntry[]; total: number }> {
    const startOfWeekIso = period === "weekly" ? getStartOfWeekKst() : undefined;
    return this.guildRepo.getGuildXpLeaderboard(guildId, startOfWeekIso, limit, offset);
  }

  async getGuildSummary(guildId: string): Promise<GuildSummaryData> {
    const startOfWeekIso = getStartOfWeekKst();
    return this.guildRepo.getGuildSummary(guildId, startOfWeekIso);
  }

  async getGlobalGuildRanking(
    period: "alltime" | "weekly" = "alltime",
    limit = 20,
    offset = 0,
  ): Promise<{ guilds: GlobalGuildRankEntry[]; total: number }> {
    const startOfWeekIso = period === "weekly" ? getStartOfWeekKst() : undefined;
    return this.guildRepo.getGlobalGuildActivityRanking(startOfWeekIso, limit, offset);
  }

  async getGuildGameLeaderboard(
    guildId: string,
    gameId: string,
    limit = 20,
  ): Promise<ServerGameLeaderboardEntry[]> {
    const game = (await this.games?.findBySlug(gameId)) ?? null;
    if (!game) throw new Error(`존재하지 않는 게임 ID입니다: ${gameId}`);
    const direction = game.canonical.policy.score?.direction ?? "desc";
    const rulesetRevision = game.canonical.playConfig?.rulesetRevision ?? 1;
    return this.guildRepo.getGuildGameLeaderboard(
      guildId,
      gameId,
      direction,
      limit,
      rulesetRevision,
    );
  }

  async getUserGuildRankSummary(
    guildId: string,
    discordUserId: string,
    period: "alltime" | "weekly" = "alltime",
  ): Promise<{ totalXp: number; rank: number | null; nickname?: string }> {
    const oauthAccount = await this.userRepo.findOAuthAccount("discord", discordUserId);
    if (!oauthAccount) {
      return { totalXp: 0, rank: null };
    }
    const user = await this.userRepo.findById(oauthAccount.user_id);
    const startOfWeekIso = period === "weekly" ? getStartOfWeekKst() : undefined;
    const res = await this.guildRepo.getGuildUserXpRank(
      guildId,
      oauthAccount.user_id,
      startOfWeekIso,
    );
    return {
      totalXp: res.totalXp,
      rank: res.rank,
      ...(user ? { nickname: user.nickname } : {}),
    };
  }
}
