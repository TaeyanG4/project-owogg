import test from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/app.js";
import type { GameCanonicalDocument } from "@owogg/core";

/**
 * GET /api/scores/:gameId — both identity/version and title/policy now resolve through the generic
 * D1+B2 runtime projection, and each leaderboard row carries `gameTitle` resolved server-side.
 *
 * api.test.ts and edgeCache.test.ts already cover the unknown-gameId 400 and the DB-less 400
 * shape; this file is only the behaviour those didn't exercise — gameTitle actually appearing,
 * and coming from the real registry rather than the row data.
 */

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

function createDb(rows: FakeScoreRow[], queryLog: string[] = []) {
  const ids: Record<string, { gameId: number; versionId: number }> = {
    "reaction-time": { gameId: 9, versionId: 5 },
    "memory-test": { gameId: 11, versionId: 7 },
  };
  function statement(query: string) {
    let values: unknown[] = [];
    return {
      bind(...bound: unknown[]) {
        values = bound;
        return this;
      },
      async first() {
        if (query.includes("FROM games WHERE slug") || query.includes("FROM games WHERE id")) {
          const slug = query.includes("FROM games WHERE id")
            ? Object.keys(ids).find((value) => ids[value]?.gameId === Number(values[0]))
            : String(values[0]);
          const identity = slug ? ids[slug] : undefined;
          return identity
            ? {
                id: identity.gameId,
                slug,
                publisher_type: "OWOGG",
                publisher_user_id: null,
                visibility: "PUBLIC",
                live_version_id: identity.versionId,
                deleted_at: null,
                created_at: "2026-01-01T00:00:00.000Z",
                updated_at: "2026-01-01T00:00:00.000Z",
              }
            : null;
        }
        if (query.includes("FROM game_versions WHERE id")) {
          const versionId = Number(values[0]);
          const entry = Object.values(ids).find((item) => item.versionId === versionId);
          return entry
            ? {
                id: entry.versionId,
                game_id: entry.gameId,
                object_key: `games/${entry.gameId}/${entry.versionId}/index.html`,
                content_hash: "hash",
                bundle_bytes: 1,
                publish_status: "READY",
                publish_error: null,
                published_at: "2026-01-01T00:00:00.000Z",
                manifest_key: `games/${entry.gameId}/${entry.versionId}/.owogg-manifest.json`,
                published_size_bytes: 1,
                file_count: 1,
                uploaded_at: "2026-01-01T00:00:00.000Z",
              }
            : null;
        }
        return null;
      },
      async all<T>() {
        if (query.includes("FROM scores")) {
          const gameId = String(values[0]);
          const matching = rows.filter((r) => r.game_id === gameId);
          return { results: matching as unknown as T[] };
        }
        return { results: [] as T[] };
      },
      async run() {
        return { success: true, meta: { changes: 0 } };
      },
    };
  }

  return {
    prepare(query: string) {
      queryLog.push(query);
      return statement(query);
    },
    async batch(statements: Array<ReturnType<typeof statement>>) {
      return statements.map(() => ({ success: true, meta: { changes: 0 } }));
    },
  };
}

