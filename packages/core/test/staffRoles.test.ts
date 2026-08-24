import test from "node:test";
import assert from "node:assert/strict";
import {
  ASSIGNABLE_PERMISSIONS,
  CONFIGURABLE_STAFF_ROLES,
  INITIAL_ROLE_PERMISSIONS,
  PERMISSIONS,
  STAFF_ROLES,
  effectivePermissions,
  hasPermission,
  isDelegatablePermission,
  isProtectedStaffRole,
} from "../src/domain/staffRoles.js";

test("ADMIN implicitly has every permission regardless of persisted rows", () => {
  for (const permission of PERMISSIONS) {
    assert.equal(hasPermission("ADMIN", [], [], permission), true);
  }
});

test("non-ADMIN authorization uses the persisted role policy", () => {
  const policy = INITIAL_ROLE_PERMISSIONS.OPERATOR;
  assert.equal(hasPermission("OPERATOR", policy, [], "users.ban"), true);
  assert.equal(hasPermission("OPERATOR", policy, [], "games.moderate"), true);
  assert.equal(hasPermission("OPERATOR", policy, [], "roles.manage"), false);

  const withoutBan = policy.filter((permission) => permission !== "users.ban");
  assert.equal(hasPermission("OPERATOR", withoutBan, [], "users.ban"), false);
  assert.equal(
    hasPermission("OPERATOR", ["roles.manage"], ["roles.manage"], "roles.manage"),
    false,
  );
});

test("an individual exception extends, but does not replace, the role policy", () => {
  const policy = INITIAL_ROLE_PERMISSIONS.MODERATOR;
  assert.equal(hasPermission("MODERATOR", policy, ["users.ban"], "users.ban"), true);
  assert.equal(hasPermission("MODERATOR", policy, ["users.ban"], "users.view"), true);
  assert.equal(hasPermission("MODERATOR", policy, ["users.ban"], "games.moderate"), false);
});

test("SYSTEM_DEVELOPER initially enters the unified admin center", () => {
  const policy = INITIAL_ROLE_PERMISSIONS.SYSTEM_DEVELOPER;
  assert.equal(hasPermission("SYSTEM_DEVELOPER", policy, [], "admin.center.access"), true);
  assert.equal(hasPermission("SYSTEM_DEVELOPER", policy, [], "system.dev.access"), true);
  assert.equal(hasPermission("SYSTEM_DEVELOPER", policy, [], "system.monitor"), true);
});

test("a null Staff Role never receives permissions, even from stray rows", () => {
  for (const permission of PERMISSIONS) {
    assert.equal(hasPermission(null, PERMISSIONS, PERMISSIONS, permission), false);
  }
});

test("effectivePermissions resolves ADMIN, null, and merged persisted grants", () => {
  assert.deepEqual([...effectivePermissions("ADMIN", [], [])].sort(), [...PERMISSIONS].sort());
  assert.deepEqual(effectivePermissions(null, PERMISSIONS, PERMISSIONS), []);

  const result = effectivePermissions("MODERATOR", INITIAL_ROLE_PERMISSIONS.MODERATOR, [
    "users.ban",
    "sandbox_games.review",
  ]);
  assert.equal(result.filter((permission) => permission === "sandbox_games.review").length, 1);
  assert.ok(result.includes("users.ban"));
  assert.equal(
    effectivePermissions("MODERATOR", ["roles.manage"], ["roles.manage"]).includes("roles.manage"),
    false,
  );
});

test("ADMIN is the only protected role", () => {
  assert.equal(isProtectedStaffRole("ADMIN"), true);
  assert.equal(isProtectedStaffRole("OPERATOR"), false);
  assert.equal(isProtectedStaffRole("MODERATOR"), false);
  assert.equal(isProtectedStaffRole("SYSTEM_DEVELOPER"), false);
  assert.equal(isProtectedStaffRole(null), false);
});

test("roles.manage is absent from every configurable/assignable policy", () => {
  for (const permission of PERMISSIONS) {
    assert.equal(isDelegatablePermission(permission), permission !== "roles.manage");
  }
  assert.equal(ASSIGNABLE_PERMISSIONS.includes("roles.manage" as never), false);
  for (const role of CONFIGURABLE_STAFF_ROLES) {
    assert.equal(INITIAL_ROLE_PERMISSIONS[role].includes("roles.manage"), false);
  }
});

test("staff role catalogs remain explicit", () => {
  assert.deepEqual(STAFF_ROLES, ["ADMIN", "OPERATOR", "MODERATOR", "SYSTEM_DEVELOPER"]);
  assert.deepEqual(CONFIGURABLE_STAFF_ROLES, ["OPERATOR", "MODERATOR", "SYSTEM_DEVELOPER"]);
});
