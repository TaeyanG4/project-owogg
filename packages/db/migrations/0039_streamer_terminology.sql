-- Rename the broadcast-channel program to Streamer. Game Creator tables and contracts are
-- intentionally unrelated and remain unchanged.

ALTER TABLE creator_profiles RENAME TO streamer_profiles;
ALTER TABLE creator_platform_accounts RENAME TO streamer_platform_accounts;
ALTER TABLE streamer_platform_accounts RENAME COLUMN creator_id TO streamer_id;

ALTER TABLE creator_review_jobs RENAME TO streamer_review_jobs;
ALTER TABLE streamer_review_jobs
  RENAME COLUMN creator_platform_account_id TO streamer_platform_account_id;

ALTER TABLE creator_review_audit_log RENAME TO streamer_review_audit_log;
ALTER TABLE streamer_review_audit_log
  RENAME COLUMN creator_platform_account_id TO streamer_platform_account_id;
ALTER TABLE streamer_review_audit_log
  RENAME COLUMN creator_review_job_id TO streamer_review_job_id;

DROP INDEX IF EXISTS idx_creator_profiles_user;
DROP INDEX IF EXISTS idx_creator_profiles_status;
DROP INDEX IF EXISTS idx_creator_platform_accounts_creator;
DROP INDEX IF EXISTS idx_creator_platform_accounts_platform;
DROP INDEX IF EXISTS idx_creator_review_jobs_account;
DROP INDEX IF EXISTS idx_creator_review_jobs_due;
DROP INDEX IF EXISTS idx_creator_review_jobs_type_due;
DROP INDEX IF EXISTS idx_creator_review_audit_account;
DROP INDEX IF EXISTS idx_creator_review_audit_job;

CREATE INDEX idx_streamer_profiles_user ON streamer_profiles(user_id);
CREATE INDEX idx_streamer_profiles_status ON streamer_profiles(status);
CREATE INDEX idx_streamer_platform_accounts_streamer
  ON streamer_platform_accounts(streamer_id);
CREATE INDEX idx_streamer_platform_accounts_platform
  ON streamer_platform_accounts(platform, verification_status);
CREATE INDEX idx_streamer_review_jobs_account
  ON streamer_review_jobs(streamer_platform_account_id);
CREATE INDEX idx_streamer_review_jobs_due
  ON streamer_review_jobs(status, next_check_at);
CREATE INDEX idx_streamer_review_jobs_type_due
  ON streamer_review_jobs(review_type, status, next_check_at);
CREATE INDEX idx_streamer_review_audit_account
  ON streamer_review_audit_log(streamer_platform_account_id, created_at DESC);
CREATE INDEX idx_streamer_review_audit_job
  ON streamer_review_audit_log(streamer_review_job_id, reviewer_user_id, action);

DROP TRIGGER IF EXISTS prevent_creator_review_audit_update;
DROP TRIGGER IF EXISTS prevent_creator_review_audit_delete;

CREATE TRIGGER prevent_streamer_review_audit_update
BEFORE UPDATE ON streamer_review_audit_log
BEGIN
  SELECT RAISE(ABORT, 'streamer review audit log is immutable');
END;

CREATE TRIGGER prevent_streamer_review_audit_delete
BEFORE DELETE ON streamer_review_audit_log
BEGIN
  SELECT RAISE(ABORT, 'streamer review audit log is immutable');
END;

-- Rolling-deploy compatibility: the migration is applied before the new Worker starts. These
-- views let the immediately-previous Worker revision finish in-flight reads and writes. They are
-- the only intentionally retained broadcast-program `creator_*` names and can be removed by a
-- later contract migration after the Production rollback window closes.
CREATE VIEW creator_profiles AS
SELECT id, user_id, status, featured_status, featured_reason, featured_since, created_at, updated_at
FROM streamer_profiles;

CREATE TRIGGER compat_creator_profiles_insert
INSTEAD OF INSERT ON creator_profiles
BEGIN
  INSERT INTO streamer_profiles
    (id, user_id, status, featured_status, featured_reason, featured_since, created_at, updated_at)
  VALUES
    (NEW.id, NEW.user_id, NEW.status, NEW.featured_status, NEW.featured_reason, NEW.featured_since,
     NEW.created_at, NEW.updated_at);
END;

CREATE TRIGGER compat_creator_profiles_update
INSTEAD OF UPDATE ON creator_profiles
BEGIN
  UPDATE streamer_profiles
  SET user_id = NEW.user_id,
      status = NEW.status,
      featured_status = NEW.featured_status,
      featured_reason = NEW.featured_reason,
      featured_since = NEW.featured_since,
      created_at = NEW.created_at,
      updated_at = NEW.updated_at
  WHERE id = OLD.id;
END;

CREATE TRIGGER compat_creator_profiles_delete
INSTEAD OF DELETE ON creator_profiles
BEGIN
  DELETE FROM streamer_profiles WHERE id = OLD.id;
END;

