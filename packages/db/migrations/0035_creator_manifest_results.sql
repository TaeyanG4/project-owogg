-- Migration: 0035_creator_manifest_results.sql
-- Creator Manifest v1 result authority. Additive only: the existing score tables/endpoints remain
-- available during rollout, while new OWOGG.complete payloads are recorded as complete facts.

CREATE TABLE game_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  version_id INTEGER NOT NULL REFERENCES game_versions(id) ON DELETE CASCADE,
  outcome TEXT,
  raw_score REAL,
  normalized_score REAL,
  progression_value REAL,
  metrics_json TEXT NOT NULL DEFAULT '{}',
  events_json TEXT NOT NULL DEFAULT '{}',
  difficulty TEXT NOT NULL DEFAULT 'normal',
  adjusted INTEGER NOT NULL DEFAULT 0 CHECK (adjusted IN (0, 1)),
  adjustment_reason TEXT,
  reward_eligible INTEGER NOT NULL DEFAULT 1 CHECK (reward_eligible IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_game_results_user_game_created
  ON game_results(user_id, game_id, created_at DESC);
CREATE INDEX idx_game_results_game_created
  ON game_results(game_id, created_at DESC);

ALTER TABLE scores ADD COLUMN result_id INTEGER REFERENCES game_results(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX idx_scores_result_id
  ON scores(result_id)
  WHERE result_id IS NOT NULL;

CREATE TABLE user_game_achievements (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL,
  unlocked_at TEXT NOT NULL,
  source_result_id INTEGER NOT NULL REFERENCES game_results(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, game_id, achievement_id)
);

CREATE INDEX idx_user_game_achievements_user_unlocked
  ON user_game_achievements(user_id, unlocked_at DESC);
