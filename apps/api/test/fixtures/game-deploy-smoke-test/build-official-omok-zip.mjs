#!/usr/bin/env node
// Builds the exact ZIP intended for the trusted /admin/games upload path. The generated archive is
// ignored by Git; the reviewable HTML/CSS/JS/manifest/logo sources remain committed.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const here = dirname(fileURLToPath(import.meta.url));
const sourceDirectory = join(here, "official-omok");
const outputFile = join(here, "official-omok.zip");
const files = ["index.html", "game.js", "style.css", "owogg.json", "owogg.logo.svg"];
const entries = Object.fromEntries(
  files.map((name) => [name, readFileSync(join(sourceDirectory, name))]),
);
const zipped = zipSync(entries, { level: 9 });

writeFileSync(outputFile, zipped);
console.log(`Wrote ${outputFile}`);
console.log(`  files: ${files.join(", ")}`);
console.log(`  zip bytes: ${zipped.length}`);
