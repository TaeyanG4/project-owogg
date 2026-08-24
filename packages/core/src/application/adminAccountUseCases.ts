import type { AdminAccountRole, AdminAccountStatus } from "../domain/adminAccounts.js";
import {
  CONFIGURABLE_STAFF_ROLES,
  isDelegatablePermission,
  type ConfigurableStaffRole,
  type Permission,
} from "../domain/staffRoles.js";
import type {
  AdminAccountRecord,
  AdminAccountAuditEntry,
  AdminAccountRepository,
} from "../ports/adminAccounts.js";
import type { AdminAuthRepository } from "../ports/adminAuth.js";

export type AdminAccountUseCaseError =
  | "ALREADY_BOOTSTRAPPED"
  | "USERNAME_TAKEN"
  | "USER_ALREADY_ADMIN"
  | "GOOGLE_SUB_ALREADY_ADMIN"
  | "NOT_FOUND"
  /** The last active ADMIN (the top Staff Role — see domain/staffRoles.ts) can never be disabled
   * or demoted away from ADMIN, since that would permanently lock managed administration short of
   * the ADMIN_USER_IDS break-glass path. */
  | "LAST_ADMIN"
  /** An ADMIN can never disable or demote *themselves* — even when other ADMINs exist. Protects
   * against an accidental self-lockout click, not just the "last one" case. Self password change,
   * self session revoke (via logout), and self profile edits are unaffected. */
  | "CANNOT_MODIFY_SELF"
  /** `roles.manage` is deliberately never delegable via admin_permission_grants — see
   * domain/staffRoles.ts's isDelegatablePermission. */
  | "PERMISSION_NOT_DELEGABLE"
  | "ROLE_NOT_CONFIGURABLE";

export class AdminAccountUseCaseFailure extends Error {
  constructor(public readonly code: AdminAccountUseCaseError) {
    super(code);
  }
}

/**
 * Orchestrates the managed administrator account model on top of AdminAccountRepository.
 * Password hashing/verification (Web Crypto PBKDF2) is intentionally NOT done here — the route
 * layer computes/verifies password hashes (see apps/api/src/auth/adminPassword.ts) and passes
 * the resulting hash string in, exactly like the existing AdminAuthUseCases split.
 */
export class AdminAccountUseCases {
  constructor(
    private repo: AdminAccountRepository,
    private authRepo: AdminAuthRepository,
  ) {}

  async getByUserId(userId: number): Promise<AdminAccountRecord | null> {
    return this.repo.findByUserId(userId);
  }

  async getById(id: number): Promise<AdminAccountRecord | null> {
    return this.repo.findById(id);
  }

  async getByUsername(username: string): Promise<AdminAccountRecord | null> {
    return this.repo.findByUsername(username);
  }

  async hasAnyActiveAccount(): Promise<boolean> {
    return (await this.repo.countActive()) > 0;
  }

  async list(): Promise<AdminAccountRecord[]> {
    return this.repo.list();
  }

  async listAudit(limit = 100): Promise<AdminAccountAuditEntry[]> {
    return this.repo.listAudit(limit);
  }

  /** First-admin bootstrap: only ever succeeds while zero active admin accounts exist anywhere.
   * The caller (route layer) is responsible for having already verified: root eligibility
   * (ADMIN_USER_IDS), a fresh Google step-up, and that the step-up's googleSub is the one linked
   * to this exact OwOGG user. Always creates the top Staff Role (ADMIN) — there is no lesser
   * "first account" tier to choose. */
  async bootstrapFirstAdmin(input: {
    userId: number;
    googleSub: string;
    username: string;
    passwordHash: string;
    now?: Date;
  }): Promise<AdminAccountRecord> {
    if (await this.hasAnyActiveAccount()) {
      throw new AdminAccountUseCaseFailure("ALREADY_BOOTSTRAPPED");
    }
    const nowIso = (input.now ?? new Date()).toISOString();
    const account = await this.createAccountInternal({
      userId: input.userId,
      googleSub: input.googleSub,
      username: input.username,
      passwordHash: input.passwordHash,
      role: "ADMIN",
      mustChangePassword: true,
      createdByAdminId: null,
      nowIso,
    });
    await this.repo.appendAudit({
      actorAdminId: null,
      targetAdminId: account.id,
      action: "ADMIN_CREATED",
      metadata: { role: "ADMIN", via: "bootstrap" },
      nowIso,
    });
    return account;
  }

