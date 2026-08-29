export type AimDifficultyId = "normal" | "hard";
export type AimVariantId = "standard" | "precision";

export interface AimTarget {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

export const AIM_RULESET_REVISION = 1;
export const AIM_VERIFIER_ID = "verified-aim-test-v1";

export const AIM_TIMING = Object.freeze({
  minFirstHitMs: 120,
  minHitIntervalMs: 60,
});

const DIFFICULTY_RULES = Object.freeze({
  normal: Object.freeze({ targetCount: 6, radiusScale: 1 }),
  hard: Object.freeze({ targetCount: 10, radiusScale: 0.82 }),
} as const);

const VARIANT_RULES = Object.freeze({
  standard: Object.freeze({ baseRadius: 0.09 }),
  precision: Object.freeze({ baseRadius: 0.055 }),
} as const);

const UINT32_RANGE = 4_294_967_296;

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

/** Must stay byte-for-byte equivalent in behavior to the reviewed server verifier. */
export function createAimTargets(input: {
  readonly challengeSeed: string;
  readonly difficultyId: AimDifficultyId;
  readonly variantId: AimVariantId;
}): readonly AimTarget[] {
  const difficulty = DIFFICULTY_RULES[input.difficultyId];
  const variant = VARIANT_RULES[input.variantId];
  const radius = roundSix(variant.baseRadius * difficulty.radiusScale);
  const margin = radius + 0.02;
  const random = randomSource(
    `${AIM_VERIFIER_ID}|${AIM_RULESET_REVISION}|${input.challengeSeed}|${input.difficultyId}|${input.variantId}`,
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
