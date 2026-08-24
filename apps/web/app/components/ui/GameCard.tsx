import { Link } from "react-router";
import { Play, Sparkles, Bookmark, Users } from "lucide-react";
import { usePersonalization } from "../../features/personalization";
import { useI18n } from "../../features/i18n/I18nContext";
import { GameThumbnail } from "./GameThumbnail";
import type { PublicGameCard } from "../../features/catalog/publicGameAdapter";

export type GameCardProps = Pick<
  PublicGameCard,
  | "slug"
  | "title"
  | "shortDescription"
  | "modes"
  | "thumbnail"
  | "accent"
  | "publisherName"
  | "playerCount"
  | "bookmarkCount"
>;

function compactCount(value: number): string {
  if (value < 1_000) return String(value);
  if (value < 1_000_000) {
    const thousands = value / 1_000;
    return `${thousands >= 10 ? Math.floor(thousands) : thousands.toFixed(1).replace(/\.0$/, "")}K`;
  }
  const millions = value / 1_000_000;
  return `${millions >= 10 ? Math.floor(millions) : millions.toFixed(1).replace(/\.0$/, "")}M`;
}

/** Every provider-neutral public game card enters the same generic GameHost route. */
export function gameCardHref(slug: string): string {
  return `/games/${slug}`;
}

export function GameCard({
  slug,
  title,
  shortDescription,
  modes,
  thumbnail,
  publisherName,
  playerCount,
  bookmarkCount,
  accent = "#6366f1",
}: GameCardProps) {
  const { isFavorite, toggleFavorite } = usePersonalization();
  const { dict } = useI18n();
  const isFav = isFavorite(slug);

  const handleFavoriteClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    toggleFavorite(slug);
  };

  const favoriteAriaLabel = isFav
    ? `${dict.games.removeFavoriteAriaPrefix}${title}${dict.games.removeFavoriteAriaSuffix}`
    : `${dict.games.addFavoriteAriaPrefix}${title}${dict.games.addFavoriteAriaSuffix}`;

  return (
    <div className="group relative flex flex-col bg-surface-raised rounded-2xl overflow-hidden border border-border/80 hover:border-brand/50 transition-all duration-300 hover:-translate-y-1.5 hover:shadow-2xl hover:shadow-brand/10 select-none">
      {/* Top Favorite Action Button */}
      <button
        type="button"
        onClick={handleFavoriteClick}
        aria-label={favoriteAriaLabel}
        aria-pressed={isFav}
        className="absolute top-1.5 right-1.5 sm:top-3 sm:right-3 z-30 p-1.5 sm:p-2 rounded-full bg-black/60 hover:bg-black/90 text-white transition-all backdrop-blur-md border border-white/10 hover:scale-110 active:scale-95 cursor-pointer"
      >
        <Bookmark
          className={`w-3.5 h-3.5 sm:w-4 sm:h-4 transition-colors ${
            isFav ? "fill-amber-400 text-amber-400" : "text-white/80 hover:text-white"
          }`}
        />
      </button>

      <Link to={gameCardHref(slug)} className="flex flex-col flex-1">
        {/* Thumbnail Aspect 16:9 */}
        <div
          className="w-full aspect-[16/10] relative flex items-center justify-center p-3 sm:p-6 overflow-hidden bg-surface-overlay"
          style={{
            background: `radial-gradient(circle at center, ${accent}25 0%, rgba(15, 19, 31, 0.95) 100%)`,
          }}
        >
          {/* Top Badges */}
          <div className="absolute top-1.5 left-1.5 sm:top-3 sm:left-3 z-10 flex gap-1 sm:gap-1.5">
            {modes.slice(0, 2).map((mode) => (
              <span
                key={mode}
                className="text-[8px] sm:text-[10px] uppercase font-extrabold px-1.5 sm:px-2 py-0.5 rounded-md bg-black/60 text-white backdrop-blur-md border border-white/10 tracking-wider"
              >
                {mode}
              </span>
            ))}
          </div>

          {/* Thumbnail Visual */}
          <GameThumbnail
            thumbnail={thumbnail}
            title={title}
            accent={accent}
            className="w-14 h-14 sm:w-24 sm:h-24 shadow-xl transform group-hover:scale-110 transition-transform duration-300 text-base sm:text-xl"
          />

          {/* Hover Play Action Overlay */}
          <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center z-20">
            <div className="w-12 h-12 rounded-full bg-brand text-white flex items-center justify-center shadow-lg shadow-brand/40 transform scale-75 group-hover:scale-100 transition-transform duration-200">
              <Play className="w-6 h-6 fill-current ml-0.5" />
            </div>
          </div>
        </div>

        {/* Content Info */}
        <div className="p-2.5 sm:p-4 flex flex-col flex-1 gap-1 sm:gap-1.5 bg-surface-raised">
          <div className="flex items-start justify-between gap-1.5 sm:gap-2">
            {/* break-keep (word-break: keep-all) stops Korean titles from splitting mid-word
                (e.g. "속도로" -> "속" + "도로") in narrow high-density grid columns. */}
            <h3 className="break-keep font-bold text-xs sm:text-base leading-snug text-text-primary group-hover:text-brand transition-colors">
              {title}
            </h3>
            <Sparkles className="w-4 h-4 text-brand-light opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5 hidden sm:block" />
          </div>

          <p className="break-keep text-[10px] sm:text-xs text-text-secondary line-clamp-2 leading-relaxed flex-1">
            {shortDescription}
          </p>
          <div className="flex min-w-0 items-center justify-between gap-2 text-[9px] font-semibold text-text-muted sm:text-[10px]">
            <p className="min-w-0 flex-1 truncate">제작자 {publisherName}</p>
            <div className="flex shrink-0 items-center gap-2 tabular-nums">
              <span
                className="inline-flex items-center gap-0.5"
                title={`${dict.games.playerCountLabel}: ${playerCount.toLocaleString()}`}
                aria-label={`${dict.games.playerCountLabel}: ${playerCount.toLocaleString()}`}
              >
                <Users aria-hidden="true" className="h-3 w-3" />
                {compactCount(playerCount)}
              </span>
              <span
                className="inline-flex items-center gap-0.5"
                title={`${dict.games.bookmarkCountLabel}: ${bookmarkCount.toLocaleString()}`}
                aria-label={`${dict.games.bookmarkCountLabel}: ${bookmarkCount.toLocaleString()}`}
              >
                <Bookmark aria-hidden="true" className="h-3 w-3" />
                {compactCount(bookmarkCount)}
              </span>
            </div>
          </div>
        </div>
      </Link>
    </div>
  );
}
