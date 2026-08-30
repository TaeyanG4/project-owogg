-- Migration: 0049_oauth_identity_owner_immutable.sql
-- Purpose: OAuth identity ownership is immutable. A Google/Discord provider ID can be detached
-- and reattached only by its original OwOGG user; account merge must never transfer it.

DROP TRIGGER IF EXISTS trg_oauth_accounts_after_user_transfer_registration;

CREATE TRIGGER trg_oauth_accounts_before_identity_owner_update_guard
BEFORE UPDATE OF user_id, provider, provider_user_id ON oauth_accounts
FOR EACH ROW
WHEN NEW.user_id <> OLD.user_id
  OR NEW.provider <> OLD.provider
  OR NEW.provider_user_id <> OLD.provider_user_id
BEGIN
  SELECT RAISE(ABORT, 'OAUTH_IDENTITY_OWNER_IMMUTABLE');
END;

CREATE TRIGGER trg_oauth_identity_registrations_before_owner_update_guard
BEFORE UPDATE OF registered_user_id, provider, provider_user_id ON oauth_identity_registrations
FOR EACH ROW
WHEN NEW.registered_user_id <> OLD.registered_user_id
  OR NEW.provider <> OLD.provider
  OR NEW.provider_user_id <> OLD.provider_user_id
BEGIN
  SELECT RAISE(ABORT, 'OAUTH_IDENTITY_OWNER_IMMUTABLE');
END;
