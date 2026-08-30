(() => {
  "use strict";

  const VERIFIER_ID = "memory-test-v1";
  const RULESET_REVISION = 1;
  const MIN_INPUT_INTERVAL_MS = 70;
  const DIFFICULTIES = Object.freeze({
    normal: Object.freeze({ maxLevel: 8, extra: 2, flashMs: 420, gapMs: 180 }),
    hard: Object.freeze({ maxLevel: 12, extra: 3, flashMs: 280, gapMs: 120 }),
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

  function createChallenge({ challengeSeed, difficultyId, variantId }) {
    const difficulty = DIFFICULTIES[difficultyId];
    if (!difficulty || !["standard", "reverse"].includes(variantId)) return null;
    const maximumLength = difficulty.maxLevel + difficulty.extra;
    const random = randomSource(
      `${VERIFIER_ID}|${RULESET_REVISION}|${challengeSeed}|${difficultyId}|${variantId}`,
    );
    const sequence = Object.freeze(
      Array.from({ length: maximumLength }, () => Math.floor(random() * 4)),
    );
    return Object.freeze({ ...difficulty, sequence });
  }

  function expectedForLevel(challenge, level, variantId) {
    const shown = challenge.sequence.slice(0, level + challenge.extra);
    return variantId === "reverse" ? [...shown].reverse() : [...shown];
  }

  function displayDurationMs(challenge, level) {
    return (level + challenge.extra) * (challenge.flashMs + challenge.gapMs);
  }

  window.OwoggMemoryRules = Object.freeze({
    VERIFIER_ID,
    RULESET_REVISION,
    MIN_INPUT_INTERVAL_MS,
    createChallenge,
    expectedForLevel,
    displayDurationMs,
  });
})();
