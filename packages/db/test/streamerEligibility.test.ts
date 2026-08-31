import test from "node:test";
import assert from "node:assert/strict";
import { D1StreamerRepository } from "../src/d1/D1StreamerRepository.js";
import { createSqliteD1, LEADERBOARD_TEST_SCHEMA } from "./helpers/sqliteD1.js";

// A user appears in Streamer rankings only after at least one platform has both valid ownership
// and its own staff approval. Other platforms remain independent.

function seedUser(raw: import("node:sqlite").DatabaseSync, nickname: string): number {
  const info = raw
    .prepare(
      `INSERT INTO users (nickname, created_at, updated_at) VALUES (?, datetime('now'), datetime('now'))`,
    )
    .run(nickname);
  return Number(info.lastInsertRowid);
}

/** Creates a streamer_profiles row with the given `status` (defaults to VERIFIED) and zero
 * platform accounts — the caller adds accounts separately via `addPlatformAccount`. */
function seedStreamerProfile(
  raw: import("node:sqlite").DatabaseSync,
  userId: number,
  status: "VERIFIED" | "UNVERIFIED" | "SUSPENDED" = "VERIFIED",
): number {
  const now = new Date().toISOString();
  const info = raw
    .prepare(
      `INSERT INTO streamer_profiles (user_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(userId, status, now, now);
  return Number(info.lastInsertRowid);
}

test("an expired program suspension restores effective profile and ranking eligibility", async () => {
  const { db, raw } = createSqliteD1(LEADERBOARD_TEST_SCHEMA);
  const expiredUserId = seedUser(raw, "expired-suspension");
  const expiredStreamerId = seedStreamerProfile(raw, expiredUserId, "SUSPENDED");
  addPlatformAccount(raw, expiredStreamerId, "YOUTUBE", "yt-expired-suspension");
  raw
    .prepare("UPDATE streamer_profiles SET suspended_until = ? WHERE id = ?")
    .run("2020-01-01T00:00:00.000Z", expiredStreamerId);
  seedScore(raw, expiredUserId, 700);
  seedXp(raw, expiredUserId, 700);

  const activeUserId = seedUser(raw, "active-suspension");
  const activeStreamerId = seedStreamerProfile(raw, activeUserId, "SUSPENDED");
  addPlatformAccount(raw, activeStreamerId, "TWITCH", "tw-active-suspension");
  raw
    .prepare("UPDATE streamer_profiles SET suspended_until = ? WHERE id = ?")
    .run("2030-01-01T00:00:00.000Z", activeStreamerId);
  seedScore(raw, activeUserId, 900);
  seedXp(raw, activeUserId, 900);

  const indefiniteUserId = seedUser(raw, "indefinite-suspension");
  const indefiniteStreamerId = seedStreamerProfile(raw, indefiniteUserId, "SUSPENDED");
  addPlatformAccount(raw, indefiniteStreamerId, "CHZZK", "cz-indefinite-suspension");
  seedScore(raw, indefiniteUserId, 1_000);
  seedXp(raw, indefiniteUserId, 1_000);

  const repo = new D1StreamerRepository(db);
  const [expiredProfile, activeProfile, scoreRanking, xpRanking] = await Promise.all([
    repo.findProfileByUserId(expiredUserId),
    repo.findProfileByUserId(activeUserId),
    repo.getStreamerRankings({ mode: "score", gameId: "reaction-time" }),
    repo.getStreamerRankings({ mode: "xp" }),
  ]);

  assert.equal(expiredProfile?.status, "VERIFIED");
  assert.equal(expiredProfile?.suspendedUntil, null);
  assert.equal(activeProfile?.status, "SUSPENDED");
  assert.equal(activeProfile?.suspendedUntil, "2030-01-01T00:00:00.000Z");
  assert.deepEqual(
    scoreRanking.entries.map((entry) => entry.userId),
    [expiredUserId],
  );
  assert.deepEqual(
    xpRanking.entries.map((entry) => entry.userId),
    [expiredUserId],
  );
});

function addPlatformAccount(
  raw: import("node:sqlite").DatabaseSync,
  streamerId: number,
  platform: string,
  platformUserId: string,
  verificationStatus: "VERIFIED" | "PENDING" | "UNVERIFIED" = "VERIFIED",
): void {
  const now = new Date().toISOString();
  raw
    .prepare(
      `INSERT INTO streamer_platform_accounts
         (streamer_id, platform, platform_user_id, channel_name, channel_url,
          verification_status, approval_status, ownership_expires_at, created_at, updated_at)
       VALUES (?, ?, ?, 'ch', ?, ?, ?, '2030-01-01T00:00:00.000Z', ?, ?)`,
    )
    .run(
      streamerId,
      platform,
      platformUserId,
      `https://example.com/${platform}`,
      verificationStatus,
      verificationStatus === "VERIFIED" ? "APPROVED" : "PENDING",
      now,
      now,
    );
}

