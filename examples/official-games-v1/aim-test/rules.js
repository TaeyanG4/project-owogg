(() => {
  "use strict";

  const VERIFIER_ID = "aim-test-v1";
  const RULESET_REVISION = 2;
  const TIMING = Object.freeze({ minFirstHitMs: 120, minHitIntervalMs: 60 });
  const DIFFICULTIES = Object.freeze({
    normal: Object.freeze({ targetCount: 20, radiusScale: 1 }),
    hard: Object.freeze({ targetCount: 30, radiusScale: 0.6 }),
  });
  const VARIANTS = Object.freeze({
    standard: Object.freeze({ baseRadius: 0.065 }),
    precision: Object.freeze({ baseRadius: 0.043 }),
  });

  function seedHash(value) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash === 0 ? 0x6d2b79f5 : hash;
  }

  function randomSource(seed) {
    let state = seedHash(seed);
    return () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      return state / 4294967296;
    };
  }

  function roundSix(value) {
    return Math.round(value * 1000000) / 1000000;
  }

  function createTargets({ challengeSeed, difficultyId, variantId }) {
    const difficulty = DIFFICULTIES[difficultyId];
    const variant = VARIANTS[variantId];
    if (!difficulty || !variant) return [];
    const radius = roundSix(variant.baseRadius * difficulty.radiusScale);
    const margin = radius + 0.02;
    const random = randomSource(
      `${VERIFIER_ID}|${RULESET_REVISION}|${challengeSeed}|${difficultyId}|${variantId}`,
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

  window.OwoggAimRules = Object.freeze({ VERIFIER_ID, RULESET_REVISION, TIMING, createTargets });
})();
