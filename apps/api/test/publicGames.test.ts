import test from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/index.js";
import type { GameCanonicalDocument } from "@owogg/core";
import type { ApiEnv } from "../src/routes/auth.js";

const B2_ENV = {
  B2_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
  B2_REGION: "us-west-004",
  B2_BUCKET_NAME: "test",
  B2_KEY_ID: "test",
  B2_APPLICATION_KEY: "test",
};

interface FakeGame {
  id: number;
  slug: string;
  publisher_type: "OWOGG" | "USER";
  publisher_user_id: number | null;
  visibility: "PRIVATE" | "PUBLIC";
  live_version_id: number | null;
  canonical: GameCanonicalDocument;
  assetKey?: string;
  disabled?: boolean;
}

interface PublicGameJson {
  slug: string;
  publisherType: string;
  publisherName: string;
  catalog: { type: string };
  mediaUrl: string | null;
  [key: string]: unknown;
}

function rowFor(game: FakeGame) {
  return {
    id: game.id,
    slug: game.slug,
    publisher_type: game.publisher_type,
    publisher_user_id: game.publisher_user_id,
    visibility: game.visibility,
    live_version_id: game.live_version_id,
    deleted_at: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
  };
}

function versionFor(game: FakeGame) {
  if (game.live_version_id === null) return null;
  return {
    id: game.live_version_id,
    game_id: game.id,
    object_key: `games/${game.id}/${game.live_version_id}/index.html`,
    content_hash: `hash-${game.slug}`,
    bundle_bytes: 100,
    publish_status: "READY",
    publish_error: null,
    published_at: "2026-08-01T00:00:00.000Z",
    manifest_key: `games/${game.id}/${game.live_version_id}/.owogg-manifest.json`,
    published_size_bytes: 100,
    file_count: 1,
    uploaded_at: "2026-08-01T00:00:00.000Z",
  };
}

function createDb(games: readonly FakeGame[]) {
  function statement(query: string) {
    let values: readonly unknown[] = [];
    return {
      bind(...bound: unknown[]) {
        values = bound;
        return this;
      },
      async first<T>() {
        if (query.includes("FROM users WHERE id = ?")) {
          const userId = Number(values[0]);
          return {
            id: userId,
            nickname: userId === 42 ? "Taeyang" : `User ${userId}`,
            email: null,
            avatar_url: null,
            created_at: "2026-08-01T00:00:00.000Z",
            updated_at: "2026-08-01T00:00:00.000Z",
          } as T;
        }
        if (query.includes("FROM games WHERE slug")) {
          const game = games.find((candidate) => candidate.slug === values[0]);
          return (game ? rowFor(game) : null) as T | null;
        }
        if (query.includes("FROM games WHERE id")) {
          const game = games.find((candidate) => candidate.id === Number(values[0]));
          return (game ? rowFor(game) : null) as T | null;
        }
        if (query.includes("FROM game_versions WHERE id")) {
          const game = games.find((candidate) => candidate.live_version_id === Number(values[0]));
          return (game ? versionFor(game) : null) as T | null;
        }
        if (query.includes("FROM game_assets")) {
          const game = games.find((candidate) => candidate.id === Number(values[0]));
          return game?.assetKey
            ? ({
                game_id: game.id,
                kind: "LOGO",
                object_key: game.assetKey,
                updated_at: "2026-08-01T00:00:00.000Z",
              } as T)
            : null;
        }
        return null;
      },
      async all<T>() {
        if (query.includes("FROM games WHERE deleted_at IS NULL")) {
          return { results: games.filter((game) => game.visibility !== "PRIVATE").map(rowFor) } as {
            results: T[];
          };
        }
        if (query.includes("FROM game_settings WHERE enabled = 0")) {
          return {
            results: games.filter((game) => game.disabled).map((game) => ({ game_id: game.slug })),
          } as { results: T[] };
        }
        if (query.includes("FROM oauth_accounts")) return { results: [] as T[] };
        return { results: [] as T[] };
      },
      async run() {
        return { success: true, meta: { changes: 0 } };
      },
    };
  }

  return {
    prepare(query: string) {
      return statement(query);
    },
    async batch(statements: Array<ReturnType<typeof statement>>) {
      return statements.map(() => ({ success: true, meta: { changes: 0 } }));
    },
  };
}

function request(path: string, db: unknown, games: readonly FakeGame[], init: RequestInit = {}) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    const canonicalGame = games.find((game) => url.includes(`game-definitions/${game.slug}/`));
    if (canonicalGame) {
      return new Response(JSON.stringify(canonicalGame.canonical), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    const assetGame = games.find((game) => game.assetKey && url.endsWith(`/${game.assetKey}`));
    if (assetGame) return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    return new Response("Not Found", { status: 404 });
  }) as typeof fetch;

  return app
    .request(path, { ...init }, { DB: db, ...B2_ENV } as unknown as ApiEnv["Bindings"])
    .finally(() => {
      globalThis.fetch = originalFetch;
    });
}

