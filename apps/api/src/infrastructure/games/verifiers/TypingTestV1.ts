import type { GameVerifier, GameVerifierInput, GameVerifierResult } from "@owogg/core";
import {
  elapsedMatches,
  hasExactKeys,
  isPlainRecord,
  rejected,
  seedHash,
} from "./VerifierSupport.js";

export const TYPING_TEST_SLUG = "typing-test";
export const TYPING_TEST_VERIFIER_ID = "typing-test-v1";
export const TYPING_TEST_RULESET_REVISION = 1;
export const TYPING_TEST_MAX_WPM = 300;

type DifficultyId = "normal" | "hard";
type VariantId = "ko" | "en";

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

export const TYPING_TEST_TIMING = Object.freeze({
  maxCompletionMs: 300_000,
  maxClockLeadMs: 1_500,
  maxSubmissionLagMs: 15_000,
});

function isDifficultyId(value: string): value is DifficultyId {
  return value === "normal" || value === "hard";
}

function isVariantId(value: string): value is VariantId {
  return value === "ko" || value === "en";
}

export function createTypingTestChallenge(input: {
  readonly challengeSeed: string;
  readonly difficultyId: DifficultyId;
  readonly variantId: VariantId;
}): { readonly passageId: string; readonly text: string } {
  const candidates = PASSAGES[input.variantId][input.difficultyId];
  const index =
    seedHash(
      `${TYPING_TEST_VERIFIER_ID}|${TYPING_TEST_RULESET_REVISION}|${input.challengeSeed}|${input.difficultyId}|${input.variantId}`,
    ) % candidates.length;
  return Object.freeze({
    passageId: `${input.variantId}-${input.difficultyId}-${index + 1}`,
    text: candidates[index] ?? "",
  });
}

export function calculateTypingTestFacts(
  text: string,
  completedAtMs: number,
): {
  readonly typedChars: number;
  readonly cpm: number;
  readonly wpm: number;
  readonly accuracy: 100;
} {
  const typedChars = Array.from(text).length;
  const cpm = Math.round((typedChars * 60_000) / completedAtMs);
  return { typedChars, cpm, wpm: Math.round(cpm / 5), accuracy: 100 };
}

function parseEvidence(
  value: unknown,
): { passageId: string; typedText: string; completedAtMs: number } | null {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, ["version", "passageId", "typedText", "completedAtMs"]) ||
    value.version !== 1 ||
    typeof value.passageId !== "string" ||
    value.passageId.length < 1 ||
    value.passageId.length > 64 ||
    typeof value.typedText !== "string" ||
    Array.from(value.typedText).length > 500 ||
    !Number.isSafeInteger(value.completedAtMs) ||
    (value.completedAtMs as number) < 1 ||
    (value.completedAtMs as number) > TYPING_TEST_TIMING.maxCompletionMs
  ) {
    return null;
  }
  return {
    passageId: value.passageId,
    typedText: value.typedText,
    completedAtMs: value.completedAtMs as number,
  };
}

export const typingTestV1: GameVerifier = Object.freeze({
  async verify(input: GameVerifierInput): Promise<GameVerifierResult> {
    if (
      input.slug !== TYPING_TEST_SLUG ||
      input.rulesetRevision !== TYPING_TEST_RULESET_REVISION ||
      !isDifficultyId(input.playConfig.difficultyId) ||
      !isVariantId(input.playConfig.variantId)
    ) {
      return rejected("TYPING_CONFIG_UNSUPPORTED");
    }
    const evidence = parseEvidence(input.evidence);
    if (!evidence) return rejected("TYPING_EVIDENCE_INVALID");
    const challenge = createTypingTestChallenge({
      challengeSeed: input.challengeSeed,
      difficultyId: input.playConfig.difficultyId,
      variantId: input.playConfig.variantId,
    });
    if (evidence.passageId !== challenge.passageId || evidence.typedText !== challenge.text) {
      return rejected("TYPING_TEXT_MISMATCH");
    }
    const characterCount = Array.from(challenge.text).length;
    const minimumElapsedMs = Math.ceil((characterCount * 12_000) / TYPING_TEST_MAX_WPM);
    if (evidence.completedAtMs < minimumElapsedMs) return rejected("TYPING_SPEED_INVALID");
    if (!elapsedMatches(evidence.completedAtMs, input.serverElapsedMs, TYPING_TEST_TIMING)) {
      return rejected("TYPING_ELAPSED_MISMATCH");
    }
    const facts = calculateTypingTestFacts(challenge.text, evidence.completedAtMs);
    if (facts.wpm > TYPING_TEST_MAX_WPM) return rejected("TYPING_SPEED_INVALID");
    return {
      accepted: true,
      facts: {
        outcome: "success",
        score: facts.wpm,
        progression: { value: facts.typedChars },
        metrics: {
          cpm: facts.cpm,
          accuracy: facts.accuracy,
          typedChars: facts.typedChars,
        },
        events: { completed: 1 },
      },
    };
  },
});
