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
  for (const game of officialV1Games) {
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
  const vector = {
    challengeSeed: "phase-seven-parity-0000000001",
    difficultyId: "hard" as const,
  };
  const reaction = loadBrowserRules<{
    createWaits(input: {
      challengeSeed: string;
      difficultyId: "hard";
      variantId: "focus";
    }): readonly number[];
  }>("reaction-time", "OwoggReactionRules");
  assert.deepEqual(
    [...reaction.createWaits({ ...vector, variantId: "focus" })],
    [...createReactionTimeWaits({ ...vector, variantId: "focus" })],
  );

  const aim = loadBrowserRules<{
    createTargets(input: {
      challengeSeed: string;
      difficultyId: "hard";
      variantId: "precision";
    }): readonly { readonly x: number; readonly y: number; readonly radius: number }[];
  }>("aim-test", "OwoggAimRules");
  assert.deepEqual(
    JSON.parse(JSON.stringify(aim.createTargets({ ...vector, variantId: "precision" }))),
    createAimTestTargets({ ...vector, variantId: "precision" }),
  );

  const typing = loadBrowserRules<{
    createChallenge(input: { challengeSeed: string; difficultyId: "hard"; variantId: "en" }): {
      readonly passageId: string;
      readonly text: string;
    };
  }>("typing-test", "OwoggTypingRules");
  assert.deepEqual(
    { ...typing.createChallenge({ ...vector, variantId: "en" }) },
    createTypingTestChallenge({ ...vector, variantId: "en" }),
  );

  const memory = loadBrowserRules<{
    createChallenge(input: { challengeSeed: string; difficultyId: "hard"; variantId: "reverse" }): {
      readonly sequence: readonly number[];
      readonly maxLevel: number;
      readonly extra: number;
    };
    expectedForLevel(
      challenge: { readonly sequence: readonly number[]; readonly extra: number },
      level: number,
      variantId: "reverse",
    ): readonly number[];
  }>("memory-test", "OwoggMemoryRules");
  const browserMemory = memory.createChallenge({ ...vector, variantId: "reverse" });
  const serverMemory = createMemoryTestChallenge({ ...vector, variantId: "reverse" });
  assert.deepEqual(JSON.parse(JSON.stringify(browserMemory)), serverMemory);
  assert.deepEqual(
    [...memory.expectedForLevel(browserMemory, 4, "reverse")],
    [...memoryTestExpectedForLevel(serverMemory, 4, "reverse")],
  );
});

test("Omok application rules stay inside the ZIP and support local state transitions", () => {
  const omok = loadBrowserRules<{
    readonly SIZE: number;
    readonly PROTOCOL: string;
    createState(): unknown;
    applyMove(state: unknown, index: number, color: number): unknown;
    parseState(state: unknown): { readonly revision: number; readonly moves: number } | null;
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
  assert.equal(omok.PROTOCOL, "owogg-omok/v1");
  assert.deepEqual(omok.parseState(state), state);
  assert.equal((state as { winner: number }).winner, 1);
});

test("platform runtime has no official game driver, slug gate, or removed workspace reference", () => {
  const relayRuntime = [
    read("apps/api/src/multiplayer/MultiplayerInstanceObject.ts"),
    read("apps/api/src/multiplayer/MultiplayerLobbySignalObject.ts"),
  ].join("\n");
  for (const token of [
    "official-omok",
    "official:omok",
    "OmokM1Driver",
    "OmokState",
    "ReactionDriver",
    "PongDriver",
  ]) {
    assert.equal(relayRuntime.includes(token), false, token);
  }
  assert.equal(read("tsconfig.json").includes('"./games/'), false);
  const lockfile = read("pnpm-lock.yaml");
  for (const slug of frozenGameSlugs) {
    assert.equal(lockfile.includes(`  games/${slug}:`), false, slug);
  }
  const gameHost = read("apps/web/app/features/game/GameHost.tsx");
  assert.equal(gameHost.includes("getReactionTier"), false);
  assert.equal(gameHost.includes("reactionTier"), false);
});
