// eslint-disable-next-line import/no-unresolved -- Node 22 built-in, requires --experimental-sqlite
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import type { D1Database, D1PreparedStatement } from "../../src/d1/D1UserRepository.js";

export interface SqliteD1TestOptions {
  /** Override D1's billing-oriented rows_written count while preserving statement changes. */
  readonly rowsWrittenForChanges?: (changes: number) => number;
}

/**
 * Real SQLite-backed D1Database test double (Node's built-in `node:sqlite`, no native
 * dependency — run with NODE_OPTIONS=--experimental-sqlite, see package.json `test` script).
 *
 * The hand-rolled in-memory mocks used elsewhere in this package re-implement application
 * logic in JS and therefore cannot catch SQL-level regressions (bad window function syntax,
 * wrong JOIN cardinality, wrong bind order). This adapter runs the *actual* production SQL
 * text against a real SQLite engine — the same dialect Cloudflare D1 uses — so leaderboard
 * correctness tests exercise the real query, not a re-implementation of it.
 */
export function createSqliteD1(
  schemaSql: string,
  options: SqliteD1TestOptions = {},
): { db: D1Database; raw: DatabaseSync } {
  const raw = new DatabaseSync(":memory:");
  raw.exec(schemaSql);

  const db: D1Database = {
    prepare(query: string): D1PreparedStatement {
      const stmt = raw.prepare(query);
      let bound: unknown[] = [];
      const runSync = () => {
        const info = stmt.run(...(bound as never[]));
        const changes = Number(info.changes);
        // Cloudflare rows_written includes index maintenance while node:sqlite only exposes the
        // statement's changed table rows. Most tests mirror the simple case; focused tests can
        // inflate rows_written to exercise the real D1 distinction.
        return {
          success: true,
          meta: {
            changes,
            rows_written: options.rowsWrittenForChanges?.(changes) ?? changes,
            last_row_id: Number(info.lastInsertRowid),
          },
        };
      };
      const batchSync = () => {
        if (/\bRETURNING\b/i.test(query) || /^\s*SELECT\b/i.test(query)) {
          const rows = stmt.all(...(bound as never[])) as Record<string, unknown>[];
          const lastRow = rows.at(-1);
          return {
            success: true,
            results: rows,
            meta: {
              changes: rows.length,
              rows_written: rows.length,
              last_row_id: typeof lastRow?.id === "number" ? Number(lastRow.id) : undefined,
            },
          };
        }
        return runSync();
      };
      const wrapper: D1PreparedStatement & { __batchSync: typeof batchSync } = {
        bind(...values: unknown[]) {
          bound = values;
          return wrapper;
        },
        async first<T>(): Promise<T | null> {
          const row = stmt.get(...(bound as never[]));
          return (row ?? null) as T | null;
        },
        async all<T>(): Promise<{ results: T[] }> {
          const rows = stmt.all(...(bound as never[]));
          return { results: rows as T[] };
        },
        async run() {
          return runSync();
        },
        // Batch-only escape hatch — see batch() below for why this exists.
        __batchSync: batchSync,
      };
      return wrapper;
    },
    async batch(statements: D1PreparedStatement[]) {
      // Real D1 executes an entire batch() call as one atomic transaction — no other concurrent
      // request can interleave, and any statement failure rolls back all statements in the batch.
      raw.exec("BEGIN TRANSACTION;");
      try {
        const results = statements.map((s) =>
          (s as D1PreparedStatement & { __batchSync: () => unknown }).__batchSync(),
        );
        raw.exec("COMMIT;");
        return results;
      } catch (err) {
        raw.exec("ROLLBACK;");
        throw err;
      }
    },
  };

  return { db, raw };
}

