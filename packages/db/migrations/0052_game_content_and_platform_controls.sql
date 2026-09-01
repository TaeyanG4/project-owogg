-- Localized game-description editing, creator cooldown, and operator feature switches.

ALTER TABLE games ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE games ADD COLUMN default_screen_mode TEXT NOT NULL DEFAULT 'default'
  CHECK (default_screen_mode IN ('default', 'theater'));
ALTER TABLE sandbox_games ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE sandbox_games ADD COLUMN default_screen_mode TEXT NOT NULL DEFAULT 'default'
  CHECK (default_screen_mode IN ('default', 'theater'));

CREATE TABLE game_content_edit_cooldowns (
  game_id INTEGER PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  edited_by_user_id INTEGER NOT NULL REFERENCES users(id),
  last_edited_at TEXT NOT NULL
);

CREATE TABLE platform_feature_settings (
  setting_key TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  updated_by_admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL,
  CHECK (setting_key IN ('MULTIPLAYER', 'EXTERNAL_PLATFORM_GAMES'))
);

-- Preserve the deployment-level MULTIPLAYER_ENABLED behavior until an operator disables it in D1.
-- External-platform navigation stays hidden until that product surface is ready.
INSERT INTO platform_feature_settings (setting_key, enabled, updated_by_admin_id, updated_at)
VALUES
  ('MULTIPLAYER', 1, NULL, datetime('now')),
  ('EXTERNAL_PLATFORM_GAMES', 0, NULL, datetime('now'));
