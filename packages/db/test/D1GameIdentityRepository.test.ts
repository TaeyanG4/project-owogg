import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  D1GameIdentityRepository,
  mapGameIdentityRow,
  mapSandboxGameIdentityRow,
} from "../src/index.js";
import {
  createSqliteD1,
  GAMES_TEST_SCHEMA,
  LEGACY_SANDBOX_GAMES_TEST_SCHEMA,
} from "./helpers/sqliteD1.js";

function seedUser(raw: import("node:sqlite").DatabaseSync, id: number, nickname: string) {
  raw
    .prepare(`INSERT INTO users (id, nickname, email, created_at) VALUES (?, ?, ?, ?)`)
    .run(id, nickname, `${nickname}@example.com`, new Date().toISOString());
}

function insertRawSandboxGame(
  raw: import("node:sqlite").DatabaseSync,
  row: {
    id?: number;
    slug: string;
    developerUserId: number;
    title?: string;
    shortDescription?: string | null;
    description?: string | null;
    genre?: string;
    mode?: string;
    xpPerCompletion?: number;
    scoreMin?: number | null;
    scoreMax?: number | null;
    visibility?: string;
    liveVersionId?: number | null;
    deletedAt?: string | null;
    createdAt?: string;
    updatedAt?: string;
  },
): number {
  const info = raw
    .prepare(
      `INSERT INTO sandbox_games (
        id, slug, developer_user_id, title, short_description, description, genre, mode,
        xp_per_completion, score_min, score_max, visibility, live_version_id, deleted_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id ?? null,
      row.slug,
      row.developerUserId,
      row.title ?? "Test Game",
      row.shortDescription ?? null,
      row.description ?? null,
      row.genre ?? "puzzle",
      row.mode ?? "single",
      row.xpPerCompletion ?? 100,
      row.scoreMin ?? 0,
      row.scoreMax ?? 1000,
      row.visibility ?? "PRIVATE",
      row.liveVersionId ?? null,
      row.deletedAt ?? null,
      row.createdAt ?? "2026-08-19T10:00:00.000Z",
      row.updatedAt ?? "2026-08-19T10:00:00.000Z",
    );
  return Number(info.lastInsertRowid);
}

function insertRawGenericGame(
  raw: import("node:sqlite").DatabaseSync,
  row: {
    id?: number;
    slug: string;
    publisherType: "OWOGG" | "USER";
    publisherUserId?: number | null;
    visibility?: string;
    liveVersionId?: number | null;
    deletedAt?: string | null;
    createdAt?: string;
    updatedAt?: string;
  },
): number {
  const info = raw
    .prepare(
      `INSERT INTO games (
        id, slug, publisher_type, publisher_user_id, visibility, live_version_id, deleted_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id ?? null,
      row.slug,
      row.publisherType,
      row.publisherUserId ?? null,
      row.visibility ?? "PRIVATE",
      row.liveVersionId ?? null,
      row.deletedAt ?? null,
      row.createdAt ?? "2026-08-19T10:00:00.000Z",
      row.updatedAt ?? "2026-08-19T10:00:00.000Z",
    );
  return Number(info.lastInsertRowid);
}

test("public surface export: D1GameIdentityRepository and mappers exported from index", () => {
  assert.equal(typeof D1GameIdentityRepository, "function");
  assert.equal(typeof mapGameIdentityRow, "function");
  assert.equal(typeof mapSandboxGameIdentityRow, "function");
});

test("0029 migration actual-file: cleanly applies to existing DB and backfills USER rows preserving IDs and parity", () => {
  const { db, raw } = createSqliteD1(LEGACY_SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Alice");
  seedUser(raw, 2, "Bob");

  const id1 = insertRawSandboxGame(raw, {
    id: 101,
    slug: "ball-dodge",
    developerUserId: 1,
    visibility: "PRIVATE",
    liveVersionId: null,
    createdAt: "2026-08-19T12:00:00.000Z",
    updatedAt: "2026-08-19T12:30:00.000Z",
  });

  const id2 = insertRawSandboxGame(raw, {
    id: 202,
    slug: "spotlight-runner",
    developerUserId: 2,
    visibility: "PUBLIC",
    liveVersionId: 77,
    createdAt: "2026-08-19T14:00:00.000Z",
    updatedAt: "2026-08-19T14:30:00.000Z",
  });

  const id3 = insertRawSandboxGame(raw, {
    id: 303,
    slug: "archived-puzzle",
    developerUserId: 1,
    visibility: "PRIVATE",
    liveVersionId: null,
    deletedAt: "2026-08-20T08:00:00.123Z",
    createdAt: "2026-08-19T16:00:00.000Z",
    updatedAt: "2026-08-20T08:00:00.123Z",
  });

  // Read and apply the actual 0029 migration file
  const migrationSql = fs.readFileSync(
    new URL("../migrations/0029_unified_game_identity.sql", import.meta.url),
    "utf-8",
  );
  raw.exec(migrationSql);

  const repo = new D1GameIdentityRepository(db);

  // Verify backfilled rows in games table
  const gamesRows = raw.prepare("SELECT * FROM games ORDER BY id ASC").all() as Record<
    string,
    unknown
  >[];
  assert.equal(gamesRows.length, 3);

  // Exact ID preservation
  assert.equal(gamesRows[0].id, id1);
  assert.equal(gamesRows[1].id, id2);
  assert.equal(gamesRows[2].id, id3);

  // Exact parity between mapSandboxGameIdentityRow and D1GameIdentityRepository.findById
  const sandboxRows = raw.prepare("SELECT * FROM sandbox_games ORDER BY id ASC").all() as Record<
    string,
    unknown
  >[];

  for (let i = 0; i < 3; i++) {
    const sandboxProjection = mapSandboxGameIdentityRow(sandboxRows[i]);
    const genericProjection = mapGameIdentityRow(gamesRows[i]);
    assert.deepEqual(sandboxProjection, genericProjection);
  }

  // Repository lookup matches
  const identity1 = repo.findById(id1);
  const identity2 = repo.findById(id2);
  const identity3 = repo.findById(id3);

  return Promise.all([identity1, identity2, identity3]).then(([g1, g2, g3]) => {
    assert.ok(g1);
    assert.equal(g1.slug, "ball-dodge");
    assert.deepEqual(g1.publisher, { type: "USER", userId: 1 });
    assert.equal(g1.visibility, "PRIVATE");
    assert.equal(g1.liveVersionId, null);

    assert.ok(g2);
    assert.equal(g2.slug, "spotlight-runner");
    assert.deepEqual(g2.publisher, { type: "USER", userId: 2 });
    assert.equal(g2.visibility, "PUBLIC");
    assert.equal(g2.liveVersionId, 77);

    assert.ok(g3);
    assert.equal(g3.slug, "archived-puzzle");
    assert.deepEqual(g3.publisher, { type: "USER", userId: 1 });
    assert.equal(g3.deletedAt, "2026-08-20T08:00:00.123Z");
  });
});

test("0030 migration actual-file: closes deployment gap, converges deltas, and enables sync triggers", () => {
  const { db, raw } = createSqliteD1(LEGACY_SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Alice");
  seedUser(raw, 2, "Bob");

  // Initial seed
  const id1 = insertRawSandboxGame(raw, {
    id: 1,
    slug: "game-1",
    developerUserId: 1,
    visibility: "PRIVATE",
    createdAt: "2026-08-19T10:00:00.000Z",
    updatedAt: "2026-08-19T10:00:00.000Z",
  });

  // Apply 0029 migration
  const migration0029 = fs.readFileSync(
    new URL("../migrations/0029_unified_game_identity.sql", import.meta.url),
    "utf-8",
  );
  raw.exec(migration0029);

  // Simulate deployment gap (OLD Worker writes to sandbox_games before new Worker is deployed)
  // 1. New game inserted by OLD worker (missing from games)
  const id2 = insertRawSandboxGame(raw, {
    id: 2,
    slug: "gap-game-2",
    developerUserId: 2,
    visibility: "PUBLIC",
    liveVersionId: 10,
    createdAt: "2026-08-20T09:00:00.000Z",
    updatedAt: "2026-08-20T09:00:00.000Z",
  });

  // 2. Existing game updated by OLD worker (stale in games)
  raw
    .prepare(
      `UPDATE sandbox_games SET visibility = 'PUBLIC', live_version_id = 99, updated_at = '2026-08-20T09:05:00.000Z' WHERE id = ?`,
    )
    .run(id1);

  // Apply 0030 migration
  const migration0030 = fs.readFileSync(
    new URL("../migrations/0030_user_identity_write_convergence.sql", import.meta.url),
    "utf-8",
  );
  raw.exec(migration0030);
  assert.equal(
    raw
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_migration_0030_parity_guard'",
      )
      .get(),
    undefined,
    "successful 0030 migration must remove its scratch parity guard",
  );

  const repo = new D1GameIdentityRepository(db);

  // Verify delta repair
  return Promise.all([repo.findById(id1), repo.findById(id2)]).then(async ([g1, g2]) => {
    assert.ok(g1);
    assert.equal(g1.visibility, "PUBLIC");
    assert.equal(g1.liveVersionId, 99);
    assert.equal(g1.updatedAt, "2026-08-20T09:05:00.000Z");

    assert.ok(g2);
    assert.equal(g2.slug, "gap-game-2");
    assert.equal(g2.visibility, "PUBLIC");
    assert.equal(g2.liveVersionId, 10);

    // Verify post-0030 transitional triggers
    // A. INSERT trigger
    const id3 = insertRawSandboxGame(raw, {
      id: 3,
      slug: "post-migration-game",
      developerUserId: 1,
      visibility: "PRIVATE",
      createdAt: "2026-08-20T10:00:00.000Z",
      updatedAt: "2026-08-20T10:00:00.000Z",
    });

    const g3 = await repo.findById(id3);
    assert.ok(g3);
    assert.equal(g3.slug, "post-migration-game");
    assert.deepEqual(g3.publisher, { type: "USER", userId: 1 });

    // B. UPDATE trigger (e.g. soft-delete)
    raw
      .prepare(
        `UPDATE sandbox_games SET deleted_at = '2026-08-20T10:30:00.000Z', visibility = 'PRIVATE', updated_at = '2026-08-20T10:30:00.000Z' WHERE id = ?`,
      )
      .run(id3);

    const g3Updated = await repo.findById(id3);
    assert.ok(g3Updated);
    assert.equal(g3Updated.deletedAt, "2026-08-20T10:30:00.000Z");
    assert.equal(g3Updated.visibility, "PRIVATE");

    // C. DELETE trigger (hard delete)
    raw.prepare(`DELETE FROM sandbox_games WHERE id = ?`).run(id3);
    const g3Deleted = await repo.findById(id3);
    assert.equal(g3Deleted, null);
  });
});

test("0030 migration: authority conflict fail-closed parity guard aborts migration", () => {
  const { raw } = createSqliteD1(LEGACY_SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Alice");

  insertRawSandboxGame(raw, {
    id: 10,
    slug: "reaction-time",
    developerUserId: 1,
    visibility: "PRIVATE",
  });

  // Apply 0029
  const migration0029 = fs.readFileSync(
    new URL("../migrations/0029_unified_game_identity.sql", import.meta.url),
    "utf-8",
  );
  raw.exec(migration0029);

  // Intentionally tamper games table to create an OWOGG authority conflict on same id
  raw
    .prepare(
      `UPDATE games SET publisher_type = 'OWOGG', publisher_user_id = NULL, visibility = 'PUBLIC', live_version_id = 1 WHERE id = 10`,
    )
    .run();

  // Applying 0030 must fail due to parity guard aborting on authority conflict
  const migration0030 = fs.readFileSync(
    new URL("../migrations/0030_user_identity_write_convergence.sql", import.meta.url),
    "utf-8",
  );
  assert.throws(() => raw.exec(migration0030), /CHECK constraint failed: must_be_zero = 0/);
});

test("0030 triggers: authority conflict rejection prevents tampering with OWOGG games", () => {
  const { raw } = createSqliteD1(GAMES_TEST_SCHEMA);
  raw.exec("PRAGMA foreign_keys = ON;");
  seedUser(raw, 1, "Alice");

  // Insert OWOGG game in games table
  insertRawGenericGame(raw, {
    id: 99,
    slug: "reaction-time",
    publisherType: "OWOGG",
    publisherUserId: null,
    visibility: "PUBLIC",
    liveVersionId: 1,
  });

  // Attempt to insert a USER sandbox_game with same id 99 must be rejected by trigger
  assert.throws(
    () =>
      insertRawSandboxGame(raw, {
        id: 99,
        slug: "user-reaction-time",
        developerUserId: 1,
        visibility: "PRIVATE",
      }),
    /Authority conflict: cannot insert USER sandbox game on top of OWOGG identity/,
  );

  // Attempt to insert a USER sandbox_game with same slug "reaction-time" must be rejected by trigger
  assert.throws(
    () =>
      insertRawSandboxGame(raw, {
        id: 100,
        slug: "reaction-time",
        developerUserId: 1,
        visibility: "PRIVATE",
      }),
    /Authority conflict: slug is reserved by OWOGG game/,
  );
});

test("physical SQLite constraints: publisher, visibility, slug, and liveVersion invariants", () => {
  const { raw } = createSqliteD1(GAMES_TEST_SCHEMA);
  raw.exec("PRAGMA foreign_keys = ON;");
  seedUser(raw, 1, "Dev1");

  // 1. Valid USER row succeeds
  raw
    .prepare(
      `INSERT INTO games (slug, publisher_type, publisher_user_id, visibility, live_version_id, created_at, updated_at)
       VALUES ('valid-user', 'USER', 1, 'PRIVATE', NULL, '2026-08-19', '2026-08-19')`,
    )
    .run();

  // 2. USER with NULL publisher_user_id rejected
  assert.throws(
    () =>
      raw
        .prepare(
          `INSERT INTO games (slug, publisher_type, publisher_user_id, visibility, live_version_id, created_at, updated_at)
           VALUES ('user-null', 'USER', NULL, 'PRIVATE', NULL, '2026-08-19', '2026-08-19')`,
        )
        .run(),
    /CHECK constraint failed/,
  );

  // 3. USER with non-positive publisher_user_id rejected
  assert.throws(
    () =>
      raw
        .prepare(
          `INSERT INTO games (slug, publisher_type, publisher_user_id, visibility, live_version_id, created_at, updated_at)
           VALUES ('user-zero', 'USER', 0, 'PRIVATE', NULL, '2026-08-19', '2026-08-19')`,
        )
        .run(),
    /CHECK constraint failed/,
  );

  // 4. Valid OWOGG row with NULL publisher_user_id succeeds
  raw
    .prepare(
      `INSERT INTO games (slug, publisher_type, publisher_user_id, visibility, live_version_id, created_at, updated_at)
       VALUES ('reaction-time', 'OWOGG', NULL, 'PUBLIC', 1, '2026-08-19', '2026-08-19')`,
    )
    .run();

  // 5. OWOGG with non-NULL publisher_user_id rejected
  assert.throws(
    () =>
      raw
        .prepare(
          `INSERT INTO games (slug, publisher_type, publisher_user_id, visibility, live_version_id, created_at, updated_at)
           VALUES ('owogg-with-user', 'OWOGG', 1, 'PRIVATE', NULL, '2026-08-19', '2026-08-19')`,
        )
        .run(),
    /CHECK constraint failed/,
  );

  // 6. Unknown publisher_type rejected
  assert.throws(
    () =>
      raw
        .prepare(
          `INSERT INTO games (slug, publisher_type, publisher_user_id, visibility, live_version_id, created_at, updated_at)
           VALUES ('unknown-pub', 'CREATOR', 1, 'PRIVATE', NULL, '2026-08-19', '2026-08-19')`,
        )
        .run(),
    /CHECK constraint failed/,
  );

  // 7. PUBLIC visibility with NULL live_version_id rejected
  assert.throws(
    () =>
      raw
        .prepare(
          `INSERT INTO games (slug, publisher_type, publisher_user_id, visibility, live_version_id, created_at, updated_at)
           VALUES ('public-no-ver', 'USER', 1, 'PUBLIC', NULL, '2026-08-19', '2026-08-19')`,
        )
        .run(),
    /CHECK constraint failed/,
  );

  // 8. Non-positive live_version_id rejected
  assert.throws(
    () =>
      raw
        .prepare(
          `INSERT INTO games (slug, publisher_type, publisher_user_id, visibility, live_version_id, created_at, updated_at)
           VALUES ('neg-ver', 'USER', 1, 'PRIVATE', 0, '2026-08-19', '2026-08-19')`,
        )
        .run(),
    /CHECK constraint failed/,
  );

  // 9. Invalid visibility rejected
  assert.throws(
    () =>
      raw
        .prepare(
          `INSERT INTO games (slug, publisher_type, publisher_user_id, visibility, live_version_id, created_at, updated_at)
           VALUES ('inv-vis', 'USER', 1, 'UNLISTED', NULL, '2026-08-19', '2026-08-19')`,
        )
        .run(),
    /CHECK constraint failed/,
  );

  // 10. Padded slug or empty slug rejected
  assert.throws(
    () =>
      raw
        .prepare(
          `INSERT INTO games (slug, publisher_type, publisher_user_id, visibility, live_version_id, created_at, updated_at)
           VALUES (' padded ', 'USER', 1, 'PRIVATE', NULL, '2026-08-19', '2026-08-19')`,
        )
        .run(),
    /CHECK constraint failed/,
  );

  assert.throws(
    () =>
      raw
        .prepare(
          `INSERT INTO games (slug, publisher_type, publisher_user_id, visibility, live_version_id, created_at, updated_at)
           VALUES ('', 'USER', 1, 'PRIVATE', NULL, '2026-08-19', '2026-08-19')`,
        )
        .run(),
    /CHECK constraint failed/,
  );

  // 11. Duplicate slug rejected
  assert.throws(
    () =>
      raw
        .prepare(
          `INSERT INTO games (slug, publisher_type, publisher_user_id, visibility, live_version_id, created_at, updated_at)
           VALUES ('valid-user', 'USER', 1, 'PRIVATE', NULL, '2026-08-19', '2026-08-19')`,
        )
        .run(),
    /UNIQUE constraint failed/,
  );

  // 12. Non-existent user id rejected by foreign key constraint
  assert.throws(
    () =>
      raw
        .prepare(
          `INSERT INTO games (slug, publisher_type, publisher_user_id, visibility, live_version_id, created_at, updated_at)
           VALUES ('orphan-user', 'USER', 999999, 'PRIVATE', NULL, '2026-08-19', '2026-08-19')`,
        )
        .run(),
    /FOREIGN KEY constraint failed/,
  );
});

test("findById and findBySlug return active USER and OWOGG game identities", async () => {
  const { db, raw } = createSqliteD1(GAMES_TEST_SCHEMA);
  seedUser(raw, 42, "Dev42");

  const userGameId = insertRawGenericGame(raw, {
    slug: "ball-dodge",
    publisherType: "USER",
    publisherUserId: 42,
    visibility: "PRIVATE",
    liveVersionId: null,
    createdAt: "2026-08-19T12:00:00.000Z",
    updatedAt: "2026-08-19T12:30:00.000Z",
  });

  const owoggGameId = insertRawGenericGame(raw, {
    slug: "reaction-time",
    publisherType: "OWOGG",
    publisherUserId: null,
    visibility: "PUBLIC",
    liveVersionId: 1,
    createdAt: "2026-08-19T10:00:00.000Z",
    updatedAt: "2026-08-19T10:30:00.000Z",
  });

  const repo = new D1GameIdentityRepository(db);

  // USER lookup
  const userById = await repo.findById(userGameId);
  assert.ok(userById);
  assert.equal(userById.id, userGameId);
  assert.equal(userById.slug, "ball-dodge");
  assert.deepEqual(userById.publisher, { type: "USER", userId: 42 });
  assert.equal(userById.visibility, "PRIVATE");
  assert.equal(userById.liveVersionId, null);

  const userBySlug = await repo.findBySlug("ball-dodge");
  assert.ok(userBySlug);
  assert.equal(userBySlug.id, userGameId);
  assert.deepEqual(userBySlug.publisher, { type: "USER", userId: 42 });

  // OWOGG lookup
  const owoggById = await repo.findById(owoggGameId);
  assert.ok(owoggById);
  assert.equal(owoggById.id, owoggGameId);
  assert.equal(owoggById.slug, "reaction-time");
  assert.deepEqual(owoggById.publisher, { type: "OWOGG" });
  assert.equal(owoggById.visibility, "PUBLIC");
  assert.equal(owoggById.liveVersionId, 1);

  const owoggBySlug = await repo.findBySlug("reaction-time");
  assert.ok(owoggBySlug);
  assert.equal(owoggBySlug.id, owoggGameId);
  assert.deepEqual(owoggBySlug.publisher, { type: "OWOGG" });
});

test("publisher userId matches developer_user_id exactly without displayName derivation", async () => {
  const { db, raw } = createSqliteD1(GAMES_TEST_SCHEMA);
  // Even if user's nickname is "owogg", publisher must remain USER with developerUserId
  seedUser(raw, 123, "owogg");

  insertRawGenericGame(raw, {
    slug: "user-game-by-owogg-named-user",
    publisherType: "USER",
    publisherUserId: 123,
    visibility: "PRIVATE",
  });

  const repo = new D1GameIdentityRepository(db);
  const identity = await repo.findBySlug("user-game-by-owogg-named-user");

  assert.ok(identity);
  assert.deepEqual(identity.publisher, { type: "USER", userId: 123 });
  assert.notEqual(identity.publisher.type, "OWOGG");
});

test("findById returns soft-deleted game identity with exact deletedAt preserved", async () => {
  const { db, raw } = createSqliteD1(GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Dev1");
  const exactDeletedTimestamp = "2026-08-20T08:00:00.123Z";
  const gameId = insertRawGenericGame(raw, {
    slug: "archived-game",
    publisherType: "USER",
    publisherUserId: 1,
    deletedAt: exactDeletedTimestamp,
  });

  const repo = new D1GameIdentityRepository(db);
  const identity = await repo.findById(gameId);

  assert.ok(identity);
  assert.equal(identity.id, gameId);
  assert.equal(identity.slug, "archived-game");
  assert.equal(identity.deletedAt, exactDeletedTimestamp);
});

test("findBySlug returns null for soft-deleted game and non-existent slug", async () => {
  const { db, raw } = createSqliteD1(GAMES_TEST_SCHEMA);
  seedUser(raw, 5, "Dev5");
  insertRawGenericGame(raw, {
    slug: "deleted-runner",
    publisherType: "USER",
    publisherUserId: 5,
    deletedAt: "2026-08-20T09:00:00.000Z",
  });

  const repo = new D1GameIdentityRepository(db);
  const deleted = await repo.findBySlug("deleted-runner");
  assert.equal(deleted, null);

  const missing = await repo.findBySlug("non-existent");
  assert.equal(missing, null);
});

test("findById returns null for non-existent game id", async () => {
  const { db } = createSqliteD1(GAMES_TEST_SCHEMA);
  const repo = new D1GameIdentityRepository(db);

  const identity = await repo.findById(99999);
  assert.equal(identity, null);
});

test("listAll returns active games ordered by created_at DESC and excludes soft-deleted rows", async () => {
  const { db, raw } = createSqliteD1(GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Dev1");

  insertRawGenericGame(raw, {
    slug: "game-1",
    publisherType: "USER",
    publisherUserId: 1,
    visibility: "PRIVATE",
    createdAt: "2026-08-19T01:00:00.000Z",
  });
  insertRawGenericGame(raw, {
    slug: "game-2-deleted",
    publisherType: "USER",
    publisherUserId: 1,
    visibility: "PRIVATE",
    deletedAt: "2026-08-20T00:00:00.000Z",
    createdAt: "2026-08-19T02:00:00.000Z",
  });
  insertRawGenericGame(raw, {
    slug: "game-3-owogg",
    publisherType: "OWOGG",
    publisherUserId: null,
    visibility: "PUBLIC",
    liveVersionId: 1,
    createdAt: "2026-08-19T03:00:00.000Z",
  });

  const repo = new D1GameIdentityRepository(db);
  const identities = await repo.listAll();

  assert.equal(identities.length, 2);
  assert.deepEqual(
    identities.map((i) => i.slug),
    ["game-3-owogg", "game-1"],
  );
  assert.equal(identities[0].visibility, "PUBLIC");
  assert.equal(identities[1].visibility, "PRIVATE");
});

test("mapGameIdentityRow: fail-closed on malformed row data", () => {
  // Invalid id
  assert.throws(
    () =>
      mapGameIdentityRow({
        id: "not-a-number",
        slug: "game",
        publisher_type: "USER",
        publisher_user_id: 1,
        visibility: "PRIVATE",
        created_at: "2026-08-19",
        updated_at: "2026-08-19",
      }),
    /Invalid or missing game id/,
  );

  assert.throws(
    () =>
      mapGameIdentityRow({
        id: -1,
        slug: "game",
        publisher_type: "USER",
        publisher_user_id: 1,
        visibility: "PRIVATE",
        created_at: "2026-08-19",
        updated_at: "2026-08-19",
      }),
    /Invalid or missing game id/,
  );

  // Padded / whitespace slug rejected without normalization
  assert.throws(
    () =>
      mapGameIdentityRow({
        id: 1,
        slug: "   ",
        publisher_type: "USER",
        publisher_user_id: 1,
        visibility: "PRIVATE",
        created_at: "2026-08-19",
        updated_at: "2026-08-19",
      }),
    /Invalid or malformed game slug/,
  );

  assert.throws(
    () =>
      mapGameIdentityRow({
        id: 1,
        slug: " padded-slug ",
        publisher_type: "USER",
        publisher_user_id: 1,
        visibility: "PRIVATE",
        created_at: "2026-08-19",
        updated_at: "2026-08-19",
      }),
    /Invalid or malformed game slug/,
  );

  // Invalid publisher_type
  assert.throws(
    () =>
      mapGameIdentityRow({
        id: 1,
        slug: "game",
        publisher_type: "UNKNOWN",
        publisher_user_id: 1,
        visibility: "PRIVATE",
        created_at: "2026-08-19",
        updated_at: "2026-08-19",
      }),
    /Invalid publisher_type/,
  );

  // OWOGG with publisher_user_id
  assert.throws(
    () =>
      mapGameIdentityRow({
        id: 1,
        slug: "game",
        publisher_type: "OWOGG",
        publisher_user_id: 123,
        visibility: "PRIVATE",
        created_at: "2026-08-19",
        updated_at: "2026-08-19",
      }),
    /OWOGG publisher must not have publisher_user_id/,
  );

  // USER without positive publisher_user_id
  assert.throws(
    () =>
      mapGameIdentityRow({
        id: 1,
        slug: "game",
        publisher_type: "USER",
        publisher_user_id: null,
        visibility: "PRIVATE",
        created_at: "2026-08-19",
        updated_at: "2026-08-19",
      }),
    /USER publisher must have a positive integer publisher_user_id/,
  );

  assert.throws(
    () =>
      mapGameIdentityRow({
        id: 1,
        slug: "game",
        publisher_type: "USER",
        publisher_user_id: 0,
        visibility: "PRIVATE",
        created_at: "2026-08-19",
        updated_at: "2026-08-19",
      }),
    /USER publisher must have a positive integer publisher_user_id/,
  );

  // Invalid visibility
  assert.throws(
    () =>
      mapGameIdentityRow({
        id: 1,
        slug: "game",
        publisher_type: "USER",
        publisher_user_id: 1,
        visibility: "UNKNOWN",
        created_at: "2026-08-19",
        updated_at: "2026-08-19",
      }),
    /Invalid visibility/,
  );

  // PUBLIC game without live_version_id rejected
  assert.throws(
    () =>
      mapGameIdentityRow({
        id: 1,
        slug: "public-without-version",
        publisher_type: "USER",
        publisher_user_id: 1,
        visibility: "PUBLIC",
        live_version_id: null,
        created_at: "2026-08-19",
        updated_at: "2026-08-19",
      }),
    /Invalid runtime state: PUBLIC game "public-without-version" must have a non-null live_version_id/,
  );

  // Malformed deleted_at (number, object, empty string)
  assert.throws(
    () =>
      mapGameIdentityRow({
        id: 1,
        slug: "game",
        publisher_type: "USER",
        publisher_user_id: 1,
        visibility: "PRIVATE",
        deleted_at: 123456789,
        created_at: "2026-08-19",
        updated_at: "2026-08-19",
      }),
    /Invalid deleted_at/,
  );

  assert.throws(
    () =>
      mapGameIdentityRow({
        id: 1,
        slug: "game",
        publisher_type: "USER",
        publisher_user_id: 1,
        visibility: "PRIVATE",
        deleted_at: {},
        created_at: "2026-08-19",
        updated_at: "2026-08-19",
      }),
    /Invalid deleted_at/,
  );

  assert.throws(
    () =>
      mapGameIdentityRow({
        id: 1,
        slug: "game",
        publisher_type: "USER",
        publisher_user_id: 1,
        visibility: "PRIVATE",
        deleted_at: "",
        created_at: "2026-08-19",
        updated_at: "2026-08-19",
      }),
    /Invalid deleted_at/,
  );

  // Missing timestamps
  assert.throws(
    () =>
      mapGameIdentityRow({
        id: 1,
        slug: "game",
        publisher_type: "USER",
        publisher_user_id: 1,
        visibility: "PRIVATE",
        created_at: "",
        updated_at: "2026-08-19",
      }),
    /Missing timestamp/,
  );
});
