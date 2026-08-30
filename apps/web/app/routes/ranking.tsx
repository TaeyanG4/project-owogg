import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import {
  AlertCircle,
  CalendarDays,
  Flame,
  Gamepad2,
  Globe,
  Medal,
  RefreshCw,
  Search,
  Trophy,
  Video,
  Zap,
} from "lucide-react";
import type {
  PublicRankingEntry,
  RankingMetric,
  RankingPeriod,
  RankingScope,
  StreamerPlatform,
} from "@owogg/contracts";
import { formatPublicUserTag } from "@owogg/core";
import { CountryFlag } from "../components/ui/CountryFlag";
import { GameThumbnail } from "../components/ui/GameThumbnail";
import { PlatformIcon, PlatformIconRow } from "../components/ui/PlatformIcon";
import { getLocalizedGameContent } from "../features/catalog/localizedGameContent";
import { publicGameToCard } from "../features/catalog/publicGameAdapter";
import { useI18n } from "../features/i18n/I18nContext";
import { usePublicGames } from "../features/publicGamesApi";
import { fetchPublicRankingApi } from "../features/rankings/api";
import { formatRankingDate } from "../features/rankings/format";
import { filterLeaderboardGames } from "../features/scores/leaderboardGames";
import { leaderboardVariantLabel } from "../features/scores/variantLabel";

export function meta() {
  return [
    { title: "명예의 전당 (랭킹) | OwOGG" },
    { name: "description", content: "기간별 일반·스트리머 랭킹을 확인하세요." },
  ];
}

type LeaderboardState = "loading" | "success" | "error";
type PlatformFilter = StreamerPlatform | "ALL";

