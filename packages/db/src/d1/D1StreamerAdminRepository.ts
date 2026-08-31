import type {
  StreamerAdminActionInput,
  StreamerAdminActionResult,
  StreamerAdminAuditEntry,
  StreamerAdminEvidence,
  StreamerAdminPage,
  StreamerAdminPlatformAccount,
  StreamerAdminRepository,
  StreamerAdminReviewItem,
  StreamerAdminRosterItem,
  StreamerAdminWorkspaceQuery,
  StreamerAdminWorkspaceSnapshot,
  StreamerPlatformAccount,
  StreamerPlatformType,
  StreamerPolicyConstraint,
  StreamerPolicyField,
  StreamerPolicyValues,
  StreamerPolicyVersion,
  StreamerProviderSetting,
} from "@owogg/core";
import type { D1Database, D1PreparedStatement } from "./D1UserRepository.js";

const ACTIVE_REVIEW_STATES = "'QUEUED', 'ON_HOLD'";
const MANAGED_STREAMER_PLATFORMS_SQL = "'YOUTUBE', 'CHZZK', 'TWITCH'";
const STREAMER_POLICY_FIELDS = [
  "minimumAudience",
  "minimumChannelAgeDays",
  "ownershipValidityDays",
  "reverificationNoticeDays",
  "verificationIntentTtlMinutes",
  "claimLeaseMinutes",
  "reviewSlaHours",
  "holdDefaultHours",
  "reconsiderationCooldownDays",
  "providerTimeoutSeconds",
] as const satisfies readonly StreamerPolicyField[];

function pageResult<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: 10 | 20 | 30 | 50,
): StreamerAdminPage<T> {
  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

function offsetFor(page: number, pageSize: number) {
  return (Math.max(page, 1) - 1) * pageSize;
}

function maskCanonicalId(value: unknown): string {
  const raw = String(value ?? "");
  return raw.length <= 4 ? `••••${raw}` : `••••${raw.slice(-4)}`;
}

function ownershipStatus(
  row: Record<string, unknown>,
): StreamerAdminPlatformAccount["verificationStatus"] {
  const stored = String(row.verification_status ?? "UNVERIFIED");
  if (stored === "REJECTED") return "INVALIDATED";
  if (
    stored === "VERIFIED" &&
    (!row.ownership_expires_at ||
      new Date(String(row.ownership_expires_at)).getTime() <= Date.now())
  ) {
    return "EXPIRED";
  }
  return stored === "VERIFIED" ? "VERIFIED" : "UNVERIFIED";
}

function mapAdminAccount(row: Record<string, unknown>): StreamerAdminPlatformAccount {
  return {
    id: Number(row.id ?? row.account_id),
    platform: String(row.platform ?? row.account_platform) as StreamerPlatformType,
    maskedCanonicalId: maskCanonicalId(row.platform_user_id ?? row.account_platform_user_id),
    channelName: String(row.channel_name ?? row.account_channel_name),
    channelHandle:
      (row.channel_handle ?? row.account_channel_handle)
        ? String(row.channel_handle ?? row.account_channel_handle)
        : null,
    channelUrl: String(row.channel_url ?? row.account_channel_url),
    avatarUrl:
      (row.avatar_url ?? row.account_avatar_url)
        ? String(row.avatar_url ?? row.account_avatar_url)
        : null,
    verificationStatus: ownershipStatus({
      verification_status: row.verification_status ?? row.account_verification_status,
      ownership_expires_at: row.ownership_expires_at ?? row.account_ownership_expires_at,
    }),
    verifiedAt:
      (row.verified_at ?? row.account_verified_at)
        ? String(row.verified_at ?? row.account_verified_at)
        : null,
    ownershipExpiresAt:
      (row.ownership_expires_at ?? row.account_ownership_expires_at)
        ? String(row.ownership_expires_at ?? row.account_ownership_expires_at)
        : null,
    approvalStatus: String(
      row.approval_status ?? row.account_approval_status ?? "PENDING",
    ) as StreamerAdminPlatformAccount["approvalStatus"],
    approvalReasonCode:
      (row.approval_reason_code ?? row.account_approval_reason_code)
        ? String(row.approval_reason_code ?? row.account_approval_reason_code)
        : null,
    approvedAt:
      (row.approved_at ?? row.account_approved_at)
        ? String(row.approved_at ?? row.account_approved_at)
        : null,
    audienceCount:
      Number(row.audience_count_known ?? row.account_audience_count_known) === 1
        ? Number(row.audience_count ?? row.account_audience_count ?? 0)
        : null,
    channelCreatedAt:
      (row.channel_created_at ?? row.account_channel_created_at)
        ? String(row.channel_created_at ?? row.account_channel_created_at)
        : null,
    metricsSyncedAt:
      (row.metrics_synced_at ?? row.account_metrics_synced_at)
        ? String(row.metrics_synced_at ?? row.account_metrics_synced_at)
        : null,
    rowVersion: Number(row.row_version ?? row.account_row_version ?? 0),
  };
}

function channelAgeDays(createdAt: string | null, nowIso: string): number | null {
  if (!createdAt) return null;
  const created = new Date(createdAt).getTime();
  const now = new Date(nowIso).getTime();
  if (!Number.isFinite(created) || created > now) return null;
  return Math.floor((now - created) / 86_400_000);
}

function buildEvidence(
  account: StreamerAdminPlatformAccount,
  policy: StreamerPolicyVersion,
  observedAt: string,
): StreamerAdminEvidence {
  const age = channelAgeDays(account.channelCreatedAt, observedAt);
  return {
    observedAt,
    policyVersion: policy.version,
    audienceCount: account.audienceCount,
    channelAgeDays: age,
    metricsSyncedAt: account.metricsSyncedAt,
    conditions: [
      {
        field: "OWNERSHIP",
        result: account.verificationStatus === "VERIFIED" ? "PASS" : "FAIL",
        actual: null,
        required: null,
        unit: null,
        reasonCode:
          account.verificationStatus === "VERIFIED"
            ? "OWNERSHIP_VERIFIED"
            : "OWNERSHIP_NOT_VERIFIED",
      },
      {
        field: "AUDIENCE",
        result:
          account.audienceCount === null
            ? "UNKNOWN"
            : account.audienceCount >= policy.values.minimumAudience
              ? "PASS"
              : "FAIL",
        actual: account.audienceCount,
        required: policy.values.minimumAudience,
        unit: "PEOPLE",
        reasonCode:
          account.audienceCount === null
            ? "AUDIENCE_UNKNOWN"
            : account.audienceCount >= policy.values.minimumAudience
              ? "AUDIENCE_MEETS_POLICY"
              : "AUDIENCE_BELOW_POLICY",
      },
      {
        field: "CHANNEL_AGE",
        result:
          age === null ? "UNKNOWN" : age >= policy.values.minimumChannelAgeDays ? "PASS" : "FAIL",
        actual: age,
        required: policy.values.minimumChannelAgeDays,
        unit: "DAYS",
        reasonCode:
          age === null
            ? "CHANNEL_AGE_UNKNOWN"
            : age >= policy.values.minimumChannelAgeDays
              ? "CHANNEL_AGE_MEETS_POLICY"
              : "CHANNEL_AGE_BELOW_POLICY",
      },
      {
        field: "PROVIDER_CONTRACT",
        result: "UNKNOWN",
        actual: null,
        required: null,
        unit: null,
        reasonCode: "MANUAL_PROVIDER_REVIEW",
      },
    ],
  };
}

function parsePolicyValues(raw: unknown): StreamerPolicyValues {
  const value = JSON.parse(String(raw)) as Record<string, unknown>;
  return {
    minimumAudience: Number(value.minimumAudience),
    minimumChannelAgeDays: Number(value.minimumChannelAgeDays),
    ownershipValidityDays: Number(value.ownershipValidityDays),
    reverificationNoticeDays: Number(value.reverificationNoticeDays),
    verificationIntentTtlMinutes: Number(value.verificationIntentTtlMinutes),
    claimLeaseMinutes: Number(value.claimLeaseMinutes),
    reviewSlaHours: Number(value.reviewSlaHours),
    holdDefaultHours: Number(value.holdDefaultHours),
    reconsiderationCooldownDays: Number(value.reconsiderationCooldownDays),
    providerTimeoutSeconds: Number(value.providerTimeoutSeconds),
  };
}

function mapPolicy(row: Record<string, unknown>): StreamerPolicyVersion {
  return {
    version: Number(row.version),
    values: parsePolicyValues(row.values_json),
    reason: String(row.reason),
    updatedAt: String(row.updated_at),
    updatedBy: row.updated_by_nickname ? String(row.updated_by_nickname) : "SYSTEM",
  };
}

function mapConstraint(row: Record<string, unknown>): StreamerPolicyConstraint {
  return {
    field: String(row.field) as StreamerPolicyField,
    unit: String(row.unit) as StreamerPolicyConstraint["unit"],
    minimum: Number(row.minimum),
    maximum: Number(row.maximum),
    step: Number(row.step),
  };
}

function policyValuesMatchConstraints(
  values: StreamerPolicyValues,
  constraints: StreamerPolicyConstraint[],
): boolean {
  const rawValues = values as unknown as Record<string, unknown>;
  const providedFields = Object.keys(rawValues);
  if (
    providedFields.length !== STREAMER_POLICY_FIELDS.length ||
    providedFields.some((field) => !STREAMER_POLICY_FIELDS.includes(field as StreamerPolicyField))
  ) {
    return false;
  }

  const byField = new Map(constraints.map((constraint) => [constraint.field, constraint]));
  if (constraints.length !== STREAMER_POLICY_FIELDS.length || byField.size !== constraints.length) {
    return false;
  }

  for (const field of STREAMER_POLICY_FIELDS) {
    const value = rawValues[field];
    const constraint = byField.get(field);
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      !constraint ||
      value < constraint.minimum ||
      value > constraint.maximum ||
      (value - constraint.minimum) % constraint.step !== 0
    ) {
      return false;
    }
  }

  return values.reverificationNoticeDays < values.ownershipValidityDays;
}

