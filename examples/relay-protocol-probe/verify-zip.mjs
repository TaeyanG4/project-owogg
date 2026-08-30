#!/usr/bin/env -S npx tsx

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import {
  findGameLogoFile,
  prepareBundleEntries,
  validateBundleEntryMetadata,
} from "../../packages/core/src/domain/sandboxGameBundle.ts";
import { extractGameCreatorManifest } from "../../packages/core/src/domain/gameCreatorManifest.ts";
import { SANDBOX_GAME_POLICY } from "../../packages/core/src/domain/sandboxGames.ts";

const here = dirname(fileURLToPath(import.meta.url));
const zipPath = join(here, "relay-protocol-probe.zip");
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

const decompressed = unzipSync(zipBytes);
assert.deepEqual(Object.keys(decompressed).sort(), [
  "game.js",
  "index.html",
  "load-protocol.js",
  "owogg.json",
  "owogg.logo.svg",
  "style.css",
]);
const prepared = prepareBundleEntries(decompressed);
const manifest = extractGameCreatorManifest(prepared.files);
assert.equal(manifest?.schemaVersion, 1);
assert.equal(manifest?.game.slug, "relay-protocol-probe");
assert.deepEqual(manifest?.game.playModes, ["online-multi"]);
assert.equal(manifest?.multiplayer?.runtime.kind, "relay");
assert.deepEqual(manifest?.multiplayer?.players, { min: 2, max: 8 });
assert.ok(findGameLogoFile(prepared.files));

const gameJs = new TextDecoder().decode(decompressed["game.js"]);
const loadProtocolJs = new TextDecoder().decode(decompressed["load-protocol.js"]);
const indexHtml = new TextDecoder().decode(decompressed["index.html"]);
for (const required of [
  "relay.ready",
  "relay.broadcast",
  "relay.direct",
  "relay.snapshot",
  "relay.leave",
  "loadProtocol.buildLoadSample",
  "loadProtocol.summarizeLatencies",
]) {
  assert.ok(gameJs.includes(required), `game is missing ${required}`);
}
for (const required of ["relay-probe/load-v1", "load-report", "idle-report", "buildLoadSample"]) {
  assert.ok(loadProtocolJs.includes(required), `load protocol is missing ${required}`);
}
for (const required of ["load-start", "load-results", "idle-start", "idle-results"]) {
  assert.ok(indexHtml.includes(`id="${required}"`), `load UI is missing #${required}`);
}
for (const forbidden of ["new WebSocket", "fetch(", "userId", "sessionToken", "ws://", "wss://"]) {
  for (const [name, source] of [
    ["game.js", gameJs],
    ["load-protocol.js", loadProtocolJs],
  ]) {
    assert.equal(
      source.includes(forbidden),
      false,
      `${name} contains forbidden authority: ${forbidden}`,
    );
  }
}

const sha256 = createHash("sha256").update(zipBytes).digest("hex");
console.log("Relay Protocol Probe ZIP passed production bundle validation.");
console.log(
  `entries: ${metadata.length}, prepared bytes: ${prepared.totalSize}, zip bytes: ${zipBytes.length}`,
);
console.log(`sha256: ${sha256}`);
