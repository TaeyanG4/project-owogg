-- Migration: 0036_official_game_lifecycle.sql
-- Official game B2/D1 deletion audit plus version-scoped leaderboard generations.
--
-- Score rows remain an immutable history. Switching a live version increments the owning game's
-- generation, and every leaderboard projection records the generation current at acceptance.
-- Reads join against the current generation, which resets all public/personal leaderboards
-- without conflating version rollout with user-moderation soft deletion.

ALTER TABLE games ADD COLUMN leaderboard_generation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE scores ADD COLUMN leaderboard_generation INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_scores_game_generation_difficulty_score
  ON scores(game_id, leaderboard_generation, difficulty, score);

-- During the migration/new-Worker deployment gap an old Worker still omits the new score column.
-- Converge that write to the live game's generation. New Workers already insert the exact value,
-- so the WHEN predicate is false and the trigger performs no extra UPDATE for them.
CREATE TRIGGER trg_scores_after_insert_generation
AFTER INSERT ON scores
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM games
  WHERE slug = NEW.game_id
    AND deleted_at IS NULL
    AND leaderboard_generation IS NOT NEW.leaderboard_generation
)
BEGIN
  UPDATE scores
  SET leaderboard_generation = (
    SELECT leaderboard_generation FROM games
    WHERE slug = NEW.game_id AND deleted_at IS NULL
  )
  WHERE id = NEW.id;
END;

CREATE TABLE official_game_deletion_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL,
  slug TEXT NOT NULL,
  actor_admin_id INTEGER NOT NULL,
  version_count INTEGER NOT NULL,
  object_count INTEGER NOT NULL,
  deleted_at TEXT NOT NULL,
  CHECK (game_id > 0),
  CHECK (length(slug) > 0),
  CHECK (actor_admin_id > 0),
  CHECK (version_count >= 0),
  CHECK (object_count >= 0),
  CHECK (length(deleted_at) > 0)
);

CREATE INDEX idx_official_game_deletion_audit_slug
  ON official_game_deletion_audit_log(slug, deleted_at DESC);

-- Replace the rolling-deploy compatibility triggers introduced in 0034. An old Worker still
-- writes sandbox_games first; that change bumps the generic generation exactly once. The new
-- Worker writes games first and then the compatibility mirror, so the trigger observes the same
-- live version and does not double-increment.
DROP TRIGGER trg_sandbox_games_after_insert;
DROP TRIGGER trg_sandbox_games_after_update;

CREATE TRIGGER trg_sandbox_games_after_insert
AFTER INSERT ON sandbox_games
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Authority conflict: cannot insert USER game on top of OWOGG identity')
  WHERE EXISTS (SELECT 1 FROM games WHERE id = NEW.id AND publisher_type = 'OWOGG');

  INSERT INTO games (
    id, slug, publisher_type, publisher_user_id, visibility, live_version_id, deleted_at,
    created_at, updated_at, title, short_description, description, genre, mode,
    xp_per_completion, score_unit, score_direction, score_min, score_max,
    score_display_prefix, score_display_suffix, review_slot, deleted_by_admin_id
  ) VALUES (
    NEW.id, NEW.slug, 'USER', NEW.developer_user_id, NEW.visibility, NEW.live_version_id,
    NEW.deleted_at, NEW.created_at, NEW.updated_at, NEW.title, NEW.short_description,
    NEW.description, NEW.genre, NEW.mode, NEW.xp_per_completion, NEW.score_unit,
    NEW.score_direction, NEW.score_min, NEW.score_max, NEW.score_display_prefix,
    NEW.score_display_suffix, NEW.review_slot, NEW.deleted_by_admin_id
  )
  ON CONFLICT(id) DO UPDATE SET
    leaderboard_generation = games.leaderboard_generation +
      CASE WHEN games.live_version_id IS NOT NEW.live_version_id THEN 1 ELSE 0 END,
    slug = NEW.slug, publisher_type = 'USER', publisher_user_id = NEW.developer_user_id,
    visibility = NEW.visibility, live_version_id = NEW.live_version_id,
    deleted_at = NEW.deleted_at, created_at = NEW.created_at, updated_at = NEW.updated_at,
    title = NEW.title, short_description = NEW.short_description,
    description = NEW.description, genre = NEW.genre, mode = NEW.mode,
    xp_per_completion = NEW.xp_per_completion, score_unit = NEW.score_unit,
    score_direction = NEW.score_direction, score_min = NEW.score_min, score_max = NEW.score_max,
    score_display_prefix = NEW.score_display_prefix, score_display_suffix = NEW.score_display_suffix,
    review_slot = NEW.review_slot, deleted_by_admin_id = NEW.deleted_by_admin_id
  WHERE games.publisher_type = 'USER';
END;

CREATE TRIGGER trg_sandbox_games_after_update
AFTER UPDATE ON sandbox_games
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Authority conflict: cannot update USER game on top of OWOGG identity')
  WHERE EXISTS (SELECT 1 FROM games WHERE id = OLD.id AND publisher_type = 'OWOGG');

  INSERT INTO games (
    id, slug, publisher_type, publisher_user_id, visibility, live_version_id, deleted_at,
    created_at, updated_at, title, short_description, description, genre, mode,
    xp_per_completion, score_unit, score_direction, score_min, score_max,
    score_display_prefix, score_display_suffix, review_slot, deleted_by_admin_id
  ) VALUES (
    OLD.id, NEW.slug, 'USER', NEW.developer_user_id, NEW.visibility, NEW.live_version_id,
    NEW.deleted_at, NEW.created_at, NEW.updated_at, NEW.title, NEW.short_description,
    NEW.description, NEW.genre, NEW.mode, NEW.xp_per_completion, NEW.score_unit,
    NEW.score_direction, NEW.score_min, NEW.score_max, NEW.score_display_prefix,
    NEW.score_display_suffix, NEW.review_slot, NEW.deleted_by_admin_id
  )
  ON CONFLICT(id) DO UPDATE SET
    leaderboard_generation = games.leaderboard_generation +
      CASE WHEN games.live_version_id IS NOT NEW.live_version_id THEN 1 ELSE 0 END,
    slug = NEW.slug, publisher_type = 'USER', publisher_user_id = NEW.developer_user_id,
    visibility = NEW.visibility, live_version_id = NEW.live_version_id,
    deleted_at = NEW.deleted_at, created_at = NEW.created_at, updated_at = NEW.updated_at,
    title = NEW.title, short_description = NEW.short_description,
    description = NEW.description, genre = NEW.genre, mode = NEW.mode,
    xp_per_completion = NEW.xp_per_completion, score_unit = NEW.score_unit,
    score_direction = NEW.score_direction, score_min = NEW.score_min, score_max = NEW.score_max,
    score_display_prefix = NEW.score_display_prefix, score_display_suffix = NEW.score_display_suffix,
    review_slot = NEW.review_slot, deleted_by_admin_id = NEW.deleted_by_admin_id
  WHERE games.publisher_type = 'USER';
END;
