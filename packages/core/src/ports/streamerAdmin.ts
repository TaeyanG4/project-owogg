import type {
  StreamerPlatformAccount,
  StreamerPlatformApprovalStatusType,
  StreamerPlatformType,
  StreamerStatusType,
} from "./repositories.js";

export type StreamerAdminPageSize = 10 | 20 | 30 | 50;
export type StreamerReviewWorkState = "QUEUED" | "ON_HOLD" | "APPROVED" | "REJECTED" | "CANCELLED";
export type StreamerAdminReviewType = "INITIAL" | "RECONSIDERATION" | "OWNERSHIP_REVERIFY";
export type StreamerReviewDecisionCode =
  "STREAMER_APPROVED" | "STREAMER_REJECTED" | "REAUTH_REQUIRED";

export interface StreamerPolicyValues {
  minimumAudience: number;
  minimumChannelAgeDays: number;
  ownershipValidityDays: number;
  reverificationNoticeDays: number;
  verificationIntentTtlMinutes: number;
  claimLeaseMinutes: number;
  reviewSlaHours: number;
  holdDefaultHours: number;
  reconsiderationCooldownDays: number;
  providerTimeoutSeconds: number;
}

export type StreamerPolicyField = keyof StreamerPolicyValues;
export interface StreamerPolicyConstraint {
  field: StreamerPolicyField;
  unit: "PEOPLE" | "DAYS" | "HOURS" | "MINUTES" | "SECONDS";
  minimum: number;
  maximum: number;
  step: number;
}

export interface StreamerPolicyVersion {
  version: number;
  values: StreamerPolicyValues;
  reason: string;
  updatedAt: string;
  updatedBy: string;
}

export interface StreamerAdminWorkspaceQuery {
  overviewPage: number;
  overviewPageSize: StreamerAdminPageSize;
  rosterPage: number;
  rosterPageSize: StreamerAdminPageSize;
  rosterQuery: string;
  rosterPlatform: "ALL" | StreamerPlatformType;
  rosterApproval: "ALL" | StreamerPlatformApprovalStatusType;
  reviewPage: number;
  reviewPageSize: StreamerAdminPageSize;
  reviewQuery: string;
  reviewAssignment: "ALL" | "UNASSIGNED" | "MINE";
  reviewState: "ALL" | StreamerReviewWorkState;
  policyPage: number;
  policyPageSize: StreamerAdminPageSize;
  auditPage: number;
  auditPageSize: StreamerAdminPageSize;
  auditQuery: string;
  auditTarget: "ALL" | "STREAMER" | "PLATFORM_ACCOUNT" | "REVIEW" | "POLICY" | "PROVIDER";
}

export interface StreamerAdminPlatformAccount {
  id: number;
  platform: StreamerPlatformType;
  maskedCanonicalId: string;
  channelName: string;
  channelHandle: string | null;
  channelUrl: string;
  avatarUrl: string | null;
  verificationStatus: "UNVERIFIED" | "VERIFIED" | "DISCONNECTED" | "INVALIDATED" | "EXPIRED";
  verifiedAt: string | null;
  ownershipExpiresAt: string | null;
  approvalStatus: StreamerPlatformApprovalStatusType;
  approvalReasonCode: string | null;
  approvedAt: string | null;
  audienceCount: number | null;
  channelCreatedAt: string | null;
  metricsSyncedAt: string | null;
  rowVersion: number;
}

export interface StreamerAdminCondition {
  field: "OWNERSHIP" | "AUDIENCE" | "CHANNEL_AGE" | "PROVIDER_CONTRACT";
  result: "PASS" | "FAIL" | "UNKNOWN";
  actual: number | null;
  required: number | null;
  unit: "PEOPLE" | "DAYS" | "HOURS" | "MINUTES" | "SECONDS" | null;
  reasonCode: string;
}

export interface StreamerAdminEvidence {
  observedAt: string;
  policyVersion: number;
  audienceCount: number | null;
  channelAgeDays: number | null;
  metricsSyncedAt: string | null;
  conditions: StreamerAdminCondition[];
}

export interface StreamerAdminRosterItem {
  streamerId: number;
  userId: number;
  nickname: string;
  avatarUrl: string | null;
  programStatus: StreamerStatusType;
  suspendedUntil: string | null;
  approvedPlatformCount: number;
  pendingReviewCount: number;
  latestReviewState: StreamerReviewWorkState | null;
  nextActionAt: string | null;
  platformAccounts: StreamerAdminPlatformAccount[];
  rowVersion: number;
}

