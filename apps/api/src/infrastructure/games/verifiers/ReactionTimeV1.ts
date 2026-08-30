import type { GameVerifier, GameVerifierInput, GameVerifierResult } from "@owogg/core";
import {
  elapsedMatches,
  hasExactKeys,
  isPlainRecord,
  randomSource,
  rejected,
} from "./VerifierSupport.js";

export const REACTION_TIME_SLUG = "reaction-time";
export const REACTION_TIME_VERIFIER_ID = "reaction-time-v1";
export const REACTION_TIME_RULESET_REVISION = 2;
export const REACTION_TIME_BREAK_MS = 1_400;

type DifficultyId = "normal" | "hard";
type VariantId = "standard" | "focus";

interface ReactionRound {
  readonly seq: number;
  readonly cueAtMs: number;
  readonly clickedAtMs: number;
}

interface ReactionEvidence {
  readonly version: 1;
  readonly completedAtMs: number;
  readonly rounds: readonly ReactionRound[];
}

const DIFFICULTIES = Object.freeze({
  normal: Object.freeze({ rounds: 5 }),
  hard: Object.freeze({ rounds: 7 }),
});
const VARIANTS = Object.freeze({
  standard: Object.freeze({ waitMin: 1_800, waitRange: 1_800 }),
  focus: Object.freeze({ waitMin: 2_400, waitRange: 2_200 }),
});

export const REACTION_TIME_TIMING = Object.freeze({
  minReactionMs: 80,
  maxReactionMs: 10_000,
  cueDelayToleranceMs: 100,
  maxCueDelayMs: 5_000,
  maxCompletionMs: 120_000,
  maxClockLeadMs: 1_500,
  maxSubmissionLagMs: 15_000,
});

function isDifficultyId(value: string): value is DifficultyId {
  return Object.hasOwn(DIFFICULTIES, value);
}

function isVariantId(value: string): value is VariantId {
  return Object.hasOwn(VARIANTS, value);
}

export function createReactionTimeWaits(input: {
  readonly challengeSeed: string;
  readonly difficultyId: DifficultyId;
  readonly variantId: VariantId;
}): readonly number[] {
  const difficulty = DIFFICULTIES[input.difficultyId];
  const variant = VARIANTS[input.variantId];
  const random = randomSource(
    `${REACTION_TIME_VERIFIER_ID}|${REACTION_TIME_RULESET_REVISION}|${input.challengeSeed}|${input.difficultyId}|${input.variantId}`,
  );
  return Object.freeze(
    Array.from(
      { length: difficulty.rounds },
      () => variant.waitMin + Math.floor(random() * variant.waitRange),
    ),
  );
}

function parseEvidence(value: unknown): ReactionEvidence | null {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, ["version", "completedAtMs", "rounds"]) ||
    value.version !== 1 ||
    !Number.isSafeInteger(value.completedAtMs) ||
    (value.completedAtMs as number) < 0 ||
    (value.completedAtMs as number) > REACTION_TIME_TIMING.maxCompletionMs ||
    !Array.isArray(value.rounds) ||
    value.rounds.length > DIFFICULTIES.hard.rounds
  ) {
    return null;
  }
  const rounds: ReactionRound[] = [];
  for (const candidate of value.rounds) {
    if (
      !isPlainRecord(candidate) ||
      !hasExactKeys(candidate, ["seq", "cueAtMs", "clickedAtMs"]) ||
      !Number.isSafeInteger(candidate.seq) ||
      !Number.isSafeInteger(candidate.cueAtMs) ||
      !Number.isSafeInteger(candidate.clickedAtMs) ||
      (candidate.cueAtMs as number) < 0 ||
      (candidate.clickedAtMs as number) < 0
    ) {
      return null;
    }
    rounds.push({
      seq: candidate.seq as number,
      cueAtMs: candidate.cueAtMs as number,
      clickedAtMs: candidate.clickedAtMs as number,
    });
  }
  return { version: 1, completedAtMs: value.completedAtMs as number, rounds };
}

export const reactionTimeV1: GameVerifier = Object.freeze({
  async verify(input: GameVerifierInput): Promise<GameVerifierResult> {
    if (
      input.slug !== REACTION_TIME_SLUG ||
      input.rulesetRevision !== REACTION_TIME_RULESET_REVISION ||
      !isDifficultyId(input.playConfig.difficultyId) ||
      !isVariantId(input.playConfig.variantId)
    ) {
      return rejected("REACTION_CONFIG_UNSUPPORTED");
    }
    const evidence = parseEvidence(input.evidence);
    if (!evidence) return rejected("REACTION_EVIDENCE_INVALID");
    const waits = createReactionTimeWaits({
      challengeSeed: input.challengeSeed,
      difficultyId: input.playConfig.difficultyId,
      variantId: input.playConfig.variantId,
    });
    if (evidence.rounds.length !== waits.length) return rejected("REACTION_INCOMPLETE");

    let previousClickedAt = 0;
    let reactionTotal = 0;
    for (let index = 0; index < evidence.rounds.length; index += 1) {
      const round = evidence.rounds[index];
      const wait = waits[index];
      if (!round || wait === undefined || round.seq !== index + 1) {
        return rejected("REACTION_SEQUENCE_INVALID");
      }
      const earliestCue =
        (index === 0 ? 0 : previousClickedAt + REACTION_TIME_BREAK_MS) +
        wait -
        REACTION_TIME_TIMING.cueDelayToleranceMs;
      if (
        round.cueAtMs < earliestCue ||
        round.cueAtMs > earliestCue + REACTION_TIME_TIMING.maxCueDelayMs ||
        round.clickedAtMs < round.cueAtMs ||
        round.clickedAtMs > evidence.completedAtMs
      ) {
        return rejected("REACTION_TIME_INVALID");
      }
      const reactionMs = round.clickedAtMs - round.cueAtMs;
      if (
        reactionMs < REACTION_TIME_TIMING.minReactionMs ||
        reactionMs > REACTION_TIME_TIMING.maxReactionMs
      ) {
        return rejected("REACTION_TIME_INVALID");
      }
      reactionTotal += reactionMs;
      previousClickedAt = round.clickedAtMs;
    }
    if (previousClickedAt !== evidence.completedAtMs) return rejected("REACTION_TIME_INVALID");
    if (!elapsedMatches(evidence.completedAtMs, input.serverElapsedMs, REACTION_TIME_TIMING)) {
      return rejected("REACTION_ELAPSED_MISMATCH");
    }
    const score = Math.round(reactionTotal / evidence.rounds.length);
    return {
      accepted: true,
      facts: {
        outcome: "success",
        score,
        progression: { value: evidence.rounds.length },
        metrics: { rounds: evidence.rounds.length },
        events: { round_completed: evidence.rounds.length, completed: 1 },
      },
    };
  },
});