/** Minimal schema covering the tables the leaderboard/ranking queries touch. */
export const LEADERBOARD_TEST_SCHEMA = `
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname TEXT NOT NULL,
  email TEXT,
  avatar_url TEXT,
  country TEXT,
  current_streak INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  last_active_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  deleted_at TEXT,
  leaderboard_generation INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  nickname TEXT NOT NULL DEFAULT '게스트',
  avatar_url TEXT,
  game_id TEXT NOT NULL,
  score INTEGER NOT NULL,
  difficulty TEXT NOT NULL DEFAULT 'normal',
  variant_id TEXT NOT NULL DEFAULT 'standard',
  ruleset_revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  deleted_by_admin_id INTEGER,
  leaderboard_generation INTEGER NOT NULL DEFAULT 0
);

CREATE TRIGGER test_scores_ensure_game_identity
AFTER INSERT ON scores
FOR EACH ROW
BEGIN
  INSERT OR IGNORE INTO games (slug) VALUES (NEW.game_id);
END;

CREATE TABLE streamer_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'UNVERIFIED',
  featured_status TEXT NOT NULL DEFAULT 'NONE',
  featured_reason TEXT,
  featured_since TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE streamer_platform_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  streamer_id INTEGER NOT NULL,
  platform TEXT NOT NULL,
  platform_user_id TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  channel_handle TEXT,
  channel_url TEXT NOT NULL,
  avatar_url TEXT,
  verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
  verified_at TEXT,
  audience_count INTEGER DEFAULT 0,
  audience_count_known INTEGER NOT NULL DEFAULT 0,
  channel_created_at TEXT,
  metrics_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE user_progress (
  user_id INTEGER PRIMARY KEY,
  total_xp INTEGER NOT NULL DEFAULT 0,
  eligible_completions INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE xp_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT 'GAME_COMPLETION',
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  game_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(source_type, source_id)
);
`;

/** Schema for D1SessionRepository's moderation-gate behavior (migration 0023) against a real
 * SQLite engine — the existing sessionRepository.test.ts uses a hand-rolled substring-matching
 * mock that doesn't actually validate the LEFT JOIN user_moderation SQL runs, so this schema
 * exists specifically to exercise the real query. */
export const SESSION_MODERATION_TEST_SCHEMA = `
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname TEXT NOT NULL,
  email TEXT,
  avatar_url TEXT,
  avatar_provider TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  country TEXT,
  nickname_updated_at TEXT,
  country_updated_at TEXT,
  locale TEXT,
  current_streak INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  last_active_date TEXT
);

CREATE TABLE oauth_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  provider_email TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE user_moderation (
  user_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  suspended_until TEXT,
  score_submission_blocked INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  updated_by_admin_id INTEGER,
  updated_at TEXT NOT NULL
);
`;

/** Schema for admin step-up authentication repository tests (migration 0015). */
export const ADMIN_AUTH_TEST_SCHEMA = `
CREATE TABLE admin_step_up_challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  google_sub TEXT NOT NULL,
  session_token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE TABLE admin_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  session_token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE admin_login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  success INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
`;

/** Schema for admin monitoring repository tests (DAU/WAU + per-game play counts, migration
 * 0022's indexes aren't needed for correctness here — SQLite doesn't require them to run the
 * same query, only to run it fast). */
export const ADMIN_MONITORING_TEST_SCHEMA = `
CREATE TABLE xp_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  game_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  nickname TEXT NOT NULL DEFAULT '게스트',
  avatar_url TEXT,
  game_id TEXT NOT NULL,
  score INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  deleted_by_admin_id INTEGER
);
`;

/** Schema for managed administrator account repository tests (migration 0016). */
export const ADMIN_ACCOUNTS_TEST_SCHEMA = `
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname TEXT NOT NULL,
  email TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE admin_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  google_sub TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'ADMIN',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_by_admin_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  password_changed_at TEXT NOT NULL
);

CREATE TABLE admin_account_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_admin_id INTEGER,
  target_admin_id INTEGER,
  action TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE admin_permission_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  permission TEXT NOT NULL,
  granted_by_admin_id INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE (account_id, permission)
);

CREATE TABLE admin_role_permissions (
  role TEXT NOT NULL,
  permission TEXT NOT NULL,
  granted_by_admin_id INTEGER,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (role, permission)
);
`;

