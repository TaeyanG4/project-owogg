#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceFiles = ["index.html", "style.css", "game.js", "owogg.json", "owogg.logo.svg"];
const entries = Object.fromEntries(
  sourceFiles.map((file) => [file, readFileSync(path.join(here, file))]),
);
const zipped = zipSync(entries, { level: 9 });
const zipPath = path.join(here, "relay-protocol-probe.zip");
writeFileSync(zipPath, zipped);

console.log("Relay Protocol Probe upload bundle built");
console.log(`files: ${sourceFiles.join(", ")}`);
console.log(`zip: ${zipPath} (${zipped.length} bytes)`);