function seedScore(raw: import("node:sqlite").DatabaseSync, userId: number, score: number): void {
  raw
    .prepare(
      `INSERT INTO scores (user_id, nickname, game_id, score, created_at) VALUES (?, 'p', 'reaction-time', ?, datetime('now'))`,
    )
    .run(userId, score);
}

function seedXp(raw: import("node:sqlite").DatabaseSync, userId: number, totalXp: number): void {
  raw
    .prepare(
      `INSERT INTO user_progress (user_id, total_xp, eligible_completions, updated_at) VALUES (?, ?, 0, datetime('now'))`,
    )
    .run(userId, totalXp);
}

for (const platform of ["YOUTUBE", "CHZZK", "TWITCH"] as const) {
  test(`streamer ranking (score mode): ${platform}-only verified is included`, async () => {
    const { db, raw } = createSqliteD1(LEADERBOARD_TEST_SCHEMA);
    const userId = seedUser(raw, "solo");
    const streamerId = seedStreamerProfile(raw, userId);
    addPlatformAccount(raw, streamerId, platform, "id-1", "VERIFIED");
    seedScore(raw, userId, 500);

    const repo = new D1StreamerRepository(db);
    const result = await repo.getStreamerRankings({ mode: "score", gameId: "reaction-time" });
    assert.equal(result.total, 1);
    assert.equal(result.entries[0]?.userId, userId);
  });
}

test("streamer ranking excludes a SOOP-only profile, including a direct SOOP filter", async () => {
  const { db, raw } = createSqliteD1(LEADERBOARD_TEST_SCHEMA);
  const userId = seedUser(raw, "hidden-soop");
  const streamerId = seedStreamerProfile(raw, userId);
  addPlatformAccount(raw, streamerId, "SOOP", "sp-only", "VERIFIED");
  seedScore(raw, userId, 900);

  const repo = new D1StreamerRepository(db);
  const all = await repo.getStreamerRankings({ mode: "score", gameId: "reaction-time" });
  const soop = await repo.getStreamerRankings({
    mode: "score",
    gameId: "reaction-time",
    platform: "SOOP",
  });
  assert.equal(all.total, 0);
  assert.equal(soop.total, 0);
});

test("a profile with all stored platforms produces one row with only public platform badges", async () => {
  const { db, raw } = createSqliteD1(LEADERBOARD_TEST_SCHEMA);
  const userId = seedUser(raw, "multi");
  const streamerId = seedStreamerProfile(raw, userId);
  addPlatformAccount(raw, streamerId, "YOUTUBE", "yt-1", "VERIFIED");
  addPlatformAccount(raw, streamerId, "CHZZK", "cz-1", "VERIFIED");
  addPlatformAccount(raw, streamerId, "SOOP", "sp-1", "VERIFIED");
  addPlatformAccount(raw, streamerId, "TWITCH", "tw-1", "VERIFIED");
  seedScore(raw, userId, 800);

  const repo = new D1StreamerRepository(db);
  const result = await repo.getStreamerRankings({ mode: "score", gameId: "reaction-time" });
  assert.equal(result.total, 1);
  assert.equal(result.entries.length, 1);
  assert.deepEqual(
    result.entries[0]?.platformAccounts.map((account) => account.platform),
    ["YOUTUBE", "CHZZK", "TWITCH"],
  );
});

