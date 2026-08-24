import { Bookmark, Users } from "lucide-react";
import { Link } from "react-router";
import type { PublicGameCard } from "../../features/catalog/publicGameAdapter";
import { GameThumbnail } from "../ui/GameThumbnail";

interface GameRecommendationsProps {
  title: string;
  emptyLabel: string;
  games: readonly PublicGameCard[];
}

function compactCount(value: number): string {
  if (value < 1_000) return String(value);
  return `${Math.floor(value / 100) / 10}K`;
}

export function GameRecommendations({ title, emptyLabel, games }: GameRecommendationsProps) {
  return (
    <section aria-labelledby="recommended-games-title" className="min-w-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="recommended-games-title" className="text-base font-black text-text-primary">
          {title}
        </h2>
        <span className="text-[10px] font-black uppercase tracking-[0.16em] text-brand-light">
          Up next
        </span>
      </div>

      {games.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface-raised px-4 py-8 text-center text-xs text-text-muted">
          {emptyLabel}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {games.map((game) => (
            <Link
              key={game.slug}
              to={`/games/${game.slug}`}
              className="group grid min-w-0 grid-cols-[7.5rem_minmax(0,1fr)] gap-3 rounded-xl p-1.5 transition-colors hover:bg-surface-raised"
            >
              <div
                className="relative flex aspect-video items-center justify-center overflow-hidden rounded-xl border border-border/70 bg-surface-overlay"
                style={{
                  background: `radial-gradient(circle at center, ${game.accent ?? "#6366f1"}25 0%, rgba(15, 19, 31, 0.96) 100%)`,
                }}
              >
                <div className="h-[78%] w-[78%]">
                  <GameThumbnail
                    thumbnail={game.thumbnail}
                    title={game.title}
                    accent={game.accent}
                    className="h-full w-full transition-transform duration-300 group-hover:scale-105"
                    rounded="rounded-lg"
                  />
                </div>
              </div>

              <div className="flex min-w-0 flex-col justify-center py-0.5">
                <h3 className="line-clamp-2 text-sm font-extrabold leading-snug text-text-primary group-hover:text-brand-light">
                  {game.title}
                </h3>
                <p className="mt-1 truncate text-[11px] font-semibold text-text-muted">
                  {game.publisherName}
                </p>
                <div className="mt-1.5 flex items-center gap-3 text-[10px] font-bold text-text-muted tabular-nums">
                  <span className="inline-flex items-center gap-1">
                    <Users aria-hidden="true" className="h-3 w-3" />
                    {compactCount(game.playerCount)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Bookmark aria-hidden="true" className="h-3 w-3" />
                    {compactCount(game.bookmarkCount)}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
