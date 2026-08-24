import assert from "node:assert/strict";
import test from "node:test";
import { PublicGameMetricsUseCases } from "../src/application/publicGameMetricsUseCases.js";
import type { PublicGameMetricsRepository } from "../src/ports/publicGameMetrics.js";

test("public game metric use cases apply one shared popularity policy and fill missing rows", async () => {
  const repository: PublicGameMetricsRepository = {
    async findBySlugs() {
      return [{ slug: "reaction-time", playerCount: 12, bookmarkCount: 4 }];
    },
  };

  const stats = await new PublicGameMetricsUseCases(repository).getBySlugs([
    "reaction-time",
    "new-game",
    "reaction-time",
  ]);

  assert.deepEqual(stats.get("reaction-time"), {
    playerCount: 12,
    bookmarkCount: 4,
    popularityScore: 24,
  });
  assert.deepEqual(stats.get("new-game"), {
    playerCount: 0,
    bookmarkCount: 0,
    popularityScore: 0,
  });
  assert.equal(stats.size, 2);
});
