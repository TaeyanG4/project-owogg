-- Migration 0051: single-tier Streamer programme with per-platform manual review.
--
-- The 0039 rolling-deploy compatibility window has closed. Remove those writable compatibility
-- views and retire the former tier/automatic-review schema from runtime authority. Historical
-- values and audit rows are preserved in explicitly named archive tables; no application path
-- reads or writes them. Existing verified Streamer visibility is preserved by approving the
-- platform accounts that were already public before this migration. Every connection created by
-- the new Worker starts PENDING.

DROP TRIGGER IF EXISTS compat_creator_profiles_insert;
DROP TRIGGER IF EXISTS compat_creator_profiles_update;
DROP TRIGGER IF EXISTS compat_creator_profiles_delete;
DROP TRIGGER IF EXISTS compat_creator_platform_accounts_insert;
DROP TRIGGER IF EXISTS compat_creator_platform_accounts_update;
DROP TRIGGER IF EXISTS compat_creator_platform_accounts_delete;
DROP TRIGGER IF EXISTS compat_creator_review_jobs_insert;
DROP TRIGGER IF EXISTS compat_creator_review_jobs_update;
DROP TRIGGER IF EXISTS compat_creator_review_jobs_delete;
DROP TRIGGER IF EXISTS compat_creator_review_audit_insert;

DROP VIEW IF EXISTS creator_profiles;
DROP VIEW IF EXISTS creator_platform_accounts;
DROP VIEW IF EXISTS creator_review_jobs;
DROP VIEW IF EXISTS creator_review_audit_log;

DROP TRIGGER IF EXISTS prevent_streamer_review_audit_update;
DROP TRIGGER IF EXISTS prevent_streamer_review_audit_delete;
DROP INDEX IF EXISTS idx_streamer_review_jobs_account;
DROP INDEX IF EXISTS idx_streamer_review_jobs_due;
DROP INDEX IF EXISTS idx_streamer_review_jobs_type_due;
DROP INDEX IF EXISTS idx_streamer_review_audit_account;
DROP INDEX IF EXISTS idx_streamer_review_audit_job;

ALTER TABLE streamer_review_audit_log
  RENAME TO streamer_legacy_automated_review_audit_log;
ALTER TABLE streamer_review_jobs
  RENAME TO streamer_legacy_automated_review_jobs;

CREATE TRIGGER prevent_streamer_legacy_automated_review_audit_update
BEFORE UPDATE ON streamer_legacy_automated_review_audit_log
BEGIN
  SELECT RAISE(ABORT, 'legacy streamer review audit log is immutable');
END;

CREATE TRIGGER prevent_streamer_legacy_automated_review_audit_delete
BEFORE DELETE ON streamer_legacy_automated_review_audit_log
BEGIN
  SELECT RAISE(ABORT, 'legacy streamer review audit log is immutable');
END;

CREATE TABLE streamer_legacy_tier_state_archive (
  streamer_profile_id INTEGER PRIMARY KEY,
  tier_state TEXT NOT NULL,
  reason TEXT,
  since_at TEXT,
  archived_at TEXT NOT NULL
);

INSERT INTO streamer_legacy_tier_state_archive
  (streamer_profile_id, tier_state, reason, since_at, archived_at)
SELECT id, featured_status, featured_reason, featured_since,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM streamer_profiles;

ALTER TABLE streamer_profiles DROP COLUMN featured_status;
ALTER TABLE streamer_profiles DROP COLUMN featured_reason;
ALTER TABLE streamer_profiles DROP COLUMN featured_since;

