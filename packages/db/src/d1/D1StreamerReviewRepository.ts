import type {
  StreamerManualReviewDecisionResult,
  StreamerManualReviewItem,
  StreamerPlatformType,
  StreamerReviewAction,
  StreamerReviewAuditLog,
  StreamerReviewAuditResult,
  StreamerReviewJob,
  StreamerReviewJobStatus,
  StreamerReviewMetricSnapshot,
  StreamerReviewQueueResult,
  StreamerReviewRepository,
  StreamerReviewType,
} from "@owogg/core";
import type { D1Database } from "./D1UserRepository.js";

const ACQUISITION_ACTIVE_STATUSES = "'AUTO_REVIEW_PENDING', 'FAILED_RETRYABLE'";
const REVALIDATION_ACTIVE_STATUSES = "'REVALIDATION_PENDING', 'REVALIDATION_FAILED_RETRYABLE'";
const ALL_ACTIVE_STATUSES = `${ACQUISITION_ACTIVE_STATUSES}, ${REVALIDATION_ACTIVE_STATUSES}`;

function mapReviewJobRow(r: Record<string, unknown>): StreamerReviewJob {
  return {
    id: Number(r.id),
    streamerPlatformAccountId: Number(r.streamer_platform_account_id),
    reviewType: String(r.review_type ?? "ACQUISITION") as StreamerReviewType,
    status: String(r.status) as StreamerReviewJobStatus,
    initialAudience:
      r.initial_audience !== null && r.initial_audience !== undefined
        ? Number(r.initial_audience)
        : null,
    initialChannelCreatedAt: r.initial_channel_created_at
      ? String(r.initial_channel_created_at)
      : null,
    nextCheckAt: String(r.next_check_at),
    attemptCount: Number(r.attempt_count ?? 0),
    lastError: r.last_error ? String(r.last_error) : null,
    reviewReason: r.review_reason ? String(r.review_reason) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    completedAt: r.completed_at ? String(r.completed_at) : null,
  };
}

const MANUAL_REVIEW_SELECT = `
  SELECT
    rj.*,
    u.id AS review_user_id,
    u.nickname AS review_nickname,
    cp.id AS review_streamer_id,
    cp.status AS review_streamer_status,
    cp.featured_status AS review_featured_status,
    cpa.id AS review_account_id,
    cpa.streamer_id AS review_account_streamer_id,
    cpa.platform AS review_platform,
    cpa.platform_user_id AS review_platform_user_id,
    cpa.channel_name AS review_channel_name,
    cpa.channel_handle AS review_channel_handle,
    cpa.channel_url AS review_channel_url,
    cpa.avatar_url AS review_avatar_url,
    cpa.verification_status AS review_verification_status,
    cpa.verified_at AS review_verified_at,
    cpa.audience_count AS review_audience_count,
    cpa.audience_count_known AS review_audience_count_known,
    cpa.channel_created_at AS review_channel_created_at,
    cpa.metrics_synced_at AS review_metrics_synced_at,
    cpa.created_at AS review_account_created_at,
    cpa.updated_at AS review_account_updated_at
  FROM streamer_review_jobs rj
  JOIN streamer_platform_accounts cpa ON cpa.id = rj.streamer_platform_account_id
  JOIN streamer_profiles cp ON cp.id = cpa.streamer_id
  JOIN users u ON u.id = cp.user_id
`;

