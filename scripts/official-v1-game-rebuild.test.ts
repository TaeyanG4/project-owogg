import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { parseGameCreatorManifest } from "../packages/core/src/domain/gameCreatorManifest.js";
import { createAimTestTargets } from "../apps/api/src/infrastructure/games/verifiers/AimTestV1.js";
import {
  createMemoryTestChallenge,
  memoryTestExpectedForLevel,
} from "../apps/api/src/infrastructure/games/verifiers/MemoryTestV1.js";
import { createReactionTimeWaits } from "../apps/api/src/infrastructure/games/verifiers/ReactionTimeV1.js";
import { createTypingTestChallenge } from "../apps/api/src/infrastructure/games/verifiers/TypingTestV1.js";
import { officialV1Games } from "../examples/official-games-v1/games.mjs";

const root = process.cwd();
const fixtureRoot = path.join(root, "examples", "official-games-v1");
const frozenGameSlugs = [
  "aim-test",
  "memory-test",
  "official-omok",
  "reaction-time",
  "typing-test",
];

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function loadBrowserRules<T>(slug: string, globalName: string): T {
  const sandbox: { window: Record<string, unknown> } = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(fixtureRoot, slug, "rules.js"), "utf8"), sandbox, {
    filename: `${slug}/rules.js`,
  });
  const loaded = sandbox.window[globalName];
  assert.ok(loaded, `${globalName} was not installed`);
  return loaded as T;
}

test("Phase 7 source covers exactly every frozen Staging GAME identity", () => {
  assert.deepEqual(officialV1Games.map((game) => game.slug).sort(), frozenGameSlugs);
  const buildSource = read("examples/official-games-v1/build-all.mjs");
  assert.match(buildSource, /project-owogg-games/);
  assert.match(buildSource, /already exists with different content/);
  assert.match(buildSource, /artifactVersion/);
  for (const game of officialV1Games) {
    assert.equal(game.artifactVersion, "1.0.0", `${game.slug}: artifact version`);
    assert.match(game.artifactVersion, /^\d+\.\d+\.\d+$/, `${game.slug}: artifact SemVer`);
    const directory = path.join(fixtureRoot, game.slug);
    assert.deepEqual(
      fs.readdirSync(directory).sort(),
      [...game.files].sort(),
      `${game.slug}: source file set drift`,
    );
    const manifest = parseGameCreatorManifest(
      JSON.parse(fs.readFileSync(path.join(directory, "owogg.json"), "utf8")),
    );
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.game.slug, game.slug);
  }
});

test("official manifests expose only their product-owned configuration axes", () => {
  const manifest = (slug: string) =>
    parseGameCreatorManifest(
      JSON.parse(fs.readFileSync(path.join(fixtureRoot, slug, "owogg.json"), "utf8")),
    );

  const aim = manifest("aim-test");
  assert.deepEqual(
    aim.difficulties?.map((difficulty) => difficulty.id),
    ["normal", "hard"],
  );
  assert.deepEqual(
    aim.playConfig?.variants.map((variant) => variant.id),
    ["standard"],
  );
  assert.deepEqual(
    aim.playConfig?.allowedConfigs.map(({ difficultyId, variantId }) => ({
      difficultyId,
      variantId,
    })),
    [
      { difficultyId: "normal", variantId: "standard" },
      { difficultyId: "hard", variantId: "standard" },
    ],
  );

  for (const slug of ["reaction-time", "memory-test"]) {
    const singleConfig = manifest(slug);
    assert.equal(singleConfig.difficulties, undefined, `${slug}: redundant difficulty axis`);
    assert.deepEqual(
      singleConfig.playConfig?.variants.map((variant) => variant.id),
      ["standard"],
    );
    assert.deepEqual(singleConfig.playConfig?.allowedConfigs, [
      { difficultyId: "normal", variantId: "standard", rewardFactor: 1 },
    ]);
  }

  const typing = manifest("typing-test");
  assert.equal(typing.difficulties, undefined);
  assert.equal(typing.playConfig?.rulesetRevision, 3);
  assert.equal(typing.result.score?.unit, "점");
  assert.equal(typing.leaderboard?.enabled, true);
  assert.deepEqual(
    typing.playConfig?.variants.map((variant) => variant.id),
    ["ko", "en", "ja", "zh"],
  );
  assert.equal(typing.playConfig?.allowedConfigs.length, 4);

  const reaction = manifest("reaction-time");
  assert.equal(reaction.playConfig?.rulesetRevision, 3);

  const omok = manifest("official-omok");
  assert.equal(omok.playConfig, undefined);
  assert.equal(omok.leaderboard?.enabled, false);
  assert.equal(omok.result.score, null);
  assert.deepEqual(omok.game.playModes, ["local-multi", "online-multi"]);
});

