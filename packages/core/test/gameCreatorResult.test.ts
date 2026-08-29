import test from "node:test";
import assert from "node:assert/strict";
import { parseGameCreatorManifest } from "../src/domain/gameCreatorManifest.js";
import {
  normalizeGameCreatorResult,
  normalizeVerifiedGameCreatorResult,
} from "../src/domain/gameCreatorResult.js";

const manifest = parseGameCreatorManifest({
  schemaVersion: 1,
  game: {
    slug: "result-game",
    title: "Result",
    genre: "test",
    mode: "single",
    playModes: ["single"],
  },
  progression: {
    type: "stage",
    range: { min: 1, max: 10, outOfRange: "reject" },
  },
  result: {
    outcome: { values: ["success", "failure"] },
    score: {
      unit: "points",
      direction: "desc",
      precision: 0,
      range: { min: 0, max: 100, outOfRange: "clamp" },
    },
    metrics: {
      kills: {
        type: "integer",
        range: { min: 0, max: 5, outOfRange: "clamp" },
      },
    },
  },
  leaderboard: { enabled: true },
  events: { boss: { maxPerAttempt: 1 } },
});

test("normal result preserves declared facts and remains reward eligible", () => {
  const normalized = normalizeGameCreatorResult(manifest, {
    outcome: "success",
    score: 80.4,
    progression: { value: 3 },
    metrics: { kills: 4 },
    events: { boss: 1 },
  });
  assert.equal(normalized.valid, true);
  if (normalized.valid) {
    assert.equal(normalized.result.normalizedScore, 80);
    assert.equal(normalized.result.adjusted, false);
    assert.equal(normalized.result.rewardEligible, true);
  }
});

test("clamped result is stored as adjusted and excluded from rewards", () => {
  const normalized = normalizeGameCreatorResult(manifest, {
    score: 999,
    metrics: { kills: 99 },
    events: { boss: 3 },
  });
  assert.equal(normalized.valid, true);
  if (normalized.valid) {
    assert.equal(normalized.result.normalizedScore, 100);
    assert.equal(normalized.result.metrics.kills, 5);
    assert.equal(normalized.result.events.boss, 1);
    assert.equal(normalized.result.adjusted, true);
    assert.equal(normalized.result.rewardEligible, false);
  }
});

test("reject range and undeclared facts reject the entire result", () => {
  assert.deepEqual(
    normalizeGameCreatorResult(manifest, { progression: { value: 99 } }).valid,
    false,
  );
  assert.deepEqual(normalizeGameCreatorResult(manifest, { metrics: { coins: 1 } }).valid, false);
  assert.deepEqual(normalizeGameCreatorResult(manifest, { outcome: "win" }).valid, false);
});

test("verified score keeps raw facts and applies a rounded desc competitive factor", () => {
  const normalized = normalizeVerifiedGameCreatorResult(
    manifest,
    { score: 80.4, metrics: { kills: 4 }, events: { boss: 1 } },
    1.25,
  );
  assert.equal(normalized.valid, true);
  if (!normalized.valid) return;
  assert.equal(normalized.result.rawScore, 80.4);
  assert.equal(normalized.result.normalizedScore, 80);
  assert.equal(normalized.competitiveScore, 100);
  assert.equal(normalized.result.adjusted, false);
});

test("verified asc scores divide by reward factor and reject facts that would be clamped", () => {
  const ascManifest = {
    ...manifest,
    result: {
      ...manifest.result,
      score: manifest.result.score ? { ...manifest.result.score, direction: "asc" as const } : null,
    },
  };
  const accepted = normalizeVerifiedGameCreatorResult(ascManifest, { score: 80.4 }, 2);
  assert.equal(accepted.valid, true);
  if (accepted.valid) assert.equal(accepted.competitiveScore, 40);

  assert.equal(normalizeVerifiedGameCreatorResult(manifest, { score: 999 }, 1).valid, false);
  assert.equal(
    normalizeVerifiedGameCreatorResult(manifest, { score: 80, events: { boss: 2 } }, 1).valid,
    false,
  );
  assert.equal(normalizeVerifiedGameCreatorResult(manifest, { score: 80 }, 0).valid, false);
});

test("verified factors preserve neutral scores, penalize easier variants, and remove negative zero", () => {
  const neutral = normalizeVerifiedGameCreatorResult(manifest, { score: 80.4 }, 1);
  const penalized = normalizeVerifiedGameCreatorResult(manifest, { score: 80.4 }, 0.5);
  const zero = normalizeVerifiedGameCreatorResult(manifest, { score: -0 }, 0.5);

  assert.equal(neutral.valid, true);
  if (neutral.valid) assert.equal(neutral.competitiveScore, 80);
  assert.equal(penalized.valid, true);
  if (penalized.valid) assert.equal(penalized.competitiveScore, 40);
  assert.equal(zero.valid, true);
  if (zero.valid) {
    assert.equal(Object.is(zero.result.rawScore, -0), false);
    assert.equal(Object.is(zero.result.normalizedScore, -0), false);
    assert.equal(Object.is(zero.competitiveScore, -0), false);
  }
});
