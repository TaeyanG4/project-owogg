import test from "node:test";
import assert from "node:assert/strict";
import { formatMetadataKey, formatMetadataValue } from "../features/game/GameHost";
import { DICTIONARIES } from "../features/i18n/dictionary";

/**
 * GameHost's result-overlay metadata grid, extracted to pure functions that this suite can
 * exercise directly — the web test suite has no DOM renderer (plain `tsx --test`, no jsdom/
 * testing-library), so this is the part of that split that's actually testable in isolation.
 * The stateful lifecycle around it (loading, score submission, retry, leaderboard, share) is
 * unchanged by the GamePage/GameHost split and isn't covered by an automated test here for the
 * same tooling reason — see the PR description for what would be needed to close that gap.
 */

const gamePlayDict = DICTIONARIES["ko-KR"].gamePlay;

test("formatMetadataKey maps every known result-metadata key to its localized label", () => {
  const cases: Array<[string, string]> = [
    ["wpm", gamePlayDict.metadataWpm],
    ["cpm", gamePlayDict.metadataCpm],
    ["accuracy", gamePlayDict.metadataAccuracy],
    ["correctChars", gamePlayDict.metadataCorrectChars],
    ["incorrectChars", gamePlayDict.metadataIncorrectChars],
    ["totalTypedChars", gamePlayDict.metadataTotalTypedChars],
    ["durationMs", gamePlayDict.metadataDurationMs],
    ["targetsHit", gamePlayDict.metadataTargetsHit],
    ["misses", gamePlayDict.metadataMisses],
    ["level", gamePlayDict.metadataLevel],
    ["targets", gamePlayDict.metadataTargets],
    ["avgPerTargetMs", gamePlayDict.metadataAvgPerTargetMs],
    ["sequenceLength", gamePlayDict.metadataSequenceLength],
    ["grade", gamePlayDict.metadataGrade],
  ];
  for (const [key, expected] of cases) {
    assert.equal(formatMetadataKey(key, gamePlayDict), expected, key);
  }
});

test("formatMetadataKey falls back to the raw key for anything a game didn't declare", () => {
  assert.equal(
    formatMetadataKey("someFutureGameSpecificKey", gamePlayDict),
    "someFutureGameSpecificKey",
  );
});

test("formatMetadataValue appends a percent sign only for accuracy, and only when numeric", () => {
  assert.equal(formatMetadataValue("accuracy", 97), "97%");
  // A non-numeric "accuracy" (shouldn't happen from real game code, but the guard exists) must
  // not silently render "undefined%" or similar.
  assert.equal(formatMetadataValue("accuracy", "n/a"), "n/a");
});

test("formatMetadataValue stringifies every other key as-is, without unit suffixes", () => {
  assert.equal(formatMetadataValue("wpm", 85), "85");
  assert.equal(formatMetadataValue("correctChars", 240), "240");
  assert.equal(formatMetadataValue("level", 12), "12");
});

test("generic metadata formatting never depends on a game slug", () => {
  for (const key of ["wpm", "targets", "sequenceLength", "someFutureGameSpecificKey"]) {
    assert.equal(typeof formatMetadataKey(key, gamePlayDict), "string");
  }
});