  /** ADMIN-only (the top Staff Role): create another administrator bound to an existing OwOGG
   * user + their already-linked Google identity, with any Staff Role including ADMIN itself. */
  async createAdmin(input: {
    actorAdminId: number;
    userId: number;
    googleSub: string;
    username: string;
    passwordHash: string;
    role: AdminAccountRole;
    now?: Date;
  }): Promise<AdminAccountRecord> {
    const nowIso = (input.now ?? new Date()).toISOString();
    const account = await this.createAccountInternal({
      userId: input.userId,
      googleSub: input.googleSub,
      username: input.username,
      passwordHash: input.passwordHash,
      role: input.role,
      mustChangePassword: true,
      createdByAdminId: input.actorAdminId,
      nowIso,
    });
    await this.repo.appendAudit({
      actorAdminId: input.actorAdminId,
      targetAdminId: account.id,
      action: "ADMIN_CREATED",
      metadata: { role: input.role },
      nowIso,
    });
    return account;
  }

  private async createAccountInternal(input: {
    userId: number;
    googleSub: string;
    username: string;
    passwordHash: string;
    role: AdminAccountRole;
    mustChangePassword: boolean;
    createdByAdminId: number | null;
    nowIso: string;
  }): Promise<AdminAccountRecord> {
    if (await this.repo.findByUserId(input.userId))
      throw new AdminAccountUseCaseFailure("USER_ALREADY_ADMIN");
    if (await this.repo.findByUsername(input.username))
      throw new AdminAccountUseCaseFailure("USERNAME_TAKEN");
    if (await this.repo.findByGoogleSub(input.googleSub))
      throw new AdminAccountUseCaseFailure("GOOGLE_SUB_ALREADY_ADMIN");

    return this.repo.create({
      userId: input.userId,
      googleSub: input.googleSub,
      username: input.username,
      passwordHash: input.passwordHash,
      role: input.role,
      mustChangePassword: input.mustChangePassword,
      createdByAdminId: input.createdByAdminId,
      nowIso: input.nowIso,
    });
  }

  /** Self password change: updates the hash, clears must_change_password, and revokes every
   * other admin session for this account so the change takes effect everywhere immediately. */
  async changeOwnPassword(input: {
    accountId: number;
    userId: number;
    newPasswordHash: string;
    now?: Date;
  }): Promise<void> {
    const nowIso = (input.now ?? new Date()).toISOString();
    await this.repo.updatePassword(input.accountId, input.newPasswordHash, false, nowIso);
    await this.authRepo.revokeAllAdminSessionsForUserId(input.userId);
    await this.repo.appendAudit({
      actorAdminId: input.accountId,
      targetAdminId: input.accountId,
      action: "PASSWORD_CHANGED",
      metadata: null,
      nowIso,
    });
  }

  /** ADMIN resets another administrator's password to an operator-supplied temporary value
   * — always forces a change on next login and revokes that admin's existing sessions. */
  async resetPassword(input: {
    actorAdminId: number;
    targetAdminId: number;
    newPasswordHash: string;
    now?: Date;
  }): Promise<void> {
    const target = await this.repo.findById(input.targetAdminId);
    if (!target) throw new AdminAccountUseCaseFailure("NOT_FOUND");
    const nowIso = (input.now ?? new Date()).toISOString();
    await this.repo.updatePassword(input.targetAdminId, input.newPasswordHash, true, nowIso);
    await this.authRepo.revokeAllAdminSessionsForUserId(target.userId);
    await this.repo.appendAudit({
      actorAdminId: input.actorAdminId,
      targetAdminId: input.targetAdminId,
      action: "PASSWORD_RESET",
      metadata: null,
      nowIso,
    });
  }

