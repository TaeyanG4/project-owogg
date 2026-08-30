import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { unzipSync } from "fflate";
import {
  findGameLogoFile,
  prepareBundleEntries,
  validateBundleEntryMetadata,
} from "../packages/core/src/domain/sandboxGameBundle.js";
import { extractGameCreatorManifest } from "../packages/core/src/domain/gameCreatorManifest.js";

const fixtureDirectory = join(process.cwd(), "examples", "relay-protocol-probe");
const fixtureFiles = [
  "index.html",
  "style.css",
  "load-protocol.js",
  "game.js",
  "owogg.json",
  "owogg.logo.svg",
];
const expectedZipSha256 = "dfd02698c262aeb107e4492ed0e73e5a6424b7e20a9a947c45d0e13037135661";

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
  const loadProtocolJs = readFileSync(join(fixtureDirectory, "load-protocol.js"), "utf8");
  for (const required of [
    "relay.ready",
    "relay.broadcast",
    "relay.direct",
    "relay.snapshot",
    "relay.leave",
    "loadProtocol.parseLoadMessage",
    "loadProtocol.buildLoadSample",
    "loadProtocol.summarizeLatencies",
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
    assert.equal(gameJs.includes(forbidden), false, `game.js: ${forbidden}`);
    assert.equal(loadProtocolJs.includes(forbidden), false, `load-protocol.js: ${forbidden}`);
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

test("Relay Protocol Probe load protocol strictly parses messages and pads exact bytes", () => {
  interface LoadProtocolApi {
    readonly LOAD_PROTOCOL: string;
    readonly IDLE_DURATION_MS: number;
    readonly parseLoadMessage: (value: unknown) => unknown;
    readonly buildLoadSample: (
      runId: string,
      sampleSeq: number,
      sentAt: number,
      targetBytes: number,
    ) => unknown;
    readonly expectedSamples: (rateHz: number, durationMs: number) => number | null;
    readonly summarizeLatencies: (values: readonly number[]) => unknown;
  }

  const context: {
    window: { RelayProbeLoadProtocol?: LoadProtocolApi };
    TextEncoder: typeof TextEncoder;
  } = { window: {}, TextEncoder };
  runInNewContext(readFileSync(join(fixtureDirectory, "load-protocol.js"), "utf8"), context);
  const api = context.window.RelayProbeLoadProtocol;
  assert.ok(api);
  assert.equal(api.LOAD_PROTOCOL, "relay-probe/load-v1");
  assert.equal(api.IDLE_DURATION_MS, 60_000);

  const plan = {
    protocol: api.LOAD_PROTOCOL,
    type: "load-plan",
    runId: "load-test-123456",
    rateHz: 20,
    durationMs: 300_000,
    payloadBytes: 256,
  };
  assert.deepEqual(JSON.parse(JSON.stringify(api.parseLoadMessage(plan))), plan);
  assert.equal(api.parseLoadMessage({ ...plan, rateHz: 2 }), null);
  assert.equal(api.parseLoadMessage({ ...plan, extra: true }), null);
  assert.equal(api.expectedSamples(20, 300_000), 6_000);
  assert.equal(api.expectedSamples(2, 300_000), null);

  for (const targetBytes of [256, 3_072]) {
    const sample = api.buildLoadSample("load-test-123456", 7, 1_800_000_000_000, targetBytes);
    assert.ok(sample);
    assert.equal(new TextEncoder().encode(JSON.stringify(sample)).byteLength, targetBytes);
    assert.notEqual(api.parseLoadMessage(sample), null);
  }

  assert.deepEqual(JSON.parse(JSON.stringify(api.summarizeLatencies([50, 10, 40, 20, 30]))), {
    count: 5,
    min: 10,
    p50: 30,
    p95: 50,
    p99: 50,
    max: 50,
  });
});
