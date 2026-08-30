import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { unzipSync } from "fflate";
import {
  findGameLogoFile,
  prepareBundleEntries,
  validateBundleEntryMetadata,
} from "../packages/core/src/domain/sandboxGameBundle.js";
import { extractGameCreatorManifest } from "../packages/core/src/domain/gameCreatorManifest.js";

const fixtureDirectory = join(process.cwd(), "examples", "relay-protocol-probe");
const fixtureFiles = ["index.html", "style.css", "game.js", "owogg.json", "owogg.logo.svg"];
const expectedZipSha256 = "e7d719622f8896adf87a2a7c8870ca17ba79097707817e4fca84acb5990851c4";

function sourceFilesBelow(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFilesBelow(path);
    return /\.(?:js|ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

test("Relay Protocol Probe is an uploadable v1 ZIP with no game-specific server authority", () => {
  execFileSync(process.execPath, [join(fixtureDirectory, "build.mjs")], {
    cwd: process.cwd(),
    stdio: "pipe",
  });
  const zipBytes = readFileSync(join(fixtureDirectory, "relay-protocol-probe.zip"));
  assert.equal(
    createHash("sha256").update(zipBytes).digest("hex"),
    expectedZipSha256,
    "the upload artifact must be byte-for-byte reproducible",
  );
  const metadata: Array<{ path: string; declaredSize: number; compressedSize: number }> = [];
  unzipSync(zipBytes, {
    filter(file) {
      metadata.push({
        path: file.name,
        declaredSize: file.originalSize,
        compressedSize: file.size,
      });
      return false;
    },
  });
  validateBundleEntryMetadata(metadata);

  const decompressed = unzipSync(zipBytes);
  assert.deepEqual(Object.keys(decompressed).sort(), [...fixtureFiles].sort());
  const prepared = prepareBundleEntries(decompressed);
  const manifest = extractGameCreatorManifest(prepared.files);
  assert.equal(prepared.entry, "index.html");
  assert.equal(manifest?.schemaVersion, 1);
  assert.equal(manifest?.game.slug, "relay-protocol-probe");
  assert.deepEqual(manifest?.game.playModes, ["online-multi"]);
  assert.equal(manifest?.multiplayer?.transport.kind, "websocket");
  assert.equal(manifest?.multiplayer?.runtime.kind, "relay");
  assert.deepEqual(manifest?.multiplayer?.players, { min: 2, max: 8 });
  assert.deepEqual(manifest?.multiplayer?.features, {
    reconnect: "resume",
    directMessages: true,
    hostSnapshot: true,
    joinInProgress: false,
    spectators: false,
  });
  assert.ok(findGameLogoFile(prepared.files));

  const gameJs = readFileSync(join(fixtureDirectory, "game.js"), "utf8");
  for (const required of [
    "relay.ready",
    "relay.broadcast",
    "relay.direct",
    "relay.snapshot",
    "relay.leave",
  ]) {
    assert.match(gameJs, new RegExp(required.replace(".", "\\.")));
  }
  for (const forbidden of [
    "new WebSocket",
    "fetch(",
    "userId",
    "sessionToken",
    "ws://",
    "wss://",
  ]) {
    assert.equal(gameJs.includes(forbidden), false, forbidden);
  }

  const activeSourceRoots = [
    join(process.cwd(), "apps", "api", "src"),
    join(process.cwd(), "apps", "web", "app"),
    join(process.cwd(), "packages", "contracts", "src"),
    join(process.cwd(), "packages", "core", "src"),
    join(process.cwd(), "packages", "db", "src"),
    join(process.cwd(), "packages", "game-sdk", "src"),
  ];
  const fixtureBindings = activeSourceRoots
    .flatMap(sourceFilesBelow)
    .filter((file) => readFileSync(file, "utf8").includes("relay-protocol-probe"));
  assert.deepEqual(
    fixtureBindings,
    [],
    "the arbitrary ZIP must not require a platform source binding",
  );
});