test("official game UI waits for host bootstrap and derives choices from its public descriptor", () => {
  const forbiddenRuntimeCopy = "OWOGG의 서버 검증 실행 환경에서만 시작할 수 있습니다.";
  for (const game of officialV1Games) {
    const source = fs.readFileSync(path.join(fixtureRoot, game.slug, "game.js"), "utf8");
    assert.match(source, /await api\.whenReady\(\)/, `${game.slug}: async host readiness`);
    assert.equal(source.includes(forbiddenRuntimeCopy), false, `${game.slug}: obsolete warning`);
  }

  for (const slug of ["aim-test", "reaction-time", "memory-test"]) {
    const source = fs.readFileSync(path.join(fixtureRoot, slug, "game.js"), "utf8");
    assert.match(source, /config\.difficulties\.length/);
    assert.match(source, /config\.variants\.length/);
    assert.match(source, /config\.allowedConfigs/);
  }

  const typing = fs.readFileSync(path.join(fixtureRoot, "typing-test", "game.js"), "utf8");
  assert.match(typing, /config\.allowedConfigs\.map/);
  assert.match(typing, /config\.allowedConfigs\.length > 1/);

  const omok = fs.readFileSync(path.join(fixtureRoot, "official-omok", "game.js"), "utf8");
  assert.match(omok, /const modes = api\.playModes/);
  assert.doesNotMatch(omok, /api\.complete\s*\(/);
  assert.doesNotMatch(omok, /api\.requestStart\s*\(/);
});

test("every official game owns bilingual UI, sound settings, and in-game restart controls", () => {
  for (const game of officialV1Games) {
    const html = fs.readFileSync(path.join(fixtureRoot, game.slug, "index.html"), "utf8");
    const source = fs.readFileSync(path.join(fixtureRoot, game.slug, "game.js"), "utf8");
    assert.match(html, /id="language-toggle"/, `${game.slug}: language control`);
    assert.match(html, /id="sound-toggle"/, `${game.slug}: sound control`);
    assert.match(source, /\bko:\s*Object\.freeze/, `${game.slug}: Korean UI`);
    assert.match(source, /\ben:\s*Object\.freeze/, `${game.slug}: English UI`);
    assert.match(source, /AudioContext/, `${game.slug}: procedural audio`);
    assert.doesNotMatch(source, /window\.location\.reload\s*\(/, `${game.slug}: hostless reload`);
  }
  for (const slug of ["aim-test", "reaction-time", "memory-test", "typing-test"]) {
    const source = fs.readFileSync(path.join(fixtureRoot, slug, "game.js"), "utf8");
    assert.match(source, /api\.restart\s*\(\)/, `${slug}: host-owned fresh attempt`);
  }
});

test("standalone game sources never open their own network or persistent browser storage", () => {
  const forbidden = [
    /\bfetch\s*\(/,
    /\bnew\s+WebSocket\b/,
    /\bXMLHttpRequest\b/,
    /\bEventSource\b/,
    /\bserviceWorker\b/,
    /\bdocument\.cookie\b/,
    /\b(?:localStorage|sessionStorage)\b/,
  ];
  for (const game of officialV1Games) {
    for (const filename of ["index.html", "rules.js", "game.js"]) {
      const source = fs.readFileSync(path.join(fixtureRoot, game.slug, filename), "utf8");
      for (const pattern of forbidden) assert.doesNotMatch(source, pattern);
    }
  }
});

test("standalone deterministic rules match their reviewed server verifiers", () => {
  const challengeSeed = "phase-seven-parity-0000000001";
  const reaction = loadBrowserRules<{
    createWaits(input: {
      challengeSeed: string;
      difficultyId: "normal";
      variantId: "standard";
    }): readonly number[];
  }>("reaction-time", "OwoggReactionRules");
  assert.deepEqual(
    [...reaction.createWaits({ challengeSeed, difficultyId: "normal", variantId: "standard" })],
    [...createReactionTimeWaits({ challengeSeed, difficultyId: "normal", variantId: "standard" })],
  );

  const aim = loadBrowserRules<{
    createTargets(input: {
      challengeSeed: string;
      difficultyId: "hard";
      variantId: "standard";
    }): readonly { readonly x: number; readonly y: number; readonly radius: number }[];
  }>("aim-test", "OwoggAimRules");
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        aim.createTargets({ challengeSeed, difficultyId: "hard", variantId: "standard" }),
      ),
    ),
    createAimTestTargets({ challengeSeed, difficultyId: "hard", variantId: "standard" }),
  );

  const typing = loadBrowserRules<{
    createChallenge(input: { challengeSeed: string; difficultyId: "normal"; variantId: "ja" }): {
      readonly passageId: string;
      readonly lines: readonly { readonly source: string; readonly text: string }[];
    };
  }>("typing-test", "OwoggTypingRules");
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        typing.createChallenge({ challengeSeed, difficultyId: "normal", variantId: "ja" }),
      ),
    ),
    createTypingTestChallenge({ challengeSeed, difficultyId: "normal", variantId: "ja" }),
  );

  const memory = loadBrowserRules<{
    createChallenge(input: {
      challengeSeed: string;
      difficultyId: "normal";
      variantId: "standard";
    }): {
      readonly sequence: readonly number[];
      readonly maxLevel: number;
      readonly extra: number;
    };
    expectedForLevel(
      challenge: { readonly sequence: readonly number[]; readonly extra: number },
      level: number,
      variantId: "standard",
    ): readonly number[];
  }>("memory-test", "OwoggMemoryRules");
  const memoryConfig = {
    challengeSeed,
    difficultyId: "normal" as const,
    variantId: "standard" as const,
  };
  const browserMemory = memory.createChallenge(memoryConfig);
  const serverMemory = createMemoryTestChallenge(memoryConfig);
  assert.deepEqual(JSON.parse(JSON.stringify(browserMemory)), serverMemory);
  assert.deepEqual(
    [...memory.expectedForLevel(browserMemory, 4, "standard")],
    [...memoryTestExpectedForLevel(serverMemory, 4, "standard")],
  );
});

