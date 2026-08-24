import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createSign, type KeyObject } from "node:crypto";
import { app } from "../src/index.js";
import { clearGoogleJwksCache } from "../src/infrastructure/oauth/google.ts";
import { createSqliteD1 } from "../../../packages/db/test/helpers/sqliteD1.js";

// Route-level tests for the managed admin-account model (migration 0016) using a real SQLite
// engine, exercising ADMIN-only account management and the "eligibility purely via a
// managed account, no ADMIN_USER_IDS membership" invariant (docs/ADMIN_GUIDE.md §15).

const GOOGLE_JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs";
const CLIENT_ID = "test-google-client-id.apps.googleusercontent.com";
const ROOT_ADMIN_USER_ID = 1;
const ROOT_ADMIN_GOOGLE_SUB = "root-admin-google-sub";
const ROOT_ADMIN_SESSION_RAW = "root_admin_session_token";

const OTHER_USER_ID = 2;
const OTHER_GOOGLE_SUB = "other-user-google-sub";
const OTHER_SESSION_RAW = "other_user_session_token";

// Synthetic local-SQLite fixture values only — never real credentials, never used against any
// real deployment. Named constants (not inline literals) so nothing here reads as an actual
// secret to a human or a scanner.
const ROOT_ADMIN_TEST_USERNAME = "e2e-root-admin-fixture-user";
const ROOT_ADMIN_TEST_PASSWORD = "e2e-root-admin-fixture-pw-000-not-real";
const ROTATED_TEST_PASSWORD = "e2e-rotated-fixture-pw-000-not-real";
const SECOND_ADMIN_TEST_PASSWORD = "e2e-second-admin-fixture-pw-000-not-real";

function base64UrlEncode(buf: Uint8Array): string {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function buildJwt(privateKey: KeyObject, payload: Record<string, unknown>): string {
  const headerB64 = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "test-kid-1" })),
  );
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  const sig = signer.sign(privateKey);
  return `${signingInput}.${base64UrlEncode(new Uint8Array(sig))}`;
}

function createRsaKeySet() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicJwk = publicKey.export({ format: "jwk" }) as Record<string, string>;
  return { privateKey, publicJwk };
}

