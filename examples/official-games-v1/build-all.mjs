#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import { officialV1Games } from "./games.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const outputDirectory = path.join(here, "dist");
const backupRoot = path.resolve(
  process.env.OWOGG_GAMES_BACKUP_DIR || path.join(here, "..", "..", "..", "project-owogg-games"),
);
rmSync(outputDirectory, { recursive: true, force: true });
mkdirSync(outputDirectory, { recursive: true });
mkdirSync(backupRoot, { recursive: true });

for (const game of officialV1Games) {
  if (!/^\d+\.\d+\.\d+$/.test(game.artifactVersion)) {
    throw new Error(`${game.slug}: artifactVersion must use SemVer, for example 1.0.0`);
  }
  const gameDirectory = path.join(here, game.slug);
  const entries = Object.fromEntries(
    game.files.map((file) => [file, readFileSync(path.join(gameDirectory, file))]),
  );
  const bytes = zipSync(entries, { level: 9, mtime: new Date(1980, 0, 1, 0, 0, 0) });
  const outputPath = path.join(outputDirectory, `${game.slug}.zip`);
  writeFileSync(outputPath, bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const backupDirectory = path.join(backupRoot, game.slug);
  const backupPath = path.join(backupDirectory, `${game.slug}_v${game.artifactVersion}.zip`);
  mkdirSync(backupDirectory, { recursive: true });
  if (existsSync(backupPath)) {
    const existingHash = createHash("sha256").update(readFileSync(backupPath)).digest("hex");
    if (existingHash !== sha256) {
      throw new Error(
        `${backupPath} already exists with different content; increment the SemVer artifactVersion before rebuilding`,
      );
    }
  } else {
    writeFileSync(backupPath, bytes);
  }
  console.log(`${game.slug}: ${bytes.length} bytes sha256:${sha256} backup:${backupPath}`);
}
