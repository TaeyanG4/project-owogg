import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createSign, type KeyObject } from "node:crypto";
import { app } from "../src/app.js";
import { clearGoogleJwksCache } from "../src/infrastructure/oauth/google.ts";
import { createSqliteD1 } from "../../../packages/db/test/helpers/sqliteD1.js";

// Full route-level integration test for the admin step-up authentication flow, backed by a
// real SQLite engine (same helper packages/db uses) rather than a hand-rolled query-matching
// mock — this exercises the actual production SQL end to end, including hashing/binding.

const GOOGLE_JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs";
const CLIENT_ID = "test-google-client-id.apps.googleusercontent.com";
const ADMIN_GOOGLE_SUB = "admin-google-sub-1";
const ADMIN_USER_ID = 1;
const OWOGG_SESSION_RAW = "e2e_valid_session_token";
const ADMIN_USERNAME = "owogg-admin";
const ADMIN_PASSWORD = "correct-horse-battery-staple";
// Synthetic local-SQLite fixture values only — never real credentials, never used against any
// real deployment. Named constants (not inline literals) so nothing here reads as an actual
// secret to a human or a scanner.
const BOOTSTRAP_TEST_USERNAME = "e2e-bootstrap-fixture-user";
const BOOTSTRAP_TEST_PASSWORD = "e2e-bootstrap-fixture-pw-000-not-real";
const CHANGED_TEST_PASSWORD = "e2e-changed-fixture-pw-000-not-real";

