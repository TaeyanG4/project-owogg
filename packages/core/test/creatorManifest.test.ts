import test from "node:test";
import assert from "node:assert/strict";
import {
  CreatorManifestValidationError,
  parseCreatorManifest,
} from "../src/domain/creatorManifest.js";

function minimal() {
  return {
    schemaVersion: 1,
    game: { slug: "test-game", title: "Test", genre: "arcade", mode: "single" },
    progression: { type: "none" },
    result: { score: null },
  };
}

test("Creator Manifest v1 accepts the minimum unscored game", () => {
  const manifest = parseCreatorManifest(minimal());
  assert.equal(manifest.game.slug, "test-game");
  assert.equal(manifest.result.score, null);
});

test("Creator Manifest v1 accepts and normalizes the full public contract", () => {
  const manifest = parseCreatorManifest({
    $schema: "https://owogg.com/schemas/manifest/v1.json",
    schemaVersion: 1,
    game: {
      slug: "full-game",
      title: "Full Game",
      genre: "arcade",
      mode: "single",
      shortDescription: "Short",
      description: "Long",
      tags: ["action", "score"],
    },
    input: ["keyboard", "gamepad"],
    presentation: { orientation: "landscape", aspectRatio: "16:9" },
    difficulties: [
      { id: "normal", title: "Normal", default: true },
      { id: "hard", title: "Hard" },
    ],
    progression: { type: "stage", range: { min: 1, max: 10 } },
    result: {
      outcome: { values: ["success", "failure"] },
      score: {
        unit: "points",
        direction: "desc",
        precision: 0,
        range: { min: 0, max: 1000 },
      },
      metrics: { kills: { type: "integer", range: { min: 0, max: 100 } } },
    },
    leaderboard: { enabled: true },
    events: { boss_defeated: { maxPerAttempt: 1 } },
    achievements: [
      {
        id: "boss-hunter",
        title: "Boss Hunter",
        scope: "lifetime",
        condition: {
          source: "event",
          key: "boss_defeated",
          aggregate: "count",
          operator: ">=",
          value: 3,
        },
      },
    ],
  });
  assert.equal(manifest.result.score?.range.outOfRange, "clamp");
  assert.equal(manifest.progression.range?.outOfRange, "clamp");
  assert.equal(manifest.achievements?.[0]?.scope, "lifetime");
});

test("Creator Manifest v1 rejects missing/unsupported versions, invalid slugs, and unknown fields", () => {
  assert.throws(
    () => parseCreatorManifest({ ...minimal(), schemaVersion: undefined }),
    CreatorManifestValidationError,
  );
  assert.throws(
    () => parseCreatorManifest({ ...minimal(), schemaVersion: 2 }),
    CreatorManifestValidationError,
  );
  assert.throws(
    () => parseCreatorManifest({ ...minimal(), game: { ...minimal().game, slug: "Bad Slug" } }),
    CreatorManifestValidationError,
  );
  assert.throws(
    () => parseCreatorManifest({ ...minimal(), game: { ...minimal().game, mystery: true } }),
    CreatorManifestValidationError,
  );
});

test("Creator Manifest v1 accepts every progression type and rejects unknown ones", () => {
  for (const type of [
    "none",
    "endless",
    "stage",
    "level",
    "round",
    "wave",
    "chapter",
    "lap",
    "custom",
  ]) {
    assert.equal(
      parseCreatorManifest({ ...minimal(), progression: { type } }).progression.type,
      type,
    );
  }
  assert.throws(
    () => parseCreatorManifest({ ...minimal(), progression: { type: "unknown" } }),
    CreatorManifestValidationError,
  );
});

test("Creator Manifest v1 rejects unknown authority/session fields", () => {
  for (const field of ["userId", "token", "apiUrl", "publisher"]) {
    assert.throws(
      () => parseCreatorManifest({ ...minimal(), [field]: "forbidden" }),
      CreatorManifestValidationError,
    );
  }
});

test("Creator Manifest v1 normalizes range policy and checks semantic ranges", () => {
  const parsed = parseCreatorManifest({
    ...minimal(),
    result: {
      score: { unit: "points", direction: "desc", range: { min: 0, max: 100 } },
    },
  });
  assert.equal(parsed.result.score?.range.outOfRange, "clamp");
  assert.throws(
    () =>
      parseCreatorManifest({
        ...minimal(),
        result: {
          score: { unit: "points", direction: "desc", range: { min: 10, max: 10 } },
        },
      }),
    CreatorManifestValidationError,
  );
});

test("leaderboard requires score and difficulties have at most one default", () => {
  assert.throws(
    () => parseCreatorManifest({ ...minimal(), leaderboard: { enabled: true } }),
    CreatorManifestValidationError,
  );
  assert.throws(
    () =>
      parseCreatorManifest({
        ...minimal(),
        difficulties: [
          { id: "easy", title: "Easy", default: true },
          { id: "hard", title: "Hard", default: true },
        ],
      }),
    CreatorManifestValidationError,
  );
});

test("achievement metric/event keys must reference declarations", () => {
  assert.throws(
    () =>
      parseCreatorManifest({
        ...minimal(),
        achievements: [
          {
            id: "missing-metric",
            title: "Missing",
            condition: { source: "metric", key: "kills", operator: ">=", value: 1 },
          },
        ],
      }),
    CreatorManifestValidationError,
  );
});
