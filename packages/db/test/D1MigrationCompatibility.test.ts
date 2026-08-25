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
    "0036_official_game_lifecycle.sql",
    "0037_user_profile_identity.sql",
    "0038_admin_role_permissions.sql",
    "0039_streamer_terminology.sql",
    "0040_public_game_engagement.sql",
    "0041_multiplayer_foundation.sql",
  ]) {
    const sql = fs.readFileSync(new URL(`../migrations/${filename}`, import.meta.url), "utf8");
    assert.doesNotMatch(sql, /\bCREATE\s+TEMP(?:ORARY)?\s+TABLE\b/i, filename);
  }
});

test("full production migration chain applies through 0041 with multiplayer and Streamer compatibility schema", () => {
  const { raw } = createSqliteD1("");
  const migrationUrl = new URL("../migrations/", import.meta.url);
  const filenames = fs
    .readdirSync(migrationUrl)
    .filter((filename) => filename.endsWith(".sql"))
    .sort();
  for (const filename of filenames) {
    raw.exec(fs.readFileSync(new URL(filename, migrationUrl), "utf8"));
  }

  const gameColumns = raw.prepare("PRAGMA table_info(games)").all() as Array<{ name: string }>;
  const scoreColumns = raw.prepare("PRAGMA table_info(scores)").all() as Array<{ name: string }>;
  const userColumns = raw.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
  const oauthColumns = raw.prepare("PRAGMA table_info(oauth_accounts)").all() as Array<{
    name: string;
  }>;
  assert.ok(gameColumns.some((column) => column.name === "leaderboard_generation"));
  assert.ok(scoreColumns.some((column) => column.name === "leaderboard_generation"));
  assert.ok(userColumns.some((column) => column.name === "avatar_provider"));
  assert.ok(oauthColumns.some((column) => column.name === "avatar_url"));
  const rolePermissions = raw
    .prepare(
      "SELECT role, permission FROM admin_role_permissions WHERE role = 'SYSTEM_DEVELOPER' ORDER BY permission",
    )
    .all() as Array<{ role: string; permission: string }>;
  assert.deepEqual(
    rolePermissions.map((row) => row.permission),
    ["admin.center.access", "system.dev.access", "system.monitor"],
  );
  assert.ok(
    raw
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'official_game_deletion_audit_log'",
      )
      .get(),
  );
  assert.ok(
    raw
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'streamer_profiles'")
      .get(),
  );
  assert.ok(
    raw
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'view' AND name = 'creator_profiles'")
      .get(),
  );
  raw.prepare("INSERT INTO users (id, nickname) VALUES (1, 'compat-streamer')").run();
  raw
    .prepare(
      `INSERT INTO creator_profiles
         (user_id, status, featured_status, created_at, updated_at)
       VALUES (1, 'PENDING', 'NONE', 'now', 'now')`,
    )
    .run();
  const compatibilityStreamer = raw
    .prepare("SELECT user_id, status FROM streamer_profiles WHERE user_id = 1")
    .get() as { user_id: number; status: string };
  assert.deepEqual({ ...compatibilityStreamer }, { user_id: 1, status: "PENDING" });
  const updateTrigger = raw
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_sandbox_games_after_update'",
    )
    .get() as { sql: string };
  assert.match(updateTrigger.sql, /leaderboard_generation/);

  raw
    .prepare(
      `INSERT INTO games
         (slug, publisher_type, publisher_user_id, visibility, created_at, updated_at,
          leaderboard_generation)
       VALUES ('rolling-official', 'OWOGG', NULL, 'PRIVATE', 'now', 'now', 4)`,
    )
    .run();
  raw.prepare("INSERT INTO users (nickname) VALUES ('rolling-player')").run();
  raw
    .prepare(
      "INSERT INTO scores (user_id, game_id, score) VALUES (last_insert_rowid(), 'rolling-official', 123)",
    )
    .run();
  const rollingScore = raw
    .prepare("SELECT leaderboard_generation FROM scores WHERE game_id = 'rolling-official'")
    .get() as { leaderboard_generation: number };
  assert.equal(rollingScore.leaderboard_generation, 4);
});

test("0037 preserves the current avatar while backfilling provider-specific choices", () => {
  const { raw } = createSqliteD1(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nickname TEXT NOT NULL,
      avatar_url TEXT
    );
    CREATE TABLE oauth_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      provider_user_id TEXT NOT NULL,
      provider_email TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(provider, provider_user_id)
    );
    INSERT INTO users (id, nickname, avatar_url)
    VALUES (123, 'Taeyang', 'https://old.example/avatar.png');
    INSERT INTO oauth_accounts
      (user_id, provider, provider_user_id, provider_email, created_at)
    VALUES
      (123, 'google', 'google-123', NULL, '2026-01-01T00:00:00.000Z'),
      (123, 'discord', 'discord-123', NULL, '2026-01-02T00:00:00.000Z');
  `);
  raw.exec(
    fs.readFileSync(
      new URL("../migrations/0037_user_profile_identity.sql", import.meta.url),
      "utf8",
    ),
  );

  const user = raw
    .prepare("SELECT avatar_url, avatar_provider FROM users WHERE id = 123")
    .get() as {
    avatar_url: string;
    avatar_provider: string;
  };
  const accounts = raw
    .prepare("SELECT provider, avatar_url FROM oauth_accounts WHERE user_id = 123 ORDER BY id")
    .all() as Array<{ provider: string; avatar_url: string }>;
  assert.equal(user.avatar_url, "https://old.example/avatar.png");
  assert.equal(user.avatar_provider, "google");
  assert.deepEqual(
    accounts.map((account) => ({ ...account })),
    [
      { provider: "google", avatar_url: "https://old.example/avatar.png" },
      { provider: "discord", avatar_url: "https://old.example/avatar.png" },
    ],
  );
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
