import { Hono } from "hono";
import {
  AdminPasswordChangeRequestSchema,
  AdminPasswordChangeResponseSchema,
  AdminAccountListResponseSchema,
  AdminAccountCreateRequestSchema,
  AdminAccountStatusChangeRequestSchema,
  AdminAccountRoleChangeRequestSchema,
  AdminAccountPasswordResetRequestSchema,
  AdminAccountAuditListResponseSchema,
  PermissionGrantRequestSchema,
  PermissionSchema,
  ConfigurableStaffRoleSchema,
  RolePermissionPolicyListResponseSchema,
  RolePermissionUpdateRequestSchema,
} from "@owogg/contracts";
import {
  evaluateAdminPasswordPolicy,
  AdminAccountUseCaseFailure,
  type AdminAccountRecord,
} from "@owogg/core";
import { createContainer } from "../container.js";
import { isTrustedAdminOrigin } from "../auth/admin.js";
import { requireElevatedAdmin, isElevatedAdminResponse } from "../auth/adminSession.js";
import { verifyAdminPassword, hashAdminPassword } from "../auth/adminPassword.js";
import {
  setAdminCookie,
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE_SECONDS,
} from "./adminAuth.js";
import type { ApiEnv } from "./auth.js";

export const adminAccountsRouter = new Hono<ApiEnv>();

adminAccountsRouter.use("*", async (c, next) => {
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

function failureStatus(code: AdminAccountUseCaseFailure["code"]): 404 | 409 {
  return code === "NOT_FOUND" ? 404 : 409;
}

function failureMessage(code: AdminAccountUseCaseFailure["code"]): string {
  switch (code) {
    case "ALREADY_BOOTSTRAPPED":
      return "이미 관리자 계정이 존재합니다.";
    case "USERNAME_TAKEN":
      return "이미 사용 중인 아이디입니다.";
    case "USER_ALREADY_ADMIN":
      return "해당 OwOGG 사용자는 이미 관리자 계정을 가지고 있습니다.";
    case "GOOGLE_SUB_ALREADY_ADMIN":
      return "해당 Google 계정은 이미 다른 관리자 계정에 연결되어 있습니다.";
    case "NOT_FOUND":
      return "대상 관리자 계정을 찾을 수 없습니다.";
    case "LAST_ADMIN":
      return "마지막 ADMIN은 비활성화하거나 강등할 수 없습니다.";
    case "CANNOT_MODIFY_SELF":
      return "자기 자신의 권한은 이 화면에서 변경할 수 없습니다.";
    case "PERMISSION_NOT_DELEGABLE":
      return "이 권한은 위임할 수 없습니다.";
    case "ROLE_NOT_CONFIGURABLE":
      return "이 역할의 권한은 변경할 수 없습니다.";
  }
}

// POST /api/admin/settings/password — self password change. Reachable even while
// must_change_password is still pending (that's the whole point of the gate).
adminAccountsRouter.post("/settings/password", async (c) => {
  const admin = await requireElevatedAdmin(c, { allowPasswordChangeRequired: true });
  if (isElevatedAdminResponse(admin)) return admin;
  if (!admin.account) {
    return c.json(
      {
        error: {
          code: "NOT_MANAGED",
          message: "레거시 관리자 자격 증명은 이 화면에서 변경할 수 없습니다.",
        },
      },
      409,
    );
  }

  const rawBody = await c.req.json().catch(() => ({}));
  const parsed = AdminPasswordChangeRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      { error: { code: "INVALID_REQUEST", message: "요청 본문이 올바르지 않습니다." } },
      400,
    );
  }

  const currentOk = await verifyAdminPassword(
    parsed.data.currentPassword,
    admin.account.passwordHash,
  );
  if (!currentOk) {
    return c.json(
      { error: { code: "INVALID_CREDENTIALS", message: "현재 비밀번호가 올바르지 않습니다." } },
      401,
    );
  }

  const matchesCurrentPassword = await verifyAdminPassword(
    parsed.data.newPassword,
    admin.account.passwordHash,
  );
  const policy = evaluateAdminPasswordPolicy({
    newPassword: parsed.data.newPassword,
    username: admin.account.username,
    matchesCurrentPassword,
  });
  if (!policy.ok) {
    return c.json(
      { error: { code: "WEAK_PASSWORD", message: "비밀번호가 정책을 만족하지 않습니다." } },
      400,
    );
  }

  const { adminAccountUseCases, adminAuthUseCases } = createContainer(c.env.DB);
  const newPasswordHash = await hashAdminPassword(parsed.data.newPassword);
  await adminAccountUseCases.changeOwnPassword({
    accountId: admin.account.id,
    userId: admin.userId,
    newPasswordHash,
  });

  // changeOwnPassword revokes EVERY admin session for this user, including the one that just
  // authenticated this request — issue a fresh one now so the caller isn't logged out by their
  // own password change ("revoke all other sessions ... optionally rotate current session
  // cleanly").
  const { rawToken } = await adminAuthUseCases.issueAdminSession({
    userId: admin.userId,
    rawSessionToken: admin.rawSessionToken,
  });
  setAdminCookie(c, ADMIN_SESSION_COOKIE, rawToken, ADMIN_SESSION_MAX_AGE_SECONDS);

  return c.json(AdminPasswordChangeResponseSchema.parse({ success: true }));
});

