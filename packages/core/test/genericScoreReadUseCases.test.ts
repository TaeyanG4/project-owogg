import test from "node:test";
import assert from "node:assert/strict";
import { GenericScoreReadUseCases } from "../src/application/genericScoreReadUseCases.js";
import type { RuntimeGame } from "../src/modules/game/domain/runtimeGame.js";
import type { RuntimeGameRegistry } from "../src/modules/game/ports/runtimeGameRegistry.js";
import type {
  Score,
  ScoreRepository,
  UserPersonalBestAggregate,
} from "../src/ports/repositories.js";

class FakeScoreRepository implements ScoreRepository {
  constructor(private readonly aggregates: UserPersonalBestAggregate[]) {}

  async saveScore(): Promise<Score> {
    throw new Error("not used");
  }

  async getLeaderboard(): Promise<Score[]> {
    throw new Error("not used");
  }

  async getUserPersonalBests(): Promise<UserPersonalBestAggregate[]> {
    return this.aggregates;
  }
}

function runtime(
  slug: string,
  publisher: RuntimeGame["identity"]["publisher"],
  direction: "asc" | "desc",
): RuntimeGame {
  return {
    identity: {
      id: slug === "owogg-asc" ? 1 : slug === "user-desc" ? 2 : 3,
      slug,
      publisher,
      visibility: "PUBLIC",
      liveVersionId: 1,
      deletedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    liveVersion: {
      id: 1,
      gameId: slug === "owogg-asc" ? 1 : slug === "user-desc" ? 2 : 3,
      objectKey: `games/${slug}/1/manifest.json`,
      contentHash: "hash",
      bundleBytes: 1,
      publishStatus: "READY",
      publishError: null,
      publishedAt: "2026-01-01T00:00:00.000Z",
      manifestKey: "manifest.json",
      publishedSizeBytes: 1,
      fileCount: 1,
      uploadedAt: "2026-01-01T00:00:00.000Z",
    },
    canonical: {
      schemaVersion: 1,
      slug,
      title: slug,
      shortDescription: "",
      description: "",
      publisher: { official: publisher.type === "OWOGG" },
      policy: {
        score: { unit: "pt", direction, min: 0, max: 100, displaySuffix: " pt" },
        leaderboard: true,
        xpPerCompletion: 0,
        requiresAuth: false,
      },
      supportsReplay: false,
      catalog: { type: "GENRE_MODE", genre: "test", mode: "single" },
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  };
}

test("generic score reads select canonical asc/desc bests for both publishers", async () => {
  const runtimes = new Map<string, RuntimeGame>([
    ["owogg-asc", runtime("owogg-asc", { type: "OWOGG" }, "asc")],
    ["user-desc", runtime("user-desc", { type: "USER", userId: 42 }, "desc")],
  ]);
  const registry: RuntimeGameRegistry = {
    findBySlug: async (slug) => runtimes.get(slug) ?? null,
    listPublic: async () => [...runtimes.values()],
  };
  const useCases = new GenericScoreReadUseCases(
    new FakeScoreRepository([
      { game_id: "owogg-asc", ruleset_revision: 1, min_score: 120, max_score: 300 },
      { game_id: "user-desc", ruleset_revision: 1, min_score: 4, max_score: 9 },
      { game_id: "historical-missing", ruleset_revision: 1, min_score: 1, max_score: 99 },
    ]),
    registry,
  );

  assert.deepEqual(await useCases.getUserBests(7), {
    "owogg-asc": 120,
    "user-desc": 9,
  });
  assert.deepEqual(await useCases.getUserBestsFormatted(7), [
    { gameId: "owogg-asc", score: 120, formattedScore: "120 pt" },
    { gameId: "user-desc", score: 9, formattedScore: "9 pt" },
  ]);
});