test("Omok application rules stay inside the ZIP and support local state transitions", () => {
  const omok = loadBrowserRules<{
    readonly SIZE: number;
    readonly PROTOCOL: string;
    createState(): unknown;
    applyMove(state: unknown, index: number, color: number): unknown;
    inspectMove(
      state: unknown,
      index: number,
      color: number,
    ): { readonly legal: boolean; readonly reason?: string };
    requestRematch(state: unknown, color: number): unknown;
    parseState(state: unknown): {
      readonly revision: number;
      readonly round: number;
      readonly moves: number;
    } | null;
  }>("official-omok", "OwoggOmokRules");
  let state = omok.createState();
  for (const [index, color] of [
    [0, 1],
    [15, 2],
    [1, 1],
    [16, 2],
    [2, 1],
    [17, 2],
    [3, 1],
    [18, 2],
    [4, 1],
  ] as const) {
    state = omok.applyMove(state, index, color);
    assert.ok(state);
  }
  assert.equal(omok.SIZE, 15);
  assert.equal(omok.PROTOCOL, "owogg-omok/v2");
  assert.deepEqual(omok.parseState(state), state);
  assert.equal((state as { winner: number }).winner, 1);

  const firstVote = omok.requestRematch(state, 1);
  assert.ok(firstVote);
  const rematched = omok.requestRematch(firstVote, 2);
  assert.ok(rematched);
  assert.equal((rematched as { round: number }).round, 2);
  assert.equal((rematched as { moves: number }).moves, 0);
});

