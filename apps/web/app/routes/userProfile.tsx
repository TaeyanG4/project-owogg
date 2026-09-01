import { useState, useEffect, useCallback, useMemo, type ReactNode } from "react";
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
  CalendarDays,
  Bug,
  BadgePlus,
  Boxes,
  Pencil,
  Save,
  Settings,
  UserRoundPlus,
  UserRoundCheck,
  UsersRound,
  X,
} from "lucide-react";
import { defaultUrlTransform } from "react-markdown";
import Markdown from "react-markdown";
import { useAuth } from "../features/auth";
import { fetchConnectedProviders } from "../features/auth/authService";
import { useI18n } from "../features/i18n/I18nContext";
import type { Dictionary } from "../features/i18n/dictionary";
import {
  fetchPublicProfileApi,
  updateAvatarPreferenceApi,
  updateProfilePresentationApi,
  setProfileFollowApi,
} from "../features/profile/api";
import { usePublicGames } from "../features/publicGamesApi";
import { publicGameToCard } from "../features/catalog/publicGameAdapter";
import { GameThumbnail } from "../components/ui/GameThumbnail";
import { GameFavoriteCard, GameActivityCard } from "../components/ui/GameLinkCard";
import { ProfileActivityHeatmap } from "../components/profile/ProfileActivityHeatmap";
import { ACHIEVEMENT_DEFINITIONS, formatPublicUserTag, type AchievementCode } from "@owogg/core";
import { ApiClientError } from "../lib/api";
import type {
  ConnectedProvider,
  ProfileBanner,
  PublicProfileResponse,
  PublicProfileRole,
  SocialProvider,
} from "@owogg/contracts";

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

const PROFILE_BANNERS: ProfileBanner[] = ["AURORA", "SUNSET", "MIDNIGHT", "MINT"];

/** The persisted keys predate these designs and are intentionally stable because migration 0053
 * is already applied to Staging D1. The visible names and artwork are the new preset contract. */
const PROFILE_BANNER_ART: Record<ProfileBanner, { backgroundImage: string; glowClass: string }> = {
  AURORA: {
    backgroundImage:
      "radial-gradient(circle at 16% 18%, rgba(196,181,253,.78), transparent 24%), radial-gradient(circle at 78% 24%, rgba(56,189,248,.52), transparent 27%), radial-gradient(circle at 64% 90%, rgba(217,70,239,.38), transparent 34%), linear-gradient(118deg, #11152d 0%, #312e81 42%, #17152f 100%)",
    glowClass: "bg-violet-300/35",
  },
  SUNSET: {
    backgroundImage:
      "radial-gradient(circle at 22% 26%, rgba(251,207,232,.72), transparent 23%), radial-gradient(circle at 72% 18%, rgba(251,146,60,.46), transparent 28%), radial-gradient(circle at 82% 82%, rgba(244,63,94,.42), transparent 31%), linear-gradient(122deg, #25142f 0%, #7f1d4e 48%, #3b1d31 100%)",
    glowClass: "bg-rose-300/30",
  },
  MIDNIGHT: {
    backgroundImage:
      "radial-gradient(circle at 18% 76%, rgba(14,165,233,.42), transparent 29%), radial-gradient(circle at 84% 24%, rgba(129,140,248,.48), transparent 26%), radial-gradient(circle at 52% 46%, rgba(255,255,255,.12), transparent 17%), linear-gradient(125deg, #020617 0%, #0f2b52 48%, #1e1b4b 100%)",
    glowClass: "bg-sky-300/30",
  },
  MINT: {
    backgroundImage:
      "radial-gradient(circle at 20% 18%, rgba(153,246,228,.62), transparent 25%), radial-gradient(circle at 80% 72%, rgba(34,211,238,.42), transparent 31%), radial-gradient(circle at 58% 22%, rgba(59,130,246,.3), transparent 23%), linear-gradient(120deg, #082f49 0%, #0f766e 50%, #172554 100%)",
    glowClass: "bg-teal-200/30",
  },
};

