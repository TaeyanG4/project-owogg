-- GitHub-style player follows. The relationship is directional: follower_user_id follows
-- followed_user_id. Historical game/ranking records are unaffected when a relationship changes.

CREATE TABLE user_follows (
  follower_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followed_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (follower_user_id, followed_user_id),
  CHECK (follower_user_id <> followed_user_id)
) STRICT;

CREATE INDEX idx_user_follows_followers
  ON user_follows(followed_user_id, created_at DESC, follower_user_id DESC);

CREATE INDEX idx_user_follows_following
  ON user_follows(follower_user_id, created_at DESC, followed_user_id DESC);
