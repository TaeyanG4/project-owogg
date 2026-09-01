import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, Link } from "react-router";
import {
  fetchDiscordGuildBySlug,
  fetchGuildServerGameLeaderboard,
} from "../features/discord/discordGuildApi";
import type {
  DiscordGuildDto,
  GuildSummaryDto,
  GuildXpLeaderboardEntryDto,
  ServerGameLeaderboardEntryDto,
} from "@owogg/contracts";
import { usePublicGames } from "../features/publicGamesApi";
import { publicGameToCard } from "../features/catalog/publicGameAdapter";
import { GameThumbnail } from "../components/ui/GameThumbnail";

import { ApiClientError } from "../lib/api/errors";
import { ArrowLeft, Trophy, Zap, Calendar, Users, AlertCircle, RefreshCw } from "lucide-react";
import { useI18n } from "../features/i18n/I18nContext";
import { formatPublicUserTag } from "@owogg/core";

type ServerTab = "alltime" | "weekly" | "games";

/** /discord/servers/:slug — rebuilt on top of the same non-boxed, semantic-token, divided-list
 * layout language as /users/:id (userProfile.tsx) instead of the standalone dark
 * slate/indigo/backdrop-blur "glass card" look this page used to have. That old look didn't
 * follow the app's theme tokens (hardcoded `slate-900`/`white` instead of `surface`/
 * `text-primary`, so it never actually adapted to light mode) and read as visually disconnected
 * from every other page — especially the heavy bordered cards floating in a wide, mostly-empty
 * `max-w-6xl` container. Matching profile's `max-w-4xl` + divider sections fixes both at once:
 * the whitespace reads as intentional instead of like unfinished padding. */
