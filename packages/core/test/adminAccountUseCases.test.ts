import test from "node:test";
import assert from "node:assert/strict";
import {
  AdminAccountUseCases,
  AdminAccountUseCaseFailure,
} from "../src/application/adminAccountUseCases.js";
import type { ConfigurableStaffRole, Permission } from "../src/domain/staffRoles.js";
import type {
  AdminAccountRepository,
  AdminAccountRecord,
  AdminAccountAuditEntry,
} from "../src/ports/adminAccounts.js";
import type { AdminAuthRepository } from "../src/ports/adminAuth.js";

// Minimal in-memory fakes — this suite exercises the *application-level invariants* (top-ADMIN
// protection, self-modification lockout, duplicate checks, bootstrap gating, permission
// delegation, session revocation side effects), not SQL — see
// packages/db/test/D1AdminAccountRepository.test.ts for the real-SQLite coverage.

function createFakeRepo(): AdminAccountRepository & {
  rows: AdminAccountRecord[];
  audit: AdminAccountAuditEntry[];
  permissions: Map<number, Set<Permission>>;
  rolePermissions: Map<ConfigurableStaffRole, Set<Permission>>;
} {
  const rows: AdminAccountRecord[] = [];
  const audit: AdminAccountAuditEntry[] = [];
  const permissions = new Map<number, Set<Permission>>();
  const rolePermissions = new Map<ConfigurableStaffRole, Set<Permission>>();
  let nextId = 1;
  let nextAuditId = 1;

  return {
    rows,
    audit,
    permissions,
    rolePermissions,
    async countActive() {
      return rows.filter((r) => r.status === "ACTIVE").length;
    },
    async countActiveByRole(role) {
      return rows.filter((r) => r.status === "ACTIVE" && r.role === role).length;
    },
    async findById(id) {
      return rows.find((r) => r.id === id) ?? null;
    },
    async findByUserId(userId) {
      return rows.find((r) => r.userId === userId) ?? null;
    },
    async findByUsername(username) {
      return rows.find((r) => r.username === username) ?? null;
    },
    async findByGoogleSub(googleSub) {
      return rows.find((r) => r.googleSub === googleSub) ?? null;
    },
    async list() {
      return [...rows];
    },
    async create(input) {
      const record: AdminAccountRecord = {
        id: nextId++,
        userId: input.userId,
        googleSub: input.googleSub,
        username: input.username,
        passwordHash: input.passwordHash,
        role: input.role,
        status: "ACTIVE",
        mustChangePassword: input.mustChangePassword,
        createdByAdminId: input.createdByAdminId,
        createdAt: input.nowIso,
        updatedAt: input.nowIso,
        passwordChangedAt: input.nowIso,
      };
      rows.push(record);
      return record;
    },
    async updateRole(id, role, nowIso) {
      const r = rows.find((x) => x.id === id);
      if (r) {
        r.role = role;
        r.updatedAt = nowIso;
      }
    },
    async updateStatus(id, status, nowIso) {
      const r = rows.find((x) => x.id === id);
      if (r) {
        r.status = status;
        r.updatedAt = nowIso;
      }
    },
    async updatePassword(id, passwordHash, mustChangePassword, nowIso) {
      const r = rows.find((x) => x.id === id);
      if (r) {
        r.passwordHash = passwordHash;
        r.mustChangePassword = mustChangePassword;
        r.passwordChangedAt = nowIso;
        r.updatedAt = nowIso;
      }
    },
    async appendAudit(entry) {
      audit.push({ id: nextAuditId++, ...entry, createdAt: entry.nowIso });
    },
    async listAudit(limit) {
      return [...audit].reverse().slice(0, limit);
    },
    async grantPermission(accountId, permission) {
      const set = permissions.get(accountId) ?? new Set<Permission>();
      set.add(permission);
      permissions.set(accountId, set);
    },
    async revokePermission(accountId, permission) {
      permissions.get(accountId)?.delete(permission);
    },
    async listPermissions(accountId) {
      return [...(permissions.get(accountId) ?? [])];
    },
    async listRolePermissions(role) {
      return [...(rolePermissions.get(role) ?? [])];
    },
    async replaceRolePermissions(input) {
      rolePermissions.set(input.role, new Set(input.permissions));
    },
  };
}

