import test from "node:test";
import assert from "node:assert/strict";
import { D1StreamerReviewRepository } from "../src/d1/D1StreamerReviewRepository.js";
import { createSqliteD1 } from "./helpers/sqliteD1.js";

const SCHEMA = `
CREATE TABLE streamer_platform_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  streamer_platform_account_id INTEGER NOT NULL,
  parent_review_id INTEGER,
  review_type TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  work_state TEXT NOT NULL,
  decision_code TEXT,
  priority TEXT NOT NULL,
  due_at TEXT NOT NULL,
  claimed_by_user_id INTEGER,
  claim_expires_at TEXT,
  hold_until TEXT,
  public_reason_code TEXT,
  internal_note TEXT,
  policy_version INTEGER NOT NULL,
  evidence_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  row_version INTEGER NOT NULL DEFAULT 0,
  last_correlation_id TEXT
);
CREATE UNIQUE INDEX one_active_platform_review
  ON streamer_platform_reviews(streamer_platform_account_id)
  WHERE work_state IN ('QUEUED', 'ON_HOLD');
`;

test("initial review creation is idempotent for one platform account", async () => {
  const { db, raw } = createSqliteD1(SCHEMA);
  const repository = new D1StreamerReviewRepository(db);
  const input = {
    streamerPlatformAccountId: 11,
    reviewType: "INITIAL" as const,
    dueAt: "2026-09-01T00:00:00.000Z",
    policyVersion: 3,
    evidenceJson: '{"policyVersion":3}',
    nowIso: "2026-08-31T00:00:00.000Z",
  };

  const first = await repository.createOwnershipReview(input);
  const replay = await repository.createOwnershipReview(input);

  assert.equal(first.id, replay.id);
  assert.equal(first.status, "QUEUED");
  assert.equal(first.reviewType, "INITIAL");
  assert.equal(
    raw.prepare("SELECT COUNT(*) AS count FROM streamer_platform_reviews").get()?.count,
    1,
  );
});

test("different platform accounts always receive separate reviews", async () => {
  const { db } = createSqliteD1(SCHEMA);
  const repository = new D1StreamerReviewRepository(db);
  const common = {
    dueAt: "2026-09-01T00:00:00.000Z",
    policyVersion: 3,
    evidenceJson: "{}",
    nowIso: "2026-08-31T00:00:00.000Z",
  };
  const youtube = await repository.createOwnershipReview({
    ...common,
    streamerPlatformAccountId: 11,
    reviewType: "INITIAL",
  });
  const twitch = await repository.createOwnershipReview({
    ...common,
    streamerPlatformAccountId: 12,
    reviewType: "INITIAL",
  });

  assert.notEqual(youtube.id, twitch.id);
  assert.notEqual(youtube.streamerPlatformAccountId, twitch.streamerPlatformAccountId);
});

test("ownership re-verification is recorded as a separate review type", async () => {
  const { db, raw } = createSqliteD1(SCHEMA);
  const repository = new D1StreamerReviewRepository(db);

  const review = await repository.createOwnershipReview({
    streamerPlatformAccountId: 21,
    reviewType: "OWNERSHIP_REVERIFY",
    dueAt: "2026-09-02T00:00:00.000Z",
    policyVersion: 4,
    evidenceJson: '{"policyVersion":4}',
    nowIso: "2026-09-01T00:00:00.000Z",
  });

  assert.equal(review.reviewType, "OWNERSHIP_REVERIFY");
  assert.equal(
    raw.prepare("SELECT review_type FROM streamer_platform_reviews WHERE id = ?").get(review.id)
      ?.review_type,
    "OWNERSHIP_REVERIFY",
  );
});