function mockJwksFetch(keys: Record<string, string>[]) {
  const originalFetch = globalThis.fetch;
  return {
    install() {
      globalThis.fetch = (async (input: URL | RequestInfo | string) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === GOOGLE_JWKS_URI) {
          return new Response(JSON.stringify({ keys }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("Not Found", { status: 404 });
      }) as unknown as typeof fetch;
    },
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

function freshGooglePayload(sub: string, overrides: Record<string, unknown> = {}) {
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    exp: nowSec + 3600,
    iat: nowSec,
    sub,
    email: "user@example.com",
    email_verified: true,
    name: "Taeyang (G4)", // display name must never factor into authorization
    picture: null,
    ...overrides,
  };
}

const FULL_SCHEMA = `
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname TEXT NOT NULL,
  email TEXT,
  avatar_url TEXT,
  avatar_provider TEXT,
  country TEXT,
  nickname_updated_at TEXT,
  country_updated_at TEXT,
  locale TEXT,
  current_streak INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  last_active_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE oauth_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  provider_email TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL
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
CREATE TABLE admin_step_up_challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  google_sub TEXT NOT NULL,
  session_token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);
CREATE TABLE admin_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  session_token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE TABLE admin_login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  success INTEGER NOT NULL,
  created_at TEXT NOT NULL
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
`;

function extractCookie(res: Response, name: string): string | null {
  const setCookieHeaders =
    typeof (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === "function"
      ? (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
      : [res.headers.get("set-cookie") ?? ""];
  for (const header of setCookieHeaders) {
    const match = header.match(new RegExp(`${name}=([^;]+)`));
    if (match) return match[1] ?? null;
  }
  return null;
}

async function seedFixtures(raw: import("node:sqlite").DatabaseSync) {
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 86_400_000).toISOString();
  for (const [userId, sessionRaw, googleSub, nickname] of [
    [ROOT_ADMIN_USER_ID, ROOT_ADMIN_SESSION_RAW, ROOT_ADMIN_GOOGLE_SUB, "RootAdmin"],
    [OTHER_USER_ID, OTHER_SESSION_RAW, OTHER_GOOGLE_SUB, "SecondAdmin"],
  ] as const) {
    raw
      .prepare(`INSERT INTO users (id, nickname, created_at, updated_at) VALUES (?, ?, ?, ?)`)
      .run(userId, nickname, now, now);
    raw
      .prepare(`INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
      .run(sessionRaw, userId, now, expires);
    raw
      .prepare(
        `INSERT INTO oauth_accounts (user_id, provider, provider_user_id, provider_email, created_at) VALUES (?, 'google', ?, ?, ?)`,
      )
      .run(userId, googleSub, "user@example.com", now);
  }
}

async function setupWithRootAdmin() {
  const { db, raw } = createSqliteD1(FULL_SCHEMA);
  await seedFixtures(raw);
  const env = {
    DB: db,
    ADMIN_USER_IDS: String(ROOT_ADMIN_USER_ID), // only the root operator — OTHER_USER_ID is deliberately absent
    GOOGLE_CLIENT_ID: CLIENT_ID,
    FRONTEND_URL: "http://localhost:5173",
  };
  return { env, raw };
}

async function elevateToRootAdmin(env: Record<string, unknown>, privateKey: KeyObject) {
  const sessionCookie = `owogg_session=${ROOT_ADMIN_SESSION_RAW}`;
  const idToken = buildJwt(privateKey, freshGooglePayload(ROOT_ADMIN_GOOGLE_SUB));
  const stepUpRes = await app.request(
    "/api/admin/auth/google",
    {
      method: "POST",
      headers: {
        Cookie: sessionCookie,
        "Content-Type": "application/json",
        Origin: "http://localhost:5173",
      },
      body: JSON.stringify({ credential: idToken }),
    },
    env as any,
  );
  const stepUpCookie = extractCookie(stepUpRes, "owogg_admin_stepup");
  const bootstrapRes = await app.request(
    "/api/admin/bootstrap",
    {
      method: "POST",
      headers: {
        Cookie: `${sessionCookie}; owogg_admin_stepup=${stepUpCookie}`,
        "Content-Type": "application/json",
        Origin: "http://localhost:5173",
      },
      body: JSON.stringify({
        username: ROOT_ADMIN_TEST_USERNAME,
        password: ROOT_ADMIN_TEST_PASSWORD,
        passwordConfirm: ROOT_ADMIN_TEST_PASSWORD,
      }),
    },
    env as any,
  );
  const adminSessionCookie = extractCookie(bootstrapRes, "owogg_admin_session");
  const authedCookie = `${sessionCookie}; owogg_admin_session=${adminSessionCookie}`;

  // Bootstrap always forces a password change (must_change_password=true) — clear it so the
  // returned cookie can exercise sensitive ADMIN-only routes, exactly like the real flow.
  const changeRes = await app.request(
    "/api/admin/settings/password",
    {
      method: "POST",
      headers: {
        Cookie: authedCookie,
        "Content-Type": "application/json",
        Origin: "http://localhost:5173",
      },
      body: JSON.stringify({
        currentPassword: ROOT_ADMIN_TEST_PASSWORD,
        newPassword: ROTATED_TEST_PASSWORD,
        newPasswordConfirm: ROTATED_TEST_PASSWORD,
      }),
    },
    env as any,
  );
  const rotatedAdminSessionCookie = extractCookie(changeRes, "owogg_admin_session");
  return `${sessionCookie}; owogg_admin_session=${rotatedAdminSessionCookie}`;
}

test("ADMIN can create another ADMIN for a linked OwOGG user; response never leaks passwordHash/googleSub; the new admin can independently authenticate with no ADMIN_USER_IDS membership", async () => {
  clearGoogleJwksCache();
  const { privateKey, publicJwk } = createRsaKeySet();
  const jwks = mockJwksFetch([{ ...publicJwk, kid: "test-kid-1", use: "sig", alg: "RS256" }]);
  jwks.install();
  try {
    const { env } = await setupWithRootAdmin();
    const rootAdminCookie = await elevateToRootAdmin(env, privateKey);

    const createRes = await app.request(
      "/api/admin/accounts",
      {
        method: "POST",
        headers: {
          Cookie: rootAdminCookie,
          "Content-Type": "application/json",
          Origin: "http://localhost:5173",
        },
        body: JSON.stringify({
          userId: OTHER_USER_ID,
          username: "second-admin",
          password: SECOND_ADMIN_TEST_PASSWORD,
          role: "ADMIN",
        }),
      },
      env as any,
    );
    assert.equal(createRes.status, 201);
    const created = (await createRes.json()) as Record<string, unknown>;
    assert.equal(created.role, "ADMIN");
    assert.equal("passwordHash" in created, false);
    assert.equal("googleSub" in created, false);
    assert.equal(JSON.stringify(created).includes(SECOND_ADMIN_TEST_PASSWORD), false);

    // The new admin (NOT in ADMIN_USER_IDS) independently completes step-up + login using only
    // their managed admin_accounts row — this is the whole point of the migration: no GitHub
    // Secret/Variable edit was needed for this second administrator.
    const otherSessionCookie = `owogg_session=${OTHER_SESSION_RAW}`;
    const otherIdToken = buildJwt(privateKey, freshGooglePayload(OTHER_GOOGLE_SUB));
    const otherStepUp = await app.request(
      "/api/admin/auth/google",
      {
        method: "POST",
        headers: {
          Cookie: otherSessionCookie,
          "Content-Type": "application/json",
          Origin: "http://localhost:5173",
        },
        body: JSON.stringify({ credential: otherIdToken }),
      },
      env as any,
    );
    assert.equal(otherStepUp.status, 200);
    const otherStepUpCookie = extractCookie(otherStepUp, "owogg_admin_stepup");

    const otherLogin = await app.request(
      "/api/admin/auth/login",
      {
        method: "POST",
        headers: {
          Cookie: `${otherSessionCookie}; owogg_admin_stepup=${otherStepUpCookie}`,
          "Content-Type": "application/json",
          Origin: "http://localhost:5173",
        },
        body: JSON.stringify({
          username: "second-admin",
          password: SECOND_ADMIN_TEST_PASSWORD,
        }),
      },
      env as any,
    );
    assert.equal(otherLogin.status, 200);
    assert.deepEqual(await otherLogin.json(), {
      adminAuthenticated: true,
      mustChangePassword: true,
    });

    // But this second ADMIN account (created via the API, not root-eligible) still requires its
    // own completed step-up + rotated password before it can manage other admin accounts —
    // it just did step-up + login above, but never rotated its forced temporary password.
    const otherAdminSessionCookie = extractCookie(otherLogin, "owogg_admin_session");
    const deniedList = await app.request(
      "/api/admin/accounts",
      {
        headers: {
          Cookie: `${otherSessionCookie}; owogg_admin_session=${otherAdminSessionCookie}`,
        },
      },
      env as any,
    );
    assert.equal(deniedList.status, 403);
  } finally {
    jwks.restore();
  }
});

test("creating an admin for a user with no linked Google account is rejected", async () => {
  clearGoogleJwksCache();
  const { privateKey, publicJwk } = createRsaKeySet();
  const jwks = mockJwksFetch([{ ...publicJwk, kid: "test-kid-1", use: "sig", alg: "RS256" }]);
  jwks.install();
  try {
    const { env, raw } = await setupWithRootAdmin();
    // Add a third user with no google oauth_accounts row.
    const now = new Date().toISOString();
    raw
      .prepare(`INSERT INTO users (id, nickname, created_at, updated_at) VALUES (?, ?, ?, ?)`)
      .run(3, "NoGoogleUser", now, now);

    const rootAdminCookie = await elevateToRootAdmin(env, privateKey);
    const res = await app.request(
      "/api/admin/accounts",
      {
        method: "POST",
        headers: {
          Cookie: rootAdminCookie,
          "Content-Type": "application/json",
          Origin: "http://localhost:5173",
        },
        body: JSON.stringify({
          userId: 3,
          username: "no-google-admin",
          password: SECOND_ADMIN_TEST_PASSWORD,
          role: "ADMIN",
        }),
      },
      env as any,
    );
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error.code, "GOOGLE_NOT_LINKED");
  } finally {
    jwks.restore();
  }
});

// A lone ADMIN acting through the real HTTP/session chain is necessarily acting on THEMSELVES
// here (nobody else can reach these endpoints — requireManagedAdminTarget itself requires a
// managed ADMIN account), so this exercises the self-lockout guard (CANNOT_MODIFY_SELF), which
// fires before the separate last-active-ADMIN count check ever runs. The last-ADMIN check on a
// genuinely different actor is exercised directly at the use-case level instead — see
// packages/core/test/adminAccountUseCases.test.ts, since it's not reachable through this HTTP
// chain (an actor who could act on a different, sole remaining ADMIN would themselves have to be
// a second ADMIN, at which point the target is no longer "the last one").
test("a lone ADMIN cannot disable or demote themselves (self-lockout guard)", async () => {
  clearGoogleJwksCache();
  const { privateKey, publicJwk } = createRsaKeySet();
  const jwks = mockJwksFetch([{ ...publicJwk, kid: "test-kid-1", use: "sig", alg: "RS256" }]);
  jwks.install();
  try {
    const { env } = await setupWithRootAdmin();
    const rootAdminCookie = await elevateToRootAdmin(env, privateKey);

    const listRes = await app.request(
      "/api/admin/accounts",
      { headers: { Cookie: rootAdminCookie } },
      env as any,
    );
    const accounts = ((await listRes.json()) as { accounts: Array<{ id: number }> }).accounts;
    const selfId = accounts[0]!.id;

    const disableRes = await app.request(
      `/api/admin/accounts/${selfId}/status`,
      {
        method: "PATCH",
        headers: {
          Cookie: rootAdminCookie,
          "Content-Type": "application/json",
          Origin: "http://localhost:5173",
        },
        body: JSON.stringify({ status: "DISABLED" }),
      },
      env as any,
    );
    assert.equal(disableRes.status, 409);
    assert.equal((await disableRes.json()).error.code, "CANNOT_MODIFY_SELF");

    const demoteRes = await app.request(
      `/api/admin/accounts/${selfId}/role`,
      {
        method: "PATCH",
        headers: {
          Cookie: rootAdminCookie,
          "Content-Type": "application/json",
          Origin: "http://localhost:5173",
        },
        body: JSON.stringify({ role: "OPERATOR" }),
      },
      env as any,
    );
    assert.equal(demoteRes.status, 409);
    assert.equal((await demoteRes.json()).error.code, "CANNOT_MODIFY_SELF");
  } finally {
    jwks.restore();
  }
});

test("audit log records ADMIN_CREATED for both bootstrap and ADMIN-created admins", async () => {
  clearGoogleJwksCache();
  const { privateKey, publicJwk } = createRsaKeySet();
  const jwks = mockJwksFetch([{ ...publicJwk, kid: "test-kid-1", use: "sig", alg: "RS256" }]);
  jwks.install();
  try {
    const { env } = await setupWithRootAdmin();
    const rootAdminCookie = await elevateToRootAdmin(env, privateKey);

    await app.request(
      "/api/admin/accounts",
      {
        method: "POST",
        headers: {
          Cookie: rootAdminCookie,
          "Content-Type": "application/json",
          Origin: "http://localhost:5173",
        },
        body: JSON.stringify({
          userId: OTHER_USER_ID,
          username: "second-admin",
          password: SECOND_ADMIN_TEST_PASSWORD,
          role: "ADMIN",
        }),
      },
      env as any,
    );

    const auditRes = await app.request(
      "/api/admin/accounts/audit",
      { headers: { Cookie: rootAdminCookie } },
      env as any,
    );
    assert.equal(auditRes.status, 200);
    const entries = ((await auditRes.json()) as { entries: Array<{ action: string }> }).entries;
    const createdCount = entries.filter((e) => e.action === "ADMIN_CREATED").length;
    assert.equal(createdCount, 2); // bootstrap + this create
    assert.equal(JSON.stringify(entries).includes(SECOND_ADMIN_TEST_PASSWORD), false);
  } finally {
    jwks.restore();
  }
});

// ── Individual permission delegation (migration 0025) ────────────────────────

/** Completes Google step-up + username/password login + forced password rotation for a
 * non-root managed admin (OTHER_USER_ID), mirroring elevateToRootAdmin's shape but via the
 * login endpoint instead of bootstrap — a managed account created by POST /api/admin/accounts
 * is never bootstrapped, it logs in. Returns a cookie string ready for sensitive routes (no
 * must_change_password left pending), the same way elevateToRootAdmin does for the root account. */
async function elevateSecondAdmin(env: Record<string, unknown>, privateKey: KeyObject) {
  const sessionCookie = `owogg_session=${OTHER_SESSION_RAW}`;
  const idToken = buildJwt(privateKey, freshGooglePayload(OTHER_GOOGLE_SUB));
  const stepUpRes = await app.request(
    "/api/admin/auth/google",
    {
      method: "POST",
      headers: {
        Cookie: sessionCookie,
        "Content-Type": "application/json",
        Origin: "http://localhost:5173",
      },
      body: JSON.stringify({ credential: idToken }),
    },
    env as any,
  );
  const stepUpCookie = extractCookie(stepUpRes, "owogg_admin_stepup");
  const loginRes = await app.request(
    "/api/admin/auth/login",
    {
      method: "POST",
      headers: {
        Cookie: `${sessionCookie}; owogg_admin_stepup=${stepUpCookie}`,
        "Content-Type": "application/json",
        Origin: "http://localhost:5173",
      },
      body: JSON.stringify({ username: "second-admin", password: SECOND_ADMIN_TEST_PASSWORD }),
    },
    env as any,
  );
  const adminSessionCookie = extractCookie(loginRes, "owogg_admin_session");
  const authedCookie = `${sessionCookie}; owogg_admin_session=${adminSessionCookie}`;

  const changeRes = await app.request(
    "/api/admin/settings/password",
    {
      method: "POST",
      headers: {
        Cookie: authedCookie,
        "Content-Type": "application/json",
        Origin: "http://localhost:5173",
      },
      body: JSON.stringify({
        currentPassword: SECOND_ADMIN_TEST_PASSWORD,
        newPassword: ROTATED_TEST_PASSWORD,
        newPasswordConfirm: ROTATED_TEST_PASSWORD,
      }),
    },
    env as any,
  );
  const rotatedCookie = extractCookie(changeRes, "owogg_admin_session");
  return `${sessionCookie}; owogg_admin_session=${rotatedCookie}`;
}

test("ADMIN grants and revokes an individual permission on a managed OPERATOR account; roles.manage is rejected as non-delegable", async () => {
  clearGoogleJwksCache();
  const { privateKey, publicJwk } = createRsaKeySet();
  const jwks = mockJwksFetch([{ ...publicJwk, kid: "test-kid-1", use: "sig", alg: "RS256" }]);
  jwks.install();
  try {
    const { env } = await setupWithRootAdmin();
    const rootAdminCookie = await elevateToRootAdmin(env, privateKey);

    const createRes = await app.request(
      "/api/admin/accounts",
      {
        method: "POST",
        headers: {
          Cookie: rootAdminCookie,
          "Content-Type": "application/json",
          Origin: "http://localhost:5173",
        },
        body: JSON.stringify({
          userId: OTHER_USER_ID,
          username: "second-admin",
          password: SECOND_ADMIN_TEST_PASSWORD,
          role: "OPERATOR",
        }),
      },
      env as any,
    );
    assert.equal(createRes.status, 201);
    const targetId = ((await createRes.json()) as { id: number }).id;

    // Starts empty — this endpoint lists account-specific exceptions, not the role policy.
    const emptyList = await app.request(
      `/api/admin/accounts/${targetId}/permissions`,
      { headers: { Cookie: rootAdminCookie } },
      env as any,
    );
    assert.equal(emptyList.status, 200);
    assert.deepEqual((await emptyList.json()) as { permissions: string[] }, { permissions: [] });

    const grantRes = await app.request(
      `/api/admin/accounts/${targetId}/permissions`,
      {
        method: "POST",
        headers: {
          Cookie: rootAdminCookie,
          "Content-Type": "application/json",
          Origin: "http://localhost:5173",
        },
        body: JSON.stringify({ permission: "system.dev.access" }),
      },
      env as any,
    );
    assert.equal(grantRes.status, 200);

    const afterGrant = await app.request(
      `/api/admin/accounts/${targetId}/permissions`,
      { headers: { Cookie: rootAdminCookie } },
      env as any,
    );
    assert.deepEqual((await afterGrant.json()) as { permissions: string[] }, {
      permissions: ["system.dev.access"],
    });

    // roles.manage must never be delegable, even by an ADMIN acting on a managed account.
    const grantRolesManage = await app.request(
      `/api/admin/accounts/${targetId}/permissions`,
      {
        method: "POST",
        headers: {
          Cookie: rootAdminCookie,
          "Content-Type": "application/json",
          Origin: "http://localhost:5173",
        },
        body: JSON.stringify({ permission: "roles.manage" }),
      },
      env as any,
    );
    assert.equal(grantRolesManage.status, 409);
    const grantRolesManageBody = (await grantRolesManage.json()) as { error: { code: string } };
    assert.equal(grantRolesManageBody.error.code, "PERMISSION_NOT_DELEGABLE");

    const revokeRes = await app.request(
      `/api/admin/accounts/${targetId}/permissions/system.dev.access`,
      { method: "DELETE", headers: { Cookie: rootAdminCookie, Origin: "http://localhost:5173" } },
      env as any,
    );
    assert.equal(revokeRes.status, 200);

    const afterRevoke = await app.request(
      `/api/admin/accounts/${targetId}/permissions`,
      { headers: { Cookie: rootAdminCookie } },
      env as any,
    );
    assert.deepEqual((await afterRevoke.json()) as { permissions: string[] }, { permissions: [] });
  } finally {
    jwks.restore();
  }
});

test("managed ADMIN lists and replaces a role permission policy; roles.manage is rejected", async () => {
  clearGoogleJwksCache();
  const { privateKey, publicJwk } = createRsaKeySet();
  const jwks = mockJwksFetch([{ ...publicJwk, kid: "test-kid-1", use: "sig", alg: "RS256" }]);
  jwks.install();
  try {
    const { env, raw } = await setupWithRootAdmin();
    const rootAdminCookie = await elevateToRootAdmin(env, privateKey);

    const listRes = await app.request(
      "/api/admin/role-permissions",
      { headers: { Cookie: rootAdminCookie } },
      env as any,
    );
    assert.equal(listRes.status, 200);
    const listed = (await listRes.json()) as {
      roles: Array<{ role: string; permissions: string[] }>;
    };
    assert.deepEqual(
      listed.roles.map(({ role }) => role),
      ["OPERATOR", "MODERATOR", "SYSTEM_DEVELOPER"],
    );

    const replaceRes = await app.request(
      "/api/admin/role-permissions/MODERATOR",
      {
        method: "PUT",
        headers: {
          Cookie: rootAdminCookie,
          "Content-Type": "application/json",
          Origin: "http://localhost:5173",
        },
        body: JSON.stringify({ permissions: ["admin.center.access", "users.view"] }),
      },
      env as any,
    );
    assert.equal(replaceRes.status, 200);
    assert.deepEqual((await replaceRes.json()) as object, {
      role: "MODERATOR",
      permissions: ["admin.center.access", "users.view"],
    });
    assert.deepEqual(
      raw
        .prepare(
          "SELECT permission FROM admin_role_permissions WHERE role = 'MODERATOR' ORDER BY permission",
        )
        .all()
        .map((row) => (row as { permission: string }).permission),
      ["admin.center.access", "users.view"],
    );
    const audit = raw
      .prepare(
        "SELECT action, metadata_json FROM admin_account_audit_log WHERE action = 'ROLE_PERMISSIONS_UPDATED'",
      )
      .get() as { action: string; metadata_json: string };
    assert.equal(audit.action, "ROLE_PERMISSIONS_UPDATED");
    assert.equal(JSON.parse(audit.metadata_json).role, "MODERATOR");

    const forbidden = await app.request(
      "/api/admin/role-permissions/OPERATOR",
      {
        method: "PUT",
        headers: {
          Cookie: rootAdminCookie,
          "Content-Type": "application/json",
          Origin: "http://localhost:5173",
        },
        body: JSON.stringify({ permissions: ["roles.manage"] }),
      },
      env as any,
    );
    assert.equal(forbidden.status, 400);
  } finally {
    jwks.restore();
  }
});

test("a managed OPERATOR (not ADMIN) is denied on every permission-delegation endpoint (403 FORBIDDEN)", async () => {
  clearGoogleJwksCache();
  const { privateKey, publicJwk } = createRsaKeySet();
  const jwks = mockJwksFetch([{ ...publicJwk, kid: "test-kid-1", use: "sig", alg: "RS256" }]);
  jwks.install();
  try {
    const { env } = await setupWithRootAdmin();
    const rootAdminCookie = await elevateToRootAdmin(env, privateKey);

    const createRes = await app.request(
      "/api/admin/accounts",
      {
        method: "POST",
        headers: {
          Cookie: rootAdminCookie,
          "Content-Type": "application/json",
          Origin: "http://localhost:5173",
        },
        body: JSON.stringify({
          userId: OTHER_USER_ID,
          username: "second-admin",
          password: SECOND_ADMIN_TEST_PASSWORD,
          role: "OPERATOR",
        }),
      },
      env as any,
    );
    const targetId = ((await createRes.json()) as { id: number }).id;
    const operatorCookie = await elevateSecondAdmin(env, privateKey);

    const listRes = await app.request(
      `/api/admin/accounts/${targetId}/permissions`,
      { headers: { Cookie: operatorCookie } },
      env as any,
    );
    assert.equal(listRes.status, 403);

    const grantRes = await app.request(
      `/api/admin/accounts/${targetId}/permissions`,
      {
        method: "POST",
        headers: {
          Cookie: operatorCookie,
          "Content-Type": "application/json",
          Origin: "http://localhost:5173",
        },
        body: JSON.stringify({ permission: "system.dev.access" }),
      },
      env as any,
    );
    assert.equal(grantRes.status, 403);

    // Even an OPERATOR granting a permission to THEMSELVES is denied — permission delegation
    // stays an ADMIN-only capability, not something any managed account can self-serve.
    const selfGrantRes = await app.request(
      `/api/admin/accounts/${targetId}/permissions`,
      {
        method: "POST",
        headers: {
          Cookie: operatorCookie,
          "Content-Type": "application/json",
          Origin: "http://localhost:5173",
        },
        body: JSON.stringify({ permission: "admin.center.access" }),
      },
      env as any,
    );
    assert.equal(selfGrantRes.status, 403);

    const revokeRes = await app.request(
      `/api/admin/accounts/${targetId}/permissions/system.dev.access`,
      { method: "DELETE", headers: { Cookie: operatorCookie, Origin: "http://localhost:5173" } },
      env as any,
    );
    assert.equal(revokeRes.status, 403);

    const roleListRes = await app.request(
      "/api/admin/role-permissions",
      { headers: { Cookie: operatorCookie } },
      env as any,
    );
    assert.equal(roleListRes.status, 403);

    const roleUpdateRes = await app.request(
      "/api/admin/role-permissions/MODERATOR",
      {
        method: "PUT",
        headers: {
          Cookie: operatorCookie,
          "Content-Type": "application/json",
          Origin: "http://localhost:5173",
        },
        body: JSON.stringify({ permissions: ["users.view"] }),
      },
      env as any,
    );
    assert.equal(roleUpdateRes.status, 403);
  } finally {
    jwks.restore();
  }
});
