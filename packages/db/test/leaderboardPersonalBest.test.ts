import test from "node:test";
import assert from "node:assert/strict";
import { D1ScoreRepository } from "../src/d1/D1ScoreRepository.js";
import { createSqliteD1, LEADERBOARD_TEST_SCHEMA } from "./helpers/sqliteD1.js";

function seedUser(raw: import("node:sqlite").DatabaseSync, nickname: string): number {
  const info = raw
    .prepare(
      `INSERT INTO users (nickname, created_at, updated_at) VALUES (?, datetime('now'), datetime('now'))`,
    )
    .run(nickname);
  return Number(info.lastInsertRowid);
}

function seedScore(
  raw: import("node:sqlite").DatabaseSync,
  userId: number,
  gameId: string,
  score: number,
  createdAt = new Date().toISOString(),
): void {
  raw
    .prepare(
      `INSERT INTO scores (user_id, nickname, game_id, score, created_at) VALUES (?, 'p', ?, ?, ?)`,
    )
    .run(userId, gameId, score, createdAt);
}

test("descending leaderboard: one user's 150 raw rows never suppresses other users", async () => {
  const { db, raw } = createSqliteD1(LEADERBOARD_TEST_SCHEMA);
  const userA = seedUser(raw, "A");
  const userB = seedUser(raw, "B");
  const userC = seedUser(raw, "C");
  const userD = seedUser(raw, "D");
  const userE = seedUser(raw, "E");

  // User A dominates raw row volume with 150 high scores (900-1049), but their true PB is 1049.
  for (let i = 0; i < 150; i++) {
    seedScore(raw, userA, "reaction-time", 900 + i);
  }
  seedScore(raw, userB, "reaction-time", 500);
  seedScore(raw, userC, "reaction-time", 400);
  seedScore(raw, userD, "reaction-time", 300);
  seedScore(raw, userE, "reaction-time", 200);

  const repo = new D1ScoreRepository(db);
  const leaderboard = await repo.getLeaderboard("reaction-time", 20, "desc");

  const userIds = leaderboard.map((row) => row.user_id);
  assert.deepEqual(userIds, [userA, userB, userC, userD, userE]);
  assert.equal(leaderboard[0]?.score, 1049); // User A's true PB, not just any of their 150 rows
  assert.equal(new Set(userIds).size, userIds.length, "no duplicate users in leaderboard");
});

test("leaderboard scopes personal bests to the canonical ruleset revision before ranking", async () => {
  const { db, raw } = createSqliteD1(LEADERBOARD_TEST_SCHEMA);
  const userA = seedUser(raw, "A");
  const userB = seedUser(raw, "B");
  raw
    .prepare(
      `INSERT INTO scores
         (user_id, nickname, game_id, score, difficulty, variant_id, ruleset_revision, created_at)
       VALUES (?, 'A', 'revision-game', 9999, 'hard', 'legacy', 1, '2026-01-01'),
              (?, 'A', 'revision-game', 80, 'hard', 'precision', 3, '2026-01-02'),
              (?, 'B', 'revision-game', 90, 'hard', 'standard', 3, '2026-01-03')`,
    )
    .run(userA, userA, userB);
  const repo = new D1ScoreRepository(db);

  const rows = await repo.getLeaderboard("revision-game", 20, "desc", "hard", 3);
  assert.deepEqual(
    rows.map((row) => ({
      score: row.score,
      variant: row.variant_id,
      revision: row.ruleset_revision,
    })),
    [
      { score: 90, variant: "standard", revision: 3 },
      { score: 80, variant: "precision", revision: 3 },
    ],
  );
});

test("ascending leaderboard (lower-is-better games): PB is the minimum, not just an early row", async () => {
  const { db, raw } = createSqliteD1(LEADERBOARD_TEST_SCHEMA);
  const userA = seedUser(raw, "A");
  const userB = seedUser(raw, "B");

  for (let i = 0; i < 150; i++) {
    seedScore(raw, userA, "typing-test", 300 - i); // best (lowest) is 151
  }
  seedScore(raw, userB, "typing-test", 200);

  const repo = new D1ScoreRepository(db);
  const leaderboard = await repo.getLeaderboard("typing-test", 20, "asc");

  assert.equal(leaderboard[0]?.user_id, userA);
  assert.equal(leaderboard[0]?.score, 151);
  assert.equal(leaderboard[1]?.user_id, userB);
});

