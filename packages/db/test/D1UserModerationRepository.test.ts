import test from "node:test";
import assert from "node:assert/strict";
import { D1UserModerationRepository } from "../src/d1/D1UserModerationRepository.js";
import { createSqliteD1, USER_MODERATION_TEST_SCHEMA } from "./helpers/sqliteD1.js";

function seedUser(raw: import("node:sqlite").DatabaseSync, id: number, nickname: string) {
  raw
    .prepare(`INSERT INTO users (id, nickname, email, created_at) VALUES (?, ?, ?, ?)`)
    .run(id, nickname, `${nickname}@example.com`, new Date().toISOString());
}

function seedScore(raw: import("node:sqlite").DatabaseSync, userId: number, gameId: string) {
  raw
    .prepare(
      `INSERT INTO scores (user_id, nickname, game_id, score, created_at) VALUES (?, 'p', ?, 100, ?)`,
    )
    .run(userId, gameId, new Date().toISOString());
}

const defaultOptions = { limit: 20, offset: 0 };

test("searchUsers matches nickname substring, email substring, or exact numeric id", async () => {
  const { db, raw } = createSqliteD1(USER_MODERATION_TEST_SCHEMA);
  seedUser(raw, 1, "SpeedRunner");
  seedUser(raw, 2, "OtherPlayer");
  const repo = new D1UserModerationRepository(db);

  assert.deepEqual(
    (await repo.searchUsers({ ...defaultOptions, query: "speed" })).users.map((u) => u.id),
    [1],
  );
  assert.deepEqual(
    (await repo.searchUsers({ ...defaultOptions, query: "otherplayer@example.com" })).users.map(
      (u) => u.id,
    ),
    [2],
  );
  assert.deepEqual(
    (await repo.searchUsers({ ...defaultOptions, query: "2" })).users.map((u) => u.id),
    [2],
  );
});

test("a never-moderated user reports ACTIVE with no row in getModeration", async () => {
  const { db, raw } = createSqliteD1(USER_MODERATION_TEST_SCHEMA);
  seedUser(raw, 1, "Clean");
  const repo = new D1UserModerationRepository(db);

  assert.equal(await repo.getModeration(1), null);
  const { users } = await repo.searchUsers({ ...defaultOptions, query: "Clean" });
  assert.equal(users[0]?.moderationStatus, "ACTIVE");
});

test("searchUsers with a blank query lists every user, most-recently-joined first by default", async () => {
  const { db, raw } = createSqliteD1(USER_MODERATION_TEST_SCHEMA);
  seedUser(raw, 1, "First");
  seedUser(raw, 2, "Second");
  const repo = new D1UserModerationRepository(db);

  const { users, total } = await repo.searchUsers(defaultOptions);
  assert.equal(total, 2);
  assert.deepEqual(
    users.map((u) => u.id),
    [2, 1],
  );
});

test("searchUsers sort=createdAt_asc returns earliest-joined first; limit/offset paginate", async () => {
  const { db, raw } = createSqliteD1(USER_MODERATION_TEST_SCHEMA);
  seedUser(raw, 1, "First");
  seedUser(raw, 2, "Second");
  seedUser(raw, 3, "Third");
  const repo = new D1UserModerationRepository(db);

  const ascending = await repo.searchUsers({ limit: 20, offset: 0, sort: "createdAt_asc" });
  assert.deepEqual(
    ascending.users.map((u) => u.id),
    [1, 2, 3],
  );

  const page = await repo.searchUsers({ limit: 1, offset: 1, sort: "createdAt_asc" });
  assert.equal(page.total, 3);
  assert.deepEqual(
    page.users.map((u) => u.id),
    [2],
  );
});

