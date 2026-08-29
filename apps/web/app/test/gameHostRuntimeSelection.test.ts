import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPublicPlayConfigDescriptor,
  resolveGameRuntimeUrl,
  buildGameResultFromBridgeComplete,
  isPotentialOnlineMultiplayerGame,
  resolvedGamePlayMode,
  resolvedGenericGamePlayMode,
  shouldRenderManagedMultiplayer,
  shouldStartGenericGameSession,
  shouldRemountIframeOnDifficultyChange,
} from "../features/game/GameHost";
import type { PublicGame } from "@owogg/contracts";
import { API_URL } from "../lib/api/config";

/**
 * The pure decisions around GameHost's generic official iframe runtime: which provider-neutral
 * URL a slug uses, how a Game Bridge GAME_COMPLETE payload becomes the GameResult runtime.complete
 * already knows how to handle, and when a difficulty-selector change must force the iframe game
 * to remount (see aim-test's own difficulty tiers). Extracted the same way
 * formatMetadataKey/Value were (see gameHostMetadata.test.ts) — this suite has no DOM renderer, so
 * this is the part of the new runtime-selection logic that's actually testable without one.
 */

test("every publisher uses the generic /play resolver", () => {
  for (const slug of ["reaction-time", "aim-test", "memory-test", "typing-test", "ball-dodge"]) {
    assert.equal(resolveGameRuntimeUrl(slug), `${API_URL}/play/${slug}`, slug);
  }
});

test("only the exact public online-multi capability probes the server profile", () => {
  const withModes = (playModes: PublicGame["playModes"]) => ({ playModes }) as PublicGame;
  assert.equal(isPotentialOnlineMultiplayerGame(withModes(["online-multi"])), true);
  assert.equal(isPotentialOnlineMultiplayerGame(withModes(["local-multi"])), false);
  assert.equal(isPotentialOnlineMultiplayerGame(withModes(["local-multi", "online-multi"])), true);
  assert.equal(isPotentialOnlineMultiplayerGame(withModes(["single"])), false);
  assert.equal(isPotentialOnlineMultiplayerGame(null), false);
});

test("hybrid runtime stays in the game iframe until an approved topology is selected", () => {
  const hybrid = {
    slug: "relay-board",
    playModes: ["local-multi", "online-multi"],
  } as unknown as PublicGame;

  assert.equal(resolvedGamePlayMode(hybrid, null), null);
  assert.equal(resolvedGenericGamePlayMode(hybrid, null), null);
  assert.equal(shouldRenderManagedMultiplayer(hybrid, null), false);
  assert.equal(resolvedGamePlayMode(hybrid, "local-multi"), "local-multi");
  assert.equal(resolvedGenericGamePlayMode(hybrid, "local-multi"), "local-multi");
  assert.equal(shouldRenderManagedMultiplayer(hybrid, "local-multi"), false);
  assert.equal(resolvedGamePlayMode(hybrid, "online-multi"), "online-multi");
  assert.equal(resolvedGenericGamePlayMode(hybrid, "online-multi"), null);
  assert.equal(shouldRenderManagedMultiplayer(hybrid, "online-multi"), true);
});

test("singleton topology resolves without a redundant in-game selection request", () => {
  const local = { playModes: ["local-multi"] } as unknown as PublicGame;
  const online = { playModes: ["online-multi"] } as unknown as PublicGame;
  assert.equal(resolvedGamePlayMode(local, null), "local-multi");
  assert.equal(resolvedGenericGamePlayMode(local, null), "local-multi");
  assert.equal(shouldRenderManagedMultiplayer(local, null), false);
  assert.equal(resolvedGamePlayMode(online, null), "online-multi");
  assert.equal(shouldRenderManagedMultiplayer(online, null), true);
});

test("generic score sessions wait for multiplayer discovery and stay disabled for online authority", () => {
  const onlineGame = {
    slug: "relay-board",
    playModes: ["online-multi"],
    catalog: {
      type: "TAXONOMY",
      categories: [],
      tags: [],
      modes: ["online-multi"],
      inputMethods: [],
      minPlayers: 2,
      maxPlayers: 2,
      thumbnail: "/relay-board.svg",
    },
  } as unknown as PublicGame;

  assert.equal(shouldStartGenericGameSession(null, null), false);
  assert.equal(shouldStartGenericGameSession(onlineGame, null), false);
  assert.equal(
    shouldStartGenericGameSession(onlineGame, {
      gameSlug: "relay-board",
      mode: "ONLINE",
    }),
    false,
  );
  assert.equal(
    shouldStartGenericGameSession(onlineGame, {
      gameSlug: "different-game",
      mode: "GENERIC",
    }),
    false,
  );
  assert.equal(
    shouldStartGenericGameSession(onlineGame, {
      gameSlug: "relay-board",
      mode: "GENERIC",
    }),
    true,
  );
});

