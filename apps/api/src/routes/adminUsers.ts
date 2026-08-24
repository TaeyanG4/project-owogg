import { Hono, type Context } from "hono";
import {
  AdminUserSearchResponseSchema,
  AdminUserDetailResponseSchema,
  AdminUserListQuerySchema,
  AdminSuspendUserRequestSchema,
  AdminBanUserRequestSchema,
  AdminScoreSubmissionBlockRequestSchema,
  AdminResetScoresRequestSchema,
  AdminScoreActionResponseSchema,
  UserModerationRecordSchema,
} from "@owogg/contracts";
import { UserModerationUseCaseFailure, isProtectedStaffRole } from "@owogg/core";
import { createContainer } from "../container.js";
import { isTrustedAdminOrigin, isAdminUserId } from "../auth/admin.js";
import {
  requireElevatedAdmin,
  isElevatedAdminResponse,
  requirePermission,
} from "../auth/adminSession.js";
import { resolveAdminEligibility, resolveEffectiveStaffRole } from "../auth/adminEligibility.js";
import { readB2Config } from "./devGames.js";
import type { ApiEnv } from "./auth.js";

export const adminUsersRouter = new Hono<ApiEnv>();

adminUsersRouter.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  if (["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method.toUpperCase())) {
    if (!isTrustedAdminOrigin(c.req.header("Origin"), c.env.FRONTEND_URL)) {
      return c.json(
        { error: { code: "FORBIDDEN", message: "요청 출처를 확인할 수 없습니다." } },
        403,
      );
    }
  }
  await next();
});

const FAILURE_STATUS: Record<UserModerationUseCaseFailure["code"], number> = {
  USER_NOT_FOUND: 404,
  REASON_REQUIRED: 400,
  INVALID_SUSPENSION_DURATION: 400,
};

const FAILURE_MESSAGE: Record<UserModerationUseCaseFailure["code"], string> = {
  USER_NOT_FOUND: "존재하지 않는 사용자입니다.",
  REASON_REQUIRED: "사유를 입력해야 합니다.",
  INVALID_SUSPENSION_DURATION: "임시정지는 7일, 30일, 180일 중 하나여야 합니다.",
};

/** Maps a UserModerationUseCaseFailure to `{ body, status }` for `c.json(body, status)` — every
 * mutating route below follows the same try/catch shape, so this stays in one place instead of
 * being duplicated six times. Re-throws anything that isn't a UserModerationUseCaseFailure so
 * genuinely unexpected errors still surface as 500s instead of being silently swallowed. */
function moderationErrorResponse(err: unknown): { body: unknown; status: 400 | 404 } {
  if (!(err instanceof UserModerationUseCaseFailure)) throw err;
  return {
    body: { error: { code: err.code, message: FAILURE_MESSAGE[err.code] } },
    status: FAILURE_STATUS[err.code] as 400 | 404,
  };
}

/** True when `userId` resolves to the top Staff Role (ADMIN — root ADMIN_USER_IDS or a managed
 * admin_accounts row with role ADMIN; see domain/staffRoles.ts's isProtectedStaffRole). Reused
 * both to surface `isProtectedAdmin` on list/detail responses and to hard-block suspend/ban
 * server-side, so a protected ADMIN can never be locked out of their own login even by direct API
 * calls. Deliberately narrower than "any elevated admin" — an OPERATOR/MODERATOR/SYSTEM_DEVELOPER
 * is not protected here (see docs/AUTHORIZATION.md's "Protected ADMIN" section for why this is a
 * Staff-Role-specific guarantee, not a general one). */
async function isProtectedAdminTarget(
  c: Context<ApiEnv>,
  container: ReturnType<typeof createContainer>,
  userId: number,
): Promise<boolean> {
  const eligibility = await resolveAdminEligibility(
    userId,
    c.env.ADMIN_USER_IDS,
    container.adminAccountUseCases,
  );
  return isProtectedStaffRole(resolveEffectiveStaffRole(eligibility));
}