/** Schema for D1UserModerationRepository tests (migration 0023). */
export const USER_MODERATION_TEST_SCHEMA = `
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname TEXT NOT NULL,
  email TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  nickname TEXT NOT NULL DEFAULT '게스트',
  avatar_url TEXT,
  game_id TEXT NOT NULL,
  score INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  deleted_by_admin_id INTEGER
);

CREATE TABLE user_moderation (
  user_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  suspended_until TEXT,
  score_submission_blocked INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  updated_by_admin_id INTEGER,
  updated_at TEXT NOT NULL
);

CREATE TABLE user_moderation_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  actor_admin_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  reason TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);
`;

/** Legacy pre-0029 schema (without games table) used for testing 0029 and 0030 migration scripts. */
export const LEGACY_SANDBOX_GAMES_TEST_SCHEMA = `
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname TEXT NOT NULL,
  email TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE game_creator_access (
  user_id INTEGER PRIMARY KEY,
  granted_by_admin_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE game_creator_access_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_user_id INTEGER NOT NULL,
  actor_admin_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE game_creator_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  message TEXT,
  reviewed_by_admin_id INTEGER,
  reviewed_at TEXT,
  reject_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_game_creator_applications_user
  ON game_creator_applications(user_id, created_at DESC);

CREATE UNIQUE INDEX idx_game_creator_applications_one_pending_per_user
  ON game_creator_applications(user_id) WHERE status = 'PENDING';

CREATE TABLE sandbox_games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  developer_user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  short_description TEXT,
  description TEXT,
  genre TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'single',
  logo_key TEXT,
  xp_per_completion INTEGER NOT NULL DEFAULT 0,
  score_unit TEXT,
  score_direction TEXT,
  score_min INTEGER,
  score_max INTEGER,
  score_display_prefix TEXT,
  score_display_suffix TEXT,
  visibility TEXT NOT NULL DEFAULT 'PRIVATE',
  live_version_id INTEGER,
  review_slot INTEGER,
  deleted_at TEXT,
  deleted_by_admin_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (visibility = 'PRIVATE' OR live_version_id IS NOT NULL),
  CHECK (review_slot IS NULL OR review_slot IN (1, 2))
);

CREATE INDEX idx_sandbox_games_deleted_at ON sandbox_games(deleted_at);

CREATE UNIQUE INDEX idx_sandbox_games_review_slot
  ON sandbox_games(developer_user_id, review_slot)
  WHERE review_slot IS NOT NULL;

CREATE TABLE sandbox_game_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL,
  object_key TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  bundle_bytes INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
  reviewed_by_admin_id INTEGER,
  reviewed_at TEXT,
  reject_reason TEXT,
  uploaded_at TEXT NOT NULL,
  publish_status TEXT NOT NULL DEFAULT 'UPLOADED',
  publish_error TEXT,
  published_at TEXT,
  manifest_key TEXT,
  published_size_bytes INTEGER,
  file_count INTEGER
);

CREATE TABLE sandbox_game_review_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL,
  version_id INTEGER,
  actor_admin_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  reason TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);
`;

