-- Migration: 0050_oauth_identity_release_on_unlink.sql
-- Purpose: Keep OAuth identity ownership unique while connected, but release the registration
-- reservation when the user explicitly disconnects that provider. Active rows still cannot be
-- transferred in place because the 0049 owner-update guard remains installed.

-- Repair registrations left behind by disconnects before this migration. A registration is
-- active only when the exact provider identity is still attached to the same OwOGG user.
DELETE FROM oauth_identity_registrations
WHERE NOT EXISTS (
  SELECT 1
  FROM oauth_accounts account
  WHERE account.provider = oauth_identity_registrations.provider
    AND account.provider_user_id = oauth_identity_registrations.provider_user_id
    AND account.user_id = oauth_identity_registrations.registered_user_id
);

-- Restore any active registration missing from inconsistent legacy data before installing the
-- release trigger. The active oauth_accounts unique keys remain the final concurrency boundary.
INSERT OR IGNORE INTO oauth_identity_registrations
  (provider, provider_user_id, registered_user_id, registered_at)
SELECT provider, provider_user_id, user_id, created_at
FROM oauth_accounts;

CREATE TRIGGER trg_oauth_accounts_after_delete_registration_release
AFTER DELETE ON oauth_accounts
FOR EACH ROW
BEGIN
  DELETE FROM oauth_identity_registrations
  WHERE provider = OLD.provider
    AND provider_user_id = OLD.provider_user_id
    AND registered_user_id = OLD.user_id;
END;