test("streamer ranking (score mode): zero verified platforms excludes the streamer even with a score", async () => {
  const { db, raw } = createSqliteD1(LEADERBOARD_TEST_SCHEMA);
  const userId = seedUser(raw, "nobody");
  seedStreamerProfile(raw, userId, "UNVERIFIED");
  seedScore(raw, userId, 900);

  const repo = new D1StreamerRepository(db);
  const result = await repo.getStreamerRankings({ mode: "score", gameId: "reaction-time" });
  assert.equal(result.total, 0);
  assert.equal(result.entries.length, 0);
});

test("streamer ranking (score mode): streamer_profiles.status=VERIFIED but zero VERIFIED platform accounts is still excluded (stale-status defense)", async () => {
  const { db, raw } = createSqliteD1(LEADERBOARD_TEST_SCHEMA);
  const userId = seedUser(raw, "stale");
  // Profile says VERIFIED, but the only platform account is still PENDING — this must never be
  // trusted on its own.
  const streamerId = seedStreamerProfile(raw, userId, "VERIFIED");
  addPlatformAccount(raw, streamerId, "YOUTUBE", "yt-pending", "PENDING");
  seedScore(raw, userId, 1000);

  const repo = new D1StreamerRepository(db);
  const result = await repo.getStreamerRankings({ mode: "score", gameId: "reaction-time" });
  assert.equal(result.total, 0);
  assert.equal(result.entries.length, 0);
});

for (const ownershipExpiry of [null, "2020-01-01T00:00:00.000Z"] as const) {
  test(`streamer ranking: approved ownership with ${ownershipExpiry === null ? "no" : "an expired"} expiry is excluded`, async () => {
    const { db, raw } = createSqliteD1(LEADERBOARD_TEST_SCHEMA);
    const userId = seedUser(raw, ownershipExpiry === null ? "missing-expiry" : "expired");
    const streamerId = seedStreamerProfile(raw, userId);
    addPlatformAccount(raw, streamerId, "YOUTUBE", "yt-invalid-expiry", "VERIFIED");
    raw
      .prepare(
        "UPDATE streamer_platform_accounts SET ownership_expires_at = ? WHERE streamer_id = ?",
      )
      .run(ownershipExpiry, streamerId);
    seedScore(raw, userId, 550);

    const repo = new D1StreamerRepository(db);
    const result = await repo.getStreamerRankings({ mode: "score", gameId: "reaction-time" });
    const profile = await repo.findProfileByUserId(userId);
    assert.equal(result.total, 0);
    assert.equal(result.entries.length, 0);
    assert.equal(profile?.status, "UNVERIFIED");
  });
}

test("current platform approval repairs a stale aggregate profile status at read time", async () => {
  const { db, raw } = createSqliteD1(LEADERBOARD_TEST_SCHEMA);
  const userId = seedUser(raw, "stale-aggregate");
  const streamerId = seedStreamerProfile(raw, userId, "UNVERIFIED");
  addPlatformAccount(raw, streamerId, "YOUTUBE", "yt-stale-aggregate", "VERIFIED");
  seedScore(raw, userId, 650);

  const repo = new D1StreamerRepository(db);
  const [profile, ranking] = await Promise.all([
    repo.findProfileByUserId(userId),
    repo.getStreamerRankings({ mode: "score", gameId: "reaction-time" }),
  ]);
  assert.equal(profile?.status, "VERIFIED");
  assert.deepEqual(
    ranking.entries.map((entry) => entry.userId),
    [userId],
  );
});

