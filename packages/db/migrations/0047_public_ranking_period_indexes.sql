-- Public rankings are scoped to the current KST day/week/month and select one PB per user.
-- These indexes keep those edge-cached reads bounded without introducing a duplicate aggregate
-- table: scores and xp_events remain the auditable sources of truth.
CREATE INDEX idx_scores_period_ranking
  ON scores(game_id, leaderboard_generation, difficulty, ruleset_revision, created_at, score)
  WHERE deleted_at IS NULL AND user_id IS NOT NULL;

CREATE INDEX idx_xp_events_period_ranking
  ON xp_events(created_at, user_id, amount)
  WHERE amount > 0;

CREATE INDEX idx_users_active_streak_ranking
  ON users(last_active_date, current_streak DESC)
  WHERE current_streak > 0;
