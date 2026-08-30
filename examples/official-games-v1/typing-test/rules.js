(() => {
  "use strict";

  const VERIFIER_ID = "typing-test-v1";
  const RULESET_REVISION = 1;
  const MAX_WPM = 300;
  const PASSAGES = Object.freeze({
    ko: Object.freeze({
      normal: Object.freeze([
        "천천히 정확하게 입력하면 속도는 자연스럽게 따라옵니다.",
        "작은 습관이 모여 오늘의 실력을 만들고 내일의 가능성을 넓힙니다.",
        "맑은 바람이 창문을 지나 조용한 책상 위 메모를 흔들었습니다.",
      ]),
      hard: Object.freeze([
        "복잡한 문제를 해결할 때는 가정을 분리하고 검증 가능한 증거부터 차례로 확인해야 합니다.",
        "빠른 판단보다 중요한 것은 바뀐 조건을 놓치지 않고 결과를 다시 검토하는 꼼꼼한 태도입니다.",
        "새로운 규칙은 누구나 같은 방식으로 이해하고 재현할 수 있을 때 비로소 안정적인 기준이 됩니다.",
      ]),
    }),
    en: Object.freeze({
      normal: Object.freeze([
        "Clear evidence turns a good guess into a reliable decision.",
        "Small daily improvements create strong and lasting skills.",
        "A calm mind can notice details that hurry often leaves behind.",
      ]),
      hard: Object.freeze([
        "Reliable systems separate assumptions from evidence and verify every important boundary before release.",
        "A thoughtful review catches changing conditions early and keeps simple ideas from becoming costly mistakes.",
        "Shared rules become useful when every creator can understand, reproduce, and test the same behavior.",
      ]),
    }),
  });

  function seedHash(value) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
  }

  function createChallenge({ challengeSeed, difficultyId, variantId }) {
    const candidates = PASSAGES[variantId]?.[difficultyId];
    if (!candidates) return null;
    const index =
      seedHash(`${VERIFIER_ID}|${RULESET_REVISION}|${challengeSeed}|${difficultyId}|${variantId}`) %
      candidates.length;
    return Object.freeze({
      passageId: `${variantId}-${difficultyId}-${index + 1}`,
      text: candidates[index],
    });
  }

  function characterCount(value) {
    return Array.from(value).length;
  }
  function calculateFacts(text, completedAtMs) {
    const typedChars = characterCount(text);
    const cpm = Math.round((typedChars * 60000) / completedAtMs);
    const wpm = Math.round(cpm / 5);
    return { typedChars, cpm, wpm, accuracy: 100 };
  }

  window.OwoggTypingRules = Object.freeze({
    VERIFIER_ID,
    RULESET_REVISION,
    MAX_WPM,
    createChallenge,
    characterCount,
    calculateFacts,
  });
})();
