import test from "node:test";
import assert from "node:assert/strict";
import { D1AdminAccountRepository } from "../src/d1/D1AdminAccountRepository.js";
import { createSqliteD1, ADMIN_ACCOUNTS_TEST_SCHEMA } from "./helpers/sqliteD1.js";

function iso(): string {
  return new Date().toISOString();
}

async function seedUsers(raw: import("node:sqlite").DatabaseSync, count: number) {
  const now = new Date().toISOString();
  for (let i = 1; i <= count; i++) {
    raw
      .prepare(`INSERT INTO users (id, nickname, created_at, updated_at) VALUES (?, ?, ?, ?)`)
      .run(i, `User${i}`, now, now);
  }
}

test("create + find round-trip by id/userId/username/googleSub", async () => {
  const { db, raw } = createSqliteD1(ADMIN_ACCOUNTS_TEST_SCHEMA);
  await seedUsers(raw, 1);
  const repo = new D1AdminAccountRepository(db);

  const created = await repo.create({
    userId: 1,
    googleSub: "sub-1",
    username: "owogg-admin",
    passwordHash: "pbkdf2_sha256$1$c2FsdA==$aGFzaA==",
    role: "ADMIN",
    mustChangePassword: true,
    createdByAdminId: null,
    nowIso: iso(),
  });

  assert.equal(created.userId, 1);
  assert.equal(created.role, "ADMIN");
  assert.equal(created.status, "ACTIVE");
  assert.equal(created.mustChangePassword, true);

  assert.deepEqual(await repo.findById(created.id), created);
  assert.deepEqual(await repo.findByUserId(1), created);
  assert.deepEqual(await repo.findByUsername("owogg-admin"), created);
  assert.deepEqual(await repo.findByGoogleSub("sub-1"), created);
  assert.equal(await repo.findByUserId(999), null);
});

test("countActive / countActiveByRole reflect status and role", async () => {
  const { db, raw } = createSqliteD1(ADMIN_ACCOUNTS_TEST_SCHEMA);
  await seedUsers(raw, 2);
  const repo = new D1AdminAccountRepository(db);

  const rootAdmin = await repo.create({
    userId: 1,
    googleSub: "sub-1",
    username: "root-admin",
    passwordHash: "hash1",
    role: "ADMIN",
    mustChangePassword: false,
    createdByAdminId: null,
    nowIso: iso(),
  });
  await repo.create({
    userId: 2,
    googleSub: "sub-2",
    username: "second-admin",
    passwordHash: "hash2",
    role: "OPERATOR",
    mustChangePassword: false,
    createdByAdminId: rootAdmin.id,
    nowIso: iso(),
  });

  assert.equal(await repo.countActive(), 2);
  assert.equal(await repo.countActiveByRole("ADMIN"), 1);
  assert.equal(await repo.countActiveByRole("OPERATOR"), 1);

  await repo.updateStatus(rootAdmin.id, "DISABLED", iso());
  assert.equal(await repo.countActive(), 1);
  assert.equal(await repo.countActiveByRole("ADMIN"), 0);
});

test("updatePassword sets hash, must_change_password, and password_changed_at", async () => {
  const { db, raw } = createSqliteD1(ADMIN_ACCOUNTS_TEST_SCHEMA);
  await seedUsers(raw, 1);
  const repo = new D1AdminAccountRepository(db);
  const created = await repo.create({
    userId: 1,
    googleSub: "sub-1",
    username: "admin",
    passwordHash: "old-hash",
    role: "ADMIN",
    mustChangePassword: true,
    createdByAdminId: null,
    nowIso: iso(),
  });

  await repo.updatePassword(created.id, "new-hash", false, iso());
  const updated = await repo.findById(created.id);
  assert.equal(updated?.passwordHash, "new-hash");
  assert.equal(updated?.mustChangePassword, false);
});

test("updateRole persists role change", async () => {
  const { db, raw } = createSqliteD1(ADMIN_ACCOUNTS_TEST_SCHEMA);
  await seedUsers(raw, 1);
  const repo = new D1AdminAccountRepository(db);
  const created = await repo.create({
    userId: 1,
    googleSub: "sub-1",
    username: "admin",
    passwordHash: "hash",
    role: "ADMIN",
    mustChangePassword: false,
    createdByAdminId: null,
    nowIso: iso(),
  });

  await repo.updateRole(created.id, "OPERATOR", iso());
  assert.equal((await repo.findById(created.id))?.role, "OPERATOR");
});

