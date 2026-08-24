import test from "node:test";
import assert from "node:assert/strict";
import {
  sourceArchiveObjectKey,
  publishedVersionPrefix,
  publishedObjectKey,
  publishedManifestObjectKey,
  normalizeBundleEntryPath,
  isDirectoryEntry,
  singleRootFolderPrefix,
  resolveBundleContentType,
  prepareBundleEntries,
  validateBundleEntryMetadata,
  SandboxBundleRejectionError,
  type PreparedBundleFile,
} from "../src/domain/sandboxGameBundle.js";
import {
  GameCreatorManifestValidationError,
  extractGameCreatorManifest,
  OWOGG_GAME_CREATOR_MANIFEST_FILENAME,
} from "../src/domain/gameCreatorManifest.js";
import { SANDBOX_GAME_POLICY } from "../src/domain/sandboxGames.js";

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

// ── key layout ───────────────────────────────────────────────────────────────

test("object keys are addressed by numeric ids, never by slug", () => {
  const source = sourceArchiveObjectKey(42, "a".repeat(64));
  const published = publishedObjectKey(42, 17, "Build/game.wasm");

  assert.equal(source, `uploads/42/${"a".repeat(64)}.zip`);
  assert.equal(published, "games/42/17/Build/game.wasm");
  assert.equal(publishedVersionPrefix(42, 17), "games/42/17/");
  assert.equal(publishedManifestObjectKey(42, 17), "games/42/17/.owogg-manifest.json");
});

test("each version owns a disjoint published prefix, which is what makes rollback free", () => {
  assert.notEqual(publishedVersionPrefix(42, 17), publishedVersionPrefix(42, 18));
  assert.ok(!publishedObjectKey(42, 18, "index.html").startsWith(publishedVersionPrefix(42, 17)));
});

// ── path normalization ───────────────────────────────────────────────────────

test("normalizeBundleEntryPath accepts ordinary nested paths and rewrites backslashes", () => {
  assert.equal(normalizeBundleEntryPath("index.html"), "index.html");
  assert.equal(normalizeBundleEntryPath("Build/game.wasm"), "Build/game.wasm");
  assert.equal(normalizeBundleEntryPath("Build\\game.data"), "Build/game.data");
});

test("normalizeBundleEntryPath rejects traversal, absolute, drive-letter and empty segments", () => {
  for (const bad of [
    "../secrets",
    "assets/../../etc/passwd",
    "/etc/hosts",
    "C:/Windows/system32",
    "assets//game.js",
    "./index.html",
    "",
  ]) {
    assert.equal(
      normalizeBundleEntryPath(bad),
      null,
      `expected rejection for ${JSON.stringify(bad)}`,
    );
  }
});

test("normalizeBundleEntryPath rejects paths deeper than the depth cap", () => {
  const withinCap = Array(SANDBOX_GAME_POLICY.MAX_BUNDLE_PATH_DEPTH).fill("a").join("/");
  const overCap = Array(SANDBOX_GAME_POLICY.MAX_BUNDLE_PATH_DEPTH + 1)
    .fill("a")
    .join("/");
  assert.equal(normalizeBundleEntryPath(withinCap), withinCap);
  assert.equal(normalizeBundleEntryPath(overCap), null);
});

test("directory entries are recognized as skippable rather than invalid", () => {
  assert.equal(isDirectoryEntry("Build/"), true);
  assert.equal(isDirectoryEntry("Build\\"), true);
  assert.equal(isDirectoryEntry("Build/game.wasm"), false);
});

// ── single root folder unwrap ────────────────────────────────────────────────

test("singleRootFolderPrefix unwraps only when every entry shares one top-level folder", () => {
  assert.equal(singleRootFolderPrefix(["MyGame/index.html", "MyGame/Build/g.wasm"]), "MyGame/");
  assert.equal(singleRootFolderPrefix(["index.html", "Build/g.wasm"]), null);
  assert.equal(singleRootFolderPrefix(["MyGame/index.html", "Other/x.js"]), null);
  // A root-level file alongside a folder means the archive is already rooted.
  assert.equal(singleRootFolderPrefix(["index.html", "MyGame/x.js"]), null);
  assert.equal(singleRootFolderPrefix([]), null);
});

