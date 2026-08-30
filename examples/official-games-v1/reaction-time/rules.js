(() => {
  "use strict";

  const VERIFIER_ID = "reaction-time-v1";
  const RULESET_REVISION = 1;
  const BREAK_MS = 450;
  const TIMING = Object.freeze({ minReactionMs: 80, maxReactionMs: 10_000 });
  const RULES = Object.freeze({
    normal: Object.freeze({ rounds: 5 }),
    hard: Object.freeze({ rounds: 7 }),
  });
  const VARIANTS = Object.freeze({
    standard: Object.freeze({ waitMin: 900, waitRange: 1100 }),
    focus: Object.freeze({ waitMin: 1400, waitRange: 1500 }),
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

  function createWaits({ challengeSeed, difficultyId, variantId }) {
    const difficulty = RULES[difficultyId];
    const variant = VARIANTS[variantId];
    if (!difficulty || !variant) return [];
    const random = randomSource(
      `${VERIFIER_ID}|${RULESET_REVISION}|${challengeSeed}|${difficultyId}|${variantId}`,
    );
    return Object.freeze(
      Array.from(
        { length: difficulty.rounds },
        () => variant.waitMin + Math.floor(random() * variant.waitRange),
      ),
    );
  }

  window.OwoggReactionRules = Object.freeze({
    VERIFIER_ID,
    RULESET_REVISION,
    BREAK_MS,
    TIMING,
    createWaits,
  });
})();
