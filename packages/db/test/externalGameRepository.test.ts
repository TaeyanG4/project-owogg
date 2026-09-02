import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { D1ExternalGameRepository } from "../src/d1/D1ExternalGameRepository.js";
import { createSqliteD1 } from "./helpers/sqliteD1.js";

const NOW = "2026-09-02T00:00:00.000Z";
const schema = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE users (id INTEGER PRIMARY KEY, nickname TEXT NOT NULL);
  CREATE TABLE profile_contribution_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contribution_type TEXT NOT NULL,
    source_key TEXT NOT NULL,
    metadata_json TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (contribution_type, source_key)
  );
`;

function content(title: string) {
  return {
    title,
    shortDescription: `${title} 소개`,
    descriptionMarkdown: `${title} 상세 소개`,
    platformName: "itch.io",
    externalUrl: "https://example.com/game",
    releaseDate: "2026-09-02",
    tags: ["indie", "puzzle"],
    ownershipType: "THIRD_PARTY" as const,
    rightsNote: "게시 권한 확인",
  };
}

test("D1 enforces three concurrent review slots and approval frees the slot", async () => {
  const { db, raw } = createSqliteD1(schema);
  raw.exec(
    fs.readFileSync(
      new URL("../migrations/0055_external_game_introductions.sql", import.meta.url),
      "utf8",
    ),
  );
  raw
    .prepare("INSERT INTO users (id, nickname) VALUES (1, '소개자'), (2, '관리자'), (3, '독자')")
    .run();
  const repo = new D1ExternalGameRepository(db);

  const games = await Promise.all(
    [1, 2, 3, 4].map((number) =>
      repo.create({
        slug: `external-game-${number}`,
        introducerUserId: 1,
        content: content(`External Game ${number}`),
        nowIso: NOW,
      }),
    ),
  );

  for (const [index, game] of games.slice(0, 3).entries()) {
    const submitted = await repo.submitForReview({ id: game.id, introducerUserId: 1, nowIso: NOW });
    assert.equal(submitted?.reviewSlot, index + 1);
  }
  assert.equal(
    await repo.submitForReview({ id: games[3]!.id, introducerUserId: 1, nowIso: NOW }),
    null,
  );

  const approved = await repo.decideReview({
    id: games[0]!.id,
    decision: "APPROVED",
    adminId: 2,
    reason: null,
    nowIso: NOW,
  });
  assert.ok(approved);
  assert.equal(approved.moderationStatus, "APPROVED");
  assert.equal(approved.visibility, "PUBLIC");
  assert.equal(approved.reviewSlot, null);
  const contributionCount = raw
    .prepare("SELECT COUNT(*) AS total FROM profile_contribution_events")
    .get() as { total: number };
  assert.equal(contributionCount.total, 1);
  assert.equal(
    await repo.decideReview({
      id: games[0]!.id,
      decision: "REJECTED",
      adminId: 2,
      reason: "이미 결정된 심사",
      nowIso: "2026-09-02T00:00:01.000Z",
    }),
    null,
  );
  const auditCount = raw
    .prepare("SELECT COUNT(*) AS total FROM external_game_review_audit")
    .get() as { total: number };
  assert.equal(auditCount.total, 1);

  const fourth = await repo.submitForReview({
    id: games[3]!.id,
    introducerUserId: 1,
    nowIso: NOW,
  });
  assert.equal(fourth?.reviewSlot, 1);

  assert.equal(await repo.addBookmark(3, approved.id, NOW), 1);
  const publicPage = await repo.listPublicPage({
    limit: 10,
    offset: 0,
    sort: "bookmarks",
    search: "External",
    viewerUserId: 3,
  });
  assert.equal(publicPage.total, 1);
  assert.equal(publicPage.games[0]?.isBookmarked, true);
  assert.equal(publicPage.games[0]?.bookmarkCount, 1);

  const mediaRows = [];
  for (let index = 0; index < 8; index++) {
    mediaRows.push(
      await repo.addMedia({
        externalGameId: approved.id,
        kind: "SCREENSHOT",
        objectKey: `external-games/${approved.id}/media/${String(index).padStart(64, "0")}.png`,
        contentType: "image/png",
        byteSize: 8,
        contentHash: String(index).padStart(64, "0"),
        altText: `화면 ${index + 1}`,
        sortOrder: index,
        nowIso: NOW,
      }),
    );
  }
  await assert.rejects(
    repo.addMedia({
      externalGameId: approved.id,
      kind: "SCREENSHOT",
      objectKey: `external-games/${approved.id}/media/${"9".repeat(64)}.png`,
      contentType: "image/png",
      byteSize: 8,
      contentHash: "9".repeat(64),
      altText: "아홉 번째 화면",
      sortOrder: 8,
      nowIso: NOW,
    }),
    /external game screenshot limit/,
  );
  const mediaByGame = await repo.listMediaByGameIds([approved.id, games[1]!.id]);
  assert.deepEqual(mediaByGame.get(approved.id), mediaRows);
  assert.equal(mediaByGame.has(games[1]!.id), false);
});

test("admin deletion of a pending introduction satisfies the slot invariant and frees the slot", async () => {
  const { db, raw } = createSqliteD1(schema);
  raw.exec(
    fs.readFileSync(
      new URL("../migrations/0055_external_game_introductions.sql", import.meta.url),
      "utf8",
    ),
  );
  raw.prepare("INSERT INTO users (id, nickname) VALUES (1, '소개자'), (2, '관리자')").run();
  const repo = new D1ExternalGameRepository(db);

  const game = await repo.create({
    slug: "pending-delete",
    introducerUserId: 1,
    content: content("Pending Delete"),
    nowIso: NOW,
  });
  const submitted = await repo.submitForReview({
    id: game.id,
    introducerUserId: 1,
    nowIso: NOW,
  });
  assert.equal(submitted?.reviewSlot, 1);

  const deleted = await repo.softDelete({
    id: game.id,
    adminId: 2,
    reason: "권리 확인 불가",
    nowIso: "2026-09-02T00:01:00.000Z",
  });
  assert.equal(deleted?.moderationStatus, "REJECTED");
  assert.equal(deleted?.visibility, "PRIVATE");
  assert.equal(deleted?.reviewSlot, null);
  assert.ok(deleted?.deletedAt);

  const replacement = await repo.create({
    slug: "replacement-review",
    introducerUserId: 1,
    content: content("Replacement Review"),
    nowIso: NOW,
  });
  const replacementSubmitted = await repo.submitForReview({
    id: replacement.id,
    introducerUserId: 1,
    nowIso: NOW,
  });
  assert.equal(replacementSubmitted?.reviewSlot, 1);
});
