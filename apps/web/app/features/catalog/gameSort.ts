import type { PublicGameCard } from "./publicGameAdapter";

export const GAME_SORT_KEYS = ["popular", "newest", "players", "bookmarks"] as const;
export type GameSortKey = (typeof GAME_SORT_KEYS)[number];

export function isGameSortKey(value: string | null): value is GameSortKey {
  return value !== null && GAME_SORT_KEYS.includes(value as GameSortKey);
}

function publishedTime(game: PublicGameCard): number {
  const parsed = Date.parse(game.publishedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Returns a copy so filtering memos can safely reuse the unsorted catalog. Every metric sort
 * falls back to server registration time and then slug, keeping ties deterministic. */
export function sortPublicGameCards(
  games: readonly PublicGameCard[],
  sort: GameSortKey,
): PublicGameCard[] {
  return [...games].sort((left, right) => {
    const metricDifference =
      sort === "players"
        ? right.playerCount - left.playerCount
        : sort === "bookmarks"
          ? right.bookmarkCount - left.bookmarkCount
          : sort === "popular"
            ? right.popularityScore - left.popularityScore
            : 0;
    if (metricDifference !== 0) return metricDifference;

    const dateDifference = publishedTime(right) - publishedTime(left);
    if (dateDifference !== 0) return dateDifference;
    return left.slug.localeCompare(right.slug);
  });
}
