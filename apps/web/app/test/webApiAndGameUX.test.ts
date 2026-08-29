import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  GameResultAcceptResponseSchema,
  LeaderboardResponseSchema,
  LeaderRecordSchema,
} from "@owogg/contracts";
import type { PublicGameCard } from "../features/catalog/publicGameAdapter.js";

describe("Product Integrity & Web API Contracts", () => {
  it("LeaderRecordSchema correctly normalizes snake_case and camelCase items", () => {
    const rawBackendItem = {
      id: 101,
      nickname: "ProPlayer",
      game_id: "reaction-time",
      score: 180,
      formattedScore: "180 ms",
      created_at: "2026-08-12",
      avatar_url: "https://example.com/avatar.png",
    };

    const parsed = LeaderRecordSchema.parse(rawBackendItem);
    assert.equal(parsed.id, "101");
    assert.equal(parsed.playerName, "ProPlayer");
    assert.equal(parsed.gameId, "reaction-time");
    assert.equal(parsed.score, 180);
    assert.equal(parsed.formattedScore, "180 ms");
    assert.equal(parsed.avatarUrl, "https://example.com/avatar.png");
  });

  it("LeaderboardResponseSchema validates real empty array and records without throwing", () => {
    const emptyResponse = {
      game_id: "all",
      leaderboard: [],
    };
    const parsedEmpty = LeaderboardResponseSchema.safeParse(emptyResponse);
    assert.equal(parsedEmpty.success, true);
    if (parsedEmpty.success) {
      assert.equal(parsedEmpty.data.leaderboard.length, 0);
    }

    const recordsResponse = {
      game_id: "memory-test",
      leaderboard: [
        {
          id: "201",
          playerName: "BrainMaster",
          gameId: "memory-test",
          score: 15,
          formattedScore: "Level 15",
          createdAt: "2026-08-12",
        },
      ],
    };
    const parsedRecords = LeaderboardResponseSchema.safeParse(recordsResponse);
    assert.equal(parsedRecords.success, true);
    if (parsedRecords.success) {
      assert.equal(parsedRecords.data.leaderboard.length, 1);
      assert.equal(parsedRecords.data.leaderboard[0]?.playerName, "BrainMaster");
    }
  });

  it("verified result responses carry the authoritative difficulty and mode", () => {
    const parsed = GameResultAcceptResponseSchema.parse({
      success: true,
      result_id: 10,
      score_id: 11,
      game_id: "aim-test",
      score: 125,
      rawScore: 100,
      normalizedScore: 100,
      competitiveScore: 125,
      difficultyId: "hard",
      variantId: "precision",
      rulesetRevision: 3,
      verified: true,
      adjusted: false,
      rewardEligible: true,
      xpAwarded: 10,
      newlyUnlockedAchievements: [],
    });

    assert.equal(parsed.difficultyId, "hard");
    assert.equal(parsed.variantId, "precision");
  });

  it("Catalog category filtering uses public API card categories", () => {
    const games = [
      { slug: "reaction-time", categories: ["reaction"] },
      { slug: "aim-test", categories: ["reaction"] },
      { slug: "memory-test", categories: ["brain"] },
      { slug: "typing-test", categories: ["brain", "typing"] },
    ] as Array<Pick<PublicGameCard, "slug" | "categories">>;
    const reactionGames = games.filter((game) => game.categories.includes("reaction"));
    const reactionSlugs = reactionGames.map((g) => g.slug);
    assert.ok(reactionSlugs.includes("reaction-time"));
    assert.ok(reactionSlugs.includes("aim-test"));

    const brainGames = games.filter((game) => game.categories.includes("brain"));
    const brainSlugs = brainGames.map((g) => g.slug);
    assert.ok(brainSlugs.includes("memory-test"));
    assert.ok(brainSlugs.includes("typing-test"));

    const typingGames = games.filter((game) => game.categories.includes("typing"));
    assert.deepEqual(
      typingGames.map((g) => g.slug),
      ["typing-test"],
    );
  });
});
