import test from "node:test";
import assert from "node:assert/strict";
import { D1SandboxGameRepository } from "../src/d1/D1SandboxGameRepository.js";
import { createSqliteD1, SANDBOX_GAMES_TEST_SCHEMA } from "./helpers/sqliteD1.js";

function seedUser(raw: import("node:sqlite").DatabaseSync, id: number, nickname: string) {
  raw
    .prepare(`INSERT INTO users (id, nickname, email, created_at) VALUES (?, ?, ?, ?)`)
    .run(id, nickname, `${nickname}@example.com`, new Date().toISOString());
}

async function seedGame(repo: D1SandboxGameRepository, slug = "test-game", developerUserId = 1) {
  const created = await repo.create({
    slug,
    developerUserId,
    title: "Test Game",
    shortDescription: "short",
    description: "long",
    genre: "puzzle",
    mode: "single",
    nowIso: new Date().toISOString(),
  });
  if (!created) throw new Error(`seedGame(${slug}) unexpectedly hit the review-slot limit`);
  return created;
}

async function seedDraft(
  repo: D1SandboxGameRepository,
  gameId: number,
  suffix: string,
  nowIso = new Date().toISOString(),
) {
  return repo.createVersion({
    gameId,
    objectKey: `draft-${suffix}.zip`,
    contentHash: `draft-${suffix}`,
    bundleBytes: 10,
    status: "DRAFT",
    nowIso,
  });
}

function submitDraft(
  repo: D1SandboxGameRepository,
  input: { gameId: number; versionId: number; developerUserId: number; nowIso?: string },
) {
  return repo.submitDraftVersion({
    gameId: input.gameId,
    versionId: input.versionId,
    developerUserId: input.developerUserId,
    claimReviewSlot: true,
    nowIso: input.nowIso ?? new Date().toISOString(),
  });
}

test("create + findBySlug/findById round-trip, visibility defaults to PRIVATE", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Dev");
  const repo = new D1SandboxGameRepository(db);

  const created = await seedGame(repo);
  assert.equal(created.visibility, "PRIVATE");
  assert.equal(created.liveVersionId, null);
  assert.equal(created.xpPerCompletion, 0);

  const bySlug = await repo.findBySlug("test-game");
  assert.equal(bySlug?.id, created.id);
  const byId = await repo.findById(created.id);
  assert.equal(byId?.slug, "test-game");
});

test("listAllPage returns total and latest server upload time in upload order", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Dev One");
  seedUser(raw, 2, "Dev Two");
  const repo = new D1SandboxGameRepository(db);
  const firstGame = await seedGame(repo, "first-game", 1);
  const secondGame = await seedGame(repo, "second-game", 2);
  await repo.createVersion({
    gameId: firstGame.id,
    objectKey: "uploads/first.zip",
    contentHash: "first",
    bundleBytes: 10,
    nowIso: "2026-08-25T09:00:00.000Z",
  });
  await repo.createVersion({
    gameId: secondGame.id,
    objectKey: "uploads/second.zip",
    contentHash: "second",
    bundleBytes: 10,
    nowIso: "2026-08-24T09:00:00.000Z",
  });

  const firstPage = await repo.listAllPage(1, 0);
  const secondPage = await repo.listAllPage(1, 1);

  assert.equal(firstPage.total, 2);
  assert.equal(firstPage.entries[0]?.game.slug, "first-game");
  assert.equal(firstPage.entries[0]?.latestUploadedAt, "2026-08-25T09:00:00.000Z");
  assert.equal(secondPage.entries[0]?.game.slug, "second-game");
});

test("the DB CHECK constraint rejects PUBLIC visibility with no live_version_id", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Dev");
  const repo = new D1SandboxGameRepository(db);
  const game = await seedGame(repo);

  await assert.rejects(() => repo.setVisibility(game.id, "PUBLIC", new Date().toISOString()));
});

test("createVersion then decideVersion(APPROVED) + setLiveVersion lets visibility go PUBLIC", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Dev");
  const repo = new D1SandboxGameRepository(db);
  const game = await seedGame(repo);

  const now = new Date().toISOString();
  const version = await repo.createVersion({
    gameId: game.id,
    objectKey: "sandbox-games/test-game/abc.zip",
    contentHash: "abc",
    bundleBytes: 1024,
    nowIso: now,
  });
  assert.equal(version.status, "PENDING_REVIEW");

  const decided = await repo.decideVersion(version.id, "APPROVED", 99, null, now);
  assert.equal(decided.status, "APPROVED");
  assert.equal(decided.reviewedByAdminId, 99);

  const withLiveVersion = await repo.setLiveVersion(game.id, version.id, now);
  assert.equal(withLiveVersion.liveVersionId, version.id);

  const published = await repo.setVisibility(game.id, "PUBLIC", now);
  assert.equal(published.visibility, "PUBLIC");
});

test("USER live-version changes advance leaderboard generation exactly once per distinct version", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Dev");
  const repo = new D1SandboxGameRepository(db);
  const game = await seedGame(repo);
  const now = new Date().toISOString();
  const createApproved = async (suffix: string) => {
    const version = await repo.createVersion({
      gameId: game.id,
      objectKey: `k-${suffix}`,
      contentHash: `h-${suffix}`,
      bundleBytes: 1,
      nowIso: now,
    });
    await repo.decideVersion(version.id, "APPROVED", 99, null, now);
    return version;
  };

  const v1 = await createApproved("1");
  await repo.setLiveVersion(game.id, v1.id, now);
  await repo.setLiveVersion(game.id, v1.id, now);
  assert.equal(
    raw.prepare("SELECT leaderboard_generation FROM games WHERE id = ?").get(game.id)
      ?.leaderboard_generation,
    1,
  );

  const v2 = await createApproved("2");
  await repo.setLiveVersion(game.id, v2.id, now);
  assert.equal(
    raw.prepare("SELECT leaderboard_generation FROM games WHERE id = ?").get(game.id)
      ?.leaderboard_generation,
    2,
  );
});

test("revokeVersionApproval reverts status to PENDING_REVIEW and clears the review fields", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Dev");
  const repo = new D1SandboxGameRepository(db);
  const game = await seedGame(repo);
  const now = new Date().toISOString();

  const version = await repo.createVersion({
    gameId: game.id,
    objectKey: "k",
    contentHash: "h",
    bundleBytes: 1,
    nowIso: now,
  });
  await repo.decideVersion(version.id, "APPROVED", 99, null, now);

  const reverted = await repo.revokeVersionApproval(version.id);
  assert.equal(reverted.status, "PENDING_REVIEW");
  assert.equal(reverted.reviewedByAdminId, null);
  assert.equal(reverted.reviewedAt, null);
  assert.equal(reverted.rejectReason, null);
});

