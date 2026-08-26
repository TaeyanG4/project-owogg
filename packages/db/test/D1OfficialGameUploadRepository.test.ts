import assert from "node:assert/strict";
import test from "node:test";
import type { GameCanonicalDocument } from "@owogg/core";
import { D1OfficialGameLifecycleRepository, D1OfficialGameUploadRepository } from "../src/index.js";
import { createSqliteD1, SANDBOX_GAMES_TEST_SCHEMA } from "./helpers/sqliteD1.js";

const canonical: GameCanonicalDocument = {
  schemaVersion: 2,
  slug: "admin-game",
  title: "관리자 게임",
  shortDescription: "설명",
  description: "관리자가 게시한 게임",
  publisher: { official: true },
  policy: { score: null, leaderboard: false, xpPerCompletion: 0, requiresAuth: false },
  supportsReplay: false,
  catalog: { type: "GENRE_MODE", genre: "arcade", mode: "single" },
  updatedAt: "2026-08-23T00:00:00.000Z",
};

test("OWOGG admin publication writes only generic games/version/assets and activates READY", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  const repo = new D1OfficialGameUploadRepository(db);
  const nowIso = "2026-08-23T00:00:00.000Z";

  const identity = await repo.ensureOwoggIdentity({ slug: canonical.slug, nowIso });
  assert.ok(identity);
  assert.equal(identity.publisher.type, "OWOGG");
  const version = await repo.createVersion({
    gameId: identity.id,
    objectKey: `uploads/${identity.id}/hash.zip`,
    contentHash: "a".repeat(64),
    bundleBytes: 123,
    nowIso,
  });
  await repo.markPublishing({
    gameId: identity.id,
    versionId: version.id,
    contentHash: version.contentHash,
  });
  await repo.markReady(
    { gameId: identity.id, versionId: version.id, contentHash: version.contentHash },
    {
      publishedAt: nowIso,
      manifestKey: `games/${identity.id}/${version.id}/.owogg-manifest.json`,
      publishedSizeBytes: 99,
      fileCount: 2,
    },
  );
  await repo.upsertLogo({
    gameId: identity.id,
    objectKey: `games/${identity.id}/logo.svg`,
    nowIso,
  });
  await repo.activate({ gameId: identity.id, versionId: version.id, canonical, nowIso });
  await repo.activate({ gameId: identity.id, versionId: version.id, canonical, nowIso });

  const nextVersion = await repo.createVersion({
    gameId: identity.id,
    objectKey: `uploads/${identity.id}/next.zip`,
    contentHash: "b".repeat(64),
    bundleBytes: 456,
    nowIso,
  });
  await repo.markPublishing({
    gameId: identity.id,
    versionId: nextVersion.id,
    contentHash: nextVersion.contentHash,
  });
  await repo.markReady(
    { gameId: identity.id, versionId: nextVersion.id, contentHash: nextVersion.contentHash },
    {
      publishedAt: nowIso,
      manifestKey: `games/${identity.id}/${nextVersion.id}/.owogg-manifest.json`,
      publishedSizeBytes: 100,
      fileCount: 2,
    },
  );
  await repo.activate({ gameId: identity.id, versionId: nextVersion.id, canonical, nowIso });

  const game = raw
    .prepare(
      "SELECT publisher_type, publisher_user_id, visibility, live_version_id, title, leaderboard_generation FROM games WHERE id = ?",
    )
    .get(identity.id) as Record<string, unknown>;
  assert.equal(game.publisher_type, "OWOGG");
  assert.equal(game.publisher_user_id, null);
  assert.equal(game.visibility, "PUBLIC");
  assert.equal(game.live_version_id, nextVersion.id);
  assert.equal(game.leaderboard_generation, 2, "only a distinct live version resets rankings");
  assert.equal(game.title, canonical.title);
  assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM sandbox_games").get()?.count, 0);
  assert.equal(
    raw
      .prepare("SELECT object_key FROM game_assets WHERE game_id = ? AND kind = 'LOGO'")
      .get(identity.id)?.object_key,
    `games/${identity.id}/logo.svg`,
  );
});

test("OWOGG admin publication reports a slug already owned by a USER as a conflict", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  raw.prepare("INSERT INTO users (id, nickname) VALUES (1, 'Creator')").run();
  raw
    .prepare(
      `INSERT INTO games
         (slug, publisher_type, publisher_user_id, visibility, live_version_id, created_at, updated_at,
          title, genre, mode)
       VALUES ('admin-game', 'USER', 1, 'PRIVATE', NULL, 'now', 'now', 'User game', 'arcade', 'single')`,
    )
    .run();
  const repo = new D1OfficialGameUploadRepository(db);
  assert.equal(
    await repo.ensureOwoggIdentity({
      slug: "admin-game",
      nowIso: "2026-08-23T00:00:00.000Z",
    }),
    null,
  );
});

