import { z } from "zod";

/**
 * `eligible` = ADMIN_USER_IDS root eligibility OR an active managed admin_accounts row.
 * `adminAuthenticated` = an active elevated admin session exists (fresh Google step-up + admin
 * username/password already completed). `stepUpRequired` is true whenever an eligible user still
 * needs to complete step-up/login. `bootstrapAvailable` is true when the eligible user has
 * completed step-up but no administrator account exists yet anywhere — the client should show
 * the one-time first-admin setup form instead of a login form. `mustChangePassword` is true once
 * logged in with a managed account still carrying a forced password change. Never includes
 * ADMIN_USER_IDS/ADMIN_GOOGLE_SUBS/ADMIN_LOGIN_USERNAME/password hash/challenge internals.
 */
export const AdminMeResponseSchema = z.object({
  authenticated: z.boolean(),
  eligible: z.boolean(),
  adminAuthenticated: z.boolean(),
  stepUpRequired: z.boolean(),
  bootstrapAvailable: z.boolean(),
  mustChangePassword: z.boolean(),
  role: z.enum(["ADMIN", "OPERATOR", "MODERATOR", "SYSTEM_DEVELOPER"]).nullable(),
});
export type AdminMeResponse = z.infer<typeof AdminMeResponseSchema>;

export const AdminGoogleStepUpRequestSchema = z.object({
  credential: z.string().min(1),
});
export type AdminGoogleStepUpRequest = z.infer<typeof AdminGoogleStepUpRequestSchema>;

export const AdminGoogleStepUpResponseSchema = z.object({
  stepUpVerified: z.boolean(),
});
export type AdminGoogleStepUpResponse = z.infer<typeof AdminGoogleStepUpResponseSchema>;

export const AdminLoginRequestSchema = z.object({
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(500),
});
export type AdminLoginRequest = z.infer<typeof AdminLoginRequestSchema>;

export const AdminLoginResponseSchema = z.object({
  adminAuthenticated: z.boolean(),
  mustChangePassword: z.boolean(),
});
export type AdminLoginResponse = z.infer<typeof AdminLoginResponseSchema>;

// ---------------------------------------------------------------------------
// Managed administrator accounts (D1) — bootstrap, password change, account management
// ---------------------------------------------------------------------------

const ADMIN_USERNAME_SCHEMA = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(/^[a-zA-Z0-9_.-]+$/, "영문/숫자/._- 조합만 가능합니다.");
const ADMIN_NEW_PASSWORD_SCHEMA = z.string().min(12).max(200);

export const AdminAccountRoleSchema = z.enum([
  "ADMIN",
  "OPERATOR",
  "MODERATOR",
  "SYSTEM_DEVELOPER",
]);
export type AdminAccountRoleValue = z.infer<typeof AdminAccountRoleSchema>;

export const AdminAccountStatusSchema = z.enum(["ACTIVE", "DISABLED"]);
export type AdminAccountStatusValue = z.infer<typeof AdminAccountStatusSchema>;

/** First-admin bootstrap — only reachable while zero administrator accounts exist anywhere and
 * only after a fresh Google step-up bound to the current OwOGG account. */
export const AdminBootstrapRequestSchema = z
  .object({
    username: ADMIN_USERNAME_SCHEMA,
    password: ADMIN_NEW_PASSWORD_SCHEMA,
    passwordConfirm: z.string(),
  })
  .refine((v) => v.password === v.passwordConfirm, {
    message: "비밀번호가 일치하지 않습니다.",
    path: ["passwordConfirm"],
  });
export type AdminBootstrapRequest = z.infer<typeof AdminBootstrapRequestSchema>;

export const AdminBootstrapResponseSchema = z.object({
  adminAuthenticated: z.boolean(),
  mustChangePassword: z.boolean(),
});
export type AdminBootstrapResponse = z.infer<typeof AdminBootstrapResponseSchema>;

/** Self password change — requires the current elevated admin session and the current password. */
export const AdminPasswordChangeRequestSchema = z
  .object({
    currentPassword: z.string().min(1).max(500),
    newPassword: ADMIN_NEW_PASSWORD_SCHEMA,
    newPasswordConfirm: z.string(),
  })
  .refine((v) => v.newPassword === v.newPasswordConfirm, {
    message: "새 비밀번호가 일치하지 않습니다.",
    path: ["newPasswordConfirm"],
  });
export type AdminPasswordChangeRequest = z.infer<typeof AdminPasswordChangeRequestSchema>;

export const AdminPasswordChangeResponseSchema = z.object({ success: z.boolean() });
export type AdminPasswordChangeResponse = z.infer<typeof AdminPasswordChangeResponseSchema>;