test("streamer ranking: one verified + one pending account exposes only the verified platform badge", async () => {
  const { db, raw } = createSqliteD1(LEADERBOARD_TEST_SCHEMA);
  const userId = seedUser(raw, "partial");
  const streamerId = seedStreamerProfile(raw, userId);
  addPlatformAccount(raw, streamerId, "YOUTUBE", "yt-1", "VERIFIED");
  addPlatformAccount(raw, streamerId, "TWITCH", "tw-pending", "PENDING");
  seedScore(raw, userId, 600);

  const repo = new D1StreamerRepository(db);
  const result = await repo.getStreamerRankings({ mode: "score", gameId: "reaction-time" });
  assert.equal(result.total, 1);
  assert.deepEqual(
    result.entries[0]?.platformAccounts.map((a) => a.platform),
    ["YOUTUBE"],
  );
});

test("streamer ranking: platform filters are mutually exclusive and never duplicate a multi-platform streamer", async () => {
  const { db, raw } = createSqliteD1(LEADERBOARD_TEST_SCHEMA);
  const userId = seedUser(raw, "yt-and-twitch");
  const streamerId = seedStreamerProfile(raw, userId);
  addPlatformAccount(raw, streamerId, "YOUTUBE", "yt-1", "VERIFIED");
  addPlatformAccount(raw, streamerId, "TWITCH", "tw-1", "VERIFIED");
  seedScore(raw, userId, 700);

  const repo = new D1StreamerRepository(db);
  const all = await repo.getStreamerRankings({ mode: "score", gameId: "reaction-time" });
  const yt = await repo.getStreamerRankings({
    mode: "score",
    gameId: "reaction-time",
    platform: "YOUTUBE",
  });
  const twitch = await repo.getStreamerRankings({
    mode: "score",
    gameId: "reaction-time",
    platform: "TWITCH",
  });
  const chzzk = await repo.getStreamerRankings({
    mode: "score",
    gameId: "reaction-time",
    platform: "CHZZK",
  });

  assert.equal(all.total, 1, "appears exactly once under ALL");
  assert.equal(yt.total, 1, "appears once under YOUTUBE");
  assert.equal(twitch.total, 1, "appears once under TWITCH");
  assert.equal(chzzk.total, 0, "does not appear under an unverified platform");
});

test("streamer ranking (xp mode): same eligibility rule applies — zero verified platforms excluded, one verified included", async () => {
  const { db, raw } = createSqliteD1(LEADERBOARD_TEST_SCHEMA);
  const eligibleUser = seedUser(raw, "eligible");
  const eligibleStreamerId = seedStreamerProfile(raw, eligibleUser);
  addPlatformAccount(raw, eligibleStreamerId, "CHZZK", "cz-1", "VERIFIED");
  seedXp(raw, eligibleUser, 5000);

  const ineligibleUser = seedUser(raw, "ineligible");
  seedStreamerProfile(raw, ineligibleUser, "UNVERIFIED");
  seedXp(raw, ineligibleUser, 9000); // higher XP but not a verified streamer

  const repo = new D1StreamerRepository(db);
  const result = await repo.getStreamerRankings({ mode: "xp" });
  assert.equal(result.total, 1);
  assert.equal(result.entries[0]?.userId, eligibleUser);
});

test("streamer ranking preserves the canonical score after platform approval", async () => {
  const { db, raw } = createSqliteD1(LEADERBOARD_TEST_SCHEMA);
  const userId = seedUser(raw, "approved-streamer");
  const streamerId = seedStreamerProfile(raw, userId);
  addPlatformAccount(raw, streamerId, "YOUTUBE", "yt-1", "VERIFIED");
  seedScore(raw, userId, 321);

  const repo = new D1StreamerRepository(db);
  const result = await repo.getStreamerRankings({ mode: "score", gameId: "reaction-time" });
  assert.equal(result.entries[0]?.score, 321);
});
