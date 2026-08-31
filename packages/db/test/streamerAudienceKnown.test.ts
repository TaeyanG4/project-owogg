import test from "node:test";
import assert from "node:assert/strict";
import { D1StreamerRepository } from "../src/d1/D1StreamerRepository.js";
import { createSqliteD1, LEADERBOARD_TEST_SCHEMA } from "./helpers/sqliteD1.js";

// audience_count_known distinguishes "official API confirmed zero" from "value never
// obtained" — the previous behavior silently coerced both to 0, which is the exact bug this
// migration + repository change fixes.

async function seedStreamer(repo: D1StreamerRepository, userId: number) {
  const profile = await repo.upsertProfile({ userId, status: "VERIFIED" });
  return profile;
}

test("upsertPlatformAccount: omitted audienceCount persists as UNKNOWN (null), not 0", async () => {
  const { db } = createSqliteD1(LEADERBOARD_TEST_SCHEMA);
  const repo = new D1StreamerRepository(db);
  const profile = await seedStreamer(repo, 1);

  const account = await repo.upsertPlatformAccount({
    streamerId: profile.id,
    platform: "YOUTUBE",
    platformUserId: "UC1",
    channelName: "Ch",
    channelUrl: "https://youtube.com/UC1",
    verificationStatus: "VERIFIED",
    // audienceCount omitted entirely — provider snapshot had no value.
  });

  assert.equal(account.audienceCount, null);
});

test("upsertPlatformAccount: explicit audienceCount of 0 persists as a known zero", async () => {
  const { db } = createSqliteD1(LEADERBOARD_TEST_SCHEMA);
  const repo = new D1StreamerRepository(db);
  const profile = await seedStreamer(repo, 1);

  const account = await repo.upsertPlatformAccount({
    streamerId: profile.id,
    platform: "YOUTUBE",
    platformUserId: "UC1",
    channelName: "Ch",
    channelUrl: "https://youtube.com/UC1",
    verificationStatus: "VERIFIED",
    audienceCount: 0,
  });

  assert.equal(account.audienceCount, 0);
});

test("upsertPlatformAccount: explicit positive audienceCount persists correctly", async () => {
  const { db } = createSqliteD1(LEADERBOARD_TEST_SCHEMA);
  const repo = new D1StreamerRepository(db);
  const profile = await seedStreamer(repo, 1);

  const account = await repo.upsertPlatformAccount({
    streamerId: profile.id,
    platform: "YOUTUBE",
    platformUserId: "UC1",
    channelName: "Ch",
    channelUrl: "https://youtube.com/UC1",
    verificationStatus: "VERIFIED",
    audienceCount: 10_000,
  });

  assert.equal(account.audienceCount, 10_000);
});

test("a fresh re-verification snapshot with no audience value downgrades a previously-known value to UNKNOWN", async () => {
  const { db } = createSqliteD1(LEADERBOARD_TEST_SCHEMA);
  const repo = new D1StreamerRepository(db);
  const profile = await seedStreamer(repo, 1);

  await repo.upsertPlatformAccount({
    streamerId: profile.id,
    platform: "YOUTUBE",
    platformUserId: "UC1",
    channelName: "Ch",
    channelUrl: "https://youtube.com/UC1",
    verificationStatus: "VERIFIED",
    audienceCount: 12_000,
  });

  const reVerified = await repo.upsertPlatformAccount({
    streamerId: profile.id,
    platform: "YOUTUBE",
    platformUserId: "UC1",
    channelName: "Ch",
    channelUrl: "https://youtube.com/UC1",
    verificationStatus: "VERIFIED",
    // This fresh snapshot's provider response had no audience value this time.
  });

  assert.equal(reVerified.audienceCount, null);
});

test("ownership re-verification resets a non-rejected approval and recalculates the profile", async () => {
  const { db, raw } = createSqliteD1(LEADERBOARD_TEST_SCHEMA);
  const repo = new D1StreamerRepository(db);
  const profile = await seedStreamer(repo, 1);
  const account = await repo.upsertPlatformAccount({
    streamerId: profile.id,
    platform: "YOUTUBE",
    platformUserId: "UC-REVERIFY",
    channelName: "Approved channel",
    channelUrl: "https://youtube.com/channel/UC-REVERIFY",
    verificationStatus: "VERIFIED",
    ownershipExpiresAt: "2026-08-30T00:00:00.000Z",
  });
  raw
    .prepare(
      `UPDATE streamer_platform_accounts
       SET approval_status = 'APPROVED', approval_reason_code = 'MANUAL_APPROVAL',
           approved_at = '2026-08-01T00:00:00.000Z', approved_by_user_id = 9
       WHERE id = ?`,
    )
    .run(account.id);

  const reverified = await repo.upsertPlatformAccount({
    streamerId: profile.id,
    platform: "YOUTUBE",
    platformUserId: "UC-REVERIFY",
    channelName: "Approved channel",
    channelUrl: "https://youtube.com/channel/UC-REVERIFY",
    verificationStatus: "VERIFIED",
    ownershipExpiresAt: "2027-02-27T00:00:00.000Z",
    resetApprovalForOwnershipReview: true,
  });

  assert.equal(reverified.approvalStatus, "PENDING");
  assert.equal(reverified.approvalReasonCode, null);
  assert.equal(reverified.approvedAt, null);
  assert.equal(
    raw
      .prepare("SELECT approved_by_user_id FROM streamer_platform_accounts WHERE id = ?")
      .get(account.id)?.approved_by_user_id,
    null,
  );
  assert.equal((await repo.findProfileById(profile.id))?.status, "UNVERIFIED");
});