test("non-multiplayer games start the generic score session without discovery", () => {
  const soloGame = {
    slug: "reaction-time",
    playModes: ["single"],
    catalog: {
      type: "GENRE_MODE",
      genre: "casual",
      mode: "single",
    },
  } as unknown as PublicGame;
  assert.equal(shouldStartGenericGameSession(soloGame, null), true);
});

test("PlayConfig games never prefetch a client-facts generic session", () => {
  const playConfigGame = {
    slug: "verified-aim-test",
    playModes: ["single"],
    playConfig: {
      version: 1,
      rulesetRevision: 7,
      defaultVariantId: "standard",
      variants: [{ id: "standard", label: "Standard" }],
      allowedConfigs: [{ difficultyId: "normal", variantId: "standard", rewardFactor: 1 }],
    },
  } as unknown as PublicGame;
  assert.equal(shouldStartGenericGameSession(playConfigGame, null), false);
});

test("buildPublicPlayConfigDescriptor supplies approved difficulty/variant pairs without verifier identity", () => {
  const game = {
    difficulty: {
      levels: [
        { id: "normal", label: "Normal" },
        { id: "hard", label: "Hard" },
      ],
      defaultLevelId: "normal",
    },
    playConfig: {
      version: 1,
      rulesetRevision: 7,
      defaultVariantId: "standard",
      variants: [{ id: "standard", label: "Standard" }],
      allowedConfigs: [
        { difficultyId: "normal", variantId: "standard", rewardFactor: 1 },
        { difficultyId: "hard", variantId: "standard", rewardFactor: 1.25 },
      ],
    },
  } as unknown as PublicGame;
  const descriptor = buildPublicPlayConfigDescriptor(game);
  assert.deepEqual(descriptor, {
    defaultDifficultyId: "normal",
    defaultVariantId: "standard",
    difficulties: [
      { id: "normal", label: "Normal" },
      { id: "hard", label: "Hard" },
    ],
    variants: [{ id: "standard", label: "Standard" }],
    allowedConfigs: [
      { difficultyId: "normal", variantId: "standard", rewardFactor: 1 },
      { difficultyId: "hard", variantId: "standard", rewardFactor: 1.25 },
    ],
  });
  assert.equal("verifierId" in (descriptor ?? {}), false);
});

// ── shouldRemountIframeOnDifficultyChange ────────────────────────────────────

test("shouldRemountIframeOnDifficultyChange: never fires for a game with no difficulty tiers", () => {
  assert.equal(
    shouldRemountIframeOnDifficultyChange("normal", "hard", {
      hasDifficultyTiers: false,
    }),
    false,
  );
});

test("shouldRemountIframeOnDifficultyChange: never fires on the very first render for a slug (no prior attempt tracked yet)", () => {
  assert.equal(
    shouldRemountIframeOnDifficultyChange(undefined, "normal", {
      hasDifficultyTiers: true,
    }),
    false,
  );
});

test("shouldRemountIframeOnDifficultyChange: does not fire when the difficulty is unchanged", () => {
  assert.equal(
    shouldRemountIframeOnDifficultyChange("normal", "normal", {
      hasDifficultyTiers: true,
    }),
    false,
  );
});

test("shouldRemountIframeOnDifficultyChange: fires when a game with difficulty tiers changes tier", () => {
  assert.equal(
    shouldRemountIframeOnDifficultyChange("normal", "hard", {
      hasDifficultyTiers: true,
    }),
    true,
  );
  assert.equal(
    shouldRemountIframeOnDifficultyChange("hard", "normal", {
      hasDifficultyTiers: true,
    }),
    true,
  );
});

test("buildGameResultFromBridgeComplete: forwards score and metadata unchanged, preserving reaction-time's rounds+tier semantics", () => {
  const rounds = [210, 198, 205, 190, 187];
  const result = buildGameResultFromBridgeComplete(
    { score: 198, metadata: { rounds, tier: "lightning" } },
    { slug: "reaction-time", sessionId: "session-1" },
  );
  assert.ok(result);
  assert.equal(result.gameId, "reaction-time");
  assert.equal(result.sessionId, "session-1");
  assert.equal(result.score, 198);
  assert.deepEqual(result.metadata, { rounds, tier: "lightning" });
});

test("buildGameResultFromBridgeComplete forwards an unscored outcome completion", () => {
  const result = buildGameResultFromBridgeComplete(
    { outcome: "success", progression: { value: 2 }, metrics: { clears: 1 } },
    { slug: "x", sessionId: "y" },
  );
  assert.equal(result.score, undefined);
  assert.equal(result.outcome, "success");
  assert.deepEqual(result.progression, { value: 2 });
  assert.deepEqual(result.metrics, { clears: 1 });
});

test("buildGameResultFromBridgeComplete: metadata is omitted entirely (not set to undefined) when the bridge sent none", () => {
  const result = buildGameResultFromBridgeComplete(
    { score: 42 },
    { slug: "reaction-time", sessionId: "session-2" },
  );
  assert.ok(result);
  assert.equal("metadata" in result, false);
});
