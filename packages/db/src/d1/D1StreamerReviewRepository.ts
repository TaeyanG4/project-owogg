import type {
  StreamerReviewJob,
  StreamerReviewJobStatus,
  StreamerReviewRepository,
  StreamerReviewType,
} from "@owogg/core";
import type { D1Database } from "./D1UserRepository.js";

function mapReviewRow(row: Record<string, unknown>): StreamerReviewJob {
  return {
    id: Number(row.id),
    streamerPlatformAccountId: Number(row.streamer_platform_account_id),
    reviewType: String(row.review_type) as StreamerReviewType,
    status: String(row.work_state) as StreamerReviewJobStatus,
    dueAt: String(row.due_at),
    policyVersion: Number(row.policy_version),
    publicReasonCode: row.public_reason_code ? String(row.public_reason_code) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
    rowVersion: Number(row.row_version ?? 0),
  };
}

/**
 * User-facing Streamer connection flow only needs to create the first manual review. All staff
 * queue queries and mutations live in D1StreamerAdminRepository so there is one authority for
 * claim/hold/decision concurrency.
 */
export class D1StreamerReviewRepository implements StreamerReviewRepository {
  constructor(private db: D1Database) {}

  async findActiveJobByAccountId(
    streamerPlatformAccountId: number,
  ): Promise<StreamerReviewJob | null> {
    const row = await this.db
      .prepare(
        `SELECT * FROM streamer_platform_reviews
         WHERE streamer_platform_account_id = ?
           AND work_state IN ('QUEUED', 'ON_HOLD')
         ORDER BY id DESC LIMIT 1`,
      )
      .bind(streamerPlatformAccountId)
      .first<Record<string, unknown>>();
    return row ? mapReviewRow(row) : null;
  }

  async createOwnershipReview(input: {
    streamerPlatformAccountId: number;
    reviewType: "INITIAL" | "OWNERSHIP_REVERIFY";
    dueAt: string;
    policyVersion: number;
    evidenceJson: string;
    nowIso: string;
  }): Promise<StreamerReviewJob> {
    const existing = await this.findActiveJobByAccountId(input.streamerPlatformAccountId);
    if (existing) return existing;

    await this.db
      .prepare(
        `INSERT INTO streamer_platform_reviews
           (streamer_platform_account_id, parent_review_id, review_type, requested_by,
            work_state, decision_code, priority, due_at, claimed_by_user_id, claim_expires_at,
            hold_until, public_reason_code, internal_note, policy_version, evidence_json,
            created_at, updated_at, completed_at, row_version, last_correlation_id)
         SELECT ?, NULL, ?, 'USER', 'QUEUED', NULL, 'NORMAL', ?, NULL, NULL, NULL,
                NULL, NULL, ?, ?, ?, ?, NULL, 0, NULL
         WHERE NOT EXISTS (
           SELECT 1 FROM streamer_platform_reviews
           WHERE streamer_platform_account_id = ?
             AND work_state IN ('QUEUED', 'ON_HOLD')
         )`,
      )
      .bind(
        input.streamerPlatformAccountId,
        input.reviewType,
        input.dueAt,
        input.policyVersion,
        input.evidenceJson,
        input.nowIso,
        input.nowIso,
        input.streamerPlatformAccountId,
      )
      .run();

    const created = await this.findActiveJobByAccountId(input.streamerPlatformAccountId);
    if (created) return created;
    throw new Error("Failed to create platform Streamer review");
  }
}
