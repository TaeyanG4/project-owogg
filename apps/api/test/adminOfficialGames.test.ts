import assert from "node:assert/strict";
import test from "node:test";
import { hashSessionToken } from "@owogg/db";
import { app } from "../src/app.js";

const OWOGG_SESSION_RAW_TOKEN = "valid_session";
const ADMIN_SESSION_RAW_TOKEN = "admin_session_valid_token";
const OWOGG_SESSION_TOKEN_HASH = await hashSessionToken(OWOGG_SESSION_RAW_TOKEN);
const ADMIN_SESSION_TOKEN_HASH = await hashSessionToken(ADMIN_SESSION_RAW_TOKEN);
const ADMIN_COOKIE = "owogg_session=valid_session; owogg_admin_session=admin_session_valid_token";

function createAdminDb(options: {
  userId: number;
  managedRole?: string;
  grants?: string[];
  officialGame?: boolean;
  multiplayerHistory?: boolean;
}) {
  const queriedGames: string[] = [];
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
          if (values[0] !== ADMIN_SESSION_TOKEN_HASH) return null;
          return {
            id: 1,
            token_hash: ADMIN_SESSION_TOKEN_HASH,
            user_id: options.userId,
            session_token_hash: OWOGG_SESSION_TOKEN_HASH,
            created_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
            revoked_at: null,
          } as T;
        }
        if (query.includes("JOIN users u ON s.user_id = u.id")) {
          return {
            session_id: "valid_session",
            user_id: options.userId,
            expires_at: new Date(Date.now() + 86_400_000).toISOString(),
            session_created_at: new Date().toISOString(),
            nickname: "admin",
            email: "admin@example.com",
            avatar_url: null,
            user_created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as T;
        }
        if (query.includes("FROM admin_accounts WHERE user_id")) {
          if (!options.managedRole) return null;
          return {
            id: 1,
            user_id: options.userId,
            google_sub: "mock-google-sub",
            username: "mock-admin",
            password_hash: "mock-hash",
            role: options.managedRole,
            status: "ACTIVE",
            must_change_password: 0,
            created_by_admin_id: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            password_changed_at: new Date().toISOString(),
          } as T;
        }
        if (query.includes("FROM multiplayer_profiles WHERE game_id = games.id")) {
          return {
            retains_history: options.multiplayerHistory ? 1 : 0,
          } as T;
        }
        if (query.includes("FROM games")) queriedGames.push(query);
        return null;
      },
      async all<T>() {
        if (query.includes("FROM admin_permission_grants WHERE account_id")) {
          return {
            results: (options.grants ?? []).map((permission) => ({ permission })),
          } as { results: T[] };
        }
        return { results: [] } as { results: T[] };
      },
      async run() {
        const changes = options.officialGame && query.includes("UPDATE game_versions") ? 1 : 0;
        return { success: true, meta: { changes } };
      },
    };
  }

  return {
    queriedGames,
    db: {
      prepare(query: string) {
        return statement(query);
      },
      async batch(statements: Array<ReturnType<typeof statement>>) {
        queriedGames.push(...statements.map((statement) => statement.query));
        if (options.officialGame && statements[0]?.query.includes("deleted_at = COALESCE")) {
          return [
            { success: true, meta: { changes: 1 } },
            {
              success: true,
              results: [{ id: 7, slug: "official-game" }],
              meta: { changes: 0 },
            },
            {
              success: true,
              results: [
                {
                  id: 11,
                  game_id: 7,
                  object_key: `uploads/7/${"a".repeat(64)}.zip`,
                  content_hash: "a".repeat(64),
                  bundle_bytes: 3,
                  publish_status: "UPLOADED",
                  publish_error: null,
                  published_at: null,
                  manifest_key: null,
                  published_size_bytes: null,
                  file_count: null,
                  uploaded_at: "2026-08-24T00:00:00.000Z",
                },
              ],
              meta: { changes: 0 },
            },
            {
              success: true,
              results: [{ object_key: "games/7/logo.svg" }],
              meta: { changes: 0 },
            },
          ];
        }
        if (
          options.officialGame &&
          statements[0]?.query.includes("official_game_deletion_audit_log")
        ) {
          return statements.map((statement, index) => ({
            success: true,
            meta: {
              changes: index === 0 || statement.query.includes("DELETE FROM games") ? 1 : 0,
            },
          }));
        }
        return statements.map(() => ({ success: true, meta: { changes: 0 } }));
      },
    },
  };
}