test("clearLiveVersionIfMatches clears live_version_id and forces PRIVATE only when the version is still live", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Dev");
  const repo = new D1SandboxGameRepository(db);
  const game = await seedGame(repo);
  const now = new Date().toISOString();

  const version = await repo.createVersion({
    gameId: game.id,
    objectKey: "k",
    contentHash: "h",
    bundleBytes: 1,
    nowIso: now,
  });
  await repo.decideVersion(version.id, "APPROVED", 99, null, now);
  await repo.setLiveVersion(game.id, version.id, now);
  await repo.setVisibility(game.id, "PUBLIC", now);

  const cleared = await repo.clearLiveVersionIfMatches(game.id, version.id, now);
  assert.equal(cleared.liveVersionId, null);
  assert.equal(cleared.visibility, "PRIVATE");
});

test("clearLiveVersionIfMatches is a no-op when the given version isn't the current live one", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Dev");
  const repo = new D1SandboxGameRepository(db);
  const game = await seedGame(repo);
  const now = new Date().toISOString();

  const v1 = await repo.createVersion({
    gameId: game.id,
    objectKey: "k1",
    contentHash: "h1",
    bundleBytes: 1,
    nowIso: now,
  });
  await repo.decideVersion(v1.id, "APPROVED", 99, null, now);
  await repo.setLiveVersion(game.id, v1.id, now);
  await repo.setVisibility(game.id, "PUBLIC", now);

  const v2 = await repo.createVersion({
    gameId: game.id,
    objectKey: "k2",
    contentHash: "h2",
    bundleBytes: 1,
    nowIso: now,
  });
  await repo.decideVersion(v2.id, "APPROVED", 99, null, now);
  await repo.setLiveVersion(game.id, v2.id, now);

  // v1 is no longer live (v2 is) — clearing v1 must leave the game untouched.
  const unchanged = await repo.clearLiveVersionIfMatches(game.id, v1.id, now);
  assert.equal(unchanged.liveVersionId, v2.id);
  assert.equal(unchanged.visibility, "PUBLIC");
});

test("decideVersion(REJECTED) records the reason and never sets live_version_id", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Dev");
  const repo = new D1SandboxGameRepository(db);
  const game = await seedGame(repo);

  const now = new Date().toISOString();
  const version = await repo.createVersion({
    gameId: game.id,
    objectKey: "k",
    contentHash: "h",
    bundleBytes: 10,
    nowIso: now,
  });
  const decided = await repo.decideVersion(version.id, "REJECTED", 99, "malware", now);
  assert.equal(decided.status, "REJECTED");
  assert.equal(decided.rejectReason, "malware");

  const game2 = await repo.findById(game.id);
  assert.equal(game2?.liveVersionId, null);
});

test("re-upload keeps the previously-approved version live while the new one is pending", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Dev");
  const repo = new D1SandboxGameRepository(db);
  const game = await seedGame(repo);
  const now = new Date().toISOString();

  const v1 = await repo.createVersion({
    gameId: game.id,
    objectKey: "k1",
    contentHash: "h1",
    bundleBytes: 10,
    nowIso: now,
  });
  await repo.decideVersion(v1.id, "APPROVED", 99, null, now);
  await repo.setLiveVersion(game.id, v1.id, now);

  const v2 = await repo.createVersion({
    gameId: game.id,
    objectKey: "k2",
    contentHash: "h2",
    bundleBytes: 20,
    nowIso: now,
  });

  const current = await repo.findById(game.id);
  assert.equal(current?.liveVersionId, v1.id, "live version must not move until v2 is decided");

  const pending = await repo.listPendingVersions(20, 0);
  assert.deepEqual(
    pending.versions.map((v) => v.id),
    [v2.id],
  );
});

test("listPendingVersions is oldest-first and paginates with a total count", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Dev");
  const repo = new D1SandboxGameRepository(db);
  const g1 = await seedGame(repo, "game-1");
  const g2 = await seedGame(repo, "game-2");

  await repo.createVersion({
    gameId: g1.id,
    objectKey: "a",
    contentHash: "a",
    bundleBytes: 1,
    nowIso: "2026-01-01T00:00:00.000Z",
  });
  await repo.createVersion({
    gameId: g2.id,
    objectKey: "b",
    contentHash: "b",
    bundleBytes: 1,
    nowIso: "2026-01-02T00:00:00.000Z",
  });

  const page = await repo.listPendingVersions(1, 0);
  assert.equal(page.total, 2);
  assert.equal(page.versions.length, 1);
  assert.equal(page.versions[0]?.gameId, g1.id);
});

test("updateMetadata only touches the fields provided, leaves the rest untouched", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Dev");
  const repo = new D1SandboxGameRepository(db);
  const game = await seedGame(repo);

  const updated = await repo.updateMetadata(
    game.id,
    { xpPerCompletion: 50, scoreDirection: "desc" },
    new Date().toISOString(),
  );
  assert.equal(updated.xpPerCompletion, 50);
  assert.equal(updated.scoreDirection, "desc");
  assert.equal(updated.title, "Test Game", "untouched fields must survive a partial update");
  assert.equal(updated.genre, "puzzle");
});

test("appendReviewAudit + listReviewAudit round-trips metadata JSON and orders most-recent-first", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Dev");
  const repo = new D1SandboxGameRepository(db);
  const game = await seedGame(repo);
  const now = new Date().toISOString();

  await repo.appendReviewAudit({
    gameId: game.id,
    versionId: null,
    actorAdminId: 99,
    action: "METADATA_CHANGED",
    reason: null,
    metadata: { xpPerCompletion: 50 },
    nowIso: now,
  });
  await repo.appendReviewAudit({
    gameId: game.id,
    versionId: null,
    actorAdminId: 99,
    action: "VISIBILITY_CHANGED",
    reason: null,
    metadata: { visibility: "PUBLIC" },
    nowIso: now,
  });

  const audit = await repo.listReviewAudit(game.id, 10);
  assert.equal(audit.length, 2);
  assert.equal(audit[0]?.action, "VISIBILITY_CHANGED");
  assert.deepEqual(audit[1]?.metadata, { xpPerCompletion: 50 });
});

test("approval atomically reserves the slug and reservation survives revoke + hard delete", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Dev");
  const repo = new D1SandboxGameRepository(db);
  const game = await seedGame(repo, "approval-history", 1);
  const version = await repo.createVersion({
    gameId: game.id,
    objectKey: "uploads/approval-history.zip",
    contentHash: "approval-history-hash",
    bundleBytes: 10,
    nowIso: "2026-08-21T00:00:00.000Z",
  });
  assert.equal(await repo.isSlugPermanentlyReserved(game.slug), false);

  await repo.decideVersion(version.id, "APPROVED", 9, null, "2026-08-21T00:01:00.000Z");
  assert.equal(await repo.isSlugPermanentlyReserved(game.slug), true);
  await repo.revokeVersionApproval(version.id);
  await repo.hardDelete(game.id);

  assert.equal(await repo.isSlugPermanentlyReserved(game.slug), true);
  assert.equal(await repo.slugExists(game.slug), true);
  assert.throws(
    () =>
      raw
        .prepare(
          `INSERT INTO games (
             id, slug, publisher_type, publisher_user_id, visibility, live_version_id,
             deleted_at, created_at, updated_at
           ) VALUES (?, 'renamed-identity', 'USER', 1, 'PRIVATE', NULL, NULL, ?, ?)`,
        )
        .run(game.id, "2026-08-21T00:02:00.000Z", "2026-08-21T00:02:00.000Z"),
    /reserved identity cannot change slug/,
  );
  await assert.rejects(
    () =>
      repo.create({
        slug: game.slug,
        developerUserId: 1,
        title: "Replacement",
        shortDescription: null,
        description: null,
        genre: "puzzle",
        mode: "single",
        nowIso: "2026-08-21T00:02:00.000Z",
      }),
    /slug is permanently reserved/,
  );
});