  async setStatus(input: {
    actorAdminId: number;
    targetAdminId: number;
    status: AdminAccountStatus;
    now?: Date;
  }): Promise<void> {
    const target = await this.repo.findById(input.targetAdminId);
    if (!target) throw new AdminAccountUseCaseFailure("NOT_FOUND");

    if (input.status === "DISABLED") {
      // Self-lockout guard first — cheaper than the last-ADMIN count query, and the more common
      // accidental-click case ("나 자신을 실수로 비활성화").
      if (input.targetAdminId === input.actorAdminId) {
        throw new AdminAccountUseCaseFailure("CANNOT_MODIFY_SELF");
      }
      if (target.role === "ADMIN") {
        await this.assertNotLastActiveAdmin(target);
      }
    }

    const nowIso = (input.now ?? new Date()).toISOString();
    await this.repo.updateStatus(input.targetAdminId, input.status, nowIso);
    if (input.status === "DISABLED") {
      await this.authRepo.revokeAllAdminSessionsForUserId(target.userId);
    }
    await this.repo.appendAudit({
      actorAdminId: input.actorAdminId,
      targetAdminId: input.targetAdminId,
      action: input.status === "DISABLED" ? "ADMIN_DISABLED" : "ADMIN_ENABLED",
      metadata: null,
      nowIso,
    });
  }

  async setRole(input: {
    actorAdminId: number;
    targetAdminId: number;
    role: AdminAccountRole;
    now?: Date;
  }): Promise<void> {
    const target = await this.repo.findById(input.targetAdminId);
    if (!target) throw new AdminAccountUseCaseFailure("NOT_FOUND");

    if (target.role === "ADMIN" && input.role !== "ADMIN") {
      // Demoting away from the top role — same self-lockout + last-ADMIN protections as
      // disabling, since losing ADMIN status is functionally equivalent to losing access.
      if (input.targetAdminId === input.actorAdminId) {
        throw new AdminAccountUseCaseFailure("CANNOT_MODIFY_SELF");
      }
      await this.assertNotLastActiveAdmin(target);
    }

    const nowIso = (input.now ?? new Date()).toISOString();
    await this.repo.updateRole(input.targetAdminId, input.role, nowIso);
    await this.repo.appendAudit({
      actorAdminId: input.actorAdminId,
      targetAdminId: input.targetAdminId,
      action: "ROLE_CHANGED",
      metadata: { from: target.role, to: input.role },
      nowIso,
    });
  }

  async revokeSessions(input: {
    actorAdminId: number;
    targetAdminId: number;
    now?: Date;
  }): Promise<void> {
    const target = await this.repo.findById(input.targetAdminId);
    if (!target) throw new AdminAccountUseCaseFailure("NOT_FOUND");
    await this.authRepo.revokeAllAdminSessionsForUserId(target.userId);
    await this.repo.appendAudit({
      actorAdminId: input.actorAdminId,
      targetAdminId: input.targetAdminId,
      action: "SESSIONS_REVOKED",
      metadata: null,
      nowIso: (input.now ?? new Date()).toISOString(),
    });
  }

  /** Never allow the last active ADMIN (the top Staff Role) to be disabled or demoted — that
   * would permanently lock managed administration (short of the ADMIN_USER_IDS break-glass
   * path). */
  private async assertNotLastActiveAdmin(target: AdminAccountRecord): Promise<void> {
    if (target.status !== "ACTIVE") return; // already inactive — not "the" active one
    const activeAdmins = await this.repo.countActiveByRole("ADMIN");
    if (activeAdmins <= 1) throw new AdminAccountUseCaseFailure("LAST_ADMIN");
  }

  // ── Individual permission delegation (migration 0025) ────────────────────

