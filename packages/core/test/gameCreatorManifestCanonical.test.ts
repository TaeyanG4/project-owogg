import test from "node:test";
import assert from "node:assert/strict";
import { parseGameCreatorManifest } from "../src/domain/gameCreatorManifest.js";
import { mapGameCreatorManifestToCanonical } from "../src/domain/gameCreatorManifestCanonical.js";
import {
  parseGameCanonicalDocument,
  serializeGameCanonicalDocument,
} from "../src/modules/game/domain/gameCanonicalDocument.js";

function manifestInput(includePlayConfig: boolean) {
  return {
    $schema: "https://owogg.com/schemas/manifest/v1.json",
    schemaVersion: 1,
    game: {
      slug: "verified-game",
      title: "Verified Game",
      genre: "skill",
      mode: "single",
      playModes: ["single"],
    },
    difficulties: [
      { id: "normal", title: "Normal", default: true },
      { id: "hard", title: "Hard" },
    ],
    ...(includePlayConfig
      ? {
          playConfig: {
            version: 1,
            rulesetRevision: 7,
            verifierId: "verified-game/score-v1",
            variants: [
              { id: "standard", title: "Standard" },
              { id: "precision", title: "Precision" },
            ],
            allowedConfigs: [
              { difficultyId: "normal", variantId: "standard", rewardFactor: 1 },
              { difficultyId: "normal", variantId: "precision", rewardFactor: 1.1 },
              { difficultyId: "hard", variantId: "standard", rewardFactor: 1.2 },
              { difficultyId: "hard", variantId: "precision", rewardFactor: 1.3 },
            ],
          },
        }
      : {}),
    progression: { type: "none" },
    result: {
      score: {
        unit: "points",
        direction: "desc",
        range: { min: 0, max: 1000, outOfRange: "reject" },
      },
    },
    leaderboard: { enabled: true },
  };
}

test("manifest PlayConfig becomes normalized canonical v1 runtime authority", () => {
  const manifest = parseGameCreatorManifest(manifestInput(true));
  const canonical = mapGameCreatorManifestToCanonical({
    manifest,
    publisherOfficial: false,
    updatedAt: "2026-08-29T00:00:00.000Z",
  });

  assert.equal(canonical.schemaVersion, 1);
  assert.deepEqual(canonical.playConfig, {
    version: 1,
    rulesetRevision: 7,
    verifierId: "verified-game/score-v1",
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
  });
  assert.deepEqual(
    parseGameCanonicalDocument(serializeGameCanonicalDocument(canonical), canonical.slug),
    canonical,
  );
});

test("manifest without PlayConfig produces no canonical PlayConfig", () => {
  const manifest = parseGameCreatorManifest(manifestInput(false));
  const canonical = mapGameCreatorManifestToCanonical({
    manifest,
    publisherOfficial: true,
    updatedAt: "2026-08-29T00:00:00.000Z",
  });

  assert.equal(canonical.playConfig, undefined);
  assert.equal("playConfig" in canonical, false);
});
