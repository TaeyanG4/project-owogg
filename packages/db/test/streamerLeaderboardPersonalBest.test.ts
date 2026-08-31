import test from "node:test";
import assert from "node:assert/strict";
import { D1StreamerRepository } from "../src/d1/D1StreamerRepository.js";
import { createSqliteD1, LEADERBOARD_TEST_SCHEMA } from "./helpers/sqliteD1.js";

function seedUser(raw: import("node:sqlite").DatabaseSync, nickname: string): number {
  const info = raw
    .prepare(
      `INSERT INTO users (nickname, created_at, updated_at) VALUES (?, datetime('now'), datetime('now'))`,
    )
    .run(nickname);
  return Number(info.lastInsertRowid);
}

function seedVerifiedStreamer(
  raw: import("node:sqlite").DatabaseSync,
  userId: number,
  platform: string,
  platformUserId: string,
): number {
  const now = new Date().toISOString();
  const info = raw
    .prepare(
      `INSERT INTO streamer_profiles (user_id, status, created_at, updated_at)
       VALUES (?, 'VERIFIED', ?, ?)`,
    )
    .run(userId, now, now);
  const streamerId = Number(info.lastInsertRowid);
  raw
    .prepare(
      `INSERT INTO streamer_platform_accounts
         (streamer_id, platform, platform_user_id, channel_name, channel_url,
          verification_status, approval_status, ownership_expires_at, created_at, updated_at)
       VALUES (?, ?, ?, 'ch', 'https://example.com', 'VERIFIED', 'APPROVED',
               '2030-01-01T00:00:00.000Z', ?, ?)`,
    )
    .run(streamerId, platform, platformUserId, now, now);
  return streamerId;
}

function seedScore(
  raw: import("node:sqlite").DatabaseSync,
  userId: number,
  gameId: string,
  score: number,
  rulesetRevision = 1,
): void {
  raw
    .prepare(
      `INSERT INTO scores
         (user_id, nickname, game_id, score, ruleset_revision, created_at)
       VALUES (?, 'p', ?, ?, ?, datetime('now'))`,
    )
    .run(userId, gameId, score, rulesetRevision);
}

test("Streamer score ranking: one Streamer's hundreds of scores never suppress others, and total is exact", async () => {
  const { db, raw } = createSqliteD1(LEADERBOARD_TEST_SCHEMA);
  const userA = seedUser(raw, "A");
  const userB = seedUser(raw, "B");
  const userC = seedUser(raw, "C");
  seedVerifiedStreamer(raw, userA, "YOUTUBE", "yt-a");
  seedVerifiedStreamer(raw, userB, "TWITCH", "tw-b");
  seedVerifiedStreamer(raw, userC, "YOUTUBE", "yt-c");

  for (let i = 0; i < 250; i++) {
    seedScore(raw, userA, "reaction-time", 1000 + i);
  }
  seedScore(raw, userB, "reaction-time", 500);
  seedScore(raw, userC, "reaction-time", 400);

  const repo = new D1StreamerRepository(db);
  const result = await repo.getStreamerRankings({
    mode: "score",
    gameId: "reaction-time",
    direction: "desc",
    limit: 20,
    offset: 0,
  });

  assert.equal(result.total, 3, "total counts eligible Streamer users, not raw rows");
  assert.equal(result.entries.length, 3);
  assert.deepEqual(
    result.entries.map((e) => e.userId),
    [userA, userB, userC],
  );
  assert.equal(result.entries[0]?.score, 1249); // true PB, not an arbitrary one of 250 rows
  assert.equal(result.entries[0]?.rank, 1);
  assert.equal(result.entries[2]?.rank, 3);
});

test("Streamer score ranking: platform filter uses EXISTS and does not duplicate rows", async () => {
  const { db, raw } = createSqliteD1(LEADERBOARD_TEST_SCHEMA);
  const userA = seedUser(raw, "A");
  seedVerifiedStreamer(raw, userA, "YOUTUBE", "yt-a");
  // A second, unrelated verified platform account for a different streamer so EXISTS has something to filter.
  const userB = seedUser(raw, "B");
  seedVerifiedStreamer(raw, userB, "TWITCH", "tw-b");

  seedScore(raw, userA, "reaction-time", 700);
  seedScore(raw, userB, "reaction-time", 900);

  const repo = new D1StreamerRepository(db);
  const result = await repo.getStreamerRankings({
    mode: "score",
    gameId: "reaction-time",
    platform: "YOUTUBE",
    direction: "desc",
    limit: 20,
    offset: 0,
  });

  assert.equal(result.total, 1);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0]?.userId, userA);
});

test("Streamer score ranking: pagination (offset/limit) applies to the deduplicated PB set", async () => {
  const { db, raw } = createSqliteD1(LEADERBOARD_TEST_SCHEMA);
  const ids: number[] = [];
  for (let i = 0; i < 5; i++) {
    const uid = seedUser(raw, `c${i}`);
    ids.push(uid);
    seedVerifiedStreamer(raw, uid, "YOUTUBE", `yt-${i}`);
    for (let j = 0; j < 20; j++) {
      seedScore(raw, uid, "reaction-time", (i + 1) * 100 + j);
    }
  }

  const repo = new D1StreamerRepository(db);
  const page1 = await repo.getStreamerRankings({
    mode: "score",
    gameId: "reaction-time",
    direction: "desc",
    limit: 2,
    offset: 0,
  });
  const page2 = await repo.getStreamerRankings({
    mode: "score",
    gameId: "reaction-time",
    direction: "desc",
    limit: 2,
    offset: 2,
  });

  assert.equal(page1.total, 5);
  assert.equal(page1.entries.length, 2);
  assert.equal(page2.entries.length, 2);
  const allUserIds = [...page1.entries, ...page2.entries].map((e) => e.userId);
  assert.equal(new Set(allUserIds).size, 4, "no overlap between pages");
  assert.equal(page1.entries[0]?.rank, 1);
  assert.equal(page2.entries[0]?.rank, 3);
});

test("Streamer score ranking: a selected game excludes scores from another ruleset revision", async () => {
  const { db, raw } = createSqliteD1(LEADERBOARD_TEST_SCHEMA);
  const userA = seedUser(raw, "A");
  const userB = seedUser(raw, "B");
  seedVerifiedStreamer(raw, userA, "YOUTUBE", "yt-a");
  seedVerifiedStreamer(raw, userB, "TWITCH", "tw-b");

  seedScore(raw, userA, "reaction-time", 700, 1);
  seedScore(raw, userA, "reaction-time", 9_999, 2);
  seedScore(raw, userB, "reaction-time", 800, 1);

  const repo = new D1StreamerRepository(db);
  const result = await repo.getStreamerRankings({
    mode: "score",
    gameId: "reaction-time",
    rulesetRevision: 1,
    direction: "desc",
    limit: 20,
    offset: 0,
  });

  assert.equal(result.total, 2);
  assert.deepEqual(
    result.entries.map((entry) => [entry.userId, entry.score]),
    [
      [userB, 800],
      [userA, 700],
    ],
  );
});
