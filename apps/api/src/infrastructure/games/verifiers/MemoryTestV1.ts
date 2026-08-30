import type { GameVerifier, GameVerifierInput, GameVerifierResult } from "@owogg/core";
import {
  elapsedMatches,
  hasExactKeys,
  isPlainRecord,
  randomSource,
  rejected,
} from "./VerifierSupport.js";

export const MEMORY_TEST_SLUG = "memory-test";
export const MEMORY_TEST_VERIFIER_ID = "memory-test-v1";
export const MEMORY_TEST_RULESET_REVISION = 1;
export const MEMORY_TEST_MIN_INPUT_INTERVAL_MS = 70;

type DifficultyId = "normal" | "hard";
type VariantId = "standard" | "reverse";

export interface MemoryTestChallenge {
  readonly maxLevel: number;
  readonly extra: number;
  readonly flashMs: number;
  readonly gapMs: number;
  readonly sequence: readonly number[];
}

interface MemoryInput {
  readonly color: number;
  readonly tMs: number;
}

interface MemoryRound {
  readonly level: number;
  readonly shownAtMs: number;
  readonly inputs: readonly MemoryInput[];
}

const DIFFICULTIES = Object.freeze({
  normal: Object.freeze({ maxLevel: 8, extra: 2, flashMs: 420, gapMs: 180 }),
  hard: Object.freeze({ maxLevel: 12, extra: 3, flashMs: 280, gapMs: 120 }),
});

export const MEMORY_TEST_TIMING = Object.freeze({
  displayToleranceMs: 100,
  maxCompletionMs: 300_000,
  maxClockLeadMs: 1_500,
  maxSubmissionLagMs: 15_000,
});

function isDifficultyId(value: string): value is DifficultyId {
  return Object.hasOwn(DIFFICULTIES, value);
}

function isVariantId(value: string): value is VariantId {
  return value === "standard" || value === "reverse";
}

export function createMemoryTestChallenge(input: {
  readonly challengeSeed: string;
  readonly difficultyId: DifficultyId;
  readonly variantId: VariantId;
}): MemoryTestChallenge {
  const difficulty = DIFFICULTIES[input.difficultyId];
  const random = randomSource(
    `${MEMORY_TEST_VERIFIER_ID}|${MEMORY_TEST_RULESET_REVISION}|${input.challengeSeed}|${input.difficultyId}|${input.variantId}`,
  );
  return Object.freeze({
    ...difficulty,
    sequence: Object.freeze(
      Array.from({ length: difficulty.maxLevel + difficulty.extra }, () =>
        Math.floor(random() * 4),
      ),
    ),
  });
}

export function memoryTestExpectedForLevel(
  challenge: MemoryTestChallenge,
  level: number,
  variantId: VariantId,
): readonly number[] {
  const shown = challenge.sequence.slice(0, level + challenge.extra);
  return variantId === "reverse" ? [...shown].reverse() : shown;
}

export function memoryTestDisplayDurationMs(challenge: MemoryTestChallenge, level: number): number {
  return (level + challenge.extra) * (challenge.flashMs + challenge.gapMs);
}

function parseEvidence(
  value: unknown,
): { readonly completedAtMs: number; readonly rounds: readonly MemoryRound[] } | null {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, ["version", "completedAtMs", "rounds"]) ||
    value.version !== 1 ||
    !Number.isSafeInteger(value.completedAtMs) ||
    (value.completedAtMs as number) < 0 ||
    (value.completedAtMs as number) > MEMORY_TEST_TIMING.maxCompletionMs ||
    !Array.isArray(value.rounds) ||
    value.rounds.length < 1 ||
    value.rounds.length > DIFFICULTIES.hard.maxLevel
  ) {
    return null;
  }
  const rounds: MemoryRound[] = [];
  let totalInputs = 0;
  for (const candidate of value.rounds) {
    if (
      !isPlainRecord(candidate) ||
      !hasExactKeys(candidate, ["level", "shownAtMs", "inputs"]) ||
      !Number.isSafeInteger(candidate.level) ||
      !Number.isSafeInteger(candidate.shownAtMs) ||
      (candidate.shownAtMs as number) < 0 ||
      !Array.isArray(candidate.inputs)
    ) {
      return null;
    }
    const inputs: MemoryInput[] = [];
    for (const entry of candidate.inputs) {
      if (
        !isPlainRecord(entry) ||
        !hasExactKeys(entry, ["color", "tMs"]) ||
        !Number.isSafeInteger(entry.color) ||
        (entry.color as number) < 0 ||
        (entry.color as number) > 3 ||
        !Number.isSafeInteger(entry.tMs) ||
        (entry.tMs as number) < 0
      ) {
        return null;
      }
      inputs.push({ color: entry.color as number, tMs: entry.tMs as number });
    }
    totalInputs += inputs.length;
    if (totalInputs > 200) return null;
    rounds.push({
      level: candidate.level as number,
      shownAtMs: candidate.shownAtMs as number,
      inputs,
    });
  }
  return { completedAtMs: value.completedAtMs as number, rounds };
}