function toSummary(account: AdminAccountRecord, nickname: string, selfUserId: number) {
  return {
    id: account.id,
    userId: account.userId,
    nickname,
    username: account.username,
    role: account.role,
    status: account.status,
    mustChangePassword: account.mustChangePassword,
    createdAt: account.createdAt,
    passwordChangedAt: account.passwordChangedAt,
    isSelf: account.userId === selfUserId,
  };
}

// GET /api/admin/accounts — ADMIN only.
adminAccountsRouter.get("/accounts", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  if (admin.account?.role !== "ADMIN") {
    return c.json({ error: { code: "FORBIDDEN", message: "ADMIN만 접근할 수 있습니다." } }, 403);
  }

  const { adminAccountUseCases, userRepo } = createContainer(c.env.DB);
  const accounts = await adminAccountUseCases.list();
  const summaries = await Promise.all(
    accounts.map(async (account) => {
      const user = await userRepo.findById(account.userId);
      return toSummary(account, user?.nickname ?? "(알 수 없음)", admin.userId);
    }),
  );

  return c.json(AdminAccountListResponseSchema.parse({ accounts: summaries }));
});

// GET /api/admin/accounts/audit — ADMIN only, safe append-only audit trail.
adminAccountsRouter.get("/accounts/audit", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  if (admin.account?.role !== "ADMIN") {
    return c.json({ error: { code: "FORBIDDEN", message: "ADMIN만 접근할 수 있습니다." } }, 403);
  }

  const { adminAccountUseCases } = createContainer(c.env.DB);
  const entries = await adminAccountUseCases.listAudit(100);
  return c.json(AdminAccountAuditListResponseSchema.parse({ entries }));
});

// POST /api/admin/accounts — ADMIN only. Creates an administrator bound to an EXISTING
// OwOGG user whose Google identity is derived from that user's already-linked oauth_accounts
// row — a Google sub is never accepted as free-text client input.
adminAccountsRouter.post("/accounts", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  if (admin.account?.role !== "ADMIN") {
    return c.json({ error: { code: "FORBIDDEN", message: "ADMIN만 접근할 수 있습니다." } }, 403);
  }

  const rawBody = await c.req.json().catch(() => ({}));
  const parsed = AdminAccountCreateRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      { error: { code: "INVALID_REQUEST", message: "요청 본문이 올바르지 않습니다." } },
      400,
    );
  }

  const { userRepo, adminAccountUseCases } = createContainer(c.env.DB);
  const targetUser = await userRepo.findById(parsed.data.userId);
  if (!targetUser) {
    return c.json(
      { error: { code: "USER_NOT_FOUND", message: "대상 사용자를 찾을 수 없습니다." } },
      404,
    );
  }

  const oauthAccounts = await userRepo.getOAuthAccounts(parsed.data.userId);
  const googleAccount = oauthAccounts.find((acc) => acc.provider === "google");
  if (!googleAccount) {
    return c.json(
      {
        error: {
          code: "GOOGLE_NOT_LINKED",
          message: "대상 사용자는 Google 계정이 연결되어 있지 않습니다.",
        },
      },
      409,
    );
  }

  const policy = evaluateAdminPasswordPolicy({
    newPassword: parsed.data.password,
    username: parsed.data.username,
    matchesCurrentPassword: false,
  });
  if (!policy.ok) {
    return c.json(
      { error: { code: "WEAK_PASSWORD", message: "비밀번호가 정책을 만족하지 않습니다." } },
      400,
    );
  }

  const passwordHash = await hashAdminPassword(parsed.data.password);

  try {
    const created = await adminAccountUseCases.createAdmin({
      actorAdminId: admin.account.id,
      userId: parsed.data.userId,
      googleSub: googleAccount.provider_user_id,
      username: parsed.data.username,
      passwordHash,
      role: parsed.data.role,
    });
    return c.json(toSummary(created, targetUser.nickname, admin.userId), 201);
  } catch (err) {
    if (err instanceof AdminAccountUseCaseFailure) {
      return c.json(
        { error: { code: err.code, message: failureMessage(err.code) } },
        failureStatus(err.code),
      );
    }
    throw err;
  }
});

