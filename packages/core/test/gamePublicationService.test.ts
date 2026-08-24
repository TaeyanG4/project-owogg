import assert from "node:assert/strict";
import test from "node:test";
import {
  GamePublicationService,
  describePublicationFailure,
} from "../src/application/gamePublicationService.js";
import type { PreparedBundle } from "../src/domain/sandboxGameBundle.js";
import { buildBundleManifest } from "../src/domain/sandboxGameBundle.js";
import type {
  GamePublicationFacts,
  GamePublicationTarget,
  GameVersionPublicationRepository,
} from "../src/modules/game/ports/gameVersionPublicationRepository.js";
import type { GameBundleStorageRepository } from "../src/ports/sandboxGames.js";

const HASH_A = "a".repeat(64);
const TARGET: GamePublicationTarget = { gameId: 12, versionId: 34, contentHash: HASH_A };

const prepared: PreparedBundle = {
  entry: "index.html",
  totalSize: 15,
  files: [
    {
      path: "index.html",
      bytes: new TextEncoder().encode("<main></main>"),
      contentType: "text/html",
    },
    {
      path: "assets/game.js",
      bytes: new TextEncoder().encode("ok"),
      contentType: "application/javascript",
    },
  ],
};

function stateRepository(): GameVersionPublicationRepository & {
  states: string[];
  readyFacts: GamePublicationFacts | null;
  failure: string | null;
  failReadyOnce: boolean;
} {
  return {
    states: [],
    readyFacts: null,
    failure: null,
    failReadyOnce: false,
    async markPublishing(target) {
      assert.deepEqual(target, TARGET);
      this.states.push("PUBLISHING");
      this.readyFacts = null;
      this.failure = null;
    },
    async markReady(target, facts) {
      assert.deepEqual(target, TARGET);
      this.states.push("READY");
      if (this.failReadyOnce) {
        this.failReadyOnce = false;
        throw new Error("READY transition failed");
      }
      this.readyFacts = facts;
    },
    async markFailed(target, reason) {
      assert.deepEqual(target, TARGET);
      this.states.push("FAILED");
      this.failure = reason;
    },
    async markGarbageCollected(target, marker) {
      assert.deepEqual(target, TARGET);
      this.states.push("GARBAGE_COLLECTED");
      this.failure = marker;
    },
  };
}

function storage(): GameBundleStorageRepository & {
  objects: Map<string, Uint8Array>;
  writes: string[];
  failKey: string | null;
} {
  return {
    objects: new Map(),
    writes: [],
    failKey: null,
    async putObject(input) {
      this.writes.push(input.key);
      if (input.key === this.failKey) {
        throw new Error(`provider request failed: ${"x".repeat(300)}`);
      }
      const bytes = input.bytes instanceof Uint8Array ? input.bytes : new Uint8Array(input.bytes);
      this.objects.set(input.key, bytes);
    },
    async getObject(key) {
      const bytes = this.objects.get(key);
      return bytes
        ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
        : null;
    },
    async deleteObject(key) {
      this.objects.delete(key);
    },
  };
}

test("publishes numeric generic paths, writes manifest last, and records exact READY facts", async () => {
  const states = stateRepository();
  const objects = storage();
  const service = new GamePublicationService(states, objects);
  const facts = await service.publish({
    ...TARGET,
    prepared,
    publishedAt: "2026-08-21T00:00:00.000Z",
  });

  assert.deepEqual(objects.writes, [
    "games/12/34/index.html",
    "games/12/34/assets/game.js",
    "games/12/34/.owogg-manifest.json",
  ]);
  assert.deepEqual(states.states, ["PUBLISHING", "READY"]);
  assert.deepEqual(states.readyFacts, facts);
  assert.deepEqual(facts, {
    publishedAt: "2026-08-21T00:00:00.000Z",
    manifestKey: "games/12/34/.owogg-manifest.json",
    publishedSizeBytes: prepared.totalSize,
    fileCount: prepared.files.length,
  });

  const manifestBytes = objects.objects.get(facts.manifestKey);
  assert.ok(manifestBytes);
  const serializedManifest = new TextDecoder().decode(manifestBytes);
  assert.equal(
    serializedManifest,
    JSON.stringify(
      buildBundleManifest({
        ...TARGET,
        prepared,
        publishedAt: "2026-08-21T00:00:00.000Z",
      }),
    ),
  );
});

