import test from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/app.js";
import { signGameSession, type GameSessionPayload } from "@owogg/core";

/**
 * Deterministically corrupts a signed token's signature segment — see
 * packages/core/test/helpers/tamperSignature.ts's own (much longer) doc comment for the full
 * reasoning this is a local copy of: swapping a token's last CHARACTER for a fixed replacement
 * (the previous approach here) is flaky, because base64url's last character encodes fewer than 6
 * significant bits for a 32-byte HMAC-SHA256 signature — some replacements decode to
 * byte-identical signatures, letting a "tampered" token pass verification by chance roughly 1 run
 * in 4. Flipping one real byte via XOR after decoding is deterministic instead. Duplicated here
 * rather than imported from packages/core/test/ — apps/api and packages/core are separate
 * workspace packages, and this repo doesn't import across another package's test/ directory (only
 * across its published `src` surface, via @owogg/core above) — this one small pure function is
 * cheaper to keep in sync by hand than to invent a new shared-test-utils package for.
 */
function tamperSignedToken(token: string): string {
  const lastDot = token.lastIndexOf(".");
  const prefix = lastDot === -1 ? "" : token.slice(0, lastDot + 1);
  const segment = lastDot === -1 ? token : token.slice(lastDot + 1);

  const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
  const withPadding = padded + "=".repeat((4 - (padded.length % 4)) % 4);
  const binary = atob(withPadding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (bytes.length === 0) return `${token}x`;

  const lastIndex = bytes.length - 1;
  bytes[lastIndex] = (bytes[lastIndex] ?? 0) ^ 0x01;

  let tamperedBinary = "";
  for (let i = 0; i < bytes.length; i++) tamperedBinary += String.fromCharCode(bytes[i] ?? 0);
  const tamperedSegment = btoa(tamperedBinary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return prefix + tamperedSegment;
}

// POST /api/games/:slug/score — route-layer wiring only. The generic D1/B2 runtime acceptance path is
// Proven against real SQLite in packages/db/test/D1GameScoreAcceptanceRepository.test.ts, and
// every pre-write check (availability, token validity, context match, score policy) is proven
// against a fake repository in packages/core/test/creatorScoreAcceptanceUseCases.test.ts. This
// file only confirms HTTP-level wiring — auth gating, status codes per error, and that a real
// success actually reaches the fake D1's `scores` write — using the same "real Hono app, fake D1"
// pattern gameSession.test.ts uses, extended with a hand-rolled batch() that models the
// game_attempt_consumptions + scores atomic write in JS state (not real SQL — that's the db
// package's job).

interface FakeGame {
  id: number;
  slug: string;
  visibility: "PRIVATE" | "PUBLIC";
  live_version_id: number | null;
  score_unit?: string | null;
  score_direction?: "asc" | "desc" | null;
  score_min?: number | null;
  score_max?: number | null;
}
interface FakeVersion {
  id: number;
  game_id: number;
}
interface FakeScoreRow {
  userId: unknown;
  nickname: unknown;
  avatarUrl: unknown;
  gameSlug: unknown;
  score: unknown;
  difficulty: unknown;
  nowIso: unknown;
}

function createDb(options: {
  userId?: number;
  scoreSubmissionBlocked?: boolean;
  game?: FakeGame;
  version?: FakeVersion;
  preConsumedAttemptIds?: string[];
}) {
  const {
    userId = 7,
    scoreSubmissionBlocked = false,
    game,
    version,
    preConsumedAttemptIds = [],
  } = options;
  const consumedAttemptIds = new Set(preConsumedAttemptIds);
  const scores: FakeScoreRow[] = [];
  const xpEvents = new Map<string, { id: number; amount: number }>();
  const userProgress = new Map<
    number,
    { user_id: number; total_xp: number; eligible_completions: number; updated_at: string }
  >();

  function statement(query: string) {
    let values: unknown[] = [];
    return {
      query,
      bind(...bound: unknown[]) {
        values = bound;
        return this;
      },
      get values() {
        return values;
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
            score_submission_blocked: scoreSubmissionBlocked ? 1 : 0,
          } as T;
        }

        if (query.includes("FROM xp_events WHERE source_type = ? AND source_id = ?")) {
          return (xpEvents.get(`${String(values[0])}:${String(values[1])}`) ?? null) as T | null;
        }

        if (query.includes("FROM user_progress WHERE user_id = ?")) {
          return (userProgress.get(Number(values[0])) ?? null) as T | null;
        }

        const wantsGameBySlug = query.includes("FROM games WHERE slug");
        const wantsGameById = query.includes("FROM games WHERE id");
        if (wantsGameBySlug || wantsGameById) {
          const matches = wantsGameBySlug ? game?.slug === values[0] : game?.id === values[0];
          if (!game || !matches) return null;
          return {
            id: game.id,
            slug: game.slug,
            publisher_type: "USER",
            publisher_user_id: 1,
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
    scores,
    db: {
      __game: game,
      prepare(query: string) {
        return statement(query);
      },
      // Models the D1GameScoreAcceptanceRepository batch in JS state: statement 0 is the
      // attempt-consumption claim (ON CONFLICT DO NOTHING), statement 1 is the scores insert
      // gated on statement 0's own success — see that repository's doc comment for why this must
      // be one atomic unit rather than two independent writes.
      async batch(statements: Array<ReturnType<typeof statement>>) {
        const [attemptStmt, scoreStmt] = statements;
        if (attemptStmt?.query.includes("INSERT INTO xp_events")) {
          const userIdBound = Number(attemptStmt.values[0]);
          const xpAmount = Number(attemptStmt.values[6]);
          const sourceType = String(attemptStmt.values[7]);
          const sourceId = String(attemptStmt.values[8]);
          const createdAt = String(attemptStmt.values[10]);
          const key = `${sourceType}:${sourceId}`;
          const inserted = xpEvents.has(key) ? 0 : 1;
          if (inserted === 1) {
            xpEvents.set(key, { id: xpEvents.size + 1, amount: xpAmount });
            const previous = userProgress.get(userIdBound);
            userProgress.set(userIdBound, {
              user_id: userIdBound,
              total_xp: (previous?.total_xp ?? 0) + xpAmount,
              eligible_completions: (previous?.eligible_completions ?? 0) + 1,
              updated_at: createdAt,
            });
          }
          return statements.map(() => ({
            success: true,
            meta: { changes: inserted, rows_written: inserted },
          }));
        }

        if (!attemptStmt?.query.includes("game_attempt_consumptions")) {
          return statements.map(() => ({
            success: true,
            meta: { changes: 0, rows_written: 0 },
          }));
        }
        const attemptId = attemptStmt?.values[0] as string;
        let attemptChanges = 0;
        if (attemptId !== undefined && !consumedAttemptIds.has(attemptId)) {
          consumedAttemptIds.add(attemptId);
          attemptChanges = 1;
        }
        let scoreChanges = 0;
        if (attemptChanges === 1 && scoreStmt) {
          const [userIdBound, nickname, avatarUrl, gameSlug, score, difficulty, nowIso] =
            scoreStmt.values;
          scores.push({
            userId: userIdBound,
            nickname,
            avatarUrl,
            gameSlug,
            score,
            difficulty,
            nowIso,
          });
          scoreChanges = 1;
        }
        return [
          { success: true, meta: { changes: attemptChanges, rows_written: attemptChanges } },
          // rows_written is the field D1GameScoreAcceptanceRepository actually reads to decide
          // `accepted` — populated here (not left undefined) so this fake models a real D1 batch
          // result, not just changes, which the repository deliberately no longer trusts.
          {
            success: true,
            meta: { changes: scoreChanges, rows_written: scoreChanges, last_row_id: 1 },
          },
          { success: true, results: scoreChanges === 1 ? [{ id: 1 }] : [] },
        ];
      },
    },
  };
}

const LIVE_GAME: FakeGame = {
  id: 1,
  slug: "ball-dodge",
  visibility: "PUBLIC",
  live_version_id: 17,
  score_unit: "seconds",
  score_direction: "desc",
  score_min: 0,
  score_max: 3600,
};
const LIVE_VERSION: FakeVersion = { id: 17, game_id: 1 };
const SESSION_SECRET = "test-game-session-secret";
const AUTH_HEADERS = { Cookie: "owogg_session=valid_session", "Content-Type": "application/json" };

function samplePayload(overrides: Partial<GameSessionPayload> = {}): GameSessionPayload {
  return {
    userId: 7,
    gameId: LIVE_GAME.id,
    versionId: LIVE_VERSION.id,
    attemptId: crypto.randomUUID(),
    exp: Math.floor(Date.now() / 1000) + 300,
    difficulty: "normal",
    ...overrides,
  };
}

async function postScore(
  db: unknown,
  body: unknown,
  env: Record<string, unknown> = { GAME_SESSION_SECRET: SESSION_SECRET },
) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    const canonicalGame = (db as { __game?: FakeGame }).__game ?? LIVE_GAME;
    const canonical = {
      schemaVersion: 1,
      slug: "ball-dodge",
      title: "Test Game",
      shortDescription: "",
      description: "",
      publisher: { official: false },
      policy: {
        score:
          canonicalGame.score_unit &&
          canonicalGame.score_direction &&
          canonicalGame.score_min !== null &&
          canonicalGame.score_max !== null
            ? {
                unit: canonicalGame.score_unit,
                direction: canonicalGame.score_direction,
                min: canonicalGame.score_min,
                max: canonicalGame.score_max,
              }
            : null,
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
    return await app.request(
      "/api/games/ball-dodge/score",
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify(body) },
      {
        DB: db,
        B2_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
        B2_REGION: "us-west-004",
        B2_BUCKET_NAME: "test",
        B2_KEY_ID: "test",
        B2_APPLICATION_KEY: "test",
        ...env,
      } as any,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("requires authentication — no session cookie means 401, before anything else runs", async () => {
  const { db } = createDb({ game: LIVE_GAME, version: LIVE_VERSION });
  const res = await app.request(
    "/api/games/ball-dodge/score",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) },
    { DB: db, GAME_SESSION_SECRET: SESSION_SECRET } as any,
  );
  assert.equal(res.status, 401);
});

test("fails closed (503) when GAME_SESSION_SECRET is not configured in this environment", async () => {
  const { db } = createDb({ game: LIVE_GAME, version: LIVE_VERSION });
  const res = await postScore(db, { token: "irrelevant", score: 1 }, {});
  assert.equal(res.status, 503);
});

test("a score-submission-blocked account is rejected with 403, before the token is even checked", async () => {
  const { db } = createDb({ scoreSubmissionBlocked: true, game: LIVE_GAME, version: LIVE_VERSION });
  const res = await postScore(db, { token: "irrelevant", score: 1 });
  assert.equal(res.status, 403);
});

test("a malformed request body is 400 INVALID_PAYLOAD", async () => {
  const { db } = createDb({ game: LIVE_GAME, version: LIVE_VERSION });
  const res = await postScore(db, { score: "not-a-number" });
  assert.equal(res.status, 400);
  const responseBody = (await res.json()) as { error: { code: string } };
  assert.equal(responseBody.error.code, "INVALID_PAYLOAD");
});

test("an unknown slug is 404 GAME_NOT_AVAILABLE", async () => {
  const { db } = createDb({});
  const token = await signGameSession(samplePayload(), SESSION_SECRET);
  const res = await app.request(
    "/api/games/no-such-game/score",
    { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ token, score: 10 }) },
    { DB: db, GAME_SESSION_SECRET: SESSION_SECRET } as any,
  );
  assert.equal(res.status, 404);
});

test("a tampered token is 401 INVALID_TOKEN", async () => {
  const { db } = createDb({ game: LIVE_GAME, version: LIVE_VERSION });
  const token = await signGameSession(samplePayload(), SESSION_SECRET);
  const tampered = tamperSignedToken(token);
  const res = await postScore(db, { token: tampered, score: 10 });
  assert.equal(res.status, 401);
  const responseBody = (await res.json()) as { error: { code: string } };
  assert.equal(responseBody.error.code, "INVALID_TOKEN");
});

test("a token issued to a different user is 401 CONTEXT_MISMATCH", async () => {
  const { db } = createDb({ userId: 7, game: LIVE_GAME, version: LIVE_VERSION });
  const token = await signGameSession(samplePayload({ userId: 999 }), SESSION_SECRET);
  const res = await postScore(db, { token, score: 10 });
  assert.equal(res.status, 401);
  const responseBody = (await res.json()) as { error: { code: string } };
  assert.equal(responseBody.error.code, "CONTEXT_MISMATCH");
});

test("a game with no score policy configured yet is 400 SCORE_POLICY_NOT_CONFIGURED", async () => {
  const unconfigured: FakeGame = {
    ...LIVE_GAME,
    score_unit: null,
    score_direction: null,
    score_min: null,
    score_max: null,
  };
  const { db } = createDb({ game: unconfigured, version: LIVE_VERSION });
  const token = await signGameSession(samplePayload(), SESSION_SECRET);
  const res = await postScore(db, { token, score: 10 });
  assert.equal(res.status, 400);
  const responseBody = (await res.json()) as { error: { code: string } };
  assert.equal(responseBody.error.code, "SCORE_POLICY_NOT_CONFIGURED");
});

test("a score outside the configured bounds is 400 INVALID_SCORE", async () => {
  const { db } = createDb({ game: LIVE_GAME, version: LIVE_VERSION });
  const token = await signGameSession(samplePayload(), SESSION_SECRET);
  const res = await postScore(db, { token, score: 999999 });
  assert.equal(res.status, 400);
  const responseBody = (await res.json()) as { error: { code: string } };
  assert.equal(responseBody.error.code, "INVALID_SCORE");
});

test("a valid token, matching context, and in-policy score is accepted and reaches the score write", async () => {
  const { db, scores } = createDb({ userId: 7, game: LIVE_GAME, version: LIVE_VERSION });
  const payload = samplePayload();
  const token = await signGameSession(payload, SESSION_SECRET);
  const res = await postScore(db, { token, score: 120 });

  assert.equal(res.status, 200);
  const responseBody = (await res.json()) as { success: true };
  assert.equal(responseBody.success, true);

  assert.equal(scores.length, 1);
  assert.equal(scores[0]?.gameSlug, "ball-dodge");
  assert.equal(scores[0]?.score, 120);
  assert.equal(scores[0]?.userId, 7);
});

test("a decimal score (e.g. ball-dodge's 4.4 seconds survived) is accepted end-to-end through the HTTP route", async () => {
  const { db, scores } = createDb({ userId: 7, game: LIVE_GAME, version: LIVE_VERSION });
  const token = await signGameSession(samplePayload(), SESSION_SECRET);
  const res = await postScore(db, { token, score: 4.4 });

  assert.equal(res.status, 200);
  assert.equal(scores.length, 1);
  assert.equal(scores[0]?.score, 4.4);
});

test("the same token presented twice is accepted once, then 409 ALREADY_CONSUMED — the token is not left half-spent", async () => {
  const { db, scores } = createDb({ userId: 7, game: LIVE_GAME, version: LIVE_VERSION });
  const token = await signGameSession(samplePayload(), SESSION_SECRET);

  const first = await postScore(db, { token, score: 120 });
  assert.equal(first.status, 200);

  // A different but still in-policy score — proves the replay is rejected on the attemptId
  // itself, not merely because this particular score value happened to be invalid.
  const second = await postScore(db, { token, score: 200 });
  assert.equal(second.status, 409);
  const responseBody = (await second.json()) as { error: { code: string } };
  assert.equal(responseBody.error.code, "ALREADY_CONSUMED");

  // The rejected replay must not have slipped a second (or different) score through.
  assert.equal(scores.length, 1);
  assert.equal(scores[0]?.score, 120);
});

test("is rate limited under the generic game-score-accept name when RATE_LIMITER is bound and rejects", async () => {
  const { db } = createDb({ game: LIVE_GAME, version: LIVE_VERSION });
  const keys: string[] = [];
  const res = await postScore(
    db,
    { token: "irrelevant", score: 1 },
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
  assert.ok(keys[0]?.startsWith("game-score-accept:"), "keyed under this route's own name prefix");
});

test("passes through when RATE_LIMITER is bound and allows the request", async () => {
  const { db, scores } = createDb({ userId: 7, game: LIVE_GAME, version: LIVE_VERSION });
  const token = await signGameSession(samplePayload(), SESSION_SECRET);
  const res = await postScore(
    db,
    { token, score: 120 },
    {
      GAME_SESSION_SECRET: SESSION_SECRET,
      RATE_LIMITER: { limit: async () => ({ success: true }) },
    },
  );
  assert.equal(res.status, 200);
  assert.equal(scores.length, 1);
});