const REVIEW_SELECT = `
  SELECT
    review.*,
    profile.id AS review_streamer_id,
    profile.user_id AS review_user_id,
    applicant.nickname AS review_nickname,
    account.id AS account_id,
    account.platform AS account_platform,
    account.platform_user_id AS account_platform_user_id,
    account.channel_name AS account_channel_name,
    account.channel_handle AS account_channel_handle,
    account.channel_url AS account_channel_url,
    account.avatar_url AS account_avatar_url,
    account.verification_status AS account_verification_status,
    account.verified_at AS account_verified_at,
    account.ownership_expires_at AS account_ownership_expires_at,
    account.approval_status AS account_approval_status,
    account.approval_reason_code AS account_approval_reason_code,
    account.approved_at AS account_approved_at,
    account.audience_count AS account_audience_count,
    account.audience_count_known AS account_audience_count_known,
    account.channel_created_at AS account_channel_created_at,
    account.metrics_synced_at AS account_metrics_synced_at,
    account.row_version AS account_row_version,
    claimant.nickname AS claimant_nickname,
    review_policy.values_json AS review_policy_values_json,
    review_policy.reason AS review_policy_reason,
    review_policy.updated_at AS review_policy_updated_at,
    review_policy_actor.nickname AS review_policy_updated_by_nickname
  FROM streamer_platform_reviews review
  JOIN streamer_platform_accounts account
    ON account.id = review.streamer_platform_account_id
  JOIN streamer_profiles profile ON profile.id = account.streamer_id
  JOIN users applicant ON applicant.id = profile.user_id
  LEFT JOIN users claimant ON claimant.id = review.claimed_by_user_id
  JOIN streamer_policy_versions review_policy ON review_policy.version = review.policy_version
  LEFT JOIN users review_policy_actor ON review_policy_actor.id = review_policy.updated_by_user_id
`;

function mapReviewPolicy(row: Record<string, unknown>): StreamerPolicyVersion {
  return {
    version: Number(row.policy_version),
    values: parsePolicyValues(row.review_policy_values_json),
    reason: String(row.review_policy_reason),
    updatedAt: String(row.review_policy_updated_at),
    updatedBy: row.review_policy_updated_by_nickname
      ? String(row.review_policy_updated_by_nickname)
      : "SYSTEM",
  };
}

function parseStoredEvidence(
  row: Record<string, unknown>,
  account: StreamerAdminPlatformAccount,
  policy: StreamerPolicyVersion,
  generatedAt: string,
): StreamerAdminEvidence {
  if (typeof row.evidence_json === "string") {
    try {
      const value = JSON.parse(row.evidence_json) as StreamerAdminEvidence;
      if (value && typeof value === "object" && Array.isArray(value.conditions)) return value;
    } catch {
      // Fall back to a current, sanitized snapshot for legacy or malformed rows.
    }
  }
  return buildEvidence(account, policy, generatedAt);
}

function mapReview(row: Record<string, unknown>, generatedAt: string): StreamerAdminReviewItem {
  const account = mapAdminAccount(row);
  const policy = mapReviewPolicy(row);
  const claimActive =
    (String(row.work_state) === "QUEUED" || String(row.work_state) === "ON_HOLD") &&
    Boolean(row.claimed_by_user_id) &&
    Boolean(row.claim_expires_at) &&
    new Date(String(row.claim_expires_at)).getTime() > new Date(generatedAt).getTime();
  return {
    id: Number(row.id),
    parentReviewId: row.parent_review_id ? Number(row.parent_review_id) : null,
    reviewType: String(row.review_type) as StreamerAdminReviewItem["reviewType"],
    requestedBy: String(row.requested_by) as StreamerAdminReviewItem["requestedBy"],
    workState: String(row.work_state) as StreamerAdminReviewItem["workState"],
    decisionCode: row.decision_code
      ? (String(row.decision_code) as StreamerAdminReviewItem["decisionCode"])
      : null,
    streamerId: Number(row.review_streamer_id),
    userId: Number(row.review_user_id),
    nickname: String(row.review_nickname),
    platformAccount: account,
    priority: String(row.priority) as StreamerAdminReviewItem["priority"],
    dueAt: String(row.due_at),
    claimedBy: claimActive
      ? { userId: Number(row.claimed_by_user_id), nickname: String(row.claimant_nickname) }
      : null,
    claimExpiresAt: claimActive ? String(row.claim_expires_at) : null,
    holdUntil: row.hold_until ? String(row.hold_until) : null,
    publicReasonCode: row.public_reason_code ? String(row.public_reason_code) : null,
    internalNote: row.internal_note ? String(row.internal_note) : null,
    evidence: parseStoredEvidence(row, account, policy, generatedAt),
    rowVersion: Number(row.row_version ?? 0),
  };
}

export class D1StreamerAdminRepository implements StreamerAdminRepository {
  constructor(private db: D1Database) {}

  async isProviderConnectionPaused(platform: StreamerPlatformType): Promise<boolean> {
    const row = await this.db
      .prepare(
        `SELECT new_connections_paused
         FROM streamer_provider_settings
         WHERE platform = ?`,
      )
      .bind(platform)
      .first<{ new_connections_paused: number }>();
    return Number(row?.new_connections_paused ?? 1) === 1;
  }

  async getActivePolicy(): Promise<StreamerPolicyVersion | null> {
    const row = await this.db
      .prepare(
        `SELECT version.*, actor.nickname AS updated_by_nickname
         FROM streamer_policy_state state
         JOIN streamer_policy_versions version ON version.version = state.active_version
         LEFT JOIN users actor ON actor.id = version.updated_by_user_id
         WHERE state.singleton_id = 1`,
      )
      .first<Record<string, unknown>>();
    return row ? mapPolicy(row) : null;
  }

