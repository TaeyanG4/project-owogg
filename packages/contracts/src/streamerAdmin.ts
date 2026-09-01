import { z } from "zod";
import {
  StreamerPlatformApprovalStatusSchema,
  StreamerPlatformSchema,
  StreamerStatusSchema,
} from "./streamer.js";
import { PermissionSchema } from "./staffRoles.js";

const PositiveIdSchema = z.number().int().positive();
const IsoDateTimeSchema = z.string().datetime();

export const StreamerAdminPageSizeSchema = z.union([
  z.literal(10),
  z.literal(20),
  z.literal(30),
  z.literal(50),
]);
export type StreamerAdminPageSize = z.infer<typeof StreamerAdminPageSizeSchema>;

export const StreamerAdminSectionSchema = z.enum([
  "OVERVIEW",
  "STREAMERS",
  "REVIEWS",
  "POLICY",
  "PROVIDERS",
  "AUDIT",
]);
export type StreamerAdminSection = z.infer<typeof StreamerAdminSectionSchema>;

export const StreamerAdminSectionSourceSchema = z.enum(["LIVE", "UNAVAILABLE"]);
export type StreamerAdminSectionSource = z.infer<typeof StreamerAdminSectionSourceSchema>;

export const StreamerOwnershipStatusSchema = z.enum([
  "UNVERIFIED",
  "VERIFIED",
  "DISCONNECTED",
  "INVALIDATED",
  "EXPIRED",
]);
export type StreamerOwnershipStatus = z.infer<typeof StreamerOwnershipStatusSchema>;

export const StreamerReviewTypeSchema = z.enum([
  "INITIAL",
  "RECONSIDERATION",
  "OWNERSHIP_REVERIFY",
]);
export type StreamerReviewTypeValue = z.infer<typeof StreamerReviewTypeSchema>;
export const StreamerReviewRequestSourceSchema = z.enum(["USER", "ADMIN", "MIGRATION"]);
export const StreamerReviewWorkStateSchema = z.enum([
  "QUEUED",
  "ON_HOLD",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
]);
export type StreamerReviewWorkState = z.infer<typeof StreamerReviewWorkStateSchema>;
export const StreamerReviewDecisionCodeSchema = z.enum([
  "STREAMER_APPROVED",
  "STREAMER_REJECTED",
  "REAUTH_REQUIRED",
]);
export type StreamerReviewDecisionCode = z.infer<typeof StreamerReviewDecisionCodeSchema>;

export const StreamerPolicyFieldSchema = z.enum([
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
]);
export type StreamerPolicyField = z.infer<typeof StreamerPolicyFieldSchema>;

const StreamerPolicyValuesObjectSchema = z
  .object({
    minimumAudience: z.number().int().nonnegative(),
    minimumChannelAgeDays: z.number().int().nonnegative(),
    ownershipValidityDays: z.number().int().positive(),
    reverificationNoticeDays: z.number().int().nonnegative(),
    verificationIntentTtlMinutes: z.number().int().positive(),
    claimLeaseMinutes: z.number().int().positive(),
    reviewSlaHours: z.number().int().positive(),
    holdDefaultHours: z.number().int().positive(),
    reconsiderationCooldownDays: z.number().int().nonnegative(),
    providerTimeoutSeconds: z.number().int().positive(),
  })
  .strict();

export const StreamerPolicyValuesSchema = StreamerPolicyValuesObjectSchema.superRefine(
  (values, ctx) => {
    if (values.reverificationNoticeDays >= values.ownershipValidityDays) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reverificationNoticeDays"],
        message: "reverification notice must begin before ownership expires",
      });
    }
  },
);
export type StreamerPolicyValues = z.infer<typeof StreamerPolicyValuesSchema>;

export const StreamerPolicyUnitSchema = z.enum(["PEOPLE", "DAYS", "HOURS", "MINUTES", "SECONDS"]);
export type StreamerPolicyUnit = z.infer<typeof StreamerPolicyUnitSchema>;
export const StreamerPolicyFieldConstraintSchema = z
  .object({
    field: StreamerPolicyFieldSchema,
    unit: StreamerPolicyUnitSchema,
    minimum: z.number().int().nonnegative(),
    maximum: z.number().int().positive(),
    step: z.number().int().positive(),
  })
  .strict()
  .refine((value) => value.maximum >= value.minimum, {
    message: "maximum must be greater than or equal to minimum",
    path: ["maximum"],
  });
