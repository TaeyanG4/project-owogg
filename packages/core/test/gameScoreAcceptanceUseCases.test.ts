import test from "node:test";
import assert from "node:assert/strict";
import {
  GAME_SESSION_POLICY,
  GameScoreAcceptanceUseCases,
  MultiplayerLegacyFlowGate,
  signGameSession,
  type GameScoreAcceptanceRepository,
  type MultiplayerProfileRecord,
  type MultiplayerProfileRepository,
  type RuntimeGame,
  type RuntimeGameAvailability,
  type RuntimeGameRegistry,
} from "../src/index.js";
import { runtimeGameFixture } from "./runtimeGameFixture.js";

const SECRET = "c2-focused-test-secret";

function runtimeGame(slug = "reaction-time"): RuntimeGame {
  return runtimeGameFixture(slug);
}

function createUseCases(
  runtime: RuntimeGame,
  findProfile: () => Promise<MultiplayerProfileRecord | null> = async () => null,
) {
  const consumed = new Set<string>();
  let nextScoreId = 100;
  let writes = 0;
  const repo: GameScoreAcceptanceRepository = {
    async acceptScore(input) {
      writes += 1;
      if (consumed.has(input.attemptId)) return { accepted: false, scoreId: null };
      consumed.add(input.attemptId);
      return { accepted: true, scoreId: nextScoreId++ };
    },
  };
  const registry: RuntimeGameRegistry = {
    async findBySlug(slug) {
      return slug === runtime.identity.slug ? runtime : null;
    },
    async listPublic() {
      return [runtime];
    },
  };
  const availability = {
    async isVersionServable(gameId: number, versionId: number) {
      return gameId === runtime.identity.id && versionId === runtime.liveVersion.id;
    },
  } as RuntimeGameAvailability;
  const settings = {
    async getDisabledGameIds() {
      return [];
    },
  };
  const gate = new MultiplayerLegacyFlowGate({
    findEnabledForExactVersion: findProfile,
  } as unknown as MultiplayerProfileRepository);
  return {
    useCases: new GameScoreAcceptanceUseCases(registry, availability, gate, settings, repo),
    writes: () => writes,
  };
}

async function token(runtime: RuntimeGame, difficulty = "normal") {
  return signGameSession(
    {
      userId: 7,
      gameId: runtime.identity.id,
      versionId: runtime.liveVersion.id,
      attemptId: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + GAME_SESSION_POLICY.EXPIRY_SECONDS,
      difficulty,
    },
    SECRET,
  );
}

test("generic acceptance resolves canonical policy and consumes a token once", async () => {
  const runtime = runtimeGame();
  const { useCases } = createUseCases(runtime);
  const signed = await token(runtime);

  const input = {
    slug: runtime.identity.slug,
    userId: 7,
    nickname: "player",
    avatarUrl: null,
    token: signed,
    secret: SECRET,
    score: 100,
    difficulty: "normal",
  };
  const accepted = await useCases.accept(input);
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;
  assert.equal(accepted.scoreId, 100);
  assert.equal(accepted.xpPerCompletion, runtime.canonical.policy.xpPerCompletion);

  const replay = await useCases.accept(input);
  assert.deepEqual(replay, { ok: false, error: "ALREADY_CONSUMED" });
});

test("difficulty is bound to the signed token and cannot be changed at acceptance", async () => {
  const runtime = runtimeGame("aim-test");
  const { useCases } = createUseCases(runtime);
  const signed = await token(runtime, "normal");

  const result = await useCases.accept({
    slug: runtime.identity.slug,
    userId: 7,
    nickname: "player",
    avatarUrl: null,
    token: signed,
    secret: SECRET,
    score: 100,
    difficulty: "hard",
  });
  assert.deepEqual(result, { ok: false, error: "CONTEXT_MISMATCH" });
});

test("enabled exact-version multiplayer authority blocks score normalization and token handling", async () => {
  const runtime = runtimeGame();
  const { useCases, writes } = createUseCases(
    runtime,
    async () =>
      ({
        profile: {
          gameId: runtime.identity.id,
          gameVersionId: runtime.liveVersion.id,
          enabled: true,
        },
      }) as MultiplayerProfileRecord,
  );

  const result = await useCases.accept({
    slug: runtime.identity.slug,
    userId: 7,
    nickname: "player",
    avatarUrl: null,
    token: "deliberately-invalid",
    secret: SECRET,
    score: 999_999,
  });
  assert.deepEqual(result, { ok: false, error: "MULTIPLAYER_MANAGED" });
  assert.equal(writes(), 0);
});

test("profile authority failure fails closed instead of reopening the client score path", async () => {
  const runtime = runtimeGame();
  const { useCases, writes } = createUseCases(runtime, async () => {
    throw new Error("D1 unavailable");
  });

  const result = await useCases.accept({
    slug: runtime.identity.slug,
    userId: 7,
    nickname: "player",
    avatarUrl: null,
    token: "deliberately-invalid",
    secret: SECRET,
    score: 1,
  });
  assert.deepEqual(result, { ok: false, error: "MULTIPLAYER_AUTHORITY_UNAVAILABLE" });
  assert.equal(writes(), 0);
});
