import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const relayRuntimeUrl = new URL(
  "../apps/api/src/multiplayer/RelayRuntimeSession.ts",
  import.meta.url,
);

const activeSourceRoots = [
  new URL("../apps/api/src/", import.meta.url),
  new URL("../apps/web/app/", import.meta.url),
  new URL("../packages/core/src/", import.meta.url),
  new URL("../packages/contracts/src/", import.meta.url),
  new URL("../packages/game-sdk/src/", import.meta.url),
  new URL("../packages/db/src/", import.meta.url),
] as const;

async function listActiveSourceFiles(directory: URL): Promise<URL[]> {
  const files: URL[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === "test" || entry.name === "tests") continue;
      files.push(...(await listActiveSourceFiles(new URL(`${entry.name}/`, directory))));
    } else if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)) {
      files.push(new URL(entry.name, directory));
    }
  }
  return files;
}

test("Relay runtime stays game-agnostic and never opens a D1 action path", async () => {
  const source = await readFile(relayRuntimeUrl, "utf8");
  for (const forbidden of [
    /rulesets\//i,
    /omok/i,
    /reactionm2/i,
    /paddlem2/i,
    /multiplayerMatchRepo/,
    /recordAction\s*\(/,
    /terminalResult/,
    /rewardPolicy/,
    /@owogg\/db/,
    /env\.DB/,
  ]) {
    assert.doesNotMatch(source, forbidden);
  }
  assert.doesNotMatch(source, /\bset(?:Timeout|Interval)\s*\(/);
  assert.match(source, /CREATE TABLE IF NOT EXISTS relay_runtime/);
  assert.match(source, /state\.getWebSockets\(/);
  assert.match(source, /resultTrust:\s*policy\.resultTrust/);
});

test("Relay runtime persists no per-message application ledger", async () => {
  const source = await readFile(relayRuntimeUrl, "utf8");
  const createTables = [...source.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z_]+)/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(createTables, [
    "relay_authority",
    "relay_runtime",
    "relay_bundle_authority",
    "relay_startup_deadline",
  ]);
  assert.equal(
    createTables.some((table) => /action|message|event|result/.test(table ?? "")),
    false,
  );
});

test("active source cannot restore a game-specific multiplayer engine", async () => {
  const forbiddenFiles = [
    "../apps/api/src/multiplayer/rulesets/MultiplayerRulesetDriver.ts",
    "../apps/api/src/multiplayer/rulesets/OmokM1Driver.ts",
    "../apps/api/src/multiplayer/rulesets/ReactionM2Driver.ts",
    "../apps/api/src/multiplayer/rulesets/PaddleM2Driver.ts",
    "../packages/core/src/modules/multiplayer/rules/omokRules.ts",
    "../packages/core/src/modules/multiplayer/rules/reactionDuelRules.ts",
    "../packages/core/src/modules/multiplayer/rules/paddleDuelRules.ts",
  ];
  for (const file of forbiddenFiles) {
    assert.equal(existsSync(new URL(file, import.meta.url)), false, file);
  }

  const forbiddenTokens = [
    /official:omok/i,
    /official-omok/i,
    /OMOK_V1/,
    /OmokM1Driver/,
    /ReactionM2Driver/,
    /PaddleM2Driver/,
    /MultiplayerRulesetDriver/,
    /managed:turn-grid/i,
    /managed:reaction-arena/i,
    /managed:realtime-paddle/i,
    /MULTI_ACTION/,
    /MULTI_INPUT/,
    /MULTI_TERMINAL/,
  ];
  const files = (await Promise.all(activeSourceRoots.map(listActiveSourceFiles))).flat();
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const forbidden of forbiddenTokens) {
      assert.doesNotMatch(source, forbidden, `${file.pathname} contains ${forbidden}`);
    }
  }
});
