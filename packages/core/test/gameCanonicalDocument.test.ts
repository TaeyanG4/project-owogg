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

function verifiedDoc(): GameCanonicalDocument {
  return genreModeDoc({
    difficulty: {
      levels: [
        { id: "normal", label: "Normal" },
        { id: "hard", label: "Hard" },
      ],
      defaultLevelId: "normal",
    },
    playConfig: {
      version: 1,
      rulesetRevision: 7,
      verifierId: "my-game/score-v1",
      defaultVariantId: "standard",
      variants: [
        { id: "standard", label: "Standard" },
        { id: "precision", label: "Precision" },
      ],
      allowedConfigs: [
        { difficultyId: "normal", variantId: "standard", rewardFactor: 1 },
        { difficultyId: "normal", variantId: "precision", rewardFactor: 1.1 },
        { difficultyId: "hard", variantId: "standard", rewardFactor: 1.2 },
        { difficultyId: "hard", variantId: "precision", rewardFactor: 1.3 },
      ],
    },
    creatorManifest: {
      $schema: "https://owogg.com/schemas/manifest/v1.json",
      schemaVersion: 1,
      game: {
        slug: "my-game",
        title: "My Game",
        genre: "puzzle",
        mode: "single",
        playModes: ["single"],
      },
      difficulties: [
        { id: "normal", title: "Normal", default: true },
        { id: "hard", title: "Hard" },
      ],
      playConfig: {
        version: 1,
        rulesetRevision: 7,
        verifierId: "my-game/score-v1",
        variants: [
          { id: "standard", title: "Standard", default: true },
          { id: "precision", title: "Precision" },
        ],
        allowedConfigs: [
          { difficultyId: "normal", variantId: "standard", rewardFactor: 1 },
          { difficultyId: "normal", variantId: "precision", rewardFactor: 1.1 },
          { difficultyId: "hard", variantId: "standard", rewardFactor: 1.2 },
          { difficultyId: "hard", variantId: "precision", rewardFactor: 1.3 },
        ],
      },
      progression: { type: "none" },
      result: {
        score: {
          unit: "pts",
          direction: "desc",
          range: { min: 0, max: 100, outOfRange: "reject" },
        },
      },
      leaderboard: { enabled: true },
    },
  });
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

test("the only canonical v1 shape requires a strict publisher metadata object", () => {
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

test("canonical accepts only the current v1 schema number", () => {
  for (const unsupportedVersion of [0, 99]) {
    const raw = JSON.parse(serializeGameCanonicalDocument(genreModeDoc()));
    raw.schemaVersion = unsupportedVersion;
    assert.throws(
      () => parseGameCanonicalDocument(JSON.stringify(raw), "my-game"),
      (err: unknown) =>
        err instanceof GameCanonicalDocumentError && err.code === "UNSUPPORTED_SCHEMA_VERSION",
    );
  }
});

test("canonical v1 round-trips normalized PlayConfig with its creator declaration", () => {
  const parsed = roundTrip(verifiedDoc());
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.creatorManifest?.playConfig?.variants[0]?.default, true);
  assert.deepEqual(parsed.playConfig, verifiedDoc().playConfig);
});

test("canonical v1 round-trips a hybrid local and Relay-online creator declaration", () => {
  const raw = JSON.parse(serializeGameCanonicalDocument(verifiedDoc()));
  raw.catalog = { type: "GENRE_MODE", genre: "board", mode: "multi" };
  raw.creatorManifest.game = {
    ...raw.creatorManifest.game,
    genre: "board",
    mode: "multi",
    playModes: ["local-multi", "online-multi"],
  };
  raw.creatorManifest.multiplayer = {
    version: 1,
    transport: { kind: "websocket", protocolVersion: 1 },
    runtime: { kind: "relay" },
    players: { min: 2, max: 8 },
    features: {
      reconnect: "resume",
      directMessages: true,
      hostSnapshot: true,
      joinInProgress: false,
      spectators: false,
    },
  };

  const parsed = parseGameCanonicalDocument(JSON.stringify(raw), "my-game");
  assert.deepEqual(parsed.creatorManifest?.game.playModes, ["local-multi", "online-multi"]);
  assert.equal(parsed.creatorManifest?.playConfig?.verifierId, "my-game/score-v1");
  assert.equal(parsed.creatorManifest?.multiplayer?.runtime.kind, "relay");
  assert.deepEqual(roundTrip(parsed), parsed);
});

test("canonical PlayConfig must exactly match its creator manifest declaration", () => {
  const raw = JSON.parse(serializeGameCanonicalDocument(verifiedDoc()));
  raw.creatorManifest.playConfig.verifierId = "my-game/other-verifier";
  assert.throws(
    () => parseGameCanonicalDocument(JSON.stringify(raw), "my-game"),
    (err: unknown) => err instanceof GameCanonicalDocumentError && err.code === "INVALID_DOCUMENT",
  );
});

test("canonical PlayConfig cannot exist without the reviewed creator manifest", () => {
  const raw = JSON.parse(serializeGameCanonicalDocument(verifiedDoc()));
  delete raw.creatorManifest;
  assert.throws(
    () => parseGameCanonicalDocument(JSON.stringify(raw), "my-game"),
    (err: unknown) => err instanceof GameCanonicalDocumentError && err.code === "INVALID_DOCUMENT",
  );
});

test("canonical PlayConfig rejects invalid runtime authority", () => {
  const mutations: Array<(raw: ReturnType<typeof JSON.parse>) => void> = [
    (raw) => {
      raw.playConfig.extra = true;
    },
    (raw) => {
      raw.playConfig.rulesetRevision = 0;
    },
    (raw) => {
      raw.playConfig.defaultVariantId = "missing";
    },
    (raw) => {
      raw.playConfig.allowedConfigs[0].rewardFactor = 0;
    },
    (raw) => {
      raw.playConfig.allowedConfigs[1] = { ...raw.playConfig.allowedConfigs[0] };
    },
    (raw) => {
      raw.policy.leaderboard = false;
    },
  ];

  for (const mutate of mutations) {
    const raw = JSON.parse(serializeGameCanonicalDocument(verifiedDoc()));
    mutate(raw);
    assert.throws(
      () => parseGameCanonicalDocument(JSON.stringify(raw), "my-game"),
      (err: unknown) =>
        err instanceof GameCanonicalDocumentError && err.code === "INVALID_DOCUMENT",
    );
  }
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