// GET /api/admin/users?query=&period=&sort=&page=&pageSize= — blank query lists every user
// (subject to `period`), so this also powers the plain "browse all users" list, not just search.
adminUsersRouter.get("/", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "users.view");
  if (denied) return denied;

  const parsed = AdminUserListQuerySchema.safeParse({
    query: c.req.query("query"),
    period: c.req.query("period"),
    sort: c.req.query("sort"),
    page: c.req.query("page"),
    pageSize: c.req.query("pageSize"),
  });
  if (!parsed.success) {
    return c.json(
      { error: { code: "INVALID_REQUEST", message: "잘못된 검색/정렬 조건입니다." } },
      400,
    );
  }
  const { query, period, sort, page, pageSize } = parsed.data;

  const container = createContainer(c.env.DB);
  const [{ users, total }, adminAccounts] = await Promise.all([
    container.userModerationUseCases.searchUsers({
      query,
      period,
      sort,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
    container.adminAccountRepo.list(),
  ]);

  // One admin_accounts scan for the whole page instead of N+1 lookups per row.
  const activeAdminUserIds = new Set(
    adminAccounts.filter((a) => a.status === "ACTIVE").map((a) => a.userId),
  );
  const usersWithFlag = users.map((u) => ({
    ...u,
    isProtectedAdmin: activeAdminUserIds.has(u.id) || isAdminUserId(u.id, c.env.ADMIN_USER_IDS),
  }));

  return c.json(
    AdminUserSearchResponseSchema.parse({ users: usersWithFlag, total, page, pageSize }),
    200,
  );
});

// GET /api/admin/users/:userId — detail view: linked providers, game bests, moderation status,
// full audit history for this user.
adminUsersRouter.get("/:userId", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "users.view");
  if (denied) return denied;

  const userId = Number(c.req.param("userId"));
  if (!Number.isInteger(userId) || userId <= 0) {
    return c.json({ error: { code: "INVALID_REQUEST", message: "잘못된 사용자 ID입니다." } }, 400);
  }

  const container = createContainer(c.env.DB, readB2Config(c.env));
  const [user, providers, bests, moderation, auditLog, isProtectedAdmin] = await Promise.all([
    container.userRepo.findById(userId),
    container.userRepo.getOAuthAccounts(userId),
    container.scoreReadUseCases.getUserBestsFormatted(userId),
    container.userModerationUseCases.getModeration(userId),
    container.userModerationUseCases.getAuditLog(userId),
    isProtectedAdminTarget(c, container, userId),
  ]);

  if (!user) {
    return c.json(
      { error: { code: "USER_NOT_FOUND", message: "존재하지 않는 사용자입니다." } },
      404,
    );
  }

  const response = AdminUserDetailResponseSchema.parse({
    id: user.id,
    nickname: user.nickname,
    email: user.email,
    createdAt: user.created_at,
    providers: providers.map((p) => p.provider),
    gameBests: bests,
    moderation,
    auditLog,
    isProtectedAdmin,
  });
  return c.json(response, 200);
});

// POST /api/admin/users/:userId/suspend — temporary, blocks login for a server-calculated
// 7/30/180-day window. Clients never choose an arbitrary expiry timestamp.
adminUsersRouter.post("/:userId/suspend", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "users.suspend");
  if (denied) return denied;

  const userId = Number(c.req.param("userId"));
  const body = await c.req.json().catch(() => ({}));
  const parsed = AdminSuspendUserRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: {
          code: "INVALID_REQUEST",
          message: "durationDays(7, 30, 180)와 reason이 필요합니다.",
        },
      },
      400,
    );
  }

  const container = createContainer(c.env.DB);
  if (await isProtectedAdminTarget(c, container, userId)) {
    return c.json(
      { error: { code: "ADMIN_PROTECTED", message: "관리자 계정은 정지할 수 없습니다." } },
      403,
    );
  }

  try {
    const record = await container.userModerationUseCases.suspendUser(
      userId,
      admin.userId,
      parsed.data.durationDays,
      parsed.data.reason,
    );
    return c.json(UserModerationRecordSchema.parse(record), 200);
  } catch (err) {
    const { body, status } = moderationErrorResponse(err);
    return c.json(body, status);
  }
});

