-- External-platform game introductions are a reviewed CRUD surface, not OwOGG runtime games.
-- They intentionally do not participate in games/game_versions, score, XP, or game sessions.

CREATE TABLE external_games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE
    CHECK (length(slug) BETWEEN 3 AND 48 AND slug = lower(slug)),
  introducer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 2 AND 120),
  short_description TEXT NOT NULL CHECK (length(short_description) BETWEEN 1 AND 240),
  description_markdown TEXT NOT NULL CHECK (length(description_markdown) BETWEEN 1 AND 20000),
  platform_name TEXT NOT NULL CHECK (length(platform_name) BETWEEN 1 AND 60),
  external_url TEXT NOT NULL CHECK (length(external_url) BETWEEN 8 AND 2048),
  release_date TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  ownership_type TEXT NOT NULL
    CHECK (ownership_type IN ('OWN_GAME', 'THIRD_PARTY')),
  rights_note TEXT NOT NULL DEFAULT '' CHECK (length(rights_note) <= 1000),
  rights_attested_at TEXT,
  moderation_status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (moderation_status IN ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED')),
  visibility TEXT NOT NULL DEFAULT 'PRIVATE'
    CHECK (visibility IN ('PRIVATE', 'PUBLIC')),
  review_slot INTEGER CHECK (review_slot BETWEEN 1 AND 3),
  reject_reason TEXT,
  reviewed_by_admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  published_at TEXT,
  deleted_at TEXT,
  deleted_by_admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((moderation_status = 'PENDING_REVIEW') = (review_slot IS NOT NULL)),
  CHECK (visibility = 'PRIVATE' OR (
    moderation_status = 'APPROVED' AND published_at IS NOT NULL AND deleted_at IS NULL
  ))
);

-- A real database invariant prevents concurrent submit requests from exceeding three reviews.
CREATE UNIQUE INDEX idx_external_games_review_slot
  ON external_games(introducer_user_id, review_slot)
  WHERE review_slot IS NOT NULL;
CREATE INDEX idx_external_games_public
  ON external_games(visibility, moderation_status, published_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_external_games_introducer
  ON external_games(introducer_user_id, updated_at DESC);
CREATE INDEX idx_external_games_review_queue
  ON external_games(moderation_status, updated_at ASC)
  WHERE deleted_at IS NULL;

CREATE TABLE external_game_media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_game_id INTEGER NOT NULL REFERENCES external_games(id) ON DELETE CASCADE,
  media_kind TEXT NOT NULL CHECK (media_kind IN ('BANNER', 'SCREENSHOT')),
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL
    CHECK (content_type IN ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif')),
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 5242880),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  alt_text TEXT NOT NULL DEFAULT '' CHECK (length(alt_text) <= 160),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 99),
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_external_game_single_banner
  ON external_game_media(external_game_id)
  WHERE media_kind = 'BANNER';
CREATE TRIGGER trg_external_game_media_max_screenshots
BEFORE INSERT ON external_game_media
WHEN NEW.media_kind = 'SCREENSHOT' AND (
  SELECT COUNT(*) FROM external_game_media
   WHERE external_game_id = NEW.external_game_id AND media_kind = 'SCREENSHOT'
) >= 8
BEGIN
  SELECT RAISE(ABORT, 'external game screenshot limit');
END;
CREATE INDEX idx_external_game_media_order
  ON external_game_media(external_game_id, media_kind, sort_order, id);

CREATE TABLE external_game_bookmarks (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  external_game_id INTEGER NOT NULL REFERENCES external_games(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, external_game_id)
);
CREATE INDEX idx_external_game_bookmarks_game
  ON external_game_bookmarks(external_game_id, created_at DESC);

CREATE TABLE external_game_review_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_game_id INTEGER NOT NULL REFERENCES external_games(id) ON DELETE CASCADE,
  actor_admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('APPROVED', 'REJECTED', 'VISIBILITY_CHANGED', 'DELETED')),
  reason TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_external_game_review_audit_game
  ON external_game_review_audit(external_game_id, created_at DESC);
