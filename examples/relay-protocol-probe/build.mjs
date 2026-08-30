#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceFiles = [
  "index.html",
  "style.css",
  "load-protocol.js",
  "game.js",
  "owogg.json",
  "owogg.logo.svg",
];
const entries = Object.fromEntries(
  sourceFiles.map((file) => [file, readFileSync(path.join(here, file))]),
);
// ZIP headers otherwise inherit the wall clock and produce a different content hash on every
// build. Use the earliest valid DOS timestamp, constructed in local time so every timezone writes
// the same date/time fields.
const zipped = zipSync(entries, { level: 9, mtime: new Date(1980, 0, 1, 0, 0, 0) });
const zipPath = path.join(here, "relay-protocol-probe.zip");
writeFileSync(zipPath, zipped);

console.log("Relay Protocol Probe upload bundle built");
console.log(`files: ${sourceFiles.join(", ")}`);
console.log(`zip: ${zipPath} (${zipped.length} bytes)`);