function mapManualReviewRow(row: Record<string, unknown>): StreamerManualReviewItem {
  return {
    job: mapReviewJobRow(row),
    userId: Number(row.review_user_id),
    nickname: String(row.review_nickname),
    streamerId: Number(row.review_streamer_id),
    streamerStatus: String(
      row.review_streamer_status,
    ) as StreamerManualReviewItem["streamerStatus"],
    featuredStatus: String(
      row.review_featured_status,
    ) as StreamerManualReviewItem["featuredStatus"],
    platformAccount: {
      id: Number(row.review_account_id),
      streamerId: Number(row.review_account_streamer_id),
      platform: String(row.review_platform) as StreamerPlatformType,
      platformUserId: String(row.review_platform_user_id),
      channelName: String(row.review_channel_name),
      channelHandle: row.review_channel_handle ? String(row.review_channel_handle) : null,
      channelUrl: String(row.review_channel_url),
      avatarUrl: row.review_avatar_url ? String(row.review_avatar_url) : null,
      verificationStatus: String(row.review_verification_status),
      verifiedAt: row.review_verified_at ? String(row.review_verified_at) : null,
      // audience_count_known distinguishes "official API confirmed zero" from "never obtained".
      audienceCount:
        Number(row.review_audience_count_known) === 1
          ? Number(row.review_audience_count ?? 0)
          : null,
      channelCreatedAt: row.review_channel_created_at
        ? String(row.review_channel_created_at)
        : null,
      metricsSyncedAt: row.review_metrics_synced_at ? String(row.review_metrics_synced_at) : null,
      createdAt: String(row.review_account_created_at),
      updatedAt: String(row.review_account_updated_at),
    },
  };
}

function mapAuditRow(row: Record<string, unknown>): StreamerReviewAuditLog {
  let metricSnapshot: StreamerReviewMetricSnapshot | null = null;
  if (typeof row.metric_snapshot_json === "string") {
    try {
      const parsed = JSON.parse(row.metric_snapshot_json) as StreamerReviewMetricSnapshot;
      if (parsed && typeof parsed === "object") metricSnapshot = parsed;
    } catch {
      metricSnapshot = null;
    }
  }

  return {
    id: Number(row.id),
    streamerPlatformAccountId: Number(row.streamer_platform_account_id),
    reviewJobId:
      row.streamer_review_job_id === null || row.streamer_review_job_id === undefined
        ? null
        : Number(row.streamer_review_job_id),
    reviewerUserId: Number(row.reviewer_user_id),
    action: String(row.action) as StreamerReviewAction,
    reason: String(row.reason),
    previousStatus: String(row.previous_status) as StreamerReviewJobStatus,
    newStatus: String(row.new_status) as StreamerReviewJobStatus,
    metricSnapshot,
    createdAt: String(row.created_at),
    platform: row.audit_platform ? (String(row.audit_platform) as StreamerPlatformType) : undefined,
    channelName: row.audit_channel_name ? String(row.audit_channel_name) : undefined,
  };
}

export class D1StreamerReviewRepository implements StreamerReviewRepository {
  constructor(private db: D1Database) {}

  async findLatestJobByAccountIds(
    streamerPlatformAccountIds: number[],
  ): Promise<StreamerReviewJob | null> {
    if (streamerPlatformAccountIds.length === 0) return null;

    const placeholders = streamerPlatformAccountIds.map(() => "?").join(",");
    const row = await this.db
      .prepare(
        `SELECT * FROM streamer_review_jobs
         WHERE streamer_platform_account_id IN (${placeholders})
         ORDER BY updated_at DESC, id DESC LIMIT 1`,
      )
      .bind(...streamerPlatformAccountIds)
      .first<Record<string, unknown>>();

    return row ? mapReviewJobRow(row) : null;
  }

  async findActiveJobByAccountId(
    streamerPlatformAccountId: number,
  ): Promise<StreamerReviewJob | null> {
    const row = await this.db
      .prepare(
        `SELECT * FROM streamer_review_jobs
         WHERE streamer_platform_account_id = ?
           AND review_type = 'ACQUISITION'
           AND status IN (${ACQUISITION_ACTIVE_STATUSES})
         ORDER BY id DESC LIMIT 1`,
      )
      .bind(streamerPlatformAccountId)
      .first<Record<string, unknown>>();

    return row ? mapReviewJobRow(row) : null;
  }

  async findLatestRevalidationJobByAccountId(
    streamerPlatformAccountId: number,
  ): Promise<StreamerReviewJob | null> {
    const row = await this.db
      .prepare(
        `SELECT * FROM streamer_review_jobs
         WHERE streamer_platform_account_id = ? AND review_type = 'REVALIDATION'
         ORDER BY id DESC LIMIT 1`,
      )
      .bind(streamerPlatformAccountId)
      .first<Record<string, unknown>>();

    return row ? mapReviewJobRow(row) : null;
  }

