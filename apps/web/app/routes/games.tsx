import { useState, useMemo } from "react";
import { useSearchParams } from "react-router";
import { Gamepad2, Search } from "lucide-react";
import { usePublicGames } from "../features/publicGamesApi";
import { publicGameToCard } from "../features/catalog/publicGameAdapter";
import { GameGrid } from "../components/ui/GameGrid";
import { GridColumnSwitcher } from "../components/ui/GridColumnSwitcher";
import { GameSortSelect } from "../components/ui/GameSortSelect";
import { CategoryChips } from "../components/ui/CategoryChips";
import { usePersonalization, useGridColumns } from "../features/personalization";
import { useAuth } from "../features/auth";
import { useI18n } from "../features/i18n/I18nContext";
import { getLocalizedGameContent } from "../features/catalog/localizedGameContent";
import { isGameSortKey, sortPublicGameCards, type GameSortKey } from "../features/catalog/gameSort";

export function meta() {
  return [
    { title: "전체 미니게임 목록 | OwOGG" },
    { name: "description", content: "설치 없는 모든 웹 미니게임을 한 곳에서 탐색하고 즐기세요." },
  ];
}

export default function Games() {
  const [searchParams] = useSearchParams();
  const initialSearch = searchParams.get("search") || "";
  const initialCategory = searchParams.get("category") || "all";
  const requestedSort = searchParams.get("sort");

  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [selectedCategory, setSelectedCategory] = useState(initialCategory);
  const [sortKey, setSortKey] = useState<GameSortKey>(
    isGameSortKey(requestedSort) ? requestedSort : "popular",
  );
  const { mobileColumns, setMobileColumns, desktopColumns, setDesktopColumns } = useGridColumns();
  const { dict } = useI18n();
  const { games: publicGames, isLoading } = usePublicGames();
  const gameManifests = useMemo(
    () => publicGames.map((game) => publicGameToCard(game)),
    [publicGames],
  );

  const { favoriteGameIds } = usePersonalization();
  const { isAuthenticated, openLoginModal } = useAuth();

  const handleSelectCategory = (categoryId: string) => {
    if (categoryId === "favorites" && !isAuthenticated) {
      openLoginModal();
      return;
    }
    setSelectedCategory(categoryId);
  };

  const filteredGames = useMemo(() => {
    const matchingGames = gameManifests.filter((game) => {
      const { title, shortDescription } = getLocalizedGameContent(dict, game);
      const matchesSearch =
        !searchQuery ||
        title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        shortDescription.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (game.genre?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false);

      const matchesCategory =
        selectedCategory === "all"
          ? true
          : selectedCategory === "favorites"
            ? favoriteGameIds.includes(game.slug)
            : game.categories.includes(selectedCategory);

      return matchesSearch && matchesCategory;
    });
    return sortPublicGameCards(matchingGames, sortKey);
    // gameManifests changes whenever the generic public API refreshes.
  }, [gameManifests, searchQuery, selectedCategory, favoriteGameIds, dict, sortKey]);

  return (
    <div className="flex flex-col w-full px-4 md:px-8 py-8 gap-8 max-w-7xl mx-auto flex-1">
      {/* Top Title & Search Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-border/60 pb-6">
        <div>
          <div className="flex items-center gap-2 text-brand font-bold text-xs uppercase tracking-wider mb-1">
            <Gamepad2 className="w-4 h-4" />
            <span>{dict.games.eyebrow}</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-black text-text-primary">{dict.games.title}</h1>
        </div>

        {/* Live Filter Search Input */}
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-text-muted absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={dict.games.searchPlaceholder}
            className="w-full bg-surface-raised text-text-primary placeholder:text-text-muted text-sm rounded-xl pl-10 pr-4 py-2.5 border border-border/80 focus:outline-none focus:border-brand transition-all"
          />
        </div>
      </div>

      {/* Category Chips Bar & Grid Density Switcher */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 min-w-0">
        <CategoryChips
          selectedCategory={selectedCategory}
          onSelectCategory={handleSelectCategory}
        />
        <div className="flex items-center gap-2.5 self-stretch sm:self-auto">
          <GameSortSelect
            value={sortKey}
            onChange={setSortKey}
            label={dict.games.sortLabel}
            options={dict.games.sortOptions}
          />
          <GridColumnSwitcher
            mobileColumns={mobileColumns}
            onMobileChange={setMobileColumns}
            desktopColumns={desktopColumns}
            onDesktopChange={setDesktopColumns}
          />
        </div>
      </div>

      {/* Grid */}
      <GameGrid
        games={filteredGames}
        mobileColumns={mobileColumns}
        desktopColumns={desktopColumns}
        loading={isLoading}
        loadingMessage={<span role="status">{dict.common.loading}</span>}
        emptyMessage={
          selectedCategory === "favorites" ? dict.games.emptyFavorites : dict.games.emptySearch
        }
      />
    </div>
  );
}