test("ownership re-verification preserves an explicit rejection", async () => {
  const { db, raw } = createSqliteD1(LEADERBOARD_TEST_SCHEMA);
  const repo = new D1StreamerRepository(db);
  const profile = await seedStreamer(repo, 1);
  const account = await repo.upsertPlatformAccount({
    streamerId: profile.id,
    platform: "YOUTUBE",
    platformUserId: "UC-REJECTED",
    channelName: "Rejected channel",
    channelUrl: "https://youtube.com/channel/UC-REJECTED",
    verificationStatus: "REJECTED",
  });
  raw
    .prepare(
      `UPDATE streamer_platform_accounts
       SET approval_status = 'REJECTED', approval_reason_code = 'MANUAL_REJECTION'
       WHERE id = ?`,
    )
    .run(account.id);

  const reverified = await repo.upsertPlatformAccount({
    streamerId: profile.id,
    platform: "YOUTUBE",
    platformUserId: "UC-REJECTED",
    channelName: "Rejected channel",
    channelUrl: "https://youtube.com/channel/UC-REJECTED",
    verificationStatus: "VERIFIED",
    ownershipExpiresAt: "2027-02-27T00:00:00.000Z",
    resetApprovalForOwnershipReview: true,
  });

  assert.equal(reverified.approvalStatus, "REJECTED");
  assert.equal(reverified.approvalReasonCode, "MANUAL_REJECTION");
});

test("upsertPlatformAccount never reassigns a canonical channel to another Streamer profile", async () => {
  const { db } = createSqliteD1(LEADERBOARD_TEST_SCHEMA);
  const repo = new D1StreamerRepository(db);
  const originalProfile = await seedStreamer(repo, 1);
  const otherProfile = await seedStreamer(repo, 2);
  const original = await repo.upsertPlatformAccount({
    streamerId: originalProfile.id,
    platform: "YOUTUBE",
    platformUserId: "UC-IMMUTABLE",
    channelName: "Original owner",
    channelUrl: "https://youtube.com/channel/UC-IMMUTABLE",
    verificationStatus: "VERIFIED",
  });

  const conflicting = await repo.upsertPlatformAccount({
    streamerId: otherProfile.id,
    platform: "YOUTUBE",
    platformUserId: "UC-IMMUTABLE",
    channelName: "Attempted takeover",
    channelUrl: "https://youtube.com/channel/UC-IMMUTABLE",
    verificationStatus: "VERIFIED",
  });

  assert.equal(conflicting.id, original.id);
  assert.equal(conflicting.streamerId, originalProfile.id);
  assert.equal(conflicting.channelName, "Original owner");
});

test("updatePlatformAccountMetrics: null audience marks the account UNKNOWN again", async () => {
  const { db } = createSqliteD1(LEADERBOARD_TEST_SCHEMA);
  const repo = new D1StreamerRepository(db);
  const profile = await seedStreamer(repo, 1);
  const account = await repo.upsertPlatformAccount({
    streamerId: profile.id,
    platform: "YOUTUBE",
    platformUserId: "UC1",
    channelName: "Ch",
    channelUrl: "https://youtube.com/UC1",
    verificationStatus: "VERIFIED",
    audienceCount: 9_000,
  });

  const refreshed = await repo.updatePlatformAccountMetrics(account.id, {
    audienceCount: null,
    channelCreatedAt: null,
    syncedAt: new Date().toISOString(),
  });
  assert.equal(refreshed.audienceCount, null);

  const repaired = await repo.updatePlatformAccountMetrics(account.id, {
    audienceCount: 13_000,
    channelCreatedAt: "2024-01-01T00:00:00.000Z",
    syncedAt: new Date().toISOString(),
  });
  assert.equal(repaired.audienceCount, 13_000);
});
