import test from "node:test";
import assert from "node:assert/strict";
import {
  extractGameCreatorManifest,
  GameCreatorManifestValidationError,
  parseGameCreatorManifest,
  resolveGameCreatorManifestMultiplayerPlanV1,
} from "../src/domain/gameCreatorManifest.js";

const textBytes = (value: string) => new TextEncoder().encode(value);

function minimal() {
  return {
    schemaVersion: 1,
    game: {
      slug: "test-game",
      title: "Test",
      genre: "arcade",
      mode: "single",
      playModes: ["single"],
    },
    progression: { type: "none" },
    result: { score: null },
  };
}

function relayMultiplayerV1() {
  return {
    $schema: "https://owogg.com/schemas/manifest/v1.json",
    schemaVersion: 1,
    game: {
      slug: "creator-relay-board",
      title: "Creator Relay Board",
      genre: "board",
      mode: "multi",
      playModes: ["online-multi"],
    },
    progression: { type: "none" },
    result: { outcome: { values: ["win", "loss", "draw"] }, score: null },
    leaderboard: { enabled: false },
    multiplayer: {
      version: 1,
      transport: { kind: "websocket", protocolVersion: 1 },
      runtime: { kind: "relay" },
      players: { min: 2, max: 8 },
      features: {
        reconnect: "resume",
        directMessages: true,
        hostSnapshot: true,
        joinInProgress: false,
        spectators: false,
      },
    },
  };
}

function playConfigV1() {
  return {
    $schema: "https://owogg.com/schemas/manifest/v1.json",
    schemaVersion: 1,
    game: {
      slug: "verified-game",
      title: "Verified Game",
      genre: "skill",
      mode: "single",
      playModes: ["single"],
    },
    difficulties: [
      { id: "normal", title: "Normal", default: true },
      { id: "hard", title: "Hard" },
    ],
    playConfig: {
      version: 1,
      rulesetRevision: 1,
      verifierId: "verified-game-v1",
      variants: [
        { id: "standard", title: "Standard" },
        { id: "precision", title: "Precision" },
      ],
      allowedConfigs: [
        { difficultyId: "normal", variantId: "standard", rewardFactor: 1 },
        { difficultyId: "normal", variantId: "precision", rewardFactor: 1.1 },
        { difficultyId: "hard", variantId: "standard", rewardFactor: 1.2 },
        { difficultyId: "hard", variantId: "precision", rewardFactor: 1.3 },
      ],
    },
    progression: { type: "none" },
    result: {
      score: {
        unit: "points",
        direction: "desc",
        range: { min: 0, max: 1000, outOfRange: "reject" },
      },
    },
    leaderboard: { enabled: true },
  };
}

test("Creator Manifest v1 accepts the minimum unscored game", () => {
  const manifest = parseGameCreatorManifest(minimal());
  assert.equal(manifest.game.slug, "test-game");
  assert.equal(manifest.result.score, null);
  assert.deepEqual(manifest.game.playModes, ["single"]);
});

test("game display metadata keeps English required and accepts strict optional translations", () => {
  const manifest = parseGameCreatorManifest({
    ...minimal(),
    game: {
      ...minimal().game,
      localizations: {
        ko: { title: "테스트", shortDescription: "한국어 요약" },
        ja: { title: "テスト" },
        zh: { shortDescription: "中文摘要" },
      },
    },
  });
  assert.equal(manifest.game.title, "Test");
  assert.deepEqual(manifest.game.localizations, {
    ko: { title: "테스트", shortDescription: "한국어 요약" },
    ja: { title: "テスト" },
    zh: { shortDescription: "中文摘要" },
  });

  assert.throws(
    () =>
      parseGameCreatorManifest({
        ...minimal(),
        game: { ...minimal().game, localizations: { en: { title: "Duplicate default" } } },
      }),
    /game\.localizations\.en is not allowed/,
  );
  assert.throws(
    () =>
      parseGameCreatorManifest({
        ...minimal(),
        game: { ...minimal().game, localizations: { ko: {} } },
      }),
    /must contain title or shortDescription/,
  );
});