test("ties break deterministically by earliest created_at, then row id", async () => {
  const { db, raw } = createSqliteD1(LEADERBOARD_TEST_SCHEMA);
  const userA = seedUser(raw, "A");
  const userB = seedUser(raw, "B");

  seedScore(raw, userA, "aim-test", 100, "2026-01-01T00:00:05.000Z");
  seedScore(raw, userB, "aim-test", 100, "2026-01-01T00:00:01.000Z");

  const repo = new D1ScoreRepository(db);
  const leaderboard = await repo.getLeaderboard("aim-test", 20, "desc");

  assert.equal(leaderboard[0]?.user_id, userB); // earlier created_at wins the tie
  assert.equal(leaderboard[1]?.user_id, userA);
});

// ── decimal scores (fix/decimal-game-score-support) ────────────────────────────

test("decimal scores sort correctly in both directions — SQLite compares REAL/INTEGER by numeric value, not storage class", async () => {
  const { db, raw } = createSqliteD1(LEADERBOARD_TEST_SCHEMA);
  const userA = seedUser(raw, "A");
  const userB = seedUser(raw, "B");
  const userC = seedUser(raw, "C");

  seedScore(raw, userA, "ball-dodge", 4.4);
  seedScore(raw, userB, "ball-dodge", 4.35);
  seedScore(raw, userC, "ball-dodge", 5); // whole-number score in the same decimal-scored game

  const repo = new D1ScoreRepository(db);

  const desc = await repo.getLeaderboard("ball-dodge", 20, "desc");
  assert.deepEqual(
    desc.map((r) => r.user_id),
    [userC, userA, userB],
  );
  assert.deepEqual(
    desc.map((r) => r.score),
    [5, 4.4, 4.35],
  );

  const asc = await repo.getLeaderboard("ball-dodge", 20, "asc");
  assert.deepEqual(
    asc.map((r) => r.user_id),
    [userB, userA, userC],
  );
});

test("a user's decimal personal best is the correct MIN/MAX among several decimal attempts, not merely an early or late row", async () => {
  const { db, raw } = createSqliteD1(LEADERBOARD_TEST_SCHEMA);
  const userA = seedUser(raw, "A");
  seedScore(raw, userA, "ball-dodge", 4.4);
  seedScore(raw, userA, "ball-dodge", 12.75);
  seedScore(raw, userA, "ball-dodge", 8.1);

  const repo = new D1ScoreRepository(db);

  const desc = await repo.getLeaderboard("ball-dodge", 20, "desc"); // higher survival time is better
  assert.equal(desc[0]?.score, 12.75);

  const asc = await repo.getLeaderboard("ball-dodge", 20, "asc"); // lower-is-better variant
  assert.equal(asc[0]?.score, 4.4);
});

test("pagination limit is applied to the deduplicated PB set, not raw rows", async () => {
  const { db, raw } = createSqliteD1(LEADERBOARD_TEST_SCHEMA);
  const ids: number[] = [];
  for (let i = 0; i < 5; i++) {
    const uid = seedUser(raw, `user${i}`);
    ids.push(uid);
    // Each user has 10 raw rows; only their best should count.
    for (let j = 0; j < 10; j++) {
      seedScore(raw, uid, "memory-test", (i + 1) * 10 + j);
    }
  }

  const repo = new D1ScoreRepository(db);
  const leaderboard = await repo.getLeaderboard("memory-test", 3, "desc");

  assert.equal(leaderboard.length, 3);
  assert.equal(new Set(leaderboard.map((r) => r.user_id)).size, 3);
});

test("a live-version generation change resets leaderboard and personal bests without deleting history", async () => {
  const { db, raw } = createSqliteD1(LEADERBOARD_TEST_SCHEMA);
  const user = seedUser(raw, "player");
  seedScore(raw, user, "versioned-game", 999);
  raw.prepare("UPDATE games SET leaderboard_generation = 1 WHERE slug = 'versioned-game'").run();
  raw
    .prepare(
      `INSERT INTO scores
         (user_id, nickname, game_id, score, created_at, leaderboard_generation)
       VALUES (?, 'p', 'versioned-game', 10, ?, 1)`,
    )
    .run(user, new Date().toISOString());

  const repo = new D1ScoreRepository(db);
  const leaderboard = await repo.getLeaderboard("versioned-game", 20, "desc");
  assert.deepEqual(
    leaderboard.map((row) => row.score),
    [10],
  );
  const bests = await repo.getUserPersonalBests(user);
  assert.deepEqual(bests, [
    { game_id: "versioned-game", ruleset_revision: 1, min_score: 10, max_score: 10 },
  ]);
  assert.equal(
    raw.prepare("SELECT COUNT(*) AS count FROM scores WHERE game_id = 'versioned-game'").get()
      ?.count,
    2,
    "the previous generation remains as immutable history",
  );
});