const OFFICIAL_LIFECYCLE_SCHEMA = `${SANDBOX_GAMES_TEST_SCHEMA}
PRAGMA foreign_keys = ON;
CREATE TABLE scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL,
  result_id INTEGER
);
CREATE TABLE user_favorites (user_id INTEGER NOT NULL, game_id TEXT NOT NULL);
CREATE TABLE user_recent_plays (user_id INTEGER NOT NULL, game_id TEXT NOT NULL);
CREATE TABLE discord_play_contexts (token_hash TEXT PRIMARY KEY, game_id TEXT);
CREATE TABLE game_settings (game_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL);
CREATE TABLE official_game_deletion_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL,
  slug TEXT NOT NULL,
  actor_admin_id INTEGER NOT NULL,
  version_count INTEGER NOT NULL,
  object_count INTEGER NOT NULL,
  deleted_at TEXT NOT NULL
);
CREATE TABLE multiplayer_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  game_version_id INTEGER NOT NULL REFERENCES game_versions(id) ON DELETE CASCADE
);
`;

test("OWOGG lifecycle quarantine + purge removes D1 state and releases the slug", async () => {
  const { db, raw } = createSqliteD1(OFFICIAL_LIFECYCLE_SCHEMA);
  raw.prepare("INSERT INTO users (id, nickname) VALUES (1, 'Admin')").run();
  const uploadRepo = new D1OfficialGameUploadRepository(db);
  const lifecycleRepo = new D1OfficialGameLifecycleRepository(db);
  const nowIso = "2026-08-24T00:00:00.000Z";
  const identity = await uploadRepo.ensureOwoggIdentity({ slug: canonical.slug, nowIso });
  assert.ok(identity);
  const version = await uploadRepo.createVersion({
    gameId: identity.id,
    objectKey: `uploads/${identity.id}/source.zip`,
    contentHash: "c".repeat(64),
    bundleBytes: 123,
    nowIso,
  });
  await uploadRepo.upsertLogo({
    gameId: identity.id,
    objectKey: `games/${identity.id}/logo.svg`,
    nowIso,
  });
  raw.prepare("INSERT INTO scores (game_id) VALUES (?)").run(canonical.slug);
  raw.prepare("INSERT INTO user_favorites (user_id, game_id) VALUES (1, ?)").run(canonical.slug);
  raw.prepare("INSERT INTO user_recent_plays (user_id, game_id) VALUES (1, ?)").run(canonical.slug);
  raw
    .prepare("INSERT INTO discord_play_contexts (token_hash, game_id) VALUES ('token', ?)")
    .run(canonical.slug);
  raw.prepare("INSERT INTO game_settings (game_id, enabled) VALUES (?, 0)").run(canonical.slug);

  const plan = await lifecycleRepo.prepareDeletion({ slug: canonical.slug, nowIso });
  assert.ok(plan);
  assert.equal(plan.versions.length, 1);
  assert.deepEqual(plan.assetObjectKeys, [`games/${identity.id}/logo.svg`]);
  const quarantined = raw
    .prepare("SELECT visibility, live_version_id, deleted_at FROM games WHERE id = ?")
    .get(identity.id) as Record<string, unknown>;
  assert.equal(quarantined.visibility, "PRIVATE");
  assert.equal(quarantined.live_version_id, null);
  assert.equal(quarantined.deleted_at, nowIso);

  const disposition = await lifecycleRepo.purgeDeletion({
    gameId: identity.id,
    slug: canonical.slug,
    actorAdminId: 1,
    versionCount: plan.versions.length,
    objectCount: 4,
    nowIso,
  });
  assert.equal(disposition, "PURGED");
  assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM games").get()?.count, 0);
  assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM game_versions").get()?.count, 0);
  assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM game_assets").get()?.count, 0);
  assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM scores").get()?.count, 0);
  assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM user_favorites").get()?.count, 0);
  assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM game_settings").get()?.count, 0);
  assert.equal(
    raw.prepare("SELECT slug FROM official_game_deletion_audit_log").get()?.slug,
    canonical.slug,
  );

  const reRegistered = await uploadRepo.ensureOwoggIdentity({ slug: canonical.slug, nowIso });
  assert.ok(reRegistered);
  assert.notEqual(reRegistered.id, identity.id);
  assert.equal(version.gameId, identity.id);
});