function createFakeAuthRepo(): AdminAuthRepository & { revokedForUser: number[] } {
  const revokedForUser: number[] = [];
  return {
    revokedForUser,
    async createStepUpChallenge() {
      throw new Error("not used in this suite");
    },
    async consumeStepUpChallenge() {
      throw new Error("not used in this suite");
    },
    async createAdminSession() {
      throw new Error("not used in this suite");
    },
    async findValidAdminSession() {
      throw new Error("not used in this suite");
    },
    async revokeAdminSession() {},
    async revokeAdminSessionsForSessionToken() {},
    async revokeAllAdminSessionsForUserId(userId: number) {
      revokedForUser.push(userId);
    },
    async recordLoginAttempt() {},
    async listRecentFailedAttempts() {
      return [];
    },
    async cleanupExpired() {},
  };
}

test("role permission policy replacement is persisted and audited; roles.manage is rejected", async () => {
  const repo = createFakeRepo();
  const useCases = new AdminAccountUseCases(repo, createFakeAuthRepo());

  const permissions = await useCases.replaceRolePermissions({
    actorAdminId: 7,
    role: "MODERATOR",
    permissions: ["admin.center.access", "users.view", "users.view"],
    now: new Date("2026-08-24T00:00:00.000Z"),
  });
  assert.deepEqual(permissions, ["admin.center.access", "users.view"]);
  assert.deepEqual(await useCases.listRolePermissions("MODERATOR"), permissions);
  assert.equal(repo.audit.at(-1)?.action, "ROLE_PERMISSIONS_UPDATED");
  assert.deepEqual(repo.audit.at(-1)?.metadata, {
    role: "MODERATOR",
    before: [],
    after: permissions,
  });

  await assert.rejects(
    () =>
      useCases.replaceRolePermissions({
        actorAdminId: 7,
        role: "OPERATOR",
        permissions: ["roles.manage"],
      }),
    (error: unknown) =>
      error instanceof AdminAccountUseCaseFailure && error.code === "PERMISSION_NOT_DELEGABLE",
  );
});

test("bootstrapFirstAdmin succeeds once, then rejects when an active account already exists", async () => {
  const repo = createFakeRepo();
  const authRepo = createFakeAuthRepo();
  const useCases = new AdminAccountUseCases(repo, authRepo);

  const account = await useCases.bootstrapFirstAdmin({
    userId: 1,
    googleSub: "sub-1",
    username: "root-admin",
    passwordHash: "hash",
  });
  assert.equal(account.role, "ADMIN");
  assert.equal(account.mustChangePassword, true);
  assert.equal(repo.audit.length, 1);
  assert.equal(repo.audit[0]?.action, "ADMIN_CREATED");

  await assert.rejects(
    () =>
      useCases.bootstrapFirstAdmin({
        userId: 2,
        googleSub: "sub-2",
        username: "second-root",
        passwordHash: "hash",
      }),
    (err: unknown) =>
      err instanceof AdminAccountUseCaseFailure && err.code === "ALREADY_BOOTSTRAPPED",
  );
});

test("createAdmin rejects duplicate userId/username/googleSub", async () => {
  const repo = createFakeRepo();
  const authRepo = createFakeAuthRepo();
  const useCases = new AdminAccountUseCases(repo, authRepo);

  const admin = await useCases.bootstrapFirstAdmin({
    userId: 1,
    googleSub: "sub-1",
    username: "root-admin",
    passwordHash: "hash",
  });

  await assert.rejects(
    () =>
      useCases.createAdmin({
        actorAdminId: admin.id,
        userId: 1, // duplicate OwOGG user
        googleSub: "sub-x",
        username: "other-name",
        passwordHash: "hash",
        role: "OPERATOR",
      }),
    (err: unknown) =>
      err instanceof AdminAccountUseCaseFailure && err.code === "USER_ALREADY_ADMIN",
  );

  await assert.rejects(
    () =>
      useCases.createAdmin({
        actorAdminId: admin.id,
        userId: 2,
        googleSub: "sub-x",
        username: "root-admin", // duplicate username
        passwordHash: "hash",
        role: "OPERATOR",
      }),
    (err: unknown) => err instanceof AdminAccountUseCaseFailure && err.code === "USERNAME_TAKEN",
  );

  await assert.rejects(
    () =>
      useCases.createAdmin({
        actorAdminId: admin.id,
        userId: 2,
        googleSub: "sub-1", // duplicate google sub
        username: "other-name",
        passwordHash: "hash",
        role: "OPERATOR",
      }),
    (err: unknown) =>
      err instanceof AdminAccountUseCaseFailure && err.code === "GOOGLE_SUB_ALREADY_ADMIN",
  );
});

