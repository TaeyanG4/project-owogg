import { ACHIEVEMENT_DEFINITIONS, ALL_ACHIEVEMENT_CODES, formatPublicUserTag } from "@owogg/core";
import type { AchievementCode } from "@owogg/core";
import type { AppContainer } from "../../container.js";
import { DISCORD_SUBCOMMANDS, OWOGG_DISCORD_COMMAND } from "./commands.js";
import {
  DISCORD_MESSAGE_FLAG_EPHEMERAL,
  DISCORD_RESPONSE_TYPE,
  type DiscordEmbed,
  type DiscordEmbedFooter,
  type DiscordInteraction,
  type DiscordInteractionResponse,
  type DiscordInteractionUser,
} from "./types.js";

// OwOGG brand palette (apps/web/app/app.css) used consistently across every embed so the
// bot's messages read as a matched extension of the site, not a bare-bones text bot.
const COLOR_BRAND = 0x6366f1; // --color-brand — default/neutral
const COLOR_XP = 0xf59e0b; // --color-accent-yellow — level/XP/leaderboard
const COLOR_SERVER = 0xa855f7; // --color-accent-purple — server-wide info
const COLOR_SUCCESS = 0x10b981; // --color-accent-green
const COLOR_ERROR = 0xf43f5e; // --color-accent-red

function owoggFooter(frontendUrl: string): DiscordEmbedFooter {
  return { text: "OwOGG", icon_url: `${frontendUrl}/favicon-192x192.png` };
}

/** Renders a fixed-width block-character progress bar (Arcane-style rank-card progress
 * indicator, adapted to plain text since embeds can't run canvas/image generation) —
 * e.g. `▰▰▰▰▰▰▱▱▱▱ 62%`. */
function progressBar(percent: number, length = 12): string {
  const clamped = Math.min(100, Math.max(0, percent));
  const filled = Math.round((clamped / 100) * length);
  return "▰".repeat(filled) + "▱".repeat(length - filled) + ` ${Math.round(clamped)}%`;
}

/** Neutralizes Discord markdown syntax in user-controlled strings (OwOGG nicknames, Discord
 * guild names, Discord display names) before they're interpolated into an embed. Unlike plain
 * message `content`, embed `description`/`field.value` fully render `[text](url)` masked
 * links — without this, a nickname like `[Free Nitro](evil.example)` would render as a
 * clickable phishing link in the public `/owogg leaderboard` embed. */
