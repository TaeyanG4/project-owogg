#!/usr/bin/env -S npx tsx
// Runs the *real* production bundle-validation path (packages/core/src/domain/sandboxGameBundle.ts)
// against the actual built ball-dodge.zip — not a re-implementation of the checks, the same
// functions the API route calls. Confirms the bundle will actually pass upload before anyone
// tries it against a running server. Modeled directly on
// apps/api/test/fixtures/game-deploy-smoke-test/verify-ball-dodge-zip.mjs, minus that fixture's
// "no postMessage" scan — this bundle deliberately integrates the Game Bridge, which sends over a
// MessagePort obtained via a postMessage-based handshake, so that check does not apply here.
//
// Requires tsx (not plain `node`) — sandboxGameBundle.ts uses TypeScript parameter-property
// constructor shorthand, which Node's built-in type-stripping doesn't support.
//
// Usage: node examples/ball-dodge/build.mjs && npx tsx examples/ball-dodge/verify-zip.mjs

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import {
  validateBundleEntryMetadata,
  prepareBundleEntries,
  normalizeBundleEntryPath,
  findGameLogoFile,
} from "../../packages/core/src/domain/sandboxGameBundle.ts";
import { extractGameCreatorManifest } from "../../packages/core/src/domain/gameCreatorManifest.ts";
import { SANDBOX_GAME_POLICY } from "../../packages/core/src/domain/sandboxGames.ts";

const here = dirname(fileURLToPath(import.meta.url));
const zipPath = join(here, "ball-dodge.zip");
const zipBytes = readFileSync(zipPath);

console.log(`Zip file: ${zipPath}`);
console.log(`Zip size: ${zipBytes.length} bytes (cap: ${SANDBOX_GAME_POLICY.MAX_BUNDLE_BYTES})`);
if (zipBytes.length > SANDBOX_GAME_POLICY.MAX_BUNDLE_BYTES) {
  throw new Error("FAIL: zip exceeds MAX_BUNDLE_BYTES");
}

// Metadata-only pass (mirrors FflateBundleArchiveReader.readMetadata): read every entry's
// declared/compressed size via the filter callback WITHOUT decompressing.
const metadata = [];
unzipSync(zipBytes, {
  filter(file) {
    metadata.push({ path: file.name, declaredSize: file.originalSize, compressedSize: file.size });
    return false; // never decompress in this pass
  },
});

console.log(`Entries (metadata pass): ${metadata.length}`);
for (const m of metadata) {
  console.log(`  ${m.path}  declared=${m.declaredSize}B  compressed=${m.compressedSize}B`);
}

validateBundleEntryMetadata(metadata);
console.log("PASS: validateBundleEntryMetadata (size cap, file count, compression ratio, paths)");

// Full decompression pass + the real prepare step (path unwrap, MIME resolution, entry-file check).
const decompressed = unzipSync(zipBytes);
const prepared = prepareBundleEntries(decompressed);
console.log(
  `PASS: prepareBundleEntries — entry=${prepared.entry}, totalSize=${prepared.totalSize}B`,
);
for (const f of prepared.files) {
  console.log(
    `  -> ${f.path} (${f.contentType}${f.contentEncoding ? `, ${f.contentEncoding}` : ""})`,
  );
}

// The same manifest/logo extraction createGameFromBundle actually runs (see
// SandboxGameUseCases.createGameFromBundle) — confirms this zip really does register through the
// drag-and-drop auto-registration path, not just "is a valid zip".
const manifest = extractGameCreatorManifest(prepared.files);
if (!manifest) throw new Error("FAIL: no owogg.json manifest found");
console.log(`PASS: extractGameCreatorManifest — ${JSON.stringify(manifest)}`);
if (manifest.game.slug !== "ball-dodge") {
  throw new Error(`FAIL: unexpected slug ${manifest.game.slug}`);
}

const logoFile = findGameLogoFile(prepared.files);
if (!logoFile) throw new Error("FAIL: no owogg.logo.* file found");
console.log(`PASS: findGameLogoFile — ${logoFile.path} (${logoFile.bytes.byteLength}B)`);

// Path normalization sanity — every entry survives normalizeBundleEntryPath unchanged (no zip-slip,
// no absolute paths, no traversal) — already implied by validateBundleEntryMetadata not throwing,
// asserted again here explicitly for a clear PASS line.
for (const m of metadata) {
  if (normalizeBundleEntryPath(m.path) === null) {
    throw new Error(`FAIL: path rejected by normalizeBundleEntryPath: ${m.path}`);
  }
}
console.log("PASS: all entry paths normalize cleanly (no traversal/absolute/backslash tricks)");

// Confirms the Game Bridge actually got vendored in, not silently dropped — a genuine regression
// this bundle could otherwise have with no other check catching it (the pipeline validators above
// don't know or care what a game's JS *does*).
const mainJs = new TextDecoder().decode(decompressed["main.js"]);
if (!mainJs.includes("OWOGG") || !mainJs.includes("complete")) {
  throw new Error("FAIL: main.js does not use the OWOGG Browser API");
}
console.log("PASS: window.OWOGG Browser API usage is present in the built bundle");

console.log(
  "\nAll checks passed — ball-dodge.zip is a valid, Bridge-integrated sandbox game bundle.",
);
