import test from "node:test";
import assert from "node:assert/strict";
import { D1ProgressionRepository } from "../src/d1/D1ProgressionRepository.js";
import { createSqliteD1 } from "./helpers/sqliteD1.js";

const SCHEMA = `
CREATE TABLE user_progress (
  user_id INTEGER PRIMARY KEY,
  total_xp INTEGER NOT NULL DEFAULT 0,
  eligible_completions INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE TABLE xp_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  game_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(source_type, source_id)
);
CREATE INDEX idx_xp_events_user_created ON xp_events(user_id, created_at);
`;

test("daily activity counts accepted completions by UTC date and exact range", async () => {
  const { db, raw } = createSqliteD1(SCHEMA);
  const insert = raw.prepare(
    `INSERT INTO xp_events
       (user_id, amount, reason, source_type, source_id, game_id, created_at)
     VALUES (?, 0, ?, 'result', ?, 'aim-test', ?)`,
  );

  insert.run(1, "GAME_COMPLETION", "at-start", "2025-09-02T00:00:00.000Z");
  insert.run(1, "GAME_COMPLETION", "same-day", "2025-09-02T23:59:59.999Z");
  insert.run(1, "GAME_COMPLETION", "today", "2026-09-01T12:00:00.000Z");
  insert.run(1, "OTHER_REASON", "not-a-play", "2026-09-01T13:00:00.000Z");
  insert.run(2, "GAME_COMPLETION", "other-user", "2026-09-01T14:00:00.000Z");
  insert.run(1, "GAME_COMPLETION", "too-old", "2025-09-01T23:59:59.999Z");
  insert.run(1, "GAME_COMPLETION", "end-exclusive", "2026-09-02T00:00:00.000Z");

  const repository = new D1ProgressionRepository(db);
  assert.deepEqual(
    await repository.getDailyCompletionCounts({
      userId: 1,
      startIso: "2025-09-02T00:00:00.000Z",
      endExclusiveIso: "2026-09-02T00:00:00.000Z",
    }),
    [
      { date: "2025-09-02", playCount: 2 },
      { date: "2026-09-01", playCount: 1 },
    ],
  );
});
