import test from "node:test";
import assert from "node:assert/strict";
import { D1GameResultAcceptanceRepository } from "../src/d1/D1GameResultAcceptanceRepository.js";
import { createSqliteD1 } from "./helpers/sqliteD1.js";

const SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE users (id INTEGER PRIMARY KEY, nickname TEXT NOT NULL);
CREATE TABLE games (id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE);
CREATE TABLE game_versions (
  id INTEGER PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE
);
CREATE TABLE game_attempt_consumptions (
  attempt_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  version_id INTEGER NOT NULL REFERENCES game_versions(id) ON DELETE CASCADE,
  consumed_at TEXT NOT NULL
);
CREATE TABLE game_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  version_id INTEGER NOT NULL REFERENCES game_versions(id) ON DELETE CASCADE,
  outcome TEXT,
  raw_score REAL,
  normalized_score REAL,
  progression_value REAL,
  metrics_json TEXT NOT NULL DEFAULT '{}',
  events_json TEXT NOT NULL DEFAULT '{}',
  difficulty TEXT NOT NULL DEFAULT 'normal',
  adjusted INTEGER NOT NULL DEFAULT 0,
  adjustment_reason TEXT,
  reward_eligible INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
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
  result_id INTEGER REFERENCES game_results(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX idx_scores_result_id ON scores(result_id) WHERE result_id IS NOT NULL;
`;

function result(overrides: Record<string, unknown> = {}) {
  return {
    outcome: "won",
    rawScore: 42.25,
    normalizedScore: 42.3,
    progressionValue: 3,
    metrics: { accuracy: 98 },
    events: { combo: 2 },
    adjusted: false,
    adjustmentReason: null,
    rewardEligible: true,
    ...overrides,
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    attemptId: "attempt-1",
    userId: 1,
    gameId: 9,
    versionId: 5,
    slug: "creator-game",
    nickname: "player",
    avatarUrl: null,
    difficulty: "normal",
    result: result(),
    leaderboardEnabled: true,
    nowIso: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function setup() {
  const context = createSqliteD1(SCHEMA);
  context.raw.prepare("INSERT INTO users (id, nickname) VALUES (1, 'player')").run();
  context.raw.prepare("INSERT INTO games (id, slug) VALUES (9, 'creator-game')").run();
  context.raw.prepare("INSERT INTO game_versions (id, game_id) VALUES (5, 9)").run();
  return context;
}

test("result acceptance atomically stores one result and its leaderboard projection", async () => {
  const { db, raw } = setup();
  const repo = new D1GameResultAcceptanceRepository(db);

  const first = await repo.acceptResult(input());
  assert.equal(first.accepted, true);
  assert.equal(typeof first.resultId, "number");
  assert.equal(typeof first.scoreId, "number");

  const replay = await repo.acceptResult(input({ result: result({ normalizedScore: 99 }) }));
  assert.deepEqual(replay, { accepted: false, resultId: null, scoreId: null });
  assert.equal(
    (raw.prepare("SELECT COUNT(*) AS count FROM game_results").get() as { count: number }).count,
    1,
  );
  const score = raw.prepare("SELECT score, result_id FROM scores").get() as {
    score: number;
    result_id: number;
  };
  assert.equal(score.score, 42.3);
  assert.equal(score.result_id, first.resultId);
});

test("scoreless or adjusted results remain in the ledger without a score projection", async () => {
  const { db, raw } = setup();
  const repo = new D1GameResultAcceptanceRepository(db);

  const scoreless = await repo.acceptResult(
    input({
      attemptId: "scoreless",
      result: result({ rawScore: null, normalizedScore: null }),
    }),
  );
  const adjusted = await repo.acceptResult(
    input({
      attemptId: "adjusted",
      result: result({ adjusted: true, rewardEligible: false, adjustmentReason: "clamped" }),
    }),
  );

  assert.equal(scoreless.accepted, true);
  assert.equal(scoreless.scoreId, null);
  assert.equal(adjusted.accepted, true);
  assert.equal(adjusted.scoreId, null);
  assert.equal(
    (raw.prepare("SELECT COUNT(*) AS count FROM game_results").get() as { count: number }).count,
    2,
  );
  assert.equal(
    (raw.prepare("SELECT COUNT(*) AS count FROM scores").get() as { count: number }).count,
    0,
  );
});
