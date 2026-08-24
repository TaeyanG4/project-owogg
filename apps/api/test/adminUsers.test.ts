import test from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/index.js";
import { hashSessionToken } from "@owogg/db";

// Auth-gating + routing/schema-wiring smoke tests for /api/admin/users. The underlying business
// logic (suspend/ban validation, session revocation, soft-delete reset/restore, per-user audit
// scoping) already has thorough coverage against real SQLite and in-memory fakes — see
// packages/db/test/D1UserModerationRepository.test.ts and
// packages/core/test/userModerationUseCases.test.ts. This file only confirms the route layer
// enforces the same elevated-admin gate as every other /api/admin/* endpoint and doesn't crash
// when wired end to end.
const OWOGG_SESSION_RAW_TOKEN = "valid_session";
const ADMIN_SESSION_RAW_TOKEN = "admin_session_valid_token";
const OWOGG_SESSION_TOKEN_HASH = await hashSessionToken(OWOGG_SESSION_RAW_TOKEN);
const ADMIN_SESSION_TOKEN_HASH = await hashSessionToken(ADMIN_SESSION_RAW_TOKEN);

const SEEDED_ROLE_PERMISSIONS: Record<string, string[]> = {
  OPERATOR: ["admin.center.access", "users.view", "users.suspend", "users.ban"],
  MODERATOR: ["admin.center.access", "users.view", "users.suspend"],
  SYSTEM_DEVELOPER: ["admin.center.access", "system.dev.access", "system.monitor"],
};