export default function DiscordServerSlugRoute() {
  const { dict, locale } = useI18n();
  const { games: publicGames } = usePublicGames();
  const games = useMemo(
    () => publicGames.map((game) => publicGameToCard(game, locale)),
    [locale, publicGames],
  );
  const { slug } = useParams<{ slug: string }>();
  const [guild, setGuild] = useState<DiscordGuildDto | null>(null);
  const [isManager, setIsManager] = useState(false);
  const [summary, setSummary] = useState<GuildSummaryDto | null>(null);
  const [topAllTime, setTopAllTime] = useState<GuildXpLeaderboardEntryDto[]>([]);
  const [topWeekly, setTopWeekly] = useState<GuildXpLeaderboardEntryDto[]>([]);

  const [activeTab, setActiveTab] = useState<ServerTab>("alltime");
  const [selectedGameId, setSelectedGameId] = useState("");
  const [gameLeaderboard, setGameLeaderboard] = useState<ServerGameLeaderboardEntryDto[]>([]);
  const [loadingGameScores, setLoadingGameScores] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ code?: string; message: string; status?: number } | null>(
    null,
  );

  const load = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetchDiscordGuildBySlug(slug);
      setGuild(res.guild);
      setIsManager(res.isManager);
      setSummary(res.summary ?? { totalXp: 0, weeklyXp: 0, participantCount: 0 });
      setTopAllTime(res.topAllTime ?? []);
      setTopWeekly(res.topWeekly ?? []);
    } catch (err) {
      if (err instanceof ApiClientError) {
        const errObj: { code?: string; message: string; status?: number } = {
          message: err.detail || err.message,
        };
        if (err.code !== undefined) errObj.code = err.code;
        if (err.status !== undefined) errObj.status = err.status;
        setError(errObj);
      } else {
        setError({
          message: err instanceof Error ? err.message : dict.discordServerSlug.loadFailedGeneric,
        });
      }
    } finally {
      setLoading(false);
    }
  }, [slug, dict.discordServerSlug.loadFailedGeneric]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const firstGame = games[0];
    if (firstGame && !games.some((game) => game.slug === selectedGameId)) {
      setSelectedGameId(firstGame.slug);
    }
  }, [games, selectedGameId]);

  // Fetch Game Scores when game tab or selected game changes
  useEffect(() => {
    if (!slug || activeTab !== "games" || !selectedGameId) return;
    setLoadingGameScores(true);

    fetchGuildServerGameLeaderboard(slug, selectedGameId)
      .then((res) => {
        setGameLeaderboard(res.leaderboard);
      })
      .catch(() => {
        setGameLeaderboard([]);
      })
      .finally(() => setLoadingGameScores(false));
  }, [slug, activeTab, selectedGameId]);

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-24 text-center text-sm text-text-muted">
        {dict.discordServerSlug.loadingServer}
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col items-center gap-4 px-4 py-24 text-center">
        <AlertCircle className="h-9 w-9 text-text-muted" />
        <h1 className="text-lg font-black text-text-primary">
          {error.status === 403
            ? dict.discordServerSlug.privateServerTitle
            : dict.discordServerSlug.notFoundTitle}
        </h1>
        <p className="max-w-md text-sm text-text-muted">
          {error.status === 403 ? dict.discordServerSlug.privateServerMessage : error.message}
        </p>
        <div className="mt-2 flex items-center gap-4">
          <Link
            to="/discord/servers"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-light hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {dict.discordServerSlug.backToDirectory}
          </Link>
          {error.status !== 403 && (
            <button
              onClick={() => void load()}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-text-muted hover:text-text-primary"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {dict.userProfile.retryButton}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!guild) return null;

  const currentGame = games.find((game) => game.slug === selectedGameId);
  const currentGameTitle = currentGame?.title ?? "";

  const visibilityToneClass =
    guild.visibility === "PUBLIC"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
      : guild.visibility === "UNLISTED"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
        : "border-rose-500/30 bg-rose-500/10 text-rose-400";

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-4 py-10 md:px-8">
      <Link
        to="/discord/servers"
        className="flex w-fit items-center gap-2 text-xs font-bold text-text-muted transition-colors hover:text-text-primary"
      >
        <ArrowLeft className="h-4 w-4" />
        {dict.discordServerSlug.backToDirectory}
      </Link>

      {/* Header — no card border/background, matches /users/:id's avatar+name+meta pattern. */}
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
        <div className="h-24 w-24 shrink-0 overflow-hidden rounded-3xl border-2 border-brand/30 bg-brand/10 text-2xl font-black text-brand shadow-lg shadow-brand/10">
          {guild.iconUrl ? (
            <img src={guild.iconUrl} alt={guild.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              {guild.name.charAt(0).toUpperCase()}
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-2 text-center sm:text-left">
          <p className="text-[11px] font-black uppercase tracking-wider text-brand-light">
            Discord Server
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            <h1 className="text-3xl font-black text-text-primary">{guild.name}</h1>
            <span
              className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${visibilityToneClass}`}
            >
              {guild.visibility}
            </span>
          </div>
          {guild.description && (
            <p className="max-w-xl text-xs text-text-secondary sm:text-sm">{guild.description}</p>
          )}
          {isManager && (
            <Link
              to={`/discord/servers/${guild.slug}/manage`}
              className="mt-1 w-fit text-xs font-bold text-brand-light hover:underline sm:mx-0 mx-auto"
            >
              {dict.discordServerSlug.manageServerCta}
            </Link>
          )}
        </div>
      </div>

      {/* Summary metrics — a slim unboxed row, same spirit as profile's XP bar. */}
      <div className="grid grid-cols-1 gap-6 border-t border-border pt-6 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
            <Users className="h-3.5 w-3.5 text-brand-light" />
            {dict.discordServerSlug.participantsLabel}
          </span>
          <span className="text-2xl font-black text-text-primary">
            {(summary?.participantCount ?? 0).toLocaleString()}
            {dict.discordServerSlug.participantsUnit}
          </span>
          <span className="text-[11px] text-text-muted">
            {dict.discordServerSlug.participantsHint}
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
            <Zap className="h-3.5 w-3.5 text-accent-yellow" />
            {dict.discordServerSlug.totalXpLabel}
          </span>
          <span className="text-2xl font-black text-accent-yellow">
            {(summary?.totalXp ?? 0).toLocaleString()} XP
          </span>
          <span className="text-[11px] text-text-muted">{dict.discordServerSlug.totalXpHint}</span>
        </div>

        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
            <Calendar className="h-3.5 w-3.5 text-brand-light" />
            {dict.discordServerSlug.weeklyXpLabel}
          </span>
          <span className="text-2xl font-black text-text-primary">
            {(summary?.weeklyXp ?? 0).toLocaleString()} XP
          </span>
          <span className="text-[11px] text-text-muted">{dict.discordServerSlug.weeklyXpHint}</span>
        </div>
      </div>

      {/* Leaderboard — divided list rows (no bordered card), tab pills styled like ranking.tsx's
          main mode tabs for visual consistency with the rest of the app. */}
      <section className="flex flex-col gap-4 border-t border-border pt-6">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-text-primary">
            <Trophy className="h-4 w-4 text-accent-yellow" />
            {dict.discordServerSlug.leaderboardTitle}
          </h2>

          <div className="flex items-center gap-1.5 rounded-2xl border border-border bg-surface-sidebar p-1.5">
            {(
              [
                ["alltime", dict.discordServerSlug.tabAlltime],
                ["weekly", dict.discordServerSlug.tabWeekly],
                ["games", dict.discordServerSlug.tabGames],
              ] as const
            ).map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`cursor-pointer rounded-xl px-3.5 py-1.5 text-xs font-extrabold transition-all ${
                  activeTab === tab
                    ? "bg-brand text-white shadow-lg shadow-brand/25"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab 1: All-time Server XP */}
        {activeTab === "alltime" &&
          (topAllTime.length === 0 ? (
            <EmptyLeaderboardState
              title={dict.discordServerSlug.emptyAlltimeTitle}
              hintPrefix={dict.discordServerSlug.emptyAlltimeHintPrefix}
              hintSuffix={dict.discordServerSlug.emptyAlltimeHintSuffix}
              command="/owogg play"
            />
          ) : (
            <div className="flex flex-col divide-y divide-border/60">
              {topAllTime.map((entry) => (
                <LeaderboardRow
                  key={entry.userId}
                  rank={entry.rank}
                  nickname={entry.nickname}
                  userId={entry.userId}
                  avatarUrl={entry.avatarUrl}
                  valueLabel={`${entry.xp.toLocaleString()} XP`}
                />
              ))}
            </div>
          ))}

        {/* Tab 2: Weekly Server XP */}
        {activeTab === "weekly" &&
          (topWeekly.length === 0 ? (
            <EmptyLeaderboardState
              title={dict.discordServerSlug.emptyWeeklyTitle}
              hint={dict.discordServerSlug.emptyWeeklyHint}
            />
          ) : (
            <div className="flex flex-col divide-y divide-border/60">
              {topWeekly.map((entry) => (
                <LeaderboardRow
                  key={entry.userId}
                  rank={entry.rank}
                  nickname={entry.nickname}
                  userId={entry.userId}
                  avatarUrl={entry.avatarUrl}
                  valueLabel={`${entry.xp.toLocaleString()} XP`}
                />
              ))}
            </div>
          ))}

        {/* Tab 3: Canonical Game Scores for Server Participants */}
        {activeTab === "games" && (
          <div className="flex flex-col gap-4">
            <div className="scrollbar-none flex items-center gap-2 overflow-x-auto pb-1">
              {games.map((game) => {
                const title = game.title;
                return (
                  <button
                    key={game.slug}
                    type="button"
                    onClick={() => setSelectedGameId(game.slug)}
                    className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border px-3.5 py-2 text-xs font-bold transition-all ${
                      selectedGameId === game.slug
                        ? "border-brand bg-brand text-white shadow-lg shadow-brand/25"
                        : "border-border bg-surface-raised text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    <GameThumbnail
                      thumbnail={game.thumbnail}
                      title={title}
                      accent={game.accent}
                      className="h-4 w-4 rounded"
                    />
                    <span>{title}</span>
                  </button>
                );
              })}
            </div>

            {loadingGameScores ? (
              <p className="py-8 text-center text-xs text-text-muted">
                {dict.discordServerSlug.loadingGame}
              </p>
            ) : gameLeaderboard.length === 0 ? (
              <EmptyLeaderboardState
                title={`${currentGameTitle} ${dict.discordServerSlug.emptyGameScoreSuffix}`}
                hintPrefix={dict.discordServerSlug.emptyGameHintPrefix}
                hintSuffix={dict.discordServerSlug.emptyGameHintSuffix}
                command={`/owogg play game:${selectedGameId}`}
              />
            ) : (
              <div className="flex flex-col divide-y divide-border/60">
                {gameLeaderboard.map((entry, idx) => (
                  <LeaderboardRow
                    key={entry.id}
                    rank={idx + 1}
                    nickname={entry.nickname}
                    userId={entry.userId}
                    avatarUrl={entry.avatarUrl}
                    subtext={entry.createdAt.slice(0, 10)}
                    valueLabel={`${entry.score.toLocaleString()} ${currentGame?.scoreUnit ?? "pts"}`}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Metadata — plain label/value pairs instead of a bordered "info card". */}
      <section className="flex flex-col gap-3 border-t border-border pt-6">
        <h2 className="text-sm font-black uppercase tracking-wide text-text-primary">
          {dict.discordServerSlug.infoCardTitle}
        </h2>
        <div className="grid grid-cols-2 gap-4 text-xs sm:grid-cols-4">
          <div>
            <div className="text-text-muted">Discord Guild ID</div>
            <div className="mt-1 truncate font-mono text-text-secondary">{guild.guildId}</div>
          </div>
          <div>
            <div className="text-text-muted">{dict.discord.registeredLabel}</div>
            <div className="mt-1 text-text-secondary">{guild.registeredAt.slice(0, 10)}</div>
          </div>
          <div>
            <div className="text-text-muted">{dict.discordServerSlug.statusLabel}</div>
            <div className="mt-1 font-semibold text-emerald-400">{guild.registrationStatus}</div>
          </div>
          <div>
            <div className="text-text-muted">{dict.discordServerSlug.visibilityLabel}</div>
            <div className="mt-1 font-semibold text-brand-light">{guild.visibility}</div>
          </div>
        </div>
      </section>
    </div>
  );
}

/** One divided-list row shared by all three leaderboard tabs — top-3 ranks get a filled badge,
 * the rest a plain muted one, matching profile's understated game-records rows. */
function LeaderboardRow({
  rank,
  nickname,
  userId,
  avatarUrl,
  valueLabel,
  subtext,
}: {
  rank: number;
  nickname: string;
  userId: number;
  avatarUrl?: string | null;
  valueLabel: string;
  subtext?: string;
}) {
  const rankBadgeClass =
    rank === 1
      ? "bg-accent-yellow text-black"
      : rank === 2
        ? "bg-text-secondary/80 text-black"
        : rank === 3
          ? "bg-amber-700 text-white"
          : "bg-surface-raised text-text-muted";

  return (
    <div className="flex items-center justify-between gap-4 py-3 transition-colors hover:bg-surface-raised/50">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-black ${rankBadgeClass}`}
        >
          #{rank}
        </span>

        <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full border border-border bg-brand/10 text-xs font-bold text-brand">
          {avatarUrl ? (
            <img src={avatarUrl} alt={nickname} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              {nickname.charAt(0).toUpperCase()}
            </div>
          )}
        </div>

        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-text-primary">
            {formatPublicUserTag(nickname, userId)}
          </div>
          {subtext && <div className="text-[11px] text-text-muted">{subtext}</div>}
        </div>
      </div>

      <div className="shrink-0 text-sm font-black text-brand-light">{valueLabel}</div>
    </div>
  );
}

function EmptyLeaderboardState({
  title,
  hint,
  hintPrefix,
  hintSuffix,
  command,
}: {
  title: string;
  hint?: string;
  hintPrefix?: string;
  hintSuffix?: string;
  command?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <p className="text-sm font-bold text-text-secondary">{title}</p>
      {hint && <p className="max-w-sm text-xs text-text-muted">{hint}</p>}
      {command && (
        <p className="max-w-sm text-xs text-text-muted">
          {hintPrefix} <code className="font-mono text-brand-light">{command}</code> {hintSuffix}
        </p>
      )}
    </div>
  );
}
