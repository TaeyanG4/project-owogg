#!/usr/bin/env node
// Builds the standalone upload artifact. It is intentionally not part of the site runtime or a
// static game registry; upload the resulting ZIP through the normal admin/Creator review flow.

import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import ts from "typescript";

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(here, "dist");

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

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
  console.error(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, ts.createCompilerHost(parsed.options)),
  );
}
if (
  emitResult.emitSkipped ||
  diagnostics.some((item) => item.category === ts.DiagnosticCategory.Error)
) {
  throw new Error("Verified Aim Test TypeScript compilation failed");
}

for (const file of ["index.html", "style.css", "owogg.json", "owogg.logo.svg"]) {
  copyFileSync(path.join(here, file), path.join(distDir, file));
}

function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(fullPath) : [fullPath];
  });
}

const entries = {};
for (const file of filesBelow(distDir)) {
  entries[path.relative(distDir, file).split(path.sep).join("/")] = readFileSync(file);
}
const zipped = zipSync(entries, { level: 9 });
const zipPath = path.join(here, "verified-aim-test.zip");
writeFileSync(zipPath, zipped);

console.log("Verified Aim Test reference bundle built");
console.log(`dist: ${distDir}`);
console.log(`files: ${Object.keys(entries).sort().join(", ")}`);
console.log(`zip: ${zipPath} (${zipped.length} bytes)`);