interface ManagedAdminActor {
  actorAdminId: number;
}

function isResponse(value: Response | ManagedAdminActor): value is Response {
  return value instanceof Response;
}

async function requireManagedAdminActor(
  c: Parameters<typeof requireElevatedAdmin>[0],
): Promise<Response | ManagedAdminActor> {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const account = admin.account;
  if (!account || account.role !== "ADMIN") {
    return c.json({ error: { code: "FORBIDDEN", message: "ADMIN만 접근할 수 있습니다." } }, 403);
  }
  return { actorAdminId: account.id };
}

/** Requires a genuine MANAGED ADMIN account specifically — not merely `admin.role === "ADMIN"`,
 * which a root-only ADMIN_USER_IDS admin (no admin_accounts row at all) also resolves to. Account
 * management (creating/disabling/reassigning other administrators) stays gated on having gone
 * through the real bootstrap/creation flow, same as before this migration — a break-glass root
 * identity with no managed row has no `account.id` to attribute these actions to. */
async function requireManagedAdminTarget(
  c: Parameters<typeof requireElevatedAdmin>[0],
  targetId: number,
): Promise<Response | ManagedAdminActor> {
  const actor = await requireManagedAdminActor(c);
  if (isResponse(actor)) return actor;
  if (!Number.isSafeInteger(targetId) || targetId <= 0) {
    return c.json({ error: { code: "INVALID_REQUEST", message: "잘못된 요청입니다." } }, 400);
  }
  return actor;
}

// ── Role-level functional permissions (migration 0038) ─────────────────────
// The managed ADMIN gate is deliberately stricter than roles.manage: roles.manage itself can
// never be assigned by either this policy editor or the individual-grant endpoints below.

// GET /api/admin/role-permissions — all configurable role policies.
adminAccountsRouter.get("/role-permissions", async (c) => {
  const actor = await requireManagedAdminActor(c);
  if (isResponse(actor)) return actor;

  const { adminAccountUseCases } = createContainer(c.env.DB);
  const roles = await adminAccountUseCases.listRolePermissionPolicies();
  return c.json(RolePermissionPolicyListResponseSchema.parse({ roles }));
});

// PUT /api/admin/role-permissions/:role — atomically replace one role's policy.
adminAccountsRouter.put("/role-permissions/:role", async (c) => {
  const actor = await requireManagedAdminActor(c);
  if (isResponse(actor)) return actor;

  const role = ConfigurableStaffRoleSchema.safeParse(c.req.param("role"));
  const body = RolePermissionUpdateRequestSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!role.success || !body.success) {
    return c.json(
      { error: { code: "INVALID_REQUEST", message: "역할 또는 권한 목록이 올바르지 않습니다." } },
      400,
    );
  }

  const { adminAccountUseCases } = createContainer(c.env.DB);
  try {
    const permissions = await adminAccountUseCases.replaceRolePermissions({
      actorAdminId: actor.actorAdminId,
      role: role.data,
      permissions: body.data.permissions,
    });
    return c.json({ role: role.data, permissions });
  } catch (err) {
    if (err instanceof AdminAccountUseCaseFailure) {
      return c.json(
        { error: { code: err.code, message: failureMessage(err.code) } },
        failureStatus(err.code),
      );
    }
    throw err;
  }
});

