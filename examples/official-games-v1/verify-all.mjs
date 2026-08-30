#!/usr/bin/env -S npx tsx

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import {
  findGameLogoFile,
  normalizeBundleEntryPath,
  prepareBundleEntries,
  validateBundleEntryMetadata,
} from "../../packages/core/src/domain/sandboxGameBundle.ts";
import { extractGameCreatorManifest } from "../../packages/core/src/domain/gameCreatorManifest.ts";
import { SANDBOX_GAME_POLICY } from "../../packages/core/src/domain/sandboxGames.ts";
import { createTrustedGameVerifierRegistry } from "../../apps/api/src/infrastructure/games/StaticGameVerifierRegistry.ts";
import { officialV1Games } from "./games.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const inventory = JSON.parse(readFileSync(path.join(here, "inventory.json"), "utf8"));
const inventoryBySlug = new Map(inventory.games.map((game) => [game.slug, game]));
const registry = createTrustedGameVerifierRegistry();
const forbiddenSourcePatterns = [
  ["fetch", /\bfetch\s*\(/],
  ["WebSocket", /\bnew\s+WebSocket\b/],
  ["XMLHttpRequest", /\bXMLHttpRequest\b/],
  ["EventSource", /\bEventSource\b/],
  ["service worker", /\bserviceWorker\b/],
  ["cookie access", /\bdocument\.cookie\b/],
  ["persistent browser storage", /\b(?:localStorage|sessionStorage)\b/],
];

assert.equal(inventory.schemaVersion, 1);
assert.deepEqual(
  [...inventoryBySlug.keys()].sort(),
  officialV1Games.map((game) => game.slug).sort(),
  "inventory must cover exactly the frozen GAME identities",
);

for (const game of officialV1Games) {
  assert.match(game.artifactVersion, /^\d+\.\d+\.\d+$/, `${game.slug}: artifact SemVer`);
  const artifact = inventoryBySlug.get(game.slug);
  assert.ok(artifact, `missing inventory entry: ${game.slug}`);
  assert.equal(
    artifact.artifactVersion,
    game.artifactVersion,
    `${game.slug}: artifact version drift`,
  );
  assert.equal(artifact.filename, `${game.slug}_v${game.artifactVersion}.zip`);
  assert.equal(
    artifact.backupRelativePath,
    `${game.slug}/${game.slug}_v${game.artifactVersion}.zip`,
  );
  const zipPath = path.join(here, "dist", `${game.slug}.zip`);
  const zipBytes = readFileSync(zipPath);
  assert.ok(zipBytes.length <= SANDBOX_GAME_POLICY.MAX_BUNDLE_BYTES, `${game.slug}: ZIP too large`);
  assert.equal(zipBytes.length, artifact.bytes, `${game.slug}: inventory byte count drift`);
  assert.equal(
    createHash("sha256").update(zipBytes).digest("hex"),
    artifact.sha256,
    `${game.slug}: inventory SHA-256 drift`,
  );

  const metadata = [];
  unzipSync(zipBytes, {
    filter(file) {
      metadata.push({
        path: file.name,
        declaredSize: file.originalSize,
        compressedSize: file.size,
      });
      return false;
    },
  });
  validateBundleEntryMetadata(metadata);
  for (const entry of metadata) {
    assert.notEqual(normalizeBundleEntryPath(entry.path), null, `${game.slug}: unsafe ZIP path`);
  }

  const decompressed = unzipSync(zipBytes);
  assert.deepEqual(
    Object.keys(decompressed).sort(),
    [...game.files].sort(),
    `${game.slug}: ZIP root contents drift`,
  );
  const prepared = prepareBundleEntries(decompressed);
  const manifest = extractGameCreatorManifest(prepared.files);
  assert.ok(manifest, `${game.slug}: owogg.json missing`);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.game.slug, game.slug);
  assert.ok(findGameLogoFile(prepared.files), `${game.slug}: logo missing`);

  if (manifest.playConfig) {
    assert.equal(
      registry.has(manifest.playConfig.verifierId),
      true,
      `${game.slug}: verifier is not installed`,
    );
    assert.equal(manifest.leaderboard?.enabled, true);
  } else {
    assert.equal(game.slug, "official-omok", `${game.slug}: competitive single needs PlayConfig`);
    assert.deepEqual(manifest.game.playModes, ["local-multi", "online-multi"]);
    assert.equal(manifest.multiplayer?.runtime.kind, "relay");
    assert.equal(manifest.leaderboard?.enabled, false);
  }

  for (const filename of ["index.html", "rules.js", "game.js"]) {
    const text = new TextDecoder().decode(decompressed[filename]);
    for (const [label, pattern] of forbiddenSourcePatterns) {
      assert.doesNotMatch(text, pattern, `${game.slug}/${filename}: forbidden ${label}`);
    }
    assert.doesNotMatch(
      text,
      /(?:src|href)\s*=\s*["']https?:/i,
      `${game.slug}/${filename}: remote asset reference`,
    );
  }

  const gameJs = new TextDecoder().decode(decompressed["game.js"]);
  if (game.slug === "official-omok") {
    for (const required of ["selectPlayMode", "local-multi", "online-multi", "multiplayer"]) {
      assert.ok(gameJs.includes(required), `${game.slug}: missing ${required}`);
    }
  } else {
    for (const required of ["requestStart", "complete", "evidence"]) {
      assert.ok(gameJs.includes(required), `${game.slug}: missing ${required}`);
    }
  }
  console.log(
    `${game.slug}: ${zipBytes.length} bytes sha256:${artifact.sha256} (${metadata.length} files)`,
  );
}

console.log("All Phase 7 official game v1 ZIPs passed strict bundle validation.");