// `managedAccount` is optional and, when present, makes the session's user resolve via a real
// admin_accounts row (role + individual grants) instead of ADMIN_USER_IDS root eligibility —
// used by the OPERATOR/MODERATOR permission-gating tests below. Every admin_accounts /
// admin_permission_grants lookup returns the SAME row regardless of which user_id was bound, so
// this mock is only safe for tests where the acting session's own user_id is what's under test —
// it must not be used for scenarios needing a *different* managed role for the target user.
function createAdminDb(userId: number, managedAccount?: { role: string; grants?: string[] }) {
  function statement(query: string) {
    let values: unknown[] = [];
    return {
      query,
      bind(...bound: unknown[]) {
        values = bound;
        return this;
      },
      async first<T>() {
        if (query.includes("FROM admin_sessions WHERE token_hash")) {
          const [queriedTokenHash] = values as [string];
          if (queriedTokenHash !== ADMIN_SESSION_TOKEN_HASH) return null;
          return {
            id: 1,
            token_hash: ADMIN_SESSION_TOKEN_HASH,
            user_id: userId,
            session_token_hash: OWOGG_SESSION_TOKEN_HASH,
            created_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
            revoked_at: null,
          } as T;
        }
        if (query.includes("JOIN users u ON s.user_id = u.id")) {
          return {
            session_id: "valid_session",
            user_id: userId,
            expires_at: new Date(Date.now() + 86400000).toISOString(),
            session_created_at: new Date().toISOString(),
            nickname: "admin",
            email: "admin@example.com",
            avatar_url: null,
            user_created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as T;
        }
        if (query.includes("FROM admin_accounts WHERE user_id")) {
          if (!managedAccount) return null;
          return {
            id: 1,
            user_id: userId,
            google_sub: "mock-google-sub",
            username: "mock-admin",
            password_hash: "mock-hash",
            role: managedAccount.role,
            status: "ACTIVE",
            must_change_password: 0,
            created_by_admin_id: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            password_changed_at: new Date().toISOString(),
          } as T;
        }
        return null;
      },
      async all<T>() {
        if (query.includes("FROM admin_role_permissions WHERE role")) {
          return {
            results: (managedAccount
              ? (SEEDED_ROLE_PERMISSIONS[managedAccount.role] ?? [])
              : []
            ).map((permission) => ({ permission })),
          } as { results: T[] };
        }
        if (query.includes("FROM admin_permission_grants WHERE account_id")) {
          return {
            results: (managedAccount?.grants ?? []).map((permission) => ({ permission })),
          } as { results: T[] };
        }
        return { results: [] } as { results: T[] };
      },
      async run() {
        return { success: true, meta: { changes: 0 } };
      },
    };
  }

  return {
    db: {
      prepare(query: string) {
        return statement(query);
      },
      async batch(statements: Array<ReturnType<typeof statement>>) {
        return statements.map(() => ({ success: true, meta: { changes: 0 } }));
      },
    },
  };
}

test("GET /api/admin/users is denied for non-admin", async () => {
  const mock = createAdminDb(7);
  const res = await app.request(
    "/api/admin/users?query=test",
    {
      headers: {
        Cookie: "owogg_session=valid_session; owogg_admin_session=admin_session_valid_token",
      },
    },
    { DB: mock.db, ADMIN_USER_IDS: "1" } as any,
  );
  assert.equal(res.status, 403);
});

test("GET /api/admin/users?query= returns an empty result set for an admin, not a crash", async () => {
  const mock = createAdminDb(1);
  const res = await app.request(
    "/api/admin/users?query=nobody",
    {
      headers: {
        Cookie: "owogg_session=valid_session; owogg_admin_session=admin_session_valid_token",
      },
    },
    { DB: mock.db, ADMIN_USER_IDS: "1" } as any,
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  const body = (await res.json()) as { users: unknown[] };
  assert.deepEqual(body.users, []);
});

test("GET /api/admin/users with nothing typed lists the (mocked-empty) full user page with pagination meta", async () => {
  const mock = createAdminDb(1);
  const res = await app.request(
    "/api/admin/users",
    {
      headers: {
        Cookie: "owogg_session=valid_session; owogg_admin_session=admin_session_valid_token",
      },
    },
    { DB: mock.db, ADMIN_USER_IDS: "1" } as any,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    users: unknown[];
    total: number;
    page: number;
    pageSize: number;
  };
  assert.deepEqual(body.users, []);
  assert.equal(body.total, 0);
  assert.equal(body.page, 1);
  assert.equal(body.pageSize, 20);
});

test("GET /api/admin/users/:userId returns USER_NOT_FOUND for an id the mock DB has no row for", async () => {
  const mock = createAdminDb(1);
  const res = await app.request(
    "/api/admin/users/12345",
    {
      headers: {
        Cookie: "owogg_session=valid_session; owogg_admin_session=admin_session_valid_token",
      },
    },
    { DB: mock.db, ADMIN_USER_IDS: "1" } as any,
  );
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "USER_NOT_FOUND");
});

test("POST /api/admin/users/:userId/suspend is denied for non-admin", async () => {
  const mock = createAdminDb(7);
  const res = await app.request(
    "/api/admin/users/1/suspend",
    {
      method: "POST",
      headers: {
        Cookie: "owogg_session=valid_session; owogg_admin_session=admin_session_valid_token",
        "Content-Type": "application/json",
        Origin: "http://localhost:5173",
      },
      body: JSON.stringify({
        suspendedUntil: new Date(Date.now() + 86400000).toISOString(),
        reason: "test",
      }),
    },
    { DB: mock.db, ADMIN_USER_IDS: "1", FRONTEND_URL: "http://localhost:5173" } as any,
  );
  assert.equal(res.status, 403);
});

// Every POST test below needs a matching FRONTEND_URL — the trusted-Origin check in
// isTrustedAdminOrigin only recognizes localhost as a dev exception when FRONTEND_URL is itself
// set to a localhost value (its default is the production owogg.com origin).
const LOCALHOST_ENV = { FRONTEND_URL: "http://localhost:5173" };

test("POST /api/admin/users/:userId/suspend rejects an unknown user with USER_NOT_FOUND", async () => {
  const mock = createAdminDb(1);
  const res = await app.request(
    "/api/admin/users/99999/suspend",
    {
      method: "POST",
      headers: {
        Cookie: "owogg_session=valid_session; owogg_admin_session=admin_session_valid_token",
        "Content-Type": "application/json",
        Origin: "http://localhost:5173",
      },
      body: JSON.stringify({
        suspendedUntil: new Date(Date.now() + 86400000).toISOString(),
        reason: "test",
      }),
    },
    { DB: mock.db, ADMIN_USER_IDS: "1", ...LOCALHOST_ENV } as any,
  );
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "USER_NOT_FOUND");
});

test("POST /api/admin/users/:userId/suspend on a protected (ADMIN_USER_IDS) admin account is rejected with ADMIN_PROTECTED", async () => {
  const mock = createAdminDb(1);
  const res = await app.request(
    "/api/admin/users/1/suspend",
    {
      method: "POST",
      headers: {
        Cookie: "owogg_session=valid_session; owogg_admin_session=admin_session_valid_token",
        "Content-Type": "application/json",
        Origin: "http://localhost:5173",
      },
      body: JSON.stringify({
        suspendedUntil: new Date(Date.now() + 86400000).toISOString(),
        reason: "test",
      }),
    },
    { DB: mock.db, ADMIN_USER_IDS: "1", ...LOCALHOST_ENV } as any,
  );
  assert.equal(res.status, 403);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "ADMIN_PROTECTED");
});

