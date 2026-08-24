import { useState, useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { Gamepad2, Sparkles, Clock, Bookmark } from "lucide-react";
import { usePublicGames } from "../features/publicGamesApi";
import { publicGameToCard } from "../features/catalog/publicGameAdapter";
import { GameGrid } from "../components/ui/GameGrid";
import { GridColumnSwitcher } from "../components/ui/GridColumnSwitcher";
import { GameSortSelect } from "../components/ui/GameSortSelect";
import { CategoryChips } from "../components/ui/CategoryChips";
import { usePersonalization, useGridColumns } from "../features/personalization";
import { useAuth } from "../features/auth";
import { useI18n } from "../features/i18n/I18nContext";
import { isGameSortKey, sortPublicGameCards, type GameSortKey } from "../features/catalog/gameSort";

export function meta() {
  return [
    { title: "OwOGG — 심심할 틈 없이, 게임을 한곳에" },
    { name: "description", content: "설치 없이 바로 즐기는 가벼운 웹 미니게임 모음 플랫폼" },
  ];
}

export default function Home() {
  const [searchParams] = useSearchParams();
  const initialCategory = searchParams.get("category") || "all";
  const requestedSort = searchParams.get("sort");
  const [selectedCategory, setSelectedCategory] = useState(initialCategory);
  const [sortKey, setSortKey] = useState<GameSortKey>(
    isGameSortKey(requestedSort) ? requestedSort : "popular",
  );
  const { mobileColumns, setMobileColumns, desktopColumns, setDesktopColumns } = useGridColumns();
  const { dict } = useI18n();
  const { games: publicGames } = usePublicGames();
  const gameManifests = useMemo(
    () => publicGames.map((game) => publicGameToCard(game)),
    [publicGames],
  );

  const { favoriteGameIds, recentPlays } = usePersonalization();
  const { isAuthenticated, openLoginModal } = useAuth();

  const handleSelectCategory = (categoryId: string) => {
    if (categoryId === "favorites" && !isAuthenticated) {
      openLoginModal();
      return;
    }
    setSelectedCategory(categoryId);
  };

  // Every list below depends on `gameManifests` and must say so -- sandboxGameManifests only
  // resolves after the first render (its fetch happens in a useEffect), so a memo that reads
  // gameManifests without declaring it as a dependency stays a stale closure over the initial,
  // sandbox-less array forever (the exact bug #16 fixed on /games; missed here initially because
  // this page's four memos were reviewed for correctness only against the *pre-existing* deps
  // they already declared, not re-checked against what changed once gameManifests itself became
  // a value that updates after mount).
  const filteredGames = useMemo(() => {
    if (selectedCategory === "all") return sortPublicGameCards(gameManifests, sortKey);
    if (selectedCategory === "favorites") {
      return sortPublicGameCards(
        gameManifests.filter((game) => favoriteGameIds.includes(game.slug)),
        sortKey,
      );
    }
    return sortPublicGameCards(
      gameManifests.filter((game) => game.categories.includes(selectedCategory)),
      sortKey,
    );
  }, [gameManifests, selectedCategory, favoriteGameIds, sortKey]);

  const recentGames = useMemo(() => {
    return recentPlays
      .map((r) => gameManifests.find((g) => g.slug === r.gameId))
      .filter((g): g is (typeof gameManifests)[0] => Boolean(g))
      .slice(0, 4);
  }, [gameManifests, recentPlays]);

  const favoriteGames = useMemo(() => {
    return favoriteGameIds
      .map((id) => gameManifests.find((g) => g.slug === id))
      .filter((g): g is (typeof gameManifests)[0] => Boolean(g))
      .slice(0, 4);
  }, [gameManifests, favoriteGameIds]);

  return (
    <div className="flex flex-col w-full px-4 md:px-8 py-6 gap-10 max-w-7xl mx-auto flex-1">
      {/* The catalog controls stay together: sort starts at the left edge, while category filters
          use the remaining desktop space from the right. Both selections apply to this discovery
          row and to the complete lineup below. */}
      {gameManifests.length > 0 && (
        <section className="flex flex-col gap-4 w-full">
          <div
            data-testid="game-catalog-toolbar"
            className="flex min-w-0 flex-col gap-3 border-b border-border/40 pb-4 lg:flex-row lg:items-center lg:justify-between"
          >
            <GameSortSelect
              value={sortKey}
              onChange={setSortKey}
              label={dict.games.sortLabel}
              options={dict.games.sortOptions}
            />
            <div className="flex min-w-0 flex-1 justify-end">
              <CategoryChips
                selectedCategory={selectedCategory}
                onSelectCategory={handleSelectCategory}
                className="lg:justify-end"
              />
            </div>
          </div>
          <GameGrid
            games={filteredGames}
            mobileColumns={mobileColumns}
            desktopColumns={desktopColumns}
            maxRows={1}
            emptyMessage={
              selectedCategory === "favorites" ? dict.games.emptyFavorites : dict.home.emptyCategory
            }
          />
        </section>
      )}

      {/* Personalized Section: Recent Plays */}
      {recentGames.length > 0 && (
        <section className="flex flex-col gap-4 w-full">
          <div className="flex items-center gap-2 border-b border-border/40 pb-3">
            <Clock className="w-5 h-5 text-brand" />
            <h3 className="text-xl font-black text-text-primary tracking-tight">
              {dict.home.recentPlaysTitle}
            </h3>
          </div>
          {/* maxRows=1 — this section is a "what you were just playing" preview, not a full
              listing (that's what /profile's recent-plays view is for), so it stays to one row
              regardless of how many columns are currently selected. */}
          <GameGrid
            games={recentGames}
            mobileColumns={mobileColumns}
            desktopColumns={desktopColumns}
            maxRows={1}
          />
        </section>
      )}

      {/* Personalized Section: Favorites */}
      {isAuthenticated && favoriteGames.length > 0 && (
        <section className="flex flex-col gap-4 w-full">
          <div className="flex items-center gap-2 border-b border-border/40 pb-3">
            <Bookmark className="w-5 h-5 text-amber-400 fill-amber-400" />
            <h3 className="text-xl font-black text-text-primary tracking-tight">
              {dict.home.favoritesTitle}
            </h3>
          </div>
          {/* maxRows=2 — same idea as recent plays, just a slightly bigger preview since
              favorites are a more deliberate signal than "recently opened". */}
          <GameGrid
            games={favoriteGames}
            mobileColumns={mobileColumns}
            desktopColumns={desktopColumns}
            maxRows={2}
          />
        </section>
      )}

      {/* Complete catalog for the same sort/category selection shown in the discovery row. */}
      <section className="flex flex-col gap-6 w-full">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-border/60 pb-4 min-w-0">
          <div className="flex items-center gap-2.5">
            <Gamepad2 className="w-6 h-6 text-brand" />
            <h2 className="text-2xl font-black text-text-primary tracking-tight">
              {dict.home.lineupTitle}
            </h2>
          </div>

          <div className="flex w-full min-w-0 items-start sm:w-auto sm:items-center">
            <GridColumnSwitcher
              mobileColumns={mobileColumns}
              onMobileChange={setMobileColumns}
              desktopColumns={desktopColumns}
              onDesktopChange={setDesktopColumns}
            />
          </div>
        </div>

        {/* High Density Game Grid */}
        <GameGrid
          games={filteredGames}
          mobileColumns={mobileColumns}
          desktopColumns={desktopColumns}
          emptyMessage={
            selectedCategory === "favorites" ? dict.games.emptyFavorites : dict.home.emptyCategory
          }
        />
      </section>

      {/* Multiplayer Teaser Banner */}
      <section className="w-full rounded-3xl bg-gradient-to-r from-surface-raised via-surface-overlay to-surface border border-border p-8 md:p-10 flex flex-col md:flex-row items-center justify-between gap-6 shadow-xl relative overflow-hidden">
        <div className="flex flex-col gap-2 z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent-blue/10 border border-accent-blue/30 text-accent-blue font-extrabold text-xs">
            <Sparkles className="w-3.5 h-3.5" />
            <span>COMMUNITY & MULTIPLAYER</span>
          </div>
          <h3 className="text-2xl md:text-3xl font-black text-text-primary">
            {dict.home.teaserTitle}
          </h3>
          <p className="text-sm text-text-secondary">{dict.home.teaserBody}</p>
        </div>

        <Link
          to="/games"
          className="z-10 shrink-0 px-6 py-3 bg-surface-raised border border-border hover:border-brand/40 text-text-primary font-bold text-sm rounded-xl transition-all cursor-pointer"
        >
          {dict.home.teaserCta}
        </Link>
      </section>
    </div>
  );
}