// ── MIME ─────────────────────────────────────────────────────────────────────

test("resolveBundleContentType covers the types engine builds actually emit", () => {
  const cases: Array<[string, string]> = [
    ["index.html", "text/html; charset=utf-8"],
    ["game.js", "application/javascript; charset=utf-8"],
    ["game.mjs", "application/javascript; charset=utf-8"],
    ["style.css", "text/css; charset=utf-8"],
    ["build.wasm", "application/wasm"],
    ["meta.json", "application/json; charset=utf-8"],
    ["game.data", "application/octet-stream"],
    ["game.pck", "application/octet-stream"],
    ["logo.webp", "image/webp"],
    ["logo.png", "image/png"],
    ["photo.jpg", "image/jpeg"],
    ["photo.jpeg", "image/jpeg"],
    ["icon.svg", "image/svg+xml"],
    ["music.ogg", "audio/ogg"],
    ["sfx.mp3", "audio/mpeg"],
    ["sfx.wav", "audio/wav"],
    ["font.woff", "font/woff"],
    ["font.woff2", "font/woff2"],
  ];
  for (const [path, expected] of cases) {
    assert.equal(resolveBundleContentType(path).contentType, expected, path);
  }
});

test("resolveBundleContentType unwraps Unity's Brotli/gzip suffixes into a content encoding", () => {
  const br = resolveBundleContentType("Build/game.wasm.br");
  assert.equal(br.contentType, "application/wasm");
  assert.equal(br.contentEncoding, "br");

  const gz = resolveBundleContentType("Build/game.data.gz");
  assert.equal(gz.contentType, "application/octet-stream");
  assert.equal(gz.contentEncoding, "gzip");

  assert.equal(resolveBundleContentType("index.html").contentEncoding, undefined);
});

test("an unknown extension falls back to a byte stream rather than guessing", () => {
  assert.equal(resolveBundleContentType("weird.qqq").contentType, "application/octet-stream");
  assert.equal(resolveBundleContentType("LICENSE").contentType, "application/octet-stream");
});

// ── prepareBundleEntries ─────────────────────────────────────────────────────

test("prepareBundleEntries drops directory entries and keeps files", () => {
  const prepared = prepareBundleEntries({
    "Build/": new Uint8Array(),
    "index.html": bytes("<h1>hi</h1>"),
    "Build/game.wasm": bytes("\0asm"),
  });

  assert.equal(prepared.files.length, 2);
  assert.equal(prepared.entry, "index.html");
  assert.equal(prepared.totalSize, bytes("<h1>hi</h1>").byteLength + bytes("\0asm").byteLength);
});

test("prepareBundleEntries throws the matching rejection code for each unacceptable bundle", () => {
  const expectRejection = (entries: Record<string, Uint8Array>, code: string) => {
    assert.throws(
      () => prepareBundleEntries(entries),
      (err: unknown) => err instanceof SandboxBundleRejectionError && err.code === code,
    );
  };

  expectRejection({ "readme.txt": bytes("x") }, "BUNDLE_MISSING_ENTRY");
  expectRejection({ "index.html": bytes("x"), "../evil": bytes("x") }, "BUNDLE_INVALID_PATH");
  expectRejection(
    {
      "index.html": bytes("x"),
      "big.data": new Uint8Array(SANDBOX_GAME_POLICY.MAX_EXTRACTED_BUNDLE_BYTES + 1),
    },
    "BUNDLE_EXTRACTED_TOO_LARGE",
  );
});

test("prepareBundleEntries reports the file count, not a truncated bundle, when over the cap", () => {
  const entries: Record<string, Uint8Array> = { "index.html": bytes("x") };
  for (let i = 0; i <= SANDBOX_GAME_POLICY.MAX_BUNDLE_FILE_COUNT; i++) {
    entries[`a/${i}.txt`] = bytes("x");
  }
  assert.throws(
    () => prepareBundleEntries(entries),
    (err: unknown) =>
      err instanceof SandboxBundleRejectionError && err.code === "BUNDLE_TOO_MANY_FILES",
  );
});