export interface StreamerAdminReviewItem {
  id: number;
  parentReviewId: number | null;
  reviewType: StreamerAdminReviewType;
  requestedBy: "USER" | "ADMIN" | "MIGRATION";
  workState: StreamerReviewWorkState;
  decisionCode: StreamerReviewDecisionCode | null;
  streamerId: number;
  userId: number;
  nickname: string;
  platformAccount: StreamerAdminPlatformAccount;
  priority: "NORMAL" | "HIGH" | "URGENT";
  dueAt: string;
  claimedBy: { userId: number; nickname: string } | null;
  claimExpiresAt: string | null;
  holdUntil: string | null;
  publicReasonCode: string | null;
  internalNote: string | null;
  evidence: StreamerAdminEvidence;
  rowVersion: number;
}

export interface StreamerProviderSetting {
  platform: StreamerPlatformType;
  newConnectionsPaused: boolean;
  pendingReviews: number;
  lastSuccessfulConnectionAt: string | null;
  rowVersion: number;
}

export interface StreamerAdminAuditEntry {
  id: string;
  createdAt: string;
  actor: string;
  action: string;
  targetType: "STREAMER" | "PLATFORM_ACCOUNT" | "REVIEW" | "POLICY" | "PROVIDER";
  targetLabel: string;
  publicReasonCode: string | null;
  internalNote: string | null;
  changeSummary: string;
  policyVersion: number | null;
  correlationId: string;
}

export interface StreamerAdminPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: StreamerAdminPageSize;
  totalPages: number;
}

export interface StreamerAdminWorkspaceSnapshot {
  generatedAt: string;
  overview: {
    totalApplicants: number;
    approvedStreamers: number;
    suspendedStreamers: number;
    connectedPlatforms: number;
    pendingPlatformReviews: number;
    ownershipExpiringSoon: number;
    unassignedReviews: number;
    myClaimedReviews: number;
    overdueReviews: number;
  };
  overviewQueue: StreamerAdminPage<StreamerAdminReviewItem>;
  roster: StreamerAdminPage<StreamerAdminRosterItem>;
  reviews: StreamerAdminPage<StreamerAdminReviewItem>;
  policy: {
    current: StreamerPolicyVersion;
    constraints: StreamerPolicyConstraint[];
    history: StreamerAdminPage<StreamerPolicyVersion>;
  } | null;
  providerSettings: StreamerProviderSetting[];
  audits: StreamerAdminPage<StreamerAdminAuditEntry>;
}

export type StreamerAdminAction =
  | "CREATE_REVIEW"
  | "CANCEL_REVIEW"
  | "CLAIM_REVIEW"
  | "RELEASE_REVIEW"
  | "HOLD_REVIEW"
  | "APPROVE_STREAMER"
  | "REJECT_STREAMER"
  | "REQUEST_REAUTH"
  | "CREATE_RECONSIDERATION"
  | "REVOKE_STREAMER_APPROVAL"
  | "INVALIDATE_OWNERSHIP"
  | "SUSPEND_STREAMER"
  | "RESTORE_STREAMER"
  | "SAVE_POLICY"
  | "PAUSE_PROVIDER_CONNECTIONS"
  | "RESUME_PROVIDER_CONNECTIONS";

export interface StreamerAdminActionInput {
  action: StreamerAdminAction;
  targetId: string;
  expectedVersion: number | null;
  actorUserId: number;
  reason: string;
  internalNote: string | null;
  effectiveAt: string | null;
  policyValues: StreamerPolicyValues | null;
  correlationId: string;
  nowIso: string;
}

export interface StreamerAdminActionResult {
  applied: boolean;
  code?:
    | "NOT_FOUND"
    | "CONFLICT"
    | "OWNERSHIP_NOT_VERIFIED"
    | "CLAIMED_BY_OTHER"
    | "ACTIVE_REVIEW_EXISTS"
    | "INVALID_ACTION";
  rowVersion: number | null;
}

export interface StreamerAdminRepository {
  getActivePolicy(): Promise<StreamerPolicyVersion | null>;
  isProviderConnectionPaused(platform: StreamerPlatformType): Promise<boolean>;
  getWorkspace(
    query: StreamerAdminWorkspaceQuery,
    reviewerUserId: number,
  ): Promise<StreamerAdminWorkspaceSnapshot>;
  applyAction(input: StreamerAdminActionInput): Promise<StreamerAdminActionResult>;
  recordMetricRefresh(input: {
    platformAccount: StreamerPlatformAccount;
    expectedVersion: number;
    audienceCount: number | null;
    channelCreatedAt: string | null;
    actorUserId: number;
    reason: string;
    internalNote: string | null;
    correlationId: string;
    nowIso: string;
  }): Promise<StreamerAdminActionResult>;
}