/** Schema for D1GameCreatorRepository / D1SandboxGameRepository tests (migration 0024-0030) */
export const SANDBOX_GAMES_TEST_SCHEMA =
  `
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname TEXT NOT NULL,
  email TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE game_creator_access (
  user_id INTEGER PRIMARY KEY,
  granted_by_admin_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE game_creator_access_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_user_id INTEGER NOT NULL,
  actor_admin_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE game_creator_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  message TEXT,
  reviewed_by_admin_id INTEGER,
  reviewed_at TEXT,
  reject_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_game_creator_applications_user
  ON game_creator_applications(user_id, created_at DESC);

CREATE UNIQUE INDEX idx_game_creator_applications_one_pending_per_user
  ON game_creator_applications(user_id) WHERE status = 'PENDING';

CREATE TABLE sandbox_games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  developer_user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  short_description TEXT,
  description TEXT,
  genre TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'single',
  logo_key TEXT,
  xp_per_completion INTEGER NOT NULL DEFAULT 0,
  score_unit TEXT,
  score_direction TEXT,
  score_min INTEGER,
  score_max INTEGER,
  score_display_prefix TEXT,
  score_display_suffix TEXT,
  visibility TEXT NOT NULL DEFAULT 'PRIVATE',
  live_version_id INTEGER,
  review_slot INTEGER,
  deleted_at TEXT,
  deleted_by_admin_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (visibility = 'PRIVATE' OR live_version_id IS NOT NULL),
  CHECK (review_slot IS NULL OR review_slot IN (1, 2))
);

CREATE INDEX idx_sandbox_games_deleted_at ON sandbox_games(deleted_at);

CREATE UNIQUE INDEX idx_sandbox_games_review_slot
  ON sandbox_games(developer_user_id, review_slot)
  WHERE review_slot IS NOT NULL;

CREATE TABLE sandbox_game_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL,
  object_key TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  bundle_bytes INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
  reviewed_by_admin_id INTEGER,
  reviewed_at TEXT,
  reject_reason TEXT,
  uploaded_at TEXT NOT NULL,
  publish_status TEXT NOT NULL DEFAULT 'UPLOADED',
  publish_error TEXT,
  published_at TEXT,
  manifest_key TEXT,
  published_size_bytes INTEGER,
  file_count INTEGER
);

CREATE TABLE sandbox_game_review_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL,
  version_id INTEGER,
  actor_admin_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  reason TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  publisher_type TEXT NOT NULL,
  publisher_user_id INTEGER REFERENCES users(id),
  visibility TEXT NOT NULL,
  live_version_id INTEGER,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  leaderboard_generation INTEGER NOT NULL DEFAULT 0,
  CHECK (publisher_type IN ('OWOGG', 'USER')),
  CHECK (
    (
      publisher_type = 'OWOGG'
      AND publisher_user_id IS NULL
    )
    OR
    (
      publisher_type = 'USER'
      AND publisher_user_id IS NOT NULL
      AND publisher_user_id > 0
    )
  ),
  CHECK (visibility IN ('PRIVATE', 'PUBLIC')),
  CHECK (live_version_id IS NULL OR live_version_id > 0),
  CHECK (visibility = 'PRIVATE' OR live_version_id IS NOT NULL),
  CHECK (length(slug) > 0 AND slug = trim(slug))
);

CREATE INDEX idx_games_publisher ON games(publisher_type, publisher_user_id);
CREATE INDEX idx_games_active_created ON games(created_at DESC) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_sandbox_games_after_insert
AFTER INSERT ON sandbox_games
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Authority conflict: cannot insert USER sandbox game on top of OWOGG identity')
  WHERE EXISTS (
    SELECT 1 FROM games
    WHERE id = NEW.id AND publisher_type = 'OWOGG'
  );

  SELECT RAISE(ABORT, 'Authority conflict: slug is reserved by OWOGG game')
  WHERE EXISTS (
    SELECT 1 FROM games
    WHERE slug = NEW.slug AND id <> NEW.id AND publisher_type = 'OWOGG'
  );

  INSERT INTO games (
    id, slug, publisher_type, publisher_user_id, visibility, live_version_id, deleted_at, created_at, updated_at
  ) VALUES (
    NEW.id, NEW.slug, 'USER', NEW.developer_user_id, NEW.visibility, NEW.live_version_id, NEW.deleted_at, NEW.created_at, NEW.updated_at
  )
  ON CONFLICT(id) DO UPDATE SET
    slug = NEW.slug,
    publisher_type = 'USER',
    publisher_user_id = NEW.developer_user_id,
    visibility = NEW.visibility,
    live_version_id = NEW.live_version_id,
    deleted_at = NEW.deleted_at,
    created_at = NEW.created_at,
    updated_at = NEW.updated_at
  WHERE games.publisher_type = 'USER';
END;

CREATE TRIGGER trg_sandbox_games_after_update
AFTER UPDATE ON sandbox_games
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Authority conflict: cannot update USER sandbox game corresponding to OWOGG identity')
  WHERE EXISTS (
    SELECT 1 FROM games
    WHERE id = OLD.id AND publisher_type = 'OWOGG'
  );

  SELECT RAISE(ABORT, 'Authority conflict: slug is reserved by OWOGG game')
  WHERE EXISTS (
    SELECT 1 FROM games
    WHERE slug = NEW.slug AND id <> OLD.id AND publisher_type = 'OWOGG'
  );

  -- Convergent upsert: re-creates a missing USER generic row so that sandbox_games remains the
  -- single write authority even when the games projection was lost (deployment gap, etc.).
  INSERT INTO games (
    id, slug, publisher_type, publisher_user_id, visibility, live_version_id, deleted_at, created_at, updated_at
  ) VALUES (
    OLD.id, NEW.slug, 'USER', NEW.developer_user_id, NEW.visibility, NEW.live_version_id, NEW.deleted_at, NEW.created_at, NEW.updated_at
  )
  ON CONFLICT(id) DO UPDATE SET
    slug = NEW.slug,
    publisher_type = 'USER',
    publisher_user_id = NEW.developer_user_id,
    visibility = NEW.visibility,
    live_version_id = NEW.live_version_id,
    deleted_at = NEW.deleted_at,
    created_at = NEW.created_at,
    updated_at = NEW.updated_at
  WHERE games.publisher_type = 'USER';
END;

CREATE TRIGGER trg_sandbox_games_after_delete
AFTER DELETE ON sandbox_games
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Authority conflict: cannot delete OWOGG identity via sandbox game delete')
  WHERE EXISTS (
    SELECT 1 FROM games
    WHERE id = OLD.id AND publisher_type = 'OWOGG'
  );

  DELETE FROM games
  WHERE id = OLD.id AND publisher_type = 'USER';
END;
` +
  fs.readFileSync(
    new URL("../../migrations/0031_game_version_write_convergence.sql", import.meta.url),
    "utf8",
  ) +
  fs.readFileSync(
    new URL("../../migrations/0033_generic_game_assets.sql", import.meta.url),
    "utf8",
  ) +
  fs.readFileSync(
    new URL("../../migrations/0034_unified_game_control_plane.sql", import.meta.url),
    "utf8",
  );