  async createOrResetJob(input: {
    streamerPlatformAccountId: number;
    initialAudience: number | null;
    initialChannelCreatedAt: string | null;
    nextCheckAt: string;
  }): Promise<StreamerReviewJob> {
    const now = new Date().toISOString();
    const existing = await this.findActiveJobByAccountId(input.streamerPlatformAccountId);

    if (existing) {
      await this.db
        .prepare(
          `UPDATE streamer_review_jobs
           SET status = 'AUTO_REVIEW_PENDING',
               initial_audience = ?, initial_channel_created_at = ?,
               next_check_at = ?, attempt_count = 0, last_error = NULL,
               review_reason = NULL, completed_at = NULL, updated_at = ?
           WHERE id = ? AND review_type = 'ACQUISITION'`,
        )
        .bind(
          input.initialAudience,
          input.initialChannelCreatedAt,
          input.nextCheckAt,
          now,
          existing.id,
        )
        .run();

      const updated = await this.db
        .prepare(`SELECT * FROM streamer_review_jobs WHERE id = ?`)
        .bind(existing.id)
        .first<Record<string, unknown>>();
      if (updated) return mapReviewJobRow(updated);
      return { ...existing, status: "AUTO_REVIEW_PENDING", updatedAt: now, reviewReason: null };
    }

    await this.db
      .prepare(
        `INSERT INTO streamer_review_jobs
         (streamer_platform_account_id, review_type, status, initial_audience,
          initial_channel_created_at, next_check_at, attempt_count, last_error,
          review_reason, created_at, updated_at, completed_at)
         VALUES (?, 'ACQUISITION', 'AUTO_REVIEW_PENDING', ?, ?, ?, 0, NULL, NULL, ?, ?, NULL)`,
      )
      .bind(
        input.streamerPlatformAccountId,
        input.initialAudience,
        input.initialChannelCreatedAt,
        input.nextCheckAt,
        now,
        now,
      )
      .run();

    const row = await this.db
      .prepare(`SELECT * FROM streamer_review_jobs WHERE rowid = last_insert_rowid()`)
      .first<Record<string, unknown>>();
    if (row) return mapReviewJobRow(row);

    const created = await this.db
      .prepare(
        `SELECT * FROM streamer_review_jobs
         WHERE streamer_platform_account_id = ? AND review_type = 'ACQUISITION'
         ORDER BY id DESC LIMIT 1`,
      )
      .bind(input.streamerPlatformAccountId)
      .first<Record<string, unknown>>();
    if (created) return mapReviewJobRow(created);

    throw new Error("Failed to create streamer review job");
  }

  async scheduleRevalidationJob(input: {
    streamerPlatformAccountId: number;
    nextCheckAt: string;
    nowIso: string;
  }): Promise<StreamerReviewJob> {
    const existing = await this.findLatestRevalidationJobByAccountId(
      input.streamerPlatformAccountId,
    );
    if (
      existing &&
      (existing.status === "REVALIDATION_PENDING" ||
        existing.status === "REVALIDATION_FAILED_RETRYABLE" ||
        existing.status === "MANUAL_REVIEW")
    ) {
      return existing;
    }

    await this.db
      .prepare(
        `INSERT INTO streamer_review_jobs
         (streamer_platform_account_id, review_type, status, initial_audience,
          initial_channel_created_at, next_check_at, attempt_count, last_error,
          review_reason, created_at, updated_at, completed_at)
         SELECT id, 'REVALIDATION', 'REVALIDATION_PENDING', audience_count,
                channel_created_at, ?, 0, NULL, NULL, ?, ?, NULL
         FROM streamer_platform_accounts WHERE id = ?`,
      )
      .bind(input.nextCheckAt, input.nowIso, input.nowIso, input.streamerPlatformAccountId)
      .run();

    const created = await this.findLatestRevalidationJobByAccountId(
      input.streamerPlatformAccountId,
    );
    if (created) return created;
    throw new Error("Failed to create streamer revalidation job");
  }