test("setStatus/setRole refuse to touch the caller's OWN account (self-lockout guard)", async () => {
  const repo = createFakeRepo();
  const authRepo = createFakeAuthRepo();
  const useCases = new AdminAccountUseCases(repo, authRepo);

  const admin = await useCases.bootstrapFirstAdmin({
    userId: 1,
    googleSub: "sub-1",
    username: "root-admin",
    passwordHash: "hash",
  });

  await assert.rejects(
    () =>
      useCases.setStatus({
        actorAdminId: admin.id,
        targetAdminId: admin.id,
        status: "DISABLED",
      }),
    (err: unknown) =>
      err instanceof AdminAccountUseCaseFailure && err.code === "CANNOT_MODIFY_SELF",
  );
  await assert.rejects(
    () =>
      useCases.setRole({
        actorAdminId: admin.id,
        targetAdminId: admin.id,
        role: "OPERATOR",
      }),
    (err: unknown) =>
      err instanceof AdminAccountUseCaseFailure && err.code === "CANNOT_MODIFY_SELF",
  );

  // A second ADMIN acting on the FIRST (not itself) can freely demote it — self-lockout is
  // specifically about the actor's own account, not "the last ADMIN" (see the next test for that
  // separate protection).
  const second = await useCases.createAdmin({
    actorAdminId: admin.id,
    userId: 2,
    googleSub: "sub-2",
    username: "second-admin",
    passwordHash: "hash",
    role: "ADMIN",
  });
  await useCases.setRole({ actorAdminId: second.id, targetAdminId: admin.id, role: "OPERATOR" });
  assert.equal((await repo.findById(admin.id))?.role, "OPERATOR");
});

test("setStatus/setRole refuse to disable or demote the last active ADMIN, even by a different actor", async () => {
  const repo = createFakeRepo();
  const authRepo = createFakeAuthRepo();
  const useCases = new AdminAccountUseCases(repo, authRepo);

  const admin = await useCases.bootstrapFirstAdmin({
    userId: 1,
    googleSub: "sub-1",
    username: "root-admin",
    passwordHash: "hash",
  });
  // A non-ADMIN account acting as the (distinct) actor id — realistic callers always pass the
  // route layer's own managed account id, but the use case itself only cares that actor !==
  // target here, so an OPERATOR's id is enough to isolate this from the self-lockout guard.
  const operator = await useCases.createAdmin({
    actorAdminId: admin.id,
    userId: 2,
    googleSub: "sub-2",
    username: "operator",
    passwordHash: "hash",
    role: "OPERATOR",
  });

  await assert.rejects(
    () =>
      useCases.setStatus({
        actorAdminId: operator.id,
        targetAdminId: admin.id,
        status: "DISABLED",
      }),
    (err: unknown) => err instanceof AdminAccountUseCaseFailure && err.code === "LAST_ADMIN",
  );
  await assert.rejects(
    () =>
      useCases.setRole({
        actorAdminId: operator.id,
        targetAdminId: admin.id,
        role: "OPERATOR",
      }),
    (err: unknown) => err instanceof AdminAccountUseCaseFailure && err.code === "LAST_ADMIN",
  );

  // A second ADMIN makes the demotion/disable of either individual one now safe.
  const secondAdmin = await useCases.createAdmin({
    actorAdminId: admin.id,
    userId: 3,
    googleSub: "sub-3",
    username: "second-admin",
    passwordHash: "hash",
    role: "ADMIN",
  });
  await useCases.setRole({
    actorAdminId: operator.id,
    targetAdminId: secondAdmin.id,
    role: "OPERATOR",
  });
  assert.equal((await repo.findById(secondAdmin.id))?.role, "OPERATOR");
});