test("file-based descriptions require the English default and exact bundle references", () => {
  const source = {
    ...minimal(),
    game: {
      ...minimal().game,
      description: ["description.md", "description_kr.md"],
      description_images: ["guide.webp"],
    },
    presentation: { defaultMode: "theater" },
  };
  const manifest = extractGameCreatorManifest([
    {
      path: "owogg.json",
      bytes: textBytes(JSON.stringify(source)),
      contentType: "application/json",
    },
    {
      path: "description.md",
      bytes: textBytes("# English"),
      contentType: "text/markdown",
    },
    {
      path: "description_kr.md",
      bytes: textBytes("# 한국어"),
      contentType: "text/markdown",
    },
    { path: "guide.webp", bytes: textBytes("image"), contentType: "image/webp" },
  ]);
  assert.deepEqual(manifest?.game.description, ["description.md", "description_kr.md"]);
  assert.equal(manifest?.presentation?.defaultMode, "theater");

  assert.throws(
    () =>
      extractGameCreatorManifest([
        {
          path: "owogg.json",
          bytes: textBytes(JSON.stringify(source)),
          contentType: "application/json",
        },
        {
          path: "description.md",
          bytes: textBytes("# English"),
          contentType: "text/markdown",
        },
        {
          path: "description_kr.md",
          bytes: textBytes("# 한국어"),
          contentType: "text/markdown",
        },
      ]),
    /references missing file guide\.webp/,
  );

  assert.throws(
    () =>
      parseGameCreatorManifest({
        ...minimal(),
        game: { ...minimal().game, description: ["description_kr.md"] },
      }),
    /must include description\.md/,
  );

  assert.throws(
    () =>
      extractGameCreatorManifest([
        {
          path: "owogg.json",
          bytes: textBytes(JSON.stringify(source)),
          contentType: "application/json",
        },
        { path: "description.md", bytes: textBytes("   \n"), contentType: "text/markdown" },
        {
          path: "description_kr.md",
          bytes: textBytes("# 한국어"),
          contentType: "text/markdown",
        },
        { path: "guide.webp", bytes: textBytes("image"), contentType: "image/webp" },
      ]),
    /description\.md must not be blank/,
  );
});

test("description images are capped at five raster files", () => {
  assert.throws(
    () =>
      parseGameCreatorManifest({
        ...minimal(),
        game: {
          ...minimal().game,
          description: ["description.md"],
          description_images: Array.from({ length: 6 }, (_, index) => `image-${index}.png`),
        },
      }),
    /at most 5 files/,
  );

  const svgSource = {
    ...minimal(),
    game: {
      ...minimal().game,
      description: ["description.md"],
      description_images: ["unsafe.svg"],
    },
  };
  assert.throws(
    () =>
      extractGameCreatorManifest([
        {
          path: "owogg.json",
          bytes: textBytes(JSON.stringify(svgSource)),
          contentType: "application/json",
        },
        {
          path: "description.md",
          bytes: textBytes("# English"),
          contentType: "text/markdown",
        },
        { path: "unsafe.svg", bytes: textBytes("<svg/>"), contentType: "image/svg+xml" },
      ]),
    /must reference a raster image/,
  );
});

test("Creator Manifest requires the unified v1 shape and rejects other schema versions", () => {
  assert.throws(
    () =>
      parseGameCreatorManifest({
        ...minimal(),
        game: { ...minimal().game, playModes: undefined },
      }),
    /game\.playModes must be an array/,
  );
  assert.throws(
    () => parseGameCreatorManifest({ ...minimal(), schemaVersion: 99 }),
    /schemaVersion must be 1/,
  );
});

test("Creator Manifest v1 accepts single, local, and Relay online topology", () => {
  const single = parseGameCreatorManifest(minimal());
  assert.deepEqual(single.game.playModes, ["single"]);

  const local = parseGameCreatorManifest({
    ...minimal(),
    game: { ...minimal().game, mode: "multi", playModes: ["local-multi"] },
  });
  assert.deepEqual(resolveGameCreatorManifestMultiplayerPlanV1(local), {
    local: { topology: "local-multi" },
    online: null,
  });

  const online = parseGameCreatorManifest(relayMultiplayerV1());
  assert.equal(online.multiplayer?.runtime.kind, "relay");
  assert.equal(resolveGameCreatorManifestMultiplayerPlanV1(online).online?.status, "SUPPORTED_V1");
});