  async ensureRevalidationJobs(
    limit: number,
    nextCheckAt: string,
    nowIso: string,
  ): Promise<number> {
    const bounded = Math.min(Math.max(limit, 1), 100);
    const result = await this.db
      .prepare(
        `INSERT INTO streamer_review_jobs
         (streamer_platform_account_id, review_type, status, initial_audience,
          initial_channel_created_at, next_check_at, attempt_count, last_error,
          review_reason, created_at, updated_at, completed_at)
         SELECT cpa.id, 'REVALIDATION', 'REVALIDATION_PENDING', cpa.audience_count,
                cpa.channel_created_at, ?, 0, NULL, NULL, ?, ?, NULL
         FROM streamer_platform_accounts cpa
         JOIN streamer_profiles cp ON cp.id = cpa.streamer_id
         WHERE cp.featured_status = 'FEATURED'
           AND cpa.verification_status = 'VERIFIED'
           AND NOT EXISTS (
             SELECT 1 FROM streamer_review_jobs existing
             WHERE existing.streamer_platform_account_id = cpa.id
               AND existing.review_type = 'REVALIDATION'
               AND (
                 existing.status IN (${REVALIDATION_ACTIVE_STATUSES})
                 OR existing.status = 'MANUAL_REVIEW'
               )
           )
         LIMIT ?`,
      )
      .bind(nextCheckAt, nowIso, nowIso, bounded)
      .run();
    return Number(result.meta?.changes ?? 0);
  }

  async listDuePendingJobs(limit: number, nowIso: string): Promise<StreamerReviewJob[]> {
    const bounded = Math.min(Math.max(limit, 1), 100);
    const res = await this.db
      .prepare(
        `SELECT * FROM streamer_review_jobs
         WHERE review_type = 'ACQUISITION'
           AND status IN (${ACQUISITION_ACTIVE_STATUSES})
           AND next_check_at <= ?
         ORDER BY next_check_at ASC, id ASC LIMIT ?`,
      )
      .bind(nowIso, bounded)
      .all<Record<string, unknown>>();

    return (res.results || []).map(mapReviewJobRow);
  }

  async listDueRevalidationJobs(limit: number, nowIso: string): Promise<StreamerReviewJob[]> {
    const bounded = Math.min(Math.max(limit, 1), 100);
    const res = await this.db
      .prepare(
        `SELECT * FROM streamer_review_jobs
         WHERE review_type = 'REVALIDATION'
           AND status IN (${REVALIDATION_ACTIVE_STATUSES})
           AND next_check_at <= ?
         ORDER BY next_check_at ASC, id ASC LIMIT ?`,
      )
      .bind(nowIso, bounded)
      .all<Record<string, unknown>>();

    return (res.results || []).map(mapReviewJobRow);
  }

  async markJobFailed(
    id: number,
    error: string,
    nextCheckAt: string,
    nowIso: string,
  ): Promise<void> {
    await this.db
      .prepare(
        `UPDATE streamer_review_jobs
         SET status = CASE
           WHEN review_type = 'REVALIDATION' THEN 'REVALIDATION_FAILED_RETRYABLE'
           ELSE 'FAILED_RETRYABLE'
         END,
         last_error = ?, next_check_at = ?,
         review_reason = CASE
           WHEN review_type = 'REVALIDATION' THEN '자동 재검증 일시 실패 — 재시도 대기'
           ELSE review_reason
         END,
         attempt_count = attempt_count + 1, updated_at = ?
         WHERE id = ? AND status IN (${ALL_ACTIVE_STATUSES})`,
      )
      .bind(error, nextCheckAt, nowIso, id)
      .run();
  }

  async completeJob(
    id: number,
    status: Exclude<
      StreamerReviewJobStatus,
      | "AUTO_REVIEW_PENDING"
      | "FAILED_RETRYABLE"
      | "REVALIDATION_PENDING"
      | "REVALIDATION_FAILED_RETRYABLE"
    >,
    completedAt: string,
    reason?: string,
  ): Promise<boolean> {
    const res = await this.db
      .prepare(
        `UPDATE streamer_review_jobs
         SET status = ?, last_error = NULL,
             review_reason = COALESCE(?, review_reason),
             completed_at = ?, updated_at = ?
         WHERE id = ? AND status IN (${ALL_ACTIVE_STATUSES})`,
      )
      .bind(status, reason ?? null, completedAt, completedAt, id)
      .run();

    return Boolean(res.meta?.changes && Number(res.meta.changes) > 0);
  }

