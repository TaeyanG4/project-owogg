import type {
  PublicGameMetricCounts,
  PublicGameMetricsRepository,
} from "../ports/publicGameMetrics.js";
import {
  emptyPublicGameStats,
  toPublicGameStats,
  type PublicGameStats,
} from "../modules/game/domain/publicGame.js";

/** Catalog-facing metric projection. Keeping the popularity formula here makes API, Web and any
 * future Discord consumer agree instead of each inventing a different "popular" ranking. */
export class PublicGameMetricsUseCases {
  constructor(private readonly repository: PublicGameMetricsRepository) {}

  async getBySlugs(slugs: readonly string[]): Promise<ReadonlyMap<string, PublicGameStats>> {
    const uniqueSlugs = Array.from(new Set(slugs.filter((slug) => slug.length > 0)));
    if (uniqueSlugs.length === 0) return new Map();

    const rows = await this.repository.findBySlugs(uniqueSlugs);
    const requested = new Set(uniqueSlugs);
    const result = new Map<string, PublicGameStats>(
      uniqueSlugs.map((slug) => [slug, emptyPublicGameStats()]),
    );

    for (const row of rows) {
      if (!requested.has(row.slug)) continue;
      result.set(row.slug, this.toStats(row));
    }
    return result;
  }

  private toStats(row: PublicGameMetricCounts): PublicGameStats {
    return toPublicGameStats({
      playerCount: row.playerCount,
      bookmarkCount: row.bookmarkCount,
    });
  }
}