test("Creator Manifest v1 accepts and normalizes the full public contract", () => {
  const manifest = parseGameCreatorManifest({
    $schema: "https://owogg.com/schemas/manifest/v1.json",
    schemaVersion: 1,
    game: {
      slug: "full-game",
      title: "Full Game",
      genre: "arcade",
      mode: "single",
      playModes: ["single"],
      shortDescription: "Short",
      description: "Long",
      tags: ["action", "score"],
    },
    input: ["keyboard", "gamepad"],
    presentation: { orientation: "landscape", aspectRatio: "16:9" },
    difficulties: [
      { id: "normal", title: "Normal", default: true },
      { id: "hard", title: "Hard" },
    ],
    progression: { type: "stage", range: { min: 1, max: 10 } },
    result: {
      outcome: { values: ["success", "failure"] },
      score: {
        unit: "points",
        direction: "desc",
        precision: 0,
        range: { min: 0, max: 1000 },
      },
      metrics: { kills: { type: "integer", range: { min: 0, max: 100 } } },
    },
    leaderboard: { enabled: true },
    events: { boss_defeated: { maxPerAttempt: 1 } },
    achievements: [
      {
        id: "boss-hunter",
        title: "Boss Hunter",
        scope: "lifetime",
        condition: {
          source: "event",
          key: "boss_defeated",
          aggregate: "count",
          operator: ">=",
          value: 3,
        },
      },
    ],
  });
  assert.equal(manifest.result.score?.range.outOfRange, "clamp");
  assert.equal(manifest.progression.range?.outOfRange, "clamp");
  assert.equal(manifest.achievements?.[0]?.scope, "lifetime");
});

test("Creator Manifest rejects missing/unsupported versions, invalid slugs, and unknown fields", () => {
  assert.throws(
    () => parseGameCreatorManifest({ ...minimal(), schemaVersion: undefined }),
    GameCreatorManifestValidationError,
  );
  assert.throws(
    () => parseGameCreatorManifest({ ...minimal(), game: { ...minimal().game, slug: "Bad Slug" } }),
    GameCreatorManifestValidationError,
  );
  assert.throws(
    () => parseGameCreatorManifest({ ...minimal(), game: { ...minimal().game, mystery: true } }),
    GameCreatorManifestValidationError,
  );
});

test("Creator Manifest v1 accepts a strict Relay multiplayer request", () => {
  const manifest = parseGameCreatorManifest(relayMultiplayerV1());
  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(manifest.game.playModes, ["online-multi"]);
  assert.equal(manifest.multiplayer?.runtime.kind, "relay");
  assert.equal(manifest.multiplayer?.features.hostSnapshot, true);
  const plan = resolveGameCreatorManifestMultiplayerPlanV1(manifest);
  assert.equal(plan.local, null);
  assert.equal(plan.online?.status, "SUPPORTED_V1");
  assert.equal(
    plan.online?.status === "SUPPORTED_V1" ? plan.online.resultTrust : null,
    "UNVERIFIED",
  );
});

test("unified v1 PlayConfig parses references and normalizes its first variant as default", () => {
  const manifest = parseGameCreatorManifest(playConfigV1());
  assert.equal(manifest.playConfig?.version, 1);
  assert.equal(manifest.playConfig?.variants[0]?.default, true);
  assert.equal(manifest.playConfig?.variants[1]?.default, undefined);
  assert.equal(manifest.playConfig?.allowedConfigs[3]?.rewardFactor, 1.3);
});

test("PlayConfig rejects malformed declarations and unknown nested fields", () => {
  const valid = playConfigV1();
  const invalidPlayConfigs = [
    { ...valid.playConfig, version: 2 },
    { ...valid.playConfig, rulesetRevision: 0 },
    { ...valid.playConfig, verifierId: "Invalid Verifier" },
    { ...valid.playConfig, variants: [] },
    {
      ...valid.playConfig,
      variants: [
        { id: "standard", title: "Standard" },
        { id: "standard", title: "Duplicate" },
      ],
    },
    {
      ...valid.playConfig,
      variants: [
        { id: "standard", title: "Standard", default: true },
        { id: "precision", title: "Precision", default: true },
      ],
    },
    {
      ...valid.playConfig,
      variants: [{ id: "standard", title: "Standard", mystery: true }],
    },
    { ...valid.playConfig, allowedConfigs: [] },
    {
      ...valid.playConfig,
      allowedConfigs: [...valid.playConfig.allowedConfigs, valid.playConfig.allowedConfigs[0]],
    },
    {
      ...valid.playConfig,
      allowedConfigs: valid.playConfig.allowedConfigs.map((config, index) =>
        index === 0 ? { ...config, difficultyId: "unknown" } : config,
      ),
    },
    {
      ...valid.playConfig,
      allowedConfigs: valid.playConfig.allowedConfigs.map((config, index) =>
        index === 0 ? { ...config, variantId: "unknown" } : config,
      ),
    },
    {
      ...valid.playConfig,
      allowedConfigs: valid.playConfig.allowedConfigs.map((config, index) =>
        index === 0 ? { ...config, rewardFactor: 0 } : config,
      ),
    },
    {
      ...valid.playConfig,
      allowedConfigs: valid.playConfig.allowedConfigs.map((config, index) =>
        index === 0 ? { ...config, rewardFactor: Number.POSITIVE_INFINITY } : config,
      ),
    },
    {
      ...valid.playConfig,
      allowedConfigs: valid.playConfig.allowedConfigs.map((config, index) =>
        index === 0 ? { ...config, mystery: true } : config,
      ),
    },
  ];
  for (const playConfig of invalidPlayConfigs) {
    assert.throws(
      () => parseGameCreatorManifest({ ...valid, playConfig }),
      GameCreatorManifestValidationError,
    );
  }
});