  async listManualReviewQueue(limit: number, offset: number): Promise<StreamerReviewQueueResult> {
    const boundedLimit = Math.min(Math.max(limit, 1), 50);
    const boundedOffset = Math.max(offset, 0);
    const countRow = await this.db
      .prepare(`SELECT COUNT(*) AS total FROM streamer_review_jobs WHERE status = 'MANUAL_REVIEW'`)
      .first<{ total: number }>();
    const rows = await this.db
      .prepare(
        `${MANUAL_REVIEW_SELECT}
         WHERE rj.status = 'MANUAL_REVIEW'
         ORDER BY rj.updated_at ASC, rj.id ASC
         LIMIT ? OFFSET ?`,
      )
      .bind(boundedLimit, boundedOffset)
      .all<Record<string, unknown>>();

    return {
      items: (rows.results || []).map(mapManualReviewRow),
      total: Number(countRow?.total ?? 0),
    };
  }

  async listAuditLogs(limit: number, offset: number): Promise<StreamerReviewAuditResult> {
    const boundedLimit = Math.min(Math.max(limit, 1), 100);
    const boundedOffset = Math.max(offset, 0);
    const countRow = await this.db
      .prepare(`SELECT COUNT(*) AS total FROM streamer_review_audit_log`)
      .first<{ total: number }>();
    const rows = await this.db
      .prepare(
        `SELECT audit.*, cpa.platform AS audit_platform, cpa.channel_name AS audit_channel_name
         FROM streamer_review_audit_log audit
         LEFT JOIN streamer_platform_accounts cpa
           ON cpa.id = audit.streamer_platform_account_id
         ORDER BY audit.created_at DESC, audit.id DESC
         LIMIT ? OFFSET ?`,
      )
      .bind(boundedLimit, boundedOffset)
      .all<Record<string, unknown>>();

    return {
      entries: (rows.results || []).map(mapAuditRow),
      total: Number(countRow?.total ?? 0),
    };
  }

  private async findManualReviewItemByJobId(
    jobId: number,
  ): Promise<StreamerManualReviewItem | null> {
    const row = await this.db
      .prepare(
        `${MANUAL_REVIEW_SELECT}
         WHERE rj.id = ? LIMIT 1`,
      )
      .bind(jobId)
      .first<Record<string, unknown>>();
    return row ? mapManualReviewRow(row) : null;
  }