  private async listReviews(input: {
    page: number;
    pageSize: 10 | 20 | 30 | 50;
    query: string;
    assignment: "ALL" | "UNASSIGNED" | "MINE";
    state: "ALL" | StreamerAdminReviewItem["workState"];
    reviewerUserId: number;
    activeOnly?: boolean;
    generatedAt: string;
  }): Promise<StreamerAdminPage<StreamerAdminReviewItem>> {
    const conditions: string[] = [`account.platform IN (${MANAGED_STREAMER_PLATFORMS_SQL})`];
    const binds: unknown[] = [];
    if (input.activeOnly) conditions.push(`review.work_state IN (${ACTIVE_REVIEW_STATES})`);
    if (input.state !== "ALL") {
      conditions.push("review.work_state = ?");
      binds.push(input.state);
    }
    if (input.assignment === "UNASSIGNED") {
      conditions.push(
        "(review.claimed_by_user_id IS NULL OR review.claim_expires_at IS NULL OR datetime(review.claim_expires_at) <= datetime(?))",
      );
      binds.push(input.generatedAt);
    } else if (input.assignment === "MINE") {
      conditions.push(
        "review.claimed_by_user_id = ? AND datetime(review.claim_expires_at) > datetime(?)",
      );
      binds.push(input.reviewerUserId, input.generatedAt);
    }
    if (input.query) {
      conditions.push(
        "(applicant.nickname LIKE ? OR account.channel_name LIKE ? OR account.platform LIKE ? OR CAST(profile.user_id AS TEXT) LIKE ?)",
      );
      const pattern = `%${input.query}%`;
      binds.push(pattern, pattern, pattern, pattern);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const count = await this.db
      .prepare(
        `SELECT COUNT(*) AS total
         FROM streamer_platform_reviews review
         JOIN streamer_platform_accounts account ON account.id = review.streamer_platform_account_id
         JOIN streamer_profiles profile ON profile.id = account.streamer_id
         JOIN users applicant ON applicant.id = profile.user_id
         ${where}`,
      )
      .bind(...binds)
      .first<{ total: number }>();
    const rows = await this.db
      .prepare(
        `${REVIEW_SELECT}
         ${where}
         ORDER BY
           CASE review.work_state WHEN 'QUEUED' THEN 0 WHEN 'ON_HOLD' THEN 1 ELSE 2 END,
           CASE review.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 ELSE 2 END,
           review.due_at ASC, review.id ASC
         LIMIT ? OFFSET ?`,
      )
      .bind(...binds, input.pageSize, offsetFor(input.page, input.pageSize))
      .all<Record<string, unknown>>();
    return pageResult(
      (rows.results ?? []).map((row) => mapReview(row, input.generatedAt)),
      Number(count?.total ?? 0),
      input.page,
      input.pageSize,
    );
  }

  private async listRoster(
    query: StreamerAdminWorkspaceQuery,
    generatedAt: string,
  ): Promise<StreamerAdminPage<StreamerAdminRosterItem>> {
    const conditions: string[] = [
      `EXISTS (
        SELECT 1 FROM streamer_platform_accounts visible_account
        WHERE visible_account.streamer_id = profile.id
          AND visible_account.platform IN (${MANAGED_STREAMER_PLATFORMS_SQL})
      )`,
    ];
    const binds: unknown[] = [];
    if (query.rosterQuery) {
      conditions.push(
        `(user.nickname LIKE ? OR CAST(profile.user_id AS TEXT) LIKE ? OR EXISTS (
          SELECT 1 FROM streamer_platform_accounts search_account
          WHERE search_account.streamer_id = profile.id
            AND search_account.platform IN (${MANAGED_STREAMER_PLATFORMS_SQL})
            AND search_account.channel_name LIKE ?
        ))`,
      );
      const pattern = `%${query.rosterQuery}%`;
      binds.push(pattern, pattern, pattern);
    }
    if (query.rosterPlatform !== "ALL") {
      conditions.push(
        `EXISTS (
          SELECT 1 FROM streamer_platform_accounts filter_account
          WHERE filter_account.streamer_id = profile.id
            AND filter_account.platform IN (${MANAGED_STREAMER_PLATFORMS_SQL})
            AND filter_account.platform = ?
        )`,
      );
      binds.push(query.rosterPlatform);
    }
    if (query.rosterApproval !== "ALL") {
      conditions.push(
        `EXISTS (
          SELECT 1 FROM streamer_platform_accounts filter_account
          WHERE filter_account.streamer_id = profile.id
            AND filter_account.platform IN (${MANAGED_STREAMER_PLATFORMS_SQL})
            AND filter_account.approval_status = ?
        )`,
      );
      binds.push(query.rosterApproval);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const count = await this.db
      .prepare(
        `SELECT COUNT(*) AS total
         FROM streamer_profiles profile
         JOIN users user ON user.id = profile.user_id
         ${where}`,
      )
      .bind(...binds)
      .first<{ total: number }>();
    const rows = await this.db
      .prepare(
        `SELECT profile.*, user.nickname, user.avatar_url,
           CASE
             WHEN profile.status = 'SUSPENDED'
               AND (profile.suspended_until IS NULL
                 OR datetime(profile.suspended_until) IS NULL
                 OR datetime(profile.suspended_until) > datetime(?))
               THEN 'SUSPENDED'
             WHEN EXISTS (
               SELECT 1 FROM streamer_platform_accounts effective_approved
               WHERE effective_approved.streamer_id = profile.id
                 AND effective_approved.platform IN (${MANAGED_STREAMER_PLATFORMS_SQL})
                 AND effective_approved.verification_status = 'VERIFIED'
                 AND effective_approved.approval_status = 'APPROVED'
                 AND effective_approved.ownership_expires_at IS NOT NULL
                 AND datetime(effective_approved.ownership_expires_at) > datetime(?)
             ) THEN 'VERIFIED'
             ELSE 'UNVERIFIED'
           END AS effective_program_status,
           (SELECT COUNT(*) FROM streamer_platform_accounts approved
            WHERE approved.streamer_id = profile.id AND approved.verification_status = 'VERIFIED'
              AND approved.platform IN (${MANAGED_STREAMER_PLATFORMS_SQL})
              AND approved.approval_status = 'APPROVED'
              AND approved.ownership_expires_at IS NOT NULL
              AND datetime(approved.ownership_expires_at) > datetime(?)) AS approved_platform_count,
           (SELECT COUNT(*) FROM streamer_platform_reviews pending
            JOIN streamer_platform_accounts pending_account
              ON pending_account.id = pending.streamer_platform_account_id
            WHERE pending_account.streamer_id = profile.id
              AND pending_account.platform IN (${MANAGED_STREAMER_PLATFORMS_SQL})
              AND pending.work_state IN (${ACTIVE_REVIEW_STATES})) AS pending_review_count,
           (SELECT latest.work_state FROM streamer_platform_reviews latest
            JOIN streamer_platform_accounts latest_account
              ON latest_account.id = latest.streamer_platform_account_id
            WHERE latest_account.streamer_id = profile.id
              AND latest_account.platform IN (${MANAGED_STREAMER_PLATFORMS_SQL})
            ORDER BY latest.updated_at DESC, latest.id DESC LIMIT 1) AS latest_review_state,
           (SELECT MIN(next_review.due_at) FROM streamer_platform_reviews next_review
            JOIN streamer_platform_accounts next_account
              ON next_account.id = next_review.streamer_platform_account_id
            WHERE next_account.streamer_id = profile.id
              AND next_account.platform IN (${MANAGED_STREAMER_PLATFORMS_SQL})
              AND next_review.work_state IN (${ACTIVE_REVIEW_STATES})) AS next_action_at
         FROM streamer_profiles profile
         JOIN users user ON user.id = profile.user_id
         ${where}
         ORDER BY profile.updated_at DESC, profile.id DESC
         LIMIT ? OFFSET ?`,
      )
      .bind(
        generatedAt,
        generatedAt,
        generatedAt,
        ...binds,
        query.rosterPageSize,
        offsetFor(query.rosterPage, query.rosterPageSize),
      )
      .all<Record<string, unknown>>();
    const profileRows = rows.results ?? [];
    const profileIds = profileRows.map((row) => Number(row.id));
    const accountsByProfile = new Map<number, StreamerAdminPlatformAccount[]>();
    if (profileIds.length > 0) {
      const placeholders = profileIds.map(() => "?").join(",");
      const accountRows = await this.db
        .prepare(
          `SELECT * FROM streamer_platform_accounts
           WHERE streamer_id IN (${placeholders})
             AND platform IN (${MANAGED_STREAMER_PLATFORMS_SQL})
           ORDER BY id ASC`,
        )
        .bind(...profileIds)
        .all<Record<string, unknown>>();
      for (const row of accountRows.results ?? []) {
        const streamerId = Number(row.streamer_id);
        const accounts = accountsByProfile.get(streamerId) ?? [];
        accounts.push(mapAdminAccount(row));
        accountsByProfile.set(streamerId, accounts);
      }
    }
    const items: StreamerAdminRosterItem[] = profileRows.map((row) => {
      const programStatus = String(
        row.effective_program_status,
      ) as StreamerAdminRosterItem["programStatus"];
      return {
        streamerId: Number(row.id),
        userId: Number(row.user_id),
        nickname: String(row.nickname),
        avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
        programStatus,
        suspendedUntil:
          programStatus === "SUSPENDED" && row.suspended_until ? String(row.suspended_until) : null,
        approvedPlatformCount: Number(row.approved_platform_count ?? 0),
        pendingReviewCount: Number(row.pending_review_count ?? 0),
        latestReviewState: row.latest_review_state
          ? (String(row.latest_review_state) as StreamerAdminRosterItem["latestReviewState"])
          : null,
        nextActionAt: row.next_action_at ? String(row.next_action_at) : null,
        platformAccounts: accountsByProfile.get(Number(row.id)) ?? [],
        rowVersion: Number(row.row_version ?? 0),
      };
    });
    return pageResult(items, Number(count?.total ?? 0), query.rosterPage, query.rosterPageSize);
  }

  private async listPolicyHistory(
    query: StreamerAdminWorkspaceQuery,
  ): Promise<StreamerAdminPage<StreamerPolicyVersion>> {
    const count = await this.db
      .prepare("SELECT COUNT(*) AS total FROM streamer_policy_versions")
      .first<{ total: number }>();
    const rows = await this.db
      .prepare(
        `SELECT version.*, actor.nickname AS updated_by_nickname
         FROM streamer_policy_versions version
         LEFT JOIN users actor ON actor.id = version.updated_by_user_id
         ORDER BY version.version DESC LIMIT ? OFFSET ?`,
      )
      .bind(query.policyPageSize, offsetFor(query.policyPage, query.policyPageSize))
      .all<Record<string, unknown>>();
    return pageResult(
      (rows.results ?? []).map(mapPolicy),
      Number(count?.total ?? 0),
      query.policyPage,
      query.policyPageSize,
    );
  }

  private async listProviders(): Promise<StreamerProviderSetting[]> {
    const rows = await this.db
      .prepare(
        `SELECT setting.*,
           (SELECT COUNT(*) FROM streamer_platform_reviews review
            JOIN streamer_platform_accounts account
              ON account.id = review.streamer_platform_account_id
            WHERE account.platform = setting.platform
              AND review.work_state IN (${ACTIVE_REVIEW_STATES})) AS pending_reviews,
           (SELECT MAX(account.verified_at) FROM streamer_platform_accounts account
            WHERE account.platform = setting.platform
              AND account.verification_status = 'VERIFIED') AS last_successful_connection_at
         FROM streamer_provider_settings setting
         WHERE setting.platform IN (${MANAGED_STREAMER_PLATFORMS_SQL})
         ORDER BY setting.platform ASC`,
      )
      .all<Record<string, unknown>>();
    return (rows.results ?? []).map((row) => ({
      platform: String(row.platform) as StreamerPlatformType,
      newConnectionsPaused: Number(row.new_connections_paused) === 1,
      pendingReviews: Number(row.pending_reviews ?? 0),
      lastSuccessfulConnectionAt: row.last_successful_connection_at
        ? String(row.last_successful_connection_at)
        : null,
      rowVersion: Number(row.row_version ?? 0),
    }));
  }

  private async listAudits(
    query: StreamerAdminWorkspaceQuery,
  ): Promise<StreamerAdminPage<StreamerAdminAuditEntry>> {
    const conditions: string[] = [
      `NOT (
        (audit.target_type = 'PROVIDER' AND audit.target_id = 'SOOP')
        OR (audit.target_type = 'PLATFORM_ACCOUNT' AND EXISTS (
          SELECT 1 FROM streamer_platform_accounts hidden_account
          WHERE hidden_account.id = CAST(audit.target_id AS INTEGER)
            AND hidden_account.platform = 'SOOP'
        ))
        OR (audit.target_type = 'REVIEW' AND EXISTS (
          SELECT 1 FROM streamer_platform_reviews hidden_review
          JOIN streamer_platform_accounts hidden_review_account
            ON hidden_review_account.id = hidden_review.streamer_platform_account_id
          WHERE hidden_review.id = CAST(audit.target_id AS INTEGER)
            AND hidden_review_account.platform = 'SOOP'
        ))
        OR instr(upper(COALESCE(audit.target_label, '')), 'SOOP') > 0
        OR instr(upper(COALESCE(audit.public_reason_code, '')), 'SOOP') > 0
        OR instr(upper(COALESCE(audit.internal_note, '')), 'SOOP') > 0
        OR instr(upper(COALESCE(audit.change_summary, '')), 'SOOP') > 0
      )`,
    ];
    const binds: unknown[] = [];
    if (query.auditTarget !== "ALL") {
      conditions.push("audit.target_type = ?");
      binds.push(query.auditTarget);
    }
    if (query.auditQuery) {
      conditions.push(
        "(actor.nickname LIKE ? OR audit.action LIKE ? OR audit.target_label LIKE ? OR audit.change_summary LIKE ? OR audit.correlation_id LIKE ?)",
      );
      const pattern = `%${query.auditQuery}%`;
      binds.push(pattern, pattern, pattern, pattern, pattern);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const count = await this.db
      .prepare(
        `SELECT COUNT(*) AS total FROM streamer_admin_audit_log audit
         LEFT JOIN users actor ON actor.id = audit.actor_user_id ${where}`,
      )
      .bind(...binds)
      .first<{ total: number }>();
    const rows = await this.db
      .prepare(
        `SELECT audit.*, actor.nickname AS actor_nickname
         FROM streamer_admin_audit_log audit
         LEFT JOIN users actor ON actor.id = audit.actor_user_id
         ${where}
         ORDER BY audit.created_at DESC, audit.id DESC LIMIT ? OFFSET ?`,
      )
      .bind(...binds, query.auditPageSize, offsetFor(query.auditPage, query.auditPageSize))
      .all<Record<string, unknown>>();
    const items: StreamerAdminAuditEntry[] = (rows.results ?? []).map((row) => ({
      id: String(row.id),
      createdAt: String(row.created_at),
      actor: row.actor_nickname ? String(row.actor_nickname) : "SYSTEM",
      action: String(row.action),
      targetType: String(row.target_type) as StreamerAdminAuditEntry["targetType"],
      targetLabel: String(row.target_label),
      publicReasonCode: row.public_reason_code ? String(row.public_reason_code) : null,
      internalNote: row.internal_note ? String(row.internal_note) : null,
      changeSummary: String(row.change_summary),
      policyVersion: row.policy_version ? Number(row.policy_version) : null,
      correlationId: String(row.correlation_id),
    }));
    return pageResult(items, Number(count?.total ?? 0), query.auditPage, query.auditPageSize);
  }

  async getWorkspace(
    query: StreamerAdminWorkspaceQuery,
    reviewerUserId: number,
  ): Promise<StreamerAdminWorkspaceSnapshot> {
    const generatedAt = new Date().toISOString();
    const policy = await this.getActivePolicy();
    if (!policy) throw new Error("STREAMER_POLICY_UNAVAILABLE");
    const noticeDate = new Date(
      Date.now() + policy.values.reverificationNoticeDays * 86_400_000,
    ).toISOString();
    const overviewRow = await this.db
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM streamer_profiles applicant_profile
           WHERE EXISTS (
             SELECT 1 FROM streamer_platform_accounts applicant_account
             WHERE applicant_account.streamer_id = applicant_profile.id
               AND applicant_account.platform IN (${MANAGED_STREAMER_PLATFORMS_SQL})
           )) AS total_applicants,
          (SELECT COUNT(*) FROM streamer_profiles overview_profile
           WHERE (
             overview_profile.status <> 'SUSPENDED'
             OR (overview_profile.suspended_until IS NOT NULL
               AND datetime(overview_profile.suspended_until) IS NOT NULL
               AND datetime(overview_profile.suspended_until) <= datetime(?))
           ) AND EXISTS (
             SELECT 1 FROM streamer_platform_accounts overview_account
             WHERE overview_account.streamer_id = overview_profile.id
               AND overview_account.platform IN (${MANAGED_STREAMER_PLATFORMS_SQL})
               AND overview_account.verification_status = 'VERIFIED'
               AND overview_account.approval_status = 'APPROVED'
               AND overview_account.ownership_expires_at IS NOT NULL
               AND datetime(overview_account.ownership_expires_at) > datetime(?)
           )) AS approved_streamers,
          (SELECT COUNT(*) FROM streamer_profiles suspended_profile
           WHERE suspended_profile.status = 'SUSPENDED'
             AND (suspended_profile.suspended_until IS NULL
               OR datetime(suspended_profile.suspended_until) IS NULL
               OR datetime(suspended_profile.suspended_until) > datetime(?))
             AND EXISTS (
             SELECT 1 FROM streamer_platform_accounts suspended_account
             WHERE suspended_account.streamer_id = suspended_profile.id
               AND suspended_account.platform IN (${MANAGED_STREAMER_PLATFORMS_SQL})
           )) AS suspended_streamers,
          (SELECT COUNT(*) FROM streamer_platform_accounts
           WHERE platform IN (${MANAGED_STREAMER_PLATFORMS_SQL})
             AND verification_status = 'VERIFIED' AND ownership_expires_at IS NOT NULL
             AND datetime(ownership_expires_at) > datetime(?)) AS connected_platforms,
          (SELECT COUNT(*) FROM streamer_platform_reviews pending_review
           JOIN streamer_platform_accounts pending_account
             ON pending_account.id = pending_review.streamer_platform_account_id
           WHERE pending_account.platform IN (${MANAGED_STREAMER_PLATFORMS_SQL})
             AND pending_review.work_state IN (${ACTIVE_REVIEW_STATES})) AS pending_platform_reviews,
          (SELECT COUNT(*) FROM streamer_platform_accounts
           WHERE platform IN (${MANAGED_STREAMER_PLATFORMS_SQL})
             AND verification_status = 'VERIFIED' AND ownership_expires_at IS NOT NULL
             AND datetime(ownership_expires_at) > datetime(?)
             AND datetime(ownership_expires_at) <= datetime(?)) AS ownership_expiring_soon,
          (SELECT COUNT(*) FROM streamer_platform_reviews unassigned_review
           JOIN streamer_platform_accounts unassigned_account
             ON unassigned_account.id = unassigned_review.streamer_platform_account_id
           WHERE unassigned_account.platform IN (${MANAGED_STREAMER_PLATFORMS_SQL})
             AND unassigned_review.work_state IN (${ACTIVE_REVIEW_STATES})
             AND (unassigned_review.claimed_by_user_id IS NULL
               OR unassigned_review.claim_expires_at IS NULL
               OR datetime(unassigned_review.claim_expires_at) <= datetime(?))) AS unassigned_reviews,
          (SELECT COUNT(*) FROM streamer_platform_reviews claimed_review
           JOIN streamer_platform_accounts claimed_account
             ON claimed_account.id = claimed_review.streamer_platform_account_id
           WHERE claimed_account.platform IN (${MANAGED_STREAMER_PLATFORMS_SQL})
             AND claimed_review.work_state IN (${ACTIVE_REVIEW_STATES})
             AND claimed_review.claimed_by_user_id = ?
             AND datetime(claimed_review.claim_expires_at) > datetime(?)) AS my_claimed_reviews,
          (SELECT COUNT(*) FROM streamer_platform_reviews overdue_review
           JOIN streamer_platform_accounts overdue_account
             ON overdue_account.id = overdue_review.streamer_platform_account_id
           WHERE overdue_account.platform IN (${MANAGED_STREAMER_PLATFORMS_SQL})
             AND overdue_review.work_state IN (${ACTIVE_REVIEW_STATES})
             AND datetime(overdue_review.due_at) < datetime(?)) AS overdue_reviews`,
      )
      .bind(
        generatedAt,
        generatedAt,
        generatedAt,
        generatedAt,
        generatedAt,
        noticeDate,
        generatedAt,
        reviewerUserId,
        generatedAt,
        generatedAt,
      )
      .first<Record<string, unknown>>();

    const [overviewQueue, roster, reviews, constraintsRows, history, providerSettings, audits] =
      await Promise.all([
        this.listReviews({
          page: query.overviewPage,
          pageSize: query.overviewPageSize,
          query: "",
          assignment: "ALL",
          state: "ALL",
          reviewerUserId,
          activeOnly: true,
          generatedAt,
        }),
        this.listRoster(query, generatedAt),
        this.listReviews({
          page: query.reviewPage,
          pageSize: query.reviewPageSize,
          query: query.reviewQuery,
          assignment: query.reviewAssignment,
          state: query.reviewState,
          reviewerUserId,
          generatedAt,
        }),
        this.db
          .prepare("SELECT * FROM streamer_policy_constraints ORDER BY rowid ASC")
          .all<Record<string, unknown>>(),
        this.listPolicyHistory(query),
        this.listProviders(),
        this.listAudits(query),
      ]);

    return {
      generatedAt,
      overview: {
        totalApplicants: Number(overviewRow?.total_applicants ?? 0),
        approvedStreamers: Number(overviewRow?.approved_streamers ?? 0),
        suspendedStreamers: Number(overviewRow?.suspended_streamers ?? 0),
        connectedPlatforms: Number(overviewRow?.connected_platforms ?? 0),
        pendingPlatformReviews: Number(overviewRow?.pending_platform_reviews ?? 0),
        ownershipExpiringSoon: Number(overviewRow?.ownership_expiring_soon ?? 0),
        unassignedReviews: Number(overviewRow?.unassigned_reviews ?? 0),
        myClaimedReviews: Number(overviewRow?.my_claimed_reviews ?? 0),
        overdueReviews: Number(overviewRow?.overdue_reviews ?? 0),
      },
      overviewQueue,
      roster,
      reviews,
      policy: {
        current: policy,
        constraints: (constraintsRows.results ?? []).map(mapConstraint),
        history,
      },
      providerSettings,
      audits,
    };
  }

  private auditStatement(input: {
    actorUserId: number;
    action: string;
    targetType: StreamerAdminAuditEntry["targetType"];
    targetId: string;
    targetLabel: string;
    publicReasonCode: string | null;
    internalNote: string | null;
    changeSummary: string;
    policyVersion: number | null;
    correlationId: string;
    nowIso: string;
    guardSql: string;
    guardBinds: unknown[];
  }): D1PreparedStatement {
    return this.db
      .prepare(
        `INSERT INTO streamer_admin_audit_log
           (actor_user_id, action, target_type, target_id, target_label, public_reason_code,
            internal_note, change_summary, policy_version, correlation_id, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE ${input.guardSql}`,
      )
      .bind(
        input.actorUserId,
        input.action,
        input.targetType,
        input.targetId,
        input.targetLabel,
        input.publicReasonCode,
        input.internalNote,
        input.changeSummary,
        input.policyVersion,
        input.correlationId,
        input.nowIso,
        ...input.guardBinds,
      );
  }

  private async actionTarget(input: StreamerAdminActionInput): Promise<{
    id: number;
    label: string;
    streamerId: number | null;
    platformAccountId: number | null;
    reviewPolicyVersion: number | null;
  } | null> {
    const id = Number(input.targetId);
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    if (
      [
        "CANCEL_REVIEW",
        "CLAIM_REVIEW",
        "RELEASE_REVIEW",
        "HOLD_REVIEW",
        "APPROVE_STREAMER",
        "REJECT_STREAMER",
        "REQUEST_REAUTH",
        "CREATE_RECONSIDERATION",
      ].includes(input.action)
    ) {
      const row = await this.db
        .prepare(
          `SELECT review.id, review.policy_version, account.id AS platform_account_id,
                  profile.id AS streamer_id,
                  user.nickname, account.platform, account.channel_name
           FROM streamer_platform_reviews review
           JOIN streamer_platform_accounts account
             ON account.id = review.streamer_platform_account_id
           JOIN streamer_profiles profile ON profile.id = account.streamer_id
           JOIN users user ON user.id = profile.user_id
           WHERE review.id = ?
             AND account.platform IN (${MANAGED_STREAMER_PLATFORMS_SQL})`,
        )
        .bind(id)
        .first<Record<string, unknown>>();
      return row
        ? {
            id,
            label: `${String(row.nickname)} · ${String(row.platform)} ${String(row.channel_name)}`,
            streamerId: Number(row.streamer_id),
            platformAccountId: Number(row.platform_account_id),
            reviewPolicyVersion: Number(row.policy_version),
          }
        : null;
    }
    if (
      ["CREATE_REVIEW", "REVOKE_STREAMER_APPROVAL", "INVALIDATE_OWNERSHIP"].includes(input.action)
    ) {
      const row = await this.db
        .prepare(
          `SELECT account.id, profile.id AS streamer_id, user.nickname, account.platform,
                  account.channel_name
           FROM streamer_platform_accounts account
           JOIN streamer_profiles profile ON profile.id = account.streamer_id
           JOIN users user ON user.id = profile.user_id
           WHERE account.id = ?
             AND account.platform IN (${MANAGED_STREAMER_PLATFORMS_SQL})`,
        )
        .bind(id)
        .first<Record<string, unknown>>();
      return row
        ? {
            id,
            label: `${String(row.nickname)} · ${String(row.platform)} ${String(row.channel_name)}`,
            streamerId: Number(row.streamer_id),
            platformAccountId: id,
            reviewPolicyVersion: null,
          }
        : null;
    }
    const row = await this.db
      .prepare(
        `SELECT profile.id, user.nickname FROM streamer_profiles profile
         JOIN users user ON user.id = profile.user_id
         WHERE profile.id = ? AND EXISTS (
           SELECT 1 FROM streamer_platform_accounts visible_account
           WHERE visible_account.streamer_id = profile.id
             AND visible_account.platform IN (${MANAGED_STREAMER_PLATFORMS_SQL})
         )`,
      )
      .bind(id)
      .first<Record<string, unknown>>();
    return row
      ? {
          id,
          label: String(row.nickname),
          streamerId: id,
          platformAccountId: null,
          reviewPolicyVersion: null,
        }
      : null;
  }

  async applyAction(input: StreamerAdminActionInput): Promise<StreamerAdminActionResult> {
    if (input.action === "SAVE_POLICY") return this.savePolicy(input);
    if (
      input.action === "PAUSE_PROVIDER_CONNECTIONS" ||
      input.action === "RESUME_PROVIDER_CONNECTIONS"
    ) {
      return this.setProviderPause(input);
    }
    const target = await this.actionTarget(input);
    if (!target) return { applied: false, code: "NOT_FOUND", rowVersion: null };
    const policy = await this.getActivePolicy();
    if (!policy) return { applied: false, code: "CONFLICT", rowVersion: null };

    if (input.action === "CLAIM_REVIEW") {
      const expected = input.expectedVersion ?? -1;
      const expiresAt = new Date(
        new Date(input.nowIso).getTime() + policy.values.claimLeaseMinutes * 60_000,
      ).toISOString();
      const update = this.db
        .prepare(
          `UPDATE streamer_platform_reviews
           SET claimed_by_user_id = ?, claim_expires_at = ?, updated_at = ?,
               row_version = row_version + 1, last_correlation_id = ?
           WHERE id = ? AND row_version = ? AND work_state IN (${ACTIVE_REVIEW_STATES})
             AND (claimed_by_user_id IS NULL OR claim_expires_at IS NULL
               OR datetime(claim_expires_at) <= datetime(?) OR claimed_by_user_id = ?)`,
        )
        .bind(
          input.actorUserId,
          expiresAt,
          input.nowIso,
          input.correlationId,
          target.id,
          expected,
          input.nowIso,
          input.actorUserId,
        );
      return this.runGuardedAction(
        update,
        input,
        target,
        "REVIEW",
        "심사 담당자를 배정했습니다.",
        target.reviewPolicyVersion ?? policy.version,
      );
    }

    if (input.action === "RELEASE_REVIEW") {
      const update = this.db
        .prepare(
          `UPDATE streamer_platform_reviews
           SET claimed_by_user_id = NULL, claim_expires_at = NULL, updated_at = ?,
               row_version = row_version + 1, last_correlation_id = ?
           WHERE id = ? AND row_version = ? AND work_state IN (${ACTIVE_REVIEW_STATES})
             AND claimed_by_user_id = ?`,
        )
        .bind(
          input.nowIso,
          input.correlationId,
          target.id,
          input.expectedVersion ?? -1,
          input.actorUserId,
        );
      return this.runGuardedAction(
        update,
        input,
        target,
        "REVIEW",
        "심사 담당 배정을 해제했습니다.",
        target.reviewPolicyVersion ?? policy.version,
      );
    }

    if (input.action === "HOLD_REVIEW") {
      const holdUntil =
        input.effectiveAt ??
        new Date(
          new Date(input.nowIso).getTime() + policy.values.holdDefaultHours * 3_600_000,
        ).toISOString();
      if (new Date(holdUntil).getTime() <= new Date(input.nowIso).getTime()) {
        return { applied: false, code: "INVALID_ACTION", rowVersion: null };
      }
      const update = this.db
        .prepare(
          `UPDATE streamer_platform_reviews
           SET work_state = 'ON_HOLD', hold_until = ?, public_reason_code = ?, internal_note = ?,
               claimed_by_user_id = NULL, claim_expires_at = NULL, updated_at = ?,
               row_version = row_version + 1, last_correlation_id = ?
           WHERE id = ? AND row_version = ? AND work_state IN (${ACTIVE_REVIEW_STATES})
             AND (claimed_by_user_id IS NULL OR claimed_by_user_id = ?
               OR claim_expires_at IS NULL OR datetime(claim_expires_at) <= datetime(?))`,
        )
        .bind(
          holdUntil,
          input.reason,
          input.internalNote,
          input.nowIso,
          input.correlationId,
          target.id,
          input.expectedVersion ?? -1,
          input.actorUserId,
          input.nowIso,
        );
      return this.runGuardedAction(
        update,
        input,
        target,
        "REVIEW",
        `심사를 ${holdUntil}까지 보류했습니다.`,
        target.reviewPolicyVersion ?? policy.version,
      );
    }

    if (input.action === "CANCEL_REVIEW") {
      const update = this.db
        .prepare(
          `UPDATE streamer_platform_reviews
           SET work_state = 'CANCELLED', public_reason_code = ?, internal_note = ?,
               completed_at = ?, claimed_by_user_id = NULL, claim_expires_at = NULL,
               hold_until = NULL, updated_at = ?, row_version = row_version + 1,
               last_correlation_id = ?
           WHERE id = ? AND row_version = ? AND work_state IN (${ACTIVE_REVIEW_STATES})
             AND (claimed_by_user_id IS NULL OR claimed_by_user_id = ?
               OR claim_expires_at IS NULL OR datetime(claim_expires_at) <= datetime(?))`,
        )
        .bind(
          input.reason,
          input.internalNote,
          input.nowIso,
          input.nowIso,
          input.correlationId,
          target.id,
          input.expectedVersion ?? -1,
          input.actorUserId,
          input.nowIso,
        );
      return this.runGuardedAction(
        update,
        input,
        target,
        "REVIEW",
        "심사를 취소했습니다.",
        target.reviewPolicyVersion ?? policy.version,
      );
    }

    if (
      input.action === "APPROVE_STREAMER" ||
      input.action === "REJECT_STREAMER" ||
      input.action === "REQUEST_REAUTH"
    ) {
      return this.decideReview(input, target, policy);
    }

    if (input.action === "CREATE_REVIEW" || input.action === "CREATE_RECONSIDERATION") {
      return this.createReview(input, target, policy);
    }

    if (input.action === "REVOKE_STREAMER_APPROVAL" || input.action === "INVALIDATE_OWNERSHIP") {
      return this.changePlatformLifecycle(input, target, policy);
    }

    if (input.action === "SUSPEND_STREAMER" || input.action === "RESTORE_STREAMER") {
      return this.changeProgramStatus(input, target, policy);
    }

    return { applied: false, code: "INVALID_ACTION", rowVersion: null };
  }

  private async runGuardedAction(
    update: D1PreparedStatement,
    input: StreamerAdminActionInput,
    target: { id: number; label: string; reviewPolicyVersion?: number | null },
    targetType: StreamerAdminAuditEntry["targetType"],
    summary: string,
    policyVersion: number | null,
  ): Promise<StreamerAdminActionResult> {
    const audit = this.auditStatement({
      actorUserId: input.actorUserId,
      action: input.action,
      targetType,
      targetId: String(target.id),
      targetLabel: target.label,
      publicReasonCode: input.reason,
      internalNote: input.internalNote,
      changeSummary: summary,
      policyVersion,
      correlationId: input.correlationId,
      nowIso: input.nowIso,
      guardSql:
        "EXISTS (SELECT 1 FROM streamer_platform_reviews WHERE id = ? AND last_correlation_id = ?)",
      guardBinds: [target.id, input.correlationId],
    });
    const results = await this.db.batch([update, audit]);
    const applied = Number(results[0]?.meta?.changes ?? 0) > 0;
    return {
      applied,
      ...(applied ? {} : { code: "CONFLICT" as const }),
      rowVersion: applied ? (input.expectedVersion ?? 0) + 1 : null,
    };
  }

  private async decideReview(
    input: StreamerAdminActionInput,
    target: {
      id: number;
      label: string;
      streamerId: number | null;
      platformAccountId: number | null;
      reviewPolicyVersion: number | null;
    },
    policy: StreamerPolicyVersion,
  ): Promise<StreamerAdminActionResult> {
    if (!target.streamerId || !target.platformAccountId) {
      return { applied: false, code: "NOT_FOUND", rowVersion: null };
    }
    const account = await this.db
      .prepare(
        "SELECT verification_status, ownership_expires_at FROM streamer_platform_accounts WHERE id = ?",
      )
      .bind(target.platformAccountId)
      .first<{ verification_status: string; ownership_expires_at: string | null }>();
    if (
      input.action === "APPROVE_STREAMER" &&
      (account?.verification_status !== "VERIFIED" ||
        !account.ownership_expires_at ||
        new Date(account.ownership_expires_at).getTime() <= new Date(input.nowIso).getTime())
    ) {
      return { applied: false, code: "OWNERSHIP_NOT_VERIFIED", rowVersion: null };
    }
    const approved = input.action === "APPROVE_STREAMER";
    const reauth = input.action === "REQUEST_REAUTH";
    const workState = approved ? "APPROVED" : "REJECTED";
    const decisionCode = approved
      ? "STREAMER_APPROVED"
      : reauth
        ? "REAUTH_REQUIRED"
        : "STREAMER_REJECTED";
    const accountStatus = approved ? "APPROVED" : reauth ? "PENDING" : "REJECTED";
    const reviewUpdate = this.db
      .prepare(
        `UPDATE streamer_platform_reviews
         SET work_state = ?, decision_code = ?, public_reason_code = ?, internal_note = ?,
             completed_at = ?, claimed_by_user_id = NULL, claim_expires_at = NULL,
             hold_until = NULL, updated_at = ?, row_version = row_version + 1,
             last_correlation_id = ?
          WHERE id = ? AND row_version = ? AND work_state IN (${ACTIVE_REVIEW_STATES})
            AND (claimed_by_user_id IS NULL OR claimed_by_user_id = ? OR claim_expires_at IS NULL
              OR datetime(claim_expires_at) <= datetime(?))
            AND (? <> 'APPROVE_STREAMER' OR EXISTS (
              SELECT 1 FROM streamer_platform_accounts decision_account
              WHERE decision_account.id = ? AND decision_account.verification_status = 'VERIFIED'
                AND decision_account.ownership_expires_at IS NOT NULL
                AND datetime(decision_account.ownership_expires_at) > datetime(?)
            ))`,
      )
      .bind(
        workState,
        decisionCode,
        input.reason,
        input.internalNote,
        input.nowIso,
        input.nowIso,
        input.correlationId,
        target.id,
        input.expectedVersion ?? -1,
        input.actorUserId,
        input.nowIso,
        input.action,
        target.platformAccountId,
        input.nowIso,
      );
    const accountUpdate = this.db
      .prepare(
        `UPDATE streamer_platform_accounts
         SET approval_status = ?, approval_reason_code = ?,
             approved_at = CASE WHEN ? = 'APPROVED' THEN ? ELSE NULL END,
              approved_by_user_id = CASE WHEN ? = 'APPROVED' THEN ? ELSE NULL END,
              verification_status = CASE WHEN ? = 1 THEN 'UNVERIFIED' ELSE verification_status END,
              ownership_expires_at = CASE WHEN ? = 1 THEN NULL ELSE ownership_expires_at END,
              updated_at = ?, row_version = row_version + 1, last_correlation_id = ?
         WHERE id = ? AND EXISTS (
           SELECT 1 FROM streamer_platform_reviews
           WHERE id = ? AND last_correlation_id = ?
         )`,
      )
      .bind(
        accountStatus,
        input.reason,
        accountStatus,
        input.nowIso,
        accountStatus,
        input.actorUserId,
        reauth ? 1 : 0,
        reauth ? 1 : 0,
        input.nowIso,
        input.correlationId,
        target.platformAccountId,
        target.id,
        input.correlationId,
      );
    const profileUpdate = approved
      ? this.db
          .prepare(
            `UPDATE streamer_profiles
             SET status = CASE
                   WHEN status = 'SUSPENDED'
                     AND (suspended_until IS NULL OR datetime(suspended_until) IS NULL
                       OR datetime(suspended_until) > datetime(?))
                     THEN status
                   ELSE 'VERIFIED'
                 END,
                  updated_at = ?, row_version = row_version + 1, last_correlation_id = ?
             WHERE id = ? AND EXISTS (
               SELECT 1 FROM streamer_platform_reviews WHERE id = ? AND last_correlation_id = ?
             )`,
          )
          .bind(
            input.nowIso,
            input.nowIso,
            input.correlationId,
            target.streamerId,
            target.id,
            input.correlationId,
          )
      : this.db
          .prepare(
            `UPDATE streamer_profiles
              SET status = CASE
                    WHEN status = 'SUSPENDED'
                      AND (suspended_until IS NULL OR datetime(suspended_until) IS NULL
                        OR datetime(suspended_until) > datetime(?))
                      THEN status
                    WHEN EXISTS (
                      SELECT 1 FROM streamer_platform_accounts approved_account
                       WHERE approved_account.streamer_id = streamer_profiles.id
                         AND approved_account.platform IN (${MANAGED_STREAMER_PLATFORMS_SQL})
                         AND approved_account.approval_status = 'APPROVED'
                        AND approved_account.verification_status = 'VERIFIED'
                        AND approved_account.ownership_expires_at IS NOT NULL
                        AND datetime(approved_account.ownership_expires_at) > datetime(?)
                        AND approved_account.id <> ?
                   ) THEN 'VERIFIED'
                   ELSE 'UNVERIFIED'
                 END,
                 updated_at = ?, row_version = row_version + 1, last_correlation_id = ?
             WHERE id = ? AND EXISTS (
               SELECT 1 FROM streamer_platform_reviews WHERE id = ? AND last_correlation_id = ?
             )`,
          )
          .bind(
            input.nowIso,
            input.nowIso,
            target.platformAccountId,
            input.nowIso,
            input.correlationId,
            target.streamerId,
            target.id,
            input.correlationId,
          );
    const audit = this.auditStatement({
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: "REVIEW",
      targetId: String(target.id),
      targetLabel: target.label,
      publicReasonCode: input.reason,
      internalNote: input.internalNote,
      changeSummary: approved
        ? "이 플랫폼 계정을 Streamer로 승인했습니다."
        : reauth
          ? "플랫폼 소유권 재인증을 요청했습니다."
          : "이 플랫폼 계정의 Streamer 신청을 거절했습니다.",
      policyVersion: target.reviewPolicyVersion ?? policy.version,
      correlationId: input.correlationId,
      nowIso: input.nowIso,
      guardSql:
        "EXISTS (SELECT 1 FROM streamer_platform_reviews WHERE id = ? AND last_correlation_id = ?)",
      guardBinds: [target.id, input.correlationId],
    });
    const results = await this.db.batch([reviewUpdate, accountUpdate, profileUpdate, audit]);
    const applied = Number(results[0]?.meta?.changes ?? 0) > 0;
    return {
      applied,
      ...(applied ? {} : { code: "CONFLICT" as const }),
      rowVersion: applied ? (input.expectedVersion ?? 0) + 1 : null,
    };
  }

  private async createReview(
    input: StreamerAdminActionInput,
    target: { id: number; label: string; platformAccountId: number | null },
    policy: StreamerPolicyVersion,
  ): Promise<StreamerAdminActionResult> {
    let accountId = target.platformAccountId;
    let parentId: number | null = null;
    let reviewType: "INITIAL" | "RECONSIDERATION" = "INITIAL";
    if (input.action === "CREATE_RECONSIDERATION") {
      const parent = await this.db
        .prepare(
          `SELECT id, streamer_platform_account_id, updated_at, row_version
           FROM streamer_platform_reviews
           WHERE id = ? AND work_state = 'REJECTED' AND decision_code = 'STREAMER_REJECTED'`,
        )
        .bind(target.id)
        .first<Record<string, unknown>>();
      if (!parent) return { applied: false, code: "NOT_FOUND", rowVersion: null };
      if (Number(parent.row_version) !== input.expectedVersion) {
        return { applied: false, code: "CONFLICT", rowVersion: null };
      }
      accountId = Number(parent.streamer_platform_account_id);
      parentId = Number(parent.id);
      reviewType = "RECONSIDERATION";
      const cooldownAt = new Date(
        new Date(String(parent.updated_at)).getTime() +
          policy.values.reconsiderationCooldownDays * 86_400_000,
      ).getTime();
      if (cooldownAt > new Date(input.nowIso).getTime()) {
        return { applied: false, code: "CONFLICT", rowVersion: null };
      }
    }
    if (!accountId) return { applied: false, code: "NOT_FOUND", rowVersion: null };
    const accountRow = await this.db
      .prepare("SELECT * FROM streamer_platform_accounts WHERE id = ?")
      .bind(accountId)
      .first<Record<string, unknown>>();
    if (!accountRow) return { applied: false, code: "NOT_FOUND", rowVersion: null };
    if (
      String(accountRow.verification_status) !== "VERIFIED" ||
      !accountRow.ownership_expires_at ||
      new Date(String(accountRow.ownership_expires_at)).getTime() <=
        new Date(input.nowIso).getTime()
    ) {
      return { applied: false, code: "OWNERSHIP_NOT_VERIFIED", rowVersion: null };
    }
    if (
      input.action === "CREATE_REVIEW" &&
      Number(accountRow.row_version) !== input.expectedVersion
    ) {
      return { applied: false, code: "CONFLICT", rowVersion: null };
    }
    const evidence = JSON.stringify(
      buildEvidence(mapAdminAccount(accountRow), policy, input.nowIso),
    );
    const dueAt = new Date(
      new Date(input.nowIso).getTime() + policy.values.reviewSlaHours * 3_600_000,
    ).toISOString();
    const insert = this.db
      .prepare(
        `INSERT INTO streamer_platform_reviews
           (streamer_platform_account_id, parent_review_id, review_type, requested_by,
            work_state, decision_code, priority, due_at, claimed_by_user_id, claim_expires_at,
            hold_until, public_reason_code, internal_note, policy_version, evidence_json,
            created_at, updated_at, completed_at, row_version, last_correlation_id)
         SELECT ?, ?, ?, 'ADMIN', 'QUEUED', NULL, 'NORMAL', ?, NULL, NULL, NULL, ?, ?, ?, ?,
                ?, ?, NULL, 0, ?
          WHERE EXISTS (
            SELECT 1 FROM streamer_platform_accounts eligible_account
            WHERE eligible_account.id = ? AND eligible_account.verification_status = 'VERIFIED'
              AND eligible_account.ownership_expires_at IS NOT NULL
              AND datetime(eligible_account.ownership_expires_at) > datetime(?)
              AND (? = 0 OR eligible_account.row_version = ?)
          ) AND NOT EXISTS (
            SELECT 1 FROM streamer_platform_reviews
            WHERE streamer_platform_account_id = ? AND work_state IN (${ACTIVE_REVIEW_STATES})
         )`,
      )
      .bind(
        accountId,
        parentId,
        reviewType,
        dueAt,
        input.reason,
        input.internalNote,
        policy.version,
        evidence,
        input.nowIso,
        input.nowIso,
        input.correlationId,
        accountId,
        input.nowIso,
        input.action === "CREATE_REVIEW" ? 1 : 0,
        input.expectedVersion ?? -1,
        accountId,
      );
    const audit = this.auditStatement({
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: "PLATFORM_ACCOUNT",
      targetId: String(accountId),
      targetLabel: target.label,
      publicReasonCode: input.reason,
      internalNote: input.internalNote,
      changeSummary:
        reviewType === "INITIAL" ? "수동 심사를 생성했습니다." : "후속 재심을 생성했습니다.",
      policyVersion: policy.version,
      correlationId: input.correlationId,
      nowIso: input.nowIso,
      guardSql:
        "EXISTS (SELECT 1 FROM streamer_platform_reviews WHERE streamer_platform_account_id = ? AND last_correlation_id = ?)",
      guardBinds: [accountId, input.correlationId],
    });
    const results = await this.db.batch([insert, audit]);
    const applied = Number(results[0]?.meta?.changes ?? 0) > 0;
    return {
      applied,
      ...(applied ? {} : { code: "ACTIVE_REVIEW_EXISTS" as const }),
      rowVersion: applied ? 0 : null,
    };
  }

  private async changePlatformLifecycle(
    input: StreamerAdminActionInput,
    target: {
      id: number;
      label: string;
      streamerId: number | null;
      platformAccountId: number | null;
    },
    policy: StreamerPolicyVersion,
  ): Promise<StreamerAdminActionResult> {
    if (!target.streamerId || !target.platformAccountId) {
      return { applied: false, code: "NOT_FOUND", rowVersion: null };
    }
    const invalidate = input.action === "INVALIDATE_OWNERSHIP";
    const accountUpdate = this.db
      .prepare(
        `UPDATE streamer_platform_accounts
         SET approval_status = 'REJECTED', approval_reason_code = ?, approved_at = NULL,
             approved_by_user_id = NULL,
             verification_status = CASE WHEN ? = 1 THEN 'REJECTED' ELSE verification_status END,
             ownership_expires_at = CASE WHEN ? = 1 THEN NULL ELSE ownership_expires_at END,
             updated_at = ?, row_version = row_version + 1, last_correlation_id = ?
         WHERE id = ? AND row_version = ?
           AND (? = 1 OR approval_status = 'APPROVED')`,
      )
      .bind(
        input.reason,
        invalidate ? 1 : 0,
        invalidate ? 1 : 0,
        input.nowIso,
        input.correlationId,
        target.platformAccountId,
        input.expectedVersion ?? -1,
        invalidate ? 1 : 0,
      );
    const profileUpdate = this.db
      .prepare(
        `UPDATE streamer_profiles
          SET status = CASE
                WHEN status = 'SUSPENDED'
                  AND (suspended_until IS NULL OR datetime(suspended_until) IS NULL
                    OR datetime(suspended_until) > datetime(?))
                  THEN status
                WHEN EXISTS (
                  SELECT 1 FROM streamer_platform_accounts approved
                   WHERE approved.streamer_id = streamer_profiles.id
                     AND approved.platform IN (${MANAGED_STREAMER_PLATFORMS_SQL})
                     AND approved.id <> ? AND approved.approval_status = 'APPROVED'
                    AND approved.verification_status = 'VERIFIED'
                    AND approved.ownership_expires_at IS NOT NULL
                    AND datetime(approved.ownership_expires_at) > datetime(?)
               ) THEN 'VERIFIED' ELSE 'UNVERIFIED' END,
             updated_at = ?, row_version = row_version + 1, last_correlation_id = ?
         WHERE id = ? AND EXISTS (
           SELECT 1 FROM streamer_platform_accounts
           WHERE id = ? AND last_correlation_id = ?
         )`,
      )
      .bind(
        input.nowIso,
        target.platformAccountId,
        input.nowIso,
        input.nowIso,
        input.correlationId,
        target.streamerId,
        target.platformAccountId,
        input.correlationId,
      );
    const closeReviews = this.db
      .prepare(
        `UPDATE streamer_platform_reviews
         SET work_state = 'CANCELLED', public_reason_code = ?, internal_note = ?, completed_at = ?,
             claimed_by_user_id = NULL, claim_expires_at = NULL, hold_until = NULL,
             updated_at = ?, row_version = row_version + 1, last_correlation_id = ?
         WHERE streamer_platform_account_id = ? AND work_state IN (${ACTIVE_REVIEW_STATES})
           AND EXISTS (SELECT 1 FROM streamer_platform_accounts
             WHERE id = ? AND last_correlation_id = ?)`,
      )
      .bind(
        input.reason,
        input.internalNote,
        input.nowIso,
        input.nowIso,
        input.correlationId,
        target.platformAccountId,
        target.platformAccountId,
        input.correlationId,
      );
    const audit = this.auditStatement({
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: "PLATFORM_ACCOUNT",
      targetId: String(target.platformAccountId),
      targetLabel: target.label,
      publicReasonCode: input.reason,
      internalNote: input.internalNote,
      changeSummary: invalidate
        ? "플랫폼 소유권과 Streamer 승인을 무효화했습니다."
        : "플랫폼 Streamer 승인을 철회했습니다.",
      policyVersion: policy.version,
      correlationId: input.correlationId,
      nowIso: input.nowIso,
      guardSql:
        "EXISTS (SELECT 1 FROM streamer_platform_accounts WHERE id = ? AND last_correlation_id = ?)",
      guardBinds: [target.platformAccountId, input.correlationId],
    });
    const results = await this.db.batch([accountUpdate, profileUpdate, closeReviews, audit]);
    const applied = Number(results[0]?.meta?.changes ?? 0) > 0;
    return {
      applied,
      ...(applied ? {} : { code: "CONFLICT" as const }),
      rowVersion: applied ? (input.expectedVersion ?? 0) + 1 : null,
    };
  }

  private async changeProgramStatus(
    input: StreamerAdminActionInput,
    target: { id: number; label: string; streamerId: number | null },
    policy: StreamerPolicyVersion,
  ): Promise<StreamerAdminActionResult> {
    if (!target.streamerId) return { applied: false, code: "NOT_FOUND", rowVersion: null };
    const suspend = input.action === "SUSPEND_STREAMER";
    if (
      suspend &&
      input.effectiveAt &&
      new Date(input.effectiveAt).getTime() <= new Date(input.nowIso).getTime()
    ) {
      return { applied: false, code: "INVALID_ACTION", rowVersion: null };
    }
    const update = suspend
      ? this.db
          .prepare(
            `UPDATE streamer_profiles
             SET status = 'SUSPENDED', suspended_at = ?, suspended_by_user_id = ?,
                 suspended_until = ?, suspension_reason_code = ?, updated_at = ?,
                 row_version = row_version + 1, last_correlation_id = ?
             WHERE id = ? AND row_version = ?
               AND (status <> 'SUSPENDED'
                 OR (suspended_until IS NOT NULL AND datetime(suspended_until) <= datetime(?)))`,
          )
          .bind(
            input.nowIso,
            input.actorUserId,
            input.effectiveAt,
            input.reason,
            input.nowIso,
            input.correlationId,
            target.streamerId,
            input.expectedVersion ?? -1,
            input.nowIso,
          )
      : this.db
          .prepare(
            `UPDATE streamer_profiles
             SET status = CASE WHEN EXISTS (
                   SELECT 1 FROM streamer_platform_accounts approved
                    WHERE approved.streamer_id = streamer_profiles.id
                      AND approved.platform IN (${MANAGED_STREAMER_PLATFORMS_SQL})
                       AND approved.approval_status = 'APPROVED'
                      AND approved.verification_status = 'VERIFIED'
                      AND approved.ownership_expires_at IS NOT NULL
                      AND datetime(approved.ownership_expires_at) > datetime(?)
                 ) THEN 'VERIFIED' ELSE 'UNVERIFIED' END,
                 suspended_at = NULL, suspended_by_user_id = NULL, suspended_until = NULL,
                 suspension_reason_code = NULL, updated_at = ?, row_version = row_version + 1,
                 last_correlation_id = ?
             WHERE id = ? AND row_version = ? AND status = 'SUSPENDED'`,
          )
          .bind(
            input.nowIso,
            input.nowIso,
            input.correlationId,
            target.streamerId,
            input.expectedVersion ?? -1,
          );
    const audit = this.auditStatement({
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: "STREAMER",
      targetId: String(target.streamerId),
      targetLabel: target.label,
      publicReasonCode: input.reason,
      internalNote: input.internalNote,
      changeSummary: suspend
        ? "Streamer 프로그램을 중단했습니다."
        : "Streamer 프로그램을 복구했습니다.",
      policyVersion: policy.version,
      correlationId: input.correlationId,
      nowIso: input.nowIso,
      guardSql: "EXISTS (SELECT 1 FROM streamer_profiles WHERE id = ? AND last_correlation_id = ?)",
      guardBinds: [target.streamerId, input.correlationId],
    });
    const results = await this.db.batch([update, audit]);
    const applied = Number(results[0]?.meta?.changes ?? 0) > 0;
    return {
      applied,
      ...(applied ? {} : { code: "CONFLICT" as const }),
      rowVersion: applied ? (input.expectedVersion ?? 0) + 1 : null,
    };
  }

  private async savePolicy(input: StreamerAdminActionInput): Promise<StreamerAdminActionResult> {
    if (!input.policyValues || input.expectedVersion === null) {
      return { applied: false, code: "INVALID_ACTION", rowVersion: null };
    }
    const constraintRows = await this.db
      .prepare("SELECT * FROM streamer_policy_constraints ORDER BY rowid ASC")
      .all<Record<string, unknown>>();
    const constraints = (constraintRows.results ?? []).map(mapConstraint);
    if (!policyValuesMatchConstraints(input.policyValues, constraints)) {
      return { applied: false, code: "INVALID_ACTION", rowVersion: null };
    }
    const nextVersion = input.expectedVersion + 1;
    const insert = this.db
      .prepare(
        `INSERT INTO streamer_policy_versions
           (version, values_json, reason, updated_by_user_id, updated_at)
         SELECT ?, ?, ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM streamer_policy_state
           WHERE singleton_id = 1 AND active_version = ?
         )`,
      )
      .bind(
        nextVersion,
        JSON.stringify(input.policyValues),
        input.reason,
        input.actorUserId,
        input.nowIso,
        input.expectedVersion,
      );
    const stateUpdate = this.db
      .prepare(
        `UPDATE streamer_policy_state
         SET active_version = ?, row_version = row_version + 1, last_correlation_id = ?,
             updated_at = ?
         WHERE singleton_id = 1 AND active_version = ?
           AND EXISTS (SELECT 1 FROM streamer_policy_versions WHERE version = ?)`,
      )
      .bind(nextVersion, input.correlationId, input.nowIso, input.expectedVersion, nextVersion);
    const audit = this.auditStatement({
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: "POLICY",
      targetId: String(nextVersion),
      targetLabel: `Streamer 정책 v${nextVersion}`,
      publicReasonCode: input.reason,
      internalNote: input.internalNote,
      changeSummary: `수동 심사 정책을 v${nextVersion}로 변경했습니다.`,
      policyVersion: nextVersion,
      correlationId: input.correlationId,
      nowIso: input.nowIso,
      guardSql:
        "EXISTS (SELECT 1 FROM streamer_policy_state WHERE singleton_id = 1 AND last_correlation_id = ?)",
      guardBinds: [input.correlationId],
    });
    const results = await this.db.batch([insert, stateUpdate, audit]);
    const applied =
      Number(results[0]?.meta?.changes ?? 0) > 0 && Number(results[1]?.meta?.changes ?? 0) > 0;
    return {
      applied,
      ...(applied ? {} : { code: "CONFLICT" as const }),
      rowVersion: applied ? nextVersion : null,
    };
  }

  private async setProviderPause(
    input: StreamerAdminActionInput,
  ): Promise<StreamerAdminActionResult> {
    const platform = input.targetId as StreamerPlatformType;
    if (!["YOUTUBE", "CHZZK", "TWITCH"].includes(platform)) {
      return { applied: false, code: "NOT_FOUND", rowVersion: null };
    }
    const paused = input.action === "PAUSE_PROVIDER_CONNECTIONS";
    const update = this.db
      .prepare(
        `UPDATE streamer_provider_settings
         SET new_connections_paused = ?, reason = ?, updated_by_user_id = ?, updated_at = ?,
             row_version = row_version + 1, last_correlation_id = ?
         WHERE platform = ? AND row_version = ?`,
      )
      .bind(
        paused ? 1 : 0,
        input.reason,
        input.actorUserId,
        input.nowIso,
        input.correlationId,
        platform,
        input.expectedVersion ?? -1,
      );
    const audit = this.auditStatement({
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: "PROVIDER",
      targetId: platform,
      targetLabel: platform,
      publicReasonCode: input.reason,
      internalNote: input.internalNote,
      changeSummary: paused
        ? "신규 플랫폼 연결을 일시 중지했습니다."
        : "신규 플랫폼 연결을 재개했습니다.",
      policyVersion: null,
      correlationId: input.correlationId,
      nowIso: input.nowIso,
      guardSql:
        "EXISTS (SELECT 1 FROM streamer_provider_settings WHERE platform = ? AND last_correlation_id = ?)",
      guardBinds: [platform, input.correlationId],
    });
    const results = await this.db.batch([update, audit]);
    const applied = Number(results[0]?.meta?.changes ?? 0) > 0;
    return {
      applied,
      ...(applied ? {} : { code: "CONFLICT" as const }),
      rowVersion: applied ? (input.expectedVersion ?? 0) + 1 : null,
    };
  }

  async recordMetricRefresh(input: {
    platformAccount: StreamerPlatformAccount;
    expectedVersion: number;
    audienceCount: number | null;
    channelCreatedAt: string | null;
    actorUserId: number;
    reason: string;
    internalNote: string | null;
    correlationId: string;
    nowIso: string;
  }): Promise<StreamerAdminActionResult> {
    const [rawAccount, pinnedPolicyRow] = await Promise.all([
      this.db
        .prepare("SELECT * FROM streamer_platform_accounts WHERE id = ?")
        .bind(input.platformAccount.id)
        .first<Record<string, unknown>>(),
      this.db
        .prepare(
          `SELECT policy.*, actor.nickname AS updated_by_nickname
           FROM streamer_platform_reviews review
           JOIN streamer_policy_versions policy ON policy.version = review.policy_version
           LEFT JOIN users actor ON actor.id = policy.updated_by_user_id
           WHERE review.streamer_platform_account_id = ?
             AND review.work_state IN (${ACTIVE_REVIEW_STATES})
           ORDER BY review.created_at DESC, review.id DESC
           LIMIT 1`,
        )
        .bind(input.platformAccount.id)
        .first<Record<string, unknown>>(),
    ]);
    if (!rawAccount) return { applied: false, code: "NOT_FOUND", rowVersion: null };
    const policy = pinnedPolicyRow ? mapPolicy(pinnedPolicyRow) : await this.getActivePolicy();
    if (!policy) return { applied: false, code: "CONFLICT", rowVersion: null };
    const evidence = JSON.stringify(
      buildEvidence(
        mapAdminAccount({
          ...rawAccount,
          audience_count: input.audienceCount,
          audience_count_known: input.audienceCount === null ? 0 : 1,
          channel_created_at: input.channelCreatedAt,
          metrics_synced_at: input.nowIso,
          row_version: input.expectedVersion + 1,
        }),
        policy,
        input.nowIso,
      ),
    );
    const accountUpdate = this.db
      .prepare(
        `UPDATE streamer_platform_accounts
         SET audience_count = ?, audience_count_known = ?, channel_created_at = ?,
             metrics_synced_at = ?, updated_at = ?, row_version = row_version + 1,
             last_correlation_id = ?
         WHERE id = ? AND row_version = ?
           AND NOT EXISTS (
             SELECT 1 FROM streamer_platform_reviews claimed_review
             WHERE claimed_review.streamer_platform_account_id = streamer_platform_accounts.id
               AND claimed_review.work_state IN (${ACTIVE_REVIEW_STATES})
               AND claimed_review.claimed_by_user_id IS NOT NULL
               AND claimed_review.claimed_by_user_id <> ?
               AND claimed_review.claim_expires_at IS NOT NULL
               AND datetime(claimed_review.claim_expires_at) > datetime(?)
           )`,
      )
      .bind(
        input.audienceCount,
        input.audienceCount === null ? 0 : 1,
        input.channelCreatedAt,
        input.nowIso,
        input.nowIso,
        input.correlationId,
        input.platformAccount.id,
        input.expectedVersion,
        input.actorUserId,
        input.nowIso,
      );
    const reviews = this.db
      .prepare(
        `UPDATE streamer_platform_reviews
         SET evidence_json = ?, updated_at = ?, row_version = row_version + 1,
             last_correlation_id = ?
         WHERE streamer_platform_account_id = ? AND work_state IN (${ACTIVE_REVIEW_STATES})
           AND EXISTS (
             SELECT 1 FROM streamer_platform_accounts refreshed_account
             WHERE refreshed_account.id = ? AND refreshed_account.last_correlation_id = ?
           )`,
      )
      .bind(
        evidence,
        input.nowIso,
        input.correlationId,
        input.platformAccount.id,
        input.platformAccount.id,
        input.correlationId,
      );
    const audit = this.auditStatement({
      actorUserId: input.actorUserId,
      action: "REFRESH_METRICS",
      targetType: "PLATFORM_ACCOUNT",
      targetId: String(input.platformAccount.id),
      targetLabel: `${input.platformAccount.platform} ${input.platformAccount.channelName}`,
      publicReasonCode: input.reason,
      internalNote: input.internalNote,
      changeSummary: "공식 플랫폼 지표를 수동으로 갱신했습니다.",
      policyVersion: policy.version,
      correlationId: input.correlationId,
      nowIso: input.nowIso,
      guardSql:
        "EXISTS (SELECT 1 FROM streamer_platform_accounts WHERE id = ? AND last_correlation_id = ?)",
      guardBinds: [input.platformAccount.id, input.correlationId],
    });
    const results = await this.db.batch([accountUpdate, reviews, audit]);
    const applied = Number(results[0]?.meta?.changes ?? 0) > 0;
    return {
      applied,
      ...(applied ? {} : { code: "CONFLICT" as const }),
      rowVersion: applied ? input.expectedVersion + 1 : null,
    };
  }
}
