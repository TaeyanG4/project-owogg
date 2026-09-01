import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { Gamepad2, Search, Tags } from "lucide-react";
import { usePublicGames } from "../features/publicGamesApi";
import { publicGameToCard } from "../features/catalog/publicGameAdapter";
import {
  groupGamesByGenre,
  matchesGamePlayMode,
  matchesGameSearch,
  normalizeCatalogValue,
  type GamePlayModeFilter,
} from "../features/catalog/gameCatalogFilters";
import { resolveGameGenre } from "../features/catalog/gameGenres";
import { GameGrid } from "../components/ui/GameGrid";
import { GridColumnSwitcher } from "../components/ui/GridColumnSwitcher";
import { GameSortSelect } from "../components/ui/GameSortSelect";
import { GameDescriptionToggle } from "../components/ui/GameDescriptionToggle";
import { usePersonalization, useGridColumns } from "../features/personalization";
import { useI18n } from "../features/i18n/I18nContext";
import { getLocalizedGameContent } from "../features/catalog/localizedGameContent";
import { isGameSortKey, sortPublicGameCards, type GameSortKey } from "../features/catalog/gameSort";

export function meta() {
  return [
    { title: "전체 게임 목록 | OwOGG" },
    { name: "description", content: "설치 없는 모든 웹게임을 한 곳에서 탐색하고 즐기세요." },
  ];
}

