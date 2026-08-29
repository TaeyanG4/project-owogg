import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, Link } from "react-router";
import { ArrowLeft, Trophy, Medal, AlertCircle, RefreshCw } from "lucide-react";
import { fetchLeaderboardApi } from "../features/scores/api";
import { getLocalizedGameContent } from "../features/catalog/localizedGameContent";
import { publicGameToCard } from "../features/catalog/publicGameAdapter";
import { fetchPublicGame } from "../features/publicGamesApi";
import { localizedDifficultyLabel } from "../features/catalog/difficultyLabels";
import { leaderboardVariantLabel } from "../features/scores/variantLabel";
import { useI18n } from "../features/i18n/I18nContext";
import { GameThumbnail } from "../components/ui/GameThumbnail";
import type { LeaderRecord, PublicGame } from "@owogg/contracts";
import { formatPublicUserTag } from "@owogg/core";

export function meta() {
  return [
    { title: "게임별 순위 | OwOGG" },
    { name: "description", content: "게임별 리더보드를 확인하세요." },
  ];
}

type LeaderboardState = "loading" | "success" | "error";

/** Avatar + nickname, linking to the player's public profile when the score is tied to a
 * real account (guest scores have no userId, and stay plain text). */
function PlayerCell({ record }: { record: LeaderRecord }) {
  const avatar = (
    <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-brand/20 text-xs font-black text-brand">
      {record.avatarUrl ? (
        <img
          src={record.avatarUrl}
          alt={record.playerName}
          className="h-full w-full object-cover"
        />
      ) : (
        record.playerName.slice(0, 2)
      )}
    </div>
  );

  if (record.userId === null || record.userId === undefined) {
    return (
      <div className="flex items-center gap-2">
        {avatar}
        <span>{record.playerName}</span>
      </div>
    );
  }

  return (
    <Link
      to={`/users/${record.userId}`}
      className="flex w-fit items-center gap-2 text-brand-light hover:underline"
    >
      {avatar}
      <span>{formatPublicUserTag(record.playerName, record.userId)}</span>
    </Link>
  );
}

/** Per-game ranking page — osu!-style: ranking recorded per game (like per-beatmap leaderboards)
 * rather than only living inside the single combined /ranking page's game filter. The generic
 * public game contract supplies leaderboard policy, difficulty, and presentation for both
 * publishers. */
export default function GameRankingRoute() {
  const params = useParams();
  const slug = params.slug ?? "";
  const { dict } = useI18n();

  const [game, setGame] = useState<PublicGame | null>(null);
  const [gameLoading, setGameLoading] = useState(true);
  const card = useMemo(() => (game ? publicGameToCard(game) : null), [game]);
  const content = card ? getLocalizedGameContent(dict, card) : null;

  const [records, setRecords] = useState<LeaderRecord[]>([]);
  const [status, setStatus] = useState<LeaderboardState>("loading");
  const [selectedDifficultyId, setSelectedDifficultyId] = useState<string>(
    () => game?.difficulty?.defaultLevelId ?? "normal",
  );

  useEffect(() => {
    let cancelled = false;
    setGameLoading(true);
    setGame(null);
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

  const loadData = useCallback(async () => {
    if (!game || !game.policy.leaderboard) return;
    setStatus("loading");
    try {
      const data = await fetchLeaderboardApi(slug, selectedDifficultyId);
      setRecords(data);
      setStatus("success");
    } catch (err) {
      console.error("Failed to load game leaderboard:", err);
      setStatus("error");
    }
  }, [slug, game, selectedDifficultyId]);

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
          <ArrowLeft className="h-3.5 w-3.5" />
          {dict.gameRanking.backToGame}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 md:px-8">
      <Link
        to={`/games/${slug}`}
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-bold text-text-muted hover:text-brand-light"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {dict.gameRanking.backToGame}
      </Link>

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

        {/* Scores across difficulty tiers are never comparable (see
            docs/GAME_CREATION_GUIDE.md §4) — the leaderboard below is always scoped to exactly
            one tier, switched here rather than mixed into one table. */}
        {game.difficulty && (
          <div className="flex items-center gap-1 rounded-xl border border-border/80 bg-surface-raised p-1">
            {game.difficulty.levels.map((level) => {
              const isSelected = level.id === selectedDifficultyId;
              return (
                <button
                  key={level.id}
                  type="button"
                  onClick={() => setSelectedDifficultyId(level.id)}
                  aria-pressed={isSelected}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all cursor-pointer ${
                    isSelected
                      ? "bg-brand text-white shadow-sm"
                      : "text-text-secondary hover:text-text-primary hover:bg-surface-overlay"
                  }`}
                >
                  {localizedDifficultyLabel(level.id, level.label, dict.gamePlay)}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="w-full overflow-hidden rounded-3xl border border-border bg-surface-raised shadow-2xl">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border bg-surface-sidebar text-xs font-extrabold uppercase tracking-wider text-text-muted">
                <th className="px-6 py-4">{dict.ranking.rankHeader}</th>
                <th className="px-6 py-4">{dict.ranking.playerHeader}</th>
                <th className="px-6 py-4">{dict.ranking.recordHeader}</th>
                <th className="px-6 py-4">{dict.ranking.modeHeader}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50 text-sm font-medium text-text-primary">
              {status === "loading" && (
                <tr>
                  <td colSpan={4} className="animate-pulse py-16 text-center text-text-muted">
                    {dict.common.loading}
                  </td>
                </tr>
              )}

              {status === "error" && (
                <tr>
                  <td colSpan={4} className="py-16 text-center text-text-muted">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <AlertCircle className="h-8 w-8 text-accent-red" />
                      <button
                        onClick={() => void loadData()}
                        className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-surface-raised px-4 py-2 text-xs font-bold transition-colors hover:bg-surface-overlay"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        {dict.ranking.retryButton}
                      </button>
                    </div>
                  </td>
                </tr>
              )}

              {status === "success" &&
                (records.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-16 text-center text-text-muted">
                      {dict.gamePlay.leaderboardEmpty}
                    </td>
                  </tr>
                ) : (
                  records.map((record, index) => {
                    const rank = index + 1;
                    return (
                      <tr key={record.id} className="transition-colors hover:bg-surface-overlay/50">
                        <td className="whitespace-nowrap px-6 py-4">
                          {rank === 1 && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/20 px-3 py-1 font-black text-amber-400 shadow-md">
                              <Medal className="h-4 w-4" /> {dict.ranking.rank1}
                            </span>
                          )}
                          {rank === 2 && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-slate-400/40 bg-slate-400/20 px-3 py-1 font-bold text-slate-300">
                              <Medal className="h-4 w-4" /> {dict.ranking.rank2}
                            </span>
                          )}
                          {rank === 3 && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-amber-700/40 bg-amber-700/20 px-3 py-1 font-bold text-amber-600">
                              <Medal className="h-4 w-4" /> {dict.ranking.rank3}
                            </span>
                          )}
                          {rank > 3 && (
                            <span className="px-3 font-bold text-text-muted">#{rank}</span>
                          )}
                        </td>
                        <td className="px-6 py-4 font-bold text-text-primary">
                          <PlayerCell record={record} />
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-base font-black text-brand-light">
                          {record.formattedScore}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-xs font-bold text-text-secondary">
                          {leaderboardVariantLabel(game, record.variantId)}
                        </td>
                      </tr>
                    );
                  })
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
