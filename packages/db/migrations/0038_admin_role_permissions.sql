-- Migration 0038: D1-backed role-level functional permissions for the unified Admin Center.
--
-- ADMIN remains the protected top role with implicit access to every permission. The three
-- configurable staff roles below receive persisted policies, which a managed ADMIN can edit from
-- /admin/accounts. Runtime authorization reads this table on every protected request, so changes
-- take effect without a deployment or session reset.

CREATE TABLE admin_role_permissions (
  role TEXT NOT NULL CHECK (role IN ('OPERATOR', 'MODERATOR', 'SYSTEM_DEVELOPER')),
  permission TEXT NOT NULL,
  granted_by_admin_id INTEGER,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (role, permission),
  FOREIGN KEY (granted_by_admin_id) REFERENCES admin_accounts(id) ON DELETE SET NULL
);

CREATE INDEX idx_admin_role_permissions_role
  ON admin_role_permissions(role);

-- Preserve the former code-defined bundles as initial data. SYSTEM_DEVELOPER now also enters the
-- unified Admin Center because the separate /system-dev role center is removed by this release.
INSERT INTO admin_role_permissions (role, permission, granted_by_admin_id, updated_at) VALUES
  ('OPERATOR', 'admin.center.access', NULL, datetime('now')),
  ('OPERATOR', 'users.view', NULL, datetime('now')),
  ('OPERATOR', 'users.suspend', NULL, datetime('now')),
  ('OPERATOR', 'users.ban', NULL, datetime('now')),
  ('OPERATOR', 'users.score_moderation', NULL, datetime('now')),
  ('OPERATOR', 'games.moderate', NULL, datetime('now')),
  ('OPERATOR', 'sandbox_games.review', NULL, datetime('now')),
  ('OPERATOR', 'sandbox_games.delete', NULL, datetime('now')),
  ('OPERATOR', 'game_creators.manage', NULL, datetime('now')),
  ('OPERATOR', 'streamers.review', NULL, datetime('now')),
  ('OPERATOR', 'system.monitor', NULL, datetime('now')),
  ('MODERATOR', 'admin.center.access', NULL, datetime('now')),
  ('MODERATOR', 'users.view', NULL, datetime('now')),
  ('MODERATOR', 'users.suspend', NULL, datetime('now')),
  ('MODERATOR', 'sandbox_games.review', NULL, datetime('now')),
  ('MODERATOR', 'streamers.review', NULL, datetime('now')),
  ('SYSTEM_DEVELOPER', 'admin.center.access', NULL, datetime('now')),
  ('SYSTEM_DEVELOPER', 'system.dev.access', NULL, datetime('now')),
  ('SYSTEM_DEVELOPER', 'system.monitor', NULL, datetime('now'));
