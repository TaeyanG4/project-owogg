import test from "node:test";
import assert from "node:assert/strict";
import { parseGameCreatorManifest } from "../src/domain/gameCreatorManifest.js";
import { normalizeGameCreatorResult } from "../src/domain/gameCreatorResult.js";

const manifest = parseGameCreatorManifest({
  schemaVersion: 1,
  game: { slug: "result-game", title: "Result", genre: "test", mode: "single" },
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
