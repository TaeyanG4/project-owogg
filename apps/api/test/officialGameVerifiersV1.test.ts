import assert from "node:assert/strict";
import test from "node:test";
import type { GameVerifier, GameVerifierInput } from "@owogg/core";
import {
  AIM_TEST_RULESET_REVISION,
  AIM_TEST_SLUG,
  AIM_TEST_TIMING,
  aimTestV1,
  createAimTestTargets,
} from "../src/infrastructure/games/verifiers/AimTestV1.js";
import {
  MEMORY_TEST_MIN_INPUT_INTERVAL_MS,
  MEMORY_TEST_RULESET_REVISION,
  MEMORY_TEST_SLUG,
  createMemoryTestChallenge,
  memoryTestDisplayDurationMs,
  memoryTestExpectedForLevel,
  memoryTestV1,
} from "../src/infrastructure/games/verifiers/MemoryTestV1.js";
import {
  REACTION_TIME_BREAK_MS,
  REACTION_TIME_RULESET_REVISION,
  REACTION_TIME_SLUG,
  createReactionTimeWaits,
  reactionTimeV1,
} from "../src/infrastructure/games/verifiers/ReactionTimeV1.js";
import {
  TYPING_TEST_RULESET_REVISION,
  TYPING_TEST_SLUG,
  createTypingTestChallenge,
  typingTestV1,
} from "../src/infrastructure/games/verifiers/TypingTestV1.js";

const CHALLENGE_SEED = "phase-seven-seed-000000000001";

function input(
  slug: string,
  rulesetRevision: number,
  playConfig: GameVerifierInput["playConfig"],
  evidence: unknown,
  overrides: Partial<GameVerifierInput> = {},
): GameVerifierInput {
  const completedAtMs =
    typeof evidence === "object" &&
    evidence !== null &&
    "completedAtMs" in evidence &&
    typeof evidence.completedAtMs === "number"
      ? evidence.completedAtMs
      : 1_000;
  return {
    gameId: 10,
    versionId: 20,
    slug,
    challengeSeed: CHALLENGE_SEED,
    playConfig,
    rulesetRevision,
    issuedAtMs: 1_000_000,
    submittedAtMs: 1_000_000 + completedAtMs + 250,
    serverElapsedMs: completedAtMs + 250,
    evidence,
    ...overrides,
  };
}

async function code(
  verifier: GameVerifier,
  verifierInput: GameVerifierInput,
): Promise<string | null> {
  const result = await verifier.verify(verifierInput);
  return result.accepted ? null : result.code;
}

test("reaction-time verifier derives average reaction from a deterministic schedule", async () => {
  const waits = createReactionTimeWaits({
    challengeSeed: CHALLENGE_SEED,
    difficultyId: "hard",
    variantId: "focus",
  });
  let previousClickedAt = 0;
  const rounds = waits.map((wait, index) => {
    const cueAtMs = (index === 0 ? 0 : previousClickedAt + REACTION_TIME_BREAK_MS) + wait;
    const clickedAtMs = cueAtMs + 180;
    previousClickedAt = clickedAtMs;
    return { seq: index + 1, cueAtMs, clickedAtMs };
  });
  const evidence = { version: 1, completedAtMs: previousClickedAt, rounds };
  const verifierInput = input(
    REACTION_TIME_SLUG,
    REACTION_TIME_RULESET_REVISION,
    { difficultyId: "hard", variantId: "focus" },
    evidence,
  );
  assert.deepEqual(await reactionTimeV1.verify(verifierInput), {
    accepted: true,
    facts: {
      outcome: "success",
      score: 180,
      progression: { value: 7 },
      metrics: { rounds: 7 },
      events: { round_completed: 7, completed: 1 },
    },
  });
  assert.equal(
    await code(
      reactionTimeV1,
      input(
        REACTION_TIME_SLUG,
        REACTION_TIME_RULESET_REVISION,
        { difficultyId: "hard", variantId: "focus" },
        {
          ...evidence,
          rounds: rounds.map((round, index) =>
            index === 0 ? { ...round, clickedAtMs: round.cueAtMs + 20 } : round,
          ),
        },
      ),
    ),
    "REACTION_TIME_INVALID",
  );
});

test("aim-test verifier checks every seeded target and rejects a fabricated hit", async () => {
  const targets = createAimTestTargets({
    challengeSeed: CHALLENGE_SEED,
    difficultyId: "normal",
    variantId: "standard",
  });
  const events = targets.map((target, index) => ({
    seq: index + 1,
    tMs: AIM_TEST_TIMING.minFirstHitMs + index * AIM_TEST_TIMING.minHitIntervalMs,
    x: target.x,
    y: target.y,
  }));
  const evidence = { version: 1, completedAtMs: events.at(-1)?.tMs ?? 0, events };
  const verifierInput = input(
    AIM_TEST_SLUG,
    AIM_TEST_RULESET_REVISION,
    { difficultyId: "normal", variantId: "standard" },
    evidence,
  );
  const result = await aimTestV1.verify(verifierInput);
  assert.equal(result.accepted, true);
  if (result.accepted) {
    assert.equal(result.facts.score, evidence.completedAtMs);
    assert.equal(result.facts.metrics?.hits, 20);
  }
  assert.equal(
    await code(aimTestV1, {
      ...verifierInput,
      evidence: {
        ...evidence,
        events: events.map((event, index) => (index === 0 ? { ...event, x: 0, y: 0 } : event)),
      },
    }),
    "AIM_TARGET_MISSED",
  );
});

