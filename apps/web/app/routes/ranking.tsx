import { useState, useEffect, useCallback, useMemo } from "react";
import { Link } from "react-router";
import {
  Trophy,
  Medal,
  AlertCircle,
  RefreshCw,
  Zap,
  Video,
  Gamepad2,
  Globe,
  Search,
} from "lucide-react";
import { fetchLeaderboardApi } from "../features/scores/api";
import { fetchXpLeaderboardApi } from "../features/progression/api";
import { fetchCreatorRankingsApi } from "../features/creators/creatorApi";
import { PlatformIconRow, PlatformIcon } from "../components/ui/PlatformIcon";
import { GameThumbnail } from "../components/ui/GameThumbnail";
import type { LeaderRecord, XpLeaderboardEntry, CreatorRankEntryDto } from "@owogg/contracts";

import { formatPublicUserTag, levelForTotalXp } from "@owogg/core";

import { usePublicGames } from "../features/publicGamesApi";
import { publicGameToCard } from "../features/catalog/publicGameAdapter";
import { useI18n } from "../features/i18n/I18nContext";
import { getLocalizedGameContent } from "../features/catalog/localizedGameContent";

export function meta() {
  return [
    { title: "명예의 전당 (랭킹) | OwOGG" },
    { name: "description", content: "최고 기록, XP 레벨, 스트리머 랭킹을 확인하세요." },
  ];
}

type MainTab = "game" | "xp" | "creator";
type LeaderboardState = "loading" | "success" | "error";

