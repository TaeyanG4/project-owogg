import type { StreamerPlatformType, StreamerVerificationIntentRepository } from "@owogg/core";
import type { D1Database } from "./D1UserRepository.js";
import { hashSessionToken } from "./D1SessionRepository.js";

/**
 * Server-side, single-use OAuth intent store. Browser-visible state and session credentials are
 * hashed before persistence so a D1 read cannot be turned into a usable callback credential.
 */
export class D1StreamerVerificationIntentRepository implements StreamerVerificationIntentRepository {
  constructor(private db: D1Database) {}

  async create(input: {
    state: string;
    userId: number;
    sessionToken: string;
    platform: StreamerPlatformType;
    createdAt: string;
    expiresAt: string;
  }): Promise<void> {
    const [stateHash, sessionTokenHash] = await Promise.all([
      hashSessionToken(input.state),
      hashSessionToken(input.sessionToken),
    ]);

    await this.db.batch([
      this.db
        .prepare(
          `DELETE FROM streamer_verification_intents
           WHERE expires_at <= ?`,
        )
        .bind(input.createdAt),
      this.db
        .prepare(
          `INSERT INTO streamer_verification_intents
             (state_hash, user_id, session_token_hash, platform, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          stateHash,
          input.userId,
          sessionTokenHash,
          input.platform,
          input.createdAt,
          input.expiresAt,
        ),
    ]);
  }

  async consume(input: {
    state: string;
    userId: number;
    sessionToken: string;
    platform: StreamerPlatformType;
    consumedAt: string;
  }): Promise<boolean> {
    const [stateHash, sessionTokenHash] = await Promise.all([
      hashSessionToken(input.state),
      hashSessionToken(input.sessionToken),
    ]);
    const row = await this.db
      .prepare(
        `DELETE FROM streamer_verification_intents
         WHERE state_hash = ?
           AND user_id = ?
           AND session_token_hash = ?
           AND platform = ?
           AND expires_at > ?
         RETURNING state_hash`,
      )
      .bind(stateHash, input.userId, sessionTokenHash, input.platform, input.consumedAt)
      .first<{ state_hash: string }>();

    return Boolean(row);
  }
}
