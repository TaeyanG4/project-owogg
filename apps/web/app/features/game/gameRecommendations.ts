import type { PublicGameCard } from "../catalog/publicGameAdapter";

function sharedCount(left: readonly string[], right: readonly string[]): number {
  const rightValues = new Set(right);
  return left.reduce((count, value) => count + (rightValues.has(value) ? 1 : 0), 0);
}

/**
 * Recommendation policy for the play-page rail. Similar subject matter wins first, then real
 * public engagement and registration time break ties. This deliberately consumes the same
 * provider-neutral public catalog as every other game surface; it never restores a static list.
 */
export function selectRecommendedGameCards(
  catalog: readonly PublicGameCard[],
  current: PublicGameCard | undefined,
  limit = 6,
): PublicGameCard[] {
  if (!current || limit <= 0) return [];

  return catalog
    .filter((candidate) => candidate.slug !== current.slug)
    .map((candidate) => {
      const relevance =
        (current.genre && current.genre === candidate.genre ? 6 : 0) +
        sharedCount(current.categories, candidate.categories) * 5 +
        sharedCount(current.tags, candidate.tags) * 2 +
        sharedCount(current.modes, candidate.modes);
      return { candidate, relevance };
    })
    .sort((left, right) => {
      if (left.relevance !== right.relevance) return right.relevance - left.relevance;
      if (left.candidate.popularityScore !== right.candidate.popularityScore) {
        return right.candidate.popularityScore - left.candidate.popularityScore;
      }
      const dateDifference =
        Date.parse(right.candidate.publishedAt) - Date.parse(left.candidate.publishedAt);
      if (Number.isFinite(dateDifference) && dateDifference !== 0) return dateDifference;
      return left.candidate.slug.localeCompare(right.candidate.slug);
    })
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}
