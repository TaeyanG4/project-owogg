#!/usr/bin/env node
// Packages the ball-dodge/ source files into ball-dodge.zip — the actual upload artifact for the
// sandbox game pipeline smoke test (see docs/GAME_CREATION_GUIDE.md §3.5). The zip is a derived
// build artifact (gitignored, see .gitignore), regenerated on demand from the committed source
// files rather than committed itself.
//
// Usage: node apps/api/test/fixtures/game-deploy-smoke-test/build-ball-dodge-zip.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "ball-dodge");
const outFile = join(here, "ball-dodge.zip");

// owogg.json Creator Manifest v1 + owogg.logo.svg let the fixture double as a worked
// example of the drag-and-drop auto-registration path (see docs/GAME_CREATION_GUIDE.md §3.6.2) —
// dropping this zip straight onto the Game Creator Center registers "ball-dodge", both fields
// being required on every registration since 2026-08-18.
const files = ["index.html", "game.js", "style.css", "owogg.json", "owogg.logo.svg"];
const entries = {};
for (const name of files) {
  entries[name] = readFileSync(join(srcDir, name));
}

const zipped = zipSync(entries, { level: 9 });
writeFileSync(outFile, zipped);

const totalSource = files.reduce((sum, name) => sum + readFileSync(join(srcDir, name)).length, 0);
console.log(`Wrote ${outFile}`);
console.log(`  files: ${files.join(", ")}`);
console.log(`  source bytes (uncompressed): ${totalSource}`);
console.log(`  zip bytes: ${zipped.length}`);
