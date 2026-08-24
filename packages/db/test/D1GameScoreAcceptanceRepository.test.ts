import test from "node:test";
import assert from "node:assert/strict";
import { D1GameScoreAcceptanceRepository } from "../src/d1/D1GameScoreAcceptanceRepository.js";
import { createSqliteD1 } from "./helpers/sqliteD1.js";

const SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE users (id INTEGER PRIMARY KEY, nickname TEXT NOT NULL);
CREATE TABLE games (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  publisher_type TEXT NOT NULL,
  publisher_user_id INTEGER,
  visibility TEXT NOT NULL,
  live_version_id INTEGER,
  deleted_at TEXT,
  leaderboard_generation INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE game_versions (
  id INTEGER PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  bundle_bytes INTEGER NOT NULL,
  publish_status TEXT NOT NULL,
  uploaded_at TEXT NOT NULL
);
CREATE TABLE game_attempt_consumptions (
  attempt_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  version_id INTEGER NOT NULL REFERENCES game_versions(id) ON DELETE CASCADE,
  consumed_at TEXT NOT NULL
);
CREATE TABLE scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  nickname TEXT NOT NULL,
  avatar_url TEXT,
  game_id TEXT NOT NULL,
  score REAL NOT NULL,
  difficulty TEXT NOT NULL,
  created_at TEXT NOT NULL,
  leaderboard_generation INTEGER NOT NULL DEFAULT 0
);
`;

function input(overrides: Record<string, unknown> = {}) {
  return {
    attemptId: "attempt-1",
    userId: 1,
    gameId: 9,
    versionId: 5,
    slug: "reaction-time",
    nickname: "player",
    avatarUrl: null,
    score: 42.5,
    difficulty: "normal",
    nowIso: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function seed(raw: import("node:sqlite").DatabaseSync) {
  raw.prepare("INSERT INTO users (id, nickname) VALUES (1, 'player')").run();
  raw
    .prepare(
      "INSERT INTO games (id, slug, publisher_type, visibility, live_version_id, created_at, updated_at) VALUES (9, 'reaction-time', 'OWOGG', 'PUBLIC', 5, 'now', 'now')",
    )
    .run();
  raw
    .prepare(
      "INSERT INTO game_versions (id, game_id, object_key, content_hash, bundle_bytes, publish_status, uploaded_at) VALUES (5, 9, 'games/9/5/index.html', 'hash', 1, 'READY', 'now')",
    )
    .run();
}

test("generic acceptance returns the stable score id and rejects a replay atomically", async () => {
  const { db, raw } = createSqliteD1(SCHEMA);
  seed(raw);
  raw.prepare("UPDATE games SET leaderboard_generation = 3 WHERE id = 9").run();
  const repo = new D1GameScoreAcceptanceRepository(db);

  const first = await repo.acceptScore(input());
  assert.equal(first.accepted, true);
  assert.equal(typeof first.scoreId, "number");

  const second = await repo.acceptScore(input({ score: 99 }));
  assert.deepEqual(second, { accepted: false, scoreId: null });
  assert.equal(
    (raw.prepare("SELECT COUNT(*) AS count FROM scores").get() as { count: number }).count,
    1,
  );
  assert.equal(
    raw.prepare("SELECT leaderboard_generation FROM scores").get()?.leaderboard_generation,
    3,
  );
});

test("concurrent generic acceptance consumes one attempt exactly once", async () => {
  const { db, raw } = createSqliteD1(SCHEMA);
  seed(raw);
  const repo = new D1GameScoreAcceptanceRepository(db);
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, index) => repo.acceptScore(input({ score: index }))),
  );
  assert.equal(results.filter((result) => result.accepted).length, 1);
  assert.equal(
    (raw.prepare("SELECT COUNT(*) AS count FROM scores").get() as { count: number }).count,
    1,
  );
});
