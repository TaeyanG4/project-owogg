import test from "node:test";
import assert from "node:assert/strict";
import {
  GAME_CANONICAL_SCHEMA_VERSION,
  GameCanonicalDocumentError,
  gameCanonicalObjectKey,
  parseGameCanonicalDocument,
  serializeGameCanonicalDocument,
  type GameCanonicalDocument,
} from "../src/modules/game/domain/gameCanonicalDocument.js";

function genreModeDoc(overrides: Partial<GameCanonicalDocument> = {}): GameCanonicalDocument {
  return {
    schemaVersion: GAME_CANONICAL_SCHEMA_VERSION,
    slug: "my-game",
    title: "My Game",
    shortDescription: "short",
    description: "long",
    publisher: { official: false },
    policy: {
      score: { unit: "pts", direction: "desc", min: 0, max: 100 },
      leaderboard: true,
      xpPerCompletion: 10,
      requiresAuth: false,
    },
    supportsReplay: false,
    catalog: { type: "GENRE_MODE", genre: "puzzle", mode: "single" },
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function taxonomyDoc(overrides: Partial<GameCanonicalDocument> = {}): GameCanonicalDocument {
  return {
    schemaVersion: GAME_CANONICAL_SCHEMA_VERSION,
    slug: "system-game",
    title: "System Game",
    shortDescription: "short",
    description: "long",
    publisher: { official: true },
    policy: {
      score: { unit: "pts", direction: "desc", min: 0, max: 100 },
      leaderboard: true,
      xpPerCompletion: 0,
      requiresAuth: false,
    },
    supportsReplay: false,
    catalog: {
      type: "TAXONOMY",
      categories: ["aim", "reaction"],
      tags: ["에임"],
      modes: ["single"],
      inputMethods: ["mouse", "touch"],
      minPlayers: 1,
      maxPlayers: 1,
      thumbnail: "/thumb.svg",
    },
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function roundTrip(doc: GameCanonicalDocument): GameCanonicalDocument {
  return parseGameCanonicalDocument(serializeGameCanonicalDocument(doc), doc.slug);
}

// ── catalog shapes ────────────────────────────────────────────────────────────

test("GENRE_MODE catalog round-trips through serialize/parse", () => {
  const doc = genreModeDoc();
  assert.deepEqual(roundTrip(doc), doc);
});

test("TAXONOMY catalog round-trips through serialize/parse", () => {
  const doc = taxonomyDoc();
  assert.deepEqual(roundTrip(doc), doc);
});

test("TAXONOMY catalog optional accent/estimatedRoundSeconds round-trip when present", () => {
  const doc = taxonomyDoc({
    catalog: {
      type: "TAXONOMY",
      categories: ["arcade"],
      tags: [],
      modes: ["single"],
      inputMethods: ["mouse"],
      minPlayers: 1,
      maxPlayers: 1,
      thumbnail: "/t.svg",
      accent: "#6366f1",
      estimatedRoundSeconds: 60,
    },
  });
  const parsed = roundTrip(doc);
  assert.equal(parsed.catalog.type, "TAXONOMY");
  if (parsed.catalog.type === "TAXONOMY") {
    assert.equal(parsed.catalog.accent, "#6366f1");
    assert.equal(parsed.catalog.estimatedRoundSeconds, 60);
  }
});

// ── score ─────────────────────────────────────────────────────────────────────

test("score:null round-trips as an explicit, unscored policy", () => {
  const doc = genreModeDoc({
    policy: { score: null, leaderboard: false, xpPerCompletion: 0, requiresAuth: false },
  });
  const parsed = roundTrip(doc);
  assert.equal(parsed.policy.score, null);
});

test("decimal score bounds are preserved without truncation", () => {
  const doc = genreModeDoc({
    policy: {
      score: { unit: "s", direction: "asc", min: 0.5, max: 99.9 },
      leaderboard: true,
      xpPerCompletion: 10,
      requiresAuth: false,
    },
  });
  const parsed = roundTrip(doc);
  assert.equal(parsed.policy.score?.min, 0.5);
  assert.equal(parsed.policy.score?.max, 99.9);
});

// ── policy invariants ────────────────────────────────────────────────────────

test("a scored policy with decimal min < max parses normally", () => {
  const doc = genreModeDoc({
    policy: {
      score: { unit: "s", direction: "asc", min: 0.25, max: 10.75 },
      leaderboard: true,
      xpPerCompletion: 1,
      requiresAuth: false,
    },
  });
  const parsed = roundTrip(doc);
  assert.equal(parsed.policy.score?.min, 0.25);
  assert.equal(parsed.policy.score?.max, 10.75);
});

test("score.min === score.max is rejected — no rankable range", () => {
  const raw = JSON.parse(serializeGameCanonicalDocument(genreModeDoc()));
  raw.policy.score.min = 100;
  raw.policy.score.max = 100;
  assert.throws(
    () => parseGameCanonicalDocument(JSON.stringify(raw), "my-game"),
    (err: unknown) => err instanceof GameCanonicalDocumentError && err.code === "INVALID_DOCUMENT",
  );
});

test("score.min > score.max is rejected", () => {
  const raw = JSON.parse(serializeGameCanonicalDocument(genreModeDoc()));
  raw.policy.score.min = 100;
  raw.policy.score.max = 0;
  assert.throws(
    () => parseGameCanonicalDocument(JSON.stringify(raw), "my-game"),
    (err: unknown) => err instanceof GameCanonicalDocumentError && err.code === "INVALID_DOCUMENT",
  );
});

test("score:null combined with leaderboard:true is rejected — nothing to rank", () => {
  const doc = genreModeDoc({
    policy: { score: null, leaderboard: true, xpPerCompletion: 0, requiresAuth: false },
  });
  assert.throws(
    () => parseGameCanonicalDocument(serializeGameCanonicalDocument(doc), doc.slug),
    (err: unknown) => err instanceof GameCanonicalDocumentError && err.code === "INVALID_DOCUMENT",
  );
});

test("score:null combined with leaderboard:false parses normally — still explicitly unscored", () => {
  const doc = genreModeDoc({
    policy: { score: null, leaderboard: false, xpPerCompletion: 0, requiresAuth: false },
  });
  const parsed = roundTrip(doc);
  assert.equal(parsed.policy.score, null);
  assert.equal(parsed.policy.leaderboard, false);
});

test("a negative xpPerCompletion is rejected", () => {
  const raw = JSON.parse(serializeGameCanonicalDocument(genreModeDoc()));
  raw.policy.xpPerCompletion = -1;
  assert.throws(
    () => parseGameCanonicalDocument(JSON.stringify(raw), "my-game"),
    (err: unknown) => err instanceof GameCanonicalDocumentError && err.code === "INVALID_DOCUMENT",
  );
});

test("a decimal xpPerCompletion is rejected — must be an integer", () => {
  const raw = JSON.parse(serializeGameCanonicalDocument(genreModeDoc()));
  raw.policy.xpPerCompletion = 10.5;
  assert.throws(
    () => parseGameCanonicalDocument(JSON.stringify(raw), "my-game"),
    (err: unknown) => err instanceof GameCanonicalDocumentError && err.code === "INVALID_DOCUMENT",
  );
});

test("an xpPerCompletion over 100000 is rejected", () => {
  const raw = JSON.parse(serializeGameCanonicalDocument(genreModeDoc()));
  raw.policy.xpPerCompletion = 100_001;
  assert.throws(
    () => parseGameCanonicalDocument(JSON.stringify(raw), "my-game"),
    (err: unknown) => err instanceof GameCanonicalDocumentError && err.code === "INVALID_DOCUMENT",
  );
});

test("xpPerCompletion of exactly 0 and exactly 100000 both parse normally (inclusive bounds)", () => {
  const zero = genreModeDoc({
    policy: {
      score: { unit: "pts", direction: "desc", min: 0, max: 100 },
      leaderboard: false,
      xpPerCompletion: 0,
      requiresAuth: false,
    },
  });
  const max = genreModeDoc({
    policy: {
      score: { unit: "pts", direction: "desc", min: 0, max: 100 },
      leaderboard: true,
      xpPerCompletion: 100_000,
      requiresAuth: false,
    },
  });
  assert.equal(roundTrip(zero).policy.xpPerCompletion, 0);
  assert.equal(roundTrip(max).policy.xpPerCompletion, 100_000);
});

// ── presentation / difficulty / supportsReplay ────────────────────────────────

test("presentation is preserved through round-trip", () => {
  const presentation = {
    viewport: { mode: "fixed" as const, preferredWidth: 640, preferredHeight: 360 },
    fullscreen: { supported: true, recommended: false },
    mobile: { support: "unsupported" as const },
  };
  const doc = genreModeDoc({ presentation });
  const parsed = roundTrip(doc);
  assert.deepEqual(parsed.presentation, presentation);
});

test("difficulty is preserved through round-trip", () => {
  const difficulty = {
    levels: [
      { id: "normal", label: "Normal" },
      { id: "hard", label: "Hard" },
    ],
    defaultLevelId: "normal",
  };
  const doc = taxonomyDoc({ difficulty });
  const parsed = roundTrip(doc);
  assert.deepEqual(parsed.difficulty, difficulty);
});

test("supportsReplay is preserved through round-trip", () => {
  const doc = genreModeDoc({ supportsReplay: false });
  assert.equal(roundTrip(doc).supportsReplay, false);
});

test("publisher.official round-trips as public presentation metadata", () => {
  assert.equal(roundTrip(genreModeDoc()).publisher.official, false);
  assert.equal(roundTrip(taxonomyDoc()).publisher.official, true);
});

test("legacy schema v1 normalizes fail-safe to non-official", () => {
  const raw = JSON.parse(serializeGameCanonicalDocument(genreModeDoc()));
  raw.schemaVersion = 1;
  delete raw.publisher;
  const parsed = parseGameCanonicalDocument(JSON.stringify(raw), "my-game");
  assert.equal(parsed.schemaVersion, GAME_CANONICAL_SCHEMA_VERSION);
  assert.deepEqual(parsed.publisher, { official: false });
});

test("current schema requires a strict publisher metadata object", () => {
  const missing = JSON.parse(serializeGameCanonicalDocument(genreModeDoc()));
  delete missing.publisher;
  assert.throws(
    () => parseGameCanonicalDocument(JSON.stringify(missing), "my-game"),
    (err: unknown) => err instanceof GameCanonicalDocumentError && err.code === "INVALID_DOCUMENT",
  );

  const unknown = JSON.parse(serializeGameCanonicalDocument(genreModeDoc()));
  unknown.publisher.displayName = "OwOGG";
  assert.throws(
    () => parseGameCanonicalDocument(JSON.stringify(unknown), "my-game"),
    (err: unknown) => err instanceof GameCanonicalDocumentError && err.code === "INVALID_DOCUMENT",
  );
});

test("legacy canonical schemas cannot claim a Creator Manifest v1 contract", () => {
  const raw = JSON.parse(serializeGameCanonicalDocument(genreModeDoc()));
  raw.schemaVersion = 2;
  raw.creatorManifest = {
    schemaVersion: 1,
    game: { slug: "my-game", title: "My Game", genre: "puzzle", mode: "single" },
    progression: { type: "none" },
    result: { score: null },
  };
  assert.throws(
    () => parseGameCanonicalDocument(JSON.stringify(raw), "my-game"),
    (err: unknown) => err instanceof GameCanonicalDocumentError && err.code === "INVALID_DOCUMENT",
  );
});

// ── fail-closed ───────────────────────────────────────────────────────────────

test("malformed JSON is rejected", () => {
  assert.throws(
    () => parseGameCanonicalDocument("{ not json", "my-game"),
    (err: unknown) => err instanceof GameCanonicalDocumentError && err.code === "MALFORMED_JSON",
  );
});

test("an unknown top-level field is rejected", () => {
  const raw = JSON.parse(serializeGameCanonicalDocument(genreModeDoc()));
  raw.extraField = "surprise";
  assert.throws(
    () => parseGameCanonicalDocument(JSON.stringify(raw), "my-game"),
    (err: unknown) => err instanceof GameCanonicalDocumentError && err.code === "INVALID_DOCUMENT",
  );
});

test("an unsupported schemaVersion is rejected", () => {
  const raw = JSON.parse(serializeGameCanonicalDocument(genreModeDoc()));
  raw.schemaVersion = 999;
  assert.throws(
    () => parseGameCanonicalDocument(JSON.stringify(raw), "my-game"),
    (err: unknown) =>
      err instanceof GameCanonicalDocumentError && err.code === "UNSUPPORTED_SCHEMA_VERSION",
  );
});

test("a slug mismatch is rejected", () => {
  const doc = genreModeDoc({ slug: "actual-slug" });
  assert.throws(
    () => parseGameCanonicalDocument(serializeGameCanonicalDocument(doc), "expected-slug"),
    (err: unknown) => err instanceof GameCanonicalDocumentError && err.code === "SLUG_MISMATCH",
  );
});

test("an invalid catalog discriminant is rejected", () => {
  const raw = JSON.parse(serializeGameCanonicalDocument(genreModeDoc()));
  raw.catalog = { type: "NOT_A_REAL_TYPE" };
  assert.throws(
    () => parseGameCanonicalDocument(JSON.stringify(raw), "my-game"),
    (err: unknown) => err instanceof GameCanonicalDocumentError && err.code === "INVALID_DOCUMENT",
  );
});

test("an unknown field inside catalog is rejected", () => {
  const raw = JSON.parse(serializeGameCanonicalDocument(genreModeDoc()));
  raw.catalog.extra = "nope";
  assert.throws(
    () => parseGameCanonicalDocument(JSON.stringify(raw), "my-game"),
    (err: unknown) => err instanceof GameCanonicalDocumentError && err.code === "INVALID_DOCUMENT",
  );
});

test("an unknown field inside policy.score is rejected", () => {
  const raw = JSON.parse(serializeGameCanonicalDocument(genreModeDoc()));
  raw.policy.score.extra = "nope";
  assert.throws(
    () => parseGameCanonicalDocument(JSON.stringify(raw), "my-game"),
    (err: unknown) => err instanceof GameCanonicalDocumentError && err.code === "INVALID_DOCUMENT",
  );
});

test("a numeric field that overflows to Infinity (a syntactically valid JSON number, e.g. 1e400) is rejected", () => {
  const doc = genreModeDoc();
  const json = serializeGameCanonicalDocument(doc).replace('"min":0', '"min":1e400');
  assert.throws(
    () => parseGameCanonicalDocument(json, doc.slug),
    (err: unknown) => err instanceof GameCanonicalDocumentError && err.code === "INVALID_DOCUMENT",
  );
});

test("an invalid score direction is rejected", () => {
  const raw = JSON.parse(serializeGameCanonicalDocument(genreModeDoc()));
  raw.policy.score.direction = "sideways";
  assert.throws(
    () => parseGameCanonicalDocument(JSON.stringify(raw), "my-game"),
    (err: unknown) => err instanceof GameCanonicalDocumentError && err.code === "INVALID_DOCUMENT",
  );
});

test("an invalid presentation is rejected (fullscreen.recommended contradicting supported)", () => {
  const raw = JSON.parse(
    serializeGameCanonicalDocument(
      genreModeDoc({
        presentation: {
          viewport: { mode: "responsive" },
          fullscreen: { supported: true, recommended: true },
          mobile: { support: "unsupported" },
        },
      }),
    ),
  );
  raw.presentation.fullscreen.supported = false;
  assert.throws(
    () => parseGameCanonicalDocument(JSON.stringify(raw), "my-game"),
    (err: unknown) => err instanceof GameCanonicalDocumentError && err.code === "INVALID_DOCUMENT",
  );
});

test("a required field missing at the top level is rejected", () => {
  const raw = JSON.parse(serializeGameCanonicalDocument(genreModeDoc()));
  delete raw.title;
  assert.throws(
    () => parseGameCanonicalDocument(JSON.stringify(raw), "my-game"),
    (err: unknown) => err instanceof GameCanonicalDocumentError && err.code === "INVALID_DOCUMENT",
  );
});

test("a required field missing inside catalog is rejected", () => {
  const raw = JSON.parse(serializeGameCanonicalDocument(taxonomyDoc()));
  delete raw.catalog.thumbnail;
  assert.throws(
    () => parseGameCanonicalDocument(JSON.stringify(raw), "system-game"),
    (err: unknown) => err instanceof GameCanonicalDocumentError && err.code === "INVALID_DOCUMENT",
  );
});

test("a duplicate difficulty level id is rejected", () => {
  const raw = JSON.parse(
    serializeGameCanonicalDocument(
      taxonomyDoc({
        difficulty: {
          levels: [
            { id: "normal", label: "Normal" },
            { id: "normal", label: "Normal Again" },
          ],
          defaultLevelId: "normal",
        },
      }),
    ),
  );
  assert.throws(
    () => parseGameCanonicalDocument(JSON.stringify(raw), "system-game"),
    (err: unknown) => err instanceof GameCanonicalDocumentError && err.code === "INVALID_DOCUMENT",
  );
});

// ── object key ────────────────────────────────────────────────────────────────

test("gameCanonicalObjectKey is deterministic by slug and uses a new, distinct prefix", () => {
  assert.equal(gameCanonicalObjectKey("my-game"), "game-definitions/my-game/definition.json");
  assert.ok(!gameCanonicalObjectKey("my-game").startsWith("creator-games/"));
  assert.ok(!gameCanonicalObjectKey("my-game").startsWith("games/"));
  assert.ok(!gameCanonicalObjectKey("my-game").startsWith("uploads/"));
  assert.ok(!gameCanonicalObjectKey("my-game").startsWith("official-games/"));
});

test("gameCanonicalObjectKey never collides between two different slugs", () => {
  assert.notEqual(gameCanonicalObjectKey("game-a"), gameCanonicalObjectKey("game-b"));
});