test("listByDeveloper scopes records to the owning developer", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "DevA");
  const repo = new D1SandboxGameRepository(db);

  const mine = await seedGame(repo, "mine");
  const alsoMine = await seedGame(repo, "also-mine");
  assert.deepEqual(
    (await repo.listByDeveloper(1)).map((g) => g.id).sort(),
    [mine.id, alsoMine.id].sort(),
  );
});

// Regression (2026-08-18): listAll used to exclude soft-deleted games. That made purgeGame
// (only ever reachable on an already-deleted game) practically undiscoverable in the admin UI —
// there was no way to find one without already knowing its id. It now deliberately includes them.
test("listAll returns every game regardless of developer, visibility, or soft-deletion", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "DevA");
  seedUser(raw, 2, "DevB");
  const repo = new D1SandboxGameRepository(db);
  const now = new Date().toISOString();

  const a = await seedGame(repo, "a", 1);
  const b = await seedGame(repo, "b", 2);
  const deleted = await seedGame(repo, "c-deleted", 2);
  await repo.softDelete(deleted.id, 99, now);

  const all = await repo.listAll();
  assert.deepEqual(all.map((g) => g.id).sort(), [a.id, b.id, deleted.id].sort());
  assert.ok(all.find((g) => g.id === deleted.id)?.deletedAt !== null);
});

test("softDelete sets deleted_at/deleted_by_admin_id and forces visibility back to PRIVATE", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Dev");
  const repo = new D1SandboxGameRepository(db);
  const now = new Date().toISOString();

  const game = await seedGame(repo);
  const version = await repo.createVersion({
    gameId: game.id,
    objectKey: "k",
    contentHash: "h",
    bundleBytes: 1,
    nowIso: now,
  });
  await repo.decideVersion(version.id, "APPROVED", 99, null, now);
  await repo.setLiveVersion(game.id, version.id, now);
  await repo.setVisibility(game.id, "PUBLIC", now);

  const deleted = await repo.softDelete(game.id, 99, now);
  assert.equal(deleted.deletedAt, now);
  assert.equal(deleted.deletedByAdminId, 99);
  assert.equal(deleted.visibility, "PRIVATE");

  const reread = await repo.findById(game.id);
  assert.equal(reread?.deletedAt, now);
  assert.equal(reread?.visibility, "PRIVATE");
});

test("a soft-deleted game is excluded from findBySlug (the /play/:slug lookup path)", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Dev");
  const repo = new D1SandboxGameRepository(db);
  const now = new Date().toISOString();

  const game = await seedGame(repo, "vanishing-game");
  assert.notEqual(await repo.findBySlug("vanishing-game"), null);

  await repo.softDelete(game.id, 99, now);
  assert.equal(await repo.findBySlug("vanishing-game"), null);
  // findById stays available — admin tooling and audit trails still need to look it up by id.
  assert.notEqual(await repo.findById(game.id), null);
});

test("a soft-deleted game stays visible to its own developer via listByDeveloper", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Dev");
  const repo = new D1SandboxGameRepository(db);
  const now = new Date().toISOString();

  const game = await seedGame(repo, "deleted-but-mine");
  await repo.softDelete(game.id, 99, now);

  const mine = await repo.listByDeveloper(1);
  assert.equal(mine.length, 1);
  assert.equal(mine[0]?.id, game.id);
  assert.notEqual(mine[0]?.deletedAt, null);
});

test("a new game defaults to deleted_at/deleted_by_admin_id both null", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Dev");
  const repo = new D1SandboxGameRepository(db);
  const game = await seedGame(repo);
  assert.equal(game.deletedAt, null);
  assert.equal(game.deletedByAdminId, null);
});

test("create persists the given mode, and a new game defaults logoKey to null", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Dev");
  const repo = new D1SandboxGameRepository(db);

  const single = await repo.create({
    slug: "single-game",
    developerUserId: 1,
    title: "Single",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
    nowIso: new Date().toISOString(),
  });
  assert.equal(single?.mode, "single");
  assert.equal(single?.logoKey, null);

  const multi = await repo.create({
    slug: "multi-game",
    developerUserId: 1,
    title: "Multi",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "multi",
    nowIso: new Date().toISOString(),
  });
  assert.equal(multi?.mode, "multi");
});

test("setLogo persists the given key and leaves the rest of the row untouched", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Dev");
  const repo = new D1SandboxGameRepository(db);
  const game = await seedGame(repo);
  const now = new Date().toISOString();

  const withLogo = await repo.setLogo(game.id, `games/${game.id}/logo.png`, now);
  assert.equal(withLogo.logoKey, `games/${game.id}/logo.png`);
  assert.equal(withLogo.title, game.title);

  const reread = await repo.findById(game.id);
  assert.equal(reread?.logoKey, `games/${game.id}/logo.png`);
});

test("hardDelete removes the game row entirely, unlike softDelete", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Dev");
  const repo = new D1SandboxGameRepository(db);
  const game = await seedGame(repo, "orphaned-game");

  await repo.hardDelete(game.id);

  assert.equal(await repo.findById(game.id), null);
  assert.equal(await repo.findBySlug("orphaned-game"), null);
});

test("hardDelete frees the slug for an immediate re-insert with the same value — softDelete cannot do this", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Dev");
  const repo = new D1SandboxGameRepository(db);
  const game = await seedGame(repo, "ball-dodge");

  await repo.hardDelete(game.id);

  // The real UNIQUE constraint on sandbox_games.slug — this is the exact statement that would
  // throw if the row still existed underneath (soft-deleted or not).
  const retried = await repo.create({
    slug: "ball-dodge",
    developerUserId: 1,
    title: "Retry",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
    nowIso: new Date().toISOString(),
  });
  assert.notEqual(retried, null);
  assert.equal(retried?.slug, "ball-dodge");
});

// Regression (2026-08-18): production crashed with a raw 500 when a Game Creator re-registered a slug
// an admin had just soft-deleted — findBySlug (deleted_at-filtered) said the slug was free, but
// the raw UNIQUE constraint on sandbox_games.slug still held the old row, so the INSERT below
// throws. slugExists is the fix's foundation: it has to agree with the constraint (see it used in
// SandboxGameUseCases.createGame, tested at the use-case layer in sandboxGameUseCases.test.ts).
test("softDelete does NOT free the slug — slugExists stays true, and a raw re-insert throws", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Dev");
  const repo = new D1SandboxGameRepository(db);
  const game = await seedGame(repo, "ball-dodge");
  const now = new Date().toISOString();

  await repo.softDelete(game.id, 99, now);

  assert.equal(await repo.findBySlug("ball-dodge"), null, "findBySlug excludes deleted rows");
  assert.equal(
    await repo.slugExists("ball-dodge"),
    true,
    "but the slug is still held at the DB level",
  );

  await assert.rejects(() =>
    repo.create({
      slug: "ball-dodge",
      developerUserId: 1,
      title: "Retry",
      shortDescription: null,
      description: null,
      genre: "puzzle",
      mode: "single",
      nowIso: new Date().toISOString(),
    }),
  );
});