// PATCH /api/admin/accounts/:id/status — enable/disable (ADMIN only).
adminAccountsRouter.patch("/accounts/:id/status", async (c) => {
  const targetId = Number(c.req.param("id"));
  const actor = await requireManagedAdminTarget(c, targetId);
  if (isResponse(actor)) return actor;

  const rawBody = await c.req.json().catch(() => ({}));
  const parsed = AdminAccountStatusChangeRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      { error: { code: "INVALID_REQUEST", message: "요청 본문이 올바르지 않습니다." } },
      400,
    );
  }

  const { adminAccountUseCases } = createContainer(c.env.DB);
  try {
    await adminAccountUseCases.setStatus({
      actorAdminId: actor.actorAdminId,
      targetAdminId: targetId,
      status: parsed.data.status,
    });
    return c.json({ success: true });
  } catch (err) {
    if (err instanceof AdminAccountUseCaseFailure) {
      return c.json(
        { error: { code: err.code, message: failureMessage(err.code) } },
        failureStatus(err.code),
      );
    }
    throw err;
  }
});

// PATCH /api/admin/accounts/:id/role — change role (ADMIN only).
adminAccountsRouter.patch("/accounts/:id/role", async (c) => {
  const targetId = Number(c.req.param("id"));
  const actor = await requireManagedAdminTarget(c, targetId);
  if (isResponse(actor)) return actor;

  const rawBody = await c.req.json().catch(() => ({}));
  const parsed = AdminAccountRoleChangeRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      { error: { code: "INVALID_REQUEST", message: "요청 본문이 올바르지 않습니다." } },
      400,
    );
  }

  const { adminAccountUseCases } = createContainer(c.env.DB);
  try {
    await adminAccountUseCases.setRole({
      actorAdminId: actor.actorAdminId,
      targetAdminId: targetId,
      role: parsed.data.role,
    });
    return c.json({ success: true });
  } catch (err) {
    if (err instanceof AdminAccountUseCaseFailure) {
      return c.json(
        { error: { code: err.code, message: failureMessage(err.code) } },
        failureStatus(err.code),
      );
    }
    throw err;
  }
});

// POST /api/admin/accounts/:id/reset-password — issue a new temporary password for another
// administrator (ADMIN only). Always forces a change on next login.
adminAccountsRouter.post("/accounts/:id/reset-password", async (c) => {
  const targetId = Number(c.req.param("id"));
  const actor = await requireManagedAdminTarget(c, targetId);
  if (isResponse(actor)) return actor;

  const rawBody = await c.req.json().catch(() => ({}));
  const parsed = AdminAccountPasswordResetRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      { error: { code: "INVALID_REQUEST", message: "요청 본문이 올바르지 않습니다." } },
      400,
    );
  }

  const { adminAccountUseCases } = createContainer(c.env.DB);
  const target = await adminAccountUseCases.getById(targetId);
  if (!target) {
    return c.json(
      { error: { code: "NOT_FOUND", message: "대상 관리자 계정을 찾을 수 없습니다." } },
      404,
    );
  }

  const matchesCurrentPassword = await verifyAdminPassword(
    parsed.data.newPassword,
    target.passwordHash,
  );
  const policy = evaluateAdminPasswordPolicy({
    newPassword: parsed.data.newPassword,
    username: target.username,
    matchesCurrentPassword,
  });
  if (!policy.ok) {
    return c.json(
      { error: { code: "WEAK_PASSWORD", message: "비밀번호가 정책을 만족하지 않습니다." } },
      400,
    );
  }

  const newPasswordHash = await hashAdminPassword(parsed.data.newPassword);
  try {
    await adminAccountUseCases.resetPassword({
      actorAdminId: actor.actorAdminId,
      targetAdminId: targetId,
      newPasswordHash,
    });
    return c.json({ success: true });
  } catch (err) {
    if (err instanceof AdminAccountUseCaseFailure) {
      return c.json(
        { error: { code: err.code, message: failureMessage(err.code) } },
        failureStatus(err.code),
      );
    }
    throw err;
  }
});