export type StreamerPolicyFieldConstraint = z.infer<typeof StreamerPolicyFieldConstraintSchema>;

export const StreamerPolicyVersionSchema = z
  .object({
    version: z.number().int().positive(),
    values: StreamerPolicyValuesSchema,
    reason: z.string().trim().min(3).max(1000),
    updatedAt: IsoDateTimeSchema,
    updatedBy: z.string().min(1),
  })
  .strict();
export type StreamerPolicyVersion = z.infer<typeof StreamerPolicyVersionSchema>;

export const StreamerAdminConditionSchema = z
  .object({
    field: z.enum(["OWNERSHIP", "AUDIENCE", "CHANNEL_AGE", "PROVIDER_CONTRACT"]),
    result: z.enum(["PASS", "FAIL", "UNKNOWN"]),
    actual: z.number().nullable(),
    required: z.number().nullable(),
    unit: StreamerPolicyUnitSchema.nullable(),
    reasonCode: z.string().min(1),
  })
  .strict();
export const StreamerAdminEvidenceSchema = z
  .object({
    observedAt: IsoDateTimeSchema,
    policyVersion: z.number().int().positive(),
    audienceCount: z.number().int().nonnegative().nullable(),
    channelAgeDays: z.number().int().nonnegative().nullable(),
    metricsSyncedAt: IsoDateTimeSchema.nullable(),
    conditions: z.array(StreamerAdminConditionSchema),
  })
  .strict();

export const StreamerAdminPlatformAccountSchema = z
  .object({
    id: PositiveIdSchema,
    platform: StreamerPlatformSchema,
    maskedCanonicalId: z.string().min(1),
    channelName: z.string().min(1),
    channelHandle: z.string().nullable(),
    channelUrl: z.string().url(),
    avatarUrl: z.string().url().nullable(),
    verificationStatus: StreamerOwnershipStatusSchema,
    verifiedAt: IsoDateTimeSchema.nullable(),
    ownershipExpiresAt: IsoDateTimeSchema.nullable(),
    approvalStatus: StreamerPlatformApprovalStatusSchema,
    approvalReasonCode: z.string().nullable(),
    approvedAt: IsoDateTimeSchema.nullable(),
    audienceCount: z.number().int().nonnegative().nullable(),
    channelCreatedAt: IsoDateTimeSchema.nullable(),
    metricsSyncedAt: IsoDateTimeSchema.nullable(),
    rowVersion: z.number().int().nonnegative(),
  })
  .strict();
export type StreamerAdminPlatformAccount = z.infer<typeof StreamerAdminPlatformAccountSchema>;

export const StreamerAdminRosterItemSchema = z
  .object({
    streamerId: PositiveIdSchema,
    userId: PositiveIdSchema,
    nickname: z.string().min(1),
    avatarUrl: z.string().url().nullable(),
    programStatus: StreamerStatusSchema,
    suspendedUntil: IsoDateTimeSchema.nullable(),
    approvedPlatformCount: z.number().int().nonnegative(),
    pendingReviewCount: z.number().int().nonnegative(),
    latestReviewState: StreamerReviewWorkStateSchema.nullable(),
    nextActionAt: IsoDateTimeSchema.nullable(),
    platformAccounts: z.array(StreamerAdminPlatformAccountSchema),
    rowVersion: z.number().int().nonnegative(),
  })
  .strict();
export type StreamerAdminRosterItem = z.infer<typeof StreamerAdminRosterItemSchema>;

export const StreamerAdminReviewItemSchema = z
  .object({
    id: PositiveIdSchema,
    parentReviewId: PositiveIdSchema.nullable(),
    reviewType: StreamerReviewTypeSchema,
    requestedBy: StreamerReviewRequestSourceSchema,
    workState: StreamerReviewWorkStateSchema,
    decisionCode: StreamerReviewDecisionCodeSchema.nullable(),
    streamerId: PositiveIdSchema,
    userId: PositiveIdSchema,
    nickname: z.string().min(1),
    platformAccount: StreamerAdminPlatformAccountSchema,
    priority: z.enum(["NORMAL", "HIGH", "URGENT"]),
    dueAt: IsoDateTimeSchema,
    claimedBy: z
      .object({ userId: PositiveIdSchema, nickname: z.string().min(1) })
      .strict()
      .nullable(),
    claimExpiresAt: IsoDateTimeSchema.nullable(),
    holdUntil: IsoDateTimeSchema.nullable(),
    publicReasonCode: z.string().nullable(),
    internalNote: z.string().max(1000).nullable(),
    evidence: StreamerAdminEvidenceSchema,
    rowVersion: z.number().int().nonnegative(),
  })
  .strict();