test("prepareBundleEntries finds index.html after unwrapping a wrapping folder", () => {
  const prepared = prepareBundleEntries({
    "MyGame/index.html": bytes("<h1>hi</h1>"),
    "MyGame/Build/game.wasm": bytes("\0asm"),
  });

  assert.deepEqual(prepared.files.map((f) => f.path).sort(), ["Build/game.wasm", "index.html"]);
});

test("prepareBundleEntries rejects an archive with no files at all", () => {
  assert.throws(
    () => prepareBundleEntries({ "empty/": new Uint8Array() }),
    (err: unknown) =>
      err instanceof SandboxBundleRejectionError && err.code === "BUNDLE_MISSING_ENTRY",
  );
});

// ── validateBundleEntryMetadata (the zip-bomb preflight) ─────────────────────

/** Defaults compressedSize to declaredSize (a 1:1 ratio) so tests about path/count/total-size
 * don't accidentally also trip the compression-ratio guard, which has its own dedicated tests
 * below. */
function entry(path: string, declaredSize: number, compressedSize = declaredSize) {
  return { path, declaredSize, compressedSize };
}

test("validateBundleEntryMetadata accepts entries within every cap", () => {
  assert.doesNotThrow(() =>
    validateBundleEntryMetadata([entry("index.html", 100), entry("Build/game.wasm", 1000)]),
  );
});

test("validateBundleEntryMetadata skips directory entries entirely", () => {
  assert.doesNotThrow(() =>
    validateBundleEntryMetadata([entry("Build/", 0), entry("index.html", 100)]),
  );
});

test("validateBundleEntryMetadata rejects a declared total over the extracted cap without needing real bytes", () => {
  // compressedSize kept plausible (declared/100) so this exercises the flat total-size cap
  // specifically, not the separate compression-ratio guard below.
  const huge = SANDBOX_GAME_POLICY.MAX_EXTRACTED_BUNDLE_BYTES + 1;
  assert.throws(
    () =>
      validateBundleEntryMetadata([entry("index.html", 100), entry("huge.data", huge, huge / 100)]),
    (err: unknown) =>
      err instanceof SandboxBundleRejectionError && err.code === "BUNDLE_EXTRACTED_TOO_LARGE",
  );
});

test("validateBundleEntryMetadata sums declared sizes across entries, not just the largest one", () => {
  const perFile = Math.floor(SANDBOX_GAME_POLICY.MAX_EXTRACTED_BUNDLE_BYTES / 2) + 1;
  assert.throws(
    () =>
      validateBundleEntryMetadata([
        entry("a.data", perFile, perFile / 100),
        entry("b.data", perFile, perFile / 100),
      ]),
    (err: unknown) =>
      err instanceof SandboxBundleRejectionError && err.code === "BUNDLE_EXTRACTED_TOO_LARGE",
  );
});

test("validateBundleEntryMetadata clamps a negative declared size rather than letting it offset the total", () => {
  const huge = SANDBOX_GAME_POLICY.MAX_EXTRACTED_BUNDLE_BYTES + 1;
  assert.throws(
    () =>
      validateBundleEntryMetadata([
        entry("huge.data", huge, huge / 100),
        entry("decoy.data", -SANDBOX_GAME_POLICY.MAX_EXTRACTED_BUNDLE_BYTES),
      ]),
    (err: unknown) =>
      err instanceof SandboxBundleRejectionError && err.code === "BUNDLE_EXTRACTED_TOO_LARGE",
  );
});

test("validateBundleEntryMetadata rejects an over-cap file count from metadata alone", () => {
  const entries = Array.from({ length: SANDBOX_GAME_POLICY.MAX_BUNDLE_FILE_COUNT + 1 }, (_, i) =>
    entry(`file-${i}.txt`, 1),
  );
  assert.throws(
    () => validateBundleEntryMetadata(entries),
    (err: unknown) =>
      err instanceof SandboxBundleRejectionError && err.code === "BUNDLE_TOO_MANY_FILES",
  );
});

test("validateBundleEntryMetadata rejects a traversal path found in metadata alone", () => {
  assert.throws(
    () => validateBundleEntryMetadata([entry("index.html", 10), entry("../../etc/passwd", 10)]),
    (err: unknown) =>
      err instanceof SandboxBundleRejectionError && err.code === "BUNDLE_INVALID_PATH",
  );
});

