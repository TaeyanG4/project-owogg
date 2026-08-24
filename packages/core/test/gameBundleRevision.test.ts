import assert from "node:assert/strict";
import test from "node:test";
import {
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
    mode: "multi",
    shortDescription: null,
    description: "new description",
  });

  assert.equal(updated.game.slug, "revision-test");
  assert.equal(updated.game.title, "New title");
  assert.equal(updated.game.genre, "arcade");
  assert.equal(updated.game.mode, "multi");
  assert.equal(updated.game.shortDescription, undefined);
  assert.equal(updated.game.description, "new description");
  assert.deepEqual(updated.input, ["keyboard"]);
  assert.deepEqual(updated.result, { score: null });
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