/** Safe administrator account summary — never includes password_hash or google_sub. */
export const AdminAccountSummarySchema = z.object({
  id: z.number().int().positive(),
  userId: z.number().int().positive(),
  nickname: z.string(),
  username: z.string(),
  role: AdminAccountRoleSchema,
  status: AdminAccountStatusSchema,
  mustChangePassword: z.boolean(),
  createdAt: z.string(),
  passwordChangedAt: z.string(),
  isSelf: z.boolean(),
});
export type AdminAccountSummary = z.infer<typeof AdminAccountSummarySchema>;

export const AdminAccountListResponseSchema = z.object({
  accounts: z.array(AdminAccountSummarySchema),
});
export type AdminAccountListResponse = z.infer<typeof AdminAccountListResponseSchema>;

/** ADMIN-only: creates another administrator bound to an existing OwOGG user whose Google
 * identity is derived server-side from that user's already-linked oauth_accounts row — never
 * accepted as free-text input here. */
export const AdminAccountCreateRequestSchema = z.object({
  userId: z.number().int().positive(),
  username: ADMIN_USERNAME_SCHEMA,
  password: ADMIN_NEW_PASSWORD_SCHEMA,
  role: AdminAccountRoleSchema,
});
export type AdminAccountCreateRequest = z.infer<typeof AdminAccountCreateRequestSchema>;

export const AdminAccountStatusChangeRequestSchema = z.object({ status: AdminAccountStatusSchema });
export type AdminAccountStatusChangeRequest = z.infer<typeof AdminAccountStatusChangeRequestSchema>;

export const AdminAccountRoleChangeRequestSchema = z.object({ role: AdminAccountRoleSchema });
export type AdminAccountRoleChangeRequest = z.infer<typeof AdminAccountRoleChangeRequestSchema>;

export const AdminAccountPasswordResetRequestSchema = z.object({
  newPassword: ADMIN_NEW_PASSWORD_SCHEMA,
});
export type AdminAccountPasswordResetRequest = z.infer<
  typeof AdminAccountPasswordResetRequestSchema
>;

export const AdminAccountAuditEntrySchema = z.object({
  id: z.number().int().positive(),
  actorAdminId: z.number().int().positive().nullable(),
  targetAdminId: z.number().int().positive().nullable(),
  action: z.enum([
    "ADMIN_CREATED",
    "ADMIN_DISABLED",
    "ADMIN_ENABLED",
    "ROLE_CHANGED",
    "PASSWORD_CHANGED",
    "PASSWORD_RESET",
    "SESSIONS_REVOKED",
    "PERMISSION_GRANTED",
    "PERMISSION_REVOKED",
    "ROLE_PERMISSIONS_UPDATED",
  ]),
  metadata: z.record(z.unknown()).nullable(),
  createdAt: z.string(),
});
export type AdminAccountAuditEntry = z.infer<typeof AdminAccountAuditEntrySchema>;

export const AdminAccountAuditListResponseSchema = z.object({
  entries: z.array(AdminAccountAuditEntrySchema),
});
export type AdminAccountAuditListResponse = z.infer<typeof AdminAccountAuditListResponseSchema>;

