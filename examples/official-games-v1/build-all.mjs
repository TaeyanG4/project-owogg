#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import { officialV1Games } from "./games.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const outputDirectory = path.join(here, "dist");
rmSync(outputDirectory, { recursive: true, force: true });
mkdirSync(outputDirectory, { recursive: true });

for (const game of officialV1Games) {
  const gameDirectory = path.join(here, game.slug);
  const entries = Object.fromEntries(
    game.files.map((file) => [file, readFileSync(path.join(gameDirectory, file))]),
  );
  const bytes = zipSync(entries, { level: 9, mtime: new Date(1980, 0, 1, 0, 0, 0) });
  const outputPath = path.join(outputDirectory, `${game.slug}.zip`);
  writeFileSync(outputPath, bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  console.log(`${game.slug}: ${bytes.length} bytes sha256:${sha256}`);
}
