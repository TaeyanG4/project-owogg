import type { PublicProfileInsights, PublicProfileInsightsRepository } from "@owogg/core";
import type { D1Database } from "./D1UserRepository.js";

/** Public-only aggregation. Pending/private creator submissions are deliberately excluded so a
 * profile cannot leak moderation state or unpublished slugs. */
export class D1PublicProfileInsightsRepository implements PublicProfileInsightsRepository {
  constructor(private db: D1Database) {}

  async getByUserId(userId: number): Promise<PublicProfileInsights> {
    const row = await this.db
      .prepare(
        `SELECT
           (SELECT COUNT(*)
              FROM profile_contribution_events event
             WHERE event.user_id = ? AND event.contribution_type = 'BUG_ACCEPTED')
             AS bug_accepted_count,
           (SELECT COUNT(*)
              FROM games game
             WHERE game.publisher_type = 'USER' AND game.publisher_user_id = ?
               AND game.deleted_at IS NULL AND game.visibility = 'PUBLIC'
               AND game.live_version_id IS NOT NULL)
             AS created_game_count,
           (SELECT COUNT(*)
              FROM profile_contribution_events event
             WHERE event.user_id = ?
               AND event.contribution_type = 'EXTERNAL_GAME_PUBLISHED')
             AS introduced_external_game_count`,
      )
      .bind(userId, userId, userId)
      .first<Record<string, unknown>>();

    return {
      bugAcceptedCount: Number(row?.bug_accepted_count ?? 0),
      createdGameCount: Number(row?.created_game_count ?? 0),
      introducedExternalGameCount: Number(row?.introduced_external_game_count ?? 0),
    };
  }
}
