#!/usr/bin/env node
// Builds the ball-dodge OWOGG Browser API reference bundle: compiles main.ts, copies the static assets, and
// zips the result — producing dist/ball-dodge.zip, the exact artifact a Game Creator would drag onto
// the Game Creator Center to register/upload this game through the existing
// upload/review/publish/B2 pipeline. Nothing here is wired into `pnpm build`/CI: this bundle is
// built and uploaded manually (see the PR description's manual E2E steps).
//
// Usage: node examples/ball-dodge/build.mjs

import { rmSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import ts from "typescript";

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(here, "dist");

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

// Compile main.ts + the vendored bridge together (one tsconfig, one rootDir covering both) so
// main.ts's relative import ("./vendor/game-sdk-bridge/client.js") resolves identically before
// and after compilation. Uses the TypeScript compiler API directly (typescript is already a
// hoisted workspace devDependency — see .npmrc's node-linker=hoisted) rather than shelling out to
// the tsc CLI binary, which avoids Windows' well-known .cmd-shim spawning quirks entirely.
const configPath = path.join(here, "tsconfig.json");
const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
if (configFile.error) {
  console.error(
    ts.formatDiagnosticsWithColorAndContext([configFile.error], ts.createCompilerHost({})),
  );
  process.exit(1);
}
const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, here);
const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
const emitResult = program.emit();
const diagnostics = ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics);
if (diagnostics.length > 0) {
  const host = ts.createCompilerHost(parsed.options);
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, host));
}
if (emitResult.emitSkipped || diagnostics.some((d) => d.category === ts.DiagnosticCategory.Error)) {
  console.error("❌ TypeScript compilation failed");
  process.exit(1);
}

// Static assets, copied alongside the compiled JS.
for (const file of ["index.html", "style.css", "owogg.json", "owogg.logo.svg"]) {
  copyFileSync(path.join(here, file), path.join(distDir, file));
}

// Zip dist/ into the actual upload artifact.
const zipEntries = {};
function addDir(dir, prefix) {
  for (const entry of readDirRecursive(dir)) {
    const rel = path.relative(dir, entry).split(path.sep).join("/");
    zipEntries[prefix ? `${prefix}/${rel}` : rel] = readFileSync(entry);
  }
}
function readDirRecursive(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...readDirRecursive(full));
    else out.push(full);
  }
  return out;
}
addDir(distDir, "");

const zipped = zipSync(zipEntries, { level: 9 });
const zipPath = path.join(distDir, "..", "ball-dodge.zip");
writeFileSync(zipPath, zipped);

console.log("✅ ball-dodge reference bundle built");
console.log(`   dist:  ${distDir}`);
console.log(`   files: ${Object.keys(zipEntries).sort().join(", ")}`);
console.log(`   zip:   ${zipPath} (${zipped.length} bytes)`);
