import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, Link } from "react-router";
import {
  ArrowLeft,
  Flame,
  Trophy,
  Award,
  Video,
  AlertCircle,
  RefreshCw,
  Bookmark,
  Clock,
  Lock,
} from "lucide-react";
import { useAuth } from "../features/auth";
import { useI18n } from "../features/i18n/I18nContext";
import { fetchPublicProfileApi } from "../features/profile/api";
import { usePublicGames } from "../features/publicGamesApi";
import { publicGameToCard } from "../features/catalog/publicGameAdapter";
import { GameThumbnail } from "../components/ui/GameThumbnail";
import { GameFavoriteCard, GameActivityCard } from "../components/ui/GameLinkCard";
import { ACHIEVEMENT_DEFINITIONS, formatPublicUserTag, type AchievementCode } from "@owogg/core";
import { ApiClientError } from "../lib/api";
import type { PublicProfileResponse } from "@owogg/contracts";

export function meta() {
  return [
    { title: "플레이어 프로필 | OwOGG" },
    { name: "description", content: "OwOGG 플레이어의 공개 프로필, 기록, 도전과제를 확인하세요." },
  ];
}

/** ISO 3166-1 alpha-2 → flag emoji via regional indicator symbols. Sidesteps needing
 * localized country names (COUNTRY_OPTIONS is Korean-only) for a purely visual flag. */
function countryFlagEmoji(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return "";
  const base = 0x1f1e6;
  const chars = code
    .toUpperCase()
    .split("")
    .map((c) => String.fromCodePoint(base + (c.charCodeAt(0) - 65)));
  return chars.join("");
}

type LoadState = "loading" | "success" | "notFound" | "error";

/** /users/:id — the single unified "프로필" page (replaces the old split between this public
 * page and /profile's private "내 프로필" tab, which duplicated header/avatar/records). Not a
 * grid-of-bordered-cards; leans on generous whitespace, type hierarchy, and thin dividers so it
 * reads as one continuous page instead of stacked boxes. Account settings (nickname, connected
 * logins, creator verification, visibility toggles) live separately at /settings — this page is
 * display-only. Favorites/recent-plays are gated server-side per viewer (see
 * getPublicProfileData's viewerId param): `null` means hidden from the CURRENT viewer, which
 * for a guest or another user can mean either "set private" or "empty" — those aren't
 * distinguished on purpose, since revealing "private but non-empty" is itself a small leak. */