test("OWOGG lifecycle preserves multiplayer history and safely reuses its tombstoned slug", async () => {
  const { db, raw } = createSqliteD1(OFFICIAL_LIFECYCLE_SCHEMA);
  raw.prepare("INSERT INTO users (id, nickname) VALUES (1, 'Admin')").run();
  const uploadRepo = new D1OfficialGameUploadRepository(db);
  const lifecycleRepo = new D1OfficialGameLifecycleRepository(db);
  const nowIso = "2026-08-27T00:00:00.000Z";
  const identity = await uploadRepo.ensureOwoggIdentity({ slug: canonical.slug, nowIso });
  assert.ok(identity);
  const version = await uploadRepo.createVersion({
    gameId: identity.id,
    objectKey: `uploads/${identity.id}/multiplayer.zip`,
    contentHash: "d".repeat(64),
    bundleBytes: 321,
    nowIso,
  });
  await uploadRepo.markPublishing({
    gameId: identity.id,
    versionId: version.id,
    contentHash: version.contentHash,
  });
  await uploadRepo.markReady(
    { gameId: identity.id, versionId: version.id, contentHash: version.contentHash },
    {
      publishedAt: nowIso,
      manifestKey: `games/${identity.id}/${version.id}/.owogg-manifest.json`,
      publishedSizeBytes: 99,
      fileCount: 2,
    },
  );
  await uploadRepo.upsertLogo({
    gameId: identity.id,
    objectKey: `games/${identity.id}/logo.svg`,
    nowIso,
  });
  await uploadRepo.activate({ gameId: identity.id, versionId: version.id, canonical, nowIso });
  raw
    .prepare("INSERT INTO multiplayer_profiles (game_id, game_version_id) VALUES (?, ?)")
    .run(identity.id, version.id);

  const plan = await lifecycleRepo.prepareDeletion({ slug: canonical.slug, nowIso });
  assert.ok(plan);
  const disposition = await lifecycleRepo.purgeDeletion({
    gameId: identity.id,
    slug: canonical.slug,
    actorAdminId: 1,
    versionCount: plan.versions.length,
    objectCount: 4,
    nowIso,
  });

  assert.equal(disposition, "HISTORY_RETAINED");
  const tombstone = raw
    .prepare("SELECT visibility, live_version_id, deleted_at FROM games WHERE id = ?")
    .get(identity.id) as Record<string, unknown>;
  assert.equal(tombstone.visibility, "PRIVATE");
  assert.equal(tombstone.live_version_id, null);
  assert.equal(tombstone.deleted_at, nowIso);
  assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM game_versions").get()?.count, 1);
  assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM multiplayer_profiles").get()?.count, 1);
  assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM game_assets").get()?.count, 0);
  assert.equal(
    raw.prepare("SELECT COUNT(*) AS count FROM official_game_deletion_audit_log").get()?.count,
    1,
  );

  const reusable = await uploadRepo.ensureOwoggIdentity({ slug: canonical.slug, nowIso });
  assert.ok(reusable);
  assert.equal(reusable.id, identity.id);
  const retiredVersion = await uploadRepo.findVersionById(identity.id, version.id);
  assert.equal(retiredVersion?.publishStatus, "FAILED");
  assert.equal(retiredVersion?.manifestKey, null);

  await uploadRepo.markPublishing({
    gameId: identity.id,
    versionId: version.id,
    contentHash: version.contentHash,
  });
  await uploadRepo.markReady(
    { gameId: identity.id, versionId: version.id, contentHash: version.contentHash },
    {
      publishedAt: nowIso,
      manifestKey: `games/${identity.id}/${version.id}/.owogg-manifest.json`,
      publishedSizeBytes: 99,
      fileCount: 2,
    },
  );
  await uploadRepo.upsertLogo({
    gameId: identity.id,
    objectKey: `games/${identity.id}/logo.svg`,
    nowIso,
  });
  await uploadRepo.activate({ gameId: identity.id, versionId: version.id, canonical, nowIso });

  const restored = raw
    .prepare("SELECT visibility, live_version_id, deleted_at FROM games WHERE id = ?")
    .get(identity.id) as Record<string, unknown>;
  assert.equal(restored.visibility, "PUBLIC");
  assert.equal(restored.live_version_id, version.id);
  assert.equal(restored.deleted_at, null);
});
