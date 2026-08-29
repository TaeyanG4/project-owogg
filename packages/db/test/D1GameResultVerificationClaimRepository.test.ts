import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { D1GameResultVerificationClaimRepository } from "../src/d1/D1GameResultVerificationClaimRepository.js";
import { createSqliteD1 } from "./helpers/sqliteD1.js";

const migration = fs.readFileSync(
  new URL("../migrations/0043_game_result_verification_claims.sql", import.meta.url),
  "utf8",
);

const SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE users (id INTEGER PRIMARY KEY, nickname TEXT NOT NULL);
CREATE TABLE games (id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE);
CREATE TABLE game_versions (
  id INTEGER PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE
);
CREATE TABLE game_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  version_id INTEGER NOT NULL REFERENCES game_versions(id) ON DELETE CASCADE
);
CREATE TABLE scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  result_id INTEGER REFERENCES game_results(id) ON DELETE CASCADE
);
${migration}
`;

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const NOW = "2026-08-29T00:00:00.000Z";

function claim(overrides: Record<string, unknown> = {}) {
  return {
    attemptId: "attempt_verified_0001",
    userId: 1,
    gameId: 9,
    versionId: 5,
    evidenceHash: HASH_A,
    nowIso: NOW,
    ...overrides,
  };
}

function setup() {
  const context = createSqliteD1(SCHEMA);
  context.raw.prepare("INSERT INTO users (id, nickname) VALUES (1, 'player')").run();
  context.raw.prepare("INSERT INTO games (id, slug) VALUES (9, 'verified-game')").run();
  context.raw.prepare("INSERT INTO game_versions (id, game_id) VALUES (5, 9)").run();
  return context;
}

test("first evidence acquires PROCESSING and the same evidence reports in progress", async () => {
  const { db, raw } = setup();
  const repo = new D1GameResultVerificationClaimRepository(db);

  assert.deepEqual(await repo.begin(claim()), { status: "ACQUIRED" });
  assert.deepEqual(await repo.begin(claim()), { status: "PROCESSING" });
  const row = raw
    .prepare("SELECT evidence_hash, status FROM game_result_verification_claims")
    .get() as { evidence_hash: string; status: string };
  assert.equal(row.evidence_hash, HASH_A);
  assert.equal(row.status, "PROCESSING");
  assert.equal(
    raw
      .prepare("SELECT COUNT(*) AS count FROM pragma_table_info('game_result_verification_claims')")
      .get() !== null,
    true,
  );
  assert.equal(
    (
      raw
        .prepare(
          "SELECT COUNT(*) AS count FROM pragma_table_info('game_result_verification_claims') WHERE name LIKE '%evidence%'",
        )
        .get() as { count: number }
    ).count,
    1,
    "only evidence_hash exists; raw evidence has no storage column",
  );
});

test("different evidence and altered signed context cannot replace the first claim", async () => {
  const { db, raw } = setup();
  const repo = new D1GameResultVerificationClaimRepository(db);
  await repo.begin(claim());

  assert.deepEqual(await repo.begin(claim({ evidenceHash: HASH_B })), {
    status: "CONFLICT",
    reason: "EVIDENCE_MISMATCH",
  });
  assert.deepEqual(await repo.begin(claim({ userId: 2 })), {
    status: "CONFLICT",
    reason: "ATTEMPT_CONTEXT_MISMATCH",
  });
  assert.equal(
    (
      raw.prepare("SELECT COUNT(*) AS count FROM game_result_verification_claims").get() as {
        count: number;
      }
    ).count,
    1,
  );
});

test("rejection is terminal and replays return the stored code", async () => {
  const { db, raw } = setup();
  const repo = new D1GameResultVerificationClaimRepository(db);
  await repo.begin(claim());

  assert.equal(
    await repo.finalizeRejected({
      ...claim(),
      rejectionCode: "IMPOSSIBLE_REPLAY",
      nowIso: "2026-08-29T00:00:01.000Z",
    }),
    true,
  );
  assert.deepEqual(await repo.begin(claim()), {
    status: "REJECTED",
    rejectionCode: "IMPOSSIBLE_REPLAY",
  });
  assert.equal(
    await repo.finalizeRejected({
      ...claim(),
      rejectionCode: "REPLACEMENT",
      nowIso: "2026-08-29T00:00:02.000Z",
    }),
    false,
  );
  assert.throws(() =>
    raw
      .prepare(
        "UPDATE game_result_verification_claims SET status = 'PROCESSING' WHERE attempt_id = ?",
      )
      .run("attempt_verified_0001"),
  );
});

test("verified finalization requires matching result/score and replays their IDs", async () => {
  const { db, raw } = setup();
  const repo = new D1GameResultVerificationClaimRepository(db);
  await repo.begin(claim());
  const resultId = Number(
    raw
      .prepare(
        "INSERT INTO game_results (attempt_id, user_id, game_id, version_id) VALUES (?, 1, 9, 5) RETURNING id",
      )
      .get("attempt_verified_0001")?.id,
  );
  const scoreId = Number(
    raw.prepare("INSERT INTO scores (user_id, result_id) VALUES (1, ?) RETURNING id").get(resultId)
      ?.id,
  );

  raw
    .prepare(
      `UPDATE game_result_verification_claims
       SET status = 'VERIFIED', result_id = ?, score_id = ?, updated_at = ?
       WHERE attempt_id = ?`,
    )
    .run(resultId, scoreId, "2026-08-29T00:00:01.000Z", claim().attemptId);
  assert.deepEqual(await repo.begin(claim()), { status: "VERIFIED", resultId, scoreId });
  assert.throws(() =>
    raw
      .prepare(
        `UPDATE game_result_verification_claims
         SET status = 'VERIFIED', updated_at = ?
         WHERE attempt_id = ?`,
      )
      .run("2026-08-29T00:00:02.000Z", claim().attemptId),
  );
});

test("migration rejects cross-game versions and mismatched terminal result context", async () => {
  const { db, raw } = setup();
  const repo = new D1GameResultVerificationClaimRepository(db);
  raw.prepare("INSERT INTO games (id, slug) VALUES (10, 'other-game')").run();
  raw.prepare("INSERT INTO game_versions (id, game_id) VALUES (6, 10)").run();

  await assert.rejects(() => repo.begin(claim({ versionId: 6 })));
  await repo.begin(claim());
  const wrongResultId = Number(
    raw
      .prepare(
        "INSERT INTO game_results (attempt_id, user_id, game_id, version_id) VALUES ('other-attempt', 1, 9, 5) RETURNING id",
      )
      .get()?.id,
  );
  assert.throws(() =>
    raw
      .prepare(
        `UPDATE game_result_verification_claims
         SET status = 'VERIFIED', result_id = ?, updated_at = ?
         WHERE attempt_id = ?`,
      )
      .run(wrongResultId, "2026-08-29T00:00:01.000Z", claim().attemptId),
  );
  assert.deepEqual(await repo.begin(claim()), { status: "PROCESSING" });
});
