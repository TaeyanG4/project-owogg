import test from "node:test";
import assert from "node:assert/strict";
import { D1ScoreRepository } from "../src/d1/D1ScoreRepository.js";
import { createSqliteD1, LEADERBOARD_TEST_SCHEMA } from "./helpers/sqliteD1.js";
import type { DatabaseSync } from "node:sqlite";

// Decimal score support (fix/decimal-game-score-support) — packages/core/src/domain/
// scoreValidation.ts no longer requires an integer, but that's only half the path: this file
// proves the actual write/read through D1's real SQL engine doesn't quietly truncate or round a
// fractional score like ball-dodge's 4.4 (seconds survived). `scores.score` is declared INTEGER
// in the schema, but SQLite's type affinity is advisory, not enforced — a REAL value that would
// lose precision as an INTEGER is stored as-is. No migration needed; see this file's own
// assertions on typeof(score) for the empirical proof, not just a stored-value equality check.

function seedUser(raw: DatabaseSync, nickname: string): number {
  const info = raw
    .prepare(
      `INSERT INTO users (nickname, created_at, updated_at) VALUES (?, datetime('now'), datetime('now'))`,
    )
    .run(nickname);
  return Number(info.lastInsertRowid);
}

test("saveScore persists a decimal score (4.4) without truncation or rounding", async () => {
  const { db, raw } = createSqliteD1(LEADERBOARD_TEST_SCHEMA);
  const userId = seedUser(raw, "player");
  const repo = new D1ScoreRepository(db);

  const saved = await repo.saveScore({
    userId,
    nickname: "player",
    gameId: "ball-dodge",
    score: 4.4,
    difficulty: "normal",
  });

  assert.equal(saved.score, 4.4);

  // Read back through raw SQLite directly (not the repository's own mapping) — proves the value
  // that actually landed in storage is 4.4, not something D1ScoreRepository merely echoed back
  // from the input it was given.
  const row = raw
    .prepare(`SELECT score, typeof(score) as t FROM scores WHERE id = ?`)
    .get(saved.id) as {
    score: number;
    t: string;
  };
  assert.equal(row.score, 4.4);
  assert.equal(
    row.t,
    "real",
    "a fractional value stored in an INTEGER-affinity column is kept as REAL, not silently rounded to an integer",
  );
});

test("saveScore still stores a whole-number score as an integer — decimal support doesn't change existing SYSTEM game behavior", async () => {
  const { db, raw } = createSqliteD1(LEADERBOARD_TEST_SCHEMA);
  const userId = seedUser(raw, "player");
  const repo = new D1ScoreRepository(db);

  const saved = await repo.saveScore({
    userId,
    nickname: "player",
    gameId: "reaction-time",
    score: 250,
    difficulty: "normal",
  });

  assert.equal(saved.score, 250);
  const row = raw
    .prepare(`SELECT score, typeof(score) as t FROM scores WHERE id = ?`)
    .get(saved.id) as {
    score: number;
    t: string;
  };
  assert.equal(row.score, 250);
  assert.equal(row.t, "integer");
});

test("getLeaderboard returns a saved decimal score exactly, through the full save -> query round trip", async () => {
  const { db, raw } = createSqliteD1(LEADERBOARD_TEST_SCHEMA);
  const userId = seedUser(raw, "player");
  const repo = new D1ScoreRepository(db);

  await repo.saveScore({
    userId,
    nickname: "player",
    gameId: "ball-dodge",
    score: 4.4,
    difficulty: "normal",
  });

  const leaderboard = await repo.getLeaderboard("ball-dodge", 20, "desc");
  assert.equal(leaderboard.length, 1);
  assert.equal(leaderboard[0]?.score, 4.4);
});

test("leaderboard reads the current alias and selected avatar instead of the score snapshot", async () => {
  const { db, raw } = createSqliteD1(LEADERBOARD_TEST_SCHEMA);
  const userId = seedUser(raw, "OldAlias");
  const repo = new D1ScoreRepository(db);
  await repo.saveScore({
    userId,
    nickname: "OldAlias",
    avatarUrl: "https://old.example/avatar.png",
    gameId: "reaction-time",
    score: 250,
    difficulty: "normal",
  });

  raw
    .prepare("UPDATE users SET nickname = ?, avatar_url = ? WHERE id = ?")
    .run("Taeyang", "https://discord.example/avatar.png", userId);

  const leaderboard = await repo.getLeaderboard("reaction-time", 20, "asc");
  assert.equal(leaderboard[0]?.nickname, "Taeyang");
  assert.equal(leaderboard[0]?.avatar_url, "https://discord.example/avatar.png");
});