test("POST /api/admin/users/:userId/ban without a reason is rejected before touching the DB", async () => {
  const mock = createAdminDb(1);
  const res = await app.request(
    "/api/admin/users/1/ban",
    {
      method: "POST",
      headers: {
        Cookie: "owogg_session=valid_session; owogg_admin_session=admin_session_valid_token",
        "Content-Type": "application/json",
        Origin: "http://localhost:5173",
      },
      body: JSON.stringify({ reason: "" }),
    },
    { DB: mock.db, ADMIN_USER_IDS: "1", ...LOCALHOST_ENV } as any,
  );
  assert.equal(res.status, 400);
});

// The OPERATOR/MODERATOR distinction that matters most here: users.ban is in the seeded
// OPERATOR D1 role policy but deliberately not in MODERATOR's. Neither test
// needs ADMIN_USER_IDS at all — eligibility comes purely from the mocked managed account being
// ACTIVE (see resolveAdminEligibility), same as a real OPERATOR/MODERATOR created via
// POST /api/admin/accounts and never listed in the ADMIN_USER_IDS root/break-glass env var.

test("POST /api/admin/users/:userId/ban reaches body validation for a managed OPERATOR with users.ban in its role policy", async () => {
  const mock = createAdminDb(1, { role: "OPERATOR" });
  const res = await app.request(
    "/api/admin/users/1/ban",
    {
      method: "POST",
      headers: {
        Cookie: "owogg_session=valid_session; owogg_admin_session=admin_session_valid_token",
        "Content-Type": "application/json",
        Origin: "http://localhost:5173",
      },
      body: JSON.stringify({ reason: "" }), // empty reason — proves it got PAST the permission gate
    },
    { DB: mock.db, ...LOCALHOST_ENV } as any,
  );
  // 400 (validation), not 403 — the permission check let it through.
  assert.equal(res.status, 400);
});

test("POST /api/admin/users/:userId/ban is denied (403) for a managed MODERATOR without users.ban in its role policy", async () => {
  const mock = createAdminDb(1, { role: "MODERATOR" });
  const res = await app.request(
    "/api/admin/users/1/ban",
    {
      method: "POST",
      headers: {
        Cookie: "owogg_session=valid_session; owogg_admin_session=admin_session_valid_token",
        "Content-Type": "application/json",
        Origin: "http://localhost:5173",
      },
      body: JSON.stringify({ reason: "test" }), // a valid body — proves the block is the permission gate, not validation
    },
    { DB: mock.db, ...LOCALHOST_ENV } as any,
  );
  assert.equal(res.status, 403);
});

test("POST /api/admin/users/:userId/suspend reaches body validation for a managed MODERATOR with users.suspend in its role policy", async () => {
  const mock = createAdminDb(1, { role: "MODERATOR" });
  const res = await app.request(
    "/api/admin/users/1/suspend",
    {
      method: "POST",
      headers: {
        Cookie: "owogg_session=valid_session; owogg_admin_session=admin_session_valid_token",
        "Content-Type": "application/json",
        Origin: "http://localhost:5173",
      },
      body: JSON.stringify({}), // missing required fields — proves it got PAST the permission gate
    },
    { DB: mock.db, ...LOCALHOST_ENV } as any,
  );
  assert.equal(res.status, 400);
});

test("GET /api/admin/users is reachable for a managed SYSTEM_DEVELOPER individually granted users.view", async () => {
  const mock = createAdminDb(1, { role: "SYSTEM_DEVELOPER", grants: ["users.view"] });
  const res = await app.request(
    "/api/admin/users?query=nobody",
    {
      headers: {
        Cookie: "owogg_session=valid_session; owogg_admin_session=admin_session_valid_token",
      },
    },
    { DB: mock.db, ...LOCALHOST_ENV } as any,
  );
  assert.equal(res.status, 200);
});

test("GET /api/admin/users is denied (403) for a managed SYSTEM_DEVELOPER with no individual users.view grant", async () => {
  const mock = createAdminDb(1, { role: "SYSTEM_DEVELOPER" });
  const res = await app.request(
    "/api/admin/users?query=nobody",
    {
      headers: {
        Cookie: "owogg_session=valid_session; owogg_admin_session=admin_session_valid_token",
      },
    },
    { DB: mock.db, ...LOCALHOST_ENV } as any,
  );
  assert.equal(res.status, 403);
});
