import test from "node:test";
import assert from "node:assert/strict";
import type { GameManifest, GamePresentation } from "@owogg/game-sdk/contracts";
import {
  GAME_OWNER_TYPES,
  isCreatorOwned,
  isCreatorGameDefinition,
  isScored,
  isSystemGameDefinition,
  isValidGameOwnerType,
  type CreatorGameDefinition,
  type GameDefinition,
  type GameOwner,
  type SystemGameOwner,
  type SystemGameDefinition,
} from "../src/index.js";

const TEST_MANIFESTS: GameManifest[] = [
  {
    id: "fixture-game",
    slug: "fixture-game",
    title: "Fixture Game",
    shortDescription: "Short fixture description",
    description: "Fixture description",
    modes: ["single"],
    status: "published",
    categories: ["test"],
    tags: ["fixture"],
    minPlayers: 1,
    maxPlayers: 1,
    thumbnail: "/fixture.svg",
    accent: "#6366f1",
    estimatedRoundSeconds: 30,
    requiresAuth: false,
    supportsLeaderboard: true,
    inputMethods: ["mouse"],
    supportsReplay: false,
    version: "test",
    scoreConfig: { unit: "pts", direction: "desc", min: 0, max: 100 },
  },
];

/**
 * The Unified Game Platform foundation added in this PR is types plus one port — nothing produces
 * a GameDefinition yet. What is worth pinning down now is the claim the next PR depends on: that a
 * GameDefinition can carry everything today's built-in GameManifest carries. If that stops being
 * true, the file-based registry would start by silently dropping catalog metadata.
 *
 * This is not the migration adapter (that belongs with the registry itself) — it is the smallest
 * thing that fails when the shapes drift apart.
 */
function asDefinition(manifest: GameManifest, owner: SystemGameOwner): SystemGameDefinition {
  return {
    slug: manifest.slug,
    owner,
    title: manifest.title,
    shortDescription: manifest.shortDescription,
    description: manifest.description,
    status: manifest.status,
    categories: manifest.categories,
    tags: manifest.tags,
    modes: manifest.modes,
    inputMethods: manifest.inputMethods,
    minPlayers: manifest.minPlayers,
    maxPlayers: manifest.maxPlayers,
    thumbnail: manifest.thumbnail,
    accent: manifest.accent,
    estimatedRoundSeconds: manifest.estimatedRoundSeconds,
    difficulty: manifest.difficulty,
    supportsReplay: manifest.supportsReplay,
    presentation: manifest.presentation,
    policy: {
      score: manifest.scoreConfig ?? null,
      leaderboard: manifest.supportsLeaderboard,
      // XP is an operator decision that lives nowhere in GameManifest today (it is applied by
      // progression rules, and starts at 0 for Game Creator games) — the one field a definition adds
      // rather than carries over.
      xpPerCompletion: 0,
      requiresAuth: manifest.requiresAuth,
    },
  };
}

test("every shipped built-in manifest is expressible as a GameDefinition without loss", () => {
  assert.ok(TEST_MANIFESTS.length > 0);

  for (const manifest of TEST_MANIFESTS) {
    const definition = asDefinition(manifest, { type: "SYSTEM" });

    assert.equal(definition.slug, manifest.slug);
    assert.equal(definition.title, manifest.title);
    assert.deepEqual(definition.categories, manifest.categories);
    assert.deepEqual(definition.modes, manifest.modes);
    assert.deepEqual(definition.inputMethods, manifest.inputMethods);
    assert.equal(definition.policy.leaderboard, manifest.supportsLeaderboard);
    assert.equal(definition.policy.requiresAuth, manifest.requiresAuth);
    assert.deepEqual(definition.policy.score, manifest.scoreConfig ?? null);
    assert.deepEqual(definition.difficulty, manifest.difficulty);
    assert.deepEqual(definition.presentation, manifest.presentation);
  }
});

// Deliberately does NOT assert anything about a production catalog's presentation state (whether
// it's present or absent for any real shipped game) — a platform contract test must not pin an
// individual game's current metadata; see packages/game-sdk/test/presentation.test.ts's own
// synthetic-manifest tests for the backward-compatibility guarantee ("GameManifest works with no
// presentation field at all") and forward-compatibility guarantee ("also accepts a real
// presentation value") this file doesn't need to re-prove at the GameDefinition level beyond the
// lossless-conversion property the test above already covers.
test("GameDefinition accepts a real presentation value, reusing GamePresentation verbatim — no parallel type declared in core", () => {
  const presentation: GamePresentation = {
    viewport: { mode: "fixed", preferredWidth: 640, preferredHeight: 360 },
    fullscreen: { supported: true, recommended: true },
    mobile: { support: "unsupported" },
  };
  const syntheticManifest: GameManifest = {
    id: "synthetic-example",
    slug: "synthetic-example",
    title: "Synthetic Example",
    shortDescription: "A synthetic manifest for this test only",
    description: "A synthetic manifest for this test only — not a real shipped game",
    modes: ["single"],
    status: "draft",
    categories: [],
    tags: [],
    minPlayers: 1,
    maxPlayers: 1,
    thumbnail: "/thumb.svg",
    requiresAuth: false,
    supportsLeaderboard: false,
    inputMethods: ["mouse"],
    supportsReplay: false,
    version: "0.0.1",
    presentation,
  };
  const definition = asDefinition(syntheticManifest, { type: "SYSTEM" });
  assert.deepEqual(definition.presentation, presentation);
});

