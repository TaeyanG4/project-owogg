import type { AccountMergeRepository, MergeChallenge, MergePreview } from "@owogg/core";
import type { D1Database } from "./D1UserRepository.js";

export class D1AccountMergeRepository implements AccountMergeRepository {
  constructor(private db: D1Database) {}

  async getAccountMergePreview(userId: number): Promise<MergePreview> {
    const userRow = await this.db
      .prepare(`SELECT id, nickname, created_at FROM users WHERE id = ?`)
      .bind(userId)
      .first<Record<string, unknown>>();

    const providerRow = await this.db
      .prepare(
        `SELECT provider FROM oauth_accounts WHERE user_id = ? ORDER BY created_at ASC LIMIT 1`,
      )
      .bind(userId)
      .first<{ provider: string }>();

    const scoreCountRow = await this.db
      .prepare(`SELECT COUNT(*) as count FROM scores WHERE user_id = ?`)
      .bind(userId)
      .first<{ count: number }>();

    const favCountRow = await this.db
      .prepare(`SELECT COUNT(*) as count FROM user_favorites WHERE user_id = ?`)
      .bind(userId)
      .first<{ count: number }>();

    const recentCountRow = await this.db
      .prepare(`SELECT COUNT(*) as count FROM user_recent_plays WHERE user_id = ?`)
      .bind(userId)
      .first<{ count: number }>();

    return {
      userId: userRow ? Number(userRow.id) : userId,
      nickname: userRow ? String(userRow.nickname) : "알 수 없음",
      provider: providerRow ? String(providerRow.provider) : "",
      createdAt: userRow ? String(userRow.created_at) : "",
      scoreCount: Number(scoreCountRow?.count ?? 0),
      favoriteCount: Number(favCountRow?.count ?? 0),
      recentPlayCount: Number(recentCountRow?.count ?? 0),
    };
  }

