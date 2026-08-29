import type { GameVerifier, GameVerifierInput, GameVerifierResult } from "@owogg/core";

export const VERIFIED_AIM_TEST_SLUG = "verified-aim-test";
export const VERIFIED_AIM_TEST_VERIFIER_ID = "verified-aim-test-v1";
export const VERIFIED_AIM_TEST_RULESET_REVISION = 1;

export type VerifiedAimDifficultyId = "normal" | "hard";
export type VerifiedAimVariantId = "standard" | "precision";

export interface VerifiedAimTarget {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

interface VerifiedAimEvent {
  readonly seq: number;
  readonly tMs: number;
  readonly x: number;
  readonly y: number;
}

interface VerifiedAimEvidence {
  readonly version: 1;
  readonly completedAtMs: number;
  readonly events: readonly VerifiedAimEvent[];
}

const DIFFICULTY_RULES = Object.freeze({
  normal: Object.freeze({ targetCount: 6, radiusScale: 1 }),
  hard: Object.freeze({ targetCount: 10, radiusScale: 0.82 }),
} as const);

const VARIANT_RULES = Object.freeze({
  standard: Object.freeze({ baseRadius: 0.09 }),
  precision: Object.freeze({ baseRadius: 0.055 }),
} as const);

export const VERIFIED_AIM_TEST_TIMING = Object.freeze({
  minFirstHitMs: 120,
  minHitIntervalMs: 60,
  maxCompletionMs: 120_000,
  maxClockLeadMs: 1_500,
  maxSubmissionLagMs: 15_000,
});

const HIT_EPSILON = 0.000_001;
const UINT32_RANGE = 4_294_967_296;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function isDifficultyId(value: string): value is VerifiedAimDifficultyId {
  return Object.hasOwn(DIFFICULTY_RULES, value);
}

function isVariantId(value: string): value is VerifiedAimVariantId {
  return Object.hasOwn(VARIANT_RULES, value);
}

function roundSix(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function seedHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash === 0 ? 0x6d2b79f5 : hash;
}

function randomSource(seed: string): () => number {
  let state = seedHash(seed);
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / UINT32_RANGE;
  };
}

/** Pure target generation duplicated in the standalone reference game and locked by test vectors. */
export function createVerifiedAimTestTargets(input: {
  readonly challengeSeed: string;
  readonly difficultyId: VerifiedAimDifficultyId;
  readonly variantId: VerifiedAimVariantId;
}): readonly VerifiedAimTarget[] {
  const difficulty = DIFFICULTY_RULES[input.difficultyId];
  const variant = VARIANT_RULES[input.variantId];
  const radius = roundSix(variant.baseRadius * difficulty.radiusScale);
  const margin = radius + 0.02;
  const random = randomSource(
    `${VERIFIED_AIM_TEST_VERIFIER_ID}|${VERIFIED_AIM_TEST_RULESET_REVISION}|${input.challengeSeed}|${input.difficultyId}|${input.variantId}`,
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

function parseEvidence(value: unknown): VerifiedAimEvidence | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["version", "completedAtMs", "events"])) {
    return null;
  }
  if (
    value.version !== 1 ||
    typeof value.completedAtMs !== "number" ||
    !Number.isSafeInteger(value.completedAtMs) ||
    value.completedAtMs < 0 ||
    value.completedAtMs > VERIFIED_AIM_TEST_TIMING.maxCompletionMs ||
    !Array.isArray(value.events) ||
    value.events.length > DIFFICULTY_RULES.hard.targetCount
  ) {
    return null;
  }

  const events: VerifiedAimEvent[] = [];
  for (const candidate of value.events) {
    if (!isPlainRecord(candidate) || !hasExactKeys(candidate, ["seq", "tMs", "x", "y"])) {
      return null;
    }
    if (
      typeof candidate.seq !== "number" ||
      !Number.isSafeInteger(candidate.seq) ||
      typeof candidate.tMs !== "number" ||
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
    events.push({ seq: candidate.seq, tMs: candidate.tMs, x: candidate.x, y: candidate.y });
  }
  return { version: 1, completedAtMs: value.completedAtMs, events };
}

function rejected(code: string): GameVerifierResult {
  return { accepted: false, code };
}

export const verifiedAimTestV1: GameVerifier = Object.freeze({
  async verify(input: GameVerifierInput): Promise<GameVerifierResult> {
    if (
      input.slug !== VERIFIED_AIM_TEST_SLUG ||
      input.rulesetRevision !== VERIFIED_AIM_TEST_RULESET_REVISION ||
      !isDifficultyId(input.playConfig.difficultyId) ||
      !isVariantId(input.playConfig.variantId)
    ) {
      return rejected("AIM_CONFIG_UNSUPPORTED");
    }

    const evidence = parseEvidence(input.evidence);
    if (!evidence) return rejected("AIM_EVIDENCE_INVALID");

    const targets = createVerifiedAimTestTargets({
      challengeSeed: input.challengeSeed,
      difficultyId: input.playConfig.difficultyId,
      variantId: input.playConfig.variantId,
    });
    if (evidence.events.length !== targets.length) return rejected("AIM_INCOMPLETE");

    let previousTime = -1;
    for (let index = 0; index < evidence.events.length; index += 1) {
      const event = evidence.events[index];
      const target = targets[index];
      if (!event || !target) return rejected("AIM_INCOMPLETE");
      if (event.seq !== index + 1) return rejected("AIM_SEQUENCE_INVALID");
      const minimumTime =
        index === 0
          ? VERIFIED_AIM_TEST_TIMING.minFirstHitMs
          : previousTime + VERIFIED_AIM_TEST_TIMING.minHitIntervalMs;
      if (event.tMs < minimumTime || event.tMs > evidence.completedAtMs) {
        return rejected("AIM_TIME_INVALID");
      }
      previousTime = event.tMs;

      if (Math.hypot(event.x - target.x, event.y - target.y) > target.radius + HIT_EPSILON) {
        return rejected("AIM_TARGET_MISSED");
      }
    }

    if (previousTime !== evidence.completedAtMs) return rejected("AIM_TIME_INVALID");
    if (
      evidence.completedAtMs > input.serverElapsedMs + VERIFIED_AIM_TEST_TIMING.maxClockLeadMs ||
      input.serverElapsedMs - evidence.completedAtMs > VERIFIED_AIM_TEST_TIMING.maxSubmissionLagMs
    ) {
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
