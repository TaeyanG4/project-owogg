import test from "node:test";
import assert from "node:assert/strict";
import {
  publicGameMediaUrl,
  toPublicGame,
  toPublicGameStats,
  type GameAsset,
  type GameIdentity,
  type GameVersion,
  type RuntimeGame,
} from "../src/index.js";
import { runtimeGameFixture } from "./runtimeGameFixture.js";

const fixture = runtimeGameFixture("reaction-time", "Reaction Time");
const definition = fixture.canonical;

const identity: GameIdentity = {
  id: 9,
  slug: definition.slug,
  publisher: { type: "OWOGG" },
  visibility: "PUBLIC",
  liveVersionId: 4,
  deletedAt: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const liveVersion: GameVersion = {
  id: 4,
  gameId: identity.id,
  objectKey: "games/9/4/index.html",
  contentHash: "hash",
  bundleBytes: 10,
  publishStatus: "READY",
  publishError: null,
  publishedAt: "2026-08-01T00:00:00.000Z",
  manifestKey: "games/9/4/.owogg-manifest.json",
  publishedSizeBytes: 10,
  fileCount: 1,
  uploadedAt: "2026-08-01T00:00:00.000Z",
};

const runtime: RuntimeGame = {
  identity,
  liveVersion,
  canonical: definition,
};

test("toPublicGame exposes the provider-neutral canonical projection only", () => {
  const publicGame = toPublicGame(
    runtime,
    "https://api.example.test/logo",
    "OWOGG",
    toPublicGameStats({ playerCount: 12, bookmarkCount: 4 }),
  );
  assert.equal(publicGame.publisherType, "OWOGG");
  assert.equal(publicGame.publisherName, "OWOGG");
  assert.equal(publicGame.slug, "reaction-time");
  assert.equal(publicGame.title, definition.title);
  assert.deepEqual(publicGame.playModes, ["single"]);
  assert.deepEqual(publicGame.policy, runtime.canonical.policy);
  assert.deepEqual(publicGame.catalog, runtime.canonical.catalog);
  assert.equal(publicGame.mediaUrl, "https://api.example.test/logo");
  assert.equal(publicGame.publishedAt, identity.createdAt);
  assert.deepEqual(publicGame.stats, {
    playerCount: 12,
    bookmarkCount: 4,
    popularityScore: 24,
  });

  const raw = publicGame as unknown as Record<string, unknown>;
  for (const forbidden of ["id", "publisher_user_id", "publisherUserId", "liveVersionId"]) {
    assert.equal(forbidden in raw, false, `${forbidden} must not cross the public boundary`);
  }
});

test("public playModes preserve hybrid canonical topology without granting runtime authority", () => {
  const hybridRuntime: RuntimeGame = {
    ...runtime,
    canonical: {
      ...runtime.canonical,
      catalog: {
        ...runtime.canonical.catalog,
        type: "TAXONOMY",
        modes: ["local-multi", "online-multi"],
        minPlayers: 2,
        maxPlayers: 2,
      },
    },
  };
  assert.deepEqual(toPublicGame(hybridRuntime, null).playModes, ["local-multi", "online-multi"]);
});

test("the public official badge follows canonical metadata, never the D1 owner discriminant", () => {
  const userOwnedOfficialMetadata: RuntimeGame = {
    ...runtime,
    identity: { ...identity, publisher: { type: "USER", userId: 77 } },
  };
  assert.equal(toPublicGame(userOwnedOfficialMetadata, null).publisherType, "OWOGG");

  const systemOwnedNonOfficialMetadata: RuntimeGame = {
    ...runtime,
    canonical: { ...runtime.canonical, publisher: { official: false } },
  };
  assert.equal(toPublicGame(systemOwnedNonOfficialMetadata, null).publisherType, "USER");
});

test("public PlayConfig exposes approved choices but never the server verifier id", () => {
  const verifiedRuntime: RuntimeGame = {
    ...runtime,
    canonical: {
      ...runtime.canonical,
      playConfig: {
        version: 1,
        rulesetRevision: 7,
        verifierId: "reaction-time/score-v1",
        defaultVariantId: "standard",
        variants: [{ id: "standard", label: "Standard" }],
        allowedConfigs: [{ difficultyId: "normal", variantId: "standard", rewardFactor: 1 }],
      },
    },
  };

  const publicGame = toPublicGame(verifiedRuntime, null);
  assert.deepEqual(publicGame.playConfig, {
    version: 1,
    rulesetRevision: 7,
    defaultVariantId: "standard",
    variants: [{ id: "standard", label: "Standard" }],
    allowedConfigs: [{ difficultyId: "normal", variantId: "standard", rewardFactor: 1 }],
  });
  assert.equal("verifierId" in (publicGame.playConfig ?? {}), false);
  assert.equal(verifiedRuntime.canonical.playConfig?.verifierId, "reaction-time/score-v1");
  assert.notEqual(
    publicGame.playConfig?.variants,
    verifiedRuntime.canonical.playConfig?.variants,
    "the public projection must copy nested arrays instead of sharing canonical references",
  );
});

test("a D1/B2 logo asset is the only public artwork source for every publisher", () => {
  const asset: GameAsset = {
    gameId: identity.id,
    kind: "LOGO",
    objectKey: "private/logo.svg",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
  assert.equal(
    publicGameMediaUrl(asset, "https://api.example.test/media/logo"),
    "https://api.example.test/media/logo?v=2026-08-01T00%3A00%3A00.000Z",
  );
});

test("a taxonomy game without a D1/B2 logo does not fall back to a removed Git path", () => {
  assert.equal(publicGameMediaUrl(null, "https://api.example.test/media/logo"), null);
});

test("GENRE_MODE games use the provider-neutral media endpoint only when a logo asset exists", () => {
  const asset: GameAsset = {
    gameId: 10,
    kind: "LOGO",
    objectKey: "uploads/10/logo.svg",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
  assert.equal(
    publicGameMediaUrl(asset, "/api/games/ball-dodge/media/logo"),
    "/api/games/ball-dodge/media/logo?v=2026-08-01T00%3A00%3A00.000Z",
  );
  assert.equal(publicGameMediaUrl(null, "/api/games/ball-dodge/media/logo"), null);
});
