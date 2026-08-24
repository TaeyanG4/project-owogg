import assert from "node:assert/strict";
import test from "node:test";
import { D1PublicGameMetricsRepository } from "../src/d1/D1PublicGameMetricsRepository.js";
import { createSqliteD1 } from "./helpers/sqliteD1.js";

const SCHEMA = `
CREATE TABLE user_recent_plays (
  user_id INTEGER NOT NULL,
  game_id TEXT NOT NULL,
  last_played_at TEXT NOT NULL,
  PRIMARY KEY (user_id, game_id)
);
CREATE TABLE user_favorites (
  user_id INTEGER NOT NULL,
  game_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, game_id)
);
CREATE INDEX idx_user_recent_plays_game_user ON user_recent_plays(game_id, user_id);
CREATE INDEX idx_user_favorites_game_user ON user_favorites(game_id, user_id);
`;

test("public game metrics count unique players and current bookmarks for every requested slug", async () => {
  const { db, raw } = createSqliteD1(SCHEMA);
  const recent = raw.prepare(
    "INSERT INTO user_recent_plays (user_id, game_id, last_played_at) VALUES (?, ?, ?)",
  );
  const favorite = raw.prepare(
    "INSERT INTO user_favorites (user_id, game_id, created_at) VALUES (?, ?, ?)",
  );
  recent.run(1, "reaction-time", "2026-08-24T00:00:00.000Z");
  recent.run(2, "reaction-time", "2026-08-25T00:00:00.000Z");
  recent.run(1, "typing-test", "2026-08-25T00:00:00.000Z");
  favorite.run(1, "reaction-time", "2026-08-24T00:00:00.000Z");
  favorite.run(1, "typing-test", "2026-08-24T00:00:00.000Z");
  favorite.run(2, "typing-test", "2026-08-25T00:00:00.000Z");

  const rows = await new D1PublicGameMetricsRepository(db).findBySlugs([
    "reaction-time",
    "typing-test",
    "new-game",
    "reaction-time",
  ]);

  assert.deepEqual(rows, [
    { slug: "reaction-time", playerCount: 2, bookmarkCount: 1 },
    { slug: "typing-test", playerCount: 1, bookmarkCount: 2 },
    { slug: "new-game", playerCount: 0, bookmarkCount: 0 },
  ]);
});