export default function UserProfileRoute() {
  const { id } = useParams();
  const { dict } = useI18n();
  const { user: viewer } = useAuth();
  const { games: publicGames } = usePublicGames();
  const games = useMemo(() => publicGames.map((game) => publicGameToCard(game)), [publicGames]);

  const [data, setData] = useState<PublicProfileResponse | null>(null);
  const [state, setState] = useState<LoadState>("loading");

  const load = useCallback(async () => {
    if (!id) return;
    setState("loading");
    try {
      const res = await fetchPublicProfileApi(id);
      setData(res);
      setState("success");
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 404) {
        setState("notFound");
      } else {
        setState("error");
      }
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === "loading") {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-24 text-center text-sm text-text-muted">
        {dict.common.loading}
      </div>
    );
  }

  if (state === "notFound" || state === "error") {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col items-center gap-4 px-4 py-24 text-center">
        <AlertCircle className="h-9 w-9 text-text-muted" />
        <h1 className="text-lg font-black text-text-primary">
          {state === "notFound" ? dict.userProfile.notFoundTitle : dict.userProfile.loadErrorBody}
        </h1>
        {state === "notFound" && (
          <p className="text-sm text-text-muted">{dict.userProfile.notFoundBody}</p>
        )}
        <div className="mt-2 flex items-center gap-4">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-light hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {dict.userProfile.backToHome}
          </Link>
          {state === "error" && (
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

  if (!data) return null;

  const isOwnProfile = viewer?.id === data.id;
  const flag = data.country ? countryFlagEmoji(data.country) : "";

  const favoriteGames = (data.favoriteGameIds ?? [])
    .map((id) => games.find((game) => game.slug === id))
    .filter((game): game is (typeof games)[number] => Boolean(game));

  const recentGames = (data.recentPlays ?? [])
    .map((r) => {
      const game = games.find((candidate) => candidate.slug === r.gameId);
      return game ? { game, lastPlayedAt: r.lastPlayedAt } : null;
    })
    .filter((entry): entry is { game: (typeof games)[number]; lastPlayedAt: string } =>
      Boolean(entry),
    )
    // The profile page is a snapshot, not a full history — cap at 8 even though the API can
    // return up to 12 (getPersonalizationState's own limit), same "preview, not a full listing"
    // reasoning as the home page's row-clamped sections.
    .slice(0, 8);

  const gameRecords = data.gameBests
    .map((best) => {
      const manifest = games.find((game) => game.slug === best.gameId);
      return manifest ? { manifest, best } : null;
    })
    .filter(
      (
        entry,
      ): entry is {
        manifest: (typeof games)[number];
        best: (typeof data.gameBests)[number];
      } => Boolean(entry),
    );

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-4 py-10 md:px-8">
      <Link
        to="/"
        className="flex w-fit items-center gap-2 text-xs font-bold text-text-muted transition-colors hover:text-text-primary"
      >
        <ArrowLeft className="h-4 w-4" />
        {dict.userProfile.backToHome}
      </Link>

      {/* Header — no card border/background, just generous spacing and type hierarchy. */}
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
        <div className="h-24 w-24 shrink-0 overflow-hidden rounded-full border-2 border-brand/30 bg-brand/10 text-2xl font-black text-brand shadow-lg shadow-brand/10">
          {data.avatarUrl ? (
            <img src={data.avatarUrl} alt={data.nickname} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              {data.nickname.slice(0, 2)}
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-2 text-center sm:text-left">
          <p className="text-[11px] font-black uppercase tracking-wider text-brand-light">
            {dict.userProfile.eyebrow}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            <h1 className="text-3xl font-black text-text-primary">
              {formatPublicUserTag(data.nickname, data.id)}
            </h1>
            {flag && <span className="text-xl">{flag}</span>}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs font-semibold text-text-muted sm:justify-start">
            <span>
              {dict.userProfile.joinedPrefix} {data.joinedAt.split("T")[0]}
            </span>
            {data.globalRank !== null && (
              <span className="text-brand-light">
                {dict.userProfile.globalRankPrefix}
                {data.globalRank}
              </span>
            )}
            {data.currentStreak > 0 && (
              <span className="inline-flex items-center gap-1 text-accent-yellow">
                <Flame className="h-3.5 w-3.5" />
                {dict.userProfile.streakLabel} {data.currentStreak}
                {dict.userProfile.streakDaysSuffix}
              </span>
            )}
          </div>
          {isOwnProfile && (
            <Link
              to="/settings"
              className="mt-1 w-fit text-xs font-bold text-brand-light hover:underline sm:mx-0 mx-auto"
            >
              {dict.userProfile.manageProfileCta}
            </Link>
          )}
        </div>
      </div>

      {/* Level / XP — a slim full-width bar, not boxed. */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-black text-text-primary">
            {dict.userProfile.levelLabel} {data.progression.level}
          </span>
          <span className="text-[11px] font-semibold text-text-muted">
            {data.progression.currentLevelProgressXp.toLocaleString()} /{" "}
            {data.progression.currentLevelSpanXp.toLocaleString()} XP
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-surface-raised">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand to-accent-yellow transition-all"
            style={{ width: `${data.progression.progressPercent}%` }}
          />
        </div>
        {data.longestStreak > 0 && (
          <p className="text-[11px] font-semibold text-text-muted">
            {dict.userProfile.longestStreakPrefix}: {data.longestStreak}
            {dict.userProfile.streakDaysSuffix}
          </p>
        )}
      </div>

      {/* Achievements — wrapped pill row, same non-boxed pattern as /profile's list. */}
      <section className="flex flex-col gap-3 border-t border-border pt-6">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-text-primary">
            <Award className="h-4 w-4 text-accent-yellow" />
            {dict.userProfile.achievementsTitle}
          </h2>
          <span className="text-xs font-bold text-text-muted">
            {data.unlockedAchievementCodes.length} / {data.totalAchievements}{" "}
            {dict.userProfile.achievedSuffix}
          </span>
        </div>
        {data.unlockedAchievementCodes.length === 0 ? (
          <p className="text-xs text-text-muted">{dict.userProfile.achievementsEmpty}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {data.unlockedAchievementCodes.map((code) => {
              const def = ACHIEVEMENT_DEFINITIONS[code as AchievementCode];
              return (
                <span
                  key={code}
                  title={def?.descriptionKo}
                  className="inline-flex items-center gap-1.5 rounded-full border border-accent-yellow/30 bg-accent-yellow/10 px-3 py-1.5 text-xs font-bold text-accent-yellow"
                >
                  <Award className="h-3.5 w-3.5" />
                  {def?.titleKo ?? code}
                </span>
              );
            })}
          </div>
        )}
      </section>

      {/* Creator badges — only rendered when there's at least one verified channel. */}
      {data.creatorBadges.length > 0 && (
        <section className="flex flex-col gap-3 border-t border-border pt-6">
          <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-text-primary">
            <Video className="h-4 w-4 text-brand" />
            {dict.userProfile.creatorBadgesTitle}
          </h2>
          <div className="flex flex-wrap gap-2">
            {data.creatorBadges.map((badge) => (
              <a
                key={`${badge.platform}-${badge.channelUrl}`}
                href={badge.channelUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-brand/10 px-3 py-1.5 text-xs font-bold text-brand-light hover:bg-brand/20"
              >
                {badge.platform} · {badge.channelName}
              </a>
            ))}
          </div>
        </section>
      )}

      {/* Game records — a clean divided list rather than a grid of bordered cards. */}
      <section className="flex flex-col gap-1 border-t border-border pt-6">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-black uppercase tracking-wide text-text-primary">
          <Trophy className="h-4 w-4 text-accent-yellow" />
          {dict.userProfile.gameRecordsTitle}
        </h2>
        {gameRecords.length === 0 ? (
          <p className="text-xs text-text-muted">{dict.userProfile.gameRecordsEmpty}</p>
        ) : (
          <div className="flex flex-col divide-y divide-border/60">
            {gameRecords.map(({ manifest, best }) => {
              const title = manifest.title;
              return (
                <Link
                  key={manifest.slug}
                  to={`/games/${manifest.slug}/ranking`}
                  className="group flex items-center gap-4 py-3 transition-colors hover:bg-surface-raised/50"
                >
                  <GameThumbnail
                    thumbnail={manifest.thumbnail}
                    title={title}
                    accent={manifest.accent}
                    className="h-10 w-10 shrink-0 rounded-xl"
                  />
                  <span className="flex-1 truncate text-sm font-bold text-text-primary group-hover:text-brand">
                    {title}
                  </span>
                  <span className="text-sm font-black text-brand-light">{best.formattedScore}</span>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* Favorites — only rendered at all when this viewer is entitled to see it (the owner
          always is; other viewers only when the owner made it public from /settings). */}
      {data.favoriteGameIds !== null && (
        <section className="flex flex-col gap-3 border-t border-border pt-6">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-text-primary">
              <Bookmark className="h-4 w-4 text-accent-yellow" />
              {dict.userProfile.favoritesTitle}
            </h2>
            {isOwnProfile && !data.visibilitySettings?.showFavorites && (
              <PrivateBadge label={dict.userProfile.onlyVisibleToYou} />
            )}
          </div>
          {favoriteGames.length === 0 ? (
            <p className="text-xs text-text-muted">{dict.userProfile.favoritesEmpty}</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {favoriteGames.map((game) => (
                <GameFavoriteCard key={game.slug} game={game} />
              ))}
            </div>
          )}
          {isOwnProfile && (
            <Link
              to="/settings"
              className="w-fit text-[11px] font-bold text-text-muted hover:text-brand-light hover:underline"
            >
              {dict.userProfile.settingsCta}
            </Link>
          )}
        </section>
      )}

      {/* Recent plays — same viewer-gating as favorites, independent toggle. */}
      {data.recentPlays !== null && (
        <section className="flex flex-col gap-3 border-t border-border pt-6">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-text-primary">
              <Clock className="h-4 w-4 text-brand" />
              {dict.userProfile.recentPlaysTitle}
            </h2>
            {isOwnProfile && !data.visibilitySettings?.showRecentPlays && (
              <PrivateBadge label={dict.userProfile.onlyVisibleToYou} />
            )}
          </div>
          {recentGames.length === 0 ? (
            <p className="text-xs text-text-muted">{dict.userProfile.recentPlaysEmpty}</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {recentGames.map(({ game, lastPlayedAt }) => (
                <GameActivityCard key={game.slug} game={game} lastPlayedAt={lastPlayedAt} />
              ))}
            </div>
          )}
          {isOwnProfile && (
            <Link
              to="/settings"
              className="w-fit text-[11px] font-bold text-text-muted hover:text-brand-light hover:underline"
            >
              {dict.userProfile.settingsCta}
            </Link>
          )}
        </section>
      )}
    </div>
  );
}

/** Small inline marker next to a section only the owner can see — makes it obvious the section
 * isn't part of what visitors get, without needing a whole explanatory paragraph. */
function PrivateBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-raised px-2 py-0.5 text-[10px] font-bold text-text-muted">
      <Lock className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}
