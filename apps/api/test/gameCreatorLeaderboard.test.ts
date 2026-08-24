import test from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/index.js";
import { GAME_CANONICAL_SCHEMA_VERSION, type GameCanonicalDocument } from "@owogg/core";

// GET /api/scores/:gameId now resolves every publisher through the generic runtime projection.
// This file covers a USER-owned generic identity and the availability gate. The underlying
// PB-dedup/sort SQL itself is D1ScoreRepository.getLeaderboard, unchanged and already proven
// against real SQLite in packages/db/test/leaderboardPersonalBest.test.ts (including ball-dodge's
// own decimal scores) — the fake `scores` table below re-implements that same dedup/sort logic in
// JS only so this file can exercise the actual HTTP route end-to-end, not to re-derive its
// correctness a second time.

interface FakeGame {
  id: number;
  slug: string;
  title: string;
  visibility: "PRIVATE" | "PUBLIC";
  live_version_id: number | null;
  score_unit?: string | null;
  score_direction?: "asc" | "desc" | null;
  score_min?: number | null;
  score_max?: number | null;
}
interface FakeScoreRow {
  id: number;
  user_id: number;
  nickname: string;
  avatar_url: string | null;
  game_id: string;
  score: number;
  difficulty: string;
  created_at: string;
}

function createDb(options: { game?: FakeGame; scores?: FakeScoreRow[] }) {
  const { game, scores = [] } = options;

  function statement(query: string) {
    let values: unknown[] = [];
    return {
      bind(...bound: unknown[]) {
        values = bound;
        return this;
      },
      async first<T>() {
        const wantsGameBySlug = query.includes("FROM games WHERE slug");
        if (wantsGameBySlug) {
          if (!game || game.slug !== values[0]) return null;
          return {
            id: game.id,
            slug: game.slug,
            publisher_type: "USER",
            publisher_user_id: 1,
            visibility: game.visibility,
            live_version_id: game.live_version_id,
            deleted_at: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as T;
        }
        if (query.includes("FROM games WHERE id")) {
          if (!game || game.id !== Number(values[0])) return null;
          return {
            id: game.id,
            slug: game.slug,
            publisher_type: "USER",
            publisher_user_id: 1,
            visibility: game.visibility,
            live_version_id: game.live_version_id,
            deleted_at: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as T;
        }
        if (query.includes("FROM game_versions WHERE id")) {
          if (!game || game.live_version_id !== Number(values[0])) return null;
          return {
            id: game.live_version_id,
            game_id: game.id,
            object_key: `games/${game.id}/${game.live_version_id}/index.html`,
            content_hash: "hash",
            bundle_bytes: 1,
            publish_status: "READY",
            publish_error: null,
            published_at: new Date().toISOString(),
            manifest_key: `games/${game.id}/${game.live_version_id}/.owogg-manifest.json`,
            published_size_bytes: 1,
            file_count: 1,
            uploaded_at: new Date().toISOString(),
          } as T;
        }
        return null;
      },
      async all<T>() {
        if (query.includes("FROM scores")) {
          const gameId = String(values[0]);
          // The real query's tie-breakers (`created_at ASC, id ASC`) always contain "ASC" — the
          // actual requested direction is only in "score ASC"/"score DESC" specifically.
          const direction = query.includes("score DESC") ? "desc" : "asc";
          const matching = scores.filter((r) => r.game_id === gameId);

          // Same dedup rule as the real SQL: one row per user, their best (per `direction`).
          const bestByUser = new Map<number, FakeScoreRow>();
          for (const row of matching) {
            const current = bestByUser.get(row.user_id);
            if (
              !current ||
              (direction === "asc" ? row.score < current.score : row.score > current.score)
            ) {
              bestByUser.set(row.user_id, row);
            }
          }
          const deduped = [...bestByUser.values()].sort((a, b) =>
            direction === "asc" ? a.score - b.score : b.score - a.score,
          );
          return { results: deduped as unknown as T[] };
        }
        return { results: [] as T[] };
      },
      async run() {
        return { success: true, meta: { changes: 0 } };
      },
    };
  }

  return {
    __game: game,
    prepare(query: string) {
      return statement(query);
    },
    async batch(statements: Array<ReturnType<typeof statement>>) {
      return statements.map(() => ({ success: true, meta: { changes: 0 } }));
    },
  };
}

function canonicalFor(game: FakeGame): GameCanonicalDocument {
  const scoreConfigured =
    game.score_unit !== null &&
    game.score_unit !== undefined &&
    game.score_direction !== null &&
    game.score_direction !== undefined &&
    game.score_min !== null &&
    game.score_min !== undefined &&
    game.score_max !== null &&
    game.score_max !== undefined;

  return {
    schemaVersion: GAME_CANONICAL_SCHEMA_VERSION,
    slug: game.slug,
    title: game.title,
    shortDescription: game.title,
    description: game.title,
    publisher: { official: false },
    policy: {
      score: scoreConfigured
        ? {
            unit: game.score_unit!,
            direction: game.score_direction!,
            min: game.score_min!,
            max: game.score_max!,
          }
        : null,
      leaderboard: scoreConfigured,
      xpPerCompletion: 0,
      requiresAuth: false,
    },
    supportsReplay: false,
    catalog: { type: "GENRE_MODE", genre: "arcade", mode: "single" },
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

async function requestLeaderboard(db: unknown, slug: string) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.includes(`game-definitions/${slug}/definition.json`)) {
      return new Response("Not Found", { status: 404 });
    }
    const game = (db as { __game?: FakeGame }).__game;
    if (
      !game ||
      game.score_unit === null ||
      game.score_unit === undefined ||
      game.score_direction === null ||
      game.score_direction === undefined ||
      game.score_min === null ||
      game.score_min === undefined ||
      game.score_max === null ||
      game.score_max === undefined
    ) {
      return new Response("Not Found", { status: 404 });
    }
    return game
      ? new Response(JSON.stringify(canonicalFor(game)), { status: 200 })
      : new Response("Not Found", { status: 404 });
  }) as typeof fetch;
  try {
    return await app.request(`/api/scores/${slug}`, {}, {
      DB: db,
      B2_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
      B2_REGION: "us-west-004",
      B2_BUCKET_NAME: "test",
      B2_KEY_ID: "test",
      B2_APPLICATION_KEY: "test",
    } as any);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const BALL_DODGE: FakeGame = {
  id: 8,
  slug: "ball-dodge",
  title: "공 피하기",
  visibility: "PUBLIC",
  live_version_id: 17,
  score_unit: "seconds",
  score_direction: "desc",
  score_min: 0,
  score_max: 3600,
};

test("ball-dodge (desc): the PB leaderboard is returned with the generic game's own title", async () => {
  const db = createDb({
    game: BALL_DODGE,
    scores: [
      {
        id: 1,
        user_id: 1,
        nickname: "A",
        avatar_url: null,
        game_id: "ball-dodge",
        score: 12.75,
        difficulty: "normal",
        created_at: new Date().toISOString(),
      },
      {
        id: 2,
        user_id: 2,
        nickname: "B",
        avatar_url: null,
        game_id: "ball-dodge",
        score: 4.4,
        difficulty: "normal",
        created_at: new Date().toISOString(),
      },
    ],
  });

  const res = await requestLeaderboard(db, "ball-dodge");
  assert.equal(res.status, 200);

  const body = (await res.json()) as { leaderboard: Array<Record<string, unknown>> };
  assert.equal(body.leaderboard.length, 2);
  assert.equal(body.leaderboard[0]?.score, 12.75, "higher survival time ranks first (desc)");
  assert.equal(body.leaderboard[1]?.score, 4.4);
  assert.ok(
    body.leaderboard.every((row) => row.gameTitle === "공 피하기"),
    "gameTitle comes from the generic canonical document, not a static registry",
  );
});

test("a user's best decimal score wins the PB dedup — their other, worse attempts never appear", async () => {
  const db = createDb({
    game: BALL_DODGE,
    scores: [
      {
        id: 1,
        user_id: 1,
        nickname: "A",
        avatar_url: null,
        game_id: "ball-dodge",
        score: 4.4,
        difficulty: "normal",
        created_at: new Date().toISOString(),
      },
      {
        id: 2,
        user_id: 1,
        nickname: "A",
        avatar_url: null,
        game_id: "ball-dodge",
        score: 12.75,
        difficulty: "normal",
        created_at: new Date().toISOString(),
      },
      {
        id: 3,
        user_id: 1,
        nickname: "A",
        avatar_url: null,
        game_id: "ball-dodge",
        score: 8.1,
        difficulty: "normal",
        created_at: new Date().toISOString(),
      },
    ],
  });

  const res = await requestLeaderboard(db, "ball-dodge");
  const body = (await res.json()) as { leaderboard: Array<Record<string, unknown>> };

  assert.equal(body.leaderboard.length, 1, "one row per user, not one per raw attempt");
  assert.equal(body.leaderboard[0]?.score, 12.75, "their true PB, not just an early or late row");
});

test("an ascending-direction generic game (lower is better) sorts the leaderboard accordingly", async () => {
  const ascGame: FakeGame = { ...BALL_DODGE, score_direction: "asc" };
  const db = createDb({
    game: ascGame,
    scores: [
      {
        id: 1,
        user_id: 1,
        nickname: "A",
        avatar_url: null,
        game_id: "ball-dodge",
        score: 12.75,
        difficulty: "normal",
        created_at: new Date().toISOString(),
      },
      {
        id: 2,
        user_id: 2,
        nickname: "B",
        avatar_url: null,
        game_id: "ball-dodge",
        score: 4.4,
        difficulty: "normal",
        created_at: new Date().toISOString(),
      },
    ],
  });

  const res = await requestLeaderboard(db, "ball-dodge");
  const body = (await res.json()) as { leaderboard: Array<Record<string, unknown>> };
  assert.equal(body.leaderboard[0]?.score, 4.4, "lower score ranks first when direction is asc");
});

test("a PRIVATE generic game 400s exactly like an unknown gameId", async () => {
  const db = createDb({ game: { ...BALL_DODGE, visibility: "PRIVATE" } });
  const res = await requestLeaderboard(db, "ball-dodge");

  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "INVALID_GAME_ID");
});

test("a generic game with no live version 400s exactly like an unknown gameId", async () => {
  const db = createDb({ game: { ...BALL_DODGE, live_version_id: null } });
  const res = await requestLeaderboard(db, "ball-dodge");
  assert.equal(res.status, 400);
});

test("a generic game with no score policy configured yet 400s exactly like an unknown gameId", async () => {
  const db = createDb({
    game: {
      ...BALL_DODGE,
      score_unit: null,
      score_direction: null,
      score_min: null,
      score_max: null,
    },
  });
  const res = await requestLeaderboard(db, "ball-dodge");
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "INVALID_GAME_ID");
});

test("an unknown slug with no generic identity still 400s", async () => {
  const db = createDb({});
  const res = await requestLeaderboard(db, "no-such-game-anywhere");
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "INVALID_GAME_ID");
});