  async createMergeChallenge(input: {
    userA: number;
    userB: number;
    provider: string;
    providerUserId: string;
    ttlSeconds: number;
  }): Promise<{ id: string; expiresAt: string }> {
    const id = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000).toISOString();
    const createdAt = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO account_merge_challenges (id, user_a, user_b, provider, provider_user_id, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.userA,
        input.userB,
        input.provider,
        input.providerUserId,
        createdAt,
        expiresAt,
      )
      .run();
    return { id, expiresAt };
  }

  async findMergeChallenge(id: string): Promise<MergeChallenge | null> {
    const row = await this.db
      .prepare(
        `SELECT id, user_a, user_b, provider, provider_user_id, created_at, expires_at, consumed_at
         FROM account_merge_challenges WHERE id = ?`,
      )
      .bind(id)
      .first<Record<string, unknown>>();
    if (!row) return null;
    return this.mapRow(row);
  }

  async findPendingMergeChallenge(userA: number, userB: number): Promise<MergeChallenge | null> {
    const row = await this.db
      .prepare(
        `SELECT id, user_a, user_b, provider, provider_user_id, created_at, expires_at, consumed_at
         FROM account_merge_challenges
         WHERE ((user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?))
           AND consumed_at IS NULL
         ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(userA, userB, userB, userA)
      .first<Record<string, unknown>>();
    if (!row) return null;
    return this.mapRow(row);
  }

  async findMergeIntegrityConflict(
    primaryId: number,
    secondaryId: number,
  ): Promise<
    | "STREAMER_PLATFORM_CONFLICT"
    | "MULTIPLAYER_PARTICIPATION_CONFLICT"
    | "GAME_CREATOR_REVIEW_CONFLICT"
    | "OAUTH_REGISTRATION_CONFLICT"
    | null
  > {
    const oauthRegistrationRow = await this.db
      .prepare(
        `SELECT 1
         FROM oauth_identity_registrations primary_registration
         JOIN oauth_identity_registrations secondary_registration
           ON secondary_registration.provider = primary_registration.provider
         WHERE primary_registration.registered_user_id = ?
           AND secondary_registration.registered_user_id = ?
         LIMIT 1`,
      )
      .bind(primaryId, secondaryId)
      .first();

    if (oauthRegistrationRow) return "OAUTH_REGISTRATION_CONFLICT";

    const streamerRow = await this.db
      .prepare(
        `SELECT 1
         FROM streamer_platform_accounts secondary_account
         JOIN streamer_profiles secondary_profile
           ON secondary_profile.id = secondary_account.streamer_id
         JOIN streamer_platform_accounts primary_account
           ON primary_account.platform = secondary_account.platform
         JOIN streamer_profiles primary_profile
           ON primary_profile.id = primary_account.streamer_id
         WHERE primary_profile.user_id = ?
           AND secondary_profile.user_id = ?
         LIMIT 1`,
      )
      .bind(primaryId, secondaryId)
      .first();

    if (streamerRow) return "STREAMER_PLATFORM_CONFLICT";

    const creatorReviewRow = await this.db
      .prepare(
        `SELECT 1
         WHERE (
           SELECT COUNT(*)
           FROM games game
           WHERE game.publisher_type = 'USER'
             AND game.publisher_user_id IN (?, ?)
             AND game.review_slot IS NOT NULL
         ) > 2
         OR EXISTS (
           SELECT 1
           FROM games primary_game
           JOIN games secondary_game
             ON secondary_game.review_slot = primary_game.review_slot
           WHERE primary_game.publisher_type = 'USER'
             AND secondary_game.publisher_type = 'USER'
             AND primary_game.publisher_user_id = ?
             AND secondary_game.publisher_user_id = ?
             AND primary_game.review_slot IS NOT NULL
         )
         LIMIT 1`,
      )
      .bind(primaryId, secondaryId, primaryId, secondaryId)
      .first();
    if (creatorReviewRow) return "GAME_CREATOR_REVIEW_CONFLICT";

    const multiplayerRow = await this.db
      .prepare(
        `SELECT 1
         WHERE EXISTS (
           SELECT 1 FROM multiplayer_participants
           WHERE user_id = ? AND status IN ('JOINED', 'READY')
         )
         OR EXISTS (
           SELECT 1 FROM multiplayer_instances
           WHERE created_by_user_id = ?
             AND status NOT IN ('CLOSED', 'ABORTED', 'EXPIRED')
         )
         OR EXISTS (
           SELECT 1 FROM multiplayer_reward_outbox
           WHERE user_id = ? AND status = 'PROCESSING'
         )
         OR EXISTS (
           SELECT 1
           FROM multiplayer_participants primary_participant
           JOIN multiplayer_participants secondary_participant
             ON secondary_participant.instance_id = primary_participant.instance_id
           WHERE primary_participant.user_id = ?
             AND secondary_participant.user_id = ?
         )
         OR EXISTS (
           SELECT 1
           FROM multiplayer_match_players primary_player
           JOIN multiplayer_match_players secondary_player
             ON secondary_player.match_id = primary_player.match_id
           WHERE primary_player.user_id = ?
             AND secondary_player.user_id = ?
         )
         OR EXISTS (
           SELECT 1
           FROM multiplayer_instances primary_instance
           JOIN multiplayer_instances secondary_instance
             ON secondary_instance.create_idempotency_hash =
                primary_instance.create_idempotency_hash
           WHERE primary_instance.created_by_user_id = ?
             AND secondary_instance.created_by_user_id = ?
         )
         LIMIT 1`,
      )
      .bind(
        secondaryId,
        secondaryId,
        secondaryId,
        primaryId,
        secondaryId,
        primaryId,
        secondaryId,
        primaryId,
        secondaryId,
      )
      .first();

    return multiplayerRow ? "MULTIPLAYER_PARTICIPATION_CONFLICT" : null;
  }

  async mergeAccounts(primaryId: number, secondaryId: number, challengeId: string): Promise<void> {
    const integrityConflict = await this.findMergeIntegrityConflict(primaryId, secondaryId);
    if (integrityConflict) {
      throw new Error(integrityConflict);
    }

    // Defense in depth for callers that bypass AccountMergeUseCases. `oauth_accounts.user_id`
    // is immutable, so refuse before scheduling the transactional destructive work below.
    const secondaryOAuth = await this.db
      .prepare(`SELECT 1 FROM oauth_accounts WHERE user_id = ? LIMIT 1`)
      .bind(secondaryId)
      .first();
    if (secondaryOAuth) {
      throw new Error("OAUTH_IDENTITY_OWNER_IMMUTABLE");
    }

    // Primary-Wins atomic merge. D1 batch runs all statements as a single transaction:
    // secondary gameplay/personalization/progression/sessions are deleted (never unioned
    // into primary), identity-like Discord/Streamer relationships are remapped safely, and the
    // identity-less secondary user is deleted. The derived Discord guild ledger is explicitly removed before its source XP
    // events so the invariant does not depend only on a database FK pragma being enabled.
    const statements = [
      this.db
        .prepare(
          `DELETE FROM discord_guild_xp_events
           WHERE user_id = ?
              OR source_xp_event_id IN (SELECT id FROM xp_events WHERE user_id = ?)`,
        )
        .bind(secondaryId, secondaryId),
      this.db.prepare(`DELETE FROM scores WHERE user_id = ?`).bind(secondaryId),
      this.db.prepare(`DELETE FROM user_favorites WHERE user_id = ?`).bind(secondaryId),
      this.db.prepare(`DELETE FROM user_recent_plays WHERE user_id = ?`).bind(secondaryId),
      this.db.prepare(`DELETE FROM xp_events WHERE user_id = ?`).bind(secondaryId),
      this.db.prepare(`DELETE FROM user_progress WHERE user_id = ?`).bind(secondaryId),
      this.db.prepare(`DELETE FROM user_achievements WHERE user_id = ?`).bind(secondaryId),
      this.db.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(secondaryId),
      this.db
        .prepare(
          `UPDATE discord_guilds SET registered_by_user_id = ? WHERE registered_by_user_id = ?`,
        )
        .bind(primaryId, secondaryId),
      this.db
        .prepare(
          `INSERT OR IGNORE INTO discord_guild_managers
             (guild_id, user_id, role, created_at, updated_at)
           SELECT guild_id, ?, role, created_at, updated_at
           FROM discord_guild_managers WHERE user_id = ?`,
        )
        .bind(primaryId, secondaryId),
      this.db.prepare(`DELETE FROM discord_guild_managers WHERE user_id = ?`).bind(secondaryId),
      this.db
        .prepare(`UPDATE discord_server_registration_challenges SET user_id = ? WHERE user_id = ?`)
        .bind(primaryId, secondaryId),
      this.db
        .prepare(`UPDATE discord_play_contexts SET user_id = ? WHERE user_id = ?`)
        .bind(primaryId, secondaryId),
      // If Primary already has a Streamer profile, keep its presentation/settings row and
      // move Secondary's platform accounts. Review jobs and audit rows retain their account
      // IDs, so their history remains coherent. If Primary has no profile, transfer the
      // Secondary profile row itself instead.
      this.db
        .prepare(
          `UPDATE streamer_platform_accounts
           SET streamer_id = (SELECT id FROM streamer_profiles WHERE user_id = ?)
           WHERE streamer_id = (SELECT id FROM streamer_profiles WHERE user_id = ?)
             AND EXISTS (SELECT 1 FROM streamer_profiles WHERE user_id = ?)`,
        )
        .bind(primaryId, secondaryId, primaryId),
      this.db
        .prepare(
          `DELETE FROM streamer_profiles
           WHERE user_id = ?
             AND EXISTS (SELECT 1 FROM streamer_profiles WHERE user_id = ?)`,
        )
        .bind(secondaryId, primaryId),
      this.db
        .prepare(
          `UPDATE streamer_profiles
           SET user_id = ?
           WHERE user_id = ?
             AND NOT EXISTS (SELECT 1 FROM streamer_profiles WHERE user_id = ?)`,
        )
        .bind(primaryId, secondaryId, primaryId),
      // Game Creator authority is identity-like. Preserve Secondary's access only when Primary
      // has none, then move every USER-owned game through the legacy control-plane table so its
      // convergence trigger updates generic `games` in the same transaction.
      this.db
        .prepare(
          `DELETE FROM game_creator_access
           WHERE user_id = ?
             AND EXISTS (SELECT 1 FROM game_creator_access WHERE user_id = ?)`,
        )
        .bind(secondaryId, primaryId),
      this.db
        .prepare(
          `UPDATE game_creator_access SET user_id = ?, updated_at = datetime('now')
           WHERE user_id = ?
             AND NOT EXISTS (SELECT 1 FROM game_creator_access WHERE user_id = ?)`,
        )
        .bind(primaryId, secondaryId, primaryId),
      this.db
        .prepare(`UPDATE sandbox_games SET developer_user_id = ? WHERE developer_user_id = ?`)
        .bind(primaryId, secondaryId),
      // Defensive convergence for a generic USER row that has no legacy control-plane row.
      this.db
        .prepare(
          `UPDATE games SET publisher_user_id = ?
           WHERE publisher_type = 'USER' AND publisher_user_id = ?
             AND NOT EXISTS (SELECT 1 FROM sandbox_games WHERE sandbox_games.id = games.id)`,
        )
        .bind(primaryId, secondaryId),
      this.db
        .prepare(
          `UPDATE multiplayer_profile_requests
           SET requested_by_user_id = ?
           WHERE requested_by_user_id = ?`,
        )
        .bind(primaryId, secondaryId),
      this.db
        .prepare(
          `UPDATE multiplayer_instances
           SET created_by_user_id = ?
           WHERE created_by_user_id = ?`,
        )
        .bind(primaryId, secondaryId),
      this.db
        .prepare(`UPDATE multiplayer_participants SET user_id = ? WHERE user_id = ?`)
        .bind(primaryId, secondaryId),
      this.db
        .prepare(
          `UPDATE multiplayer_invites SET created_by_user_id = ? WHERE created_by_user_id = ?`,
        )
        .bind(primaryId, secondaryId),
      // Social relationships are public identity data, not gameplay aggregates. Preserve their
      // union while removing edges that would become self-follows and deduplicating overlaps.
      this.db
        .prepare(
          `INSERT OR IGNORE INTO user_follows
             (follower_user_id, followed_user_id, created_at)
           SELECT ?, followed_user_id, created_at
             FROM user_follows
            WHERE follower_user_id = ? AND followed_user_id <> ?`,
        )
        .bind(primaryId, secondaryId, primaryId),
      this.db
        .prepare(
          `INSERT OR IGNORE INTO user_follows
             (follower_user_id, followed_user_id, created_at)
           SELECT follower_user_id, ?, created_at
             FROM user_follows
            WHERE followed_user_id = ? AND follower_user_id <> ?`,
        )
        .bind(primaryId, secondaryId, primaryId),
      this.db
        .prepare(
          `DELETE FROM user_follows
            WHERE follower_user_id = ? OR followed_user_id = ?`,
        )
        .bind(secondaryId, secondaryId),
    ];
    statements.push(
      this.db
        .prepare(
          `UPDATE account_merge_challenges
           SET consumed_at = datetime('now')
           WHERE id = ? AND consumed_at IS NULL`,
        )
        .bind(challengeId),
    );
    statements.push(this.db.prepare(`DELETE FROM users WHERE id = ?`).bind(secondaryId));
    await this.db.batch(statements);
  }

  private mapRow(row: Record<string, unknown>): MergeChallenge {
    return {
      id: String(row.id),
      userA: Number(row.user_a),
      userB: Number(row.user_b),
      provider: String(row.provider),
      providerUserId: String(row.provider_user_id),
      expiresAt: String(row.expires_at),
      consumedAt: row.consumed_at ? String(row.consumed_at) : null,
    };
  }
}