function escapeMarkdown(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\*/g, "\\*")
    .replace(/_/g, "\\_")
    .replace(/~/g, "\\~")
    .replace(/`/g, "\\`")
    .replace(/\|/g, "\\|")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

/** Discord's default (no custom avatar set) avatar, computed the same way Discord's own
 * clients do for the modern username system (no legacy discriminator). */
function discordAvatarUrl(user: DiscordInteractionUser): string {
  if (user.avatar) {
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`;
  }
  const index = Number((BigInt(user.id) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

/** Builds the URL for the rendered rank/profile card image (apps/api/src/routes/render.ts) —
 * Discord fetches and caches whatever this points to as the embed's large `image`. Query values
 * are display data the caller already resolved server-side, not identifiers. */
function buildRankCardUrl(
  apiBaseUrl: string,
  props: {
    nickname: string;
    subtitle: string;
    level: number;
    totalXp: number;
    progressPercent: number;
    rank?: number | undefined;
  },
): string {
  const params = new URLSearchParams({
    nickname: props.nickname,
    subtitle: props.subtitle,
    level: String(props.level),
    totalXp: String(props.totalXp),
    progressPercent: String(Math.round(props.progressPercent)),
  });
  if (props.rank !== undefined) {
    params.set("rank", String(props.rank));
  }
  return `${apiBaseUrl}/api/render/rank-card?${params.toString()}`;
}

function ephemeralEmbed(embed: DiscordEmbed): DiscordInteractionResponse {
  return {
    type: DISCORD_RESPONSE_TYPE.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { embeds: [embed], flags: DISCORD_MESSAGE_FLAG_EPHEMERAL },
  };
}

function publicEmbed(embed: DiscordEmbed): DiscordInteractionResponse {
  return { type: DISCORD_RESPONSE_TYPE.CHANNEL_MESSAGE_WITH_SOURCE, data: { embeds: [embed] } };
}

/** Errors are always ephemeral (only the invoking user needs to see why something failed). */
function errorEmbed(description: string, frontendUrl: string): DiscordInteractionResponse {
  return ephemeralEmbed({
    title: "⚠️ 오류",
    description,
    color: COLOR_ERROR,
    footer: owoggFooter(frontendUrl),
  });
}

/** Dispatches a verified `/owogg <subcommand>` interaction to its handler. */
export async function handleOwoggCommand(
  container: AppContainer,
  interaction: DiscordInteraction,
  frontendUrl: string,
  apiBaseUrl: string,
): Promise<DiscordInteractionResponse> {
  const subcommand = interaction.data?.options?.[0]?.name;
  // In-guild interactions carry the user under `member.user`; DM/user-installed
  // interactions carry it directly under `user`.
  const discordUser = interaction.member?.user ?? interaction.user;

  if (!discordUser) {
    return errorEmbed("Discord 사용자 정보를 확인할 수 없습니다.", frontendUrl);
  }

  switch (subcommand) {
    case DISCORD_SUBCOMMANDS.HELP:
      return handleHelpCommand(frontendUrl);
    case DISCORD_SUBCOMMANDS.GAMES:
      return handleGamesCommand(container, frontendUrl);
    case DISCORD_SUBCOMMANDS.LINK:
      return handleLinkCommand(container, discordUser, frontendUrl);
    case DISCORD_SUBCOMMANDS.PROFILE:
      return handleProfileCommand(container, discordUser, frontendUrl);
    case DISCORD_SUBCOMMANDS.PLAY:
      return handlePlayCommand(container, interaction, discordUser, frontendUrl);
    case DISCORD_SUBCOMMANDS.RANK:
      return handleRankCommand(container, interaction, discordUser, frontendUrl, apiBaseUrl);
    case DISCORD_SUBCOMMANDS.LEADERBOARD:
      return handleLeaderboardCommand(container, interaction, frontendUrl);
    case DISCORD_SUBCOMMANDS.SERVER:
      return handleServerCommand(container, interaction, frontendUrl);
    case DISCORD_SUBCOMMANDS.ACHIEVEMENTS:
      return handleAchievementsCommand(container, discordUser, frontendUrl);
    default:
      return errorEmbed("알 수 없는 명령어입니다.", frontendUrl);
  }
}

/** Reads the option value from the invoked subcommand's own option list (not the top-level
 * command) — Discord nests subcommand options one level down in `data.options[0].options`. */
function getSubcommandOptionValue(
  interaction: DiscordInteraction,
  optionName: string,
): string | undefined {
  const value = interaction.data?.options?.[0]?.options?.find((o) => o.name === optionName)?.value;
  return typeof value === "string" ? value : undefined;
}

function periodLabel(period: "alltime" | "weekly"): string {
  return period === "weekly" ? "이번 주" : "전체 기간";
}

/** Lists every /owogg subcommand and its description, generated straight from
 * OWOGG_DISCORD_COMMAND (commands.ts) so this can never drift out of sync with what's actually
 * registered. */
function handleHelpCommand(frontendUrl: string): DiscordInteractionResponse {
  const lines = OWOGG_DISCORD_COMMAND.options.map(
    (opt) => `**/owogg ${opt.name}** — ${opt.description}`,
  );

  return publicEmbed({
    title: "📖 OwOGG 봇 명령어",
    description: lines.join("\n"),
    color: COLOR_BRAND,
    footer: owoggFooter(frontendUrl),
  });
}

async function handleGamesCommand(
  container: AppContainer,
  frontendUrl: string,
): Promise<DiscordInteractionResponse> {
  const published = await container.publicGameCatalog.list();
  const footer = owoggFooter(frontendUrl);

  if (published.length === 0) {
    return publicEmbed({
      title: "🎮 OwOGG 게임 목록",
      description: "현재 플레이 가능한 게임이 없습니다.",
      color: COLOR_BRAND,
      footer,
    });
  }

  const lines = published.map(
    (game) =>
      `• [${game.canonical.title}](${frontendUrl}/games/${encodeURIComponent(game.identity.slug)})`,
  );
  return publicEmbed({
    title: "🎮 OwOGG 게임 목록",
    description: lines.join("\n"),
    color: COLOR_BRAND,
    footer,
  });
}

async function handleLinkCommand(
  container: AppContainer,
  discordUser: DiscordInteractionUser,
  frontendUrl: string,
): Promise<DiscordInteractionResponse> {
  const footer = owoggFooter(frontendUrl);
  const existing = await container.userRepo.findOAuthAccount("discord", discordUser.id);
  if (existing) {
    return ephemeralEmbed({
      title: "🔗 Discord 계정 연동",
      description: "✅ 이 Discord 계정은 이미 OwOGG 계정과 연동되어 있습니다.",
      color: COLOR_SUCCESS,
      footer,
    });
  }

  const displayName = discordUser.global_name || discordUser.username;
  const { token, expiresAt } = await container.discordLinkUseCases.createLinkChallenge(
    discordUser.id,
    displayName,
  );

  const expiresInMinutes = Math.max(
    1,
    Math.round((new Date(expiresAt).getTime() - Date.now()) / 60000),
  );
  const linkUrl = `${frontendUrl}/discord/link?token=${encodeURIComponent(token)}`;

  return ephemeralEmbed({
    title: "🔗 Discord 계정 연동",
    description:
      `OwOGG 계정과 연동하려면 아래 링크를 열고 로그인해주세요.\n\n` +
      `🔗 [연동 링크 열기](${linkUrl})\n\n` +
      `⏱️ 이 링크는 ${expiresInMinutes}분 후 만료되며, 1회만 사용할 수 있습니다.`,
    color: COLOR_BRAND,
    footer,
  });
}

async function handleProfileCommand(
  container: AppContainer,
  discordUser: DiscordInteractionUser,
  frontendUrl: string,
): Promise<DiscordInteractionResponse> {
  const footer = owoggFooter(frontendUrl);
  const user = await container.userRepo.findByOAuth("discord", discordUser.id);
  if (!user) {
    return errorEmbed(
      "이 Discord 계정은 아직 OwOGG 계정과 연동되지 않았습니다. `/owogg link`로 먼저 연동해주세요.",
      frontendUrl,
    );
  }

  const { summary } = await container.progressionUseCases.getProgressionSummary(user.id);
  return ephemeralEmbed({
    title: `👤 ${escapeMarkdown(user.nickname)}`,
    url: `${frontendUrl}/users/${user.id}`,
    color: COLOR_XP,
    thumbnail: { url: discordAvatarUrl(discordUser) },
    fields: [
      { name: "레벨", value: `${summary.level}`, inline: true },
      { name: "총 XP", value: `${summary.totalXp.toLocaleString()} XP`, inline: true },
      {
        name: `다음 레벨까지 (${summary.currentLevelProgressXp.toLocaleString()} / ${summary.currentLevelSpanXp.toLocaleString()} XP)`,
        value: progressBar(summary.progressPercent),
        inline: false,
      },
    ],
    // No rank-card image here — the text fields above already show everything the card would,
    // and the extra image made the ephemeral response feel heavier than needed for a quick
    // `/owogg profile` check. `/owogg rank`'s guild-context card is unaffected.
    footer,
  });
}

async function handlePlayCommand(
  container: AppContainer,
  interaction: DiscordInteraction,
  discordUser: DiscordInteractionUser,
  frontendUrl: string,
): Promise<DiscordInteractionResponse> {
  const guildId = interaction.guild_id;
  if (!guildId) {
    return errorEmbed("이 명령어는 Discord 서버(길드) 채널에서만 실행할 수 있습니다.", frontendUrl);
  }

  const subCommandOptions = interaction.data?.options?.[0]?.options;
  const gameOption = subCommandOptions?.find((o) => o.name === "game")?.value;
  const selectedGameId = typeof gameOption === "string" ? gameOption.trim() : null;

  try {
    const playCtx = await container.discordGuildXpUseCases.createPlayContextFromInteraction({
      guildId,
      discordUserId: discordUser.id,
      gameId: selectedGameId,
    });

    const targetPath = playCtx.game
      ? `/games/${encodeURIComponent(playCtx.game.identity.slug)}#play_token=${encodeURIComponent(playCtx.token)}`
      : `/games#play_token=${encodeURIComponent(playCtx.token)}`;

    const playUrl = `${frontendUrl}${targetPath}`;
    const gameTitle = playCtx.game?.canonical.title ?? "게임 선택";

    return ephemeralEmbed({
      title: `🎮 ${escapeMarkdown(playCtx.guildName)} 플레이 링크 발급`,
      description: "아래 링크를 통해 게임을 플레이하면 이 서버에 XP가 기여됩니다.",
      color: COLOR_BRAND,
      fields: [{ name: gameTitle, value: `[플레이하기](${playUrl})` }],
      footer: { text: `⏱️ 이 링크는 15분간 유효하며 1회만 사용할 수 있습니다.` },
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "플레이 링크 생성에 실패했습니다.";
    return errorEmbed(errorMsg, frontendUrl);
  }
}

async function handleRankCommand(
  container: AppContainer,
  interaction: DiscordInteraction,
  discordUser: DiscordInteractionUser,
  frontendUrl: string,
  apiBaseUrl: string,
): Promise<DiscordInteractionResponse> {
  const footer = owoggFooter(frontendUrl);
  const guildId = interaction.guild_id;
  if (!guildId) {
    return errorEmbed("이 명령어는 Discord 서버(길드) 채널에서만 실행할 수 있습니다.", frontendUrl);
  }

  const guild = await container.discordGuildDirectoryUseCases.getGuildByGuildId(guildId);
  if (!guild || guild.registration_status !== "ACTIVE") {
    return errorEmbed(
      "이 Discord 서버는 아직 OwOGG에 등록되지 않았거나 비활성화되었습니다. 웹사이트(/discord/servers)에서 먼저 서버를 등록해 주세요.",
      frontendUrl,
    );
  }

  const oauthAccount = await container.userRepo.findOAuthAccount("discord", discordUser.id);
  if (!oauthAccount) {
    return errorEmbed(
      "OwOGG 계정이 Discord와 연결되어 있지 않습니다. `/owogg link` 명령어로 계정을 먼저 연결해 주세요.",
      frontendUrl,
    );
  }

  const period =
    getSubcommandOptionValue(interaction, "period") === "weekly" ? "weekly" : "alltime";
  const rankSummary = await container.discordGuildXpUseCases.getUserGuildRankSummary(
    guildId,
    discordUser.id,
    period,
  );

  const thumbnail = guild.icon_url ? { url: guild.icon_url } : undefined;
  const guildName = escapeMarkdown(guild.name);

  if (!rankSummary.rank || rankSummary.totalXp <= 0) {
    return ephemeralEmbed({
      title: `🏆 ${guildName} (${periodLabel(period)})`,
      description:
        "아직 이 서버에 기여한 XP가 없습니다. `/owogg play` 명령어로 게임을 플레이해보세요!",
      color: COLOR_BRAND,
      ...(thumbnail ? { thumbnail } : {}),
      footer,
    });
  }

  const nickname = rankSummary.nickname || discordUser.global_name || discordUser.username;
  // The rendered card's "LEVEL"/XP bar always means global progression (never guild-scoped XP —
  // the three XP concepts documented in DISCORD_BOT_GUIDE.md §4 are never mixed); the guild rank
  // badge on the card is this server's contribution rank specifically.
  const { summary: globalSummary } = await container.progressionUseCases.getProgressionSummary(
    oauthAccount.user_id,
  );

  return ephemeralEmbed({
    title: `🏆 ${guildName} 활동 현황 (${periodLabel(period)})`,
    color: COLOR_XP,
    ...(thumbnail ? { thumbnail } : {}),
    fields: [
      { name: "닉네임", value: escapeMarkdown(nickname), inline: true },
      { name: "서버 기여 XP", value: `${rankSummary.totalXp.toLocaleString()} XP`, inline: true },
      { name: "서버 순위", value: `#${rankSummary.rank}`, inline: true },
    ],
    image: {
      url: buildRankCardUrl(apiBaseUrl, {
        nickname,
        subtitle: guildName,
        level: globalSummary.level,
        totalXp: globalSummary.totalXp,
        progressPercent: globalSummary.progressPercent,
        rank: rankSummary.rank,
      }),
    },
    footer,
  });
}

async function handleLeaderboardCommand(
  container: AppContainer,
  interaction: DiscordInteraction,
  frontendUrl: string,
): Promise<DiscordInteractionResponse> {
  const footer = owoggFooter(frontendUrl);
  const guildId = interaction.guild_id;
  if (!guildId) {
    return errorEmbed("이 명령어는 Discord 서버(길드) 채널에서만 실행할 수 있습니다.", frontendUrl);
  }

  const guild = await container.discordGuildDirectoryUseCases.getGuildByGuildId(guildId);
  if (!guild || guild.registration_status !== "ACTIVE") {
    return errorEmbed(
      "이 Discord 서버는 아직 OwOGG에 등록되지 않았거나 비활성화되었습니다. 웹사이트(/discord/servers)에서 먼저 서버를 등록해 주세요.",
      frontendUrl,
    );
  }

  const period =
    getSubcommandOptionValue(interaction, "period") === "weekly" ? "weekly" : "alltime";
  const leaderboard = await container.discordGuildXpUseCases.getGuildLeaderboard(
    guildId,
    period,
    10,
    0,
  );

  const serverUrl = `${frontendUrl}/discord/servers/${guild.slug}`;
  const thumbnail = guild.icon_url ? { url: guild.icon_url } : undefined;
  const guildName = escapeMarkdown(guild.name);
  const periodTitle = periodLabel(period);

  if (leaderboard.entries.length === 0) {
    return publicEmbed({
      title: `📊 ${guildName} 서버 XP 리더보드 (${periodTitle})`,
      description: "아직 등록된 활동 XP가 없습니다. `/owogg play`로 첫 기여를 시작해보세요!",
      color: COLOR_BRAND,
      ...(thumbnail ? { thumbnail } : {}),
      fields: [{ name: "전체 랭킹", value: `[웹에서 보기](${serverUrl})` }],
      footer,
    });
  }

  const lines = leaderboard.entries.map(
    (e) =>
      `${e.rank}. **${escapeMarkdown(formatPublicUserTag(e.nickname, e.userId))}** — ${e.xp.toLocaleString()} XP`,
  );

  return publicEmbed({
    title: `📊 ${guildName} 서버 XP 리더보드 (${periodTitle}, Top 10)`,
    description: lines.join("\n"),
    color: COLOR_XP,
    ...(thumbnail ? { thumbnail } : {}),
    fields: [{ name: "전체 랭킹", value: `[웹에서 전체 보기](${serverUrl})` }],
    footer,
  });
}

async function handleAchievementsCommand(
  container: AppContainer,
  discordUser: DiscordInteractionUser,
  frontendUrl: string,
): Promise<DiscordInteractionResponse> {
  const footer = owoggFooter(frontendUrl);
  const user = await container.userRepo.findByOAuth("discord", discordUser.id);
  if (!user) {
    return errorEmbed(
      "이 Discord 계정은 아직 OwOGG 계정과 연동되지 않았습니다. `/owogg link`로 먼저 연동해주세요.",
      frontendUrl,
    );
  }

  const summary = await container.achievementUseCases.getSummary(user.id);
  const unlocked = new Set(summary.unlockedCodes);

  const lines = ALL_ACHIEVEMENT_CODES.map((code: AchievementCode) => {
    const def = ACHIEVEMENT_DEFINITIONS[code];
    const mark = unlocked.has(code) ? "✅" : "⬜";
    return `${mark} **${def.titleKo}** — ${def.descriptionKo}`;
  });

  return ephemeralEmbed({
    title: `🏅 ${escapeMarkdown(user.nickname)}님의 도전과제`,
    url: `${frontendUrl}/users/${user.id}`,
    description: lines.join("\n"),
    color: COLOR_XP,
    thumbnail: { url: discordAvatarUrl(discordUser) },
    footer: {
      text: `${summary.unlockedCodes.length} / ${summary.totalAchievements} 달성 · OwOGG`,
      ...(footer.icon_url ? { icon_url: footer.icon_url } : {}),
    },
  });
}

async function handleServerCommand(
  container: AppContainer,
  interaction: DiscordInteraction,
  frontendUrl: string,
): Promise<DiscordInteractionResponse> {
  const footer = owoggFooter(frontendUrl);
  const guildId = interaction.guild_id;
  if (!guildId) {
    return errorEmbed("이 명령어는 Discord 서버(길드) 채널에서만 실행할 수 있습니다.", frontendUrl);
  }

  const guild = await container.discordGuildDirectoryUseCases.getGuildByGuildId(guildId);
  if (!guild || guild.registration_status !== "ACTIVE") {
    return errorEmbed(
      "이 Discord 서버는 아직 OwOGG에 등록되지 않았거나 비활성화되었습니다. 웹사이트(/discord/servers)에서 먼저 서버를 등록해 주세요.",
      frontendUrl,
    );
  }

  const summary = await container.discordGuildXpUseCases.getGuildSummary(guildId);
  const serverUrl = `${frontendUrl}/discord/servers/${guild.slug}`;
  const thumbnail = guild.icon_url ? { url: guild.icon_url } : undefined;

  return publicEmbed({
    title: `🏰 ${escapeMarkdown(guild.name)}`,
    url: serverUrl,
    color: COLOR_SERVER,
    ...(thumbnail ? { thumbnail } : {}),
    fields: [
      { name: "전체 활동 XP", value: `${summary.totalXp.toLocaleString()} XP`, inline: true },
      { name: "이번 주 활동 XP", value: `${summary.weeklyXp.toLocaleString()} XP`, inline: true },
      { name: "OwOGG 참여자", value: `${summary.participantCount}명`, inline: true },
    ],
    footer,
  });
}
