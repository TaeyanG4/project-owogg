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
  /** Clips the grid to exactly this many visual rows regardless of column count — used by the
   * home page's 최근 플레이(1 row)/즐겨찾기(2 rows) sections so they read as a compact preview
   * rather than a full section, without needing to know how many columns are currently active
   * (2/3/4 on mobile, 4/5/6 on desktop) to compute an item-count slice. Pure CSS: an explicit
   * `grid-template-rows` sizes the rows we want visible normally, `grid-auto-rows: 0` collapses
   * any further (implicit) rows the extra items would otherwise auto-place into, and
   * overflow-hidden clips the residual. Omit for the full, unclipped grid (e.g. /games). */
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
  maxRows,
}: GameGridProps) {
  const rowClampClass =
    maxRows === 1
      ? "[grid-template-rows:repeat(1,auto)] [grid-auto-rows:0] overflow-hidden"
      : maxRows === 2
        ? "[grid-template-rows:repeat(2,auto)] [grid-auto-rows:0] overflow-hidden"
        : "";

  return (
    <div className={`${GRID_CLASSES[mobileColumns][desktopColumns]} ${rowClampClass}`}>
      {games.map((game) => (
        <GameCard key={game.slug} {...game} />
      ))}

      {games.length === 0 && (loading ? loadingMessage : emptyMessage) && (
        <div className="col-span-full py-16 text-center text-text-muted bg-surface-raised rounded-3xl border border-border border-dashed">
          {loading ? loadingMessage : emptyMessage}
        </div>
      )}
    </div>
  );
}