test("searchUsers period=today excludes users seeded with an earlier created_at", async () => {
  const { db, raw } = createSqliteD1(USER_MODERATION_TEST_SCHEMA);
  seedUser(raw, 1, "Old");
  raw
    .prepare(
      `INSERT INTO users (id, nickname, email, created_at) VALUES (2, 'New', 'new@example.com', ?)`,
    )
    .run(new Date().toISOString());
  raw.prepare(`UPDATE users SET created_at = '2000-01-01T00:00:00.000Z' WHERE id = 1`).run();
  const repo = new D1UserModerationRepository(db);

  const { users, total } = await repo.searchUsers({ ...defaultOptions, period: "today" });
  assert.equal(total, 1);
  assert.deepEqual(
    users.map((u) => u.id),
    [2],
  );
});

test("suspendUser sets status/suspendedUntil and writes a SUSPENDED audit entry", async () => {
  const { db, raw } = createSqliteD1(USER_MODERATION_TEST_SCHEMA);
  seedUser(raw, 1, "Cheater");
  const repo = new D1UserModerationRepository(db);
  const until = new Date(Date.now() + 86400000).toISOString();

  const record = await repo.suspendUser(1, 99, until, 7, "abuse report");
  assert.equal(record.status, "SUSPENDED");
  assert.equal(record.suspendedUntil, until);
  assert.equal(record.updatedByAdminId, 99);

  const audit = await repo.getAuditLog(1);
  assert.equal(audit.length, 1);
  assert.equal(audit[0]?.action, "SUSPENDED");
  assert.equal(audit[0]?.reason, "abuse report");
  assert.deepEqual(audit[0]?.metadata, { durationDays: 7, suspendedUntil: until });
});

test("expired temporary suspensions are projected as ACTIVE in detail and list results", async () => {
  const { db, raw } = createSqliteD1(USER_MODERATION_TEST_SCHEMA);
  seedUser(raw, 1, "Expired");
  raw
    .prepare(
      `INSERT INTO user_moderation
       (user_id, status, suspended_until, score_submission_blocked, reason, updated_at)
       VALUES (1, 'SUSPENDED', '2000-01-01T00:00:00.000Z', 0, 'old reason', ?)`,
    )
    .run(new Date().toISOString());
  const repo = new D1UserModerationRepository(db);

  const detail = await repo.getModeration(1);
  assert.equal(detail?.status, "ACTIVE");
  assert.equal(detail?.suspendedUntil, null);

  const { users } = await repo.searchUsers({ ...defaultOptions, query: "Expired" });
  assert.equal(users[0]?.moderationStatus, "ACTIVE");
  assert.equal(users[0]?.suspendedUntil, null);
});

test("banUser sets status=BANNED with no suspendedUntil", async () => {
  const { db, raw } = createSqliteD1(USER_MODERATION_TEST_SCHEMA);
  seedUser(raw, 1, "BadActor");
  const repo = new D1UserModerationRepository(db);

  const record = await repo.banUser(1, 99, "repeated cheating");
  assert.equal(record.status, "BANNED");
  assert.equal(record.suspendedUntil, null);

  const audit = await repo.getAuditLog(1);
  assert.equal(audit[0]?.action, "BANNED");
});

test("suspendUser and banUser preserve an independent score-submission block", async () => {
  const { db, raw } = createSqliteD1(USER_MODERATION_TEST_SCHEMA);
  seedUser(raw, 1, "Preserved");
  const repo = new D1UserModerationRepository(db);
  await repo.setScoreSubmissionBlocked(1, 99, true, "score abuse");

  const suspended = await repo.suspendUser(
    1,
    99,
    new Date(Date.now() + 7 * 86_400_000).toISOString(),
    7,
    "account abuse",
  );
  assert.equal(suspended.scoreSubmissionBlocked, true);

  const banned = await repo.banUser(1, 99, "repeated account abuse");
  assert.equal(banned.scoreSubmissionBlocked, true);
});

