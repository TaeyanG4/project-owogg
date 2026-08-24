import test from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/index.js";
import { verifyGameSession, gameSessionMatches } from "@owogg/core";

// POST /api/games/:slug/session — the route-layer half of the Game Session prerequisite (the
// signing/verification logic itself is unit-tested directly against real Web Crypto in
// packages/core/test/gameSession.test.ts; this file only confirms auth gating, the PUBLIC + live
// Game Creator game gate, and that the token this route actually issues round-trips through the real
// verifyGameSession with the right claims — the same "real Hono app, fake D1" pattern
// gameServing.test.ts and devGames.test.ts use.

interface FakeGame {
  id: number;
  slug: string;
  visibility: "PRIVATE" | "PUBLIC";
  live_version_id: number | null;
  publisher?: "OWOGG" | "USER";
}
interface FakeVersion {
  id: number;
  game_id: number;
}

function createDb(options: { userId?: number; game?: FakeGame; version?: FakeVersion }) {
  const { userId = 7, game, version } = options;
  function statement(query: string) {
    let values: unknown[] = [];
    return {
      bind(...bound: unknown[]) {
        values = bound;
        return this;
      },
      async first<T>() {
        // Session lookup — same query shape/fixture as devGames.test.ts's createDb.
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

        const wantsGameBySlug = query.includes("FROM games WHERE slug");
        const wantsGameById = query.includes("FROM games WHERE id");
        if (wantsGameBySlug || wantsGameById) {
          const matches = wantsGameBySlug ? game?.slug === values[0] : game?.id === values[0];
          if (!game || !matches) return null;
          return {
            id: game.id,
            slug: game.slug,
            publisher_type: game.publisher ?? "USER",
            publisher_user_id: game.publisher === "OWOGG" ? null : 1,
            visibility: game.visibility,
            live_version_id: game.live_version_id,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as T;
        }

        if (query.includes("FROM game_versions WHERE id")) {
          if (!version || version.id !== values[0]) return null;
          return {
            id: version.id,
            game_id: version.game_id,
            object_key: "games/1/17/index.html",
            content_hash: "fakehash",
            bundle_bytes: 123,
            uploaded_at: new Date().toISOString(),
            publish_status: "READY",
            publish_error: null,
            published_at: new Date().toISOString(),
            manifest_key: `games/${version.game_id}/${version.id}/.owogg-manifest.json`,
            published_size_bytes: 456,
            file_count: 2,
          } as T;
        }

        return null;
      },
      async all<T>() {
        return { results: [] } as { results: T[] };
      },
      async run() {
        return { success: true, meta: { changes: 0 } };
      },
    };
  }

  return {
    db: {
      __game: game,
      prepare(query: string) {
        return statement(query);
      },
      async batch(statements: Array<ReturnType<typeof statement>>) {
        return statements.map(() => ({ success: true, meta: { changes: 0 } }));
      },
    },
  };
}

const LIVE_GAME: FakeGame = {
  id: 1,
  slug: "ball-dodge",
  visibility: "PUBLIC",
  live_version_id: 17,
};
const LIVE_VERSION: FakeVersion = { id: 17, game_id: 1 };
const OFFICIAL_GAME: FakeGame = {
  id: 9,
  slug: "reaction-time",
  publisher: "OWOGG",
  visibility: "PUBLIC",
  live_version_id: 5,
};
const OFFICIAL_VERSION: FakeVersion = { id: 5, game_id: 9 };
const SESSION_SECRET = "test-game-session-secret";
const AUTH_HEADERS = { Cookie: "owogg_session=valid_session" };

const B2_ENV = {
  B2_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
  B2_REGION: "us-west-004",
  B2_BUCKET_NAME: "test",
  B2_KEY_ID: "test",
  B2_APPLICATION_KEY: "test",
};

async function requestSession(
  path: string,
  db: unknown,
  init: RequestInit,
  env: Record<string, unknown> = {},
) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    const gameSlug = (db as { __game?: FakeGame }).__game?.slug ?? "ball-dodge";
    const canonical = {
      schemaVersion: 1,
      slug: gameSlug,
      title: "Test Game",
      shortDescription: "",
      description: "",
      policy: {
        score: null,
        leaderboard: false,
        xpPerCompletion: 0,
        requiresAuth: true,
      },
      catalog: { type: "GENRE_MODE", genre: "puzzle", mode: "single" },
      supportsReplay: false,
      updatedAt: new Date().toISOString(),
    };
    return new Response(JSON.stringify(canonical), { status: 200 });
  }) as typeof fetch;
  try {
    return await app.request(path, init, { DB: db, ...B2_ENV, ...env } as any);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("requires authentication — no session cookie means 401, before anything else runs", async () => {
  const { db } = createDb({ game: LIVE_GAME, version: LIVE_VERSION });
  const res = await requestSession(
    "/api/games/ball-dodge/session",
    db,
    { method: "POST" },
    { GAME_SESSION_SECRET: SESSION_SECRET },
  );
  assert.equal(res.status, 401);
});

test("fails closed (503) when GAME_SESSION_SECRET is not configured in this environment", async () => {
  const { db } = createDb({ game: LIVE_GAME, version: LIVE_VERSION });
  const res = await requestSession(
    "/api/games/ball-dodge/session",
    db,
    { method: "POST", headers: AUTH_HEADERS },
    {},
  );
  assert.equal(res.status, 503);
});

test("404s for an unknown slug", async () => {
  const { db } = createDb({});
  const res = await requestSession(
    "/api/games/no-such-game/session",
    db,
    { method: "POST", headers: AUTH_HEADERS },
    { GAME_SESSION_SECRET: SESSION_SECRET },
  );
  assert.equal(res.status, 404);
});

test("404s for a PRIVATE Creator game — never distinguishes from an unknown slug", async () => {
  const { db } = createDb({
    game: { ...LIVE_GAME, visibility: "PRIVATE", live_version_id: null },
  });
  const res = await requestSession(
    "/api/games/ball-dodge/session",
    db,
    { method: "POST", headers: AUTH_HEADERS },
    { GAME_SESSION_SECRET: SESSION_SECRET },
  );
  assert.equal(res.status, 404);
});

test("404s for a SYSTEM slug — SYSTEM games are never rows in sandbox_games", async () => {
  const { db } = createDb({}); // reaction-time never appears in the fake sandbox_games table
  const res = await requestSession(
    "/api/games/reaction-time/session",
    db,
    { method: "POST", headers: AUTH_HEADERS },
    { GAME_SESSION_SECRET: SESSION_SECRET },
  );
  assert.equal(res.status, 404);
});

test("issues a token carrying the authenticated user, resolved game, and its live version", async () => {
  const { db } = createDb({ userId: 7, game: LIVE_GAME, version: LIVE_VERSION });
  const res = await requestSession(
    "/api/games/ball-dodge/session",
    db,
    { method: "POST", headers: AUTH_HEADERS },
    { GAME_SESSION_SECRET: SESSION_SECRET },
  );

  assert.equal(res.status, 200);
  const body = (await res.json()) as { token: string; expiresAt: string };
  assert.equal(typeof body.token, "string");

  const result = await verifyGameSession(body.token, SESSION_SECRET);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.payload.userId, 7);
  assert.equal(result.payload.gameId, LIVE_GAME.id);
  assert.equal(result.payload.versionId, LIVE_VERSION.id);
  assert.equal(
    gameSessionMatches(result.payload, {
      userId: 7,
      gameId: LIVE_GAME.id,
      versionId: LIVE_VERSION.id,
    }),
    true,
  );

  const expiresAtSeconds = Math.floor(new Date(body.expiresAt).getTime() / 1000);
  const nowSeconds = Math.floor(Date.now() / 1000);
  assert.ok(expiresAtSeconds > nowSeconds, "expiresAt must be in the future");
  assert.ok(
    expiresAtSeconds <= nowSeconds + 600,
    "expiresAt must fall within the 5-10 minute policy window",
  );
});