async function requestLeaderboard(db: unknown, path: string) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    const slug = Object.keys({ "reaction-time": true, "memory-test": true }).find((value) =>
      url.includes(`game-definitions/${value}/definition.json`),
    );
    const definition: GameCanonicalDocument | null = slug
      ? {
          schemaVersion: 2,
          slug,
          title: slug === "reaction-time" ? "반응속도 테스트" : "순서 기억력 테스트",
          shortDescription: "fixture",
          description: "fixture",
          publisher: { official: true },
          policy: {
            score: {
              unit: slug === "reaction-time" ? "ms" : "level",
              direction: slug === "reaction-time" ? "asc" : "desc",
              min: 0,
              max: 60_000,
            },
            leaderboard: true,
            xpPerCompletion: 10,
            requiresAuth: false,
          },
          supportsReplay: false,
          catalog: {
            type: "TAXONOMY",
            categories: ["test"],
            tags: ["fixture"],
            modes: ["single"],
            inputMethods: ["mouse"],
            minPlayers: 1,
            maxPlayers: 1,
            thumbnail: "/fixture.svg",
          },
          updatedAt: "2026-01-01T00:00:00.000Z",
        }
      : null;
    return definition
      ? new Response(JSON.stringify(definition), { status: 200 })
      : new Response("Not Found", { status: 404 });
  }) as typeof fetch;
  try {
    return await app.request(path, {}, {
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

test("GET /api/scores/:gameId includes the registry's title on every row, not the row's own data", async () => {
  const db = createDb([
    {
      id: 1,
      user_id: 42,
      nickname: "Player",
      avatar_url: null,
      game_id: "reaction-time",
      score: 200,
      difficulty: "normal",
      created_at: new Date().toISOString(),
    },
  ]);

  const res = await requestLeaderboard(db, "/api/scores/reaction-time");
  assert.equal(res.status, 200);

  const body = (await res.json()) as { leaderboard: Array<Record<string, unknown>> };
  assert.equal(body.leaderboard.length, 1);
  assert.equal(body.leaderboard[0]?.gameTitle, "반응속도 테스트");
});

test("GET /api/scores/:gameId still 400s an unknown gameId even with a DB bound", async () => {
  // RuntimeGameRegistry resolution is the read-side gate: an unknown slug must not silently return
  // an empty-but-200 leaderboard.
  const db = createDb([]);
  const res = await requestLeaderboard(db, "/api/scores/some-sandbox-game-slug");

  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "INVALID_GAME_ID");
});

test("GET /api/scores/:gameId gameTitle is consistent across multiple rows of the same game", async () => {
  const db = createDb([
    {
      id: 1,
      user_id: 1,
      nickname: "A",
      avatar_url: null,
      game_id: "memory-test",
      score: 5,
      difficulty: "normal",
      created_at: new Date().toISOString(),
    },
    {
      id: 2,
      user_id: 2,
      nickname: "B",
      avatar_url: null,
      game_id: "memory-test",
      score: 12,
      difficulty: "normal",
      created_at: new Date().toISOString(),
    },
  ]);

  const res = await requestLeaderboard(db, "/api/scores/memory-test");
  const body = (await res.json()) as { leaderboard: Array<Record<string, unknown>> };

  assert.equal(body.leaderboard.length, 2);
  assert.ok(body.leaderboard.every((row) => row.gameTitle === "순서 기억력 테스트"));
});

test("generic leaderboard keeps runtime validation on primary and reads score rows through replica session", async () => {
  const primaryQueries: string[] = [];
  const replicaQueries: string[] = [];
  const replica = createDb(
    [
      {
        id: 2,
        user_id: 2,
        nickname: "Replica",
        avatar_url: null,
        game_id: "reaction-time",
        score: 222,
        difficulty: "normal",
        created_at: new Date().toISOString(),
      },
    ],
    replicaQueries,
  );
  const primary = createDb(
    [
      {
        id: 1,
        user_id: 1,
        nickname: "Primary",
        avatar_url: null,
        game_id: "reaction-time",
        score: 111,
        difficulty: "normal",
        created_at: new Date().toISOString(),
      },
    ],
    primaryQueries,
  ) as typeof replica & { withSession: (constraint?: unknown) => typeof replica };
  primary.withSession = (constraint) => {
    assert.equal(constraint, "first-unconstrained");
    return replica;
  };

  const res = await requestLeaderboard(primary, "/api/scores/reaction-time");
  assert.equal(res.status, 200);
  const body = (await res.json()) as { leaderboard: Array<Record<string, unknown>> };
  assert.equal(body.leaderboard[0]?.score, 222);
  assert.ok(primaryQueries.some((query) => query.includes("FROM games")));
  assert.ok(primaryQueries.some((query) => query.includes("FROM game_versions")));
  assert.equal(
    primaryQueries.some((query) => query.includes("FROM scores")),
    false,
  );
  assert.ok(replicaQueries.some((query) => query.includes("FROM scores")));
});