/** Schema for generic games table tests (migration 0029) — includes users, sandbox_games, and games. */
export const GAMES_TEST_SCHEMA = `
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname TEXT NOT NULL,
  email TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sandbox_games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  developer_user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  short_description TEXT,
  description TEXT,
  genre TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'single',
  logo_key TEXT,
  xp_per_completion INTEGER NOT NULL DEFAULT 0,
  score_unit TEXT,
  score_direction TEXT,
  score_min INTEGER,
  score_max INTEGER,
  score_display_prefix TEXT,
  score_display_suffix TEXT,
  visibility TEXT NOT NULL DEFAULT 'PRIVATE',
  live_version_id INTEGER,
  review_slot INTEGER,
  deleted_at TEXT,
  deleted_by_admin_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (visibility = 'PRIVATE' OR live_version_id IS NOT NULL),
  CHECK (review_slot IS NULL OR review_slot IN (1, 2))
);

CREATE TABLE games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  publisher_type TEXT NOT NULL,
  publisher_user_id INTEGER REFERENCES users(id),
  visibility TEXT NOT NULL,
  live_version_id INTEGER,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (publisher_type IN ('OWOGG', 'USER')),
  CHECK (
    (
      publisher_type = 'OWOGG'
      AND publisher_user_id IS NULL
    )
    OR
    (
      publisher_type = 'USER'
      AND publisher_user_id IS NOT NULL
      AND publisher_user_id > 0
    )
  ),
  CHECK (visibility IN ('PRIVATE', 'PUBLIC')),
  CHECK (live_version_id IS NULL OR live_version_id > 0),
  CHECK (visibility = 'PRIVATE' OR live_version_id IS NOT NULL),
  CHECK (length(slug) > 0 AND slug = trim(slug))
);

CREATE INDEX idx_games_publisher ON games(publisher_type, publisher_user_id);
CREATE INDEX idx_games_active_created ON games(created_at DESC) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_sandbox_games_after_insert
AFTER INSERT ON sandbox_games
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Authority conflict: cannot insert USER sandbox game on top of OWOGG identity')
  WHERE EXISTS (
    SELECT 1 FROM games
    WHERE id = NEW.id AND publisher_type = 'OWOGG'
  );

  SELECT RAISE(ABORT, 'Authority conflict: slug is reserved by OWOGG game')
  WHERE EXISTS (
    SELECT 1 FROM games
    WHERE slug = NEW.slug AND id <> NEW.id AND publisher_type = 'OWOGG'
  );

  INSERT INTO games (
    id, slug, publisher_type, publisher_user_id, visibility, live_version_id, deleted_at, created_at, updated_at
  ) VALUES (
    NEW.id, NEW.slug, 'USER', NEW.developer_user_id, NEW.visibility, NEW.live_version_id, NEW.deleted_at, NEW.created_at, NEW.updated_at
  )
  ON CONFLICT(id) DO UPDATE SET
    slug = NEW.slug,
    publisher_type = 'USER',
    publisher_user_id = NEW.developer_user_id,
    visibility = NEW.visibility,
    live_version_id = NEW.live_version_id,
    deleted_at = NEW.deleted_at,
    created_at = NEW.created_at,
    updated_at = NEW.updated_at
  WHERE games.publisher_type = 'USER';
END;

CREATE TRIGGER trg_sandbox_games_after_update
AFTER UPDATE ON sandbox_games
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Authority conflict: cannot update USER sandbox game corresponding to OWOGG identity')
  WHERE EXISTS (
    SELECT 1 FROM games
    WHERE id = OLD.id AND publisher_type = 'OWOGG'
  );

  SELECT RAISE(ABORT, 'Authority conflict: slug is reserved by OWOGG game')
  WHERE EXISTS (
    SELECT 1 FROM games
    WHERE slug = NEW.slug AND id <> OLD.id AND publisher_type = 'OWOGG'
  );

  -- Convergent upsert: re-creates a missing USER generic row so that sandbox_games remains the
  -- single write authority even when the games projection was lost (deployment gap, etc.).
  INSERT INTO games (
    id, slug, publisher_type, publisher_user_id, visibility, live_version_id, deleted_at, created_at, updated_at
  ) VALUES (
    OLD.id, NEW.slug, 'USER', NEW.developer_user_id, NEW.visibility, NEW.live_version_id, NEW.deleted_at, NEW.created_at, NEW.updated_at
  )
  ON CONFLICT(id) DO UPDATE SET
    slug = NEW.slug,
    publisher_type = 'USER',
    publisher_user_id = NEW.developer_user_id,
    visibility = NEW.visibility,
    live_version_id = NEW.live_version_id,
    deleted_at = NEW.deleted_at,
    created_at = NEW.created_at,
    updated_at = NEW.updated_at
  WHERE games.publisher_type = 'USER';
END;

CREATE TRIGGER trg_sandbox_games_after_delete
AFTER DELETE ON sandbox_games
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Authority conflict: cannot delete OWOGG identity via sandbox game delete')
  WHERE EXISTS (
    SELECT 1 FROM games
    WHERE id = OLD.id AND publisher_type = 'OWOGG'
  );

  DELETE FROM games
  WHERE id = OLD.id AND publisher_type = 'USER';
END;
`;