export default function Games() {
  const [searchParams, setSearchParams] = useSearchParams();
  const searchParam = searchParams.get("search") ?? "";
  const [searchQuery, setSearchQuery] = useState(searchParam);
  const requestedSort = searchParams.get("sort");
  const sortKey = isGameSortKey(requestedSort) ? requestedSort : "popular";
  const view = searchParams.get("view");
  const legacyCategory = searchParams.get("category");
  const playModeParam = searchParams.get("playMode");
  const playModeFilter: GamePlayModeFilter | null =
    playModeParam === "single" || playModeParam === "multi" ? playModeParam : null;
  const isGenreView = view === "genres";
  const isFavoritesView = view === "favorites" || legacyCategory === "favorites";
  const isAllGamesView =
    !isGenreView &&
    !isFavoritesView &&
    playModeFilter === null &&
    (!legacyCategory || legacyCategory === "all");
  const {
    mobileColumns,
    setMobileColumns,
    desktopColumns,
    setDesktopColumns,
    showDescriptions,
    setShowDescriptions,
  } = useGridColumns();
  const { dict, locale } = useI18n();
  const { games: publicGames, isLoading } = usePublicGames();
  const gameCards = useMemo(() => publicGames.map(publicGameToCard), [publicGames]);
  const { favoriteGameIds } = usePersonalization();
  const resolveLocalizedGenre = useCallback(
    (genre: string | undefined) =>
      resolveGameGenre(genre, dict.games.genreLabels, dict.games.uncategorizedGenre),
    [dict.games.genreLabels, dict.games.uncategorizedGenre],
  );
  const selectedGenreParam = searchParams.get("genre");
  const selectedGenreKey = selectedGenreParam
    ? resolveLocalizedGenre(selectedGenreParam).key
    : null;

  useEffect(() => {
    setSearchQuery(searchParam);
  }, [searchParam]);

  const catalogGames = useMemo(() => {
    const normalizedLegacyCategory =
      legacyCategory && legacyCategory !== "all" && legacyCategory !== "favorites"
        ? normalizeCatalogValue(legacyCategory)
        : null;
    const matching = gameCards.filter((game) => {
      const matchesLegacyCategory =
        normalizedLegacyCategory === null ||
        [...game.categories, ...game.tags, game.genre ?? ""].some(
          (value) => normalizeCatalogValue(value) === normalizedLegacyCategory,
        );
      return (
        matchesGamePlayMode(game, playModeFilter) &&
        matchesLegacyCategory &&
        (!isFavoritesView || favoriteGameIds.includes(game.slug))
      );
    });
    return sortPublicGameCards(matching, sortKey);
  }, [favoriteGameIds, gameCards, isFavoritesView, legacyCategory, playModeFilter, sortKey]);

  const filteredGames = useMemo(
    () =>
      catalogGames.filter((game) => {
        const localized = getLocalizedGameContent(dict, game);
        return matchesGameSearch(game, searchQuery, {
          ...localized,
          genre: resolveLocalizedGenre(game.genre).label,
        });
      }),
    [catalogGames, dict, resolveLocalizedGenre, searchQuery],
  );

  const allGenreGroups = useMemo(
    () => groupGamesByGenre(catalogGames, resolveLocalizedGenre),
    [catalogGames, resolveLocalizedGenre],
  );
  const normalizedGenreSearch = normalizeCatalogValue(searchQuery);
  const genreMatchesSearch = useCallback(
    (group: (typeof allGenreGroups)[number]) =>
      !normalizedGenreSearch ||
      normalizeCatalogValue(group.key).includes(normalizedGenreSearch) ||
      normalizeCatalogValue(group.label).includes(normalizedGenreSearch),
    [normalizedGenreSearch],
  );
  const gameMatchesGenreSearch = useCallback(
    (game: (typeof gameCards)[number], genreLabel: string) => {
      const localized = getLocalizedGameContent(dict, game);
      return matchesGameSearch(game, searchQuery, { ...localized, genre: genreLabel });
    },
    [dict, searchQuery],
  );
  const searchedGenreGroups = useMemo(
    () =>
      allGenreGroups
        .map((group) => ({
          ...group,
          games: genreMatchesSearch(group)
            ? group.games
            : group.games.filter((game) => gameMatchesGenreSearch(game, group.label)),
        }))
        .filter((group) => group.games.length > 0),
    [allGenreGroups, gameMatchesGenreSearch, genreMatchesSearch],
  );
  const genreOptions = useMemo(
    () =>
      allGenreGroups.filter(
        (group) =>
          genreMatchesSearch(group) ||
          group.games.some((game) => gameMatchesGenreSearch(game, group.label)),
      ),
    [allGenreGroups, gameMatchesGenreSearch, genreMatchesSearch],
  );
  const visibleGenreGroups = useMemo(
    () =>
      selectedGenreKey === null
        ? searchedGenreGroups
        : searchedGenreGroups.filter((group) => group.key === selectedGenreKey),
    [searchedGenreGroups, selectedGenreKey],
  );
  const visibleGameCount = isGenreView
    ? visibleGenreGroups.reduce((total, group) => total + group.games.length, 0)
    : filteredGames.length;
  const gameCountLabel = dict.games.countTemplate.replace(
    "{count}",
    visibleGameCount.toLocaleString(locale),
  );
  const pageTitle = isFavoritesView
    ? dict.games.favoritesTitle
    : isGenreView
      ? dict.games.genreTitle
      : playModeFilter === "single"
        ? dict.games.singleTitle
        : playModeFilter === "multi"
          ? dict.games.multiplayerTitle
          : dict.games.title;

  const changeSort = (nextSort: GameSortKey) => {
    const next = new URLSearchParams(searchParams);
    next.set("sort", nextSort);
    setSearchParams(next, { replace: true });
  };

  const changeSearch = (nextQuery: string) => {
    setSearchQuery(nextQuery);
    const next = new URLSearchParams(searchParams);
    if (nextQuery) next.set("search", nextQuery);
    else next.delete("search");
    setSearchParams(next, { replace: true });
  };

  const changeGenre = (nextGenre: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (nextGenre) next.set("genre", nextGenre);
    else next.delete("genre");
    setSearchParams(next);
  };

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8 xl:px-10">
      <div className="flex flex-col justify-between gap-6 border-b border-border/60 pb-6 md:flex-row md:items-center">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-brand">
            <Gamepad2 className="h-4 w-4" aria-hidden="true" />
            <span>{dict.games.eyebrow}</span>
          </div>
          <h1 className="text-3xl font-black text-text-primary md:text-4xl">{pageTitle}</h1>
          {!isLoading && (
            <p className="mt-2 text-sm text-text-muted" data-testid="game-count-label">
              {gameCountLabel}
            </p>
          )}
        </div>

        {!isGenreView && !isAllGamesView && (
          <div className="relative w-full md:w-80">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input
              type="search"
              aria-label={dict.games.searchPlaceholder}
              value={searchQuery}
              onChange={(event) => changeSearch(event.target.value)}
              placeholder={dict.games.searchPlaceholder}
              className="w-full rounded-xl border border-border/80 bg-surface-raised py-2.5 pl-10 pr-4 text-sm text-text-primary placeholder:text-text-muted focus:border-brand focus:outline-none"
            />
          </div>
        )}
      </div>

      <div
        data-testid="game-catalog-toolbar"
        className="flex min-w-0 flex-wrap items-center justify-end gap-2.5"
      >
        <GameSortSelect
          value={sortKey}
          onChange={changeSort}
          label={dict.games.sortLabel}
          options={dict.games.sortOptions}
        />
        <GridColumnSwitcher
          mobileColumns={mobileColumns}
          onMobileChange={setMobileColumns}
          desktopColumns={desktopColumns}
          onDesktopChange={setDesktopColumns}
        />
        <GameDescriptionToggle
          showDescriptions={showDescriptions}
          onChange={setShowDescriptions}
          showLabel={dict.games.showDescriptions}
          hideLabel={dict.games.hideDescriptions}
        />
      </div>

      {isGenreView ? (
        <div className="flex flex-col gap-6 lg:flex-row">
          <aside
            className="flex shrink-0 flex-col gap-3 lg:w-64"
            data-testid="genre-filter-sidebar"
          >
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
              <input
                type="search"
                aria-label={dict.games.genreSearchPlaceholder}
                value={searchQuery}
                onChange={(event) => changeSearch(event.target.value)}
                placeholder={dict.games.genreSearchPlaceholder}
                className="w-full rounded-xl border border-border/80 bg-surface-raised py-2.5 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
            </div>
            <div className="flex flex-col gap-1 lg:max-h-[32rem] lg:overflow-y-auto lg:pr-1">
              <button
                type="button"
                onClick={() => changeGenre(null)}
                aria-pressed={selectedGenreKey === null}
                className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-bold transition-all ${
                  selectedGenreKey === null
                    ? "border-brand bg-brand text-white"
                    : "border-border/80 bg-surface-raised text-text-secondary hover:text-text-primary"
                }`}
              >
                <Tags className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{dict.games.allGenres}</span>
                <span className="text-xs tabular-nums opacity-75">{catalogGames.length}</span>
              </button>
              {genreOptions.map((group) => (
                <button
                  key={group.key}
                  type="button"
                  onClick={() => changeGenre(group.key)}
                  aria-pressed={selectedGenreKey === group.key}
                  className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-bold transition-all ${
                    selectedGenreKey === group.key
                      ? "border-brand bg-brand text-white"
                      : "border-border/80 bg-surface-raised text-text-secondary hover:text-text-primary"
                  }`}
                >
                  <Gamepad2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{group.label}</span>
                  <span className="text-xs tabular-nums opacity-75">{group.games.length}</span>
                </button>
              ))}
            </div>
          </aside>

          <div className="min-w-0 flex-1" data-testid="genre-groups">
            {visibleGenreGroups.length > 0 ? (
              <div className="flex flex-col gap-10">
                {visibleGenreGroups.map((group) => (
                  <section key={group.key} className="flex flex-col gap-4">
                    <div className="flex items-baseline gap-2 border-b border-border/40 pb-3">
                      <h2 className="text-xl font-black tracking-tight text-text-primary">
                        {group.label}
                      </h2>
                      <span className="text-xs font-bold text-text-muted">
                        {group.games.length}
                      </span>
                    </div>
                    <GameGrid
                      games={group.games}
                      mobileColumns={mobileColumns}
                      desktopColumns={desktopColumns}
                      showDescriptions={showDescriptions}
                    />
                  </section>
                ))}
              </div>
            ) : (
              <div className="rounded-3xl border border-dashed border-border bg-surface-raised py-16 text-center text-text-muted">
                {dict.games.emptySearch}
              </div>
            )}
          </div>
        </div>
      ) : (
        <GameGrid
          games={filteredGames}
          mobileColumns={mobileColumns}
          desktopColumns={desktopColumns}
          showDescriptions={showDescriptions}
          loading={isLoading}
          loadingMessage={<span role="status">{dict.common.loading}</span>}
          emptyMessage={isFavoritesView ? dict.games.emptyFavorites : dict.games.emptySearch}
        />
      )}
    </div>
  );
}