export const AdminOverviewResponseSchema = z.object({
  pendingStreamerReviews: z.number().int().nonnegative(),
  recentAudits: z.array(
    z.object({
      action: z.string(),
      platform: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
  discord: z.object({
    interactionsConfigured: z.boolean(),
    activeGuildCount: z.number().int().nonnegative(),
    oauthConfigured: z.boolean(),
    installUrlConfigured: z.boolean(),
    commandSyncEnabled: z.boolean(),
    expectedInteractionsEndpoint: z.string(),
    localSubcommands: z.array(z.string()),
  }),
  streamerProviders: z.record(z.boolean()),
});
export type AdminOverviewResponse = z.infer<typeof AdminOverviewResponseSchema>;

export const AdminMonitoringResponseSchema = z.object({
  activeUsers: z.object({
    dau: z.number().int().nonnegative(),
    wau: z.number().int().nonnegative(),
  }),
  gamePlayCounts: z.array(
    z.object({
      gameId: z.string(),
      count: z.number().int().nonnegative(),
    }),
  ),
  /** Number of days getGamePlayCounts was scoped to — echoed back so the UI never has to
   * hardcode what "recent" means server-side. */
  gamePlayCountsWindowDays: z.number().int().positive(),
  d1: z.object({
    healthy: z.boolean(),
    latencyMs: z.number().nonnegative(),
  }),
});
export type AdminMonitoringResponse = z.infer<typeof AdminMonitoringResponseSchema>;

export const AdminPaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
export type AdminPaginationQuery = z.infer<typeof AdminPaginationQuerySchema>;

// ── User moderation (suspend/ban, score-submission block, score reset/restore) ──

export const UserModerationStatusSchema = z.enum(["ACTIVE", "SUSPENDED", "BANNED"]);

/** Temporary account suspensions are deliberately limited to operator-approved presets. The
 * API calculates the expiry itself so a client cannot submit an arbitrary timestamp. */
export const UserSuspensionDurationDaysSchema = z.union([
  z.literal(7),
  z.literal(30),
  z.literal(180),
]);
export type UserSuspensionDurationDays = z.infer<typeof UserSuspensionDurationDaysSchema>;

/** "createdAt_desc" = 최근 가입일순 (newest first, default). "createdAt_asc" = 최초 가입일순
 * (oldest/earliest first). */
export const AdminUserSortSchema = z.enum(["createdAt_desc", "createdAt_asc"]);
export type AdminUserSort = z.infer<typeof AdminUserSortSchema>;

/** UTC-calendar-based signup window filter: 오늘/이번주/이번달 가입, or "all" for no filter. */
export const AdminUserPeriodSchema = z.enum(["all", "today", "week", "month"]);
export type AdminUserPeriod = z.infer<typeof AdminUserPeriodSchema>;

export const AdminUserListQuerySchema = z.object({
  query: z.string().trim().optional(),
  period: AdminUserPeriodSchema.default("all"),
  sort: AdminUserSortSchema.default("createdAt_desc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type AdminUserListQuery = z.infer<typeof AdminUserListQuerySchema>;

export const AdminUserSearchResultSchema = z.object({
  id: z.number().int(),
  nickname: z.string(),
  email: z.string().nullable(),
  createdAt: z.string(),
  moderationStatus: UserModerationStatusSchema,
  suspendedUntil: z.string().nullable(),
  scoreSubmissionBlocked: z.boolean(),
  /** True when this row is a root (ADMIN_USER_IDS) or ACTIVE managed administrator account — the
   * client disables suspend/ban for these rows; the server independently refuses the same. */
  isProtectedAdmin: z.boolean(),
});
export type AdminUserSearchResult = z.infer<typeof AdminUserSearchResultSchema>;

export const AdminUserSearchResponseSchema = z.object({
  users: z.array(AdminUserSearchResultSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type AdminUserSearchResponse = z.infer<typeof AdminUserSearchResponseSchema>;

export const UserModerationRecordSchema = z.object({
  userId: z.number().int(),
  status: UserModerationStatusSchema,
  suspendedUntil: z.string().nullable(),
  scoreSubmissionBlocked: z.boolean(),
  reason: z.string().nullable(),
  updatedByAdminId: z.number().int().nullable(),
  updatedAt: z.string(),
});
export type UserModerationRecord = z.infer<typeof UserModerationRecordSchema>;

export const UserModerationAuditEntrySchema = z.object({
  id: z.number().int(),
  userId: z.number().int(),
  actorAdminId: z.number().int(),
  action: z.enum([
    "SUSPENDED",
    "BANNED",
    "UNSUSPENDED",
    "SCORE_SUBMISSION_BLOCKED",
    "SCORE_SUBMISSION_UNBLOCKED",
    "SCORES_RESET",
    "SCORES_RESTORED",
  ]),
  reason: z.string().nullable(),
  metadata: z.record(z.unknown()).nullable(),
  createdAt: z.string(),
});
export type UserModerationAuditEntry = z.infer<typeof UserModerationAuditEntrySchema>;

export const AdminUserDetailResponseSchema = z.object({
  id: z.number().int(),
  nickname: z.string(),
  email: z.string().nullable(),
  createdAt: z.string(),
  providers: z.array(z.string()),
  gameBests: z.array(
    z.object({
      gameId: z.string(),
      score: z.number(),
      formattedScore: z.string(),
    }),
  ),
  moderation: UserModerationRecordSchema.nullable(),
  auditLog: z.array(UserModerationAuditEntrySchema),
  /** See AdminUserSearchResultSchema.isProtectedAdmin. */
  isProtectedAdmin: z.boolean(),
});
export type AdminUserDetailResponse = z.infer<typeof AdminUserDetailResponseSchema>;

export const AdminSuspendUserRequestSchema = z.object({
  durationDays: UserSuspensionDurationDaysSchema,
  reason: z.string().trim().min(1),
});
export type AdminSuspendUserRequest = z.infer<typeof AdminSuspendUserRequestSchema>;

export const AdminBanUserRequestSchema = z.object({
  reason: z.string().trim().min(1),
});
export type AdminBanUserRequest = z.infer<typeof AdminBanUserRequestSchema>;

export const AdminScoreSubmissionBlockRequestSchema = z.object({
  blocked: z.boolean(),
  reason: z.string().nullable().optional(),
});
export type AdminScoreSubmissionBlockRequest = z.infer<
  typeof AdminScoreSubmissionBlockRequestSchema
>;

export const AdminResetScoresRequestSchema = z.object({
  reason: z.string().min(1),
});
export type AdminResetScoresRequest = z.infer<typeof AdminResetScoresRequestSchema>;

export const AdminScoreActionResponseSchema = z.object({
  affectedCount: z.number().int().nonnegative().optional(),
  restoredCount: z.number().int().nonnegative().optional(),
});
export type AdminScoreActionResponse = z.infer<typeof AdminScoreActionResponseSchema>;