test("issues the same generic session shape for an OWOGG identity", async () => {
  const { db } = createDb({ userId: 7, game: OFFICIAL_GAME, version: OFFICIAL_VERSION });
  const res = await requestSession(
    "/api/games/reaction-time/session",
    db,
    { method: "POST", headers: AUTH_HEADERS },
    { GAME_SESSION_SECRET: SESSION_SECRET },
  );

  assert.equal(res.status, 200);
  const body = (await res.json()) as { token: string };
  const result = await verifyGameSession(body.token, SESSION_SECRET);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    {
      userId: result.payload.userId,
      gameId: result.payload.gameId,
      versionId: result.payload.versionId,
    },
    { userId: 7, gameId: OFFICIAL_GAME.id, versionId: OFFICIAL_VERSION.id },
  );
});

test("a token issued here is rejected under a different secret — the signature is real, not decorative", async () => {
  const { db } = createDb({ userId: 7, game: LIVE_GAME, version: LIVE_VERSION });
  const res = await requestSession(
    "/api/games/ball-dodge/session",
    db,
    { method: "POST", headers: AUTH_HEADERS },
    { GAME_SESSION_SECRET: SESSION_SECRET },
  );
  const body = (await res.json()) as { token: string };

  const result = await verifyGameSession(body.token, "a-different-secret-entirely");
  assert.equal(result.ok, false);
});

test("is rate limited under the 'game-session' name when RATE_LIMITER is bound and rejects", async () => {
  const { db } = createDb({ game: LIVE_GAME, version: LIVE_VERSION });
  const keys: string[] = [];
  const res = await requestSession(
    "/api/games/ball-dodge/session",
    db,
    { method: "POST", headers: AUTH_HEADERS },
    {
      GAME_SESSION_SECRET: SESSION_SECRET,
      RATE_LIMITER: {
        limit: async ({ key }: { key: string }) => {
          keys.push(key);
          return { success: false };
        },
      },
    },
  );
  assert.equal(res.status, 429);
  assert.ok(keys[0]?.startsWith("game-session:"), "keyed under this route's own name prefix");
});

test("passes through when RATE_LIMITER is bound and allows the request", async () => {
  const { db } = createDb({ game: LIVE_GAME, version: LIVE_VERSION });
  const res = await requestSession(
    "/api/games/ball-dodge/session",
    db,
    { method: "POST", headers: AUTH_HEADERS },
    {
      GAME_SESSION_SECRET: SESSION_SECRET,
      RATE_LIMITER: { limit: async () => ({ success: true }) },
    },
  );
  assert.equal(res.status, 200);
});
