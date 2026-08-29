import assert from "node:assert/strict";
import test from "node:test";
import { D1ProgressionRepository } from "../src/d1/D1ProgressionRepository.js";
import { createSqliteD1 } from "./helpers/sqliteD1.js";

const SCHEMA = `
CREATE TABLE xp_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  game_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(source_type, source_id)
);
CREATE INDEX idx_xp_events_user_game_created
  ON xp_events(user_id, game_id, created_at);
CREATE TABLE user_progress (
  user_id INTEGER PRIMARY KEY,
  total_xp INTEGER NOT NULL DEFAULT 0,
  eligible_completions INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
`;

function completion(sourceId: string) {
  return {
    userId: 1,
    gameId: "multiplayer-relay-demo",
    sourceType: "multiplayer_match",
    sourceId,
    xpPerCompletion: 10,
    dailyCapPerGame: 1,
  };
}

test("progression event and aggregate roll back together on aggregate failure", async () => {
  const { db, raw } = createSqliteD1(SCHEMA);
  raw.exec(`
    CREATE TRIGGER fail_progress_insert
    BEFORE INSERT ON user_progress
    FOR EACH ROW
    BEGIN
      SELECT RAISE(ABORT, 'injected aggregate failure');
    END;
  `);
  const repository = new D1ProgressionRepository(db);

  await assert.rejects(
    () => repository.recordGameCompletion(completion("match-failure:1")),
    /injected aggregate failure/,
  );
  assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM xp_events").get()?.count, 0);
  assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM user_progress").get()?.count, 0);
});

test("concurrent distinct completions serialize the daily cap inside the write transaction", async () => {
  const { db, raw } = createSqliteD1(SCHEMA);
  const repository = new D1ProgressionRepository(db);

  const outcomes = await Promise.all([
    repository.recordGameCompletion(completion("match-a:1")),
    repository.recordGameCompletion(completion("match-b:1")),
  ]);
  assert.equal(
    outcomes.reduce((total, outcome) => total + outcome.xpAwarded, 0),
    10,
  );
  assert.deepEqual(
    {
      ...raw
        .prepare("SELECT total_xp, eligible_completions FROM user_progress WHERE user_id = 1")
        .get(),
    },
    { total_xp: 10, eligible_completions: 2 },
  );
  assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM xp_events").get()?.count, 2);
});

test("concurrent replay inserts one event and advances the aggregate exactly once", async () => {
  const { db, raw } = createSqliteD1(SCHEMA);
  const repository = new D1ProgressionRepository(db);

  const outcomes = await Promise.all([
    repository.recordGameCompletion(completion("same-match:1")),
    repository.recordGameCompletion(completion("same-match:1")),
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.duplicate).length, 1);
  assert.equal(
    outcomes.reduce((total, outcome) => total + outcome.xpAwarded, 0),
    10,
  );
  assert.deepEqual(
    {
      ...raw
        .prepare("SELECT total_xp, eligible_completions FROM user_progress WHERE user_id = 1")
        .get(),
    },
    { total_xp: 10, eligible_completions: 1 },
  );
  assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM xp_events").get()?.count, 1);
});
