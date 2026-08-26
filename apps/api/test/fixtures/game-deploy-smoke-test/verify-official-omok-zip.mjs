#!/usr/bin/env -S npx tsx
// Uses the same production bundle and owogg.json validators as the official admin upload path.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import {
  normalizeBundleEntryPath,
  prepareBundleEntries,
  validateBundleEntryMetadata,
} from "../../../../../packages/core/src/domain/sandboxGameBundle.ts";
import { extractGameCreatorManifest } from "../../../../../packages/core/src/domain/gameCreatorManifest.ts";
import { SANDBOX_GAME_POLICY } from "../../../../../packages/core/src/domain/sandboxGames.ts";

const here = dirname(fileURLToPath(import.meta.url));
const zipPath = join(here, "official-omok.zip");
const zipBytes = readFileSync(zipPath);
if (zipBytes.length > SANDBOX_GAME_POLICY.MAX_BUNDLE_BYTES) {
  throw new Error("FAIL: official-omok.zip exceeds MAX_BUNDLE_BYTES");
}

const metadata = [];
unzipSync(zipBytes, {
  filter(file) {
    metadata.push({ path: file.name, declaredSize: file.originalSize, compressedSize: file.size });
    return false;
  },
});
validateBundleEntryMetadata(metadata);
for (const entry of metadata) {
  if (normalizeBundleEntryPath(entry.path) === null) {
    throw new Error(`FAIL: unsafe archive path ${entry.path}`);
  }
}

const decompressed = unzipSync(zipBytes);
const prepared = prepareBundleEntries(decompressed);
const manifest = extractGameCreatorManifest(prepared.files);
if (!manifest || manifest.game.slug !== "official-omok" || manifest.game.mode !== "multi") {
  throw new Error("FAIL: official Omok manifest did not survive production parsing");
}
if (manifest.result.score !== null || manifest.leaderboard?.enabled !== false) {
  throw new Error("FAIL: online Omok must not declare a client score or leaderboard");
}
if (!prepared.files.some((file) => file.path === "owogg.logo.svg")) {
  throw new Error("FAIL: official upload requires owogg.logo.svg");
}

const gameSource = new TextDecoder().decode(decompressed["game.js"]);
const forbidden = [
  [/\blocalStorage\b/, "localStorage"],
  [/\bindexedDB\b/, "indexedDB"],
  [/\bfetch\s*\(/, "fetch"],
  [/\bXMLHttpRequest\b/, "XMLHttpRequest"],
  [/\bnew\s+WebSocket\s*\(/, "WebSocket"],
  [/\bpostMessage\s*\(/, "postMessage"],
];
const hits = forbidden.filter(([pattern]) => pattern.test(gameSource)).map(([, name]) => name);
if (hits.length > 0) throw new Error(`FAIL: forbidden direct browser API(s): ${hits.join(", ")}`);
if (!gameSource.includes("window.OWOGG") || !gameSource.includes("bridge.action")) {
  throw new Error("FAIL: game does not use the managed multiplayer browser bridge");
}

console.log(`PASS: ${zipPath}`);
console.log(`  zip bytes: ${zipBytes.length}`);
console.log(`  files: ${prepared.files.length}, entry: ${prepared.entry}`);
console.log("  production bundle + manifest validation passed");
console.log("  no direct storage/network/postMessage authority found in game.js");
