import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGameDescriptionRevision,
  patchGameCreatorManifestBasicMetadata,
  rebuildGameBundleArchive,
  serializeGameCreatorManifest,
} from "../src/application/gameBundleRevision.js";
import { parseGameCreatorManifest } from "../src/domain/gameCreatorManifest.js";
import { prepareBundleEntries } from "../src/domain/sandboxGameBundle.js";

const bytes = (value: string) => new TextEncoder().encode(value);

function manifest() {
  return parseGameCreatorManifest({
    schemaVersion: 1,
    game: {
      slug: "revision-test",
      title: "Old title",
      genre: "puzzle",
      mode: "single",
      playModes: ["single"],
      shortDescription: "old",
    },
    input: ["keyboard"],
    progression: { type: "none" },
    result: { score: null },
  });
}

test("basic metadata patch preserves non-editable manifest policy and cannot change slug", () => {
  const updated = patchGameCreatorManifestBasicMetadata(manifest(), {
    title: "New title",
    genre: "arcade",
    shortDescription: null,
    description: "new description",
  });

  assert.equal(updated.game.slug, "revision-test");
  assert.equal(updated.game.title, "New title");
  assert.equal(updated.game.genre, "arcade");
  assert.equal(updated.game.mode, "single");
  assert.deepEqual(updated.game.playModes, ["single"]);
  assert.equal(updated.game.shortDescription, undefined);
  assert.equal(updated.game.description, "new description");
  assert.deepEqual(updated.input, ["keyboard"]);
  assert.deepEqual(updated.result, { score: null });

  assert.throws(
    () => patchGameCreatorManifestBasicMetadata(manifest(), { mode: "multi" }),
    /requires local-multi or online-multi/,
  );
});

test("bundle rebuild replaces owogg.json and stale embedded logo with the current logo", () => {
  const prepared = prepareBundleEntries({
    "index.html": bytes("<html/>"),
    "owogg.json": serializeGameCreatorManifest(manifest()),
    "owogg.logo.png": bytes("old-logo"),
  });
  let captured: Readonly<Record<string, Uint8Array>> = {};
  const archive = rebuildGameBundleArchive({
    prepared,
    writer: {
      write(entries) {
        captured = entries;
        return bytes("zip").buffer as ArrayBuffer;
      },
    },
    manifestBytes: bytes('{"replacement":true}'),
    currentLogo: {
      path: "owogg.logo.webp",
      bytes: bytes("current-logo"),
      contentType: "image/webp",
    },
  });

  assert.equal(new TextDecoder().decode(archive), "zip");
  assert.equal("owogg.logo.png" in captured, false);
  assert.equal(new TextDecoder().decode(captured["owogg.logo.webp"]), "current-logo");
  assert.equal(new TextDecoder().decode(captured["owogg.json"]), '{"replacement":true}');
  assert.equal(new TextDecoder().decode(captured["index.html"]), "<html/>");
});

test("a description ZIP replaces the localized Markdown and image allowlists as one set", () => {
  const base = parseGameCreatorManifest({
    ...manifest(),
    game: {
      ...manifest().game,
      description: ["description.md", "description_kr.md"],
      description_images: ["old-guide.png"],
    },
  });
  const replacementFiles = [
    {
      path: "description_zh.md",
      bytes: bytes("Chinese"),
      contentType: "text/markdown; charset=utf-8",
    },
    {
      path: "description.md",
      bytes: bytes("English"),
      contentType: "text/markdown; charset=utf-8",
    },
    { path: "new-guide.webp", bytes: bytes("image"), contentType: "image/webp" },
  ];

  const revision = buildGameDescriptionRevision({
    manifest: base,
    packageFiles: replacementFiles,
    replaceAll: true,
  });
  assert.deepEqual(revision.manifest.game.description, ["description.md", "description_zh.md"]);
  assert.deepEqual(revision.manifest.game.description_images, ["new-guide.webp"]);
  assert.deepEqual(revision.removePaths, ["description.md", "description_kr.md", "old-guide.png"]);
});

test("description packages require English Markdown and reject every unrelated file", () => {
  assert.throws(
    () =>
      buildGameDescriptionRevision({
        manifest: manifest(),
        packageFiles: [
          {
            path: "description_kr.md",
            bytes: bytes("Korean only"),
            contentType: "text/markdown; charset=utf-8",
          },
        ],
        replaceAll: true,
      }),
    /description\.md is required/,
  );
  assert.throws(
    () =>
      buildGameDescriptionRevision({
        manifest: manifest(),
        packageFiles: [{ path: "notes.txt", bytes: bytes("no"), contentType: "text/plain" }],
        replaceAll: true,
      }),
    /unsupported file/,
  );
});
