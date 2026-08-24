import type { PublicGameMetricCounts, PublicGameMetricsRepository } from "@owogg/core";
import type { D1Database } from "./D1UserRepository.js";

const METRIC_QUERY_CHUNK_SIZE = 50;

function mapMetricRow(row: Record<string, unknown>): PublicGameMetricCounts {
  const slug = row.slug;
  const playerCount = Number(row.player_count);
  const bookmarkCount = Number(row.bookmark_count);
  if (typeof slug !== "string" || slug.length === 0) {
    throw new Error(`Invalid public game metric slug: ${String(slug)}`);
  }
  if (!Number.isInteger(playerCount) || playerCount < 0) {
    throw new Error(`Invalid player count for ${slug}: ${String(row.player_count)}`);
  }
  if (!Number.isInteger(bookmarkCount) || bookmarkCount < 0) {
    throw new Error(`Invalid bookmark count for ${slug}: ${String(row.bookmark_count)}`);
  }
  return { slug, playerCount, bookmarkCount };
}

/** Counts directly from the two personalization ledgers. Their composite PKs guarantee one row
 * per user/game, while migration 0040's game-first covering indexes keep each correlated count
 * index-only. Chunking avoids coupling catalog growth to a runtime SQL-variable ceiling. */
export class D1PublicGameMetricsRepository implements PublicGameMetricsRepository {
  constructor(private readonly db: D1Database) {}

  async findBySlugs(slugs: readonly string[]): Promise<readonly PublicGameMetricCounts[]> {
    const uniqueSlugs = Array.from(new Set(slugs.filter((slug) => slug.length > 0)));
    const metrics: PublicGameMetricCounts[] = [];

    for (let offset = 0; offset < uniqueSlugs.length; offset += METRIC_QUERY_CHUNK_SIZE) {
      const chunk = uniqueSlugs.slice(offset, offset + METRIC_QUERY_CHUNK_SIZE);
      const values = chunk.map(() => "(?)").join(", ");
      const rows = await this.db
        .prepare(
          `WITH requested(slug) AS (VALUES ${values})
           SELECT
             requested.slug AS slug,
             (SELECT COUNT(*) FROM user_recent_plays rp WHERE rp.game_id = requested.slug)
               AS player_count,
             (SELECT COUNT(*) FROM user_favorites fav WHERE fav.game_id = requested.slug)
               AS bookmark_count
           FROM requested`,
        )
        .bind(...chunk)
        .all<Record<string, unknown>>();
      metrics.push(...(rows.results || []).map(mapMetricRow));
    }

    return metrics;
  }
}
