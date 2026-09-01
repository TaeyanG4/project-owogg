import { useMemo, useState } from "react";
import { Link } from "react-router";
import { ArrowRight, Bookmark, Clock, Gamepad2 } from "lucide-react";
import { usePublicGames } from "../features/publicGamesApi";
import { publicGameToCard } from "../features/catalog/publicGameAdapter";
import { GameGrid } from "../components/ui/GameGrid";
import { GridColumnSwitcher } from "../components/ui/GridColumnSwitcher";
import { GameSortSelect } from "../components/ui/GameSortSelect";
import { GameDescriptionToggle } from "../components/ui/GameDescriptionToggle";
import { usePersonalization, useGridColumns } from "../features/personalization";
import { useAuth } from "../features/auth";
import { useI18n } from "../features/i18n/I18nContext";
import { sortPublicGameCards, type GameSortKey } from "../features/catalog/gameSort";

export function meta() {
  return [
    { title: "OwOGG — 심심할 틈 없이, 게임을 한곳에" },
    { name: "description", content: "설치 없이 바로 즐기는 가벼운 웹 미니게임 모음 플랫폼" },
  ];
}

export default function Home() {
  const [sortKey, setSortKey] = useState<GameSortKey>("popular");
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
  const gameCards = useMemo(
    () => publicGames.map((game) => publicGameToCard(game, locale)),
    [locale, publicGames],
  );
  const discoveryGames = useMemo(
    () => sortPublicGameCards(gameCards, sortKey),
    [gameCards, sortKey],
  );
  const { favoriteGameIds, recentPlays } = usePersonalization();
  const { isAuthenticated } = useAuth();

  const recentGames = useMemo(
    () =>
      recentPlays
        .map((recent) => gameCards.find((game) => game.slug === recent.gameId))
        .filter((game): game is (typeof gameCards)[number] => Boolean(game)),
    [gameCards, recentPlays],
  );
  const favoriteGames = useMemo(
    () =>
      favoriteGameIds
        .map((id) => gameCards.find((game) => game.slug === id))
        .filter((game): game is (typeof gameCards)[number] => Boolean(game)),
    [favoriteGameIds, gameCards],
  );

  const displayControls = (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-2.5">
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
      <GameDescriptionToggle
        showDescriptions={showDescriptions}
        onChange={setShowDescriptions}
        showLabel={dict.games.showDescriptions}
        hideLabel={dict.games.hideDescriptions}
      />
    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-10 px-4 py-6 sm:px-6 lg:px-8 xl:px-10">
      <section className="flex w-full flex-col gap-5">
        <div
          data-testid="game-catalog-toolbar"
          className="flex min-w-0 flex-col gap-4 border-b border-border/60 pb-4 lg:flex-row lg:items-center lg:justify-between"
        >
          <div className="flex items-center gap-2.5">
            <Gamepad2 className="h-6 w-6 text-brand" aria-hidden="true" />
            <h1 className="text-2xl font-black tracking-tight text-text-primary">
              {dict.home.browseGames}
            </h1>
          </div>
          {displayControls}
        </div>

        <GameGrid
          games={discoveryGames}
          mobileColumns={mobileColumns}
          desktopColumns={desktopColumns}
          maxRows={2}
          showDescriptions={showDescriptions}
          loading={isLoading}
          loadingMessage={<span role="status">{dict.common.loading}</span>}
          emptyMessage={dict.home.emptyCategory}
        />

        {gameCards.length > 0 && (
          <Link
            to="/games"
            className="ml-auto inline-flex items-center gap-1.5 text-sm font-bold text-brand-light transition-colors hover:text-text-primary"
          >
            {dict.sidebar.allGames}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        )}
      </section>

      {recentGames.length > 0 && (
        <section className="flex w-full flex-col gap-4">
          <div className="flex items-center gap-2 border-b border-border/40 pb-3">
            <Clock className="h-5 w-5 text-brand" aria-hidden="true" />
            <h2 className="text-xl font-black tracking-tight text-text-primary">
              {dict.home.recentPlaysTitle}
            </h2>
          </div>
          <GameGrid
            games={recentGames}
            mobileColumns={mobileColumns}
            desktopColumns={desktopColumns}
            maxRows={2}
            showDescriptions={showDescriptions}
          />
        </section>
      )}

      {isAuthenticated && favoriteGames.length > 0 && (
        <section className="flex w-full flex-col gap-4">
          <div className="flex items-center gap-2 border-b border-border/40 pb-3">
            <Bookmark className="h-5 w-5 fill-amber-400 text-amber-400" aria-hidden="true" />
            <h2 className="text-xl font-black tracking-tight text-text-primary">
              {dict.home.favoritesTitle}
            </h2>
          </div>
          <GameGrid
            games={favoriteGames}
            mobileColumns={mobileColumns}
            desktopColumns={desktopColumns}
            maxRows={2}
            showDescriptions={showDescriptions}
          />
        </section>
      )}
    </div>
  );
}