test("hardDelete also removes the game's versions and review-audit rows (no orphaned children)", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Dev");
  const repo = new D1SandboxGameRepository(db);
  const now = new Date().toISOString();
  const game = await seedGame(repo);

  const version = await repo.createVersion({
    gameId: game.id,
    objectKey: "k",
    contentHash: "h",
    bundleBytes: 1,
    nowIso: now,
  });
  await repo.appendReviewAudit({
    gameId: game.id,
    versionId: null,
    actorAdminId: 99,
    action: "SUBMISSION_WITHDRAWN",
    reason: null,
    metadata: null,
    nowIso: now,
  });

  await repo.hardDelete(game.id);

  assert.equal(await repo.findVersionById(version.id), null);
  assert.deepEqual(await repo.listReviewAudit(game.id, 50), []);
  const versionRowCount = raw
    .prepare(`SELECT COUNT(*) AS n FROM sandbox_game_versions WHERE game_id = ?`)
    .get(game.id) as { n: number };
  assert.equal(versionRowCount.n, 0);
  const auditRowCount = raw
    .prepare(`SELECT COUNT(*) AS n FROM sandbox_game_review_audit_log WHERE game_id = ?`)
    .get(game.id) as { n: number };
  assert.equal(auditRowCount.n, 0);
});

test("a new version starts UPLOADED on the publish axis, independent of its review status", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Dev");
  const repo = new D1SandboxGameRepository(db);
  const game = await seedGame(repo);
  const now = new Date().toISOString();

  const version = await repo.createVersion({
    gameId: game.id,
    objectKey: `uploads/${game.id}/abc.zip`,
    contentHash: "abc",
    bundleBytes: 1024,
    nowIso: now,
  });

  assert.equal(version.status, "PENDING_REVIEW");
  assert.equal(version.publishStatus, "UPLOADED");
  assert.equal(version.publishError, null);
  assert.equal(version.publishedAt, null);
  assert.equal(version.manifestKey, null);
  assert.equal(version.publishedSizeBytes, null);
  assert.equal(version.fileCount, null);
});

test("setVersionPublishState round-trips a READY transition and then a FAILED one", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Dev");
  const repo = new D1SandboxGameRepository(db);
  const game = await seedGame(repo);
  const now = new Date().toISOString();
  const version = await repo.createVersion({
    gameId: game.id,
    objectKey: `uploads/${game.id}/abc.zip`,
    contentHash: "abc",
    bundleBytes: 1024,
    nowIso: now,
  });

  const ready = await repo.setVersionPublishState(version.id, {
    publishStatus: "READY",
    publishError: null,
    publishedAt: now,
    manifestKey: `games/${game.id}/${version.id}/.owogg-manifest.json`,
    publishedSizeBytes: 4096,
    fileCount: 7,
  });
  assert.equal(ready.publishStatus, "READY");
  assert.equal(ready.publishedAt, now);
  assert.equal(ready.manifestKey, `games/${game.id}/${version.id}/.owogg-manifest.json`);
  assert.equal(ready.publishedSizeBytes, 4096);
  assert.equal(ready.fileCount, 7);
  // The review axis is untouched by a publish transition.
  assert.equal(ready.status, "PENDING_REVIEW");

  // A later failure must clear the success fields rather than leave a stale manifest pointer.
  const failed = await repo.setVersionPublishState(version.id, {
    publishStatus: "FAILED",
    publishError: "simulated storage failure",
    publishedAt: null,
    manifestKey: null,
    publishedSizeBytes: null,
    fileCount: null,
  });
  assert.equal(failed.publishStatus, "FAILED");
  assert.equal(failed.publishError, "simulated storage failure");
  assert.equal(failed.manifestKey, null);
  assert.equal(failed.publishedSizeBytes, null);
  assert.equal(failed.fileCount, null);
});

// ── review-slot quota (beta concurrent-submission cap) ───────────────────────

test("draft submission claims slot 1, then slot 2, while registration itself claims none", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Dev");
  const repo = new D1SandboxGameRepository(db);

  const g1 = await seedGame(repo, "game-1");
  const g2 = await seedGame(repo, "game-2");

  assert.equal(g1.reviewSlot, null);
  assert.equal(g2.reviewSlot, null);
  assert.ok(
    await submitDraft(repo, {
      gameId: g1.id,
      versionId: (await seedDraft(repo, g1.id, "1")).id,
      developerUserId: 1,
    }),
  );
  assert.ok(
    await submitDraft(repo, {
      gameId: g2.id,
      versionId: (await seedDraft(repo, g2.id, "2")).id,
      developerUserId: 1,
    }),
  );
  assert.equal((await repo.findById(g1.id))?.reviewSlot, 1);
  assert.equal((await repo.findById(g2.id))?.reviewSlot, 2);
});

test("a third concurrent review submission is refused while its game and draft remain private", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Dev");
  const repo = new D1SandboxGameRepository(db);

  const first = await seedGame(repo, "game-1");
  const second = await seedGame(repo, "game-2");
  const third = await seedGame(repo, "game-3");
  assert.ok(
    await submitDraft(repo, {
      gameId: first.id,
      versionId: (await seedDraft(repo, first.id, "1")).id,
      developerUserId: 1,
    }),
  );
  assert.ok(
    await submitDraft(repo, {
      gameId: second.id,
      versionId: (await seedDraft(repo, second.id, "2")).id,
      developerUserId: 1,
    }),
  );
  const thirdDraft = await seedDraft(repo, third.id, "3");

  assert.equal(
    await submitDraft(repo, { gameId: third.id, versionId: thirdDraft.id, developerUserId: 1 }),
    null,
  );
  assert.equal((await repo.findById(third.id))?.reviewSlot, null);
  assert.equal((await repo.findVersionById(thirdDraft.id))?.status, "DRAFT");
});

test("concurrent draft submissions for the same developer never claim more than 2 slots", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Dev");
  const repo = new D1SandboxGameRepository(db);

  const candidates = [];
  for (let index = 0; index < 5; index += 1) {
    const game = await seedGame(repo, `race-game-${index}`);
    candidates.push({ game, version: await seedDraft(repo, game.id, `race-${index}`) });
  }
  const results = await Promise.all(
    candidates.map(({ game, version }) =>
      submitDraft(repo, { gameId: game.id, versionId: version.id, developerUserId: 1 }),
    ),
  );

  const succeeded = results.filter((r) => r !== null);
  assert.equal(succeeded.length, 2, "exactly 2 of 5 concurrent submissions may succeed");
  const allGames = await repo.listByDeveloper(1);
  assert.equal(allGames.length, 5, "registration remains independent from review capacity");
  assert.deepEqual(
    allGames.flatMap((game) => (game.reviewSlot === null ? [] : [game.reviewSlot])).sort(),
    [1, 2],
  );
});