const OFFICIAL: FakeGame = {
  id: 9,
  slug: "reaction-time",
  publisher_type: "OWOGG",
  publisher_user_id: null,
  visibility: "PUBLIC",
  live_version_id: 901,
  canonical: {
    schemaVersion: 2,
    slug: "reaction-time",
    title: "반응속도 테스트",
    shortDescription: "반응속도를 측정합니다.",
    description: "화면 신호에 빠르게 반응하세요.",
    publisher: { official: true },
    policy: {
      score: { unit: "ms", direction: "asc", min: 0, max: 60_000, displaySuffix: " ms" },
      leaderboard: true,
      xpPerCompletion: 10,
      requiresAuth: false,
    },
    supportsReplay: false,
    catalog: {
      type: "TAXONOMY",
      categories: ["reflex"],
      tags: ["reaction"],
      modes: ["single"],
      inputMethods: ["mouse"],
      minPlayers: 1,
      maxPlayers: 1,
      thumbnail: "/reaction-time.svg",
    },
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
};

const USER: FakeGame = {
  id: 8,
  slug: "ball-dodge",
  publisher_type: "USER",
  publisher_user_id: 42,
  visibility: "PUBLIC",
  live_version_id: 801,
  assetKey: "uploads/8/logo.svg",
  canonical: {
    schemaVersion: 1,
    slug: "ball-dodge",
    title: "공 피하기",
    shortDescription: "공을 피하세요",
    description: "공을 피하세요.",
    policy: {
      score: { unit: "seconds", direction: "desc", min: 0, max: 3600 },
      leaderboard: true,
      xpPerCompletion: 0,
      requiresAuth: false,
    },
    supportsReplay: false,
    catalog: { type: "GENRE_MODE", genre: "arcade", mode: "single" },
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
};

const PRIVATE: FakeGame = {
  ...USER,
  id: 10,
  slug: "private-game",
  publisher_user_id: 43,
  visibility: "PRIVATE",
  live_version_id: null,
  canonical: { ...USER.canonical, slug: "private-game" },
};

test("GET /api/games lists generic OWOGG and USER projections and preserves catalog shapes", async () => {
  const games = [OFFICIAL, USER, PRIVATE];
  const db = createDb(games);
  const response = await request("https://api.example.test/api/games", db, games);
  assert.equal(response.status, 200);
  const body = (await response.json()) as { games: PublicGameJson[] };
  assert.deepEqual(body.games.map((game) => game.slug).sort(), ["ball-dodge", "reaction-time"]);
  const official = body.games.find((game) => game.slug === OFFICIAL.slug);
  const user = body.games.find((game) => game.slug === USER.slug);
  assert.equal(official?.publisherType, "OWOGG");
  assert.equal(official?.publisherName, "OWOGG");
  assert.equal(official?.mediaUrl, null);
  assert.equal(user?.publisherType, "USER");
  assert.equal(user?.publisherName, "Taeyang");
  assert.equal(official?.catalog.type, "TAXONOMY");
  assert.equal(user?.catalog.type, "GENRE_MODE");
  assert.equal(user?.mediaUrl, "https://api.example.test/api/games/ball-dodge/media/logo");
  assert.equal("publisher_user_id" in (user ?? {}), false);
  assert.equal("developerUserId" in (user ?? {}), false);
});

test("GET /api/games/:slug resolves the same generic projection and denies private games", async () => {
  const games = [OFFICIAL, USER, PRIVATE];
  const db = createDb(games);
  const officialResponse = await request(
    "https://api.example.test/api/games/reaction-time",
    db,
    games,
  );
  const official = (await officialResponse.json()) as PublicGameJson;
  assert.equal(officialResponse.status, 200);
  assert.equal(official.publisherType, "OWOGG");
  assert.equal(official.title, OFFICIAL.canonical.title);

  const privateResponse = await request(
    "https://api.example.test/api/games/private-game",
    db,
    games,
  );
  assert.equal(privateResponse.status, 404);
});

test("generic media route serves a D1 asset without exposing its object key and denies disabled games", async () => {
  const games = [USER, { ...OFFICIAL, slug: "typing-test", disabled: true }];
  const db = createDb(games);
  const mediaResponse = await request("/api/games/ball-dodge/media/logo", db, games);
  assert.equal(mediaResponse.status, 200);
  assert.equal(mediaResponse.headers.get("Content-Type"), "image/svg+xml");
  assert.deepEqual(new Uint8Array(await mediaResponse.arrayBuffer()), new Uint8Array([1, 2, 3]));

  const disabledResponse = await request("/api/games/typing-test/media/logo", db, games);
  assert.equal(disabledResponse.status, 404);
});

test("generic public routes fail closed without a D1 binding", async () => {
  const emptyEnv = {} as unknown as ApiEnv["Bindings"];
  const list = await app.request("/api/games", {}, emptyEnv);
  const detail = await app.request("/api/games/reaction-time", {}, emptyEnv);
  assert.equal(list.status, 200);
  assert.deepEqual(await list.json(), { games: [] });
  assert.equal(detail.status, 404);
});
