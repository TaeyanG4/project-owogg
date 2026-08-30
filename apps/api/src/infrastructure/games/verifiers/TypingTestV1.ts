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
export const TYPING_TEST_RULESET_REVISION = 2;
export const TYPING_TEST_MAX_WPM = 300;

type DifficultyId = "normal";
type VariantId = "ko" | "en" | "ja" | "zh";

const PASSAGES = Object.freeze({
  ko: Object.freeze([
    Object.freeze({
      source: "고전 산문 · 홍길동전에서 영감",
      text: "홍길동은 어려서부터 글을 읽고 무예를 익히며 세상의 이치를 살폈다. 사람의 값어치는 태어난 자리가 아니라 스스로 세운 뜻과 행동으로 정해져야 한다고 믿었다. 어느 날 그는 힘없는 이들이 부당한 일을 겪는 모습을 보고, 혼자 편안히 지내는 대신 뜻을 함께할 벗들을 모았다. 그들은 필요한 곳에 도움을 전하고 약속을 지키며, 누구도 억울함 때문에 고개를 숙이지 않는 마을을 만들기 위해 긴 길을 떠났다.",
    }),
    Object.freeze({
      source: "고전 서사 · 춘향전에서 영감",
      text: "봄빛이 남원의 들과 강을 환하게 비추던 날, 춘향과 몽룡은 서로의 마음을 가볍게 여기지 않겠다고 약속했다. 시간이 흘러 두 사람 앞에 먼 거리와 뜻밖의 시련이 놓였지만, 춘향은 눈앞의 이익보다 자신이 옳다고 믿는 마음을 지켰다. 몽룡 또한 배운 글을 벼슬을 얻는 데만 쓰지 않고 백성의 사정을 살피는 데 쓰기로 다짐했다. 마침내 다시 만난 두 사람은 오래 지킨 약속이 말보다 행동에서 완성된다는 사실을 깨달았다.",
    }),
    Object.freeze({
      source: "창작 산문 · 새벽의 도서관",
      text: "아직 해가 뜨기 전인 새벽, 오래된 도서관에는 책장을 넘기는 작은 소리만 남아 있었다. 창가에 앉은 학생은 어려운 문장을 서둘러 외우기보다 한 줄씩 뜻을 생각하며 공책에 옮겨 적었다. 틀린 글자는 지우고 다시 썼고, 이해되지 않는 부분에는 질문을 남겼다. 창문 너머로 첫 빛이 번질 무렵, 그는 빠르게 끝낸 공부보다 천천히 확인한 기록이 더 오래 기억된다는 것을 알았다. 오늘의 정확한 한 걸음이 내일의 속도를 만든다는 사실도 함께 배웠다.",
    }),
  ]),
  en: Object.freeze([
    Object.freeze({
      source: "Classic tale · inspired by Alice's Adventures in Wonderland",
      text: "Alice followed the hurried white rabbit beyond the quiet garden and discovered a hall filled with locked doors. Instead of choosing the loudest voice, she looked carefully at every key, label, and path before moving forward. The strange creatures she met offered confident advice, yet their answers often changed with the weather. By asking patient questions and checking what she could observe, Alice learned that curiosity works best when it travels beside good judgment, and that even a bewildering world becomes clearer one detail at a time.",
    }),
    Object.freeze({
      source: "Adventure tale · inspired by Treasure Island",
      text: "At dawn the small ship left the harbor with a steady wind behind its sails. Jim kept the old map dry, watched the line of the coast, and recorded each change in direction. Stories of treasure made the crew impatient, but the captain reminded them that a safe voyage depends on careful work: ropes must be checked, supplies counted, and promises kept. When dark clouds gathered near the island, those ordinary preparations mattered more than bold speeches, and the crew reached shelter because everyone understood the same plan.",
    }),
    Object.freeze({
      source: "Mystery tale · inspired by Sherlock Holmes",
      text: "The room appeared ordinary until Holmes asked Watson to describe it without guessing. A damp mark near the window, a train ticket folded twice, and a clock that had stopped several minutes early seemed unrelated at first. Holmes compared each fact with the visitor's story and discarded every explanation that required an unseen miracle. The answer emerged not from a single brilliant leap but from a chain of small observations that agreed with one another. Watson wrote them down, knowing that reliable conclusions begin where assumptions end.",
    }),
  ]),
  ja: Object.freeze([
    Object.freeze({
      source: "日本文学 · 『吾輩は猫である』に着想",
      text: "朝の縁側で猫は静かに目を開け、人間たちの忙しい一日を眺めていた。主人は難しい本を机に積み上げたまま、探している眼鏡が自分の額にあることに気づかない。猫は声を出して教える代わりに、湯気の立つ茶わんと揺れるカーテンの間をゆっくり歩いた。小さな出来事を丁寧に見れば、立派な言葉よりも暮らしの本当の姿がよく分かる。猫はそう考えながら、今日も一番暖かい場所を見つけて丸くなった。",
    }),
    Object.freeze({
      source: "幻想文学 · 『銀河鉄道の夜』に着想",
      text: "夜空を走る列車の窓から、ジョバンニは遠い星々の光を見つめていた。川のように続く銀河の岸には、名前の知らない花や静かな町の明かりが浮かんでいる。隣に座る友と話すうちに、幸せとは自分だけが早く目的地へ着くことではなく、迷っている誰かのために灯りを残すことかもしれないと思った。列車が次の駅へ向かう間、二人は見た景色を忘れないよう、ゆっくりと言葉にして心へ刻んだ。",
    }),
    Object.freeze({
      source: "創作散文 · 雨上がりの町",
      text: "長い雨がやんだ午後、商店街の石畳には空の色が映っていた。配達を終えた少年は急いで帰ろうとしたが、道の端で濡れた地図を広げる旅行者に気づいた。二人は看板の文字と橋の向きを一つずつ確かめ、目的の駅までの道を紙に書いた。遠回りに見えた時間は、困っている人を安心させる大切な時間だった。少年が家に着くころには雲の切れ間から光が差し、町全体が新しく洗われたように輝いていた。",
    }),
  ]),
  zh: Object.freeze([
    Object.freeze({
      source: "古典故事 · 取意《西游记》",
      text: "清晨，师徒一行沿着山路继续向西。前方云雾很重，看不清哪一条小路通向村庄。有人主张立刻翻过山岭，也有人提醒大家先询问樵夫，再查看水源和天色。经过一番商量，他们把行李重新整理好，留下清楚的路标，并约定遇到危险时彼此照应。真正漫长的旅程不只需要勇气，还需要耐心、分工和守信。等太阳升起，雾气渐散，他们终于看见远处屋顶升起的炊烟。",
    }),
    Object.freeze({
      source: "古典故事 · 取意《三国演义》",
      text: "营帐里的灯一直亮到深夜，桌上铺着河流、山谷和粮道的地图。众人都提出了自己的办法，却没有人只凭声音大小决定行动。负责侦察的人说明道路情况，管理粮草的人计算能够坚持的日数，守城的人列出百姓需要的安排。主将听完以后，把确定的事实和仍需查证的消息分别记下。一个计划是否可靠，不在于说得多么激昂，而在于每个人能否理解职责，并在情况变化时及时传递准确的信息。",
    }),
    Object.freeze({
      source: "古典生活 · 取意《红楼梦》",
      text: "园中的花开得正盛，微风把淡淡的香气送进书房。年轻人围坐在窗边读诗，有人注意到精巧的词句，有人更关心诗中没有直接说出的情感。大家没有急着争出高下，而是轮流解释自己看到的景象，再从字句中寻找依据。一次安静的讨论，让熟悉的篇章显出新的层次。傍晚收书时，他们约定把今天的想法写下来，因为记忆会随时间改变，清楚的文字却能帮助人们再次理解当时的心情。",
    }),
  ]),
} as const);

export const TYPING_TEST_TIMING = Object.freeze({
  maxCompletionMs: 900_000,
  maxClockLeadMs: 1_500,
  maxSubmissionLagMs: 15_000,
});

function isDifficultyId(value: string): value is DifficultyId {
  return value === "normal";
}

function isVariantId(value: string): value is VariantId {
  return value === "ko" || value === "en" || value === "ja" || value === "zh";
}

export function createTypingTestChallenge(input: {
  readonly challengeSeed: string;
  readonly difficultyId: DifficultyId;
  readonly variantId: VariantId;
}): { readonly passageId: string; readonly source: string; readonly text: string } {
  const candidates = PASSAGES[input.variantId];
  const index =
    seedHash(
      `${TYPING_TEST_VERIFIER_ID}|${TYPING_TEST_RULESET_REVISION}|${input.challengeSeed}|${input.difficultyId}|${input.variantId}`,
    ) % candidates.length;
  return Object.freeze({
    passageId: `${input.variantId}-${input.difficultyId}-${index + 1}`,
    source: candidates[index]?.source ?? "",
    text: candidates[index]?.text ?? "",
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
    Array.from(value.typedText).length > 2_000 ||
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