// POST /api/admin/users/:userId/ban — permanent, blocks login until an admin unbans.
adminUsersRouter.post("/:userId/ban", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "users.ban");
  if (denied) return denied;

  const userId = Number(c.req.param("userId"));
  const body = await c.req.json().catch(() => ({}));
  const parsed = AdminBanUserRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: "INVALID_REQUEST", message: "reason이 필요합니다." } }, 400);
  }

  const container = createContainer(c.env.DB);
  if (await isProtectedAdminTarget(c, container, userId)) {
    return c.json(
      { error: { code: "ADMIN_PROTECTED", message: "관리자 계정은 차단할 수 없습니다." } },
      403,
    );
  }

  try {
    const record = await container.userModerationUseCases.banUser(
      userId,
      admin.userId,
      parsed.data.reason,
    );
    return c.json(UserModerationRecordSchema.parse(record), 200);
  } catch (err) {
    const { body, status } = moderationErrorResponse(err);
    return c.json(body, status);
  }
});

// POST /api/admin/users/:userId/unsuspend — lifts SUSPENDED or BANNED back to ACTIVE early.
// Unbanning requires users.ban; users.suspend alone must never be enough to reverse a stronger
// action that the actor was not allowed to apply.
adminUsersRouter.post("/:userId/unsuspend", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;

  const userId = Number(c.req.param("userId"));
  const { userModerationUseCases } = createContainer(c.env.DB);
  const moderation = await userModerationUseCases.getModeration(userId);
  const denied = requirePermission(
    admin,
    moderation?.status === "BANNED" ? "users.ban" : "users.suspend",
  );
  if (denied) return denied;

  try {
    const record = await userModerationUseCases.unsuspendUser(userId, admin.userId);
    return c.json(UserModerationRecordSchema.parse(record), 200);
  } catch (err) {
    const { body, status } = moderationErrorResponse(err);
    return c.json(body, status);
  }
});

// POST /api/admin/users/:userId/score-submission-block — independent of suspend/ban: user can
// still log in, just can't submit new scores.
adminUsersRouter.post("/:userId/score-submission-block", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "users.score_moderation");
  if (denied) return denied;

  const userId = Number(c.req.param("userId"));
  const body = await c.req.json().catch(() => ({}));
  const parsed = AdminScoreSubmissionBlockRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: "INVALID_REQUEST", message: "blocked 값이 필요합니다." } }, 400);
  }

  try {
    const { userModerationUseCases } = createContainer(c.env.DB);
    const record = await userModerationUseCases.setScoreSubmissionBlocked(
      userId,
      admin.userId,
      parsed.data.blocked,
      parsed.data.reason ?? null,
    );
    return c.json(UserModerationRecordSchema.parse(record), 200);
  } catch (err) {
    const { body, status } = moderationErrorResponse(err);
    return c.json(body, status);
  }
});

// POST /api/admin/users/:userId/reset-scores — soft-deletes every visible score for this user.
adminUsersRouter.post("/:userId/reset-scores", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "users.score_moderation");
  if (denied) return denied;

  const userId = Number(c.req.param("userId"));
  const body = await c.req.json().catch(() => ({}));
  const parsed = AdminResetScoresRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: "INVALID_REQUEST", message: "reason이 필요합니다." } }, 400);
  }

  try {
    const { userModerationUseCases } = createContainer(c.env.DB);
    const result = await userModerationUseCases.resetUserScores(
      userId,
      admin.userId,
      parsed.data.reason,
    );
    return c.json(AdminScoreActionResponseSchema.parse(result), 200);
  } catch (err) {
    const { body, status } = moderationErrorResponse(err);
    return c.json(body, status);
  }
});

// POST /api/admin/users/:userId/restore-scores — undoes the most recent reset-scores action
// (restores every currently soft-deleted row for this user).
adminUsersRouter.post("/:userId/restore-scores", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "users.score_moderation");
  if (denied) return denied;

  const userId = Number(c.req.param("userId"));
  try {
    const { userModerationUseCases } = createContainer(c.env.DB);
    const result = await userModerationUseCases.restoreUserScores(userId, admin.userId);
    return c.json(AdminScoreActionResponseSchema.parse(result), 200);
  } catch (err) {
    const { body, status } = moderationErrorResponse(err);
    return c.json(body, status);
  }
});