function base64UrlEncode(buf: Uint8Array): string {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function buildJwt(
  privateKey: KeyObject,
  payload: Record<string, unknown>,
  headerKid = "test-kid-1",
): string {
  const headerB64 = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT", kid: headerKid })),
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

function freshGooglePayload(overrides: Record<string, unknown> = {}) {
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    exp: nowSec + 3600,
    iat: nowSec,
    sub: ADMIN_GOOGLE_SUB,
    email: "admin@example.com",
    email_verified: true,
    name: "Admin",
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
CREATE TABLE discord_guilds (
  guild_id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  icon_url TEXT,
  description TEXT,
  visibility TEXT NOT NULL DEFAULT 'PUBLIC',
  registration_status TEXT NOT NULL DEFAULT 'ACTIVE',
  registered_by_user_id INTEGER NOT NULL,
  registered_at TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE streamer_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'UNVERIFIED',
  featured_status TEXT NOT NULL DEFAULT 'NONE',
  featured_reason TEXT,
  featured_since TEXT,
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
  audience_count INTEGER DEFAULT 0,
  audience_count_known INTEGER NOT NULL DEFAULT 0,
  channel_created_at TEXT,
  metrics_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE streamer_review_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  streamer_platform_account_id INTEGER NOT NULL,
  review_type TEXT NOT NULL DEFAULT 'ACQUISITION',
  status TEXT NOT NULL,
  initial_audience INTEGER,
  initial_channel_created_at TEXT,
  next_check_at TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  review_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE TABLE streamer_review_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  streamer_platform_account_id INTEGER NOT NULL,
  review_job_id INTEGER,
  reviewer_user_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  previous_status TEXT NOT NULL,
  new_status TEXT NOT NULL,
  metric_snapshot TEXT,
  created_at TEXT NOT NULL
);
`;

async function seedFixtures(raw: import("node:sqlite").DatabaseSync) {
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 86_400_000).toISOString();
  raw
    .prepare(`INSERT INTO users (id, nickname, created_at, updated_at) VALUES (?, ?, ?, ?)`)
    .run(ADMIN_USER_ID, "AdminUser", now, now);
  raw
    .prepare(`INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
    .run(OWOGG_SESSION_RAW, ADMIN_USER_ID, now, expires);
  raw
    .prepare(
      `INSERT INTO oauth_accounts (user_id, provider, provider_user_id, provider_email, created_at) VALUES (?, 'google', ?, ?, ?)`,
    )
    .run(ADMIN_USER_ID, ADMIN_GOOGLE_SUB, "admin@example.com", now);
}

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

async function setup() {
  const { db, raw } = createSqliteD1(FULL_SCHEMA);
  await seedFixtures(raw);
  const { hashAdminPassword } = await import("../src/auth/adminPassword.js");
  const passwordRecord = await hashAdminPassword(ADMIN_PASSWORD, 1000);
  const env = {
    DB: db,
    ADMIN_USER_IDS: String(ADMIN_USER_ID),
    ADMIN_GOOGLE_SUBS: ADMIN_GOOGLE_SUB,
    ADMIN_LOGIN_USERNAME: ADMIN_USERNAME,
    ADMIN_PASSWORD_PBKDF2: passwordRecord,
    GOOGLE_CLIENT_ID: CLIENT_ID,
    FRONTEND_URL: "http://localhost:5173",
  };
  return { env };
}

test("full admin step-up flow: Google step-up -> login -> elevated session -> logout", async () => {
  clearGoogleJwksCache();
  const { privateKey, publicJwk } = createRsaKeySet();
  const jwks = mockJwksFetch([{ ...publicJwk, kid: "test-kid-1", use: "sig", alg: "RS256" }]);
  jwks.install();

  try {
    const { env } = await setup();
    const sessionCookie = `owogg_session=${OWOGG_SESSION_RAW}`;

    // Before any step-up: eligible, not admin-authenticated.
    const meBefore = await app.request(
      "/api/admin/me",
      { headers: { Cookie: sessionCookie } },
      env as any,
    );
    assert.deepEqual(await meBefore.json(), {
      authenticated: true,
      eligible: true,
      adminAuthenticated: false,
      stepUpRequired: true,
      bootstrapAvailable: true, // no managed admin account exists yet in this fixture
      mustChangePassword: false,
      role: null,
    });

    // Step 1: Google step-up.
    const idToken = buildJwt(privateKey, freshGooglePayload());
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
    assert.equal(stepUpRes.status, 200);
    assert.deepEqual(await stepUpRes.json(), { stepUpVerified: true });
    const stepUpCookie = extractCookie(stepUpRes, "owogg_admin_stepup");
    assert.ok(stepUpCookie, "step-up cookie must be set");

    // Step 2: admin username/password login.
    const loginRes = await app.request(
      "/api/admin/auth/login",
      {
        method: "POST",
        headers: {
          Cookie: `${sessionCookie}; owogg_admin_stepup=${stepUpCookie}`,
          "Content-Type": "application/json",
          Origin: "http://localhost:5173",
        },
        body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD }),
      },
      env as any,
    );
    assert.equal(loginRes.status, 200);
    assert.deepEqual(await loginRes.json(), {
      adminAuthenticated: true,
      mustChangePassword: false,
    });
    const adminSessionCookie = extractCookie(loginRes, "owogg_admin_session");
    assert.ok(adminSessionCookie, "admin session cookie must be set");

    // Now elevated.
    const meAfter = await app.request(
      "/api/admin/me",
      { headers: { Cookie: `${sessionCookie}; owogg_admin_session=${adminSessionCookie}` } },
      env as any,
    );
    assert.deepEqual(await meAfter.json(), {
      authenticated: true,
      eligible: true,
      adminAuthenticated: true,
      stepUpRequired: false,
      bootstrapAvailable: false,
      mustChangePassword: false,
      // Legacy env-credential admin — no managed admin_accounts row, but ADMIN_USER_IDS root
      // eligibility resolves to the top Staff Role regardless (see resolveEffectiveStaffRole).
      role: "ADMIN",
    });

    // Protected admin endpoint now succeeds.
    const overview = await app.request(
      "/api/admin/overview",
      { headers: { Cookie: `${sessionCookie}; owogg_admin_session=${adminSessionCookie}` } },
      env as any,
    );
    assert.equal(overview.status, 200);

    // The step-up challenge is single-use — retrying login with the same (now-cleared) cookie fails.
    const replayLogin = await app.request(
      "/api/admin/auth/login",
      {
        method: "POST",
        headers: {
          Cookie: `${sessionCookie}; owogg_admin_stepup=${stepUpCookie}`,
          "Content-Type": "application/json",
          Origin: "http://localhost:5173",
        },
        body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD }),
      },
      env as any,
    );
    assert.equal(replayLogin.status, 403);

    // Logout revokes the admin session.
    const logout = await app.request(
      "/api/admin/auth/logout",
      {
        method: "POST",
        headers: {
          Cookie: `${sessionCookie}; owogg_admin_session=${adminSessionCookie}`,
          Origin: "http://localhost:5173",
        },
      },
      env as any,
    );
    assert.equal(logout.status, 200);

    const afterLogout = await app.request(
      "/api/admin/overview",
      { headers: { Cookie: `${sessionCookie}; owogg_admin_session=${adminSessionCookie}` } },
      env as any,
    );
    assert.equal(afterLogout.status, 403);
  } finally {
    jwks.restore();
  }
});

