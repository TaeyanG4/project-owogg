import test from "node:test";
import assert from "node:assert/strict";
import {
  GAME_SESSION_POLICY,
  GameResultAcceptanceUseCases,
  parseGameCreatorManifest,
  signGameSession,
  type GameResultAcceptanceRepository,
  type RuntimeGame,
  type RuntimeGameAvailability,
  type RuntimeGameRegistry,
} from "../src/index.js";
import { runtimeGameFixture } from "./runtimeGameFixture.js";

const SECRET = "creator-result-test-secret";

function runtime(): RuntimeGame {
  const base = runtimeGameFixture("result-game");
  return {
    ...base,
    canonical: {
      ...base.canonical,
      creatorManifest: parseGameCreatorManifest({
        schemaVersion: 1,
        game: { slug: "result-game", title: "Result", genre: "test", mode: "single" },
        progression: { type: "none" },
        result: {
          score: {
            unit: "points",
            direction: "desc",
            range: { min: 0, max: 100, outOfRange: "clamp" },
          },
        },
        leaderboard: { enabled: true },
      }),
    },
  };
}

async function sessionToken(game: RuntimeGame, attemptId = crypto.randomUUID()) {
  return signGameSession(
    {
      userId: 7,
      gameId: game.identity.id,
      versionId: game.liveVersion.id,
      attemptId,
      exp: Math.floor(Date.now() / 1000) + GAME_SESSION_POLICY.EXPIRY_SECONDS,
      difficulty: "normal",
    },
    SECRET,
  );
}

function setup(game: RuntimeGame) {
  const consumed = new Set<string>();
  const repository: GameResultAcceptanceRepository = {
    async acceptResult(input) {
      if (consumed.has(input.attemptId)) {
        return { accepted: false, resultId: null, scoreId: null };
      }
      consumed.add(input.attemptId);
      return {
        accepted: true,
        resultId: 10,
        scoreId: input.result.rewardEligible ? 11 : null,
      };
    },
  };
  const registry: RuntimeGameRegistry = {
    findBySlug: async (slug) => (slug === game.identity.slug ? game : null),
    listPublic: async () => [game],
  };
  const availability = {
    isVersionServable: async () => true,
  } as unknown as RuntimeGameAvailability;
  return new GameResultAcceptanceUseCases(
    registry,
    availability,
    { getDisabledGameIds: async () => [] },
    repository,
  );
}

test("result acceptance validates canonical facts and consumes the signed attempt once", async () => {
  const game = runtime();
  const useCases = setup(game);
  const token = await sessionToken(game, "one-attempt");
  const input = {
    slug: game.identity.slug,
    userId: 7,
    nickname: "player",
    avatarUrl: null,
    token,
    secret: SECRET,
    difficulty: "normal",
    result: { score: 50 },
  };
  const accepted = await useCases.accept(input);
  assert.equal(accepted.ok, true);
  const replay = await useCases.accept(input);
  assert.deepEqual(replay, { ok: false, error: "ALREADY_CONSUMED" });
});

test("clamped score is accepted as adjusted but produces no leaderboard score id", async () => {
  const game = runtime();
  const accepted = await setup(game).accept({
    slug: game.identity.slug,
    userId: 7,
    nickname: "player",
    avatarUrl: null,
    token: await sessionToken(game),
    secret: SECRET,
    result: { score: 999 },
  });
  assert.equal(accepted.ok, true);
  if (accepted.ok) {
    assert.equal(accepted.normalized.adjusted, true);
    assert.equal(accepted.normalized.rewardEligible, false);
    assert.equal(accepted.scoreId, null);
  }
});
