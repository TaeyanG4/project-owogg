import assert from "node:assert/strict";
import test from "node:test";
import { leaderboardVariantLabel } from "../features/scores/variantLabel.js";

const game = {
  playConfig: {
    version: 1 as const,
    rulesetRevision: 3,
    defaultVariantId: "standard",
    variants: [
      { id: "standard", label: "Standard" },
      { id: "precision", label: "Precision mode" },
    ],
    allowedConfigs: [
      { difficultyId: "normal", variantId: "standard", rewardFactor: 1 },
      { difficultyId: "normal", variantId: "precision", rewardFactor: 1.1 },
    ],
  },
};

test("leaderboard mode uses canonical variant labels", () => {
  assert.equal(leaderboardVariantLabel(game, "precision"), "Precision mode");
});

test("unknown variants remain visible and legacy standard has a stable label", () => {
  assert.equal(leaderboardVariantLabel(game, "future-mode"), "future-mode");
  assert.equal(leaderboardVariantLabel(null, "standard"), "Standard");
});