test("login without completing step-up first is denied (403), never bypasses to a session", async () => {
  clearGoogleJwksCache();
  const { env } = await setup();
  const sessionCookie = `owogg_session=${OWOGG_SESSION_RAW}`;

  const res = await app.request(
    "/api/admin/auth/login",
    {
      method: "POST",
      headers: {
        Cookie: sessionCookie,
        "Content-Type": "application/json",
        Origin: "http://localhost:5173",
      },
      body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD }),
    },
    env as any,
  );
  assert.equal(res.status, 403);
});

test("Google step-up: sub not in ADMIN_GOOGLE_SUBS is denied even for an eligible user", async () => {
  clearGoogleJwksCache();
  const { privateKey, publicJwk } = createRsaKeySet();
  const jwks = mockJwksFetch([{ ...publicJwk, kid: "test-kid-1", use: "sig", alg: "RS256" }]);
  jwks.install();
  try {
    const { env } = await setup();
    const sessionCookie = `owogg_session=${OWOGG_SESSION_RAW}`;
    const idToken = buildJwt(privateKey, freshGooglePayload({ sub: "some-other-sub" }));

    const res = await app.request(
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
    assert.equal(res.status, 403);
  } finally {
    jwks.restore();
  }
});

test("Google step-up: stale token (old iat) is rejected even though still cryptographically valid", async () => {
  clearGoogleJwksCache();
  const { privateKey, publicJwk } = createRsaKeySet();
  const jwks = mockJwksFetch([{ ...publicJwk, kid: "test-kid-1", use: "sig", alg: "RS256" }]);
  jwks.install();
  try {
    const { env } = await setup();
    const sessionCookie = `owogg_session=${OWOGG_SESSION_RAW}`;
    const staleIat = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
    const idToken = buildJwt(privateKey, freshGooglePayload({ iat: staleIat }));

    const res = await app.request(
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
    assert.equal(res.status, 403);
  } finally {
    jwks.restore();
  }
});

test("admin login: wrong password after valid step-up is rate-limited after 5 failures", async () => {
  clearGoogleJwksCache();
  const { privateKey, publicJwk } = createRsaKeySet();
  const jwks = mockJwksFetch([{ ...publicJwk, kid: "test-kid-1", use: "sig", alg: "RS256" }]);
  jwks.install();
  try {
    const { env } = await setup();
    const sessionCookie = `owogg_session=${OWOGG_SESSION_RAW}`;

    for (let i = 0; i < 5; i++) {
      const idToken = buildJwt(privateKey, freshGooglePayload());
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
          body: JSON.stringify({ username: ADMIN_USERNAME, password: "wrong-password" }),
        },
        env as any,
      );
      assert.equal(loginRes.status, 401);
    }

    // 6th attempt (even with a fresh, valid step-up) is rate-limited before credentials are checked.
    const idToken = buildJwt(privateKey, freshGooglePayload());
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

    const lockedRes = await app.request(
      "/api/admin/auth/login",
      {
        method: "POST",
        headers: {
          Cookie: `${sessionCookie}; owogg_admin_stepup=${stepUpCookie}`,
          "Content-Type": "application/json",
          Origin: "http://localhost:5173",
        },
        body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD }), // even correct now
      },
      env as any,
    );
    assert.equal(lockedRes.status, 429);
    assert.ok(lockedRes.headers.get("Retry-After"));
  } finally {
    jwks.restore();
  }
});

