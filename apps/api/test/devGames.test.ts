import test from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/app.js";
import { hashSessionToken } from "@owogg/db";
import { verifyGamePreview } from "@owogg/core";

// Auth-gating + routing smoke tests for /api/dev/* and /api/admin/game-creators,
// /api/admin/sandbox-games. The underlying business logic (slug validation, review/visibility
// invariants, session revocation-equivalents) already has thorough coverage against real SQLite
// and in-memory fakes — see packages/db/test/D1SandboxGameRepository.test.ts,
// packages/db/test/D1GameCreatorRepository.test.ts, packages/core/test/sandboxGameUseCases.test.ts,
// packages/core/test/gameCreatorUseCases.test.ts. This file only confirms the route layer
// enforces the right auth boundary and doesn't crash when wired end to end.
const OWOGG_SESSION_RAW_TOKEN = "valid_session";
const OWOGG_SESSION_TOKEN_HASH = await hashSessionToken(OWOGG_SESSION_RAW_TOKEN);

function createDb(options: {
  userId: number;
  isDeveloper?: boolean;
  draft?: { gameId: number; versionId: number; ownerUserId: number };
}) {
  const { userId, isDeveloper = false } = options;
  function statement(query: string) {
    let values: unknown[] = [];
    return {
      query,
      bind(...bound: unknown[]) {
        values = bound;
        return this;
      },
      async first<T>() {
        if (query.includes("JOIN users u ON s.user_id = u.id")) {
          return {
            session_id: "valid_session",
            user_id: userId,
            expires_at: new Date(Date.now() + 86400000).toISOString(),
            session_created_at: new Date().toISOString(),
            nickname: "player",
            email: "player@example.com",
            avatar_url: null,
            user_created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as T;
        }
        if (query.includes("FROM game_creator_access WHERE user_id")) {
          if (!isDeveloper) return null;
          return {
            user_id: userId,
            granted_by_admin_id: 1,
            status: "ACTIVE",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as T;
        }
        if (query.includes("FROM game_creator_applications WHERE user_id")) {
          return null; // no application on file in these tests
        }
        if (query.includes("FROM admin_accounts WHERE user_id")) {
          return null; // never a managed admin in these tests
        }
        if (options.draft && query.includes("FROM games g") && query.includes("WHERE g.id = ?")) {
          if (Number(values[0]) !== options.draft.gameId) return null;
          return {
            id: options.draft.gameId,
            slug: "private-draft",
            developer_user_id: options.draft.ownerUserId,
            title: "Private Draft",
            short_description: null,
            description: null,
            genre: "puzzle",
            mode: "single",
            tags_json: "[]",
            default_screen_mode: "default",
            content_last_edited_at: null,
            logo_key: null,
            xp_per_completion: 0,
            score_unit: null,
            score_direction: null,
            score_min: null,
            score_max: null,
            score_display_prefix: null,
            score_display_suffix: null,
            visibility: "PRIVATE",
            live_version_id: null,
            review_slot: null,
            deleted_at: null,
            deleted_by_admin_id: null,
            created_at: "2026-09-02T00:00:00.000Z",
            updated_at: "2026-09-02T00:00:00.000Z",
          } as T;
        }
        if (
          options.draft &&
          query.includes("FROM game_versions gv") &&
          query.includes("WHERE gv.id = ?")
        ) {
          if (Number(values[0]) !== options.draft.versionId) return null;
          return {
            id: options.draft.versionId,
            game_id: options.draft.gameId,
            object_key: "uploads/private-draft.zip",
            content_hash: "a".repeat(64),
            bundle_bytes: 100,
            status: "DRAFT",
            reviewed_by_admin_id: null,
            reviewed_at: null,
            reject_reason: null,
            uploaded_at: "2026-09-02T00:00:00.000Z",
            publish_status: "READY",
            publish_error: null,
            published_at: "2026-09-02T00:01:00.000Z",
            manifest_key: "games/41/73/.owogg-manifest.json",
            published_size_bytes: 200,
            file_count: 2,
          } as T;
        }
        return null;
      },
      async all<T>() {
        if (options.draft && query.includes("gv.moderation_status = 'DRAFT'")) {
          return {
            results: [
              {
                id: options.draft.versionId,
                game_id: options.draft.gameId,
                object_key: "uploads/private-draft.zip",
                content_hash: "a".repeat(64),
                bundle_bytes: 100,
                status: "DRAFT",
                reviewed_by_admin_id: null,
                reviewed_at: null,
                reject_reason: null,
                uploaded_at: "2026-09-02T00:00:00.000Z",
                publish_status: "READY",
                publish_error: null,
                published_at: "2026-09-02T00:01:00.000Z",
                manifest_key: "games/41/73/.owogg-manifest.json",
                published_size_bytes: 200,
                file_count: 2,
              },
            ] as T[],
          };
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

test("GET /api/dev/me returns 401 without a session", async () => {
  const res = await app.request("/api/dev/me", {}, {
    DB: createDb({ userId: 1 }).db,
    ADMIN_USER_IDS: "",
  } as any);
  assert.equal(res.status, 401);
});

test("GET /api/dev/me reports hasAccess=false / isAdmin=false for a plain user", async () => {
  const { db } = createDb({ userId: 7, isDeveloper: false });
  const res = await app.request(
    "/api/dev/me",
    { headers: { Cookie: "owogg_session=valid_session" } },
    { DB: db, ADMIN_USER_IDS: "1" } as any,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { hasAccess: boolean; isAdmin: boolean; canApply: boolean };
  assert.equal(body.hasAccess, false);
  assert.equal(body.isAdmin, false);
  // Self-serve applications are currently closed (operational decision, 2026-08-18) — see
  // canApplyForGameCreator's doc comment. Not an OWO_PLUS gate; just "not accepting applications
  // right now".
  assert.equal(body.canApply, false);
});

test("GET /api/dev/me reports hasAccess=true for an ACTIVE game_creator_access row", async () => {
  const { db } = createDb({ userId: 7, isDeveloper: true });
  const res = await app.request(
    "/api/dev/me",
    { headers: { Cookie: "owogg_session=valid_session" } },
    { DB: db, ADMIN_USER_IDS: "1" } as any,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { hasAccess: boolean };
  assert.equal(body.hasAccess, true);
});

test("removed manual POST /api/dev/games catalog endpoint stays unavailable", async () => {
  const { db } = createDb({ userId: 7, isDeveloper: false });
  const res = await app.request(
    "/api/dev/games",
    {
      method: "POST",
      headers: {
        Cookie: "owogg_session=valid_session",
        "Content-Type": "application/json",
        Origin: "http://localhost:5173",
      },
      body: JSON.stringify({ slug: "my-game", title: "My Game", genre: "puzzle" }),
    },
    { DB: db, ADMIN_USER_IDS: "1", FRONTEND_URL: "http://localhost:5173" } as any,
  );
  assert.equal(res.status, 404);
});

test("POST /api/dev/games/:id/versions returns 503 GAME_BUNDLES_NOT_CONFIGURED when B2 config is absent", async () => {
  const { db } = createDb({ userId: 7, isDeveloper: true });
  const res = await app.request(
    "/api/dev/games/1/versions",
    {
      method: "POST",
      headers: {
        Cookie: "owogg_session=valid_session",
        Origin: "http://localhost:5173",
      },
      body: new FormData(),
    },
    { DB: db, ADMIN_USER_IDS: "1", FRONTEND_URL: "http://localhost:5173" } as any,
  );
  assert.equal(res.status, 503);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "GAME_BUNDLES_NOT_CONFIGURED");
});

test("POST /api/dev/games/:id/versions treats a partial B2 config (one of five values missing) as unconfigured", async () => {
  const { db } = createDb({ userId: 7, isDeveloper: true });
  const res = await app.request(
    "/api/dev/games/1/versions",
    {
      method: "POST",
      headers: {
        Cookie: "owogg_session=valid_session",
        Origin: "http://localhost:5173",
      },
      body: new FormData(),
    },
    {
      DB: db,
      ADMIN_USER_IDS: "1",
      FRONTEND_URL: "http://localhost:5173",
      B2_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
      B2_REGION: "us-west-004",
      B2_BUCKET_NAME: "owogg-game-bundles",
      B2_KEY_ID: "someKeyId",
      // B2_APPLICATION_KEY intentionally omitted
    } as any,
  );
  assert.equal(res.status, 503);
});

test("POST /api/dev/games/:id/versions with a complete B2 config gets past the 503 gate (fails later, on the missing file field, not on config)", async () => {
  const { db } = createDb({ userId: 7, isDeveloper: true });
  const res = await app.request(
    "/api/dev/games/1/versions",
    {
      method: "POST",
      headers: {
        Cookie: "owogg_session=valid_session",
        Origin: "http://localhost:5173",
      },
      body: new FormData(), // no "bundle" field
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
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "INVALID_REQUEST");
});

test("draft list and preview issuance return the authenticated creator's exact READY version", async () => {
  const draft = { gameId: 41, versionId: 73, ownerUserId: 7 };
  const { db } = createDb({ userId: 7, isDeveloper: true, draft });
  const env = {
    DB: db,
    ADMIN_USER_IDS: "1",
    FRONTEND_URL: "http://localhost:5173",
    GAME_SESSION_SECRET: "preview-api-test-secret",
    B2_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
    B2_REGION: "us-west-004",
    B2_BUCKET_NAME: "owogg-game-bundles",
    B2_KEY_ID: "someKeyId",
    B2_APPLICATION_KEY: "someApplicationKey",
  } as any;

  const draftsResponse = await app.request(
    "/api/dev/games/drafts",
    { headers: { Cookie: "owogg_session=valid_session" } },
    env,
  );
  assert.equal(draftsResponse.status, 200);
  const draftsBody = (await draftsResponse.json()) as { drafts: Array<{ id: number }> };
  assert.deepEqual(
    draftsBody.drafts.map((version) => version.id),
    [73],
  );

  const response = await app.request(
    "/api/dev/games/41/versions/73/preview",
    {
      method: "POST",
      headers: { Cookie: "owogg_session=valid_session", Origin: "http://localhost:5173" },
    },
    env,
  );
  assert.equal(response.status, 201);
  const body = (await response.json()) as {
    gameId: number;
    versionId: number;
    previewToken: string;
    previewPath: string;
  };
  assert.equal(body.gameId, 41);
  assert.equal(body.versionId, 73);
  assert.equal(body.previewPath, `/preview/${body.previewToken}/index.html`);
  const verified = await verifyGamePreview(body.previewToken, "preview-api-test-secret");
  assert.equal(verified.ok, true);
  if (verified.ok) {
    assert.equal(verified.payload.userId, 7);
    assert.equal(verified.payload.gameId, 41);
    assert.equal(verified.payload.versionId, 73);
  }
});

test("review submission requires a matching unexpired preview capability", async () => {
  const draft = { gameId: 41, versionId: 73, ownerUserId: 7 };
  const { db } = createDb({ userId: 7, isDeveloper: true, draft });
  const env = {
    DB: db,
    ADMIN_USER_IDS: "1",
    FRONTEND_URL: "http://localhost:5173",
    GAME_SESSION_SECRET: "preview-api-test-secret",
  } as any;
  const response = await app.request(
    "/api/dev/games/41/versions/73/submit",
    {
      method: "POST",
      headers: {
        Cookie: "owogg_session=valid_session",
        Origin: "http://localhost:5173",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    },
    env,
  );
  assert.equal(response.status, 409);
  const body = (await response.json()) as { error: { code: string } };
  assert.equal(body.error.code, "PREVIEW_REQUIRED");
});

test("GET /api/admin/game-creators is denied for non-admin", async () => {
  const { db } = createDb({ userId: 7 });
  const res = await app.request(
    "/api/admin/game-creators",
    { headers: { Cookie: "owogg_session=valid_session; owogg_admin_session=none" } },
    { DB: db, ADMIN_USER_IDS: "1" } as any,
  );
  assert.equal(res.status, 403);
});

test("DELETE /api/admin/sandbox-games/:id is denied for non-admin", async () => {
  const { db } = createDb({ userId: 7 });
  const res = await app.request(
    "/api/admin/sandbox-games/1",
    {
      method: "DELETE",
      headers: { Cookie: "owogg_session=valid_session; owogg_admin_session=none" },
    },
    { DB: db, ADMIN_USER_IDS: "1" } as any,
  );
  assert.equal(res.status, 403);
});

test("DELETE /api/admin/sandbox-games/:id/purge is denied for non-admin", async () => {
  const { db } = createDb({ userId: 7 });
  const res = await app.request(
    "/api/admin/sandbox-games/1/purge",
    {
      method: "DELETE",
      headers: { Cookie: "owogg_session=valid_session; owogg_admin_session=none" },
    },
    { DB: db, ADMIN_USER_IDS: "1" } as any,
  );
  assert.equal(res.status, 403);
});

test("POST /api/dev/games/upload is rejected for a non-developer with FORBIDDEN, not a crash", async () => {
  const { db } = createDb({ userId: 7, isDeveloper: false });
  const res = await app.request(
    "/api/dev/games/upload",
    {
      method: "POST",
      headers: { Cookie: "owogg_session=valid_session", Origin: "http://localhost:5173" },
      body: new FormData(),
    },
    { DB: db, ADMIN_USER_IDS: "1", FRONTEND_URL: "http://localhost:5173" } as any,
  );
  assert.equal(res.status, 403);
});

test("POST /api/external-games lets a plain signed-in player pass the role gate", async () => {
  const { db } = createDb({ userId: 7, isDeveloper: false });
  const res = await app.request(
    "/api/external-games",
    {
      method: "POST",
      headers: {
        Cookie: "owogg_session=valid_session",
        Origin: "http://localhost:5173",
        "Content-Type": "application/json",
      },
      // Deliberately invalid content: reaching payload validation (400) proves the authenticated
      // plain player was not rejected by the independent Game Creator upload entitlement (403).
      body: JSON.stringify({}),
    },
    { DB: db, ADMIN_USER_IDS: "1", FRONTEND_URL: "http://localhost:5173" } as any,
  );
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "INVALID_REQUEST");
});

test("POST /api/dev/games/upload returns 503 GAME_BUNDLES_NOT_CONFIGURED when B2 config is absent", async () => {
  const { db } = createDb({ userId: 7, isDeveloper: true });
  const res = await app.request(
    "/api/dev/games/upload",
    {
      method: "POST",
      headers: { Cookie: "owogg_session=valid_session", Origin: "http://localhost:5173" },
      body: new FormData(),
    },
    { DB: db, ADMIN_USER_IDS: "1", FRONTEND_URL: "http://localhost:5173" } as any,
  );
  assert.equal(res.status, 503);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "GAME_BUNDLES_NOT_CONFIGURED");
});

test("POST /api/dev/games/upload with a complete B2 config gets past the 503 gate (fails later, on the missing bundle field, not on config)", async () => {
  const { db } = createDb({ userId: 7, isDeveloper: true });
  const res = await app.request(
    "/api/dev/games/upload",
    {
      method: "POST",
      headers: { Cookie: "owogg_session=valid_session", Origin: "http://localhost:5173" },
      body: new FormData(), // no "bundle" field
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
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "INVALID_REQUEST");
});

test("GET /api/admin/sandbox-games/review-queue is denied for non-admin", async () => {
  const { db } = createDb({ userId: 7 });
  const res = await app.request(
    "/api/admin/sandbox-games/review-queue",
    { headers: { Cookie: "owogg_session=valid_session; owogg_admin_session=none" } },
    { DB: db, ADMIN_USER_IDS: "1" } as any,
  );
  assert.equal(res.status, 403);
});

test("GET /api/admin/sandbox-games is denied for non-admin", async () => {
  const { db } = createDb({ userId: 7 });
  const res = await app.request(
    "/api/admin/sandbox-games",
    { headers: { Cookie: "owogg_session=valid_session; owogg_admin_session=none" } },
    { DB: db, ADMIN_USER_IDS: "1" } as any,
  );
  assert.equal(res.status, 403);
});

test("POST /api/admin/sandbox-games/versions/:versionId/revoke is denied for non-admin", async () => {
  const { db } = createDb({ userId: 7 });
  const res = await app.request(
    "/api/admin/sandbox-games/versions/1/revoke",
    {
      method: "POST",
      headers: { Cookie: "owogg_session=valid_session; owogg_admin_session=none" },
    },
    { DB: db, ADMIN_USER_IDS: "1" } as any,
  );
  assert.equal(res.status, 403);
});

// ── review-slot quota over the real route/use-case/repository chain ──────────
//
// Separate fake DB from createDb() above: these tests need sandbox_games rows to actually behave
// like they do against real SQLite (INSERT ... SELECT for slot claiming, read-back by slug), which
// createDb()'s generic `changes: 0` stub can't express.

function createDevGamesDb(options: { existingGames?: Array<{ slug: string; reviewSlot: 1 | 2 }> }) {
  const games = new Map(
    (options.existingGames ?? []).map((g, i) => [
      g.slug,
      {
        id: i + 1,
        slug: g.slug,
        developer_user_id: 7,
        title: g.slug,
        short_description: null,
        description: null,
        genre: "puzzle",
        xp_per_completion: 0,
        score_unit: null,
        score_direction: null,
        score_min: null,
        score_max: null,
        score_display_prefix: null,
        score_display_suffix: null,
        visibility: "PRIVATE",
        live_version_id: null,
        review_slot: g.reviewSlot,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]),
  );
  let nextId = games.size + 1;

  function statement(query: string) {
    let values: unknown[] = [];
    return {
      bind(...bound: unknown[]) {
        values = bound;
        return this;
      },
      async first<T>() {
        if (query.includes("JOIN users u ON s.user_id = u.id")) {
          return {
            session_id: "valid_session",
            user_id: 7,
            expires_at: new Date(Date.now() + 86400000).toISOString(),
            session_created_at: new Date().toISOString(),
            nickname: "dev",
            email: "dev@example.com",
            avatar_url: null,
            user_created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as T;
        }
        if (query.includes("FROM game_creator_access WHERE user_id")) {
          return {
            user_id: 7,
            granted_by_admin_id: 1,
            status: "ACTIVE",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as T;
        }
        if (query.includes("FROM admin_accounts WHERE user_id")) return null;
        if (
          query.includes("FROM sandbox_games WHERE slug") ||
          query.includes("FROM games WHERE slug") ||
          (query.includes("FROM games g") && query.includes("g.slug = ?"))
        ) {
          return (games.get(String(values[0])) ?? null) as T;
        }
        if (
          query.includes("FROM sandbox_games WHERE id") ||
          query.includes("FROM games WHERE id") ||
          (query.includes("FROM games g") && query.includes("g.id = ?"))
        ) {
          const match = [...games.values()].find((g) => g.id === Number(values[0]));
          return (match ?? null) as T;
        }
        return null;
      },
      async all<T>() {
        return { results: [] } as { results: T[] };
      },
      async run() {
        if (query.includes("INSERT INTO games")) {
          const taken = new Set([...games.values()].map((g) => g.review_slot).filter(Boolean));
          const slot = !taken.has(1) ? 1 : !taken.has(2) ? 2 : null;
          if (slot === null) return { success: true, meta: { changes: 0 } };
          return { success: true, meta: { changes: 1 } };
        }
        if (query.includes("INSERT INTO sandbox_games")) {
          // Mirrors the real slot-claiming logic closely enough for a route-level smoke test: the
          // full atomicity guarantee is proven against real SQLite in
          // packages/db/test/D1SandboxGameRepository.test.ts.
          const taken = new Set([...games.values()].map((g) => g.review_slot).filter(Boolean));
          const slot = !taken.has(1) ? 1 : !taken.has(2) ? 2 : null;
          if (slot === null) return { success: true, meta: { changes: 0 } };

          const [slug, , title, shortDescription, description, genre] = values as [
            string,
            number,
            string,
            string | null,
            string | null,
            string,
          ];
          games.set(slug, {
            id: nextId++,
            slug,
            developer_user_id: 7,
            title,
            short_description: shortDescription,
            description,
            genre,
            xp_per_completion: 0,
            score_unit: null,
            score_direction: null,
            score_min: null,
            score_max: null,
            score_display_prefix: null,
            score_display_suffix: null,
            visibility: "PRIVATE",
            live_version_id: null,
            review_slot: slot,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
          return { success: true, meta: { changes: 1 } };
        }
        if (query.includes("UPDATE sandbox_games SET review_slot = NULL")) {
          const game = [...games.values()].find((g) => g.id === Number(values[1]));
          if (game) game.review_slot = null;
          return { success: true, meta: { changes: game ? 1 : 0 } };
        }
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
        return Promise.all(statements.map((s) => s.run()));
      },
    },
  };
}

test("POST /api/dev/games/:id/withdraw releases the held review slot", async () => {
  const { db } = createDevGamesDb({
    existingGames: [
      { slug: "existing-1", reviewSlot: 1 },
      { slug: "existing-2", reviewSlot: 2 },
    ],
  });
  const withdraw = await app.request(
    "/api/dev/games/1/withdraw",
    {
      method: "POST",
      headers: { Cookie: "owogg_session=valid_session", Origin: "http://localhost:5173" },
    },
    { DB: db, ADMIN_USER_IDS: "1", FRONTEND_URL: "http://localhost:5173" } as any,
  );
  assert.equal(withdraw.status, 200);
  const withdrawnBody = (await withdraw.json()) as { reviewSlot: number | null };
  assert.equal(withdrawnBody.reviewSlot, null);
});

test("DELETE /api/dev/games/:id returns 401 without a session", async () => {
  const { db } = createDevGamesDb({});
  const res = await app.request(
    "/api/dev/games/1",
    { method: "DELETE", headers: { Origin: "http://localhost:5173" } },
    { DB: db, ADMIN_USER_IDS: "1", FRONTEND_URL: "http://localhost:5173" } as any,
  );
  assert.equal(res.status, 401);
});

test("DELETE /api/dev/games/:id lets a creator delete their own never-approved game", async () => {
  const { db } = createDevGamesDb({
    existingGames: [{ slug: "orphaned-game", reviewSlot: 1 }],
  });
  const res = await app.request(
    "/api/dev/games/1",
    {
      method: "DELETE",
      headers: { Cookie: "owogg_session=valid_session", Origin: "http://localhost:5173" },
    },
    { DB: db, ADMIN_USER_IDS: "1", FRONTEND_URL: "http://localhost:5173" } as any,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { deleted: boolean };
  assert.equal(body.deleted, true);
});
