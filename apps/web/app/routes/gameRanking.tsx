import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, AlertCircle, CalendarDays, Medal, RefreshCw, Trophy } from "lucide-react";
import { Link, useParams } from "react-router";
import type { PublicGame, PublicRankingEntry, RankingPeriod, RankingScope } from "@owogg/contracts";
import { formatPublicUserTag } from "@owogg/core";
import { CountryFlag } from "../components/ui/CountryFlag";
import { GameThumbnail } from "../components/ui/GameThumbnail";
import { PlatformIconRow } from "../components/ui/PlatformIcon";
import { RankingScopeTabs } from "../components/ranking/RankingScopeTabs";
import { getLocalizedGameContent } from "../features/catalog/localizedGameContent";
import { localizedDifficultyLabel } from "../features/catalog/difficultyLabels";
import { publicGameToCard } from "../features/catalog/publicGameAdapter";
import { useI18n } from "../features/i18n/I18nContext";
import { fetchPublicGame } from "../features/publicGamesApi";
import { fetchPublicRankingApi } from "../features/rankings/api";
import { formatRankingDate } from "../features/rankings/format";
import { normalizeRankingPeriodForScope, rankingPeriodOptions } from "../features/rankings/periods";
import { leaderboardVariantLabel } from "../features/scores/variantLabel";

export function meta() {
  return [
    { title: "게임별 순위 | OwOGG" },
    { name: "description", content: "게임별 기간 리더보드를 확인하세요." },
  ];
}

type LeaderboardState = "loading" | "success" | "error";

function PlayerCell({ entry, scope }: { entry: PublicRankingEntry; scope: RankingScope }) {
  return (
    <Link
      to={`/users/${entry.userId}`}
      className="flex w-fit items-center gap-2 text-brand-light hover:underline"
    >
      <span
        className={`flex h-8 w-8 items-center justify-center overflow-hidden rounded-full text-xs font-black ${
          scope === "streamer"
            ? "border border-purple-500/30 bg-purple-600/30 text-purple-200"
            : "bg-brand/20 text-brand"
        }`}
      >
        {entry.avatarUrl ? (
          <img src={entry.avatarUrl} alt={entry.nickname} className="h-full w-full object-cover" />
        ) : (
          entry.nickname.slice(0, 2)
        )}
      </span>
      <span>{formatPublicUserTag(entry.nickname, entry.userId)}</span>
    </Link>
  );
}