CREATE TABLE streamer_policy_versions (
  version INTEGER PRIMARY KEY,
  values_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  updated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE streamer_policy_state (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  active_version INTEGER NOT NULL REFERENCES streamer_policy_versions(version),
  row_version INTEGER NOT NULL DEFAULT 0,
  last_correlation_id TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE streamer_policy_constraints (
  field TEXT PRIMARY KEY,
  unit TEXT NOT NULL CHECK (unit IN ('PEOPLE', 'DAYS', 'HOURS', 'MINUTES', 'SECONDS')),
  minimum INTEGER NOT NULL CHECK (minimum >= 0),
  maximum INTEGER NOT NULL CHECK (maximum >= minimum),
  step INTEGER NOT NULL CHECK (step > 0)
);

INSERT INTO streamer_policy_versions
  (version, values_json, reason, updated_by_user_id, updated_at)
VALUES
  (1,
   '{"minimumAudience":10000,"minimumChannelAgeDays":90,"ownershipValidityDays":180,"reverificationNoticeDays":30,"verificationIntentTtlMinutes":10,"claimLeaseMinutes":20,"reviewSlaHours":24,"holdDefaultHours":24,"reconsiderationCooldownDays":7,"providerTimeoutSeconds":10}',
   '초기 수동 Streamer 심사 정책', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT INTO streamer_policy_state
  (singleton_id, active_version, row_version, last_correlation_id, updated_at)
VALUES
  (1, 1, 0, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT INTO streamer_policy_constraints (field, unit, minimum, maximum, step) VALUES
  ('minimumAudience', 'PEOPLE', 0, 10000000, 100),
  ('minimumChannelAgeDays', 'DAYS', 0, 3650, 1),
  ('ownershipValidityDays', 'DAYS', 1, 730, 1),
  ('reverificationNoticeDays', 'DAYS', 0, 365, 1),
  ('verificationIntentTtlMinutes', 'MINUTES', 1, 120, 1),
  ('claimLeaseMinutes', 'MINUTES', 1, 240, 1),
  ('reviewSlaHours', 'HOURS', 1, 720, 1),
  ('holdDefaultHours', 'HOURS', 1, 720, 1),
  ('reconsiderationCooldownDays', 'DAYS', 0, 365, 1),
  ('providerTimeoutSeconds', 'SECONDS', 1, 120, 1);

-- OAuth redirect verification is bound to both the authenticated OwOGG user and the exact
-- OwOGG session that initiated it. Only hashes of browser-visible credentials are persisted.
-- SOOP browser OAuth is unavailable until the provider offers a callback correlation mechanism
-- that can prevent authorization-code injection; it therefore does not create a row.
CREATE TABLE streamer_verification_intents (
  state_hash TEXT PRIMARY KEY
    CHECK (length(state_hash) = 64 AND state_hash NOT GLOB '*[^0-9a-f]*'),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_token_hash TEXT NOT NULL
    CHECK (length(session_token_hash) = 64 AND session_token_hash NOT GLOB '*[^0-9a-f]*'),
  platform TEXT NOT NULL CHECK (platform IN ('YOUTUBE', 'CHZZK', 'TWITCH')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  CHECK (expires_at > created_at)
);

CREATE INDEX idx_streamer_verification_intents_expiry
  ON streamer_verification_intents(expires_at);

ALTER TABLE streamer_profiles ADD COLUMN suspended_at TEXT;
ALTER TABLE streamer_profiles ADD COLUMN suspended_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE streamer_profiles ADD COLUMN suspended_until TEXT;
ALTER TABLE streamer_profiles ADD COLUMN suspension_reason_code TEXT;
ALTER TABLE streamer_profiles ADD COLUMN row_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE streamer_profiles ADD COLUMN last_correlation_id TEXT;

ALTER TABLE streamer_platform_accounts ADD COLUMN ownership_expires_at TEXT;
ALTER TABLE streamer_platform_accounts ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'PENDING'
  CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED'));
ALTER TABLE streamer_platform_accounts ADD COLUMN approval_reason_code TEXT;
ALTER TABLE streamer_platform_accounts ADD COLUMN approved_at TEXT;
ALTER TABLE streamer_platform_accounts ADD COLUMN approved_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE streamer_platform_accounts ADD COLUMN row_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE streamer_platform_accounts ADD COLUMN last_correlation_id TEXT;

-- A user can have at most one currently-owned channel for a platform. Never choose a winner
-- automatically: stop the migration if historical data violates the invariant.
CREATE TABLE _migration_0051_streamer_guard (
  must_be_zero INTEGER NOT NULL CHECK (must_be_zero = 0)
);

INSERT INTO _migration_0051_streamer_guard (must_be_zero)
SELECT 1
FROM streamer_platform_accounts
WHERE verification_status = 'VERIFIED'
GROUP BY streamer_id, platform
HAVING COUNT(*) > 1;

DROP TABLE _migration_0051_streamer_guard;

CREATE UNIQUE INDEX idx_streamer_platform_one_verified_per_platform
  ON streamer_platform_accounts(streamer_id, platform)
  WHERE verification_status = 'VERIFIED';

CREATE INDEX idx_streamer_platform_approval
  ON streamer_platform_accounts(approval_status, platform, streamer_id);
CREATE INDEX idx_streamer_platform_ownership_expiry
  ON streamer_platform_accounts(ownership_expires_at)
  WHERE verification_status = 'VERIFIED';

-- Preserve the pre-migration public Streamer population. The old public queries required both a
-- VERIFIED profile and a VERIFIED platform account, so this is an exact compatibility backfill.
UPDATE streamer_platform_accounts
SET approval_status = 'APPROVED',
    approval_reason_code = 'MIGRATED_EXISTING_STREAMER',
    approved_at = COALESCE(verified_at, updated_at),
    row_version = row_version + 1
WHERE verification_status = 'VERIFIED'
  AND streamer_id IN (
    SELECT id FROM streamer_profiles WHERE status = 'VERIFIED'
  );

-- Existing ownership receives the active policy's validity window instead of a hard-coded grace
-- period. New connections use the same versioned value in application code.
UPDATE streamer_platform_accounts
SET ownership_expires_at = strftime(
  '%Y-%m-%dT%H:%M:%fZ',
  'now',
  printf(
    '+%d days',
    (SELECT json_extract(values_json, '$.ownershipValidityDays')
     FROM streamer_policy_versions
     WHERE version = (SELECT active_version FROM streamer_policy_state WHERE singleton_id = 1))
  )
)
WHERE verification_status = 'VERIFIED' AND ownership_expires_at IS NULL;

CREATE TABLE streamer_platform_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  streamer_platform_account_id INTEGER NOT NULL
    REFERENCES streamer_platform_accounts(id) ON DELETE CASCADE,
  parent_review_id INTEGER REFERENCES streamer_platform_reviews(id) ON DELETE SET NULL,
  review_type TEXT NOT NULL CHECK (review_type IN ('INITIAL', 'RECONSIDERATION', 'OWNERSHIP_REVERIFY')),
  requested_by TEXT NOT NULL CHECK (requested_by IN ('USER', 'ADMIN', 'MIGRATION')),
  work_state TEXT NOT NULL CHECK (work_state IN ('QUEUED', 'ON_HOLD', 'APPROVED', 'REJECTED', 'CANCELLED')),
  decision_code TEXT CHECK (decision_code IN ('STREAMER_APPROVED', 'STREAMER_REJECTED', 'REAUTH_REQUIRED')),
  priority TEXT NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('NORMAL', 'HIGH', 'URGENT')),
  due_at TEXT NOT NULL,
  claimed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  claim_expires_at TEXT,
  hold_until TEXT,
  public_reason_code TEXT,
  internal_note TEXT CHECK (internal_note IS NULL OR length(internal_note) <= 1000),
  policy_version INTEGER NOT NULL REFERENCES streamer_policy_versions(version),
  evidence_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  row_version INTEGER NOT NULL DEFAULT 0,
  last_correlation_id TEXT
);

CREATE UNIQUE INDEX idx_streamer_platform_reviews_one_active
  ON streamer_platform_reviews(streamer_platform_account_id)
  WHERE work_state IN ('QUEUED', 'ON_HOLD');
CREATE INDEX idx_streamer_platform_reviews_queue
  ON streamer_platform_reviews(work_state, due_at, priority, id);
CREATE INDEX idx_streamer_platform_reviews_claim
  ON streamer_platform_reviews(claimed_by_user_id, claim_expires_at, work_state);
CREATE INDEX idx_streamer_platform_reviews_parent
  ON streamer_platform_reviews(parent_review_id);

-- Approved historical accounts receive a terminal migration decision. Other verified accounts
-- receive an ordinary manual queue item; every platform is represented independently.
INSERT INTO streamer_platform_reviews
  (streamer_platform_account_id, parent_review_id, review_type, requested_by, work_state,
   decision_code, priority, due_at, claimed_by_user_id, claim_expires_at, hold_until,
   public_reason_code, internal_note, policy_version, evidence_json, created_at, updated_at,
   completed_at, row_version, last_correlation_id)
SELECT
  account.id, NULL, 'INITIAL', 'MIGRATION',
  CASE WHEN account.approval_status = 'APPROVED' THEN 'APPROVED' ELSE 'QUEUED' END,
  CASE WHEN account.approval_status = 'APPROVED' THEN 'STREAMER_APPROVED' ELSE NULL END,
  'NORMAL',
  strftime(
    '%Y-%m-%dT%H:%M:%fZ',
    'now',
    printf(
      '+%d hours',
      (SELECT json_extract(values_json, '$.reviewSlaHours')
       FROM streamer_policy_versions
       WHERE version = (SELECT active_version FROM streamer_policy_state WHERE singleton_id = 1))
    )
  ),
  NULL, NULL, NULL,
  CASE WHEN account.approval_status = 'APPROVED' THEN 'MIGRATED_EXISTING_STREAMER' ELSE NULL END,
  NULL, 1, NULL,
  COALESCE(account.created_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  CASE WHEN account.approval_status = 'APPROVED'
    THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE NULL END,
  0, NULL
FROM streamer_platform_accounts account
WHERE account.verification_status = 'VERIFIED';

CREATE TABLE streamer_provider_settings (
  platform TEXT PRIMARY KEY CHECK (platform IN ('YOUTUBE', 'CHZZK', 'SOOP', 'TWITCH')),
  new_connections_paused INTEGER NOT NULL DEFAULT 0 CHECK (new_connections_paused IN (0, 1)),
  reason TEXT,
  updated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL,
  row_version INTEGER NOT NULL DEFAULT 0,
  last_correlation_id TEXT
);

INSERT INTO streamer_provider_settings
  (platform, new_connections_paused, reason, updated_by_user_id, updated_at, row_version)
VALUES
  ('YOUTUBE', 0, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0),
  ('CHZZK', 0, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0),
  ('SOOP', 0, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0),
  ('TWITCH', 0, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0);

CREATE TABLE streamer_admin_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('STREAMER', 'PLATFORM_ACCOUNT', 'REVIEW', 'POLICY', 'PROVIDER')),
  target_id TEXT NOT NULL,
  target_label TEXT NOT NULL,
  public_reason_code TEXT,
  internal_note TEXT CHECK (internal_note IS NULL OR length(internal_note) <= 1000),
  change_summary TEXT NOT NULL,
  policy_version INTEGER REFERENCES streamer_policy_versions(version),
  correlation_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_streamer_admin_audit_created
  ON streamer_admin_audit_log(created_at DESC, id DESC);
CREATE INDEX idx_streamer_admin_audit_target
  ON streamer_admin_audit_log(target_type, target_id, created_at DESC);

CREATE TRIGGER prevent_streamer_admin_audit_update
BEFORE UPDATE ON streamer_admin_audit_log
BEGIN
  SELECT RAISE(ABORT, 'streamer admin audit log is immutable');
END;

CREATE TRIGGER prevent_streamer_admin_audit_delete
BEFORE DELETE ON streamer_admin_audit_log
BEGIN
  SELECT RAISE(ABORT, 'streamer admin audit log is immutable');
END;

-- Forward-fill the new permission catalogue into the persisted role authority.
INSERT OR IGNORE INTO admin_role_permissions
  (role, permission, granted_by_admin_id, updated_at)
VALUES
  ('OPERATOR', 'streamers.view', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('OPERATOR', 'streamers.review', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('OPERATOR', 'streamers.manage', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('OPERATOR', 'streamers.policy.manage', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('OPERATOR', 'streamers.operations.manage', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('MODERATOR', 'streamers.view', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('MODERATOR', 'streamers.review', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