export default function Ranking() {
  const { dict } = useI18n();
  const { games: publicGames } = usePublicGames();
  const gameManifests = useMemo(
    () => publicGames.map((game) => publicGameToCard(game)),
    [publicGames],
  );
  const [mainTab, setMainTab] = useState<MainTab>("game");

  // Game Score Ranking state
  const [selectedGameId, setSelectedGameId] = useState<string>("all");
  const [gameRecords, setGameRecords] = useState<LeaderRecord[]>([]);
  // Sidebar search for the game picker — a text filter scales to a large catalog far better
  // than a horizontal chip row or a full card grid does (both of those enumerate every game
  // unconditionally, which is fine at 4 games and unusable at 100+). See the sidebar below.
  const [gameSearchQuery, setGameSearchQuery] = useState("");

  // XP Ranking state
  const [xpRecords, setXpRecords] = useState<XpLeaderboardEntry[]>([]);

  // Creator Ranking state
  const [creatorMode, setCreatorMode] = useState<"score" | "xp">("score");
  const [selectedPlatform, setSelectedPlatform] = useState<string>("ALL");
  const [creatorRecords, setCreatorRecords] = useState<CreatorRankEntryDto[]>([]);

  const [status, setStatus] = useState<LeaderboardState>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const filteredSidebarGames = useMemo(() => {
    const query = gameSearchQuery.trim().toLowerCase();
    if (!query) return gameManifests;
    return gameManifests.filter((game) =>
      getLocalizedGameContent(dict, game).title.toLowerCase().includes(query),
    );
  }, [gameManifests, gameSearchQuery, dict]);

  const loadData = useCallback(async () => {
    // "전체 종목" under the game tab has no meaningful combined leaderboard — scores from
    // different games aren't comparable (ms vs. WPM etc.), and the API has no "all games mixed"
    // endpoint (GET /api/scores/all 400s, since "all" isn't a real game id). That state instead
    // renders a game-picker grid below, so there's nothing to fetch here.
    if (mainTab === "game" && selectedGameId === "all") {
      setGameRecords([]);
      setStatus("success");
      return;
    }
    setStatus("loading");
    setErrorMsg(null);
    try {
      if (mainTab === "game") {
        const data = await fetchLeaderboardApi(selectedGameId);
        setGameRecords(data);
      } else if (mainTab === "xp") {
        const res = await fetchXpLeaderboardApi(50);
        setXpRecords(res.entries);
      } else if (mainTab === "creator") {
        const res = await fetchCreatorRankingsApi(
          creatorMode,
          selectedGameId,
          selectedPlatform,
          50,
          0,
        );
        setCreatorRecords(res.entries);
      }
      setStatus("success");
    } catch (err) {
      console.error("Failed to load leaderboard:", err);
      setErrorMsg(dict.common.error);
      setStatus("error");
    }
  }, [mainTab, selectedGameId, creatorMode, selectedPlatform, dict.common.error]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  return (
    <div className="flex flex-col w-full px-4 md:px-8 py-8 gap-8 max-w-[100rem] mx-auto flex-1 select-none">
      {/* Title Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-border/60 pb-6">
        <div>
          <div className="flex items-center gap-2 text-accent-yellow font-bold text-xs uppercase tracking-wider mb-1">
            <Trophy className="w-4 h-4" />
            <span>{dict.ranking.eyebrow}</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-black text-text-primary">
            {dict.ranking.title}
          </h1>
          <p className="text-sm text-text-secondary mt-1">{dict.ranking.subtitle}</p>
        </div>

        {/* Top-Level Mode Tabs */}
        <div className="flex items-center gap-1.5 rounded-2xl bg-surface-sidebar p-1.5 border border-border">
          <button
            onClick={() => setMainTab("game")}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs md:text-sm font-extrabold transition-all cursor-pointer ${
              mainTab === "game"
                ? "bg-brand text-white shadow-lg shadow-brand/25"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            <Gamepad2 className="w-4 h-4" />
            <span>{dict.ranking.gameTab}</span>
          </button>

          <button
            onClick={() => setMainTab("xp")}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs md:text-sm font-extrabold transition-all cursor-pointer ${
              mainTab === "xp"
                ? "bg-brand text-white shadow-lg shadow-brand/25"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            <Zap className="w-4 h-4 text-accent-yellow" />
            <span>{dict.ranking.xpTab}</span>
          </button>

          <button
            onClick={() => setMainTab("creator")}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs md:text-sm font-extrabold transition-all cursor-pointer ${
              mainTab === "creator"
                ? "bg-purple-600 text-white shadow-lg shadow-purple-600/25"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            <Video className="w-4 h-4 text-purple-300" />
            <span>{dict.ranking.creatorTab}</span>
          </button>
        </div>
      </div>

      {/* The game tab's picker moved into a sidebar next to the table (below) — a horizontal
          chip row here enumerates every game unconditionally, which stops working once the
          catalog grows well past a handful of entries. */}

      {mainTab === "creator" && (
        <div className="space-y-3 border-b border-border/40 pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            {/* Platform Filter Pills */}
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
              {(
                [
                  { id: "ALL", label: dict.ranking.allPlatforms },
                  { id: "YOUTUBE", label: "YouTube" },
                  { id: "CHZZK", label: dict.ranking.platformChzzk },
                  { id: "SOOP", label: dict.ranking.platformSoop },
                  { id: "TWITCH", label: "Twitch" },
                ] as const
              ).map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedPlatform(p.id)}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer border ${
                    selectedPlatform === p.id
                      ? "bg-purple-600 text-white border-purple-500 shadow-md"
                      : "bg-surface-raised text-text-secondary border-border/80 hover:text-text-primary"
                  }`}
                >
                  {p.id === "ALL" ? (
                    <Globe className="h-3.5 w-3.5" />
                  ) : (
                    <PlatformIcon platform={p.id} size={16} />
                  )}
                  {p.label}
                </button>
              ))}
            </div>

            {/* Metric Mode Switch */}
            <div className="flex items-center gap-1 rounded-xl bg-surface-sidebar p-1 border border-border self-start sm:self-auto">
              <button
                onClick={() => setCreatorMode("score")}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                  creatorMode === "score"
                    ? "bg-purple-600 text-white"
                    : "text-text-muted hover:text-text-primary"
                }`}
              >
                🎮 {dict.ranking.scoreMode}
              </button>
              <button
                onClick={() => setCreatorMode("xp")}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                  creatorMode === "xp"
                    ? "bg-purple-600 text-white"
                    : "text-text-muted hover:text-text-primary"
                }`}
              >
                ⚡ {dict.ranking.xpMode}
              </button>
            </div>
          </div>

          {/* If Creator Score mode, show game selector pills */}
          {creatorMode === "score" && (
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pt-2">
              <button
                onClick={() => setSelectedGameId("all")}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all border ${
                  selectedGameId === "all"
                    ? "bg-purple-500/20 text-purple-300 border-purple-400/40"
                    : "bg-surface-raised text-text-muted border-border/60 hover:text-text-primary"
                }`}
              >
                {dict.ranking.allCategories}
              </button>
              {gameManifests.map((game) => (
                <button
                  key={game.slug}
                  onClick={() => setSelectedGameId(game.slug)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-all border ${
                    selectedGameId === game.slug
                      ? "bg-purple-500/20 text-purple-300 border-purple-400/40"
                      : "bg-surface-raised text-text-muted border-border/60 hover:text-text-primary"
                  }`}
                >
                  {getLocalizedGameContent(dict, game).title}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Sidebar + wide main area for the game tab — the sidebar's search box is what actually
          lets this scale past a handful of games (a text filter over a scrollable list, instead
          of enumerating every game as chips or grid cards), and moving the picker out of the
          top bar into a fixed-width column frees up the rest of the width for the table, which
          used to compete with a full-width chip row above it for the same horizontal space.
          xp/creator tabs have no sidebar and keep the full-width single-column layout. */}
      <div className="flex flex-col gap-6 lg:flex-row">
        {mainTab === "game" && (
          <aside className="flex shrink-0 flex-col gap-3 lg:w-64">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                value={gameSearchQuery}
                onChange={(e) => setGameSearchQuery(e.target.value)}
                placeholder={dict.games.searchPlaceholder}
                className="w-full rounded-xl border border-border/80 bg-surface-raised py-2.5 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
            </div>

            <div className="flex flex-col gap-1 lg:max-h-[28rem] lg:overflow-y-auto lg:pr-1">
              <button
                onClick={() => setSelectedGameId("all")}
                className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-bold transition-all cursor-pointer border ${
                  selectedGameId === "all"
                    ? "bg-brand text-white border-brand shadow-lg shadow-brand/25"
                    : "bg-surface-raised text-text-secondary border-border/80 hover:text-text-primary"
                }`}
              >
                <Trophy className="h-4 w-4 shrink-0" />
                <span className="truncate">{dict.ranking.allCategories}</span>
              </button>

              {filteredSidebarGames.length === 0 ? (
                <p className="px-3 py-4 text-center text-xs text-text-muted">
                  {dict.games.emptySearch}
                </p>
              ) : (
                filteredSidebarGames.map((game) => (
                  <button
                    key={game.slug}
                    onClick={() => setSelectedGameId(game.slug)}
                    className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-bold transition-all cursor-pointer border ${
                      selectedGameId === game.slug
                        ? "bg-brand text-white border-brand shadow-lg shadow-brand/25"
                        : "bg-surface-raised text-text-secondary border-border/80 hover:text-text-primary"
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

        <div className="min-w-0 flex-1">
          {/* "전체 종목" under the game tab: scores aren't comparable across different games (ms
              vs. WPM etc.), so instead of a combined table this shows a picker — choose a game to
              see its own dedicated ranking page (osu!-style: ranking per game, not one mixed
              leaderboard). */}
          {mainTab === "game" && selectedGameId === "all" ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {gameManifests.map((game) => {
                const content = getLocalizedGameContent(dict, game);
                return (
                  <Link
                    key={game.slug}
                    to={`/games/${game.slug}/ranking`}
                    className="group flex flex-col items-center gap-3 rounded-2xl border border-border bg-surface-raised p-5 text-center shadow-lg transition-all hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-2xl"
                  >
                    <GameThumbnail
                      thumbnail={game.thumbnail}
                      title={content.title}
                      accent={game.accent}
                      className="h-16 w-16 transition-transform duration-300 group-hover:scale-110"
                    />
                    <span className="font-bold text-text-primary group-hover:text-brand transition-colors">
                      {content.title}
                    </span>
                  </Link>
                );
              })}
            </div>
          ) : (
            <>
              {/* Leaderboard Table Container */}
              <div className="w-full bg-surface-raised rounded-3xl border border-border overflow-hidden shadow-2xl">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-surface-sidebar border-b border-border text-xs font-extrabold text-text-muted uppercase tracking-wider">
                        <th className="py-4 px-6">{dict.ranking.rankHeader}</th>
                        <th className="py-4 px-6">
                          {mainTab === "creator"
                            ? dict.ranking.streamerHeader
                            : dict.ranking.playerHeader}
                        </th>
                        {mainTab === "game" && (
                          <>
                            <th className="py-4 px-6">{dict.ranking.categoryHeader}</th>
                            <th className="py-4 px-6">{dict.ranking.recordHeader}</th>
                            <th className="py-4 px-6">{dict.ranking.dateHeader}</th>
                          </>
                        )}
                        {mainTab === "xp" && (
                          <>
                            <th className="py-4 px-6">{dict.ranking.levelHeader}</th>
                            <th className="py-4 px-6">{dict.ranking.totalXpHeader}</th>
                          </>
                        )}
                        {mainTab === "creator" && (
                          <>
                            <th className="py-4 px-6">
                              {creatorMode === "score"
                                ? dict.ranking.recordOrCategory
                                : dict.ranking.activityLevel}
                            </th>
                            <th className="py-4 px-6">{dict.ranking.badgeHeader}</th>
                            <th className="py-4 px-6 text-right">{dict.ranking.platformHeader}</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50 text-sm font-medium text-text-primary">
                      {status === "loading" && (
                        <tr>
                          <td
                            colSpan={6}
                            className="py-16 text-center text-text-muted animate-pulse"
                          >
                            {dict.common.loading}
                          </td>
                        </tr>
                      )}

                      {status === "error" && (
                        <tr>
                          <td colSpan={6} className="py-16 text-center text-text-muted">
                            <div className="flex flex-col items-center justify-center gap-3">
                              <AlertCircle className="w-8 h-8 text-accent-red" />
                              <p className="font-semibold text-text-primary">{errorMsg}</p>
                              <button
                                onClick={() => void loadData()}
                                className="inline-flex items-center gap-2 px-4 py-2 bg-surface-raised border border-border rounded-xl text-xs font-bold hover:bg-surface-overlay transition-colors cursor-pointer"
                              >
                                <RefreshCw className="w-3.5 h-3.5" />
                                {dict.ranking.retryButton}
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}

                      {/* Mode 1: Game Score Leaderboard */}
                      {status === "success" && mainTab === "game" && (
                        <>
                          {gameRecords.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="py-16 text-center text-text-muted">
                                {dict.ranking.emptyGames}
                              </td>
                            </tr>
                          ) : (
                            gameRecords.map((record, index) => {
                              const rank = index + 1;

                              return (
                                <tr
                                  key={record.id}
                                  className="hover:bg-surface-overlay/50 transition-colors"
                                >
                                  <td className="py-4 px-6 whitespace-nowrap">
                                    {rank === 1 && (
                                      <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-amber-500/20 text-amber-400 font-black border border-amber-500/40 shadow-md">
                                        <Medal className="w-4 h-4" /> {dict.ranking.rank1}
                                      </span>
                                    )}
                                    {rank === 2 && (
                                      <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-slate-400/20 text-slate-300 font-bold border border-slate-400/40">
                                        <Medal className="w-4 h-4" /> {dict.ranking.rank2}
                                      </span>
                                    )}
                                    {rank === 3 && (
                                      <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-amber-700/20 text-amber-600 font-bold border border-amber-700/40">
                                        <Medal className="w-4 h-4" /> {dict.ranking.rank3}
                                      </span>
                                    )}
                                    {rank > 3 && (
                                      <span className="text-text-muted font-bold px-3">
                                        #{rank}
                                      </span>
                                    )}
                                  </td>

                                  <td className="py-4 px-6 font-bold text-text-primary">
                                    {record.userId !== null && record.userId !== undefined ? (
                                      <Link
                                        to={`/users/${record.userId}`}
                                        className="flex w-fit items-center gap-2 text-brand-light hover:underline"
                                      >
                                        <div className="w-8 h-8 rounded-full bg-brand/20 text-brand flex items-center justify-center font-black text-xs overflow-hidden">
                                          {record.avatarUrl ? (
                                            <img
                                              src={record.avatarUrl}
                                              alt={record.playerName}
                                              className="w-full h-full object-cover"
                                            />
                                          ) : (
                                            record.playerName.slice(0, 2)
                                          )}
                                        </div>
                                        <span>
                                          {formatPublicUserTag(record.playerName, record.userId)}
                                        </span>
                                      </Link>
                                    ) : (
                                      <div className="flex items-center gap-2">
                                        <div className="w-8 h-8 rounded-full bg-brand/20 text-brand flex items-center justify-center font-black text-xs overflow-hidden">
                                          {record.avatarUrl ? (
                                            <img
                                              src={record.avatarUrl}
                                              alt={record.playerName}
                                              className="w-full h-full object-cover"
                                            />
                                          ) : (
                                            record.playerName.slice(0, 2)
                                          )}
                                        </div>
                                        <span>{record.playerName}</span>
                                      </div>
                                    )}
                                  </td>

                                  <td className="py-4 px-6 text-text-secondary whitespace-nowrap">
                                    {record.gameTitle}
                                  </td>

                                  <td className="py-4 px-6 font-black text-brand-light text-base whitespace-nowrap">
                                    {record.formattedScore}
                                  </td>

                                  <td className="py-4 px-6 text-text-muted text-xs whitespace-nowrap">
                                    {record.createdAt}
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </>
                      )}

                      {/* Mode 2: XP Leaderboard */}
                      {status === "success" && mainTab === "xp" && (
                        <>
                          {xpRecords.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="py-16 text-center text-text-muted">
                                {dict.ranking.emptyXp}
                              </td>
                            </tr>
                          ) : (
                            xpRecords.map((record) => {
                              const level = levelForTotalXp(record.totalXp);

                              return (
                                <tr
                                  key={record.userId}
                                  className="hover:bg-surface-overlay/50 transition-colors"
                                >
                                  <td className="py-4 px-6 whitespace-nowrap font-bold">
                                    {record.rank === 1 ? (
                                      <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-amber-500/20 text-amber-400 font-black border border-amber-500/40">
                                        <Medal className="w-4 h-4" /> {dict.ranking.rank1}
                                      </span>
                                    ) : record.rank === 2 ? (
                                      <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-slate-400/20 text-slate-300 font-bold border border-slate-400/40">
                                        <Medal className="w-4 h-4" /> {dict.ranking.rank2}
                                      </span>
                                    ) : record.rank === 3 ? (
                                      <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-amber-700/20 text-amber-600 font-bold border border-amber-700/40">
                                        <Medal className="w-4 h-4" /> {dict.ranking.rank3}
                                      </span>
                                    ) : (
                                      <span className="text-text-muted px-3">#{record.rank}</span>
                                    )}
                                  </td>

                                  <td className="py-4 px-6 font-bold text-text-primary">
                                    <Link
                                      to={`/users/${record.userId}`}
                                      className="flex w-fit items-center gap-2 text-brand-light hover:underline"
                                    >
                                      <div className="w-8 h-8 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center font-black text-xs overflow-hidden">
                                        {record.avatarUrl ? (
                                          <img
                                            src={record.avatarUrl}
                                            alt={record.nickname}
                                            className="w-full h-full object-cover"
                                          />
                                        ) : (
                                          record.nickname.slice(0, 2)
                                        )}
                                      </div>
                                      <span>
                                        {formatPublicUserTag(record.nickname, record.userId)}
                                      </span>
                                    </Link>
                                  </td>

                                  <td className="py-4 px-6 whitespace-nowrap">
                                    <span className="inline-flex items-center rounded-full bg-indigo-500/10 px-2.5 py-0.5 text-xs font-extrabold text-indigo-300 border border-indigo-500/20">
                                      Lv. {level}
                                    </span>
                                  </td>

                                  <td className="py-4 px-6 font-black text-amber-300 text-base whitespace-nowrap">
                                    {record.totalXp.toLocaleString()} XP
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </>
                      )}

                      {/* Mode 3: Creator Ranking */}
                      {status === "success" && mainTab === "creator" && (
                        <>
                          {creatorRecords.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="py-16 text-center space-y-3">
                                <div className="text-3xl">🎥</div>
                                <p className="text-sm font-semibold text-text-secondary">
                                  {dict.ranking.emptyCreatorTitle}
                                </p>
                                <p className="text-xs text-text-muted max-w-md mx-auto leading-relaxed">
                                  {dict.ranking.emptyCreatorBody}
                                </p>
                              </td>
                            </tr>
                          ) : (
                            creatorRecords.map((record) => (
                              <tr
                                key={record.creatorId}
                                className="hover:bg-surface-overlay/50 transition-colors"
                              >
                                <td className="py-4 px-6 whitespace-nowrap font-bold">
                                  <span className="text-purple-300 px-3">#{record.rank}</span>
                                </td>

                                <td className="py-4 px-6 font-bold text-text-primary flex items-center gap-3">
                                  {record.avatarUrl ? (
                                    <img
                                      src={record.avatarUrl}
                                      alt={record.nickname}
                                      className="w-9 h-9 rounded-full object-cover border border-purple-500/30"
                                    />
                                  ) : (
                                    <div className="w-9 h-9 rounded-full bg-purple-600/30 text-purple-200 flex items-center justify-center font-black text-xs border border-purple-500/30">
                                      {record.nickname.slice(0, 2)}
                                    </div>
                                  )}
                                  <div>
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-bold text-white">
                                        {formatPublicUserTag(record.nickname, record.userId)}
                                      </span>
                                      {record.country && (
                                        <span className="text-[10px] text-text-muted font-mono">
                                          [{record.country}]
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </td>

                                <td className="py-4 px-6 whitespace-nowrap font-black text-purple-200">
                                  {creatorMode === "score" ? (
                                    <div>
                                      <div>{record.formattedScore}</div>
                                      {record.gameTitle && (
                                        <div className="text-[11px] font-normal text-text-muted">
                                          {record.gameTitle}
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <div>
                                      <div className="text-amber-300">
                                        {(record.totalXp ?? 0).toLocaleString()} XP
                                      </div>
                                      <div className="text-[11px] font-normal text-text-muted">
                                        Lv. {record.level ?? 1}
                                      </div>
                                    </div>
                                  )}
                                </td>

                                <td className="py-4 px-6 whitespace-nowrap">
                                  {/* Featured/Partner 배지는 현재 공개 노출하지 않습니다 — 심사 최소 기준을
                              임시로 낮춘 테스트 단계라, 관리자가 실제로 승인하기 전까지는 모든
                              검증된 크리에이터를 동일하게 "CREATOR"로만 표시합니다. 실제
                              featuredStatus는 계속 계산/저장되며 관리자 화면(/admin/creators)에서만
                              확인할 수 있습니다. */}
                                  <span className="inline-flex items-center rounded-full border border-indigo-500/30 bg-indigo-500/20 px-2.5 py-0.5 text-[10px] font-extrabold text-indigo-300">
                                    CREATOR
                                  </span>
                                </td>

                                <td className="py-4 px-6 whitespace-nowrap">
                                  <div className="flex justify-end">
                                    <PlatformIconRow accounts={record.platformAccounts} size={24} />
                                  </div>
                                </td>
                              </tr>
                            ))
                          )}
                        </>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
