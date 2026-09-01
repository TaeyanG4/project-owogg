import { GameCard, type GameCardProps } from "./GameCard";
import type { MobileColumns, DesktopColumns } from "../../features/personalization/useGridColumns";

/** Static class strings per (mobile, desktop) column pair — Tailwind can't see dynamically-built
 * class names, so every combination has to be spelled out literally. Below `lg` uses the mobile
 * setting, `lg` and up uses the desktop setting — collapses the tablet range into whichever of
 * the two reads more naturally at that width rather than adding a third independently
 * configurable tier. */
const GRID_CLASSES: Record<MobileColumns, Record<DesktopColumns, string>> = {
  2: {
    4: "grid grid-cols-2 lg:grid-cols-4 gap-4",
    5: "grid grid-cols-2 lg:grid-cols-5 gap-4",
    6: "grid grid-cols-2 lg:grid-cols-6 gap-3",
  },
  3: {
    4: "grid grid-cols-3 lg:grid-cols-4 gap-4",
    5: "grid grid-cols-3 lg:grid-cols-5 gap-4",
    6: "grid grid-cols-3 lg:grid-cols-6 gap-3",
  },
  4: {
    4: "grid grid-cols-4 lg:grid-cols-4 gap-3",
    5: "grid grid-cols-4 lg:grid-cols-5 gap-3",
    6: "grid grid-cols-4 lg:grid-cols-6 gap-3",
  },
};

interface GameGridProps {
  games: readonly GameCardProps[];
  mobileColumns: MobileColumns;
  desktopColumns: DesktopColumns;
  emptyMessage?: React.ReactNode;
  loading?: boolean;
  loadingMessage?: React.ReactNode;
  showDescriptions?: boolean;
  /** Renders at most this many rows. Mobile and desktop slices are rendered in mutually exclusive
   * breakpoint containers so cards beyond the limit do not remain hidden-but-focusable. */
  maxRows?: 1 | 2;
}

/** Shared grid used by every page that lists game cards (home sections, /games catalog). Keeping
 * this in one place is what lets the column-count switchers and future layout tweaks apply
 * everywhere at once as the game catalog grows, instead of drifting per-page. */
export function GameGrid({
  games,
  mobileColumns,
  desktopColumns,
  emptyMessage,
  loading = false,
  loadingMessage,
  showDescriptions = true,
  maxRows,
}: GameGridProps) {
  const renderCards = (visibleGames: readonly GameCardProps[]) =>
    visibleGames.map((game) => (
      <GameCard key={game.slug} {...game} showDescription={showDescriptions} />
    ));

  const emptyState = games.length === 0 && (loading ? loadingMessage : emptyMessage) && (
    <div className="col-span-full py-16 text-center text-text-muted bg-surface-raised rounded-3xl border border-border border-dashed">
      {loading ? loadingMessage : emptyMessage}
    </div>
  );

  if (maxRows !== undefined) {
    const mobileGames = games.slice(0, mobileColumns * maxRows);
    const desktopGames = games.slice(0, desktopColumns * maxRows);

    return (
      <>
        <div className={`${GRID_CLASSES[mobileColumns][desktopColumns]} lg:hidden`}>
          {renderCards(mobileGames)}
          {emptyState}
        </div>
        <div className={`${GRID_CLASSES[mobileColumns][desktopColumns]} hidden lg:grid`}>
          {renderCards(desktopGames)}
          {emptyState}
        </div>
      </>
    );
  }

  return (
    <div className={GRID_CLASSES[mobileColumns][desktopColumns]}>
      {renderCards(games)}
      {emptyState}
    </div>
  );
}
