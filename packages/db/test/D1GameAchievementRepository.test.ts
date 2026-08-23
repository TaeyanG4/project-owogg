import test from "node:test";
import assert from "node:assert/strict";
import { D1GameAchievementRepository } from "../src/d1/D1GameAchievementRepository.js";
import { createSqliteD1 } from "./helpers/sqliteD1.js";

const SCHEMA = `
CREATE TABLE game_results (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  game_id INTEGER NOT NULL,
  normalized_score REAL,
  progression_value REAL,
  metrics_json TEXT NOT NULL,
  events_json TEXT NOT NULL,
  reward_eligible INTEGER NOT NULL
);
CREATE TABLE user_game_achievements (
  user_id INTEGER NOT NULL,
  game_id INTEGER NOT NULL,
  achievement_id TEXT NOT NULL,
  unlocked_at TEXT NOT NULL,
  source_result_id INTEGER NOT NULL REFERENCES game_results(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, game_id, achievement_id)
);
`;

test("achievement storage aggregates declared facts and unlocks idempotently", async () => {
  const { db, raw } = createSqliteD1(SCHEMA);
  raw
    .prepare(
      `INSERT INTO game_results
       (id, user_id, game_id, normalized_score, progression_value, metrics_json, events_json, reward_eligible)
       VALUES (?, 1, 9, ?, ?, ?, ?, ?)`,
    )
    .run(1, 10, 2, JSON.stringify({ kills: 3 }), JSON.stringify({ boss: 1 }), 1);
  raw
    .prepare(
      `INSERT INTO game_results
       (id, user_id, game_id, normalized_score, progression_value, metrics_json, events_json, reward_eligible)
       VALUES (?, 1, 9, ?, ?, ?, ?, ?)`,
    )
    .run(2, 25, 4, JSON.stringify({ kills: 7 }), JSON.stringify({ boss: 2 }), 1);
  raw
    .prepare(
      `INSERT INTO game_results
       (id, user_id, game_id, normalized_score, progression_value, metrics_json, events_json, reward_eligible)
       VALUES (?, 1, 9, ?, ?, ?, ?, ?)`,
    )
    .run(3, 999, 99, JSON.stringify({ kills: 100 }), JSON.stringify({ boss: 100 }), 0);

  const repo = new D1GameAchievementRepository(db);
  assert.equal(
    await repo.aggregate({ userId: 1, gameId: 9, source: "score", aggregate: "max" }),
    25,
  );
  assert.equal(
    await repo.aggregate({
      userId: 1,
      gameId: 9,
      source: "metric",
      key: "kills",
      aggregate: "sum",
    }),
    10,
  );
  assert.equal(
    await repo.aggregate({
      userId: 1,
      gameId: 9,
      source: "event",
      key: "boss",
      aggregate: "count",
    }),
    3,
  );

  const input = {
    userId: 1,
    gameId: 9,
    achievementId: "boss-hunter",
    resultId: 2,
    unlockedAt: "2026-01-01T00:00:00.000Z",
  };
  assert.equal(await repo.unlock(input), true);
  assert.equal(await repo.unlock(input), false);
});
