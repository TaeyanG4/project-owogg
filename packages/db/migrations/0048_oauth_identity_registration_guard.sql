-- Migration: 0048_oauth_identity_registration_guard.sql
-- Purpose: Permanently bind each Google/Discord identity to one OwOGG user and keep one
-- provider identity per user even after an account is disconnected. `oauth_accounts` remains
-- the active-login table; this registration table is the durable uniqueness authority.

CREATE TABLE oauth_identity_registrations (
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  registered_user_id INTEGER NOT NULL,
  registered_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (provider, provider_user_id),
  UNIQUE (registered_user_id, provider)
);

INSERT INTO oauth_identity_registrations
  (provider, provider_user_id, registered_user_id, registered_at)
SELECT provider, provider_user_id, user_id, created_at
FROM oauth_accounts;

-- Reject both ways an OAuth identity could be rebound:
--   1. the same provider identity moving to a different OwOGG user;
--   2. one OwOGG user replacing its already-registered identity for that provider.
-- Reconnecting the exact same identity to its original user remains valid.
CREATE TRIGGER trg_oauth_accounts_before_insert_registration_guard
BEFORE INSERT ON oauth_accounts
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM oauth_identity_registrations registration
  WHERE registration.provider = NEW.provider
    AND (
      (registration.provider_user_id = NEW.provider_user_id
       AND registration.registered_user_id <> NEW.user_id)
      OR
      (registration.registered_user_id = NEW.user_id
       AND registration.provider_user_id <> NEW.provider_user_id)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'OAUTH_IDENTITY_ALREADY_REGISTERED');
END;

CREATE TRIGGER trg_oauth_accounts_after_insert_registration
AFTER INSERT ON oauth_accounts
FOR EACH ROW
BEGIN
  INSERT OR IGNORE INTO oauth_identity_registrations
    (provider, provider_user_id, registered_user_id, registered_at)
  VALUES (NEW.provider, NEW.provider_user_id, NEW.user_id, NEW.created_at);
END;

-- Account merge is the only supported ownership transfer. Keeping this in a trigger also makes
-- the invariant safe during a rolling deploy while an older Worker revision may still run.
CREATE TRIGGER trg_oauth_accounts_after_user_transfer_registration
AFTER UPDATE OF user_id ON oauth_accounts
FOR EACH ROW
WHEN OLD.user_id <> NEW.user_id
BEGIN
  UPDATE oauth_identity_registrations
  SET registered_user_id = NEW.user_id
  WHERE provider = NEW.provider
    AND provider_user_id = NEW.provider_user_id
    AND registered_user_id = OLD.user_id;
END;