test("a mismatched publication target is rejected before any B2 file write", async () => {
  const states = stateRepository();
  const objects = storage();
  const service = new GamePublicationService(states, objects);

  await assert.rejects(
    () =>
      service.publish({
        ...TARGET,
        gameId: 99,
        prepared,
        publishedAt: "2026-08-21T00:00:00.000Z",
      }),
    /Expected values to be strictly deep-equal/,
  );
  assert.deepEqual(objects.writes, []);
  assert.deepEqual(states.states, []);
});

test("a file failure never writes a manifest or READY state and stores a bounded safe reason", async () => {
  const states = stateRepository();
  const objects = storage();
  objects.failKey = "games/12/34/assets/game.js";
  const service = new GamePublicationService(states, objects);

  await assert.rejects(() =>
    service.publish({
      ...TARGET,
      prepared,
      publishedAt: "2026-08-21T00:00:00.000Z",
    }),
  );
  assert.equal(objects.objects.has("games/12/34/.owogg-manifest.json"), false);
  assert.deepEqual(states.states, ["PUBLISHING", "FAILED"]);
  assert.equal(states.failure, "bundle publication failed (Error)");
  assert.equal(states.failure?.includes("provider request"), false);
});

test("a manifest failure remains non-READY and retry converges on the same numeric version", async () => {
  const states = stateRepository();
  const objects = storage();
  const manifestKey = "games/12/34/.owogg-manifest.json";
  objects.failKey = manifestKey;
  const service = new GamePublicationService(states, objects);
  const input = {
    ...TARGET,
    prepared,
    publishedAt: "2026-08-21T00:00:00.000Z",
  };

  await assert.rejects(() => service.publish(input));
  assert.deepEqual(states.states, ["PUBLISHING", "FAILED"]);

  objects.failKey = null;
  const facts = await service.publish(input);
  assert.equal(facts.manifestKey, manifestKey);
  assert.deepEqual(states.states, ["PUBLISHING", "FAILED", "PUBLISHING", "READY"]);
  assert.ok(objects.objects.has(manifestKey));
});

test("a READY transition failure is reported and retry remains on the same numeric version", async () => {
  const states = stateRepository();
  const objects = storage();
  states.failReadyOnce = true;
  const service = new GamePublicationService(states, objects);
  const input = {
    ...TARGET,
    prepared,
    publishedAt: "2026-08-21T00:00:00.000Z",
  };

  await assert.rejects(() => service.publish(input), /READY transition failed/);
  assert.deepEqual(states.states, ["PUBLISHING", "READY", "FAILED"]);

  await service.publish(input);
  assert.deepEqual(states.states, ["PUBLISHING", "READY", "FAILED", "PUBLISHING", "READY"]);
});

test("readManifest accepts only the strict existing bundle-manifest contract", async () => {
  const states = stateRepository();
  const objects = storage();
  const service = new GamePublicationService(states, objects);
  const manifestKey = "games/12/34/.owogg-manifest.json";
  const valid = buildBundleManifest({
    ...TARGET,
    prepared,
    publishedAt: "2026-08-21T00:00:00.000Z",
  });

  const store = (value: unknown) => {
    objects.objects.set(manifestKey, new TextEncoder().encode(JSON.stringify(value)));
  };

  store(valid);
  assert.deepEqual(await service.readManifest(manifestKey), JSON.parse(JSON.stringify(valid)));

  for (const malformed of [
    { ...valid, contentHash: "not-a-sha256" },
    { ...valid, fileCount: valid.fileCount + 1 },
    { ...valid, totalSize: valid.totalSize + 1 },
    { ...valid, publishedAt: "not-a-timestamp" },
    { ...valid, entry: "../index.html" },
    { ...valid, files: [{ ...valid.files[0], path: "../escape.js" }, valid.files[1]] },
    { ...valid, files: "not-an-array" },
  ]) {
    store(malformed);
    assert.equal(await service.readManifest(manifestKey), null);
  }
});

test("failure normalization never exposes arbitrary non-Error text", () => {
  assert.equal(
    describePublicationFailure("secret value"),
    "bundle publication failed (unknown error)",
  );
});