export type StreamerAdminReviewItem = z.infer<typeof StreamerAdminReviewItemSchema>;

export const StreamerProviderOperationSchema = z
  .object({
    platform: StreamerPlatformSchema,
    displayName: z.string().min(1),
    ownership: z.enum(["READY", "UNAVAILABLE"]),
    metricRefresh: z.enum(["READY", "UNAVAILABLE"]),
    reasonCode: z.enum([
      "READY",
      "DISABLED",
      "MISSING_CONFIG",
      "PARTIAL_CONFIG",
      "CONTRACT_UNVERIFIED",
      "PAUSED",
    ]),
    credentialState: z.enum(["COMPLETE", "MISSING", "PARTIAL"]),
    newConnectionsPaused: z.boolean(),
    pendingReviews: z.number().int().nonnegative(),
    lastSuccessfulConnectionAt: IsoDateTimeSchema.nullable(),
    rowVersion: z.number().int().nonnegative(),
  })
  .strict();
export type StreamerProviderOperation = z.infer<typeof StreamerProviderOperationSchema>;

export const StreamerAdminAuditEntrySchema = z
  .object({
    id: z.string().min(1),
    createdAt: IsoDateTimeSchema,
    actor: z.string().min(1),
    action: z.string().min(1),
    targetType: z.enum(["STREAMER", "PLATFORM_ACCOUNT", "REVIEW", "POLICY", "PROVIDER"]),
    targetLabel: z.string().min(1),
    publicReasonCode: z.string().nullable(),
    internalNote: z.string().max(1000).nullable(),
    changeSummary: z.string().min(1),
    policyVersion: z.number().int().positive().nullable(),
    correlationId: z.string().min(1),
  })
  .strict();
export type StreamerAdminAuditEntry = z.infer<typeof StreamerAdminAuditEntrySchema>;

function pagedSchema<T extends z.ZodTypeAny>(item: T) {
  return z
    .object({
      items: z.array(item),
      total: z.number().int().nonnegative(),
      page: z.number().int().positive(),
      pageSize: StreamerAdminPageSizeSchema,
      totalPages: z.number().int().positive(),
    })
    .strict();
}

export const StreamerAdminWorkspaceQuerySchema = z
  .object({
    overviewPage: z.coerce.number().int().positive().default(1),
    overviewPageSize: StreamerAdminPageSizeSchema.default(10),
    rosterPage: z.coerce.number().int().positive().default(1),
    rosterPageSize: StreamerAdminPageSizeSchema.default(20),
    rosterQuery: z.string().trim().max(100).default(""),
    rosterPlatform: z.union([z.literal("ALL"), StreamerPlatformSchema]).default("ALL"),
    rosterApproval: z
      .union([z.literal("ALL"), StreamerPlatformApprovalStatusSchema])
      .default("ALL"),
    reviewPage: z.coerce.number().int().positive().default(1),
    reviewPageSize: StreamerAdminPageSizeSchema.default(20),
    reviewQuery: z.string().trim().max(100).default(""),
    reviewAssignment: z.enum(["ALL", "UNASSIGNED", "MINE"]).default("ALL"),
    reviewState: z.union([z.literal("ALL"), StreamerReviewWorkStateSchema]).default("ALL"),
    policyPage: z.coerce.number().int().positive().default(1),
    policyPageSize: StreamerAdminPageSizeSchema.default(10),
    auditPage: z.coerce.number().int().positive().default(1),
    auditPageSize: StreamerAdminPageSizeSchema.default(20),
    auditQuery: z.string().trim().max(100).default(""),
    auditTarget: z
      .enum(["ALL", "STREAMER", "PLATFORM_ACCOUNT", "REVIEW", "POLICY", "PROVIDER"])
      .default("ALL"),
  })
  .strict();
export type StreamerAdminWorkspaceQuery = z.infer<typeof StreamerAdminWorkspaceQuerySchema>;
export const DEFAULT_STREAMER_ADMIN_WORKSPACE_QUERY = StreamerAdminWorkspaceQuerySchema.parse({});