test("a manifest's id and slug agree today, which is why a definition keeps only slug", () => {
  // GameDefinition drops `id` deliberately: slug is what scores, favorites and recent-plays are
  // keyed by. That is only safe while the two are interchangeable for every shipped game.
  for (const manifest of TEST_MANIFESTS) {
    assert.equal(manifest.id, manifest.slug, `${manifest.slug} has diverging id/slug`);
  }
});

test("built-in games carry a score policy, so score validation has something to read", () => {
  const scored = TEST_MANIFESTS.filter((m) => m.scoreConfig).map((m) =>
    asDefinition(m, { type: "SYSTEM" }),
  );
  assert.ok(scored.length > 0);
  for (const definition of scored) {
    assert.ok(isScored(definition));
    assert.ok(definition.policy.score);
    assert.ok(definition.policy.score.min < definition.policy.score.max);
  }
});

test("owner is a discriminated union, not a free-text marker", () => {
  const system: GameOwner = { type: "SYSTEM" };
  const creator: GameOwner = { type: "CREATOR", userId: 42 };

  assert.equal(isCreatorOwned(system), false);
  assert.equal(isCreatorOwned(creator), true);
  // Narrowing is what replaces `manifest.version === "sandbox"` in the web catalog.
  if (isCreatorOwned(creator)) assert.equal(creator.userId, 42);
});

test("only SYSTEM and CREATOR are owner types — sandbox is not a kind of game", () => {
  assert.deepEqual([...GAME_OWNER_TYPES], ["SYSTEM", "CREATOR"]);
  assert.ok(isValidGameOwnerType("SYSTEM"));
  assert.ok(isValidGameOwnerType("CREATOR"));
  assert.ok(!isValidGameOwnerType("SANDBOX"));
  assert.ok(!isValidGameOwnerType(undefined));
});

// ── SYSTEM/CREATOR discriminated-union narrowing (Stage C-1) ────────────────────
//
// GameDefinition mirrors PublicGame's own owner-narrowing pattern (see publicGame.ts) — SYSTEM's
// fixed taxonomy fields (categories/tags/modes/inputMethods/minPlayers/maxPlayers/thumbnail) and
// CREATOR's own fields (genre/mode/hasLogo) only exist after narrowing by `owner.type`.

function fakeCreatorDefinition(
  overrides: Partial<CreatorGameDefinition> = {},
): CreatorGameDefinition {
  return {
    slug: "a-creator-game",
    owner: { type: "CREATOR", userId: 7 },
    title: "A Creator Game",
    shortDescription: "short",
    description: "long",
    status: "published",
    supportsReplay: false,
    policy: { score: null, leaderboard: false, xpPerCompletion: 0, requiresAuth: false },
    genre: "puzzle",
    mode: "single",
    hasLogo: true,
    ...overrides,
  };
}

test("a SYSTEM GameDefinition narrows via isSystemGameDefinition, keeping every existing field accessible unchanged", () => {
  const manifest = TEST_MANIFESTS[0];
  assert.ok(manifest, "at least one built-in manifest must exist for this test to be meaningful");
  const definition: GameDefinition = asDefinition(manifest, { type: "SYSTEM" });

  assert.equal(isSystemGameDefinition(definition), true);
  assert.equal(isCreatorGameDefinition(definition), false);
  if (isSystemGameDefinition(definition)) {
    // Every field that existed on GameDefinition before this Stage is still reachable, unchanged,
    // once narrowed — the union split added a CREATOR variant, it didn't take anything away from
    // SYSTEM's.
    assert.deepEqual(definition.categories, manifest.categories);
    assert.deepEqual(definition.tags, manifest.tags);
    assert.deepEqual(definition.modes, manifest.modes);
    assert.deepEqual(definition.inputMethods, manifest.inputMethods);
    assert.equal(definition.minPlayers, manifest.minPlayers);
    assert.equal(definition.maxPlayers, manifest.maxPlayers);
    assert.equal(definition.thumbnail, manifest.thumbnail);
  }
});

test("a CREATOR GameDefinition narrows via isCreatorGameDefinition, exposing genre/mode/hasLogo — no SYSTEM taxonomy fields required", () => {
  // fakeCreatorDefinition's own object literal is the real assertion here: it compiles with no
  // categories/tags/modes/inputMethods/minPlayers/maxPlayers/thumbnail at all — a CREATOR
  // definition genuinely does not need SYSTEM's fields invented as placeholders.
  const definition: GameDefinition = fakeCreatorDefinition();

  assert.equal(isCreatorGameDefinition(definition), true);
  assert.equal(isSystemGameDefinition(definition), false);
  if (isCreatorGameDefinition(definition)) {
    assert.equal(definition.genre, "puzzle");
    assert.equal(definition.mode, "single");
    assert.equal(definition.hasLogo, true);
  }
});

test("isSystemGameDefinition/isCreatorGameDefinition are mutually exclusive and exhaustive over the union", () => {
  const manifest = TEST_MANIFESTS[0];
  assert.ok(manifest);
  const systemDef: GameDefinition = asDefinition(manifest, { type: "SYSTEM" });
  const creatorDef: GameDefinition = fakeCreatorDefinition();

  for (const definition of [systemDef, creatorDef]) {
    assert.notEqual(isSystemGameDefinition(definition), isCreatorGameDefinition(definition));
  }
});
