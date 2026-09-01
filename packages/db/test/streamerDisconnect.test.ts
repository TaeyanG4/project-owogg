import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { D1StreamerRepository } from "../src/d1/D1StreamerRepository.js";
import { createSqliteD1 } from "./helpers/sqliteD1.js";

function migratedDb() {
  const result = createSqliteD1("PRAGMA foreign_keys = ON;");
  const migrationUrl = new URL("../migrations/", import.meta.url);
  for (const filename of fs
    .readdirSync(migrationUrl)
    .filter((value) => value.endsWith(".sql"))
    .sort()) {
    result.raw.exec(fs.readFileSync(new URL(filename, migrationUrl), "utf8"));
  }
  return result;
}

test("self disconnect archives review evidence, preserves scores, and releases the provider identity", async () => {
  const { db, raw } = migratedDb();
  raw.prepare("INSERT INTO users (id, nickname) VALUES (7, 'streamer')").run();
  raw
    .prepare(
      `INSERT INTO games
         (slug, publisher_type, visibility, live_version_id, created_at, updated_at)
       VALUES ('reaction-time', 'OWOGG', 'PRIVATE', NULL, ?, ?)`,
    )
    .run("2026-08-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z");
  raw
    .prepare(
      `INSERT INTO scores (user_id, nickname, game_id, score, created_at)
       VALUES (7, 'streamer', 'reaction-time', 777, '2026-08-31T00:00:00.000Z')`,
    )
    .run();
  const profileInfo = raw
    .prepare(
      `INSERT INTO streamer_profiles (user_id, status, created_at, updated_at)
       VALUES (7, 'VERIFIED', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`,
    )
    .run();
  const streamerId = Number(profileInfo.lastInsertRowid);
  const accountInfo = raw
    .prepare(
      `INSERT INTO streamer_platform_accounts
         (streamer_id, platform, platform_user_id, channel_name, channel_handle, channel_url,
          verification_status, verified_at, ownership_expires_at, approval_status,
          approval_reason_code, approved_at, audience_count, audience_count_known,
          channel_created_at, metrics_synced_at, created_at, updated_at)
       VALUES (?, 'YOUTUBE', 'UC-disconnect', 'Channel', '@channel',
               'https://youtube.com/@channel', 'VERIFIED',
               '2026-08-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z', 'APPROVED',
               'MANUAL_REVIEW_APPROVED', '2026-08-02T00:00:00.000Z', 25000, 1,
               '2020-01-01T00:00:00.000Z', '2026-08-02T00:00:00.000Z',
               '2026-08-01T00:00:00.000Z', '2026-08-02T00:00:00.000Z')`,
    )
    .run(streamerId);
  const accountId = Number(accountInfo.lastInsertRowid);
  raw
    .prepare(
      `INSERT INTO streamer_platform_reviews
         (streamer_platform_account_id, review_type, requested_by, work_state, priority,
          due_at, policy_version, evidence_json, decision_code, public_reason_code,
          created_at, updated_at, completed_at)
       VALUES (?, 'INITIAL', 'USER', 'APPROVED', 'NORMAL',
               '2026-08-02T00:00:00.000Z', 1, '{}', 'STREAMER_APPROVED', 'manual approval',
               '2026-08-01T00:00:00.000Z', '2026-08-02T00:00:00.000Z',
               '2026-08-02T00:00:00.000Z')`,
    )
    .run(accountId);
  const staleAttemptInfo = raw
    .prepare(
      `INSERT INTO streamer_platform_accounts
         (streamer_id, platform, platform_user_id, channel_name, channel_url,
          verification_status, approval_status, created_at, updated_at)
       VALUES (?, 'YOUTUBE', 'UC-stale-attempt', 'Old unapproved attempt',
               'https://youtube.com/channel/UC-stale-attempt', 'REJECTED', 'REJECTED',
               '2026-07-01T00:00:00.000Z', '2026-07-02T00:00:00.000Z')`,
    )
    .run(streamerId);
  const staleAttemptId = Number(staleAttemptInfo.lastInsertRowid);

  const repository = new D1StreamerRepository(db);
  assert.equal(
    (await repository.getStreamerRankings({ mode: "score", gameId: "reaction-time" })).total,
    1,
  );

  const disconnected = await repository.disconnectPlatformAccount({
    userId: 7,
    platform: "YOUTUBE",
    actorUserId: 7,
    actorType: "SELF",
    reason: "USER_REQUEST",
    correlationId: "self-disconnect-7-youtube",
    nowIso: "2026-09-01T00:00:00.000Z",
  });
  assert.equal(disconnected, true);
  assert.equal(
    raw.prepare("SELECT COUNT(*) AS count FROM streamer_platform_accounts").get()?.count,
    0,
  );
  assert.equal(
    raw
      .prepare(
        `SELECT COUNT(*) AS count FROM streamer_platform_connection_history
         WHERE correlation_id = 'self-disconnect-7-youtube'`,
      )
      .get()?.count,
    2,
  );
  assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM scores").get()?.count, 1);
  assert.equal(
    raw.prepare("SELECT COUNT(*) AS count FROM streamer_platform_reviews").get()?.count,
    0,
  );
  assert.equal(
    raw.prepare("SELECT status FROM streamer_profiles WHERE id = ?").get(streamerId)?.status,
    "UNVERIFIED",
  );
  assert.equal(
    (await repository.getStreamerRankings({ mode: "score", gameId: "reaction-time" })).total,
    0,
  );

  const history = raw
    .prepare(
      `SELECT platform_account_id, platform, platform_user_id, disconnect_actor_type,
              disconnect_reason, review_snapshot_json
       FROM streamer_platform_connection_history
       WHERE correlation_id = 'self-disconnect-7-youtube' AND platform_account_id = ?`,
    )
    .get(accountId) as Record<string, unknown>;
  assert.equal(history.platform_account_id, accountId);
  assert.equal(history.platform, "YOUTUBE");
  assert.equal(history.platform_user_id, "UC-disconnect");
  assert.equal(history.disconnect_actor_type, "SELF");
  assert.equal(history.disconnect_reason, "USER_REQUEST");
  assert.match(String(history.review_snapshot_json), /"reviewType":"INITIAL"/);
  assert.match(String(history.review_snapshot_json), /"decisionCode":"STREAMER_APPROVED"/);
  assert.equal(
    raw
      .prepare(
        `SELECT review_snapshot_json FROM streamer_platform_connection_history
         WHERE correlation_id = 'self-disconnect-7-youtube' AND platform_account_id = ?`,
      )
      .get(staleAttemptId)?.review_snapshot_json,
    "[]",
  );

  const reconnected = await repository.upsertPlatformAccount({
    streamerId,
    platform: "YOUTUBE",
    platformUserId: "UC-disconnect",
    channelName: "Channel reconnected",
    channelHandle: "@channel",
    channelUrl: "https://youtube.com/@channel",
    verificationStatus: "VERIFIED",
    ownershipExpiresAt: "2099-01-01T00:00:00.000Z",
  });
  assert.equal(reconnected.platformUserId, "UC-disconnect");
  assert.notEqual(reconnected.id, accountId);
  assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM scores").get()?.count, 1);
});
