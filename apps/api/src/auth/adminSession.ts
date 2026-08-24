import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import type { AdminAccountRecord, StaffRole, Permission } from "@owogg/core";
import { hasPermission } from "@owogg/core";
import { createContainer } from "../container.js";
import { resolveAdminEligibility, resolveEffectiveStaffRole } from "./adminEligibility.js";
import type { ApiEnv } from "../routes/auth.js";

export interface ElevatedAdmin {
  userId: number;
  rawSessionToken: string;
  /** Non-null only for a managed (D1 admin_accounts) administrator; null for a legacy
   * ADMIN_USER_IDS/env-credential admin with no managed account row. */
  account: AdminAccountRecord | null;
  /** See adminEligibility.ts's resolveEffectiveStaffRole — always non-null here, since reaching
   * this type at all required passing eligibility. */
  role: StaffRole;
  /** Current D1 policy shared by this non-ADMIN role. Empty for ADMIN. */
  rolePermissions: Permission[];
  /** This account's individual exception grants. Empty for unmanaged/root ADMIN. */
  individualPermissions: Permission[];
}

/**
 * Full admin authorization chain for every protected `/api/admin/*` endpoint (GET included —
 * review data is sensitive). ADMIN_USER_IDS alone is never sufficient after this migration:
 *
 *   1. valid OwOGG session (owogg_session)
 *   2. session user.id is eligible: ADMIN_USER_IDS (root) OR an ACTIVE managed admin_accounts row
 *   3. a valid, unexpired, unrevoked admin session (owogg_admin_session) bound to this exact
 *      underlying session token
 *   4. (unless `allowPasswordChangeRequired`) the managed account, if any, does not still have a
 *      forced password change pending — sensitive admin functions stay locked until it's cleared
 *
 * Returns a Response to send as-is on any failure, or the elevated admin identity (with resolved
 * Staff Role + permissions) on success. Route handlers that need a SPECIFIC permission (rather
 * than merely "any elevated admin") should call {@link requirePermission} with the result.
 */
export async function requireElevatedAdmin(
  c: Context<ApiEnv>,
  options: { allowPasswordChangeRequired?: boolean } = {},
): Promise<Response | ElevatedAdmin> {
  const rawSessionToken = getCookie(c, "owogg_session");
  if (!rawSessionToken) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Authentication required" } }, 401);
  }

  const container = createContainer(c.env.DB);
  const sessionResult = await container.sessionRepo.findSession(rawSessionToken);
  if (!sessionResult) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Authentication required" } }, 401);
  }

  const userId = sessionResult.user.id;
  const eligibility = await resolveAdminEligibility(
    userId,
    c.env.ADMIN_USER_IDS,
    container.adminAccountUseCases,
  );
  if (!eligibility.eligible) {
    return c.json({ error: { code: "FORBIDDEN", message: "관리자 권한이 필요합니다." } }, 403);
  }

  const rawAdminSessionToken = getCookie(c, "owogg_admin_session");
  const adminSession = await container.adminAuthUseCases.validateAdminSession({
    rawToken: rawAdminSessionToken,
    rawSessionToken,
  });
  if (!adminSession) {
    return c.json(
      {
        error: {
          code: "ADMIN_SESSION_REQUIRED",
          message: "관리자 로그인이 필요합니다.",
        },
      },
      403,
    );
  }

  const { account } = eligibility;
  if (!options.allowPasswordChangeRequired && account?.mustChangePassword) {
    return c.json(
      {
        error: {
          code: "PASSWORD_CHANGE_REQUIRED",
          message: "관리자 비밀번호를 변경해주세요.",
        },
      },
      403,
    );
  }

  const role = resolveEffectiveStaffRole(eligibility);
  // Unreachable in practice — eligibility.eligible === true always implies a resolvable role
  // (root or managed) — but keeps the return type honestly non-null rather than asserting.
  if (!role) {
    return c.json({ error: { code: "FORBIDDEN", message: "관리자 권한이 필요합니다." } }, 403);
  }

  const [rolePermissions, individualPermissions] =
    role === "ADMIN"
      ? [[], []]
      : await Promise.all([
          container.adminAccountUseCases.listRolePermissions(role),
          account
            ? container.adminAccountUseCases.listPermissions(account.id)
            : Promise.resolve([]),
        ]);

  return { userId, rawSessionToken, account, role, rolePermissions, individualPermissions };
}

export function isElevatedAdminResponse(value: Response | ElevatedAdmin): value is Response {
  return value instanceof Response;
}

/**
 * Second gate after {@link requireElevatedAdmin}: does this specific admin have `permission`
 * (their role's current D1 policy, or an individual admin_permission_grants row)? Returns the
 * 403 Response to send as-is on failure, or `null` on success — callers write
 * `const denied = requirePermission(admin, "users.ban"); if (denied) return denied;`.
 *
 * Every `/api/admin/*` route that performs a specific privileged action (as opposed to a
 * dashboard/read a broad "elevated admin" was historically sufficient for) should call this.
 * Routes gated only by requireElevatedAdmin implicitly allow every Staff Role through — correct
 * for genuinely role-agnostic endpoints (e.g. GET /api/admin/me, the self password-change
 * endpoint) but wrong for anything permission-specific.
 */
export function requirePermission(admin: ElevatedAdmin, permission: Permission): Response | null {
  if (hasPermission(admin.role, admin.rolePermissions, admin.individualPermissions, permission))
    return null;
  return Response.json(
    { error: { code: "FORBIDDEN", message: "이 작업을 수행할 권한이 없습니다.", permission } },
    { status: 403 },
  );
}