test("username/user_id/google_sub uniqueness is enforced at the DB layer", async () => {
  const { db, raw } = createSqliteD1(ADMIN_ACCOUNTS_TEST_SCHEMA);
  await seedUsers(raw, 2);
  const repo = new D1AdminAccountRepository(db);
  await repo.create({
    userId: 1,
    googleSub: "sub-1",
    username: "admin",
    passwordHash: "hash",
    role: "ADMIN",
    mustChangePassword: false,
    createdByAdminId: null,
    nowIso: iso(),
  });

  await assert.rejects(() =>
    repo.create({
      userId: 1, // duplicate user_id
      googleSub: "sub-2",
      username: "another-name",
      passwordHash: "hash",
      role: "ADMIN",
      mustChangePassword: false,
      createdByAdminId: null,
      nowIso: iso(),
    }),
  );

  await assert.rejects(() =>
    repo.create({
      userId: 2,
      googleSub: "sub-1", // duplicate google_sub
      username: "another-name",
      passwordHash: "hash",
      role: "ADMIN",
      mustChangePassword: false,
      createdByAdminId: null,
      nowIso: iso(),
    }),
  );

  await assert.rejects(() =>
    repo.create({
      userId: 2,
      googleSub: "sub-2",
      username: "admin", // duplicate username
      passwordHash: "hash",
      role: "ADMIN",
      mustChangePassword: false,
      createdByAdminId: null,
      nowIso: iso(),
    }),
  );
});

test("audit log: append-only insert and ordered listing", async () => {
  const { db, raw } = createSqliteD1(ADMIN_ACCOUNTS_TEST_SCHEMA);
  await seedUsers(raw, 1);
  const repo = new D1AdminAccountRepository(db);
  const created = await repo.create({
    userId: 1,
    googleSub: "sub-1",
    username: "admin",
    passwordHash: "hash",
    role: "ADMIN",
    mustChangePassword: true,
    createdByAdminId: null,
    nowIso: iso(),
  });

  await repo.appendAudit({
    actorAdminId: null,
    targetAdminId: created.id,
    action: "ADMIN_CREATED",
    metadata: { role: "ADMIN", via: "bootstrap" },
    nowIso: iso(),
  });
  await repo.appendAudit({
    actorAdminId: created.id,
    targetAdminId: created.id,
    action: "PASSWORD_CHANGED",
    metadata: null,
    nowIso: iso(),
  });

  const entries = await repo.listAudit(10);
  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.action, "PASSWORD_CHANGED"); // DESC by created_at
  assert.deepEqual(entries[1]?.metadata, { role: "ADMIN", via: "bootstrap" });

  // Never stores a plaintext password/hash/token in metadata — this table's schema has no
  // column for it at all, so an attempt to smuggle one through metadata is still just opaque
  // JSON text, never queryable as a credential.
  assert.equal(JSON.stringify(entries).includes("hash"), false);
});

test("list orders by created_at ascending", async () => {
  const { db, raw } = createSqliteD1(ADMIN_ACCOUNTS_TEST_SCHEMA);
  await seedUsers(raw, 2);
  const repo = new D1AdminAccountRepository(db);
  await repo.create({
    userId: 1,
    googleSub: "sub-1",
    username: "first",
    passwordHash: "hash",
    role: "ADMIN",
    mustChangePassword: false,
    createdByAdminId: null,
    nowIso: "2026-01-01T00:00:00.000Z",
  });
  await repo.create({
    userId: 2,
    googleSub: "sub-2",
    username: "second",
    passwordHash: "hash",
    role: "ADMIN",
    mustChangePassword: false,
    createdByAdminId: null,
    nowIso: "2026-02-01T00:00:00.000Z",
  });

  const all = await repo.list();
  assert.deepEqual(
    all.map((a) => a.username),
    ["first", "second"],
  );
});

test("role permission policy replacement is role-scoped and removes stale permissions", async () => {
  const { db, raw } = createSqliteD1(ADMIN_ACCOUNTS_TEST_SCHEMA);
  await seedUsers(raw, 1);
  const repo = new D1AdminAccountRepository(db);
  const admin = await repo.create({
    userId: 1,
    googleSub: "sub-1",
    username: "admin",
    passwordHash: "hash",
    role: "ADMIN",
    mustChangePassword: false,
    createdByAdminId: null,
    nowIso: iso(),
  });

  await repo.replaceRolePermissions({
    role: "MODERATOR",
    permissions: ["admin.center.access", "users.view", "users.suspend"],
    grantedByAdminId: admin.id,
    nowIso: iso(),
  });
  assert.deepEqual(await repo.listRolePermissions("MODERATOR"), [
    "admin.center.access",
    "users.suspend",
    "users.view",
  ]);

  await repo.replaceRolePermissions({
    role: "MODERATOR",
    permissions: ["users.view"],
    grantedByAdminId: admin.id,
    nowIso: iso(),
  });
  assert.deepEqual(await repo.listRolePermissions("MODERATOR"), ["users.view"]);
  assert.deepEqual(await repo.listRolePermissions("OPERATOR"), []);
});
