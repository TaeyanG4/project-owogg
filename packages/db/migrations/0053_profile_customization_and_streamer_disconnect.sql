-- Profile presentation, public contribution evidence, and releasable Streamer connections.
--
-- A Streamer disconnect intentionally removes only the active provider binding. Historical
-- scores remain in `scores`, so ordinary leaderboard history is preserved, while the current
-- Streamer ranking queries immediately stop selecting the user when no approved connection
-- remains. The immutable snapshot below keeps moderation/ownership evidence without retaining
-- the provider identity in the unique active-connection table.

ALTER TABLE users ADD COLUMN profile_banner TEXT NOT NULL DEFAULT 'AURORA'
  CHECK (profile_banner IN ('AURORA', 'SUNSET', 'MIDNIGHT', 'MINT'));
ALTER TABLE users ADD COLUMN profile_bio_markdown TEXT NOT NULL DEFAULT ''
  CHECK (length(profile_bio_markdown) <= 2000);

-- Evidence-backed contribution events. Product workflows can append an event when a bug report
-- is accepted or an introduced external-platform game is published; the public profile derives
-- counts from these rows instead of hard-coded values or editable counters.
CREATE TABLE profile_contribution_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contribution_type TEXT NOT NULL
    CHECK (contribution_type IN ('BUG_ACCEPTED', 'EXTERNAL_GAME_PUBLISHED')),
  source_key TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (contribution_type, source_key)
);

CREATE INDEX idx_profile_contribution_events_user
  ON profile_contribution_events(user_id, contribution_type, created_at DESC);

CREATE TABLE streamer_platform_connection_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Snapshot identifiers deliberately do not use foreign keys. Account merge/deletion must not
  -- rewrite or cascade-delete immutable moderation evidence.
  streamer_profile_id INTEGER,
  user_id INTEGER,
  platform_account_id INTEGER NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('YOUTUBE', 'CHZZK', 'TWITCH')),
  platform_user_id TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  channel_handle TEXT,
  channel_url TEXT NOT NULL,
  avatar_url TEXT,
  verification_status TEXT NOT NULL,
  verified_at TEXT,
  ownership_expires_at TEXT,
  approval_status TEXT NOT NULL,
  approval_reason_code TEXT,
  approved_at TEXT,
  audience_count INTEGER,
  channel_created_at TEXT,
  metrics_synced_at TEXT,
  connected_at TEXT NOT NULL,
  last_updated_at TEXT NOT NULL,
  review_snapshot_json TEXT NOT NULL DEFAULT '[]',
  disconnected_by_user_id INTEGER,
  disconnect_actor_type TEXT NOT NULL CHECK (disconnect_actor_type IN ('SELF', 'ADMIN')),
  disconnect_reason TEXT NOT NULL,
  disconnected_at TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  UNIQUE (correlation_id, platform_account_id)
);

CREATE INDEX idx_streamer_connection_history_correlation
  ON streamer_platform_connection_history(correlation_id);
CREATE INDEX idx_streamer_connection_history_user
  ON streamer_platform_connection_history(user_id, disconnected_at DESC);
CREATE INDEX idx_streamer_connection_history_identity
  ON streamer_platform_connection_history(platform, platform_user_id, disconnected_at DESC);

CREATE TRIGGER prevent_streamer_connection_history_update
BEFORE UPDATE ON streamer_platform_connection_history
BEGIN
  SELECT RAISE(ABORT, 'streamer connection history is immutable');
END;

CREATE TRIGGER prevent_streamer_connection_history_delete
BEFORE DELETE ON streamer_platform_connection_history
BEGIN
  SELECT RAISE(ABORT, 'streamer connection history is immutable');
END;
