import test from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/app.js";
import { hashSessionToken } from "@owogg/db";
import { createSqliteD1 } from "../../../packages/db/test/helpers/sqliteD1.js";
import type { D1Database } from "@owogg/db";

// Route-level coverage for GET /api/me/access — the single call the profile dropdown (and
// role/program route guards) use across all three independent axes: Staff Role, Game Creator
// program, Streamer program. See docs/AUTHORIZATION.md. Backed by real SQLite (same helper
// packages/db uses) since this route genuinely joins across sessions/admin_accounts/
// admin_permission_grants/game_creator_access/game_creator_applications/streamer_profiles — a
// hand-rolled query-matching mock across five tables would be more fragile than the real schema.

const FULL_SCHEMA = `
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname TEXT NOT NULL,
  email TEXT,
  avatar_url TEXT,
  avatar_provider TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  country TEXT,
  nickname_updated_at TEXT,
  country_updated_at TEXT,
  locale TEXT,
  current_streak INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  last_active_date TEXT
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE oauth_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  provider_email TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE user_moderation (
  user_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  suspended_until TEXT,
  score_submission_blocked INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  updated_by_admin_id INTEGER,
  updated_at TEXT NOT NULL
);

CREATE TABLE admin_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  google_sub TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'ADMIN',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_by_admin_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  password_changed_at TEXT NOT NULL
);

CREATE TABLE admin_account_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_admin_id INTEGER,
  target_admin_id INTEGER,
  action TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE admin_permission_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  permission TEXT NOT NULL,
  granted_by_admin_id INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE (account_id, permission)
);

CREATE TABLE admin_role_permissions (
  role TEXT NOT NULL,
  permission TEXT NOT NULL,
  granted_by_admin_id INTEGER,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (role, permission)
);
INSERT INTO admin_role_permissions (role, permission, updated_at) VALUES
  ('OPERATOR', 'admin.center.access', datetime('now')),
  ('OPERATOR', 'users.view', datetime('now')),
  ('OPERATOR', 'users.ban', datetime('now')),
  ('OPERATOR', 'games.moderate', datetime('now')),
  ('MODERATOR', 'admin.center.access', datetime('now')),
  ('MODERATOR', 'users.view', datetime('now')),
  ('SYSTEM_DEVELOPER', 'admin.center.access', datetime('now')),
  ('SYSTEM_DEVELOPER', 'system.dev.access', datetime('now')),
  ('SYSTEM_DEVELOPER', 'system.monitor', datetime('now'));

CREATE TABLE game_creator_access (
  user_id INTEGER PRIMARY KEY,
  granted_by_admin_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE game_creator_access_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_user_id INTEGER NOT NULL,
  actor_admin_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE game_creator_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  message TEXT,
  reviewed_by_admin_id INTEGER,
  reviewed_at TEXT,
  reject_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_game_creator_applications_one_pending_per_user
  ON game_creator_applications(user_id) WHERE status = 'PENDING';

CREATE TABLE streamer_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'UNVERIFIED',
  suspended_until TEXT,
  row_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE streamer_platform_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  streamer_id INTEGER NOT NULL,
  platform TEXT NOT NULL,
  platform_user_id TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  channel_handle TEXT,
  channel_url TEXT NOT NULL,
  avatar_url TEXT,
  verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
  verified_at TEXT,
  ownership_expires_at TEXT,
  approval_status TEXT NOT NULL DEFAULT 'PENDING',
  row_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(platform, platform_user_id)
);
`;

let nextUserId = 1;

async function createDb() {
  const { db } = createSqliteD1(FULL_SCHEMA);
  return db;
}

