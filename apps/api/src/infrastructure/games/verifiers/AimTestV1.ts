import type { GameVerifier, GameVerifierInput, GameVerifierResult } from "@owogg/core";
import {
  elapsedMatches,
  hasExactKeys,
  isPlainRecord,
  randomSource,
  rejected,
} from "./VerifierSupport.js";

export const AIM_TEST_SLUG = "aim-test";
export const AIM_TEST_VERIFIER_ID = "aim-test-v1";
export const AIM_TEST_RULESET_REVISION = 2;

type DifficultyId = "normal" | "hard";
type VariantId = "standard" | "precision";

export interface AimTestTarget {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

interface AimEvent {
  readonly seq: number;
  readonly tMs: number;
  readonly x: number;
  readonly y: number;
}

const DIFFICULTIES = Object.freeze({
  normal: Object.freeze({ targetCount: 20, radiusScale: 1 }),
  hard: Object.freeze({ targetCount: 30, radiusScale: 0.6 }),
});
const VARIANTS = Object.freeze({
  standard: Object.freeze({ baseRadius: 0.065 }),
  precision: Object.freeze({ baseRadius: 0.043 }),
});

export const AIM_TEST_TIMING = Object.freeze({
  minFirstHitMs: 120,
  minHitIntervalMs: 60,
  maxCompletionMs: 120_000,
  maxClockLeadMs: 1_500,
  maxSubmissionLagMs: 15_000,
});

const HIT_EPSILON = 0.000_001;

function isDifficultyId(value: string): value is DifficultyId {
  return Object.hasOwn(DIFFICULTIES, value);
}

function isVariantId(value: string): value is VariantId {
  return Object.hasOwn(VARIANTS, value);
}

function roundSix(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function createAimTestTargets(input: {
  readonly challengeSeed: string;
  readonly difficultyId: DifficultyId;
  readonly variantId: VariantId;
}): readonly AimTestTarget[] {
  const difficulty = DIFFICULTIES[input.difficultyId];
  const variant = VARIANTS[input.variantId];
  const radius = roundSix(variant.baseRadius * difficulty.radiusScale);
  const margin = radius + 0.02;
  const random = randomSource(
    `${AIM_TEST_VERIFIER_ID}|${AIM_TEST_RULESET_REVISION}|${input.challengeSeed}|${input.difficultyId}|${input.variantId}`,
  );
  return Object.freeze(
    Array.from({ length: difficulty.targetCount }, () =>
      Object.freeze({
        x: roundSix(margin + random() * (1 - margin * 2)),
        y: roundSix(margin + random() * (1 - margin * 2)),
        radius,
      }),
    ),
  );
}

function parseEvidence(value: unknown): { completedAtMs: number; events: AimEvent[] } | null {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, ["version", "completedAtMs", "events"]) ||
    value.version !== 1 ||
    !Number.isSafeInteger(value.completedAtMs) ||
    (value.completedAtMs as number) < 0 ||
    (value.completedAtMs as number) > AIM_TEST_TIMING.maxCompletionMs ||
    !Array.isArray(value.events) ||
    value.events.length > DIFFICULTIES.hard.targetCount
  ) {
    return null;
  }
  const events: AimEvent[] = [];
  for (const candidate of value.events) {
    if (
      !isPlainRecord(candidate) ||
      !hasExactKeys(candidate, ["seq", "tMs", "x", "y"]) ||
      !Number.isSafeInteger(candidate.seq) ||
      !Number.isSafeInteger(candidate.tMs) ||
      typeof candidate.x !== "number" ||
      !Number.isFinite(candidate.x) ||
      candidate.x < 0 ||
      candidate.x > 1 ||
      typeof candidate.y !== "number" ||
      !Number.isFinite(candidate.y) ||
      candidate.y < 0 ||
      candidate.y > 1
    ) {
      return null;
    }
    events.push({
      seq: candidate.seq as number,
      tMs: candidate.tMs as number,
      x: candidate.x,
      y: candidate.y,
    });
  }
  return { completedAtMs: value.completedAtMs as number, events };
}

export const aimTestV1: GameVerifier = Object.freeze({
  async verify(input: GameVerifierInput): Promise<GameVerifierResult> {
    if (
      input.slug !== AIM_TEST_SLUG ||
      input.rulesetRevision !== AIM_TEST_RULESET_REVISION ||
      !isDifficultyId(input.playConfig.difficultyId) ||
      !isVariantId(input.playConfig.variantId)
    ) {
      return rejected("AIM_CONFIG_UNSUPPORTED");
    }
    const evidence = parseEvidence(input.evidence);
    if (!evidence) return rejected("AIM_EVIDENCE_INVALID");
    const targets = createAimTestTargets({
      challengeSeed: input.challengeSeed,
      difficultyId: input.playConfig.difficultyId,
      variantId: input.playConfig.variantId,
    });
    if (evidence.events.length !== targets.length) return rejected("AIM_INCOMPLETE");
    let previousTime = -1;
    for (let index = 0; index < evidence.events.length; index += 1) {
      const event = evidence.events[index];
      const target = targets[index];
      if (!event || !target || event.seq !== index + 1) return rejected("AIM_SEQUENCE_INVALID");
      const minimumTime =
        index === 0
          ? AIM_TEST_TIMING.minFirstHitMs
          : previousTime + AIM_TEST_TIMING.minHitIntervalMs;
      if (event.tMs < minimumTime || event.tMs > evidence.completedAtMs) {
        return rejected("AIM_TIME_INVALID");
      }
      if (Math.hypot(event.x - target.x, event.y - target.y) > target.radius + HIT_EPSILON) {
        return rejected("AIM_TARGET_MISSED");
      }
      previousTime = event.tMs;
    }
    if (previousTime !== evidence.completedAtMs) return rejected("AIM_TIME_INVALID");
    if (!elapsedMatches(evidence.completedAtMs, input.serverElapsedMs, AIM_TEST_TIMING)) {
      return rejected("AIM_ELAPSED_MISMATCH");
    }
    return {
      accepted: true,
      facts: {
        outcome: "success",
        score: evidence.completedAtMs,
        progression: { value: targets.length },
        metrics: { hits: targets.length },
        events: { target_hit: targets.length, completed: 1 },
      },
    };
  },
});