test("the UNIQUE INDEX itself rejects a second row claiming an already-held slot, independent of app logic", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Dev");
  const repo = new D1SandboxGameRepository(db);
  const game = await seedGame(repo, "game-1");
  raw.prepare("UPDATE sandbox_games SET review_slot = 1 WHERE id = ?").run(game.id);

  // Bypass the repository entirely and try to insert a second row with the same
  // (developer_user_id, review_slot) directly via raw SQL — this is the actual DB invariant, not
  // the application code's cooperation with it.
  assert.throws(() => {
    raw
      .prepare(
        `INSERT INTO sandbox_games
           (slug, developer_user_id, title, genre, review_slot, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "raw-insert-game",
        1,
        "Raw",
        "puzzle",
        1,
        new Date().toISOString(),
        new Date().toISOString(),
      );
  }, /UNIQUE constraint failed/);
});

test("different developers each get their own independent 2-slot budget", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "DevA");
  seedUser(raw, 2, "DevB");
  const repo = new D1SandboxGameRepository(db);

  const a1 = await seedGame(repo, "a1", 1);
  const a2 = await seedGame(repo, "a2", 1);
  assert.ok(
    await submitDraft(repo, {
      gameId: a1.id,
      versionId: (await seedDraft(repo, a1.id, "a1")).id,
      developerUserId: 1,
    }),
  );
  assert.ok(
    await submitDraft(repo, {
      gameId: a2.id,
      versionId: (await seedDraft(repo, a2.id, "a2")).id,
      developerUserId: 1,
    }),
  );
  // DevA is now at their limit — DevB is unaffected.
  const b1 = await seedGame(repo, "b1", 2);
  assert.ok(
    await submitDraft(repo, {
      gameId: b1.id,
      versionId: (await seedDraft(repo, b1.id, "b1")).id,
      developerUserId: 2,
    }),
  );
  assert.equal((await repo.findById(b1.id))?.reviewSlot, 1);

  const aThird = await seedGame(repo, "a3", 1);
  assert.equal(
    await submitDraft(repo, {
      gameId: aThird.id,
      versionId: (await seedDraft(repo, aThird.id, "a3")).id,
      developerUserId: 1,
    }),
    null,
  );
});

test("releaseReviewSlot frees the slot for reuse by a later submission", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Dev");
  const repo = new D1SandboxGameRepository(db);
  const g1 = await seedGame(repo, "game-1");
  const g2 = await seedGame(repo, "game-2");
  const now = new Date().toISOString();

  assert.ok(
    await submitDraft(repo, {
      gameId: g1.id,
      versionId: (await seedDraft(repo, g1.id, "1")).id,
      developerUserId: 1,
    }),
  );
  assert.ok(
    await submitDraft(repo, {
      gameId: g2.id,
      versionId: (await seedDraft(repo, g2.id, "2")).id,
      developerUserId: 1,
    }),
  );

  const released = await repo.releaseReviewSlot(g1.id, now);
  assert.equal(released.reviewSlot, null);

  const g3 = await seedGame(repo, "game-3");
  assert.ok(
    await submitDraft(repo, {
      gameId: g3.id,
      versionId: (await seedDraft(repo, g3.id, "3")).id,
      developerUserId: 1,
    }),
  );
  assert.equal(
    (await repo.findById(g3.id))?.reviewSlot,
    1,
    "the freed slot 1 is reused, not appended as a 3rd concurrent slot",
  );
});

test("releaseReviewSlot is idempotent — releasing an already-released slot is a harmless no-op", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Dev");
  const repo = new D1SandboxGameRepository(db);
  const g1 = await seedGame(repo, "game-1");
  const now = new Date().toISOString();

  await repo.releaseReviewSlot(g1.id, now);
  const releasedAgain = await repo.releaseReviewSlot(g1.id, now);
  assert.equal(releasedAgain.reviewSlot, null);
});

// ── withdrawal ─────────────────────────────────────────────────────────────

test("withdrawVersion marks a PENDING_REVIEW version WITHDRAWN", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Dev");
  const repo = new D1SandboxGameRepository(db);
  const game = await seedGame(repo);
  const version = await repo.createVersion({
    gameId: game.id,
    objectKey: "k",
    contentHash: "h",
    bundleBytes: 1,
    nowIso: new Date().toISOString(),
  });

  const withdrawn = await repo.withdrawVersion(version.id);
  assert.equal(withdrawn.status, "WITHDRAWN");
  assert.equal(withdrawn.reviewedByAdminId, null, "nobody reviewed a self-withdrawn submission");
});

test("withdrawVersion is a no-op on a version that has already been decided", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Dev");
  const repo = new D1SandboxGameRepository(db);
  const game = await seedGame(repo);
  const now = new Date().toISOString();
  const version = await repo.createVersion({
    gameId: game.id,
    objectKey: "k",
    contentHash: "h",
    bundleBytes: 1,
    nowIso: now,
  });
  await repo.decideVersion(version.id, "APPROVED", 99, null, now);

  const result = await repo.withdrawVersion(version.id);
  assert.equal(result.status, "APPROVED", "an already-decided version must not be overwritten");
});

test("concurrent createVersion batches each return their own shared-ID USER row", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Dev");
  const repo = new D1SandboxGameRepository(db);
  const game = await seedGame(repo);

  const results = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      repo.createVersion({
        gameId: game.id,
        objectKey: `k-${i}`,
        contentHash: `hash-${i}`,
        bundleBytes: i,
        nowIso: new Date().toISOString(),
      }),
    ),
  );

  // Each of the 5 concurrent calls must see its own distinct objectKey/contentHash back — a
  // `last_insert_rowid()`-based read-back could instead let two calls both report the same
  // (most-recently-written) row.
  assert.deepEqual(results.map((r) => r.objectKey).sort(), ["k-0", "k-1", "k-2", "k-3", "k-4"]);
  assert.equal(new Set(results.map((r) => r.id)).size, 5, "every call must get a distinct row id");
});

// ── Stage A-3: Write Convergence & Shared ID Namespace ─────────────────────

test("Stage A-3: shared numeric ID namespace does not collide with existing OWOGG games", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Dev");

  // Pre-seed an OWOGG game in games table at id = 100
  raw
    .prepare(
      `INSERT INTO games (id, slug, publisher_type, publisher_user_id, visibility, live_version_id, created_at, updated_at)
       VALUES (100, 'reaction-time', 'OWOGG', NULL, 'PRIVATE', NULL, '2026-08-19T00:00:00.000Z', '2026-08-19T00:00:00.000Z')`,
    )
    .run();

  const repo = new D1SandboxGameRepository(db);
  const created = await repo.create({
    slug: "my-user-game",
    developerUserId: 1,
    title: "User Game",
    shortDescription: "desc",
    description: null,
    genre: "arcade",
    mode: "single",
    nowIso: "2026-08-20T12:00:00.000Z",
  });

  assert.ok(created);
  assert.equal(created.id, 101, "new game allocates next id in shared games namespace");

  // Verify games table has matching USER row with same id
  const genericRow = raw.prepare("SELECT * FROM games WHERE id = ?").get(created.id) as Record<
    string,
    unknown
  >;
  assert.ok(genericRow);
  assert.equal(genericRow.slug, "my-user-game");
  assert.equal(genericRow.publisher_type, "USER");
  assert.equal(genericRow.publisher_user_id, 1);

  // Verify OWOGG row at id = 100 is unchanged
  const owoggRow = raw.prepare("SELECT * FROM games WHERE id = 100").get() as Record<
    string,
    unknown
  >;
  assert.ok(owoggRow);
  assert.equal(owoggRow.publisher_type, "OWOGG");
  assert.equal(owoggRow.slug, "reaction-time");
});

test("Stage A-3: review slot exhaustion leaves the third registered game and draft unchanged", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Dev");
  const repo = new D1SandboxGameRepository(db);

  const first = await seedGame(repo, "game-1", 1);
  const second = await seedGame(repo, "game-2", 1);
  assert.ok(
    await submitDraft(repo, {
      gameId: first.id,
      versionId: (await seedDraft(repo, first.id, "1")).id,
      developerUserId: 1,
    }),
  );
  assert.ok(
    await submitDraft(repo, {
      gameId: second.id,
      versionId: (await seedDraft(repo, second.id, "2")).id,
      developerUserId: 1,
    }),
  );

  const initialGamesCount = Number(
    (raw.prepare("SELECT COUNT(*) as c FROM games").get() as { c: number }).c,
  );
  const initialSandboxCount = Number(
    (raw.prepare("SELECT COUNT(*) as c FROM sandbox_games").get() as { c: number }).c,
  );
  assert.equal(initialGamesCount, 2);
  assert.equal(initialSandboxCount, 2);

  const third = await seedGame(repo, "game-3", 1);
  const thirdDraft = await seedDraft(repo, third.id, "3");
  assert.equal(
    await submitDraft(repo, { gameId: third.id, versionId: thirdDraft.id, developerUserId: 1 }),
    null,
  );

  const finalGamesCount = Number(
    (raw.prepare("SELECT COUNT(*) as c FROM games").get() as { c: number }).c,
  );
  const finalSandboxCount = Number(
    (raw.prepare("SELECT COUNT(*) as c FROM sandbox_games").get() as { c: number }).c,
  );
  assert.equal(finalGamesCount, 3);
  assert.equal(finalSandboxCount, 3);
  assert.equal((await repo.findById(third.id))?.reviewSlot, null);
  assert.equal((await repo.findVersionById(thirdDraft.id))?.status, "DRAFT");
});

test("Stage A-3: slugExists checks global games identity namespace including OWOGG games", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Dev");
  const repo = new D1SandboxGameRepository(db);

  await seedGame(repo, "user-game", 1);

  // Seed an OWOGG game directly in games
  raw
    .prepare(
      `INSERT INTO games (id, slug, publisher_type, publisher_user_id, visibility, live_version_id, created_at, updated_at)
       VALUES (99, 'official-memory-test', 'OWOGG', NULL, 'PRIVATE', NULL, '2026-08-19T00:00:00.000Z', '2026-08-19T00:00:00.000Z')`,
    )
    .run();

  assert.equal(await repo.slugExists("user-game"), true);
  assert.equal(await repo.slugExists("official-memory-test"), true);
  assert.equal(await repo.slugExists("unused-slug"), false);
});

test("Stage A-3: all write paths maintain exact parity in games identity table", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Dev");
  const repo = new D1SandboxGameRepository(db);

  // 1. create
  const game = await seedGame(repo, "parity-game", 1);
  let gRow = raw.prepare("SELECT * FROM games WHERE id = ?").get(game.id) as Record<
    string,
    unknown
  >;
  assert.equal(gRow.slug, "parity-game");
  assert.equal(gRow.publisher_type, "USER");
  assert.equal(gRow.publisher_user_id, 1);
  assert.equal(gRow.visibility, "PRIVATE");
  assert.equal(gRow.live_version_id, null);
  assert.equal(gRow.deleted_at, null);

  // 2. updateMetadata updates updated_at in games
  const metaTime = "2026-08-20T14:00:00.000Z";
  await repo.updateMetadata(game.id, { title: "Updated Title" }, metaTime);
  gRow = raw.prepare("SELECT * FROM games WHERE id = ?").get(game.id) as Record<string, unknown>;
  assert.equal(gRow.updated_at, metaTime);

  // 3. setLogo updates updated_at in games
  const logoTime = "2026-08-20T14:10:00.000Z";
  await repo.setLogo(game.id, "games/1/logo.png", logoTime);
  gRow = raw.prepare("SELECT * FROM games WHERE id = ?").get(game.id) as Record<string, unknown>;
  assert.equal(gRow.updated_at, logoTime);

  // 4. setLiveVersion updates live_version_id in games
  const verTime = "2026-08-20T14:20:00.000Z";
  const version = await repo.createVersion({
    gameId: game.id,
    objectKey: "uploads/parity.zip",
    contentHash: "parity-hash",
    bundleBytes: 42,
    status: "DRAFT",
    nowIso: "2026-08-20T14:15:00.000Z",
  });
  assert.ok(
    await repo.submitDraftVersion({
      gameId: game.id,
      versionId: version.id,
      developerUserId: 1,
      claimReviewSlot: true,
      nowIso: "2026-08-20T14:16:00.000Z",
    }),
  );
  await repo.setLiveVersion(game.id, version.id, verTime);
  gRow = raw.prepare("SELECT * FROM games WHERE id = ?").get(game.id) as Record<string, unknown>;
  assert.equal(gRow.live_version_id, version.id);
  assert.equal(gRow.updated_at, verTime);

  // 5. setVisibility updates visibility in games
  const visTime = "2026-08-20T14:30:00.000Z";
  await repo.setVisibility(game.id, "PUBLIC", visTime);
  gRow = raw.prepare("SELECT * FROM games WHERE id = ?").get(game.id) as Record<string, unknown>;
  assert.equal(gRow.visibility, "PUBLIC");
  assert.equal(gRow.updated_at, visTime);

  // 6. releaseReviewSlot updates updated_at in games
  const slotTime = "2026-08-20T14:40:00.000Z";
  await repo.releaseReviewSlot(game.id, slotTime);
  gRow = raw.prepare("SELECT * FROM games WHERE id = ?").get(game.id) as Record<string, unknown>;
  assert.equal(gRow.updated_at, slotTime);

  // 7. clearLiveVersionIfMatches (with mismatch -> no-op)
  await repo.clearLiveVersionIfMatches(game.id, 999, "2026-08-20T14:50:00.000Z");
  gRow = raw.prepare("SELECT * FROM games WHERE id = ?").get(game.id) as Record<string, unknown>;
  assert.equal(
    gRow.live_version_id,
    version.id,
    "mismatched version must not clear live_version_id",
  );
  assert.equal(gRow.visibility, "PUBLIC", "mismatched version must not change visibility");

  // 8. clearLiveVersionIfMatches (with match -> clears live_version_id and sets PRIVATE)
  const clearTime = "2026-08-20T15:00:00.000Z";
  await repo.clearLiveVersionIfMatches(game.id, version.id, clearTime);
  gRow = raw.prepare("SELECT * FROM games WHERE id = ?").get(game.id) as Record<string, unknown>;
  assert.equal(gRow.live_version_id, null);
  assert.equal(gRow.visibility, "PRIVATE");
  assert.equal(gRow.updated_at, clearTime);

  // 9. softDelete updates deleted_at and visibility in games
  const deleteTime = "2026-08-20T15:30:00.000Z";
  await repo.softDelete(game.id, 99, deleteTime);
  gRow = raw.prepare("SELECT * FROM games WHERE id = ?").get(game.id) as Record<string, unknown>;
  assert.equal(gRow.deleted_at, deleteTime);
  assert.equal(gRow.visibility, "PRIVATE");
  assert.equal(gRow.updated_at, deleteTime);

  // 10. hardDelete removes row from both sandbox_games and games
  await repo.hardDelete(game.id);
  const deletedSandbox = raw.prepare("SELECT * FROM sandbox_games WHERE id = ?").get(game.id);
  const deletedGeneric = raw.prepare("SELECT * FROM games WHERE id = ?").get(game.id);
  assert.equal(deletedSandbox, undefined);
  assert.equal(deletedGeneric, undefined);
});

test("Stage A-3: true second-statement rollback — games INSERT succeeds then sandbox INSERT fails, leaving zero orphan rows", async () => {
  // This test proves the *correct* partial-batch-failure scenario:
  //   Statement 1 (games INSERT) succeeds and writes a row.
  //   Statement 2 (sandbox_games INSERT) is then forcibly aborted by a test-only
  //   BEFORE INSERT trigger that fires for the exact slug under test.
  //   The db.batch() helper wraps both statements in BEGIN/COMMIT/ROLLBACK, so
  //   the abort in Statement 2 causes the entire transaction — including the
  //   already-committed Statement 1 row — to roll back.
  //   Final assertion: both games and sandbox_games have 0 rows for that slug.
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  raw.exec("PRAGMA foreign_keys = ON;");
  // Seed a real, valid user so Statement 1 (games) does NOT fail on FK.
  seedUser(raw, 1, "Dev");

  // Install a test-only BEFORE INSERT trigger that aborts sandbox_games writes for
  // the specific slug. This guarantees Statement 1 (games) always succeeds first.
  raw.exec(`
      CREATE TRIGGER trg_test_only_sandbox_abort_for_slug
      BEFORE INSERT ON sandbox_games
      FOR EACH ROW
      WHEN NEW.slug = 'second-stmt-fail-game'
      BEGIN
        SELECT RAISE(ABORT, 'test-only: forced sandbox_games INSERT failure for rollback proof');
      END;
    `);

  const repo = new D1SandboxGameRepository(db);

  // Verify no rows exist before the attempt.
  const gamesBefore = Number(
    (
      raw.prepare("SELECT COUNT(*) as c FROM games WHERE slug = 'second-stmt-fail-game'").get() as {
        c: number;
      }
    ).c,
  );
  assert.equal(gamesBefore, 0, "precondition: games is empty before attempt");

  // Statement 2 (sandbox_games) must fail; db.batch() must reject.
  await assert.rejects(
    () =>
      repo.create({
        slug: "second-stmt-fail-game",
        developerUserId: 1,
        title: "Rollback Test",
        shortDescription: null,
        description: null,
        genre: "puzzle",
        mode: "single",
        nowIso: new Date().toISOString(),
      }),
    /forced sandbox_games INSERT failure/,
  );

  // After rejection both tables must be clean — the games row written by Statement 1
  // must have been rolled back together with the failed Statement 2.
  const gamesCount = Number(
    (
      raw.prepare("SELECT COUNT(*) as c FROM games WHERE slug = 'second-stmt-fail-game'").get() as {
        c: number;
      }
    ).c,
  );
  const sandboxCount = Number(
    (
      raw
        .prepare("SELECT COUNT(*) as c FROM sandbox_games WHERE slug = 'second-stmt-fail-game'")
        .get() as { c: number }
    ).c,
  );
  assert.equal(gamesCount, 0, "Statement 1 games row must be rolled back — no orphan in games");
  assert.equal(sandboxCount, 0, "Statement 2 never inserted — no orphan in sandbox_games either");
});

test("Stage A-3: FK failure on games INSERT (Statement 1) also leaves zero rows — documented as first-statement, not second-statement, rollback", async () => {
  // Separate from the second-statement proof above: this exercises the case where the
  // games INSERT itself fails (bad FK).  The label clarifies it is *first-statement*
  // failure, not second-statement rollback.
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  raw.exec("PRAGMA foreign_keys = ON;");
  // Do NOT seed user 999999 — FK on games.publisher_user_id must fire.
  const repo = new D1SandboxGameRepository(db);

  await assert.rejects(
    () =>
      repo.create({
        slug: "orphan-test-game",
        developerUserId: 999999,
        title: "Orphan",
        shortDescription: null,
        description: null,
        genre: "puzzle",
        mode: "single",
        nowIso: new Date().toISOString(),
      }),
    /FOREIGN KEY constraint failed/,
  );

  const gamesCount = Number(
    (raw.prepare("SELECT COUNT(*) as c FROM games").get() as { c: number }).c,
  );
  const sandboxCount = Number(
    (raw.prepare("SELECT COUNT(*) as c FROM sandbox_games").get() as { c: number }).c,
  );
  assert.equal(gamesCount, 0, "no orphan rows in games");
  assert.equal(sandboxCount, 0, "no orphan rows in sandbox_games");
});

test("Stage A-3: UPDATE trigger recovers a missing USER generic row in games (convergent upsert)", async () => {
  // Proves the missing-destination hardening: if the games projection row for a
  // sandbox USER game is somehow absent (deployment gap, direct deletion, etc.),
  // the AFTER UPDATE trigger on sandbox_games must re-create it with exact parity
  // rather than silently doing nothing and leaving the tables out of sync.
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Dev");
  const repo = new D1SandboxGameRepository(db);

  // Create a game normally so both tables are in sync.
  const game = await seedGame(repo, "recovery-game", 1);

  // Simulate the deployment-gap scenario: manually delete the games row while
  // keeping sandbox_games intact (as if 0029 migration landed but 0030 triggers
  // hadn't been installed yet when the row was created).
  raw.prepare("DELETE FROM games WHERE id = ?").run(game.id);
  const missingCheck = raw.prepare("SELECT * FROM games WHERE id = ?").get(game.id);
  assert.equal(missingCheck, undefined, "precondition: games row is missing");

  // Trigger an UPDATE on sandbox_games (any field change will do).
  const repairTime = "2026-08-21T10:00:00.000Z";
  await repo.updateMetadata(game.id, { title: "Recovered Title" }, repairTime);

  // The AFTER UPDATE trigger must have re-created the games row with exact parity.
  const recovered = raw.prepare("SELECT * FROM games WHERE id = ?").get(game.id) as Record<
    string,
    unknown
  >;
  assert.ok(recovered, "games row must be restored by the UPDATE trigger");
  assert.equal(recovered.slug, game.slug, "slug must match sandbox_games authority");
  assert.equal(recovered.publisher_type, "USER");
  assert.equal(Number(recovered.publisher_user_id), 1);
  assert.equal(recovered.updated_at, repairTime, "updated_at must be the repair timestamp");

  // Subsequent sandbox writes must continue to maintain parity normally.
  const visTime = "2026-08-21T10:10:00.000Z";
  const version = await repo.createVersion({
    gameId: game.id,
    objectKey: "uploads/recovery.zip",
    contentHash: "recovery-hash",
    bundleBytes: 55,
    nowIso: "2026-08-21T10:05:00.000Z",
  });
  await repo.setLiveVersion(game.id, version.id, visTime);
  const afterLV = raw.prepare("SELECT * FROM games WHERE id = ?").get(game.id) as Record<
    string,
    unknown
  >;
  assert.equal(Number(afterLV.live_version_id), version.id);
  assert.equal(afterLV.updated_at, visTime);
});

test("Stage A-3: concurrent create by different developers allocates distinct IDs without collision", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Dev1");
  seedUser(raw, 2, "Dev2");
  seedUser(raw, 3, "Dev3");
  const repo = new D1SandboxGameRepository(db);

  const results = await Promise.all([
    repo.create({
      slug: "dev1-game-1",
      developerUserId: 1,
      title: "Dev1 G1",
      shortDescription: null,
      description: null,
      genre: "puzzle",
      mode: "single",
      nowIso: new Date().toISOString(),
    }),
    repo.create({
      slug: "dev2-game-1",
      developerUserId: 2,
      title: "Dev2 G1",
      shortDescription: null,
      description: null,
      genre: "arcade",
      mode: "single",
      nowIso: new Date().toISOString(),
    }),
    repo.create({
      slug: "dev3-game-1",
      developerUserId: 3,
      title: "Dev3 G1",
      shortDescription: null,
      description: null,
      genre: "action",
      mode: "single",
      nowIso: new Date().toISOString(),
    }),
  ]);

  assert.equal(results.length, 3);
  assert.ok(results[0]);
  assert.ok(results[1]);
  assert.ok(results[2]);

  const ids = results.map((r) => r!.id);
  assert.equal(new Set(ids).size, 3, "all created games get distinct IDs");

  // Verify all 3 have exact match in games table
  for (const r of results) {
    const gRow = raw.prepare("SELECT * FROM games WHERE id = ?").get(r!.id) as Record<
      string,
      unknown
    >;
    assert.ok(gRow);
    assert.equal(gRow.slug, r!.slug);
    assert.equal(gRow.publisher_type, "USER");
    assert.equal(gRow.publisher_user_id, r!.developerUserId);
  }
});

test("0034: Game Creator reads use generic games/game_versions as the authority", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Dev");
  const repo = new D1SandboxGameRepository(db);
  const game = await seedGame(repo, "generic-authority", 1);

  raw.prepare("UPDATE games SET title = 'Generic title' WHERE id = ?").run(game.id);
  assert.equal((await repo.findById(game.id))?.title, "Generic title");
  assert.notEqual(
    (raw.prepare("SELECT title FROM sandbox_games WHERE id = ?").get(game.id) as { title: string })
      .title,
    "Generic title",
    "legacy mirror may be stale without changing the repository read authority",
  );

  raw.prepare("UPDATE sandbox_games SET title = 'Old Worker title' WHERE id = ?").run(game.id);
  assert.equal(
    (raw.prepare("SELECT title FROM games WHERE id = ?").get(game.id) as { title: string }).title,
    "Old Worker title",
    "deployment-gap trigger must converge an old Worker write into games",
  );

  const version = await repo.createVersion({
    gameId: game.id,
    objectKey: "uploads/generic-authority.zip",
    contentHash: "generic-authority-hash",
    bundleBytes: 10,
    nowIso: "2026-08-22T00:00:00.000Z",
  });
  raw
    .prepare("UPDATE game_versions SET moderation_status = 'APPROVED' WHERE id = ?")
    .run(version.id);
  assert.equal((await repo.findVersionById(version.id))?.status, "APPROVED");
});

test("game content metadata round-trips tags and the default screen mode", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Content Dev");
  const repo = new D1SandboxGameRepository(db);
  const created = await repo.create({
    slug: "content-metadata",
    developerUserId: 1,
    title: "Content Metadata",
    shortDescription: null,
    description: "English fallback",
    genre: "board",
    mode: "single",
    tags: ["board", "strategy"],
    defaultScreenMode: "theater",
    nowIso: "2026-09-01T00:00:00.000Z",
  });

  assert.deepEqual(created?.tags, ["board", "strategy"]);
  assert.equal(created?.defaultScreenMode, "theater");
  assert.equal((await repo.findBySlug("content-metadata"))?.defaultScreenMode, "theater");
});

test("creator content cooldown is an atomic 24-hour claim and exposes the next edit time", async () => {
  const { db, raw } = createSqliteD1(SANDBOX_GAMES_TEST_SCHEMA);
  seedUser(raw, 1, "Cooldown Dev");
  const repo = new D1SandboxGameRepository(db);
  const game = await seedGame(repo, "cooldown-game", 1);
  const firstAt = "2026-09-01T00:00:00.000Z";

  const simultaneous = await Promise.all([
    repo.claimContentEdit({
      gameId: game.id,
      userId: 1,
      nowIso: firstAt,
      cutoffIso: "2026-08-31T00:00:00.000Z",
    }),
    repo.claimContentEdit({
      gameId: game.id,
      userId: 1,
      nowIso: firstAt,
      cutoffIso: "2026-08-31T00:00:00.000Z",
    }),
  ]);
  assert.equal(simultaneous.filter((result) => result.claimed).length, 1);
  assert.equal((await repo.findById(game.id))?.contentEditAvailableAt, "2026-09-02T00:00:00.000Z");

  const early = await repo.claimContentEdit({
    gameId: game.id,
    userId: 1,
    nowIso: "2026-09-01T23:59:59.999Z",
    cutoffIso: "2026-08-31T23:59:59.999Z",
  });
  assert.deepEqual(early, {
    claimed: false,
    availableAt: "2026-09-02T00:00:00.000Z",
  });

  const afterWindow = await repo.claimContentEdit({
    gameId: game.id,
    userId: 1,
    nowIso: "2026-09-02T00:00:00.000Z",
    cutoffIso: firstAt,
  });
  assert.deepEqual(afterWindow, { claimed: true, availableAt: null });
});