test("ADMIN_USER_IDS removed after an admin session was already issued is immediately denied", async () => {
  clearGoogleJwksCache();
  const { privateKey, publicJwk } = createRsaKeySet();
  const jwks = mockJwksFetch([{ ...publicJwk, kid: "test-kid-1", use: "sig", alg: "RS256" }]);
  jwks.install();
  try {
    const { env } = await setup();
    const sessionCookie = `owogg_session=${OWOGG_SESSION_RAW}`;
    const idToken = buildJwt(privateKey, freshGooglePayload());
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
        body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD }),
      },
      env as any,
    );
    const adminSessionCookie = extractCookie(loginRes, "owogg_admin_session");

    // Operator removes this user from ADMIN_USER_IDS — the still-unexpired admin session cookie
    // must no longer grant access.
    const envWithoutAdmin = { ...env, ADMIN_USER_IDS: "" };
    const res = await app.request(
      "/api/admin/overview",
      { headers: { Cookie: `${sessionCookie}; owogg_admin_session=${adminSessionCookie}` } },
      envWithoutAdmin as any,
    );
    assert.equal(res.status, 403);
  } finally {
    jwks.restore();
  }
});

// ---------------------------------------------------------------------------
// Managed administrator accounts (migration 0016) — bootstrap, forced password change,
// self password change, and optional ADMIN_GOOGLE_SUBS.
// ---------------------------------------------------------------------------