test("Omok Renju rules reject black overline, double-four, and double-three", () => {
  const omok = loadBrowserRules<{
    createState(): unknown;
    applyMove(state: unknown, index: number, color: number): unknown;
    inspectMove(
      state: unknown,
      index: number,
      color: number,
    ): { readonly legal: boolean; readonly reason?: string };
  }>("official-omok", "OwoggOmokRules");

  function prepared(black: readonly number[], white: readonly number[]): unknown {
    let state = omok.createState();
    for (let index = 0; index < black.length; index += 1) {
      state = omok.applyMove(state, black[index] as number, 1);
      assert.ok(state);
      if (white[index] !== undefined) {
        state = omok.applyMove(state, white[index] as number, 2);
        assert.ok(state);
      }
    }
    return state;
  }

  const overline = prepared([108, 109, 110, 112, 113], [0, 2, 4, 6, 8]);
  assert.deepEqual(JSON.parse(JSON.stringify(omok.inspectMove(overline, 111, 1))), {
    legal: false,
    reason: "OVERLINE",
  });

  const doubleFour = prepared([109, 110, 111, 67, 82, 97], [0, 2, 4, 6, 8, 10]);
  assert.deepEqual(JSON.parse(JSON.stringify(omok.inspectMove(doubleFour, 112, 1))), {
    legal: false,
    reason: "DOUBLE_FOUR",
  });

  const doubleThree = prepared([111, 113, 97, 127], [0, 2, 4, 6]);
  assert.deepEqual(JSON.parse(JSON.stringify(omok.inspectMove(doubleThree, 112, 1))), {
    legal: false,
    reason: "DOUBLE_THREE",
  });

  // The vertical shape touches the top edge and cannot become a straight four with two
  // completion points, so only the horizontal open three is real. This must not be rejected as
  // a geometric-only double-three.
  const edgeFalseThree = prepared([21, 23, 7, 37], [150, 152, 154, 156]);
  assert.deepEqual(JSON.parse(JSON.stringify(omok.inspectMove(edgeFalseThree, 22, 1))), {
    legal: true,
    winner: 0,
  });

  let whiteOverline = omok.createState();
  for (const [black, white] of [
    [0, 108],
    [2, 109],
    [4, 110],
    [6, 112],
    [8, 113],
    [10, 111],
  ] as const) {
    whiteOverline = omok.applyMove(whiteOverline, black, 1);
    assert.ok(whiteOverline);
    whiteOverline = omok.applyMove(whiteOverline, white, 2);
    assert.ok(whiteOverline);
  }
  assert.equal((whiteOverline as { winner: number }).winner, 2);
});

test("platform runtime has no official game driver, slug gate, or removed workspace reference", () => {
  const platformRuntime = [
    read("apps/api/src/multiplayer/MultiplayerInstanceObject.ts"),
    read("apps/api/src/multiplayer/MultiplayerLobbySignalObject.ts"),
    read("apps/web/app/features/game/GameHost.tsx"),
    read("apps/web/app/features/game/runtime/gameBridgeHost.ts"),
    read("apps/web/app/features/game/runtime/multiplayerBridgeHost.ts"),
    read("apps/web/app/features/game/runtime/multiplayerRuntimeResolution.ts"),
    read("packages/game-sdk/src/bridge/browserApiSource.ts"),
  ].join("\n");
  for (const token of [
    "official-omok",
    "official:omok",
    "OmokM1Driver",
    "OmokState",
    "ReactionDriver",
    "PongDriver",
  ]) {
    assert.equal(platformRuntime.includes(token), false, token);
  }
  assert.equal(read("tsconfig.json").includes('"./games/'), false);
  const lockfile = read("pnpm-lock.yaml");
  for (const slug of frozenGameSlugs) {
    assert.equal(lockfile.includes(`  games/${slug}:`), false, slug);
  }
  const gameHost = read("apps/web/app/features/game/GameHost.tsx");
  assert.equal(gameHost.includes("getReactionTier"), false);
  assert.equal(gameHost.includes("reactionTier"), false);
  assert.match(gameHost, /game\?\.difficulty && !game\.playConfig/);
});