  async listPermissions(accountId: number): Promise<Permission[]> {
    return this.repo.listPermissions(accountId);
  }

  /** ADMIN-only (enforced by the route layer via `roles.manage`, checked again here defensively
   * since a permission this powerful deserves belt-and-suspenders). `roles.manage` itself can
   * never be granted this way — see isDelegatablePermission — so a delegated SYSTEM_DEVELOPER can
   * never bootstrap their way into full role/permission control. */
  async grantPermission(input: {
    actorAdminId: number;
    targetAdminId: number;
    permission: Permission;
    now?: Date;
  }): Promise<void> {
    if (!isDelegatablePermission(input.permission)) {
      throw new AdminAccountUseCaseFailure("PERMISSION_NOT_DELEGABLE");
    }
    const target = await this.repo.findById(input.targetAdminId);
    if (!target) throw new AdminAccountUseCaseFailure("NOT_FOUND");

    const nowIso = (input.now ?? new Date()).toISOString();
    await this.repo.grantPermission(
      input.targetAdminId,
      input.permission,
      input.actorAdminId,
      nowIso,
    );
    await this.repo.appendAudit({
      actorAdminId: input.actorAdminId,
      targetAdminId: input.targetAdminId,
      action: "PERMISSION_GRANTED",
      metadata: { permission: input.permission },
      nowIso,
    });
  }

  async revokePermission(input: {
    actorAdminId: number;
    targetAdminId: number;
    permission: Permission;
    now?: Date;
  }): Promise<void> {
    const target = await this.repo.findById(input.targetAdminId);
    if (!target) throw new AdminAccountUseCaseFailure("NOT_FOUND");

    const nowIso = (input.now ?? new Date()).toISOString();
    await this.repo.revokePermission(input.targetAdminId, input.permission);
    await this.repo.appendAudit({
      actorAdminId: input.actorAdminId,
      targetAdminId: input.targetAdminId,
      action: "PERMISSION_REVOKED",
      metadata: { permission: input.permission },
      nowIso,
    });
  }

  // ── Role-level functional policy (migration 0038) ────────────────────────

  async listRolePermissions(role: ConfigurableStaffRole): Promise<Permission[]> {
    return this.repo.listRolePermissions(role);
  }

  async listRolePermissionPolicies(): Promise<
    Array<{ role: ConfigurableStaffRole; permissions: Permission[] }>
  > {
    return Promise.all(
      CONFIGURABLE_STAFF_ROLES.map(async (role) => ({
        role,
        permissions: await this.repo.listRolePermissions(role),
      })),
    );
  }

  /** Replaces one role's full functional permission set. ADMIN is not a configurable role and
   * roles.manage is never accepted, so only a managed ADMIN can control this policy without being
   * able to delegate the policy editor itself. */
  async replaceRolePermissions(input: {
    actorAdminId: number;
    role: ConfigurableStaffRole;
    permissions: readonly Permission[];
    now?: Date;
  }): Promise<Permission[]> {
    if (!CONFIGURABLE_STAFF_ROLES.includes(input.role)) {
      throw new AdminAccountUseCaseFailure("ROLE_NOT_CONFIGURABLE");
    }
    if (input.permissions.some((permission) => !isDelegatablePermission(permission))) {
      throw new AdminAccountUseCaseFailure("PERMISSION_NOT_DELEGABLE");
    }

    const permissions = [...new Set(input.permissions)];
    const before = await this.repo.listRolePermissions(input.role);
    const nowIso = (input.now ?? new Date()).toISOString();
    await this.repo.replaceRolePermissions({
      role: input.role,
      permissions,
      grantedByAdminId: input.actorAdminId,
      nowIso,
    });
    await this.repo.appendAudit({
      actorAdminId: input.actorAdminId,
      targetAdminId: null,
      action: "ROLE_PERMISSIONS_UPDATED",
      metadata: { role: input.role, before, after: permissions },
      nowIso,
    });
    return permissions;
  }
}
