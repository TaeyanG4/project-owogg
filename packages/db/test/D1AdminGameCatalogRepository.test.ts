import assert from "node:assert/strict";
import test from "node:test";
import { D1AdminGameCatalogRepository } from "../src/d1/D1AdminGameCatalogRepository.js";
import { createSqliteD1, SANDBOX_GAMES_TEST_SCHEMA } from "./helpers/sqliteD1.js";

const SCHEMA = `${SANDBOX_GAMES_TEST_SCHEMA}
CREATE TABLE game_settings (
  game_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  disabled_reason TEXT,
  updated_by_admin_id INTEGER,
  updated_at TEXT NOT NULL
);`;

function insertOfficialGame(
  raw: import("node:sqlite").DatabaseSync,
  slug: string,
  createdAt: string,
  deletedAt: string | null = null,
): number {
  const result = raw
    .prepare(
      `INSERT INTO games (
        slug, publisher_type, publisher_user_id, visibility, live_version_id, deleted_at,
        created_at, updated_at
      ) VALUES (?, 'OWOGG', NULL, 'PRIVATE', NULL, ?, ?, ?)`,
    )
    .run(slug, deletedAt, createdAt, createdAt);
  return Number(result.lastInsertRowid);
}

function insertVersion(
  raw: import("node:sqlite").DatabaseSync,
  gameId: number,
  uploadedAt: string,
  suffix: string,
) {
  raw
    .prepare(
      `INSERT INTO game_versions (
        game_id, object_key, content_hash, bundle_bytes, publish_status, uploaded_at
      ) VALUES (?, ?, ?, 10, 'READY', ?)`,
    )
    .run(gameId, `uploads/${suffix}.zip`, `hash-${suffix}`, uploadedAt);
}

test("admin catalog pages one publisher and orders by latest server upload", async () => {
  const { db, raw } = createSqliteD1(SCHEMA);
  const older = insertOfficialGame(raw, "older-game", "2026-08-20T00:00:00.000Z");
  const newer = insertOfficialGame(raw, "newer-game", "2026-08-21T00:00:00.000Z");
  const deleted = insertOfficialGame(
    raw,
    "deleted-game",
    "2026-08-22T00:00:00.000Z",
    "2026-08-25T00:00:00.000Z",
  );
  insertVersion(raw, older, "2026-08-25T09:00:00.000Z", "older-latest");
  insertVersion(raw, newer, "2026-08-24T09:00:00.000Z", "newer-latest");
  insertVersion(raw, deleted, "2026-08-26T09:00:00.000Z", "deleted");
  raw
    .prepare(
      `INSERT INTO game_settings (
        game_id, enabled, disabled_reason, updated_by_admin_id, updated_at
      ) VALUES ('older-game', 0, 'maintenance', 7, '2026-08-25T10:00:00.000Z')`,
    )
    .run();

  const repository = new D1AdminGameCatalogRepository(db);
  const first = await repository.listPage({ publisherType: "OWOGG", limit: 1, offset: 0 });
  const second = await repository.listPage({ publisherType: "OWOGG", limit: 1, offset: 1 });

  assert.equal(first.total, 2);
  assert.equal(first.items[0]?.identity.slug, "older-game");
  assert.equal(first.items[0]?.latestUploadedAt, "2026-08-25T09:00:00.000Z");
  assert.equal(first.items[0]?.setting?.enabled, false);
  assert.equal(first.items[0]?.setting?.disabledReason, "maintenance");
  assert.equal(second.items[0]?.identity.slug, "newer-game");
});

test("admin catalog keeps USER and OWOGG pages isolated", async () => {
  const { db, raw } = createSqliteD1(SCHEMA);
  insertOfficialGame(raw, "official-game", "2026-08-20T00:00:00.000Z");
  raw
    .prepare(`INSERT INTO users (id, nickname, email, created_at) VALUES (1, 'Dev', NULL, ?)`)
    .run("2026-08-20T00:00:00.000Z");
  raw
    .prepare(
      `INSERT INTO games (
        slug, publisher_type, publisher_user_id, visibility, live_version_id, deleted_at,
        created_at, updated_at
      ) VALUES ('user-game', 'USER', 1, 'PRIVATE', NULL, NULL, ?, ?)`,
    )
    .run("2026-08-21T00:00:00.000Z", "2026-08-21T00:00:00.000Z");

  const result = await new D1AdminGameCatalogRepository(db).listPage({
    publisherType: "USER",
    limit: 10,
    offset: 0,
  });

  assert.equal(result.total, 1);
  assert.equal(result.items[0]?.identity.slug, "user-game");
});