// POST /api/admin/accounts/:id/revoke-sessions — ADMIN only.
adminAccountsRouter.post("/accounts/:id/revoke-sessions", async (c) => {
  const targetId = Number(c.req.param("id"));
  const actor = await requireManagedAdminTarget(c, targetId);
  if (isResponse(actor)) return actor;

  const { adminAccountUseCases } = createContainer(c.env.DB);
  try {
    await adminAccountUseCases.revokeSessions({
      actorAdminId: actor.actorAdminId,
      targetAdminId: targetId,
    });
    return c.json({ success: true });
  } catch (err) {
    if (err instanceof AdminAccountUseCaseFailure) {
      return c.json(
        { error: { code: err.code, message: failureMessage(err.code) } },
        failureStatus(err.code),
      );
    }
    throw err;
  }
});

// ── Individual permission delegation (migration 0025) ────────────────────────
//
// e.g. adding one narrow exception without widening that account's entire role. Gated the same
// way as the rest of this file (a genuine managed ADMIN account, not
// merely root eligibility) rather than via requirePermission("roles.manage") — see
// requireManagedAdminTarget's doc comment for why account management stays on this stricter gate.

// GET /api/admin/accounts/:id/permissions
adminAccountsRouter.get("/accounts/:id/permissions", async (c) => {
  const targetId = Number(c.req.param("id"));
  const actor = await requireManagedAdminTarget(c, targetId);
  if (isResponse(actor)) return actor;

  const { adminAccountUseCases } = createContainer(c.env.DB);
  const target = await adminAccountUseCases.getById(targetId);
  if (!target) {
    return c.json(
      { error: { code: "NOT_FOUND", message: "대상 관리자 계정을 찾을 수 없습니다." } },
      404,
    );
  }
  const permissions = await adminAccountUseCases.listPermissions(targetId);
  return c.json({ permissions });
});

// POST /api/admin/accounts/:id/permissions — grant one individual permission.
adminAccountsRouter.post("/accounts/:id/permissions", async (c) => {
  const targetId = Number(c.req.param("id"));
  const actor = await requireManagedAdminTarget(c, targetId);
  if (isResponse(actor)) return actor;

  const rawBody = await c.req.json().catch(() => ({}));
  const parsed = PermissionGrantRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      { error: { code: "INVALID_REQUEST", message: "요청 본문이 올바르지 않습니다." } },
      400,
    );
  }

  const { adminAccountUseCases } = createContainer(c.env.DB);
  try {
    await adminAccountUseCases.grantPermission({
      actorAdminId: actor.actorAdminId,
      targetAdminId: targetId,
      permission: parsed.data.permission,
    });
    return c.json({ success: true });
  } catch (err) {
    if (err instanceof AdminAccountUseCaseFailure) {
      return c.json(
        { error: { code: err.code, message: failureMessage(err.code) } },
        failureStatus(err.code),
      );
    }
    throw err;
  }
});

// DELETE /api/admin/accounts/:id/permissions/:permission — revoke one individual permission.
adminAccountsRouter.delete("/accounts/:id/permissions/:permission", async (c) => {
  const targetId = Number(c.req.param("id"));
  const actor = await requireManagedAdminTarget(c, targetId);
  if (isResponse(actor)) return actor;

  const parsedPermission = PermissionSchema.safeParse(c.req.param("permission"));
  if (!parsedPermission.success) {
    return c.json({ error: { code: "INVALID_REQUEST", message: "알 수 없는 권한입니다." } }, 400);
  }

  const { adminAccountUseCases } = createContainer(c.env.DB);
  try {
    await adminAccountUseCases.revokePermission({
      actorAdminId: actor.actorAdminId,
      targetAdminId: targetId,
      permission: parsedPermission.data,
    });
    return c.json({ success: true });
  } catch (err) {
    if (err instanceof AdminAccountUseCaseFailure) {
      return c.json(
        { error: { code: err.code, message: failureMessage(err.code) } },
        failureStatus(err.code),
      );
    }
    throw err;
  }
});
