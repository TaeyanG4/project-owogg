import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { Gamepad2, Search } from "lucide-react";
import { usePublicGames } from "../features/publicGamesApi";
import { publicGameToCard } from "../features/catalog/publicGameAdapter";
import {
  groupGamesByGenre,
  matchesGamePlayMode,
  matchesGameSearch,
  normalizeCatalogValue,
  type GamePlayModeFilter,
} from "../features/catalog/gameCatalogFilters";
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
  const {
    mobileColumns,
    setMobileColumns,
    desktopColumns,
    setDesktopColumns,
    showDescriptions,
    setShowDescriptions,
  } = useGridColumns();
  const { dict } = useI18n();
  const { games: publicGames, isLoading } = usePublicGames();
  const gameCards = useMemo(() => publicGames.map(publicGameToCard), [publicGames]);
  const { favoriteGameIds } = usePersonalization();

  useEffect(() => {
    setSearchQuery(searchParam);
  }, [searchParam]);

  const filteredGames = useMemo(() => {
    const normalizedLegacyCategory =
      legacyCategory && legacyCategory !== "all" && legacyCategory !== "favorites"
        ? normalizeCatalogValue(legacyCategory)
        : null;
    const matching = gameCards.filter((game) => {
      const localized = getLocalizedGameContent(dict, game);
      const matchesLegacyCategory =
        normalizedLegacyCategory === null ||
        [...game.categories, ...game.tags, game.genre ?? ""].some(
          (value) => normalizeCatalogValue(value) === normalizedLegacyCategory,
        );
      return (
        matchesGameSearch(game, searchQuery, localized) &&
        matchesGamePlayMode(game, playModeFilter) &&
        matchesLegacyCategory &&
        (!isFavoritesView || favoriteGameIds.includes(game.slug))
      );
    });
    return sortPublicGameCards(matching, sortKey);
  }, [
    dict,
    favoriteGameIds,
    gameCards,
    isFavoritesView,
    legacyCategory,
    playModeFilter,
    searchQuery,
    sortKey,
  ]);

  const genreGroups = useMemo(
    () => groupGamesByGenre(filteredGames, dict.games.uncategorizedGenre),
    [dict.games.uncategorizedGenre, filteredGames],
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
            <p className="mt-2 text-sm text-text-muted">
              {filteredGames.length} {dict.games.countSuffix}
            </p>
          )}
        </div>

        <div className="relative w-full md:w-80">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => changeSearch(event.target.value)}
            placeholder={dict.games.searchPlaceholder}
            className="w-full rounded-xl border border-border/80 bg-surface-raised py-2.5 pl-10 pr-4 text-sm text-text-primary placeholder:text-text-muted focus:border-brand focus:outline-none"
          />
        </div>
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

      {isGenreView && genreGroups.length > 0 ? (
        <div className="flex flex-col gap-10" data-testid="genre-groups">
          {genreGroups.map((group) => (
            <section key={group.key} className="flex flex-col gap-4">
              <div className="flex items-baseline gap-2 border-b border-border/40 pb-3">
                <h2 className="text-xl font-black tracking-tight text-text-primary">
                  {group.label}
                </h2>
                <span className="text-xs font-bold text-text-muted">{group.games.length}</span>
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