test("changeOwnPassword clears must_change_password and revokes this user's other sessions", async () => {
  const repo = createFakeRepo();
  const authRepo = createFakeAuthRepo();
  const useCases = new AdminAccountUseCases(repo, authRepo);

  const account = await useCases.bootstrapFirstAdmin({
    userId: 1,
    googleSub: "sub-1",
    username: "root-admin",
    passwordHash: "old-hash",
  });
  assert.equal(account.mustChangePassword, true);

  await useCases.changeOwnPassword({
    accountId: account.id,
    userId: 1,
    newPasswordHash: "new-hash",
  });

  const updated = await repo.findById(account.id);
  assert.equal(updated?.mustChangePassword, false);
  assert.equal(updated?.passwordHash, "new-hash");
  assert.deepEqual(authRepo.revokedForUser, [1]);
});

test("resetPassword forces must_change_password=true and revokes the target's sessions", async () => {
  const repo = createFakeRepo();
  const authRepo = createFakeAuthRepo();
  const useCases = new AdminAccountUseCases(repo, authRepo);

  const admin = await useCases.bootstrapFirstAdmin({
    userId: 1,
    googleSub: "sub-1",
    username: "root-admin",
    passwordHash: "hash",
  });
  await useCases.changeOwnPassword({
    accountId: admin.id,
    userId: 1,
    newPasswordHash: "hash2",
  });

  const target = await useCases.createAdmin({
    actorAdminId: admin.id,
    userId: 2,
    googleSub: "sub-2",
    username: "other-admin",
    passwordHash: "hash",
    role: "OPERATOR",
  });
  await useCases.changeOwnPassword({ accountId: target.id, userId: 2, newPasswordHash: "hash3" });
  assert.equal((await repo.findById(target.id))?.mustChangePassword, false);

  await useCases.resetPassword({
    actorAdminId: admin.id,
    targetAdminId: target.id,
    newPasswordHash: "temp-hash",
  });

  const updated = await repo.findById(target.id);
  assert.equal(updated?.mustChangePassword, true);
  assert.equal(updated?.passwordHash, "temp-hash");
  assert.ok(authRepo.revokedForUser.includes(2));
});

test("grantPermission/revokePermission/listPermissions round-trip, and roles.manage is never delegable", async () => {
  const repo = createFakeRepo();
  const authRepo = createFakeAuthRepo();
  const useCases = new AdminAccountUseCases(repo, authRepo);

  const admin = await useCases.bootstrapFirstAdmin({
    userId: 1,
    googleSub: "sub-1",
    username: "root-admin",
    passwordHash: "hash",
  });
  const target = await useCases.createAdmin({
    actorAdminId: admin.id,
    userId: 2,
    googleSub: "sub-2",
    username: "system-dev",
    passwordHash: "hash",
    role: "SYSTEM_DEVELOPER",
  });

  assert.deepEqual(await useCases.listPermissions(target.id), []);

  await useCases.grantPermission({
    actorAdminId: admin.id,
    targetAdminId: target.id,
    permission: "admin.center.access",
  });
  assert.deepEqual(await useCases.listPermissions(target.id), ["admin.center.access"]);

  // Idempotent — granting twice doesn't duplicate or error.
  await useCases.grantPermission({
    actorAdminId: admin.id,
    targetAdminId: target.id,
    permission: "admin.center.access",
  });
  assert.deepEqual(await useCases.listPermissions(target.id), ["admin.center.access"]);

  await useCases.revokePermission({
    actorAdminId: admin.id,
    targetAdminId: target.id,
    permission: "admin.center.access",
  });
  assert.deepEqual(await useCases.listPermissions(target.id), []);

  await assert.rejects(
    () =>
      useCases.grantPermission({
        actorAdminId: admin.id,
        targetAdminId: target.id,
        permission: "roles.manage",
      }),
    (err: unknown) =>
      err instanceof AdminAccountUseCaseFailure && err.code === "PERMISSION_NOT_DELEGABLE",
  );
});