async function googleStepUp(
  env: Record<string, unknown>,
  privateKey: KeyObject,
  sessionCookie: string,
) {
  const idToken = buildJwt(privateKey, freshGooglePayload());
  const res = await app.request(
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
  return { res, stepUpCookie: extractCookie(res, "owogg_admin_stepup") };
}

test("Google step-up: unset ADMIN_GOOGLE_SUBS (optional allowlist) never blocks an otherwise-linked eligible user", async () => {
  clearGoogleJwksCache();
  const { privateKey, publicJwk } = createRsaKeySet();
  const jwks = mockJwksFetch([{ ...publicJwk, kid: "test-kid-1", use: "sig", alg: "RS256" }]);
  jwks.install();
  try {
    const { env } = await setup();
    const envWithoutAllowlist: Record<string, unknown> = { ...(env as Record<string, unknown>) };
    delete envWithoutAllowlist.ADMIN_GOOGLE_SUBS;
    const sessionCookie = `owogg_session=${OWOGG_SESSION_RAW}`;
    const { res } = await googleStepUp(envWithoutAllowlist, privateKey, sessionCookie);
    assert.equal(res.status, 200);
  } finally {
    jwks.restore();
  }
});

test("bootstrap: first ADMIN can be created once; forced password change gates sensitive routes; duplicate bootstrap is rejected", async () => {
  clearGoogleJwksCache();
  const { privateKey, publicJwk } = createRsaKeySet();
  const jwks = mockJwksFetch([{ ...publicJwk, kid: "test-kid-1", use: "sig", alg: "RS256" }]);
  jwks.install();
  try {
    const { env } = await setup();
    const sessionCookie = `owogg_session=${OWOGG_SESSION_RAW}`;

    // Root-eligible + no admin account exists anywhere yet -> bootstrapAvailable.
    const meBeforeBootstrap = await app.request(
      "/api/admin/me",
      { headers: { Cookie: sessionCookie } },
      env as any,
    );
    const meBeforeBootstrapBody = (await meBeforeBootstrap.json()) as any;
    assert.equal(meBeforeBootstrapBody.bootstrapAvailable, true);

    const { stepUpCookie } = await googleStepUp(env, privateKey, sessionCookie);

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
          username: BOOTSTRAP_TEST_USERNAME,
          password: BOOTSTRAP_TEST_PASSWORD,
          passwordConfirm: BOOTSTRAP_TEST_PASSWORD,
        }),
      },
      env as any,
    );
    assert.equal(bootstrapRes.status, 200);
    assert.deepEqual(await bootstrapRes.json(), {
      adminAuthenticated: true,
      mustChangePassword: true,
    });
    const adminSessionCookie = extractCookie(bootstrapRes, "owogg_admin_session");
    assert.ok(adminSessionCookie);
    const authedCookie = `${sessionCookie}; owogg_admin_session=${adminSessionCookie}`;

    // /me now reports ADMIN (the top Staff Role — bootstrap always creates one) +
    // mustChangePassword, and bootstrap is no longer available.
    const meAfter = await app.request(
      "/api/admin/me",
      { headers: { Cookie: authedCookie } },
      env as any,
    );
    assert.deepEqual(await meAfter.json(), {
      authenticated: true,
      eligible: true,
      adminAuthenticated: true,
      stepUpRequired: false,
      bootstrapAvailable: false,
      mustChangePassword: true,
      role: "ADMIN",
    });

    // Sensitive route is blocked while a password change is still pending.
    const blockedOverview = await app.request(
      "/api/admin/overview",
      { headers: { Cookie: authedCookie } },
      env as any,
    );
    assert.equal(blockedOverview.status, 403);
    assert.equal((await blockedOverview.json()).error.code, "PASSWORD_CHANGE_REQUIRED");

    // Self password change (wrong current password is rejected first).
    const wrongCurrent = await app.request(
      "/api/admin/settings/password",
      {
        method: "POST",
        headers: {
          Cookie: authedCookie,
          "Content-Type": "application/json",
          Origin: "http://localhost:5173",
        },
        body: JSON.stringify({
          currentPassword: "not-the-right-password",
          newPassword: CHANGED_TEST_PASSWORD,
          newPasswordConfirm: CHANGED_TEST_PASSWORD,
        }),
      },
      env as any,
    );
    assert.equal(wrongCurrent.status, 401);

    // Reusing the temporary bootstrap password as the "new" password is rejected — this is the
    // structural mechanism that blocks keeping a known-weak temporary password, without this
    // codebase ever embedding that literal value.
    const reusedPassword = await app.request(
      "/api/admin/settings/password",
      {
        method: "POST",
        headers: {
          Cookie: authedCookie,
          "Content-Type": "application/json",
          Origin: "http://localhost:5173",
        },
        body: JSON.stringify({
          currentPassword: BOOTSTRAP_TEST_PASSWORD,
          newPassword: BOOTSTRAP_TEST_PASSWORD,
          newPasswordConfirm: BOOTSTRAP_TEST_PASSWORD,
        }),
      },
      env as any,
    );
    assert.equal(reusedPassword.status, 400);

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
          currentPassword: BOOTSTRAP_TEST_PASSWORD,
          newPassword: CHANGED_TEST_PASSWORD,
          newPasswordConfirm: CHANGED_TEST_PASSWORD,
        }),
      },
      env as any,
    );
    assert.equal(changeRes.status, 200);
    assert.deepEqual(await changeRes.json(), { success: true });
    // Password change rotates the admin session cleanly — a fresh cookie is issued so the caller
    // is never logged out by their own password change.
    const rotatedAdminSessionCookie = extractCookie(changeRes, "owogg_admin_session");
    assert.ok(rotatedAdminSessionCookie);
    const rotatedCookie = `${sessionCookie}; owogg_admin_session=${rotatedAdminSessionCookie}`;

    const meFinal = await app.request(
      "/api/admin/me",
      { headers: { Cookie: rotatedCookie } },
      env as any,
    );
    const meFinalBody = (await meFinal.json()) as any;
    assert.equal(meFinalBody.mustChangePassword, false);

    const overviewNow = await app.request(
      "/api/admin/overview",
      { headers: { Cookie: rotatedCookie } },
      env as any,
    );
    assert.equal(overviewNow.status, 200);

    // Duplicate bootstrap: even with a fresh step-up, /bootstrap now rejects because an active
    // administrator account already exists.
    const { stepUpCookie: secondStepUpCookie } = await googleStepUp(env, privateKey, sessionCookie);
    const secondBootstrap = await app.request(
      "/api/admin/bootstrap",
      {
        method: "POST",
        headers: {
          Cookie: `${sessionCookie}; owogg_admin_stepup=${secondStepUpCookie}`,
          "Content-Type": "application/json",
          Origin: "http://localhost:5173",
        },
        body: JSON.stringify({
          username: "e2e-second-bootstrap-fixture-user",
          password: "e2e-second-bootstrap-fixture-pw-000-not-real",
          passwordConfirm: "e2e-second-bootstrap-fixture-pw-000-not-real",
        }),
      },
      env as any,
    );
    assert.equal(secondBootstrap.status, 409);
  } finally {
    jwks.restore();
  }
});
