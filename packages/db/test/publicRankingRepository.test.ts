import test from "node:test";
import assert from "node:assert/strict";
import { D1PublicRankingRepository } from "../src/d1/D1PublicRankingRepository.js";
import { createSqliteD1, LEADERBOARD_TEST_SCHEMA } from "./helpers/sqliteD1.js";

function seedUser(
  raw: import("node:sqlite").DatabaseSync,
  nickname: string,
  country: string | null = null,
): number {
  const result = raw
    .prepare(
      `INSERT INTO users (nickname, country, created_at, updated_at)
       VALUES (?, ?, '2026-01-01', '2026-01-01')`,
    )
    .run(nickname, country);
  return Number(result.lastInsertRowid);
}

function seedScore(
  raw: import("node:sqlite").DatabaseSync,
  userId: number,
  score: number,
  createdAt: string,
): void {
  raw
    .prepare(
      `INSERT INTO scores
         (user_id, nickname, game_id, score, difficulty, variant_id, ruleset_revision, created_at)
       VALUES (?, 'player', 'aim-test', ?, 'normal', 'standard', 2, ?)`,
    )
    .run(userId, score, createdAt);
}

function seedStreamer(
  raw: import("node:sqlite").DatabaseSync,
  userId: number,
  platform: "YOUTUBE" | "CHZZK" | "SOOP" | "TWITCH" = "YOUTUBE",
): number {
  const profile = raw
    .prepare(
      `INSERT INTO streamer_profiles
         (user_id, status, created_at, updated_at)
       VALUES (?, 'VERIFIED', '2026-01-01', '2026-01-01')`,
    )
    .run(userId);
  const streamerId = Number(profile.lastInsertRowid);
  raw
    .prepare(
      `INSERT INTO streamer_platform_accounts
         (streamer_id, platform, platform_user_id, channel_name, channel_url,
          verification_status, approval_status, ownership_expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'VERIFIED', 'APPROVED', '2030-01-01T00:00:00.000Z',
               '2026-01-01', '2026-01-01')`,
    )
    .run(
      streamerId,
      platform,
      `${platform}-${userId}`,
      `${platform} channel`,
      `https://example.com/${platform.toLowerCase()}/${userId}`,
    );
  return streamerId;
}

test("score ranking filters the period before choosing one PB per user", async () => {
  const { db, raw } = createSqliteD1(LEADERBOARD_TEST_SCHEMA);
  const first = seedUser(raw, "First", "KR");
  const second = seedUser(raw, "Second", null);
  seedScore(raw, first, 999, "2026-08-30T14:59:59.999Z"); // outside KST day
  seedScore(raw, first, 80, "2026-08-30T15:10:00.000Z");
  seedScore(raw, first, 100, "2026-08-30T15:20:00.000Z");
  seedScore(raw, second, 90, "2026-08-30T15:05:00.000Z");

  const rows = await new D1PublicRankingRepository(db).getScoreRanking({
    scope: "general",
    gameId: "aim-test",
    difficulty: "normal",
    rulesetRevision: 2,
    direction: "desc",
    startAt: "2026-08-30T15:00:00.000Z",
    endAt: "2026-08-31T15:00:00.000Z",
    limit: 20,
  });

  assert.deepEqual(
    rows.map((row) => ({ userId: row.userId, value: row.value, country: row.country })),
    [
      { userId: first, value: 100, country: "KR" },
      { userId: second, value: 90, country: null },
    ],
  );
  assert.equal(rows[0]?.achievedAt, "2026-08-30T15:20:00.000Z");
});

test("period XP sums positive ledger events and reports when the value was reached", async () => {
  const { db, raw } = createSqliteD1(LEADERBOARD_TEST_SCHEMA);
  const first = seedUser(raw, "First", "US");
  const second = seedUser(raw, "Second", "JP");
  const insert = raw.prepare(
    `INSERT INTO xp_events (user_id, amount, source_type, source_id, created_at)
     VALUES (?, ?, 'score', ?, ?)`,
  );
  insert.run(first, 10, "a", "2026-08-30T15:01:00.000Z");
  insert.run(first, 5, "b", "2026-08-30T15:03:00.000Z");
  insert.run(second, 20, "c", "2026-08-30T14:59:00.000Z");
  insert.run(second, 12, "d", "2026-08-30T15:02:00.000Z");
  insert.run(second, 0, "e", "2026-08-30T15:04:00.000Z");

  const rows = await new D1PublicRankingRepository(db).getXpRanking({
    scope: "general",
    startAt: "2026-08-30T15:00:00.000Z",
    endAt: "2026-08-31T15:00:00.000Z",
    limit: 20,
  });
  assert.deepEqual(
    rows.map((row) => [row.userId, row.value, row.achievedAt]),
    [
      [first, 15, "2026-08-30T15:03:00.000Z"],
      [second, 12, "2026-08-30T15:02:00.000Z"],
    ],
  );
});

test("streak ranking excludes lazily stale streaks and retains today or yesterday", async () => {
  const { db, raw } = createSqliteD1(LEADERBOARD_TEST_SCHEMA);
  const active = seedUser(raw, "Active");
  const pendingToday = seedUser(raw, "Yesterday");
  const stale = seedUser(raw, "Stale");
  raw
    .prepare(`UPDATE users SET current_streak = ?, last_active_date = ? WHERE id = ?`)
    .run(8, "2026-08-31", active);
  raw
    .prepare(`UPDATE users SET current_streak = ?, last_active_date = ? WHERE id = ?`)
    .run(12, "2026-08-30", pendingToday);
  raw
    .prepare(`UPDATE users SET current_streak = ?, last_active_date = ? WHERE id = ?`)
    .run(999, "2026-08-20", stale);

  const rows = await new D1PublicRankingRepository(db).getStreakRanking({
    scope: "general",
    activeDates: ["2026-08-31", "2026-08-30"],
    limit: 20,
  });
  assert.deepEqual(
    rows.map((row) => [row.userId, row.value]),
    [
      [pendingToday, 12],
      [active, 8],
    ],
  );
});

