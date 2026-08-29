import {
  GAME_CANONICAL_SCHEMA_VERSION,
  type GameCanonicalDocument,
  type GameIdentity,
  type GameVersion,
  type RuntimeGame,
} from "../src/index.js";

export const TEST_GAME_SLUGS = ["reaction-time", "memory-test", "aim-test", "typing-test"] as const;

export function canonicalFixture(slug = "reaction-time", title = slug): GameCanonicalDocument {
  return {
    schemaVersion: GAME_CANONICAL_SCHEMA_VERSION,
    slug,
    title,
    shortDescription: `${title} short description`,
    description: `${title} description`,
    publisher: { official: true },
    catalog: {
      type: "TAXONOMY",
      categories: ["test"],
      tags: ["fixture"],
      modes: ["single"],
      inputMethods: ["mouse"],
      minPlayers: 1,
      maxPlayers: 1,
      thumbnail: "/fixture.svg",
      accent: "#6366f1",
    },
    policy: {
      score: {
        unit: "ms",
        direction: "asc",
        min: 0,
        max: 60_000,
        displaySuffix: " ms",
      },
      leaderboard: true,
      xpPerCompletion: 10,
      requiresAuth: false,
    },
    difficulty: {
      levels: [
        { id: "normal", label: "Normal" },
        { id: "hard", label: "Hard" },
      ],
      defaultLevelId: "normal",
    },
    supportsReplay: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

export function runtimeGameFixture(slug = "reaction-time", title = slug): RuntimeGame {
  const identity: GameIdentity = {
    id: 91,
    slug,
    publisher: { type: "OWOGG" },
    visibility: "PUBLIC",
    liveVersionId: 17,
    deletedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const liveVersion: GameVersion = {
    id: 17,
    gameId: identity.id,
    objectKey: `games/${identity.id}/17/index.html`,
    contentHash: "hash",
    bundleBytes: 1,
    publishStatus: "READY",
    publishError: null,
    publishedAt: "2026-01-01T00:00:00.000Z",
    manifestKey: `games/${identity.id}/17/.owogg-manifest.json`,
    publishedSizeBytes: 1,
    fileCount: 1,
    uploadedAt: "2026-01-01T00:00:00.000Z",
  };
  return { identity, liveVersion, canonical: canonicalFixture(slug, title) };
}
