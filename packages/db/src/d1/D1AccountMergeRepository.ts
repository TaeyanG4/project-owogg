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
  ): Promise<"STREAMER_PLATFORM_CONFLICT" | null> {
    const row = await this.db
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

    return row ? "STREAMER_PLATFORM_CONFLICT" : null;
  }

  async mergeAccounts(primaryId: number, secondaryId: number, challengeId: string): Promise<void> {
    const integrityConflict = await this.findMergeIntegrityConflict(primaryId, secondaryId);
    if (integrityConflict) {
      throw new Error(integrityConflict);
    }

    // Primary-Wins atomic merge. D1 batch runs all statements as a single transaction:
    // secondary gameplay/personalization/progression/sessions are deleted (never unioned
    // into primary), identity-like Discord/Streamer relationships are remapped safely,
    // secondary OAuth identities are transferred to the primary, and the secondary user is
    // deleted. The derived Discord guild ledger is explicitly removed before its source XP
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
      this.db
        .prepare(`UPDATE oauth_accounts SET user_id = ? WHERE user_id = ?`)
        .bind(primaryId, secondaryId),
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
