import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createSqliteD1 } from "./helpers/sqliteD1.js";

test("generic production migrations avoid Cloudflare-incompatible TEMP table DDL", () => {
  for (const filename of [
    "0030_user_identity_write_convergence.sql",
    "0031_game_version_write_convergence.sql",
    "0033_generic_game_assets.sql",
    "0034_unified_game_control_plane.sql",
    "0035_creator_manifest_results.sql",
  ]) {
    const sql = fs.readFileSync(new URL(`../migrations/${filename}`, import.meta.url), "utf8");
    assert.doesNotMatch(sql, /\bCREATE\s+TEMP(?:ORARY)?\s+TABLE\b/i, filename);
  }
});

test("0032 migrates one-use attempts to generic identity/version foreign keys", () => {
  const migration = fs.readFileSync(
    new URL("../migrations/0032_generic_score_acceptance.sql", import.meta.url),
    "utf8",
  );
  const { raw } = createSqliteD1(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    CREATE TABLE games (id INTEGER PRIMARY KEY);
    CREATE TABLE game_versions (id INTEGER PRIMARY KEY, game_id INTEGER NOT NULL);
    CREATE TABLE game_attempt_consumptions (
      attempt_id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      game_id INTEGER NOT NULL,
      version_id INTEGER NOT NULL,
      consumed_at TEXT NOT NULL
    );
  `);
  raw.exec("INSERT INTO users (id) VALUES (1)");
  raw.exec("INSERT INTO games (id) VALUES (9)");
  raw.exec("INSERT INTO game_versions (id, game_id) VALUES (5, 9)");
  raw.exec(
    "INSERT INTO game_attempt_consumptions (attempt_id, user_id, game_id, version_id, consumed_at) VALUES ('a', 1, 9, 5, 'now')",
  );

  raw.exec(migration);

  const row = raw
    .prepare("SELECT attempt_id, game_id, version_id FROM game_attempt_consumptions")
    .get() as { attempt_id: string; game_id: number; version_id: number };
  assert.deepEqual({ ...row }, { attempt_id: "a", game_id: 9, version_id: 5 });
  assert.throws(() =>
    raw
      .prepare(
        "INSERT INTO game_attempt_consumptions (attempt_id, user_id, game_id, version_id, consumed_at) VALUES ('orphan', 1, 99, 99, 'now')",
      )
      .run(),
  );
});

test("0033 backfills USER logos and keeps legacy logo writes converged with fail-closed conflicts", () => {
  const migration = fs.readFileSync(
    new URL("../migrations/0033_generic_game_assets.sql", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(migration, /\bCREATE\s+TEMP(?:ORARY)?\s+TABLE\b/i);

  const { raw } = createSqliteD1(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE games (
      id INTEGER PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      publisher_type TEXT NOT NULL,
      publisher_user_id INTEGER,
      visibility TEXT NOT NULL,
      live_version_id INTEGER,
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE sandbox_games (
      id INTEGER PRIMARY KEY,
      slug TEXT NOT NULL,
      developer_user_id INTEGER NOT NULL,
      logo_key TEXT,
      updated_at TEXT NOT NULL
    );
  `);
  raw
    .prepare(
      "INSERT INTO games (id, slug, publisher_type, publisher_user_id, visibility, created_at, updated_at) VALUES (8, 'user-game', 'USER', 42, 'PRIVATE', 'now', 'now')",
    )
    .run();
  raw
    .prepare(
      "INSERT INTO sandbox_games (id, slug, developer_user_id, logo_key, updated_at) VALUES (8, 'user-game', 42, 'uploads/8/logo.svg', '2026-08-21T00:00:00.000Z')",
    )
    .run();

  raw.exec(migration);
  const assetRow = raw.prepare("SELECT game_id, kind, object_key FROM game_assets").get() as {
    game_id: number;
    kind: string;
    object_key: string;
  };
  assert.equal(assetRow.game_id, 8);
  assert.equal(assetRow.kind, "LOGO");
  assert.equal(assetRow.object_key, "uploads/8/logo.svg");
  assert.equal(
    raw
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_migration_0033_asset_guard'",
      )
      .get(),
    undefined,
  );

  raw
    .prepare("UPDATE sandbox_games SET logo_key = 'uploads/8/logo.svg', updated_at = 'later'")
    .run();
  assert.equal(
    raw.prepare("SELECT updated_at FROM game_assets WHERE game_id = 8").get()?.updated_at,
    "later",
  );
  assert.throws(() =>
    raw.prepare("UPDATE sandbox_games SET logo_key = 'uploads/8/other.svg'").run(),
  );
  raw.prepare("UPDATE sandbox_games SET logo_key = NULL").run();
  assert.equal(raw.prepare("SELECT * FROM game_assets").get(), undefined);

  // If the legacy identity trigger runs after the logo trigger, the later generic identity insert
  // still converges the asset instead of losing it or violating the game_assets FK.
  raw
    .prepare(
      "INSERT INTO sandbox_games (id, slug, developer_user_id, logo_key, updated_at) VALUES (11, 'late-game', 7, 'uploads/11/logo.svg', 'later')",
    )
    .run();
  raw
    .prepare(
      "INSERT INTO games (id, slug, publisher_type, publisher_user_id, visibility, created_at, updated_at) VALUES (11, 'late-game', 'USER', 7, 'PRIVATE', 'now', 'now')",
    )
    .run();
  assert.equal(
    raw.prepare("SELECT object_key FROM game_assets WHERE game_id = 11").get()?.object_key,
    "uploads/11/logo.svg",
  );
});

test("0033 migration guard aborts when a legacy logo cannot be tied to the exact USER authority", () => {
  const migration = fs.readFileSync(
    new URL("../migrations/0033_generic_game_assets.sql", import.meta.url),
    "utf8",
  );
  const { raw } = createSqliteD1(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE games (
      id INTEGER PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      publisher_type TEXT NOT NULL,
      publisher_user_id INTEGER,
      visibility TEXT NOT NULL,
      live_version_id INTEGER,
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE sandbox_games (
      id INTEGER PRIMARY KEY,
      slug TEXT NOT NULL,
      developer_user_id INTEGER NOT NULL,
      logo_key TEXT,
      updated_at TEXT NOT NULL
    );
  `);
  raw
    .prepare(
      "INSERT INTO games (id, slug, publisher_type, publisher_user_id, visibility, created_at, updated_at) VALUES (8, 'conflict', 'USER', 99, 'PRIVATE', 'now', 'now')",
    )
    .run();
  raw
    .prepare(
      "INSERT INTO sandbox_games (id, slug, developer_user_id, logo_key, updated_at) VALUES (8, 'conflict', 42, 'uploads/8/logo.svg', 'now')",
    )
    .run();

  assert.throws(() => raw.exec(migration), /must_be_zero = 0/);
});
