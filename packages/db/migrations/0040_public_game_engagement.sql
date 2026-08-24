-- Migration: 0040_public_game_engagement.sql
-- Public catalog engagement statistics.
--
-- `user_recent_plays` and `user_favorites` already store at most one row per (user, game slug),
-- so they are the canonical unique-player/current-bookmark facts. Public counts intentionally do
-- not add a second mutable aggregate table that could drift from those ledgers. These covering
-- indexes make the correlated count queries game-first instead of scanning the user-first PKs.

CREATE INDEX IF NOT EXISTS idx_user_recent_plays_game_user
  ON user_recent_plays(game_id, user_id);

CREATE INDEX IF NOT EXISTS idx_user_favorites_game_user
  ON user_favorites(game_id, user_id);
