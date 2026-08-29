#!/usr/bin/env -S npx tsx

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { unzipSync } from "fflate";
import {
  findGameLogoFile,
  normalizeBundleEntryPath,
  prepareBundleEntries,
  validateBundleEntryMetadata,
} from "../../packages/core/src/domain/sandboxGameBundle.ts";
import { extractGameCreatorManifest } from "../../packages/core/src/domain/gameCreatorManifest.ts";
import { SANDBOX_GAME_POLICY } from "../../packages/core/src/domain/sandboxGames.ts";

const here = dirname(fileURLToPath(import.meta.url));
const zipPath = join(here, "verified-aim-test.zip");
const zipBytes = readFileSync(zipPath);
assert.ok(zipBytes.length <= SANDBOX_GAME_POLICY.MAX_BUNDLE_BYTES, "ZIP exceeds upload cap");

const metadata = [];
unzipSync(zipBytes, {
  filter(file) {
    metadata.push({ path: file.name, declaredSize: file.originalSize, compressedSize: file.size });
    return false;
  },
});
validateBundleEntryMetadata(metadata);
for (const entry of metadata) {
  assert.notEqual(normalizeBundleEntryPath(entry.path), null, `unsafe path: ${entry.path}`);
}

const decompressed = unzipSync(zipBytes);
const prepared = prepareBundleEntries(decompressed);
const manifest = extractGameCreatorManifest(prepared.files);
assert.equal(manifest?.game.slug, "verified-aim-test");
assert.equal(manifest?.schemaVersion, 1);
assert.equal(manifest?.playConfig?.verifierId, "verified-aim-test-v1");
assert.equal(manifest?.playConfig?.allowedConfigs.length, 4);
assert.ok(findGameLogoFile(prepared.files));

const mainJs = new TextDecoder().decode(decompressed["main.js"]);
for (const required of ["requestStart", "challengeSeed", "complete", "evidence"]) {
  assert.ok(mainJs.includes(required), `compiled game is missing ${required}`);
}

const vectors = JSON.parse(readFileSync(join(here, "test-vectors.json"), "utf8"));
const rules = await import(pathToFileURL(join(here, "dist", "rules.js")).href);
for (const vector of vectors) {
  assert.deepEqual(
    rules.createAimTargets({
      challengeSeed: vector.challengeSeed,
      difficultyId: vector.difficultyId,
      variantId: vector.variantId,
    }),
    vector.targets,
  );
}

const largest = vectors.reduce((left, right) =>
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
assert.ok(new TextEncoder().encode(JSON.stringify(evidence)).byteLength < 16 * 1024);

console.log("Verified Aim Test ZIP passed production bundle validation.");
console.log(
  `entries: ${metadata.length}, prepared bytes: ${prepared.totalSize}, zip bytes: ${zipBytes.length}`,
);
console.log(
  `deterministic vectors: ${vectors.length}, largest evidence events: ${evidence.events.length}`,
);