test("PlayConfig requires complete coverage including its default pair", () => {
  const valid = playConfigV1();
  assert.throws(
    () =>
      parseGameCreatorManifest({
        ...valid,
        playConfig: {
          ...valid.playConfig,
          allowedConfigs: valid.playConfig.allowedConfigs.filter(
            (config) => config.difficultyId !== "hard",
          ),
        },
      }),
    /must include difficulty "hard"/,
  );
  assert.throws(
    () =>
      parseGameCreatorManifest({
        ...valid,
        playConfig: {
          ...valid.playConfig,
          allowedConfigs: valid.playConfig.allowedConfigs.filter(
            (config) => config.variantId !== "precision",
          ),
        },
      }),
    /must include variant "precision"/,
  );
  assert.throws(
    () =>
      parseGameCreatorManifest({
        ...valid,
        playConfig: {
          ...valid.playConfig,
          variants: [
            { id: "standard", title: "Standard" },
            { id: "precision", title: "Precision", default: true },
          ],
          allowedConfigs: valid.playConfig.allowedConfigs.filter(
            (config) => !(config.difficultyId === "normal" && config.variantId === "precision"),
          ),
        },
      }),
    /default difficulty\/variant pair/,
  );
});

test("PlayConfig uses implicit normal difficulty and requires competitive score policy", () => {
  const valid = playConfigV1();
  const withoutDifficulties = {
    ...valid,
    difficulties: undefined,
    playConfig: {
      ...valid.playConfig,
      variants: [{ id: "standard", title: "Standard" }],
      allowedConfigs: [{ difficultyId: "normal", variantId: "standard", rewardFactor: 1 }],
    },
  };
  assert.equal(
    parseGameCreatorManifest(withoutDifficulties).playConfig?.allowedConfigs[0]?.difficultyId,
    "normal",
  );
  assert.throws(
    () =>
      parseGameCreatorManifest({
        ...withoutDifficulties,
        playConfig: {
          ...withoutDifficulties.playConfig,
          allowedConfigs: [{ difficultyId: "easy", variantId: "standard", rewardFactor: 1 }],
        },
      }),
    /difficultyId "easy" is not declared/,
  );
  assert.throws(
    () => parseGameCreatorManifest({ ...valid, result: { score: null } }),
    GameCreatorManifestValidationError,
  );
  assert.throws(
    () => parseGameCreatorManifest({ ...valid, leaderboard: { enabled: false } }),
    /requires leaderboard.enabled to be true/,
  );
});

test("PlayConfig coexists with Relay online only when a generic hybrid topology is explicit", () => {
  const online = relayMultiplayerV1();
  const config = playConfigV1();
  assert.throws(
    () =>
      parseGameCreatorManifest({
        ...online,
        difficulties: config.difficulties,
        result: config.result,
        leaderboard: config.leaderboard,
        playConfig: config.playConfig,
      }),
    /requires single or local-multi/,
  );

  const hybrid = parseGameCreatorManifest({
    ...online,
    game: { ...online.game, playModes: ["local-multi", "online-multi"] },
    difficulties: config.difficulties,
    result: config.result,
    leaderboard: config.leaderboard,
    playConfig: config.playConfig,
  });
  assert.deepEqual(hybrid.game.playModes, ["local-multi", "online-multi"]);
  assert.equal(hybrid.playConfig?.verifierId, config.playConfig.verifierId);
  assert.equal(hybrid.multiplayer?.runtime.kind, online.multiplayer?.runtime.kind);
});

test("manifest topology planning resolves local play independently from the online runtime", () => {
  const localV1 = parseGameCreatorManifest({
    ...minimal(),
    game: { ...minimal().game, mode: "multi", playModes: ["local-multi"] },
  });
  assert.deepEqual(resolveGameCreatorManifestMultiplayerPlanV1(localV1), {
    local: { topology: "local-multi" },
    online: null,
  });

  const hybrid = relayMultiplayerV1();
  const manifest = parseGameCreatorManifest({
    ...hybrid,
    game: { ...hybrid.game, playModes: ["local-multi", "online-multi"] },
  });
  const plan = resolveGameCreatorManifestMultiplayerPlanV1(manifest);
  assert.deepEqual(plan.local, { topology: "local-multi" });
  assert.equal(plan.online?.status, "SUPPORTED_V1");
  assert.equal(plan.online?.status === "SUPPORTED_V1" ? plan.online.runtimeKind : null, "relay");
});