export const StreamerAdminWorkspaceDataSchema = z
  .object({
    generatedAt: IsoDateTimeSchema,
    permissions: z.array(PermissionSchema),
    sectionSources: z
      .object({
        OVERVIEW: StreamerAdminSectionSourceSchema,
        STREAMERS: StreamerAdminSectionSourceSchema,
        REVIEWS: StreamerAdminSectionSourceSchema,
        POLICY: StreamerAdminSectionSourceSchema,
        PROVIDERS: StreamerAdminSectionSourceSchema,
        AUDIT: StreamerAdminSectionSourceSchema,
      })
      .strict(),
    overview: z
      .object({
        totalApplicants: z.number().int().nonnegative(),
        approvedStreamers: z.number().int().nonnegative(),
        suspendedStreamers: z.number().int().nonnegative(),
        connectedPlatforms: z.number().int().nonnegative(),
        pendingPlatformReviews: z.number().int().nonnegative(),
        ownershipExpiringSoon: z.number().int().nonnegative(),
        unassignedReviews: z.number().int().nonnegative(),
        myClaimedReviews: z.number().int().nonnegative(),
        overdueReviews: z.number().int().nonnegative(),
      })
      .strict(),
    overviewQueue: pagedSchema(StreamerAdminReviewItemSchema),
    roster: pagedSchema(StreamerAdminRosterItemSchema),
    reviews: pagedSchema(StreamerAdminReviewItemSchema),
    policy: z
      .object({
        current: StreamerPolicyVersionSchema,
        constraints: z.array(StreamerPolicyFieldConstraintSchema),
        history: pagedSchema(StreamerPolicyVersionSchema),
      })
      .strict()
      .nullable(),
    providers: z.array(StreamerProviderOperationSchema),
    audits: pagedSchema(StreamerAdminAuditEntrySchema),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (!data.policy) return;
    const constraints = new Map(
      data.policy.constraints.map((constraint) => [constraint.field, constraint]),
    );
    for (const field of StreamerPolicyFieldSchema.options) {
      const constraint = constraints.get(field);
      if (!constraint) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["policy", "constraints"],
          message: "missing policy constraint: " + field,
        });
        continue;
      }
      const value = data.policy.current.values[field];
      if (
        value < constraint.minimum ||
        value > constraint.maximum ||
        (value - constraint.minimum) % constraint.step !== 0
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["policy", "current", "values", field],
          message: "policy value violates its field constraint",
        });
      }
    }
  });
export type StreamerAdminWorkspaceData = z.infer<typeof StreamerAdminWorkspaceDataSchema>;

export const StreamerAdminActionSchema = z.enum([
  "CREATE_REVIEW",
  "CANCEL_REVIEW",
  "CLAIM_REVIEW",
  "RELEASE_REVIEW",
  "HOLD_REVIEW",
  "APPROVE_STREAMER",
  "REJECT_STREAMER",
  "REQUEST_REAUTH",
  "REFRESH_METRICS",
  "CREATE_RECONSIDERATION",
  "REVOKE_STREAMER_APPROVAL",
  "INVALIDATE_OWNERSHIP",
  "DISCONNECT_PLATFORM_ACCOUNT",
  "SUSPEND_STREAMER",
  "RESTORE_STREAMER",
  "SAVE_POLICY",
  "PAUSE_PROVIDER_CONNECTIONS",
  "RESUME_PROVIDER_CONNECTIONS",
]);
export type StreamerAdminAction = z.infer<typeof StreamerAdminActionSchema>;

export const StreamerAdminActionRequestSchema = z
  .object({
    action: StreamerAdminActionSchema,
    targetId: z.string().min(1),
    expectedVersion: z.number().int().nonnegative().nullable(),
    reason: z.string().trim().min(3).max(1000),
    internalNote: z.string().trim().max(1000).nullable(),
    effectiveAt: IsoDateTimeSchema.nullable(),
    policyValues: StreamerPolicyValuesSchema.nullable(),
  })
  .strict()
  .superRefine((request, ctx) => {
    if (request.action === "SAVE_POLICY" && request.policyValues === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["policyValues"],
        message: "SAVE_POLICY requires typed policy values",
      });
    }
    if (request.action !== "SAVE_POLICY" && request.policyValues !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["policyValues"],
        message: "policyValues are only accepted by SAVE_POLICY",
      });
    }
  });
export type StreamerAdminActionRequest = z.infer<typeof StreamerAdminActionRequestSchema>;

export const StreamerAdminActionResponseSchema = z
  .object({
    applied: z.boolean(),
    action: StreamerAdminActionSchema,
    correlationId: z.string().min(1),
    rowVersion: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type StreamerAdminActionResponse = z.infer<typeof StreamerAdminActionResponseSchema>;
