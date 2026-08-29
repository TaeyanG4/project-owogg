import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { D1GameResultVerificationClaimRepository } from "../src/d1/D1GameResultVerificationClaimRepository.js";
import { D1GameVerifiedResultPersistenceRepository } from "../src/d1/D1GameVerifiedResultPersistenceRepository.js";
import { createSqliteD1 } from "./helpers/sqliteD1.js";

const claimMigration = fs.readFileSync(
  new URL("../migrations/0043_game_result_verification_claims.sql", import.meta.url),
  "utf8",
);
const scoreSemanticsMigration = fs.readFileSync(
  new URL("../migrations/0044_verified_result_score_semantics.sql", import.meta.url),
  "utf8",
);

const SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE users (id INTEGER PRIMARY KEY, nickname TEXT NOT NULL);
CREATE TABLE games (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  visibility TEXT NOT NULL,
  live_version_id INTEGER,
  deleted_at TEXT,
  leaderboard_generation INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE game_versions (
  id INTEGER PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  publish_status TEXT NOT NULL
);
CREATE TABLE game_settings (
  game_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE game_attempt_consumptions (
  attempt_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  version_id INTEGER NOT NULL REFERENCES game_versions(id) ON DELETE CASCADE,
  consumed_at TEXT NOT NULL
);
CREATE TABLE game_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  version_id INTEGER NOT NULL REFERENCES game_versions(id) ON DELETE CASCADE,
  outcome TEXT,
  raw_score REAL,
  normalized_score REAL,
  progression_value REAL,
  metrics_json TEXT NOT NULL DEFAULT '{}',
  events_json TEXT NOT NULL DEFAULT '{}',
  difficulty TEXT NOT NULL DEFAULT 'normal',
  adjusted INTEGER NOT NULL DEFAULT 0 CHECK (adjusted IN (0, 1)),
  adjustment_reason TEXT,
  reward_eligible INTEGER NOT NULL DEFAULT 1 CHECK (reward_eligible IN (0, 1)),
  created_at TEXT NOT NULL
);
CREATE TABLE scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  avatar_url TEXT,
  game_id TEXT NOT NULL,
  score REAL NOT NULL,
  difficulty TEXT NOT NULL DEFAULT 'normal',
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  result_id INTEGER REFERENCES game_results(id) ON DELETE SET NULL,
  leaderboard_generation INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX idx_scores_result_id ON scores(result_id) WHERE result_id IS NOT NULL;
${claimMigration}
${scoreSemanticsMigration}
`;

const EVIDENCE_HASH = "a".repeat(64);
const NOW = "2026-08-29T00:00:00.000Z";

function setup() {
  const context = createSqliteD1(SCHEMA);
  context.raw.prepare("INSERT INTO users (id, nickname) VALUES (1, 'player')").run();
  context.raw
    .prepare(
      `INSERT INTO games (id, slug, visibility, live_version_id, leaderboard_generation)
       VALUES (9, 'verified-game', 'PUBLIC', 5, 4)`,
    )
    .run();
  context.raw
    .prepare("INSERT INTO game_versions (id, game_id, publish_status) VALUES (5, 9, 'READY')")
    .run();
  return context;
}

function input() {
  return {
    attemptId: "verified-attempt-1",
    userId: 1,
    gameId: 9,
    versionId: 5,
    evidenceHash: EVIDENCE_HASH,
    slug: "verified-game",
    nickname: "player",
    avatarUrl: null,
    difficultyId: "hard",
    variantId: "precision",
    rulesetRevision: 3,
    verifierId: "official:test-verifier-v1",
    normalized: {
      outcome: "success",
      rawScore: 80.04,
      normalizedScore: 80,
      progressionValue: 2,
      metrics: { accuracy: 99.5 },
      events: { completed: 1 },
      adjusted: false,
      adjustmentReason: null,
      rewardEligible: true,
    },
    competitiveScore: 100,
    leaderboardEnabled: true,
    nowIso: NOW,
  } as const;
}

async function acquireClaim(db: ReturnType<typeof setup>["db"]): Promise<void> {
  const claims = new D1GameResultVerificationClaimRepository(db);
  assert.deepEqual(
    await claims.begin({
      attemptId: input().attemptId,
      userId: 1,
      gameId: 9,
      versionId: 5,
      evidenceHash: EVIDENCE_HASH,
      nowIso: NOW,
    }),
    { status: "ACQUIRED" },
  );
}

test("gs2 persistence atomically stores raw/normalized/competitive semantics and finalizes claim", async () => {
  const { db, raw } = setup();
  await acquireClaim(db);
  const repo = new D1GameVerifiedResultPersistenceRepository(db);

  const accepted = await repo.acceptVerifiedResult(input());
  assert.equal(accepted.accepted, true);
  assert.equal(typeof accepted.resultId, "number");
  assert.equal(typeof accepted.scoreId, "number");

  assert.deepEqual(
    {
      ...(raw
        .prepare(
          `SELECT raw_score, normalized_score, competitive_score, difficulty, variant_id,
                ruleset_revision, verifier_id, evidence_hash
         FROM game_results`,
        )
        .get() as Record<string, unknown>),
    },
    {
      raw_score: 80.04,
      normalized_score: 80,
      competitive_score: 100,
      difficulty: "hard",
      variant_id: "precision",
      ruleset_revision: 3,
      verifier_id: "official:test-verifier-v1",
      evidence_hash: EVIDENCE_HASH,
    },
  );
  assert.deepEqual(
    {
      ...(raw
        .prepare("SELECT score, variant_id, ruleset_revision, leaderboard_generation FROM scores")
        .get() as Record<string, unknown>),
    },
    { score: 100, variant_id: "precision", ruleset_revision: 3, leaderboard_generation: 4 },
  );
  assert.deepEqual(
    {
      ...(raw
        .prepare(
          "SELECT status, result_id, score_id, evidence_hash FROM game_result_verification_claims",
        )
        .get() as Record<string, unknown>),
    },
    {
      status: "VERIFIED",
      result_id: accepted.resultId,
      score_id: accepted.scoreId,
      evidence_hash: EVIDENCE_HASH,
    },
  );

  assert.deepEqual(
    await repo.findVerifiedResult({
      resultId: accepted.resultId!,
      userId: 1,
      gameId: 9,
      versionId: 5,
    }),
    {
      resultId: accepted.resultId,
      scoreId: accepted.scoreId,
      normalized: input().normalized,
      competitiveScore: 100,
      difficultyId: "hard",
      variantId: "precision",
      rulesetRevision: 3,
      verifierId: "official:test-verifier-v1",
    },
  );
});

test("a score projection failure rolls back consumption, result, and claim finalization", async () => {
  const { db, raw } = setup();
  await acquireClaim(db);
  raw.exec(`
    CREATE TRIGGER reject_verified_score
    BEFORE INSERT ON scores
    BEGIN
      SELECT RAISE(ABORT, 'forced score failure');
    END;
  `);
  const repo = new D1GameVerifiedResultPersistenceRepository(db);

  await assert.rejects(() => repo.acceptVerifiedResult(input()), /forced score failure/);
  assert.equal(
    (
      raw.prepare("SELECT COUNT(*) AS count FROM game_attempt_consumptions").get() as {
        count: number;
      }
    ).count,
    0,
  );
  assert.equal(
    (raw.prepare("SELECT COUNT(*) AS count FROM game_results").get() as { count: number }).count,
    0,
  );
  assert.deepEqual(
    {
      ...(raw
        .prepare("SELECT status, result_id, score_id FROM game_result_verification_claims")
        .get() as Record<string, unknown>),
    },
    { status: "PROCESSING", result_id: null, score_id: null },
  );
});

test("commit rechecks the live D1 authority and leaves a disabled attempt unconsumed", async () => {
  const { db, raw } = setup();
  await acquireClaim(db);
  raw.prepare("INSERT INTO game_settings (game_id, enabled) VALUES ('verified-game', 0)").run();
  const repo = new D1GameVerifiedResultPersistenceRepository(db);

  assert.deepEqual(await repo.acceptVerifiedResult(input()), {
    accepted: false,
    resultId: null,
    scoreId: null,
  });
  assert.equal(
    (
      raw.prepare("SELECT COUNT(*) AS count FROM game_attempt_consumptions").get() as {
        count: number;
      }
    ).count,
    0,
  );
  assert.equal(
    (raw.prepare("SELECT COUNT(*) AS count FROM game_results").get() as { count: number }).count,
    0,
  );
  assert.deepEqual(
    {
      ...(raw
        .prepare("SELECT status, result_id, score_id FROM game_result_verification_claims")
        .get() as Record<string, unknown>),
    },
    { status: "PROCESSING", result_id: null, score_id: null },
  );
});