test("typing-test verifier selects the seed-bound passage and computes WPM", async () => {
  const challenge = createTypingTestChallenge({
    challengeSeed: CHALLENGE_SEED,
    difficultyId: "normal",
    variantId: "zh",
  });
  const evidence = {
    version: 1,
    passageId: challenge.passageId,
    typedText: challenge.text,
    completedAtMs: 30_000,
  };
  const verifierInput = input(
    TYPING_TEST_SLUG,
    TYPING_TEST_RULESET_REVISION,
    { difficultyId: "normal", variantId: "zh" },
    evidence,
  );
  const result = await typingTestV1.verify(verifierInput);
  assert.equal(result.accepted, true);
  if (result.accepted) {
    assert.equal(result.facts.outcome, "success");
    assert.equal(result.facts.metrics?.accuracy, 100);
  }
  assert.equal(
    await code(typingTestV1, {
      ...verifierInput,
      evidence: { ...evidence, typedText: `${challenge.text}!` },
    }),
    "TYPING_TEXT_MISMATCH",
  );
});

test("typing-test exposes long seed-bound passages for all four language variants", () => {
  for (const variantId of ["ko", "en", "ja", "zh"] as const) {
    const challenge = createTypingTestChallenge({
      challengeSeed: CHALLENGE_SEED,
      difficultyId: "normal",
      variantId,
    });
    assert.ok(Array.from(challenge.text).length >= 150, variantId);
    assert.ok(challenge.source.length > 0, variantId);
  }
});

function successfulMemoryEvidence() {
  const challenge = createMemoryTestChallenge({
    challengeSeed: CHALLENGE_SEED,
    difficultyId: "normal",
    variantId: "reverse",
  });
  let shownAtMs = 0;
  let completedAtMs = 0;
  const rounds = Array.from({ length: challenge.maxLevel }, (_, index) => {
    const level = index + 1;
    const expected = memoryTestExpectedForLevel(challenge, level, "reverse");
    const firstInputAt = shownAtMs + memoryTestDisplayDurationMs(challenge, level);
    const inputs = expected.map((color, inputIndex) => ({
      color,
      tMs: firstInputAt + inputIndex * MEMORY_TEST_MIN_INPUT_INTERVAL_MS,
    }));
    completedAtMs = inputs.at(-1)?.tMs ?? firstInputAt;
    const round = { level, shownAtMs, inputs };
    shownAtMs = completedAtMs + 650;
    return round;
  });
  return { challenge, evidence: { version: 1, completedAtMs, rounds } };
}

test("memory-test verifier accepts a complete seed-bound run and rejects early completion", async () => {
  const { evidence } = successfulMemoryEvidence();
  const verifierInput = input(
    MEMORY_TEST_SLUG,
    MEMORY_TEST_RULESET_REVISION,
    { difficultyId: "normal", variantId: "reverse" },
    evidence,
  );
  const result = await memoryTestV1.verify(verifierInput);
  assert.equal(result.accepted, true);
  if (result.accepted) {
    assert.equal(result.facts.score, 8);
    assert.equal(result.facts.outcome, "success");
  }
  const earlyRounds = evidence.rounds.slice(0, -1);
  const earlyCompletedAt = earlyRounds.at(-1)?.inputs.at(-1)?.tMs ?? 0;
  assert.equal(
    await code(
      memoryTestV1,
      input(
        MEMORY_TEST_SLUG,
        MEMORY_TEST_RULESET_REVISION,
        { difficultyId: "normal", variantId: "reverse" },
        { version: 1, completedAtMs: earlyCompletedAt, rounds: earlyRounds },
      ),
    ),
    "MEMORY_INCOMPLETE",
  );
});

test("every official verifier fails closed on a lookalike slug", async () => {
  const reactionWait =
    createReactionTimeWaits({
      challengeSeed: CHALLENGE_SEED,
      difficultyId: "normal",
      variantId: "standard",
    })[0] ?? 1_000;
  assert.equal(
    await code(
      reactionTimeV1,
      input(
        "lookalike-reaction",
        REACTION_TIME_RULESET_REVISION,
        { difficultyId: "normal", variantId: "standard" },
        {
          version: 1,
          completedAtMs: reactionWait + 180,
          rounds: [{ seq: 1, cueAtMs: reactionWait, clickedAtMs: reactionWait + 180 }],
        },
      ),
    ),
    "REACTION_CONFIG_UNSUPPORTED",
  );
});
