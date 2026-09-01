import test from "node:test";
import assert from "node:assert/strict";
import { D1PublicProfileInsightsRepository } from "../src/d1/D1PublicProfileInsightsRepository.js";
import { createSqliteD1 } from "./helpers/sqliteD1.js";

const SCHEMA = `
CREATE TABLE users (id INTEGER PRIMARY KEY, nickname TEXT NOT NULL);
CREATE TABLE games (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL,
  publisher_type TEXT NOT NULL,
  publisher_user_id INTEGER,
  visibility TEXT NOT NULL,
  live_version_id INTEGER,
  deleted_at TEXT
);
CREATE TABLE profile_contribution_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  contribution_type TEXT NOT NULL,
  source_key TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);
`;

test("public profile insights count evidence and only live public creator games", async () => {
  const { db, raw } = createSqliteD1(SCHEMA);
  raw.prepare("INSERT INTO users (id, nickname) VALUES (7, 'creator'), (8, 'other')").run();
  raw
    .prepare(
      `INSERT INTO profile_contribution_events
         (user_id, contribution_type, source_key, created_at)
       VALUES
         (7, 'BUG_ACCEPTED', 'bug-1', '2026-09-01T00:00:00.000Z'),
         (7, 'BUG_ACCEPTED', 'bug-2', '2026-09-01T00:00:00.000Z'),
         (7, 'EXTERNAL_GAME_PUBLISHED', 'external-1', '2026-09-01T00:00:00.000Z'),
         (8, 'BUG_ACCEPTED', 'other-bug', '2026-09-01T00:00:00.000Z')`,
    )
    .run();
  raw
    .prepare(
      `INSERT INTO games
         (id, slug, publisher_type, publisher_user_id, visibility, live_version_id, deleted_at)
       VALUES
         (1, 'public-live', 'USER', 7, 'PUBLIC', 11, NULL),
         (2, 'private-live', 'USER', 7, 'PRIVATE', 12, NULL),
         (3, 'public-draft', 'USER', 7, 'PUBLIC', NULL, NULL),
         (4, 'public-deleted', 'USER', 7, 'PUBLIC', 14, '2026-09-01T00:00:00.000Z'),
         (5, 'official', 'OWOGG', NULL, 'PUBLIC', 15, NULL),
         (6, 'other-owner', 'USER', 8, 'PUBLIC', 16, NULL)`,
    )
    .run();

  assert.deepEqual(await new D1PublicProfileInsightsRepository(db).getByUserId(7), {
    bugAcceptedCount: 2,
    createdGameCount: 1,
    introducedExternalGameCount: 1,
  });
});