test("unsuspendUser clears status back to ACTIVE but preserves an independent score-submission block", async () => {
  const { db, raw } = createSqliteD1(USER_MODERATION_TEST_SCHEMA);
  seedUser(raw, 1, "Mixed");
  const repo = new D1UserModerationRepository(db);

  await repo.banUser(1, 99, "reason");
  await repo.setScoreSubmissionBlocked(1, 99, true, "leaderboard abuse");

  const record = await repo.unsuspendUser(1, 100);
  assert.equal(record.status, "ACTIVE");
  assert.equal(record.suspendedUntil, null);
  assert.equal(
    record.scoreSubmissionBlocked,
    true,
    "unsuspending must not silently clear an independently-set score block",
  );

  const audit = await repo.getAuditLog(1);
  assert.equal(audit[0]?.action, "UNSUSPENDED");
});

test("setScoreSubmissionBlocked toggles independently of moderation status", async () => {
  const { db, raw } = createSqliteD1(USER_MODERATION_TEST_SCHEMA);
  seedUser(raw, 1, "Toggled");
  const repo = new D1UserModerationRepository(db);

  const blocked = await repo.setScoreSubmissionBlocked(1, 99, true, "suspicious scores");
  assert.equal(blocked.status, "ACTIVE");
  assert.equal(blocked.scoreSubmissionBlocked, true);

  const unblocked = await repo.setScoreSubmissionBlocked(1, 99, false, null);
  assert.equal(unblocked.scoreSubmissionBlocked, false);

  const audit = await repo.getAuditLog(1);
  assert.deepEqual(audit.map((a) => a.action).reverse(), [
    "SCORE_SUBMISSION_BLOCKED",
    "SCORE_SUBMISSION_UNBLOCKED",
  ]);
});

test("resetUserScores soft-deletes every visible score and restoreUserScores undoes it", async () => {
  const { db, raw } = createSqliteD1(USER_MODERATION_TEST_SCHEMA);
  seedUser(raw, 1, "Reset");
  seedScore(raw, 1, "reaction-time");
  seedScore(raw, 1, "aim-test");
  const repo = new D1UserModerationRepository(db);

  const resetResult = await repo.resetUserScores(1, 99, "confirmed cheating");
  assert.equal(resetResult.affectedCount, 2);

  const visibleAfterReset = raw
    .prepare(`SELECT COUNT(*) as c FROM scores WHERE user_id = 1 AND deleted_at IS NULL`)
    .get() as { c: number };
  assert.equal(visibleAfterReset.c, 0);

  // Resetting again (nothing left to hit) must be a safe no-op, not double-count.
  const resetAgain = await repo.resetUserScores(1, 99, "double check");
  assert.equal(resetAgain.affectedCount, 0);

  const restoreResult = await repo.restoreUserScores(1, 99);
  assert.equal(restoreResult.restoredCount, 2);

  const visibleAfterRestore = raw
    .prepare(`SELECT COUNT(*) as c FROM scores WHERE user_id = 1 AND deleted_at IS NULL`)
    .get() as { c: number };
  assert.equal(visibleAfterRestore.c, 2);

  const audit = await repo.getAuditLog(1);
  assert.deepEqual(audit.map((a) => a.action).reverse(), [
    "SCORES_RESET",
    "SCORES_RESET",
    "SCORES_RESTORED",
  ]);
});

test("getAuditLog is scoped per-user and ordered most-recent-first", async () => {
  const { db, raw } = createSqliteD1(USER_MODERATION_TEST_SCHEMA);
  seedUser(raw, 1, "UserA");
  seedUser(raw, 2, "UserB");
  const repo = new D1UserModerationRepository(db);

  await repo.banUser(1, 99, "for user 1");
  await repo.banUser(2, 99, "for user 2");
  await repo.unsuspendUser(1, 99);

  const auditForUser1 = await repo.getAuditLog(1);
  assert.equal(auditForUser1.length, 2);
  assert.equal(auditForUser1[0]?.action, "UNSUSPENDED");
  assert.equal(auditForUser1[1]?.action, "BANNED");

  const auditForUser2 = await repo.getAuditLog(2);
  assert.equal(auditForUser2.length, 1);
});