async function createUserWithSession(db: D1Database, rawToken: string): Promise<number> {
  const userId = nextUserId++;
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO users (id, nickname, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(userId, `user${userId}`, `user${userId}@example.com`, now, now)
    .run();
  const tokenHash = await hashSessionToken(rawToken);
  await db
    .prepare(`INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
    .bind(tokenHash, userId, now, new Date(Date.now() + 86400000).toISOString())
    .run();
  return userId;
}

async function createManagedAdmin(
  db: D1Database,
  userId: number,
  role: "ADMIN" | "OPERATOR" | "MODERATOR" | "SYSTEM_DEVELOPER",
): Promise<number> {
  const now = new Date().toISOString();
  const res = await db
    .prepare(
      `INSERT INTO admin_accounts
         (user_id, google_sub, username, password_hash, role, status, must_change_password,
          created_at, updated_at, password_changed_at)
       VALUES (?, ?, ?, 'test_hash', ?, 'ACTIVE', 0, ?, ?, ?)
       RETURNING id`,
    )
    .bind(userId, `google-sub-${userId}`, `admin-user-${userId}`, role, now, now, now)
    .first<{ id: number }>();
  return res!.id;
}

async function grantPermission(db: D1Database, accountId: number, permission: string) {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO admin_permission_grants (account_id, permission, created_at) VALUES (?, ?, ?)`,
    )
    .bind(accountId, permission, now)
    .run();
}

async function grantGameCreatorAccess(db: D1Database, userId: number) {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO game_creator_access (user_id, granted_by_admin_id, status, created_at, updated_at)
       VALUES (?, 1, 'ACTIVE', ?, ?)`,
    )
    .bind(userId, now, now)
    .run();
}

async function createApplication(
  db: D1Database,
  userId: number,
  status: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN",
) {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO game_creator_applications (user_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(userId, status, now, now)
    .run();
}

async function createVerifiedStreamerProfile(db: D1Database, userId: number) {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO streamer_profiles (user_id, status, created_at, updated_at)
       VALUES (?, 'VERIFIED', ?, ?)`,
    )
    .bind(userId, now, now)
    .run();
}

test("GET /api/me/access without a session cookie is 401 UNAUTHORIZED", async () => {
  const db = await createDb();
  const res = await app.request("/api/me/access", {}, { DB: db } as any);
  assert.equal(res.status, 401);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "UNAUTHORIZED");
});

test("GET /api/me/access for a plain USER (no staff role, no programs) returns an all-empty/false shape", async () => {
  const db = await createDb();
  const rawToken = "plain_user_session";
  await createUserWithSession(db, rawToken);

  const res = await app.request(
    "/api/me/access",
    { headers: { Cookie: `owogg_session=${rawToken}` } },
    { DB: db } as any,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    staffRole: string | null;
    permissions: string[];
    gameCreator: { hasAccess: boolean; canApply: boolean; applicationStatus: string | null };
    streamer: { isVerified: boolean };
  };
  assert.equal(body.staffRole, null);
  assert.deepEqual(body.permissions, []);
  assert.equal(body.gameCreator.hasAccess, false);
  // Self-serve applications are currently closed (canApplyForGameCreator() — an operational
  // decision, not a permanent architectural one; see its doc comment), independent of any
  // ACTIVE access or PENDING application.
  assert.equal(body.gameCreator.canApply, false);
  assert.equal(body.gameCreator.applicationStatus, null);
  assert.equal(body.streamer.isVerified, false);
});