test("streamer scope applies ownership and platform filters while returning channel badges", async () => {
  const { db, raw } = createSqliteD1(LEADERBOARD_TEST_SCHEMA);
  const youtubeUser = seedUser(raw, "YouTube");
  const twitchUser = seedUser(raw, "Twitch");
  const regularUser = seedUser(raw, "Regular");
  const youtubeStreamerId = seedStreamer(raw, youtubeUser, "YOUTUBE");
  seedStreamer(raw, twitchUser, "TWITCH");
  seedScore(raw, youtubeUser, 100, "2026-08-30T16:00:00.000Z");
  seedScore(raw, twitchUser, 200, "2026-08-30T16:00:00.000Z");
  seedScore(raw, regularUser, 300, "2026-08-30T16:00:00.000Z");

  const rows = await new D1PublicRankingRepository(db).getScoreRanking({
    scope: "streamer",
    platform: "YOUTUBE",
    gameId: "aim-test",
    difficulty: "normal",
    rulesetRevision: 2,
    direction: "desc",
    startAt: "2026-08-30T15:00:00.000Z",
    endAt: "2026-08-31T15:00:00.000Z",
    limit: 20,
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.userId, youtubeUser);
  assert.equal(rows[0]?.streamerId, youtubeStreamerId);
  assert.deepEqual(
    rows[0]?.platformAccounts.map((account) => account.platform),
    ["YOUTUBE"],
  );
});

test("public streamer ranking excludes SOOP eligibility and channel badges", async () => {
  const { db, raw } = createSqliteD1(LEADERBOARD_TEST_SCHEMA);
  const visibleUser = seedUser(raw, "Visible");
  const hiddenUser = seedUser(raw, "Hidden SOOP");
  seedStreamer(raw, visibleUser, "CHZZK");
  seedStreamer(raw, hiddenUser, "SOOP");
  seedScore(raw, visibleUser, 100, "2026-08-30T16:00:00.000Z");
  seedScore(raw, hiddenUser, 999, "2026-08-30T16:00:00.000Z");

  const repository = new D1PublicRankingRepository(db);
  const all = await repository.getScoreRanking({
    scope: "streamer",
    gameId: "aim-test",
    difficulty: "normal",
    rulesetRevision: 2,
    direction: "desc",
    startAt: "2026-08-30T15:00:00.000Z",
    endAt: "2026-08-31T15:00:00.000Z",
    limit: 20,
  });
  const soop = await repository.getScoreRanking({
    scope: "streamer",
    platform: "SOOP",
    gameId: "aim-test",
    difficulty: "normal",
    rulesetRevision: 2,
    direction: "desc",
    startAt: "2026-08-30T15:00:00.000Z",
    endAt: "2026-08-31T15:00:00.000Z",
    limit: 20,
  });

  assert.deepEqual(
    all.map((row) => row.userId),
    [visibleUser],
  );
  assert.deepEqual(
    all[0]?.platformAccounts.map((account) => account.platform),
    ["CHZZK"],
  );
  assert.deepEqual(soop, []);
});

test("streamer scope uses the same XP and active-streak calculations as general rankings", async () => {
  const { db, raw } = createSqliteD1(LEADERBOARD_TEST_SCHEMA);
  const streamer = seedUser(raw, "Streamer", "KR");
  const otherPlatform = seedUser(raw, "Other platform", "US");
  const regular = seedUser(raw, "Regular", "JP");
  seedStreamer(raw, streamer, "YOUTUBE");
  seedStreamer(raw, otherPlatform, "TWITCH");

  const insertXp = raw.prepare(
    `INSERT INTO xp_events (user_id, amount, source_type, source_id, created_at)
     VALUES (?, ?, 'score', ?, ?)`,
  );
  insertXp.run(streamer, 30, "streamer-xp", "2026-08-30T16:00:00.000Z");
  insertXp.run(otherPlatform, 99, "other-xp", "2026-08-30T16:00:00.000Z");
  insertXp.run(regular, 999, "regular-xp", "2026-08-30T16:00:00.000Z");

  raw
    .prepare(`UPDATE users SET current_streak = ?, last_active_date = ? WHERE id = ?`)
    .run(7, "2026-08-31", streamer);
  raw
    .prepare(`UPDATE users SET current_streak = ?, last_active_date = ? WHERE id = ?`)
    .run(20, "2026-08-31", otherPlatform);
  raw
    .prepare(`UPDATE users SET current_streak = ?, last_active_date = ? WHERE id = ?`)
    .run(50, "2026-08-31", regular);

  const repository = new D1PublicRankingRepository(db);
  const xpRows = await repository.getXpRanking({
    scope: "streamer",
    platform: "YOUTUBE",
    startAt: "2026-08-30T15:00:00.000Z",
    endAt: "2026-08-31T15:00:00.000Z",
    limit: 20,
  });
  const streakRows = await repository.getStreakRanking({
    scope: "streamer",
    platform: "YOUTUBE",
    activeDates: ["2026-08-31", "2026-08-30"],
    limit: 20,
  });

  assert.deepEqual(
    xpRows.map((row) => [row.userId, row.value]),
    [[streamer, 30]],
  );
  assert.deepEqual(
    streakRows.map((row) => [row.userId, row.value]),
    [[streamer, 7]],
  );
});