export default function GameRankingRoute() {
  const slug = useParams().slug ?? "";
  const { dict, locale } = useI18n();
  const [game, setGame] = useState<PublicGame | null>(null);
  const [gameLoading, setGameLoading] = useState(true);
  const [records, setRecords] = useState<PublicRankingEntry[]>([]);
  const [status, setStatus] = useState<LeaderboardState>("loading");
  const [scope, setScope] = useState<RankingScope>("general");
  const [period, setPeriod] = useState<RankingPeriod>("daily");
  const [selectedDifficultyId, setSelectedDifficultyId] = useState("normal");
  const card = useMemo(() => (game ? publicGameToCard(game, locale) : null), [game, locale]);
  const content = card ? getLocalizedGameContent(dict, card, locale) : null;

  useEffect(() => {
    let cancelled = false;
    setGameLoading(true);
    setGame(null);
    setRecords([]);
    setStatus("loading");
    fetchPublicGame(slug)
      .then((resolved) => {
        if (!cancelled) setGame(resolved);
      })
      .catch(() => {
        if (!cancelled) setGame(null);
      })
      .finally(() => {
        if (!cancelled) setGameLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    setSelectedDifficultyId(game?.difficulty?.defaultLevelId ?? "normal");
  }, [game]);

  const selectScope = useCallback((nextScope: RankingScope) => {
    setScope(nextScope);
    setPeriod((current) => normalizeRankingPeriodForScope(nextScope, current));
  }, []);

  const loadData = useCallback(async () => {
    if (!game?.policy.leaderboard) return;
    if (
      game.difficulty &&
      !game.difficulty.levels.some((level) => level.id === selectedDifficultyId)
    ) {
      return;
    }
    setStatus("loading");
    try {
      const response = await fetchPublicRankingApi({
        scope,
        metric: "score",
        period,
        gameId: slug,
        difficulty: selectedDifficultyId,
        limit: 50,
      });
      setRecords(response.entries);
      setStatus("success");
    } catch (error) {
      console.error("Failed to load game ranking:", error);
      setRecords([]);
      setStatus("error");
    }
  }, [game?.difficulty, game?.policy.leaderboard, period, scope, selectedDifficultyId, slug]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  if (gameLoading) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-20 text-center text-text-muted">
        {dict.common.loading}
      </div>
    );
  }

  if (!game || !card) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-20 text-center">
        <p className="text-text-muted">{dict.gamePlay.errorGameNotFound}</p>
      </div>
    );
  }

  if (!game.policy.leaderboard) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-20 text-center">
        <Trophy className="mx-auto mb-4 h-10 w-10 text-text-muted" />
        <h1 className="text-xl font-black text-text-primary">{dict.gameRanking.notSupported}</h1>
        <p className="mt-2 text-sm text-text-muted">{dict.gameRanking.notSupportedBody}</p>
        <Link
          to={`/games/${slug}`}
          className="mt-6 inline-flex items-center gap-1.5 text-xs font-bold text-brand-light hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> {dict.gameRanking.backToGame}
        </Link>
      </div>
    );
  }

  const periods = rankingPeriodOptions(scope, {
    daily: dict.ranking.dailyPeriod,
    weekly: dict.ranking.weeklyPeriod,
    monthly: dict.ranking.monthlyPeriod,
    all: dict.ranking.allPeriod,
  });
  const columnCount = scope === "streamer" ? 7 : 6;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-8">
      <Link
        to={`/games/${slug}`}
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-bold text-text-muted hover:text-brand-light"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> {dict.gameRanking.backToGame}
      </Link>

      <div className="mb-6 flex justify-center">
        <RankingScopeTabs
          scope={scope}
          onScopeChange={selectScope}
          generalLabel={dict.ranking.gameTab}
          streamerLabel={dict.ranking.streamerTab}
        />
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <GameThumbnail
            thumbnail={card.thumbnail}
            title={content?.title ?? card.title}
            accent={card.accent}
            className="h-12 w-12 shrink-0"
          />
          <div>
            <p className="text-xs font-black uppercase tracking-wider text-brand-light">
              {dict.gameRanking.eyebrow}
            </p>
            <h1 className="text-2xl font-black text-text-primary md:text-3xl">{content?.title}</h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {game.difficulty && (
            <div className="flex items-center gap-1 rounded-xl border border-border/80 bg-surface-raised p-1">
              {game.difficulty.levels.map((level) => (
                <button
                  key={level.id}
                  type="button"
                  onClick={() => setSelectedDifficultyId(level.id)}
                  className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${
                    level.id === selectedDifficultyId
                      ? "bg-brand text-white shadow-sm"
                      : "text-text-secondary hover:bg-surface-overlay hover:text-text-primary"
                  }`}
                >
                  {localizedDifficultyLabel(level.id, level.label, dict.gamePlay)}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1 rounded-xl border border-border/80 bg-surface-raised p-1">
            <CalendarDays className="ml-2 h-4 w-4 text-text-muted" />
            {periods.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setPeriod(option.id)}
                className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${
                  option.id === period
                    ? "bg-brand text-white shadow-sm"
                    : "text-text-secondary hover:bg-surface-overlay hover:text-text-primary"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="w-full overflow-hidden rounded-3xl border border-border bg-surface-raised shadow-2xl">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border bg-surface-sidebar text-xs font-extrabold uppercase tracking-wider text-text-muted">
                <th className="px-6 py-4">{dict.ranking.rankHeader}</th>
                <th className="px-6 py-4">
                  {scope === "streamer" ? dict.ranking.streamerHeader : dict.ranking.playerHeader}
                </th>
                <th className="px-6 py-4 text-center">{dict.ranking.countryHeader}</th>
                <th className="px-6 py-4">{dict.ranking.recordHeader}</th>
                <th className="px-6 py-4">{dict.ranking.dateHeader}</th>
                <th className="px-6 py-4">{dict.ranking.modeHeader}</th>
                {scope === "streamer" && (
                  <th className="px-6 py-4 text-right">{dict.ranking.platformHeader}</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50 text-sm font-medium text-text-primary">
              {status === "loading" && (
                <tr>
                  <td
                    colSpan={columnCount}
                    className="animate-pulse py-16 text-center text-text-muted"
                  >
                    {dict.common.loading}
                  </td>
                </tr>
              )}
              {status === "error" && (
                <tr>
                  <td colSpan={columnCount} className="py-16 text-center text-text-muted">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <AlertCircle className="h-8 w-8 text-accent-red" />
                      <button
                        type="button"
                        onClick={() => void loadData()}
                        className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-surface-raised px-4 py-2 text-xs font-bold transition-colors hover:bg-surface-overlay"
                      >
                        <RefreshCw className="h-3.5 w-3.5" /> {dict.ranking.retryButton}
                      </button>
                    </div>
                  </td>
                </tr>
              )}
              {status === "success" && records.length === 0 && (
                <tr>
                  <td colSpan={columnCount} className="py-16 text-center text-text-muted">
                    {scope === "streamer"
                      ? dict.ranking.emptyStreamerTitle
                      : dict.gamePlay.leaderboardEmpty}
                  </td>
                </tr>
              )}
              {status === "success" &&
                records.map((entry) => (
                  <tr
                    key={`${entry.userId}-${entry.rank}`}
                    className="transition-colors hover:bg-surface-overlay/50"
                  >
                    <td className="whitespace-nowrap px-6 py-4">
                      {entry.rank <= 3 ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/10 px-3 py-1 font-black text-brand-light">
                          <Medal className="h-4 w-4" />
                          {
                            [dict.ranking.rank1, dict.ranking.rank2, dict.ranking.rank3][
                              entry.rank - 1
                            ]
                          }
                        </span>
                      ) : (
                        <span className="px-3 font-bold text-text-muted">#{entry.rank}</span>
                      )}
                    </td>
                    <td className="px-6 py-4 font-bold text-text-primary">
                      <PlayerCell entry={entry} scope={scope} />
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
                      {entry.formattedValue}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-xs text-text-secondary">
                      {formatRankingDate(entry.achievedAt, locale)}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-xs font-bold text-text-secondary">
                      {leaderboardVariantLabel(game, entry.variantId ?? "standard")}
                    </td>
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
    </div>
  );
}