CREATE VIEW creator_platform_accounts AS
SELECT id, streamer_id AS creator_id, platform, platform_user_id, channel_name, channel_handle,
       channel_url, avatar_url, verification_status, verified_at, created_at, updated_at,
       audience_count, channel_created_at, metrics_synced_at, audience_count_known
FROM streamer_platform_accounts;

CREATE TRIGGER compat_creator_platform_accounts_insert
INSTEAD OF INSERT ON creator_platform_accounts
BEGIN
  INSERT INTO streamer_platform_accounts
    (id, streamer_id, platform, platform_user_id, channel_name, channel_handle, channel_url,
     avatar_url, verification_status, verified_at, created_at, updated_at, audience_count,
     channel_created_at, metrics_synced_at, audience_count_known)
  VALUES
    (NEW.id, NEW.creator_id, NEW.platform, NEW.platform_user_id, NEW.channel_name,
     NEW.channel_handle, NEW.channel_url, NEW.avatar_url, NEW.verification_status, NEW.verified_at,
     NEW.created_at, NEW.updated_at, NEW.audience_count, NEW.channel_created_at,
     NEW.metrics_synced_at, NEW.audience_count_known);
END;

CREATE TRIGGER compat_creator_platform_accounts_update
INSTEAD OF UPDATE ON creator_platform_accounts
BEGIN
  UPDATE streamer_platform_accounts
  SET streamer_id = NEW.creator_id,
      platform = NEW.platform,
      platform_user_id = NEW.platform_user_id,
      channel_name = NEW.channel_name,
      channel_handle = NEW.channel_handle,
      channel_url = NEW.channel_url,
      avatar_url = NEW.avatar_url,
      verification_status = NEW.verification_status,
      verified_at = NEW.verified_at,
      created_at = NEW.created_at,
      updated_at = NEW.updated_at,
      audience_count = NEW.audience_count,
      channel_created_at = NEW.channel_created_at,
      metrics_synced_at = NEW.metrics_synced_at,
      audience_count_known = NEW.audience_count_known
  WHERE id = OLD.id;
END;

CREATE TRIGGER compat_creator_platform_accounts_delete
INSTEAD OF DELETE ON creator_platform_accounts
BEGIN
  DELETE FROM streamer_platform_accounts WHERE id = OLD.id;
END;

CREATE VIEW creator_review_jobs AS
SELECT id, streamer_platform_account_id AS creator_platform_account_id, status, initial_audience,
       initial_channel_created_at, next_check_at, attempt_count, last_error, created_at, updated_at,
       completed_at, review_type, review_reason
FROM streamer_review_jobs;

CREATE TRIGGER compat_creator_review_jobs_insert
INSTEAD OF INSERT ON creator_review_jobs
BEGIN
  INSERT INTO streamer_review_jobs
    (id, streamer_platform_account_id, status, initial_audience, initial_channel_created_at,
     next_check_at, attempt_count, last_error, created_at, updated_at, completed_at, review_type,
     review_reason)
  VALUES
    (NEW.id, NEW.creator_platform_account_id, NEW.status, NEW.initial_audience,
     NEW.initial_channel_created_at, NEW.next_check_at, NEW.attempt_count, NEW.last_error,
     NEW.created_at, NEW.updated_at, NEW.completed_at, NEW.review_type, NEW.review_reason);
END;

CREATE TRIGGER compat_creator_review_jobs_update
INSTEAD OF UPDATE ON creator_review_jobs
BEGIN
  UPDATE streamer_review_jobs
  SET streamer_platform_account_id = NEW.creator_platform_account_id,
      status = NEW.status,
      initial_audience = NEW.initial_audience,
      initial_channel_created_at = NEW.initial_channel_created_at,
      next_check_at = NEW.next_check_at,
      attempt_count = NEW.attempt_count,
      last_error = NEW.last_error,
      created_at = NEW.created_at,
      updated_at = NEW.updated_at,
      completed_at = NEW.completed_at,
      review_type = NEW.review_type,
      review_reason = NEW.review_reason
  WHERE id = OLD.id;
END;

CREATE TRIGGER compat_creator_review_jobs_delete
INSTEAD OF DELETE ON creator_review_jobs
BEGIN
  DELETE FROM streamer_review_jobs WHERE id = OLD.id;
END;

CREATE VIEW creator_review_audit_log AS
SELECT id, streamer_platform_account_id AS creator_platform_account_id,
       streamer_review_job_id AS creator_review_job_id, reviewer_user_id, action, reason,
       previous_status, new_status, metric_snapshot_json, created_at
FROM streamer_review_audit_log;

CREATE TRIGGER compat_creator_review_audit_insert
INSTEAD OF INSERT ON creator_review_audit_log
BEGIN
  INSERT INTO streamer_review_audit_log
    (id, streamer_platform_account_id, streamer_review_job_id, reviewer_user_id, action, reason,
     previous_status, new_status, metric_snapshot_json, created_at)
  VALUES
    (NEW.id, NEW.creator_platform_account_id, NEW.creator_review_job_id, NEW.reviewer_user_id,
     NEW.action, NEW.reason, NEW.previous_status, NEW.new_status, NEW.metric_snapshot_json,
     NEW.created_at);
END;
