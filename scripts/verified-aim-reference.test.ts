import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  canonicalizeGameEvidence,
  MAX_GAME_EVIDENCE_BYTES,
} from "../packages/core/src/domain/gameEvidence.js";
import { parseGameCreatorManifest } from "../packages/core/src/domain/gameCreatorManifest.js";
import {
  AIM_RULESET_REVISION,
  AIM_VERIFIER_ID,
  type AimDifficultyId,
  type AimTarget,
  type AimVariantId,
  createAimTargets,
} from "../examples/verified-aim-test/rules.js";

interface AimVector {
  readonly challengeSeed: string;
  readonly difficultyId: AimDifficultyId;
  readonly variantId: AimVariantId;
  readonly targets: readonly AimTarget[];
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as unknown;
}

function referenceVectors(): readonly AimVector[] {
  return readJson("../examples/verified-aim-test/test-vectors.json") as readonly AimVector[];
}

test("Verified Aim Test manifest stays bound to the reviewed v1 verifier", () => {
  const manifest = parseGameCreatorManifest(readJson("../examples/verified-aim-test/owogg.json"));

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.game.slug, "verified-aim-test");
  assert.deepEqual(manifest.game.playModes, ["single"]);
  assert.equal(manifest.multiplayer, undefined);
  assert.equal(manifest.playConfig?.version, 1);
  assert.equal(manifest.playConfig?.rulesetRevision, AIM_RULESET_REVISION);
  assert.equal(manifest.playConfig?.verifierId, AIM_VERIFIER_ID);
  assert.equal(manifest.playConfig?.allowedConfigs.length, 4);
});

test("Verified Aim Test client rules stay aligned with the reviewed server vectors", () => {
  const vectors = referenceVectors();
  assert.equal(vectors.length, 4);

  for (const vector of vectors) {
    assert.deepEqual(
      createAimTargets({
        challengeSeed: vector.challengeSeed,
        difficultyId: vector.difficultyId,
        variantId: vector.variantId,
      }),
      vector.targets,
    );
  }
});

test("Verified Aim Test's largest reference evidence fits the platform boundary", async () => {
  const largest = referenceVectors().reduce((left, right) =>
    left.targets.length >= right.targets.length ? left : right,
  );
  const evidence = {
    version: 1,
    completedAtMs: 1_000,
    events: largest.targets.map((target, index) => ({
      seq: index + 1,
      tMs: 120 + index * 60,
      x: target.x,
      y: target.y,
    })),
  };

  assert.equal("score" in evidence, false);
  const canonical = await canonicalizeGameEvidence(evidence);
  assert.equal(canonical.ok, true);
  if (!canonical.ok) return;
  assert.ok(canonical.byteLength < MAX_GAME_EVIDENCE_BYTES);
});
