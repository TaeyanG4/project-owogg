/** Raw D1-backed engagement counts for one public game slug. Both source tables enforce one row
 * per user/game, so these are unique authenticated players and current unique bookmarks. */
export interface PublicGameMetricCounts {
  readonly slug: string;
  readonly playerCount: number;
  readonly bookmarkCount: number;
}

/** Read-only catalog metric boundary. Implementations must return a row for every requested slug,
 * using zero counts when no engagement row exists. */
export interface PublicGameMetricsRepository {
  findBySlugs(slugs: readonly string[]): Promise<readonly PublicGameMetricCounts[]>;
}