function RankBadge({ rank, labels }: { rank: number; labels: [string, string, string] }) {
  if (rank <= 3) {
    const styles = [
      "bg-amber-500/20 text-amber-400 border-amber-500/40",
      "bg-slate-400/20 text-slate-300 border-slate-400/40",
      "bg-amber-700/20 text-amber-600 border-amber-700/40",
    ];
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 font-black ${styles[rank - 1]}`}
      >
        <Medal className="h-4 w-4" /> {labels[rank - 1]}
      </span>
    );
  }
  return <span className="px-3 font-bold text-text-muted">#{rank}</span>;
}

export default function Ranking() {
  const { dict, locale } = useI18n();
  const { games: publicGames } = usePublicGames();
  const leaderboardGames = useMemo(() => filterLeaderboardGames(publicGames), [publicGames]);
  const gameCards = useMemo(
    () => leaderboardGames.map((game) => publicGameToCard(game)),
    [leaderboardGames],
  );

  const [scope, setScope] = useState<RankingScope>("general");
  const [metric, setMetric] = useState<RankingMetric>("score");
  const [period, setPeriod] = useState<RankingPeriod>("daily");
  const [selectedGameId, setSelectedGameId] = useState("all");
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformFilter>("ALL");
  const [gameSearchQuery, setGameSearchQuery] = useState("");
  const [entries, setEntries] = useState<PublicRankingEntry[]>([]);
  const [status, setStatus] = useState<LeaderboardState>("success");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (
      selectedGameId !== "all" &&
      !leaderboardGames.some((game) => game.slug === selectedGameId)
    ) {
      setSelectedGameId("all");
    }
  }, [leaderboardGames, selectedGameId]);

  const filteredGames = useMemo(() => {
    const query = gameSearchQuery.trim().toLowerCase();
    if (!query) return gameCards;
    return gameCards.filter((game) =>
      getLocalizedGameContent(dict, game).title.toLowerCase().includes(query),
    );
  }, [dict, gameCards, gameSearchQuery]);

  const loadData = useCallback(async () => {
    if (metric === "score" && selectedGameId === "all") {
      setEntries([]);
      setErrorMessage(null);
      setStatus("success");
      return;
    }

    setStatus("loading");
    setErrorMessage(null);
    try {
      const response = await fetchPublicRankingApi({
        scope,
        metric,
        period,
        ...(metric === "score" ? { gameId: selectedGameId } : {}),
        ...(scope === "streamer" && selectedPlatform !== "ALL"
          ? { platform: selectedPlatform }
          : {}),
        limit: 50,
      });
      setEntries(response.entries);
      setStatus("success");
    } catch (error) {
      console.error("Failed to load public ranking:", error);
      setEntries([]);
      setErrorMessage(dict.common.error);
      setStatus("error");
    }
  }, [dict.common.error, metric, period, scope, selectedGameId, selectedPlatform]);

  useEffect(() => {
    void loadData();
  }, [loadData, retryKey]);

  const metricOptions: Array<{
    id: RankingMetric;
    label: string;
    icon: typeof Gamepad2;
  }> = [
    { id: "score", label: dict.ranking.scoreMode, icon: Gamepad2 },
    { id: "xp", label: dict.ranking.xpMode, icon: Zap },
    { id: "streak", label: dict.ranking.streakMode, icon: Flame },
  ];
  const periodOptions: Array<{ id: RankingPeriod; label: string }> = [
    { id: "daily", label: dict.ranking.dailyPeriod },
    { id: "weekly", label: dict.ranking.weeklyPeriod },
    { id: "monthly", label: dict.ranking.monthlyPeriod },
  ];
  const platformOptions: Array<{ id: PlatformFilter; label: string }> = [
    { id: "ALL", label: dict.ranking.allPlatforms },
    { id: "YOUTUBE", label: "YouTube" },
    { id: "CHZZK", label: dict.ranking.platformChzzk },
    { id: "SOOP", label: dict.ranking.platformSoop },
    { id: "TWITCH", label: "Twitch" },
  ];

  const valueHeader =
    metric === "score"
      ? dict.ranking.recordHeader
      : metric === "xp"
        ? dict.ranking.xpMode
        : dict.ranking.streakMode;
  const emptyMessage =
    scope === "streamer"
      ? dict.ranking.emptyStreamerTitle
      : metric === "score"
        ? dict.ranking.emptyGames
        : metric === "xp"
          ? dict.ranking.emptyXp
          : dict.ranking.emptyStreak;
  const selectedGame = publicGames.find((game) => game.slug === selectedGameId);
  const columnCount = 5 + (metric === "score" ? 1 : 0) + (scope === "streamer" ? 1 : 0);

  return (
    <div className="mx-auto flex w-full max-w-[100rem] flex-1 select-none flex-col gap-7 px-4 py-8 md:px-8">
      <header className="flex flex-col justify-between gap-6 border-b border-border/60 pb-6 md:flex-row md:items-center">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-accent-yellow">
            <Trophy className="h-4 w-4" />
            <span>{dict.ranking.eyebrow}</span>
          </div>
          <h1 className="text-3xl font-black text-text-primary md:text-4xl">
            {dict.ranking.title}
          </h1>
          <p className="mt-1 text-sm text-text-secondary">{dict.ranking.subtitle}</p>
        </div>

        <div className="flex items-center gap-1.5 rounded-2xl border border-border bg-surface-sidebar p-1.5">
          <button
            type="button"
            onClick={() => setScope("general")}
            className={`flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2 text-xs font-extrabold transition-all md:text-sm ${
              scope === "general"
                ? "bg-brand text-white shadow-lg shadow-brand/25"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            <Trophy className="h-4 w-4" /> {dict.ranking.gameTab}
          </button>
          <button
            type="button"
            onClick={() => setScope("streamer")}
            className={`flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2 text-xs font-extrabold transition-all md:text-sm ${
              scope === "streamer"
                ? "bg-purple-600 text-white shadow-lg shadow-purple-600/25"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            <Video className="h-4 w-4" /> {dict.ranking.streamerTab}
          </button>
        </div>
      </header>

      <section className="flex flex-col gap-4 rounded-2xl border border-border/70 bg-surface-sidebar/60 p-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-1 overflow-x-auto rounded-xl bg-surface p-1">
          {metricOptions.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setMetric(id)}
              className={`flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-extrabold transition-all ${
                metric === id
                  ? scope === "streamer"
                    ? "bg-purple-600 text-white"
                    : "bg-brand text-white"
                  : "text-text-muted hover:text-text-primary"
              }`}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>

        {metric !== "streak" && (
          <div className="flex items-center gap-1 rounded-xl border border-border/70 bg-surface p-1">
            <CalendarDays className="ml-2 h-4 w-4 text-text-muted" />
            {periodOptions.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setPeriod(id)}
                className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${
                  period === id
                    ? "bg-surface-overlay text-text-primary"
                    : "text-text-muted hover:text-text-primary"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </section>

      {scope === "streamer" && (
        <div className="flex items-center gap-2 overflow-x-auto border-b border-border/40 pb-4">
          {platformOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setSelectedPlatform(option.id)}
              className={`flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-xl border px-3.5 py-1.5 text-xs font-bold transition-all ${
                selectedPlatform === option.id
                  ? "border-purple-500 bg-purple-600 text-white shadow-md"
                  : "border-border/80 bg-surface-raised text-text-secondary hover:text-text-primary"
              }`}
            >
              {option.id === "ALL" ? (
                <Globe className="h-3.5 w-3.5" />
              ) : (
                <PlatformIcon platform={option.id} size={16} />
              )}
              {option.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-6 lg:flex-row">
        {metric === "score" && (
          <aside className="flex shrink-0 flex-col gap-3 lg:w-64">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                value={gameSearchQuery}
                onChange={(event) => setGameSearchQuery(event.target.value)}
                placeholder={dict.games.searchPlaceholder}
                className="w-full rounded-xl border border-border/80 bg-surface-raised py-2.5 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
            </div>
            <div className="flex flex-col gap-1 lg:max-h-[30rem] lg:overflow-y-auto lg:pr-1">
              <button
                type="button"
                onClick={() => setSelectedGameId("all")}
                className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-bold transition-all ${
                  selectedGameId === "all"
                    ? scope === "streamer"
                      ? "border-purple-600 bg-purple-600 text-white"
                      : "border-brand bg-brand text-white"
                    : "border-border/80 bg-surface-raised text-text-secondary hover:text-text-primary"
                }`}
              >
                <Trophy className="h-4 w-4 shrink-0" />
                <span className="truncate">{dict.ranking.allCategories}</span>
              </button>
              {filteredGames.length === 0 ? (
                <p className="px-3 py-4 text-center text-xs text-text-muted">
                  {dict.games.emptySearch}
                </p>
              ) : (
                filteredGames.map((game) => (
                  <button
                    key={game.slug}
                    type="button"
                    onClick={() => setSelectedGameId(game.slug)}
                    className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-sm font-bold transition-all ${
                      selectedGameId === game.slug
                        ? scope === "streamer"
                          ? "border-purple-600 bg-purple-600 text-white"
                          : "border-brand bg-brand text-white"
                        : "border-border/80 bg-surface-raised text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    <GameThumbnail
                      thumbnail={game.thumbnail}
                      title={getLocalizedGameContent(dict, game).title}
                      accent={game.accent}
                      className="h-6 w-6 shrink-0"
                      rounded="rounded-md"
                    />
                    <span className="truncate">{getLocalizedGameContent(dict, game).title}</span>
                  </button>
                ))
              )}
            </div>
          </aside>
        )}

        <main className="min-w-0 flex-1">
          {metric === "score" && selectedGameId === "all" ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {gameCards.map((game) => {
                const content = getLocalizedGameContent(dict, game);
                return (
                  <button
                    key={game.slug}
                    type="button"
                    onClick={() => setSelectedGameId(game.slug)}
                    className="group flex cursor-pointer flex-col items-center gap-3 rounded-2xl border border-border bg-surface-raised p-5 text-center shadow-lg transition-all hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-2xl"
                  >
                    <GameThumbnail
                      thumbnail={game.thumbnail}
                      title={content.title}
                      accent={game.accent}
                      className="h-16 w-16 transition-transform duration-300 group-hover:scale-110"
                    />
                    <span className="font-bold text-text-primary transition-colors group-hover:text-brand">
                      {content.title}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="w-full overflow-hidden rounded-3xl border border-border bg-surface-raised shadow-2xl">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-border bg-surface-sidebar text-xs font-extrabold uppercase tracking-wider text-text-muted">
                      <th className="px-6 py-4">{dict.ranking.rankHeader}</th>
                      <th className="px-6 py-4">
                        {scope === "streamer"
                          ? dict.ranking.streamerHeader
                          : dict.ranking.playerHeader}
                      </th>
                      <th className="px-6 py-4 text-center">{dict.ranking.countryHeader}</th>
                      <th className="px-6 py-4">{valueHeader}</th>
                      <th className="px-6 py-4">{dict.ranking.dateHeader}</th>
                      {metric === "score" && (
                        <th className="px-6 py-4">{dict.ranking.modeHeader}</th>
                      )}
                      {scope === "streamer" && (
                        <th className="px-6 py-4 text-right">{dict.ranking.platformHeader}</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50 text-sm font-medium text-text-primary">
                    {status === "loading" && (
                      <tr>
                        <td colSpan={columnCount} className="py-16 text-center text-text-muted">
                          <span className="animate-pulse">{dict.common.loading}</span>
                        </td>
                      </tr>
                    )}
                    {status === "error" && (
                      <tr>
                        <td colSpan={columnCount} className="py-16 text-center text-text-muted">
                          <div className="flex flex-col items-center justify-center gap-3">
                            <AlertCircle className="h-8 w-8 text-accent-red" />
                            <p className="font-semibold text-text-primary">{errorMessage}</p>
                            <button
                              type="button"
                              onClick={() => setRetryKey((value) => value + 1)}
                              className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-surface-raised px-4 py-2 text-xs font-bold transition-colors hover:bg-surface-overlay"
                            >
                              <RefreshCw className="h-3.5 w-3.5" /> {dict.ranking.retryButton}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                    {status === "success" && entries.length === 0 && (
                      <tr>
                        <td colSpan={columnCount} className="py-16 text-center text-text-muted">
                          {emptyMessage}
                        </td>
                      </tr>
                    )}
                    {status === "success" &&
                      entries.map((entry) => (
                        <tr
                          key={`${entry.userId}-${entry.rank}`}
                          className="transition-colors hover:bg-surface-overlay/50"
                        >
                          <td className="whitespace-nowrap px-6 py-4">
                            <RankBadge
                              rank={entry.rank}
                              labels={[dict.ranking.rank1, dict.ranking.rank2, dict.ranking.rank3]}
                            />
                          </td>
                          <td className="px-6 py-4 font-bold text-text-primary">
                            <Link
                              to={`/users/${entry.userId}`}
                              className="flex w-fit items-center gap-2.5 text-brand-light hover:underline"
                            >
                              <span
                                className={`flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-black ${
                                  scope === "streamer"
                                    ? "border border-purple-500/30 bg-purple-600/30 text-purple-200"
                                    : "bg-brand/20 text-brand"
                                }`}
                              >
                                {entry.avatarUrl ? (
                                  <img
                                    src={entry.avatarUrl}
                                    alt={entry.nickname}
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  entry.nickname.slice(0, 2)
                                )}
                              </span>
                              <span>{formatPublicUserTag(entry.nickname, entry.userId)}</span>
                            </Link>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <CountryFlag
                              country={entry.country}
                              unknownLabel={dict.ranking.unknownCountry}
                            />
                          </td>
                          <td
                            className={`whitespace-nowrap px-6 py-4 text-base font-black ${
                              scope === "streamer" ? "text-purple-200" : "text-brand-light"
                            }`}
                          >
                            {metric === "streak"
                              ? `${entry.value.toLocaleString()} ${dict.userProfile.streakDaysSuffix}`
                              : entry.formattedValue}
                          </td>
                          <td className="whitespace-nowrap px-6 py-4 text-xs text-text-secondary">
                            {formatRankingDate(entry.achievedAt, locale)}
                          </td>
                          {metric === "score" && (
                            <td className="whitespace-nowrap px-6 py-4 text-xs text-text-muted">
                              {leaderboardVariantLabel(selectedGame, entry.variantId ?? "standard")}
                            </td>
                          )}
                          {scope === "streamer" && (
                            <td className="whitespace-nowrap px-6 py-4">
                              <div className="flex justify-end">
                                <PlatformIconRow accounts={entry.platformAccounts} size={24} />
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