// ── compression-ratio guard (memory safety even if declared size lies) ───────

test("validateBundleEntryMetadata rejects a ratio beyond what DEFLATE can plausibly produce, even under the flat total cap", () => {
  // 100 compressed bytes claiming to expand to just over the 1200:1 ceiling — tiny in absolute
  // terms (nowhere near MAX_EXTRACTED_BUNDLE_BYTES on its own), so only the ratio guard, not the
  // total-size cap, can be what's catching this.
  assert.throws(
    () => validateBundleEntryMetadata([entry("index.html", 10), entry("odd.data", 120_001, 100)]),
    (err: unknown) =>
      err instanceof SandboxBundleRejectionError && err.code === "BUNDLE_EXTRACTED_TOO_LARGE",
  );
});

test("validateBundleEntryMetadata accepts a well-compressed entry right up to the ratio ceiling", () => {
  assert.doesNotThrow(() =>
    validateBundleEntryMetadata([entry("index.html", 10), entry("texture.data", 120_000, 100)]),
  );
});

test("validateBundleEntryMetadata's ratio guard ignores a zero compressed size cleanly (no divide-by-zero throw)", () => {
  // A zero-length stored entry with a non-zero declared size is malformed in a different way, but
  // must not crash the validator with a division error — it should still be caught, just as an
  // implausible ratio (any positive declaredSize over a 0-byte compressed entry is infinite ratio).
  assert.throws(
    () => validateBundleEntryMetadata([entry("weird.data", 10, 0)]),
    (err: unknown) =>
      err instanceof SandboxBundleRejectionError && err.code === "BUNDLE_EXTRACTED_TOO_LARGE",
  );
});

// ── Game Creator Manifest ────────────────────────────────────────────────────

function preparedFile(path: string, contents: unknown): PreparedBundleFile {
  return {
    path,
    bytes: bytes(typeof contents === "string" ? contents : JSON.stringify(contents)),
    contentType: "application/octet-stream",
  };
}

test("extractGameCreatorManifest returns null when the file is simply absent", () => {
  assert.equal(extractGameCreatorManifest([preparedFile("index.html", "<html></html>")]), null);
});

test("extractGameCreatorManifest does not revive the removed owogg.game.json input", () => {
  assert.equal(
    extractGameCreatorManifest([
      preparedFile("owogg.game.json", {
        slug: "legacy-game",
        title: "Legacy Game",
        genre: "arcade",
        mode: "single",
      }),
    ]),
    null,
  );
});

test("extractGameCreatorManifest parses and normalizes a valid v1 manifest", () => {
  const manifest = extractGameCreatorManifest([
    preparedFile("index.html", "<html></html>"),
    preparedFile(OWOGG_GAME_CREATOR_MANIFEST_FILENAME, {
      schemaVersion: 1,
      game: { slug: "ball-dodge", title: "Ball Dodge", genre: "arcade", mode: "single" },
      progression: { type: "none" },
      result: { score: null },
    }),
  ]);
  assert.equal(manifest?.game.slug, "ball-dodge");
  assert.equal(manifest?.schemaVersion, 1);
});

test("extractGameCreatorManifest rejects invalid JSON", () => {
  assert.throws(
    () =>
      extractGameCreatorManifest([
        preparedFile(OWOGG_GAME_CREATOR_MANIFEST_FILENAME, "{ not json"),
      ]),
    (err: unknown) => err instanceof GameCreatorManifestValidationError,
  );
});

test("extractGameCreatorManifest rejects a JSON array or primitive", () => {
  for (const bad of [[1, 2, 3], "just a string", 42, null] as unknown[]) {
    assert.throws(
      () =>
        extractGameCreatorManifest([
          preparedFile(OWOGG_GAME_CREATOR_MANIFEST_FILENAME, JSON.stringify(bad)),
        ]),
      (err: unknown) => err instanceof GameCreatorManifestValidationError,
      `expected rejection for manifest body ${JSON.stringify(bad)}`,
    );
  }
});