export const memoryTestV1: GameVerifier = Object.freeze({
  async verify(input: GameVerifierInput): Promise<GameVerifierResult> {
    if (
      input.slug !== MEMORY_TEST_SLUG ||
      input.rulesetRevision !== MEMORY_TEST_RULESET_REVISION ||
      !isDifficultyId(input.playConfig.difficultyId) ||
      !isVariantId(input.playConfig.variantId)
    ) {
      return rejected("MEMORY_CONFIG_UNSUPPORTED");
    }
    const evidence = parseEvidence(input.evidence);
    if (!evidence) return rejected("MEMORY_EVIDENCE_INVALID");
    const challenge = createMemoryTestChallenge({
      challengeSeed: input.challengeSeed,
      difficultyId: input.playConfig.difficultyId,
      variantId: input.playConfig.variantId,
    });
    if (evidence.rounds.length > challenge.maxLevel) return rejected("MEMORY_SEQUENCE_INVALID");

    let totalInputs = 0;
    let previousInputAt = -1;
    let failed = false;
    for (let index = 0; index < evidence.rounds.length; index += 1) {
      const round = evidence.rounds[index];
      if (!round || round.level !== index + 1 || round.inputs.length < 1) {
        return rejected("MEMORY_SEQUENCE_INVALID");
      }
      if (round.shownAtMs <= previousInputAt) return rejected("MEMORY_TIME_INVALID");
      const expected = memoryTestExpectedForLevel(
        challenge,
        round.level,
        input.playConfig.variantId,
      );
      if (round.inputs.length > expected.length) return rejected("MEMORY_SEQUENCE_INVALID");
      const earliestFirstInput =
        round.shownAtMs +
        memoryTestDisplayDurationMs(challenge, round.level) -
        MEMORY_TEST_TIMING.displayToleranceMs;
      let mismatchAt = -1;
      for (let inputIndex = 0; inputIndex < round.inputs.length; inputIndex += 1) {
        const entry = round.inputs[inputIndex];
        if (!entry) return rejected("MEMORY_EVIDENCE_INVALID");
        const minimumTime =
          inputIndex === 0
            ? earliestFirstInput
            : (round.inputs[inputIndex - 1]?.tMs ?? 0) + MEMORY_TEST_MIN_INPUT_INTERVAL_MS;
        if (entry.tMs < minimumTime || entry.tMs > evidence.completedAtMs) {
          return rejected("MEMORY_TIME_INVALID");
        }
        if (entry.color !== expected[inputIndex] && mismatchAt === -1) mismatchAt = inputIndex;
      }
      totalInputs += round.inputs.length;
      previousInputAt = round.inputs.at(-1)?.tMs ?? previousInputAt;
      const isLast = index === evidence.rounds.length - 1;
      if (!isLast) {
        if (mismatchAt !== -1 || round.inputs.length !== expected.length) {
          return rejected("MEMORY_SEQUENCE_INVALID");
        }
        continue;
      }
      if (mismatchAt !== -1) {
        if (round.inputs.length !== mismatchAt + 1) return rejected("MEMORY_SEQUENCE_INVALID");
        failed = true;
      } else if (round.inputs.length !== expected.length || round.level !== challenge.maxLevel) {
        return rejected("MEMORY_INCOMPLETE");
      }
    }
    if (previousInputAt !== evidence.completedAtMs) return rejected("MEMORY_TIME_INVALID");
    if (!elapsedMatches(evidence.completedAtMs, input.serverElapsedMs, MEMORY_TEST_TIMING)) {
      return rejected("MEMORY_ELAPSED_MISMATCH");
    }
    const score = failed ? evidence.rounds.length - 1 : challenge.maxLevel;
    return {
      accepted: true,
      facts: {
        outcome: failed ? "failure" : "success",
        score,
        progression: { value: score },
        metrics: { inputs: totalInputs },
        events: { level_completed: score, completed: 1 },
      },
    };
  },
});