test("GET /api/me/access for a managed ADMIN resolves the full permission catalog", async () => {
  const db = await createDb();
  const rawToken = "admin_session";
  const userId = await createUserWithSession(db, rawToken);
  await createManagedAdmin(db, userId, "ADMIN");

  const res = await app.request(
    "/api/me/access",
    { headers: { Cookie: `owogg_session=${rawToken}` } },
    { DB: db } as any,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { staffRole: string; permissions: string[] };
  assert.equal(body.staffRole, "ADMIN");
  // ADMIN's response enumerates the entire catalog (see effectivePermissions) — spot-check a
  // permission absent from the other roles' initial policies to confirm it's really "all".
  assert.ok(body.permissions.includes("roles.manage"));
  assert.ok(body.permissions.includes("system.dev.access"));
});

test("GET /api/me/access for a managed OPERATOR merges the D1 role policy with an individual grant, deduped", async () => {
  const db = await createDb();
  const rawToken = "operator_session";
  const userId = await createUserWithSession(db, rawToken);
  const accountId = await createManagedAdmin(db, userId, "OPERATOR");
  // system.dev.access isn't part of OPERATOR's seeded role policy — grant it individually.
  await grantPermission(db, accountId, "system.dev.access");
  // sandbox_games.review IS already in OPERATOR's seeded role policy — granting it again must not
  // produce a duplicate entry in the response.
  await grantPermission(db, accountId, "sandbox_games.review");

  const res = await app.request(
    "/api/me/access",
    { headers: { Cookie: `owogg_session=${rawToken}` } },
    { DB: db } as any,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { staffRole: string; permissions: string[] };
  assert.equal(body.staffRole, "OPERATOR");
  assert.ok(body.permissions.includes("users.ban")); // role policy
  assert.ok(body.permissions.includes("system.dev.access")); // individual grant
  assert.equal(
    body.permissions.filter((p) => p === "sandbox_games.review").length,
    1,
    "an individual grant for an already-role-granted permission must not duplicate it",
  );
  // ADMIN-only permission must never leak in.
  assert.ok(!body.permissions.includes("roles.manage"));
});

test("GET /api/me/access reflects a role-policy revocation and grant on the next request", async () => {
  const db = await createDb();
  const rawToken = "dynamic_moderator_policy";
  const userId = await createUserWithSession(db, rawToken);
  await createManagedAdmin(db, userId, "MODERATOR");

  const requestAccess = async () => {
    const response = await app.request(
      "/api/me/access",
      { headers: { Cookie: `owogg_session=${rawToken}` } },
      { DB: db } as any,
    );
    assert.equal(response.status, 200);
    return (await response.json()) as { permissions: string[] };
  };

  assert.ok((await requestAccess()).permissions.includes("users.view"));
  await db
    .prepare(
      "DELETE FROM admin_role_permissions WHERE role = 'MODERATOR' AND permission = 'users.view'",
    )
    .run();
  await db
    .prepare(
      `INSERT INTO admin_role_permissions (role, permission, updated_at)
       VALUES ('MODERATOR', 'users.ban', datetime('now'))`,
    )
    .run();

  const changed = await requestAccess();
  assert.equal(changed.permissions.includes("users.view"), false);
  assert.equal(changed.permissions.includes("users.ban"), true);
});

test("GET /api/me/access reflects ACTIVE Game Creator access (hasAccess true, canApply false)", async () => {
  const db = await createDb();
  const rawToken = "creator_session";
  const userId = await createUserWithSession(db, rawToken);
  await grantGameCreatorAccess(db, userId);

  const res = await app.request(
    "/api/me/access",
    { headers: { Cookie: `owogg_session=${rawToken}` } },
    { DB: db } as any,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    gameCreator: { hasAccess: boolean; canApply: boolean; applicationStatus: string | null };
  };
  assert.equal(body.gameCreator.hasAccess, true);
  assert.equal(body.gameCreator.canApply, false);
});

test("GET /api/me/access reflects a PENDING Game Creator application (hasAccess/canApply both false)", async () => {
  const db = await createDb();
  const rawToken = "pending_applicant_session";
  const userId = await createUserWithSession(db, rawToken);
  await createApplication(db, userId, "PENDING");

  const res = await app.request(
    "/api/me/access",
    { headers: { Cookie: `owogg_session=${rawToken}` } },
    { DB: db } as any,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    gameCreator: { hasAccess: boolean; canApply: boolean; applicationStatus: string | null };
  };
  assert.equal(body.gameCreator.hasAccess, false);
  assert.equal(body.gameCreator.canApply, false);
  assert.equal(body.gameCreator.applicationStatus, "PENDING");
});

test("GET /api/me/access reflects a REJECTED application (canApply stays false while applications are closed)", async () => {
  const db = await createDb();
  const rawToken = "rejected_applicant_session";
  const userId = await createUserWithSession(db, rawToken);
  await createApplication(db, userId, "REJECTED");

  const res = await app.request(
    "/api/me/access",
    { headers: { Cookie: `owogg_session=${rawToken}` } },
    { DB: db } as any,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    gameCreator: { hasAccess: boolean; canApply: boolean; applicationStatus: string | null };
  };
  assert.equal(body.gameCreator.hasAccess, false);
  // Being past a PENDING state (REJECTED, not currently pending) is necessary but not sufficient
  // to re-apply — canApplyForGameCreator() being closed still blocks it, same as a brand-new user.
  assert.equal(body.gameCreator.canApply, false);
  assert.equal(body.gameCreator.applicationStatus, "REJECTED");
});

test("GET /api/me/access grants implicit Game Creator access to OPERATOR, but not MODERATOR", async () => {
  const db = await createDb();

  const operatorToken = "operator_implicit_creator_session";
  const operatorUserId = await createUserWithSession(db, operatorToken);
  await createManagedAdmin(db, operatorUserId, "OPERATOR");

  const moderatorToken = "moderator_no_implicit_creator_session";
  const moderatorUserId = await createUserWithSession(db, moderatorToken);
  await createManagedAdmin(db, moderatorUserId, "MODERATOR");

  const operatorRes = await app.request(
    "/api/me/access",
    { headers: { Cookie: `owogg_session=${operatorToken}` } },
    { DB: db } as any,
  );
  const operatorBody = (await operatorRes.json()) as { gameCreator: { hasAccess: boolean } };
  assert.equal(operatorBody.gameCreator.hasAccess, true);

  const moderatorRes = await app.request(
    "/api/me/access",
    { headers: { Cookie: `owogg_session=${moderatorToken}` } },
    { DB: db } as any,
  );
  const moderatorBody = (await moderatorRes.json()) as { gameCreator: { hasAccess: boolean } };
  assert.equal(moderatorBody.gameCreator.hasAccess, false);
});

test("GET /api/me/access reflects a VERIFIED Streamer profile", async () => {
  const db = await createDb();
  const rawToken = "streamer_session";
  const userId = await createUserWithSession(db, rawToken);
  await createVerifiedStreamerProfile(db, userId);

  const res = await app.request(
    "/api/me/access",
    { headers: { Cookie: `owogg_session=${rawToken}` } },
    { DB: db } as any,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { streamer: { isVerified: boolean } };
  assert.equal(body.streamer.isVerified, true);
});

test("GET /api/me/access for a root-only ADMIN_USER_IDS admin (no managed account row) resolves ADMIN with the full catalog and no crash", async () => {
  const db = await createDb();
  const rawToken = "root_admin_session";
  const userId = await createUserWithSession(db, rawToken);

  const res = await app.request(
    "/api/me/access",
    { headers: { Cookie: `owogg_session=${rawToken}` } },
    { DB: db, ADMIN_USER_IDS: String(userId) } as any,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { staffRole: string; permissions: string[] };
  assert.equal(body.staffRole, "ADMIN");
  assert.ok(body.permissions.includes("roles.manage"));
});

test("GET /api/me/access combines an independent Staff Role and Game Creator access in one response (§22)", async () => {
  const db = await createDb();
  const rawToken = "admin_and_creator_session";
  const userId = await createUserWithSession(db, rawToken);
  await createManagedAdmin(db, userId, "ADMIN");
  await grantGameCreatorAccess(db, userId);
  await createVerifiedStreamerProfile(db, userId);

  const res = await app.request(
    "/api/me/access",
    { headers: { Cookie: `owogg_session=${rawToken}` } },
    { DB: db } as any,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    staffRole: string;
    gameCreator: { hasAccess: boolean };
    streamer: { isVerified: boolean };
  };
  assert.equal(body.staffRole, "ADMIN");
  assert.equal(body.gameCreator.hasAccess, true);
  assert.equal(body.streamer.isVerified, true);
});