test("DELETE /api/admin/games/:slug requires an elevated admin session", async () => {
  const { db } = createAdminDb({ userId: 1 });
  const response = await app.request(
    "/api/admin/games/official-game",
    {
      method: "DELETE",
      headers: { Origin: "http://localhost:5173" },
    },
    { DB: db, ADMIN_USER_IDS: "1", FRONTEND_URL: "http://localhost:5173" } as any,
  );
  assert.equal(response.status, 401);
});

test("official hard delete requires both games.moderate and sandbox_games.delete", async () => {
  const { db, queriedGames } = createAdminDb({
    userId: 7,
    managedRole: "MODERATOR",
    grants: ["games.moderate"],
  });
  const response = await app.request(
    "/api/admin/games/official-game",
    {
      method: "DELETE",
      headers: { Cookie: ADMIN_COOKIE, Origin: "http://localhost:5173" },
    },
    { DB: db, ADMIN_USER_IDS: "1", FRONTEND_URL: "http://localhost:5173" } as any,
  );

  assert.equal(response.status, 403);
  const body = (await response.json()) as { error: { permission?: string } };
  assert.equal(body.error.permission, "sandbox_games.delete");
  assert.equal(queriedGames.length, 0);
});

test("official hard delete fails closed before D1 when B2 is not configured", async () => {
  const { db, queriedGames } = createAdminDb({ userId: 1 });
  const response = await app.request(
    "/api/admin/games/official-game",
    {
      method: "DELETE",
      headers: { Cookie: ADMIN_COOKIE, Origin: "http://localhost:5173" },
    },
    { DB: db, ADMIN_USER_IDS: "1", FRONTEND_URL: "http://localhost:5173" } as any,
  );

  assert.equal(response.status, 503);
  const body = (await response.json()) as { error: { code: string } };
  assert.equal(body.error.code, "GAME_BUNDLES_NOT_CONFIGURED");
  assert.equal(queriedGames.length, 0);
});

test("official hard delete removes B2 objects and completes the D1 purge", async () => {
  const { db, queriedGames } = createAdminDb({ userId: 1, officialGame: true });
  const originalFetch = globalThis.fetch;
  const storageRequests: Array<{ method: string; url: string }> = [];
  globalThis.fetch = async (input, init) => {
    storageRequests.push({
      method: init?.method ?? (input instanceof Request ? input.method : "GET"),
      url: input instanceof Request ? input.url : String(input),
    });
    return new Response(null, { status: 204 });
  };

  try {
    const response = await app.request(
      "/api/admin/games/official-game",
      {
        method: "DELETE",
        headers: { Cookie: ADMIN_COOKIE, Origin: "http://localhost:5173" },
      },
      {
        DB: db,
        ADMIN_USER_IDS: "1",
        FRONTEND_URL: "http://localhost:5173",
        B2_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
        B2_REGION: "us-west-004",
        B2_BUCKET_NAME: "owogg-game-bundles",
        B2_KEY_ID: "someKeyId",
        B2_APPLICATION_KEY: "someApplicationKey",
      } as any,
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Clear-Site-Data"), '"cache"');
    const body = (await response.json()) as {
      slug: string;
      deletedVersionCount: number;
      deletedObjectCount: number;
      identityRetainedForHistory: boolean;
    };
    assert.equal(body.slug, "official-game");
    assert.equal(body.deletedVersionCount, 1);
    assert.equal(body.deletedObjectCount, 3);
    assert.equal(body.identityRetainedForHistory, false);
    assert.equal(storageRequests.length, 3);
    assert.ok(storageRequests.every((request) => request.method === "DELETE"));
    assert.ok(queriedGames.some((query) => query.includes("DELETE FROM games")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("official delete preserves a tombstone when multiplayer history is immutable", async () => {
  const { db, queriedGames } = createAdminDb({
    userId: 1,
    officialGame: true,
    multiplayerHistory: true,
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 204 });

  try {
    const response = await app.request(
      "/api/admin/games/official-game",
      {
        method: "DELETE",
        headers: { Cookie: ADMIN_COOKIE, Origin: "http://localhost:5173" },
      },
      {
        DB: db,
        ADMIN_USER_IDS: "1",
        FRONTEND_URL: "http://localhost:5173",
        B2_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
        B2_REGION: "us-west-004",
        B2_BUCKET_NAME: "owogg-game-bundles",
        B2_KEY_ID: "someKeyId",
        B2_APPLICATION_KEY: "someApplicationKey",
      } as any,
    );

    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      identityRetainedForHistory: boolean;
    };
    assert.equal(body.identityRetainedForHistory, true);
    assert.ok(queriedGames.some((query) => query.includes("DELETE FROM game_assets")));
    assert.equal(
      queriedGames.some((query) => query.includes("DELETE FROM games")),
      false,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
