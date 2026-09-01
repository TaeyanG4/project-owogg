import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { D1AccountMergeRepository } from "../src/d1/D1AccountMergeRepository.js";
import { createSqliteD1 } from "./helpers/sqliteD1.js";

function createMigratedD1() {
  const result = createSqliteD1("PRAGMA foreign_keys = ON;");
  const migrationUrl = new URL("../migrations/", import.meta.url);
  for (const filename of fs
    .readdirSync(migrationUrl)
    .filter((value) => value.endsWith(".sql"))
    .sort()) {
    result.raw.exec(fs.readFileSync(new URL(filename, migrationUrl), "utf8"));
  }
  return result;
}

test("account merge unions follow edges without duplicates or accidental self-follows", async () => {
  const { db, raw } = createMigratedD1();
  raw.prepare("INSERT INTO users (id, nickname) VALUES (1, 'Primary')").run();
  raw.prepare("INSERT INTO users (id, nickname) VALUES (2, 'Secondary')").run();
  raw.prepare("INSERT INTO users (id, nickname) VALUES (3, 'External')").run();

  const insert = raw.prepare(
    `INSERT INTO user_follows (follower_user_id, followed_user_id, created_at)
     VALUES (?, ?, ?)`,
  );
  insert.run(1, 3, "2026-09-01T00:00:00.000Z");
  insert.run(2, 3, "2026-09-01T01:00:00.000Z");
  insert.run(3, 2, "2026-09-01T02:00:00.000Z");
  insert.run(1, 2, "2026-09-01T03:00:00.000Z");
  insert.run(2, 1, "2026-09-01T04:00:00.000Z");
  raw
    .prepare(
      `INSERT INTO account_merge_challenges
         (id, user_a, user_b, provider, provider_user_id, created_at, expires_at)
       VALUES ('follow-merge', 1, 2, 'discord', 'secondary', ?, ?)`,
    )
    .run("2026-09-01T00:00:00.000Z", "2099-01-01T00:00:00.000Z");

  await new D1AccountMergeRepository(db).mergeAccounts(1, 2, "follow-merge");

  assert.deepEqual(
    raw
      .prepare(
        "SELECT follower_user_id, followed_user_id FROM user_follows ORDER BY follower_user_id, followed_user_id",
      )
      .all()
      .map((row) => ({ ...row })),
    [
      { follower_user_id: 1, followed_user_id: 3 },
      { follower_user_id: 3, followed_user_id: 1 },
    ],
  );
  assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM users WHERE id = 2").get()?.count, 0);
  assert.deepEqual(
    raw
      .prepare("PRAGMA foreign_key_check")
      .all()
      .map((row) => ({ ...row })),
    [],
  );
});