  async applyManualReviewDecision(input: {
    jobId: number;
    reviewerUserId: number;
    action: StreamerReviewAction;
    reason: string;
    publicProfileReason: string;
    nextRevalidationAt: string;
    nowIso: string;
  }): Promise<StreamerManualReviewDecisionResult> {
    const item = await this.findManualReviewItemByJobId(input.jobId);
    if (!item) {
      return {
        applied: false,
        code: "NOT_FOUND",
        previousStatus: null,
        newStatus: null,
      };
    }
    if (item.job.status !== "MANUAL_REVIEW") {
      return {
        applied: false,
        code: "ALREADY_DECIDED",
        previousStatus: item.job.status,
        newStatus: item.job.status,
      };
    }
    if (
      input.action === "APPROVE_FEATURED" &&
      (item.streamerStatus !== "VERIFIED" || item.platformAccount.verificationStatus !== "VERIFIED")
    ) {
      return {
        applied: false,
        code: "OWNERSHIP_NOT_VERIFIED",
        previousStatus: item.job.status,
        newStatus: item.job.status,
      };
    }

    if (input.action === "KEEP_FOR_REVIEW") {
      const duplicate = await this.db
        .prepare(
          `SELECT id FROM streamer_review_audit_log
           WHERE streamer_review_job_id = ? AND reviewer_user_id = ?
             AND action = ? AND reason = ? LIMIT 1`,
        )
        .bind(input.jobId, input.reviewerUserId, input.action, input.reason)
        .first<{ id: number }>();
      if (duplicate) {
        return {
          applied: false,
          code: "ALREADY_APPLIED",
          previousStatus: item.job.status,
          newStatus: item.job.status,
        };
      }
    }

    const newStatus: StreamerReviewJobStatus =
      input.action === "APPROVE_FEATURED"
        ? "FEATURED"
        : input.action === "REJECT_FEATURED"
          ? "NOT_ELIGIBLE"
          : "MANUAL_REVIEW";
    const metricSnapshot = JSON.stringify({
      platform: item.platformAccount.platform,
      channelName: item.platformAccount.channelName,
      channelUrl: item.platformAccount.channelUrl,
      verificationStatus: item.platformAccount.verificationStatus,
      audienceCount: item.platformAccount.audienceCount ?? null,
      channelCreatedAt: item.platformAccount.channelCreatedAt ?? null,
      metricsSyncedAt: item.platformAccount.metricsSyncedAt ?? null,
    } satisfies StreamerReviewMetricSnapshot);

    const statements = [
      this.db
        .prepare(
          `UPDATE streamer_review_jobs
           SET status = ?, review_reason = ?, last_error = NULL,
               completed_at = ?, updated_at = ?
           WHERE id = ? AND status = 'MANUAL_REVIEW'`,
        )
        .bind(
          newStatus,
          input.reason,
          input.action === "KEEP_FOR_REVIEW" ? null : input.nowIso,
          input.nowIso,
          input.jobId,
        ),
    ];

    if (input.action !== "KEEP_FOR_REVIEW") {
      const nextFeaturedStatus = input.action === "APPROVE_FEATURED" ? "FEATURED" : "NONE";
      statements.push(
        this.db
          .prepare(
            `UPDATE streamer_profiles
             SET featured_status = ?, featured_reason = ?,
                 featured_since = CASE
                   WHEN ? = 'FEATURED' THEN COALESCE(featured_since, ?)
                   ELSE NULL
                 END,
                 updated_at = ?
             WHERE id = ?`,
          )
          .bind(
            nextFeaturedStatus,
            input.publicProfileReason,
            nextFeaturedStatus,
            input.nowIso,
            input.nowIso,
            item.streamerId,
          ),
      );
    }

    statements.push(
      this.db
        .prepare(
          `INSERT INTO streamer_review_audit_log
           (streamer_platform_account_id, streamer_review_job_id, reviewer_user_id,
            action, reason, previous_status, new_status, metric_snapshot_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          item.platformAccount.id,
          input.jobId,
          input.reviewerUserId,
          input.action,
          input.reason,
          item.job.status,
          newStatus,
          metricSnapshot,
          input.nowIso,
        ),
    );

    if (input.action === "APPROVE_FEATURED") {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO streamer_review_jobs
             (streamer_platform_account_id, review_type, status, initial_audience,
              initial_channel_created_at, next_check_at, attempt_count, last_error,
              review_reason, created_at, updated_at, completed_at)
             SELECT ?, 'REVALIDATION', 'REVALIDATION_PENDING', audience_count,
                    channel_created_at, ?, 0, NULL, NULL, ?, ?, NULL
             FROM streamer_platform_accounts
             WHERE id = ?
               AND NOT EXISTS (
                 SELECT 1 FROM streamer_review_jobs existing
                 WHERE existing.streamer_platform_account_id = ?
                   AND existing.review_type = 'REVALIDATION'
                   AND (
                     existing.status IN (${REVALIDATION_ACTIVE_STATUSES})
                     OR existing.status = 'MANUAL_REVIEW'
                   )
               )`,
          )
          .bind(
            item.platformAccount.id,
            input.nextRevalidationAt,
            input.nowIso,
            input.nowIso,
            item.platformAccount.id,
            item.platformAccount.id,
          ),
      );
    }

    const results = (await this.db.batch(statements)) as Array<{
      meta?: { changes?: number };
    }>;
    const applied = Number(results[0]?.meta?.changes ?? 0) > 0;
    if (!applied) {
      return {
        applied: false,
        code: "ALREADY_DECIDED",
        previousStatus: item.job.status,
        newStatus: item.job.status,
      };
    }

    return {
      applied: true,
      previousStatus: item.job.status,
      newStatus,
    };
  }
}