test("Creator Manifest v1 keeps Relay request, schema URL, and leaderboard consistent", () => {
  const online = relayMultiplayerV1();
  const externallyProfiled = parseGameCreatorManifest({ ...online, multiplayer: undefined });
  assert.deepEqual(externallyProfiled.game.playModes, ["online-multi"]);
  assert.equal(resolveGameCreatorManifestMultiplayerPlanV1(externallyProfiled).online, null);
  assert.throws(
    () =>
      parseGameCreatorManifest({
        ...online,
        game: { ...online.game, playModes: ["local-multi"] },
      }),
    /multiplayer requires online-multi/,
  );
  assert.throws(
    () =>
      parseGameCreatorManifest({
        ...online,
        result: {
          ...online.result,
          score: {
            unit: "points",
            direction: "desc",
            range: { min: 0, max: 100 },
          },
        },
        leaderboard: { enabled: true },
      }),
    /only for a hybrid PlayConfig path/,
  );
  assert.throws(
    () => parseGameCreatorManifest({ ...online, $schema: "https://example.invalid/v1.json" }),
    /manifest\.\$schema/,
  );
});

test("Creator Manifest v1 rejects game-specific server authority fields", () => {
  const online = relayMultiplayerV1();
  for (const forbidden of [
    { resolvedClass: "M2" },
    { runtimeBackend: "durable-object" },
    { rewardPolicy: { xp: 9999 } },
    { websocketUrl: "wss://example.invalid" },
    { serverCode: "while(true){}" },
  ]) {
    assert.throws(
      () =>
        parseGameCreatorManifest({
          ...online,
          multiplayer: { ...online.multiplayer, ...forbidden },
        }),
      GameCreatorManifestValidationError,
    );
  }
});

test("Creator Manifest v1 accepts every progression type and rejects unknown ones", () => {
  for (const type of [
    "none",
    "endless",
    "stage",
    "level",
    "round",
    "wave",
    "chapter",
    "lap",
    "custom",
  ]) {
    assert.equal(
      parseGameCreatorManifest({ ...minimal(), progression: { type } }).progression.type,
      type,
    );
  }
  assert.throws(
    () => parseGameCreatorManifest({ ...minimal(), progression: { type: "unknown" } }),
    GameCreatorManifestValidationError,
  );
});

test("Creator Manifest v1 rejects unknown authority/session fields", () => {
  for (const field of ["userId", "token", "apiUrl", "publisher"]) {
    assert.throws(
      () => parseGameCreatorManifest({ ...minimal(), [field]: "forbidden" }),
      GameCreatorManifestValidationError,
    );
  }
});

test("Creator Manifest v1 normalizes range policy and checks semantic ranges", () => {
  const parsed = parseGameCreatorManifest({
    ...minimal(),
    result: {
      score: { unit: "points", direction: "desc", range: { min: 0, max: 100 } },
    },
  });
  assert.equal(parsed.result.score?.range.outOfRange, "clamp");
  assert.throws(
    () =>
      parseGameCreatorManifest({
        ...minimal(),
        result: {
          score: { unit: "points", direction: "desc", range: { min: 10, max: 10 } },
        },
      }),
    GameCreatorManifestValidationError,
  );
});

test("leaderboard requires score and difficulties have at most one default", () => {
  assert.throws(
    () => parseGameCreatorManifest({ ...minimal(), leaderboard: { enabled: true } }),
    GameCreatorManifestValidationError,
  );
  assert.throws(
    () =>
      parseGameCreatorManifest({
        ...minimal(),
        difficulties: [
          { id: "easy", title: "Easy", default: true },
          { id: "hard", title: "Hard", default: true },
        ],
      }),
    GameCreatorManifestValidationError,
  );
});

test("achievement metric/event keys must reference declarations", () => {
  assert.throws(
    () =>
      parseGameCreatorManifest({
        ...minimal(),
        achievements: [
          {
            id: "missing-metric",
            title: "Missing",
            condition: { source: "metric", key: "kills", operator: ">=", value: 1 },
          },
        ],
      }),
    GameCreatorManifestValidationError,
  );
});