/** /users/:id — the single unified "프로필" page (replaces the old split between this public
 * page and /profile's private "내 프로필" tab, which duplicated header/avatar/records). Not a
 * grid-of-bordered-cards; leans on generous whitespace, type hierarchy, and thin dividers so it
 * reads as one continuous page instead of stacked boxes. Account settings (nickname, connected
 * logins, streamer verification, visibility toggles) live separately at /settings — this page is
 * owner-editable for predefined presentation settings and verified linked-account avatar
 * candidates. Favorites/recent-plays and the exact daily activity calendar are gated
 * server-side per viewer (see
 * getPublicProfileData's viewerId param): `null` means hidden from the CURRENT viewer, which
 * for a guest or another user can mean either "set private" or "empty" — those aren't
 * distinguished on purpose, since revealing "private but non-empty" is itself a small leak. */
export default function UserProfileRoute() {
  const { id } = useParams();
  const { dict, locale } = useI18n();
  const { user: viewer, refreshUser } = useAuth();
  const { games: publicGames } = usePublicGames();
  const games = useMemo(
    () => publicGames.map((game) => publicGameToCard(game, locale)),
    [locale, publicGames],
  );

  const [data, setData] = useState<PublicProfileResponse | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [editingPresentation, setEditingPresentation] = useState(false);
  const [presentationBanner, setPresentationBanner] = useState<ProfileBanner>("AURORA");
  const [presentationBio, setPresentationBio] = useState("");
  const [presentationBusy, setPresentationBusy] = useState(false);
  const [presentationError, setPresentationError] = useState<string | null>(null);
  const [editingAvatar, setEditingAvatar] = useState(false);
  const [avatarCandidates, setAvatarCandidates] = useState<ConnectedProvider[]>([]);
  const [avatarBusyProvider, setAvatarBusyProvider] = useState<SocialProvider | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [followBusy, setFollowBusy] = useState(false);
  const [followError, setFollowError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setState("loading");
    try {
      const res = await fetchPublicProfileApi(id);
      setData(res);
      setPresentationBanner(res.banner);
      setPresentationBio(res.bioMarkdown);
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

  const loadedProfileUserId = data?.id ?? null;
  useEffect(() => {
    if (loadedProfileUserId === null || viewer?.id !== loadedProfileUserId) {
      setAvatarCandidates([]);
      setEditingAvatar(false);
      return;
    }

    let cancelled = false;
    void fetchConnectedProviders()
      .then((response) => {
        if (!cancelled) setAvatarCandidates(response.providers.filter((item) => item.avatarUrl));
      })
      .catch(() => {
        if (!cancelled) setAvatarCandidates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [loadedProfileUserId, viewer?.id]);

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

  const savePresentation = async () => {
    if (!isOwnProfile || presentationBusy) return;
    setPresentationBusy(true);
    setPresentationError(null);
    try {
      const updated = await updateProfilePresentationApi(presentationBanner, presentationBio);
      setData((current) =>
        current
          ? { ...current, banner: updated.banner, bioMarkdown: updated.bioMarkdown }
          : current,
      );
      setEditingPresentation(false);
    } catch (caught) {
      setPresentationError(
        caught instanceof ApiClientError
          ? caught.detail || dict.userProfile.presentationUpdateFailed
          : dict.userProfile.presentationUpdateFailed,
      );
    } finally {
      setPresentationBusy(false);
    }
  };

  const selectAvatar = async (provider: SocialProvider) => {
    if (!isOwnProfile || avatarBusyProvider) return;
    setAvatarBusyProvider(provider);
    setAvatarError(null);
    try {
      const updated = await updateAvatarPreferenceApi(provider);
      setData((current) => (current ? { ...current, avatarUrl: updated.avatarUrl } : current));
      setAvatarCandidates((current) =>
        current.map((item) => ({ ...item, isAvatarSelected: item.provider === provider })),
      );
      setEditingAvatar(false);
      void refreshUser();
    } catch {
      setAvatarError(dict.profile.avatarUpdateFailed);
    } finally {
      setAvatarBusyProvider(null);
    }
  };

  const toggleFollow = async () => {
    if (!viewer || isOwnProfile || followBusy) return;
    setFollowBusy(true);
    setFollowError(null);
    try {
      const updated = await setProfileFollowApi(data.id, !data.followStats.viewerIsFollowing);
      setData((current) => (current ? { ...current, followStats: updated.followStats } : current));
    } catch {
      setFollowError(dict.userProfile.followUpdateFailed);
    } finally {
      setFollowBusy(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-4 px-4 py-7 sm:px-6 md:px-8 md:py-9">
      <Link
        to="/"
        className="flex w-fit items-center gap-2 text-xs font-bold text-text-muted transition-colors hover:text-text-primary"
      >
        <ArrowLeft className="h-4 w-4" />
        {dict.userProfile.backToHome}
      </Link>

      <article className="overflow-hidden rounded-[24px] border border-white/[0.09] bg-surface-raised/55 ring-1 ring-inset ring-white/[0.035]">
        <header className="relative h-52 overflow-hidden bg-slate-950 sm:h-60 lg:h-72">
          <ProfileBannerArtwork banner={data.banner} />
          {isOwnProfile && (
            <button
              type="button"
              onClick={() => setEditingPresentation(true)}
              className="absolute right-4 top-4 inline-flex items-center gap-2 rounded-xl border border-white/20 bg-black/35 px-3 py-2 text-[11px] font-black text-white backdrop-blur-md transition-colors hover:bg-black/50"
            >
              <Pencil className="h-3.5 w-3.5" /> {dict.userProfile.editProfileCta}
            </button>
          )}
        </header>

        <div className="grid lg:grid-cols-[250px_minmax(0,1fr)] xl:grid-cols-[270px_minmax(0,1fr)]">
          <aside className="relative border-b border-border/60 px-5 pb-7 lg:border-b-0 lg:border-r lg:px-6">
            <div className="relative -mt-12 w-fit lg:-mt-16">
              <div className="h-24 w-24 overflow-hidden rounded-full border-[3px] border-surface-raised/95 bg-surface text-2xl font-black text-brand shadow-[0_12px_32px_rgba(0,0,0,0.35)] ring-1 ring-white/25 sm:h-28 sm:w-28 lg:h-32 lg:w-32">
                {data.avatarUrl ? (
                  <img
                    src={data.avatarUrl}
                    alt={data.nickname}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    {data.nickname.slice(0, 2)}
                  </div>
                )}
              </div>
              {isOwnProfile && avatarCandidates.length > 0 && (
                <button
                  type="button"
                  aria-label={dict.profile.avatarTitle}
                  aria-expanded={editingAvatar}
                  onClick={() => {
                    setAvatarError(null);
                    setEditingAvatar((current) => !current);
                  }}
                  className="absolute bottom-0 right-0 rounded-full border-2 border-surface-raised bg-brand p-1.5 text-white shadow-lg transition-transform hover:scale-105"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {editingAvatar && isOwnProfile && avatarCandidates.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="text-[10px] font-black uppercase tracking-wide text-text-muted">
                  {dict.profile.avatarTitle}
                </p>
                <div className="grid gap-2">
                  {avatarCandidates.map((candidate) => (
                    <button
                      key={candidate.provider}
                      type="button"
                      aria-pressed={candidate.isAvatarSelected}
                      disabled={avatarBusyProvider !== null}
                      onClick={() => void selectAvatar(candidate.provider)}
                      className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-xs font-bold transition-colors disabled:opacity-50 ${candidate.isAvatarSelected ? "border-brand bg-brand/10 text-brand-light" : "border-border bg-surface text-text-secondary hover:border-brand/40"}`}
                    >
                      {candidate.avatarUrl && (
                        <img
                          src={candidate.avatarUrl}
                          alt=""
                          className="h-7 w-7 rounded-full object-cover"
                        />
                      )}
                      <span className="flex-1">
                        {candidate.provider === "google" ? "Google" : "Discord"}
                      </span>
                      {avatarBusyProvider === candidate.provider && (
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      )}
                    </button>
                  ))}
                </div>
                {avatarError && (
                  <p role="alert" className="text-[10px] font-bold text-accent-red">
                    {avatarError}
                  </p>
                )}
              </div>
            )}

            <div className="mt-4">
              <p className="text-[11px] font-black uppercase tracking-[0.16em] text-brand-light">
                {dict.userProfile.eyebrow}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <h1 className="break-all text-xl font-black leading-tight text-text-primary sm:text-2xl">
                  {formatPublicUserTag(data.nickname, data.id)}
                </h1>
                {flag && <span className="text-xl">{flag}</span>}
              </div>
              {data.roles.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {data.roles.map((role) => (
                    <ProfileRoleBadge key={role} role={role} label={roleLabel(role, dict)} />
                  ))}
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Link
                  to={`/users/${data.id}/followers`}
                  className="inline-flex items-center gap-2 rounded-xl bg-black/25 px-3 py-2 text-[11px] font-bold text-text-muted transition-colors hover:bg-black/40 hover:text-text-primary"
                >
                  <UsersRound className="h-3.5 w-3.5" />
                  <strong className="text-sm tabular-nums text-text-primary">
                    {data.followStats.followerCount.toLocaleString()}
                  </strong>
                  {dict.userProfile.followersLabel}
                </Link>
                <Link
                  to={`/users/${data.id}/following`}
                  className="inline-flex items-center gap-2 rounded-xl bg-black/25 px-3 py-2 text-[11px] font-bold text-text-muted transition-colors hover:bg-black/40 hover:text-text-primary"
                >
                  <strong className="text-sm tabular-nums text-text-primary">
                    {data.followStats.followingCount.toLocaleString()}
                  </strong>
                  {dict.userProfile.followingLabel}
                </Link>
              </div>

              {viewer && !isOwnProfile && (
                <button
                  type="button"
                  disabled={followBusy}
                  aria-pressed={data.followStats.viewerIsFollowing}
                  onClick={() => void toggleFollow()}
                  className={`mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-black transition-colors disabled:opacity-50 ${
                    data.followStats.viewerIsFollowing
                      ? "border-brand/35 bg-brand/10 text-brand-light hover:bg-brand/20"
                      : "border-border bg-surface text-text-secondary hover:border-brand/45 hover:text-text-primary"
                  }`}
                >
                  {followBusy ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : data.followStats.viewerIsFollowing ? (
                    <UserRoundCheck className="h-3.5 w-3.5" />
                  ) : (
                    <UserRoundPlus className="h-3.5 w-3.5" />
                  )}
                  {data.followStats.viewerIsFollowing
                    ? dict.userProfile.followingCta
                    : dict.userProfile.followCta}
                </button>
              )}
              {followError && (
                <p role="alert" className="mt-2 text-[10px] font-bold text-accent-red">
                  {followError}
                </p>
              )}
            </div>

            <dl className="mt-5 space-y-3 text-[13px]">
              <ProfileFact
                label={dict.userProfile.joinedPrefix}
                value={data.joinedAt.split("T")[0] ?? data.joinedAt}
              />
              {data.globalRank !== null && (
                <ProfileFact
                  label={dict.userProfile.globalRankLabel}
                  value={`#${data.globalRank}`}
                  accent
                />
              )}
              <ProfileFact
                label={dict.userProfile.streakLabel}
                value={`${data.currentStreak}${dict.userProfile.streakDaysSuffix}`}
                icon={<Flame className="h-3.5 w-3.5 text-accent-yellow" />}
              />
            </dl>

            <section className="mt-6 border-t border-border/60 pt-5">
              <h2 className="text-[11px] font-black uppercase tracking-[0.14em] text-text-muted">
                {dict.userProfile.contributionsTitle}
              </h2>
              <div className="mt-2 divide-y divide-border/50">
                <ContributionMetric
                  icon={<Bug className="h-4 w-4 text-rose-400" />}
                  label={dict.userProfile.bugContributionsLabel}
                  value={data.contributions.bugAcceptedCount}
                />
                <ContributionMetric
                  icon={<Boxes className="h-4 w-4 text-violet-400" />}
                  label={dict.userProfile.createdGamesLabel}
                  value={data.contributions.createdGameCount}
                />
                <ContributionMetric
                  icon={<BadgePlus className="h-4 w-4 text-cyan-400" />}
                  label={dict.userProfile.introducedGamesLabel}
                  value={data.contributions.introducedExternalGameCount}
                />
              </div>
            </section>

            {isOwnProfile && (
              <div className="mt-6 grid gap-2">
                <button
                  type="button"
                  onClick={() => setEditingPresentation(true)}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-brand/35 bg-brand/10 px-3 py-2.5 text-xs font-black text-brand-light hover:bg-brand/20"
                >
                  <Pencil className="h-3.5 w-3.5" /> {dict.userProfile.editProfileCta}
                </button>
                <Link
                  to="/settings"
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-surface px-3 py-2.5 text-xs font-bold text-text-secondary hover:border-brand/40 hover:text-text-primary"
                >
                  <Settings className="h-3.5 w-3.5" /> {dict.userProfile.avatarSettingsCta}
                </Link>
              </div>
            )}
          </aside>

          <main className="min-w-0 space-y-7 px-5 py-7 sm:px-8 lg:px-10 lg:py-9">
            {editingPresentation && isOwnProfile && (
              <section className="rounded-2xl border border-brand/30 bg-brand/5 p-4 sm:p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-sm font-black text-text-primary">
                      {dict.userProfile.editProfileTitle}
                    </h2>
                    <p className="mt-1 text-[11px] leading-5 text-text-muted">
                      {dict.userProfile.editProfileHint}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setPresentationBanner(data.banner);
                      setPresentationBio(data.bioMarkdown);
                      setPresentationError(null);
                      setEditingPresentation(false);
                    }}
                    disabled={presentationBusy}
                    aria-label={dict.common.cancel}
                    className="rounded-lg border border-border p-2 text-text-muted hover:text-text-primary"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <fieldset className="mt-5">
                  <legend className="text-[11px] font-black text-text-secondary">
                    {dict.userProfile.bannerLabel}
                  </legend>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {PROFILE_BANNERS.map((banner) => (
                      <button
                        key={banner}
                        type="button"
                        aria-pressed={presentationBanner === banner}
                        onClick={() => setPresentationBanner(banner)}
                        className={`relative h-16 overflow-hidden rounded-xl border-2 bg-slate-950 transition-transform hover:-translate-y-0.5 ${presentationBanner === banner ? "border-white ring-2 ring-brand" : "border-transparent"}`}
                      >
                        <ProfileBannerArtwork banner={banner} compact />
                        <span className="absolute inset-x-1 bottom-1 z-10 rounded-md bg-black/45 px-1 py-0.5 text-[9px] font-black text-white backdrop-blur-sm">
                          {bannerLabel(banner, dict)}
                        </span>
                      </button>
                    ))}
                  </div>
                </fieldset>

                <label className="mt-5 block">
                  <span className="text-[11px] font-black text-text-secondary">
                    {dict.userProfile.bioLabel}
                  </span>
                  <textarea
                    value={presentationBio}
                    onChange={(event) => setPresentationBio(event.target.value)}
                    maxLength={2000}
                    rows={7}
                    placeholder={dict.userProfile.bioPlaceholder}
                    className="mt-2 w-full resize-y rounded-xl border border-border bg-surface px-3 py-3 text-sm leading-6 text-text-primary outline-none focus:border-brand"
                  />
                  <span className="mt-1 block text-right text-[10px] text-text-muted">
                    {presentationBio.length.toLocaleString()} / 2,000
                  </span>
                </label>
                {presentationError && (
                  <p role="alert" className="mt-2 text-xs font-bold text-accent-red">
                    {presentationError}
                  </p>
                )}
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    disabled={presentationBusy}
                    onClick={() => setEditingPresentation(false)}
                    className="rounded-xl border border-border px-4 py-2 text-xs font-bold text-text-muted"
                  >
                    {dict.common.cancel}
                  </button>
                  <button
                    type="button"
                    disabled={presentationBusy}
                    onClick={() => void savePresentation()}
                    className="inline-flex items-center gap-2 rounded-xl border border-brand bg-brand px-4 py-2 text-xs font-black text-white disabled:opacity-50"
                  >
                    {presentationBusy ? (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    {dict.common.save}
                  </button>
                </div>
              </section>
            )}

            <section
              data-profile-experience
              className="rounded-2xl border border-white/[0.07] bg-surface/45 px-4 py-4 shadow-inner shadow-black/10 sm:px-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.14em] text-text-muted">
                    {dict.userProfile.experienceTitle}
                  </p>
                  <div className="mt-1.5 flex items-baseline gap-2">
                    <span className="text-2xl font-black tabular-nums text-text-primary">
                      {dict.userProfile.levelLabel} {data.progression.level}
                    </span>
                    <span className="text-xs font-bold tabular-nums text-brand-light">
                      {data.progression.totalXp.toLocaleString()} XP
                    </span>
                  </div>
                </div>
                {data.longestStreak > 0 && (
                  <p className="rounded-full border border-orange-400/20 bg-orange-400/10 px-3 py-1.5 text-[11px] font-bold text-orange-200">
                    {dict.userProfile.longestStreakPrefix} {data.longestStreak}
                    {dict.userProfile.streakDaysSuffix}
                  </p>
                )}
              </div>
              <div className="mt-4 flex items-baseline justify-between text-[11px] font-bold text-text-muted">
                <span>{data.progression.currentLevelProgressXp.toLocaleString()} XP</span>
                <span>{data.progression.currentLevelSpanXp.toLocaleString()} XP</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-overlay">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-brand via-violet-400 to-cyan-300"
                  style={{ width: `${data.progression.progressPercent}%` }}
                />
              </div>
            </section>

            <section>
              <h2 className="text-sm font-black text-text-primary">{dict.userProfile.bioTitle}</h2>
              {data.bioMarkdown.trim() ? (
                <ProfileBioMarkdown markdown={data.bioMarkdown} />
              ) : (
                <p className="mt-3 text-sm leading-7 text-text-muted">
                  {isOwnProfile ? dict.userProfile.bioEmptyOwner : dict.userProfile.bioEmptyViewer}
                </p>
              )}
            </section>

            {/* Accepted game completions rendered as a GitHub-style UTC activity calendar. Exact
          daily activity follows the existing recent-play visibility preference. */}
            {data.playActivity !== null && (
              <section className="mx-auto flex w-full max-w-[1040px] flex-col gap-3 border-t border-border pt-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-text-primary">
                      <CalendarDays className="h-4 w-4 text-emerald-400" />
                      {dict.userProfile.activityTitle}
                    </h2>
                    <p className="mt-1 text-[11px] font-semibold text-text-muted">
                      {dict.userProfile.activityRangeLabel}
                    </p>
                  </div>
                  {isOwnProfile && !data.visibilitySettings?.showRecentPlays && (
                    <PrivateBadge label={dict.userProfile.onlyVisibleToYou} />
                  )}
                </div>
                <ProfileActivityHeatmap
                  activity={data.playActivity}
                  locale={locale}
                  labels={{
                    activeDays: dict.userProfile.activityActiveDaysLabel,
                    totalPlays: dict.userProfile.activityTotalPlaysLabel,
                    today: dict.userProfile.activityTodayLabel,
                    daysSuffix: dict.userProfile.activityDaysSuffix,
                    playsSuffix: dict.userProfile.activityPlaysSuffix,
                    less: dict.userProfile.activityLessLabel,
                    more: dict.userProfile.activityMoreLabel,
                    definition: dict.userProfile.activityDefinition,
                    utcHint: dict.userProfile.activityUtcHint,
                  }}
                />
              </section>
            )}

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

            {/* Streamer badges — only rendered when there's at least one verified channel. */}
            {data.streamerBadges.length > 0 && (
              <section className="flex flex-col gap-3 border-t border-border pt-6">
                <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-text-primary">
                  <Video className="h-4 w-4 text-brand" />
                  {dict.userProfile.streamerBadgesTitle}
                </h2>
                <div className="flex flex-wrap gap-2">
                  {data.streamerBadges.map((badge) => (
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
                        <span className="text-sm font-black text-brand-light">
                          {best.formattedScore}
                        </span>
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
          </main>
        </div>
      </article>
    </div>
  );
}

function roleLabel(role: PublicProfileRole, dict: Dictionary): string {
  if (role === "ADMIN") return dict.userProfile.roleAdmin;
  if (role === "OPERATOR") return dict.userProfile.roleOperator;
  return dict.userProfile.roleStreamer;
}

function bannerLabel(banner: ProfileBanner, dict: Dictionary): string {
  if (banner === "AURORA") return dict.userProfile.bannerNovaGlass;
  if (banner === "SUNSET") return dict.userProfile.bannerSakuraNight;
  if (banner === "MIDNIGHT") return dict.userProfile.bannerCelestial;
  return dict.userProfile.bannerBlueLagoon;
}

function ProfileBannerArtwork({
  banner,
  compact = false,
}: {
  banner: ProfileBanner;
  compact?: boolean;
}) {
  const art = PROFILE_BANNER_ART[banner];
  return (
    <>
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{ backgroundImage: art.backgroundImage }}
      />
      <div
        aria-hidden="true"
        className={`absolute -right-[8%] -top-1/2 aspect-square w-[48%] rounded-full blur-3xl ${art.glowClass}`}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-[0.12]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,.2) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.2) 1px, transparent 1px)",
          backgroundSize: compact ? "16px 16px" : "36px 36px",
          maskImage: "linear-gradient(115deg, black, transparent 72%)",
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-t from-surface-raised/80 via-transparent to-white/[0.06]"
      />
    </>
  );
}

function ProfileRoleBadge({ role, label }: { role: PublicProfileRole; label: string }) {
  const styles: Record<PublicProfileRole, string> = {
    ADMIN: "border-rose-400/40 bg-rose-500/15 text-rose-300",
    OPERATOR: "border-cyan-400/40 bg-cyan-500/15 text-cyan-300",
    STREAMER: "border-violet-400/40 bg-violet-500/15 text-violet-300",
  };
  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${styles[role]}`}
    >
      {label}
    </span>
  );
}

function ProfileFact({
  label,
  value,
  icon,
  accent = false,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-text-muted">{label}</dt>
      <dd
        className={`flex items-center gap-1 font-black ${accent ? "text-brand-light" : "text-text-primary"}`}
      >
        {icon}
        {value}
      </dd>
    </div>
  );
}

function ContributionMetric({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-2.5 py-2.5">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.04]">
        {icon}
      </span>
      <p className="min-w-0 flex-1 text-[11px] font-bold leading-4 text-text-muted">{label}</p>
      <p className="text-sm font-black tabular-nums text-text-primary">{value.toLocaleString()}</p>
    </div>
  );
}

/** CommonMark biography with raw HTML and remote images disabled. Links remain safe transformed
 * and open in a separate browsing context. */
function ProfileBioMarkdown({ markdown }: { markdown: string }) {
  return (
    <div className="mt-3 space-y-3 text-sm leading-7 text-text-secondary [&_blockquote]:border-l-2 [&_blockquote]:border-brand/50 [&_blockquote]:pl-4 [&_code]:rounded [&_code]:bg-surface-overlay [&_code]:px-1.5 [&_code]:py-0.5 [&_h1]:text-xl [&_h1]:font-black [&_h1]:text-text-primary [&_h2]:pt-2 [&_h2]:text-lg [&_h2]:font-black [&_h2]:text-text-primary [&_h3]:font-extrabold [&_h3]:text-text-primary [&_li]:ml-5 [&_ol]:list-decimal [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-surface-overlay [&_pre]:p-4 [&_ul]:list-disc">
      <Markdown
        skipHtml
        urlTransform={defaultUrlTransform}
        components={{
          a: ({ children, ...props }) => (
            <a
              {...props}
              className="font-bold text-brand-light underline decoration-brand/40 underline-offset-4"
              rel="noreferrer noopener"
              target="_blank"
            >
              {children}
            </a>
          ),
          img: () => null,
        }}
      >
        {markdown}
      </Markdown>
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
