import {
  OWOGG_GAME_CREATOR_MANIFEST_FILENAME,
  OWOGG_GAME_CREATOR_MANIFEST_SCHEMA_URL,
  OWOGG_GAME_CREATOR_MANIFEST_VERSION,
  OWOGG_PLAY_CONFIG_VERSION,
  type OwoggAchievementAggregate,
  type OwoggAchievementCondition,
  type OwoggAchievementDefinition,
  type OwoggAchievementScope,
  type OwoggAchievementSource,
  type OwoggComparisonOperator,
  type OwoggGameCreatorManifest,
  type OwoggDifficultyDefinition,
  type OwoggEventDefinition,
  type OwoggDescriptionFile,
  type OwoggGameScreenMode,
  type OwoggInputMethod,
  type OwoggManifestGame,
  type OwoggManifestPlayConfig,
  type OwoggManifestPresentation,
  type OwoggMetricDefinition,
  type OwoggMetricType,
  type OwoggOrientation,
  type OwoggOutcome,
  type OwoggPlayMode,
  type OwoggPlayConfigAllowedConfig,
  type OwoggPlayConfigVariantDefinition,
  type OwoggProgressionDefinition,
  type OwoggProgressionType,
  type OwoggRangeDefinition,
  type OwoggRangePolicy,
  type OwoggResultDefinition,
  type OwoggScoreDefinition,
} from "@owogg/game-sdk/contracts";
import {
  MultiplayerProfileRequestValidationError,
  parseMultiplayerRuntimeProfileRequestV1,
  resolveMultiplayerRuntimeProfileRequestV1,
  toOwoggMultiplayerRuntimeRequestV1,
  type MultiplayerRuntimeRequestResolutionV1,
} from "../modules/multiplayer/domain/multiplayerProfileRequest.js";
import { SANDBOX_GAME_POLICY } from "./sandboxGames.js";
import {
  normalizeBundleEntryPath,
  resolveBundleContentType,
  type PreparedBundleFile,
} from "./sandboxGameBundle.js";

export { OWOGG_GAME_CREATOR_MANIFEST_FILENAME };

export type GameDescriptionLocale = "en" | "ko" | "ja" | "zh";

export const GAME_DESCRIPTION_FILE_LOCALES = {
  "description.md": "en",
  "description_kr.md": "ko",
  "description_ja.md": "ja",
  "description_zh.md": "zh",
} as const satisfies Readonly<Record<OwoggDescriptionFile, GameDescriptionLocale>>;

export const GAME_DESCRIPTION_POLICY = {
  MAX_MARKDOWN_BYTES_PER_FILE: 64 * 1024,
  MAX_IMAGE_COUNT: 5,
  MAX_IMAGE_BYTES_PER_FILE: 5 * 1024 * 1024,
} as const;

export interface GameDescriptionDocument {
  readonly locale: GameDescriptionLocale;
  readonly path: OwoggDescriptionFile;
  readonly markdown: string;
}

export class GameCreatorManifestValidationError extends Error {
  constructor(public readonly detail: string) {
    super(`INVALID_OWOGG_MANIFEST: ${detail}`);
  }
}

function invalid(detail: string): never {
  throw new GameCreatorManifestValidationError(detail);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) invalid(`${path}.${key} is not allowed`);
  }
}

function requiredString(
  value: Record<string, unknown>,
  key: string,
  path: string,
  options: { min?: number; max?: number; pattern?: RegExp } = {},
): string {
  const candidate = value[key];
  if (typeof candidate !== "string") invalid(`${path}.${key} must be a string`);
  if (candidate.length < (options.min ?? 0)) invalid(`${path}.${key} is too short`);
  if ((options.min ?? 0) > 0 && candidate.trim().length === 0) {
    invalid(`${path}.${key} must not be blank`);
  }
  if (options.max !== undefined && candidate.length > options.max) {
    invalid(`${path}.${key} is too long`);
  }
  if (options.pattern && !options.pattern.test(candidate)) {
    invalid(`${path}.${key} has an invalid format`);
  }
  return candidate;
}

function optionalString(
  value: Record<string, unknown>,
  key: string,
  path: string,
  options: { min?: number; max?: number; pattern?: RegExp } = {},
): string | undefined {
  if (value[key] === undefined) return undefined;
  return requiredString(value, key, path, options);
}

function requiredNumber(value: Record<string, unknown>, key: string, path: string): number {
  const candidate = value[key];
  if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
    invalid(`${path}.${key} must be a finite number`);
  }
  return candidate;
}

function requiredPositiveInteger(
  value: Record<string, unknown>,
  key: string,
  path: string,
): number {
  const candidate = value[key];
  if (typeof candidate !== "number" || !Number.isSafeInteger(candidate) || candidate <= 0) {
    invalid(`${path}.${key} must be a positive integer`);
  }
  return candidate;
}

function enumValue<T extends string>(
  value: Record<string, unknown>,
  key: string,
  path: string,
  allowed: readonly T[],
): T {
  const candidate = value[key];
  if (typeof candidate !== "string" || !(allowed as readonly string[]).includes(candidate)) {
    invalid(`${path}.${key} must be one of ${allowed.join(", ")}`);
  }
  return candidate as T;
}

function optionalBoolean(
  value: Record<string, unknown>,
  key: string,
  path: string,
): boolean | undefined {
  const candidate = value[key];
  if (candidate === undefined) return undefined;
  if (typeof candidate !== "boolean") invalid(`${path}.${key} must be a boolean`);
  return candidate;
}

function uniqueStrings(
  value: unknown,
  path: string,
  allowed?: readonly string[],
): readonly string[] {
  if (!Array.isArray(value)) invalid(`${path} must be an array`);
  const output = value.map((candidate, index) => {
    if (typeof candidate !== "string" || candidate.trim().length === 0) {
      invalid(`${path}[${index}] must be a non-empty string`);
    }
    if (allowed && !allowed.includes(candidate)) {
      invalid(`${path}[${index}] must be one of ${allowed.join(", ")}`);
    }
    return candidate;
  });
  if (new Set(output).size !== output.length) invalid(`${path} must not contain duplicates`);
  return output;
}

const RANGE_POLICIES = ["clamp", "reject"] as const satisfies readonly OwoggRangePolicy[];

function parseRange(value: unknown, path: string): OwoggRangeDefinition {
  const source = record(value, path);
  exactKeys(source, ["min", "max", "outOfRange"], path);
  const min = requiredNumber(source, "min", path);
  const max = requiredNumber(source, "max", path);
  if (min >= max) invalid(`${path}.min must be less than ${path}.max`);
  const outOfRange =
    source.outOfRange === undefined
      ? "clamp"
      : enumValue(source, "outOfRange", path, RANGE_POLICIES);
  return { min, max, outOfRange };
}

function parseGame(value: unknown): OwoggManifestGame {
  const source = record(value, "game");
  exactKeys(
    source,
    [
      "slug",
      "title",
      "genre",
      "mode",
      "shortDescription",
      "description",
      "description_images",
      "tags",
      "playModes",
    ],
    "game",
  );
  const shortDescription = optionalString(source, "shortDescription", "game", {
    max: SANDBOX_GAME_POLICY.MAX_SHORT_DESCRIPTION_LENGTH,
  });
  const description =
    source.description === undefined
      ? undefined
      : typeof source.description === "string"
        ? optionalString(source, "description", "game", {
            max: SANDBOX_GAME_POLICY.MAX_DESCRIPTION_LENGTH,
          })
        : (uniqueStrings(source.description, "game.description", [
            "description.md",
            "description_kr.md",
            "description_ja.md",
            "description_zh.md",
          ] as const satisfies readonly OwoggDescriptionFile[]) as readonly OwoggDescriptionFile[]);
  if (Array.isArray(description)) {
    if (description.length === 0) invalid("game.description must not be empty");
    if (!description.includes("description.md")) {
      invalid("game.description must include description.md as the English default");
    }
  }
  const descriptionImages =
    source.description_images === undefined
      ? undefined
      : uniqueStrings(source.description_images, "game.description_images");
  if ((descriptionImages?.length ?? 0) > GAME_DESCRIPTION_POLICY.MAX_IMAGE_COUNT) {
    invalid(
      `game.description_images must contain at most ${GAME_DESCRIPTION_POLICY.MAX_IMAGE_COUNT} files`,
    );
  }
  const tags = source.tags === undefined ? undefined : uniqueStrings(source.tags, "game.tags");
  if ((tags?.length ?? 0) > 20) invalid("game.tags must contain at most 20 tags");
  if (tags?.some((tag) => tag.length > 40))
    invalid("game.tags entries must be at most 40 characters");
  const mode = enumValue(source, "mode", "game", ["single", "multi"] as const);
  const common: Omit<OwoggManifestGame, "playModes"> = {
    slug: requiredString(source, "slug", "game", {
      min: SANDBOX_GAME_POLICY.MIN_SLUG_LENGTH,
      max: SANDBOX_GAME_POLICY.MAX_SLUG_LENGTH,
      pattern: /^[a-z0-9-]+$/,
    }),
    title: requiredString(source, "title", "game", {
      min: SANDBOX_GAME_POLICY.MIN_TITLE_LENGTH,
      max: SANDBOX_GAME_POLICY.MAX_TITLE_LENGTH,
    }),
    genre: requiredString(source, "genre", "game", { min: 1 }),
    mode,
    ...(shortDescription !== undefined ? { shortDescription } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(descriptionImages !== undefined ? { description_images: descriptionImages } : {}),
    ...(tags !== undefined ? { tags } : {}),
  };
  const playModes = uniqueStrings(source.playModes, "game.playModes", [
    "single",
    "local-multi",
    "online-multi",
  ] as const satisfies readonly OwoggPlayMode[]) as readonly OwoggPlayMode[];
  if (playModes.length === 0) invalid("game.playModes must not be empty");
  const hasMultiplayerMode = playModes.some((playMode) => playMode !== "single");
  if (mode === "single" && (playModes.length !== 1 || playModes[0] !== "single")) {
    invalid('game.mode "single" requires game.playModes to contain only "single"');
  }
  if (mode === "multi" && !hasMultiplayerMode) {
    invalid('game.mode "multi" requires local-multi or online-multi in game.playModes');
  }
  return { ...common, playModes };
}

function parsePresentation(value: unknown): OwoggManifestPresentation {
  const source = record(value, "presentation");
  exactKeys(source, ["orientation", "aspectRatio", "defaultMode"], "presentation");
  const orientation =
    source.orientation === undefined
      ? undefined
      : enumValue(source, "orientation", "presentation", [
          "any",
          "landscape",
          "portrait",
        ] as const satisfies readonly OwoggOrientation[]);
  const aspectRatio = optionalString(source, "aspectRatio", "presentation", {
    pattern: /^[1-9][0-9]*:[1-9][0-9]*$/,
  });
  const defaultMode =
    source.defaultMode === undefined
      ? undefined
      : enumValue(source, "defaultMode", "presentation", [
          "default",
          "theater",
        ] as const satisfies readonly OwoggGameScreenMode[]);
  return {
    ...(orientation !== undefined ? { orientation } : {}),
    ...(aspectRatio !== undefined ? { aspectRatio } : {}),
    ...(defaultMode !== undefined ? { defaultMode } : {}),
  };
}

function parseDifficulties(value: unknown): readonly OwoggDifficultyDefinition[] {
  if (!Array.isArray(value) || value.length === 0) {
    invalid("difficulties must be a non-empty array when present");
  }
  const difficulties = value.map((entry, index) => {
    const path = `difficulties[${index}]`;
    const source = record(entry, path);
    exactKeys(source, ["id", "title", "default"], path);
    const isDefault = optionalBoolean(source, "default", path);
    return {
      id: requiredString(source, "id", path, { min: 1, max: 100 }),
      title: requiredString(source, "title", path, { min: 1, max: 60 }),
      ...(isDefault !== undefined ? { default: isDefault } : {}),
    };
  });
  const ids = difficulties.map((difficulty) => difficulty.id);
  if (new Set(ids).size !== ids.length) invalid("difficulties ids must be unique");
  if (difficulties.filter((difficulty) => difficulty.default === true).length > 1) {
    invalid("difficulties may contain at most one default");
  }
  return difficulties;
}

const STABLE_IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._:/-]{0,95}$/;

function parsePlayConfigVariants(value: unknown): readonly OwoggPlayConfigVariantDefinition[] {
  if (!Array.isArray(value) || value.length === 0) {
    invalid("playConfig.variants must be a non-empty array");
  }
  const variants = value.map((entry, index) => {
    const path = `playConfig.variants[${index}]`;
    const source = record(entry, path);
    exactKeys(source, ["id", "title", "default"], path);
    const isDefault = optionalBoolean(source, "default", path);
    return {
      id: requiredString(source, "id", path, { min: 1, max: 100 }),
      title: requiredString(source, "title", path, { min: 1, max: 60 }),
      ...(isDefault !== undefined ? { default: isDefault } : {}),
    };
  });
  const ids = variants.map((variant) => variant.id);
  if (new Set(ids).size !== ids.length) invalid("playConfig.variants ids must be unique");
  if (variants.filter((variant) => variant.default === true).length > 1) {
    invalid("playConfig.variants may contain at most one default");
  }
  if (variants.some((variant) => variant.default === true)) return variants;
  return variants.map((variant, index) => (index === 0 ? { ...variant, default: true } : variant));
}

function parsePlayConfigAllowedConfigs(value: unknown): readonly OwoggPlayConfigAllowedConfig[] {
  if (!Array.isArray(value) || value.length === 0) {
    invalid("playConfig.allowedConfigs must be a non-empty array");
  }
  return value.map((entry, index) => {
    const path = `playConfig.allowedConfigs[${index}]`;
    const source = record(entry, path);
    exactKeys(source, ["difficultyId", "variantId", "rewardFactor"], path);
    const rewardFactor = requiredNumber(source, "rewardFactor", path);
    if (rewardFactor <= 0) invalid(`${path}.rewardFactor must be greater than zero`);
    return {
      difficultyId: requiredString(source, "difficultyId", path, { min: 1, max: 100 }),
      variantId: requiredString(source, "variantId", path, { min: 1, max: 100 }),
      rewardFactor,
    };
  });
}

function parsePlayConfig(
  value: unknown,
  input: {
    readonly difficulties: readonly OwoggDifficultyDefinition[] | undefined;
    readonly result: OwoggResultDefinition;
    readonly leaderboard: { readonly enabled: boolean } | undefined;
    readonly genericPlayModeAvailable: boolean;
  },
): OwoggManifestPlayConfig {
  const source = record(value, "playConfig");
  exactKeys(
    source,
    ["version", "rulesetRevision", "verifierId", "variants", "allowedConfigs"],
    "playConfig",
  );
  if (source.version !== OWOGG_PLAY_CONFIG_VERSION) {
    invalid(`playConfig.version must be ${OWOGG_PLAY_CONFIG_VERSION}`);
  }
  const rulesetRevision = requiredPositiveInteger(source, "rulesetRevision", "playConfig");
  const verifierId = requiredString(source, "verifierId", "playConfig", {
    min: 1,
    max: 96,
    pattern: STABLE_IDENTIFIER_PATTERN,
  });
  const variants = parsePlayConfigVariants(source.variants);
  const allowedConfigs = parsePlayConfigAllowedConfigs(source.allowedConfigs);

  const difficultyIds = input.difficulties?.map((difficulty) => difficulty.id) ?? ["normal"];
  const difficultyIdSet = new Set(difficultyIds);
  const variantIds = variants.map((variant) => variant.id);
  const variantIdSet = new Set(variantIds);
  const pairs = new Set<string>();
  for (const allowedConfig of allowedConfigs) {
    if (!difficultyIdSet.has(allowedConfig.difficultyId)) {
      invalid(
        `playConfig.allowedConfigs difficultyId ${JSON.stringify(allowedConfig.difficultyId)} is not declared`,
      );
    }
    if (!variantIdSet.has(allowedConfig.variantId)) {
      invalid(
        `playConfig.allowedConfigs variantId ${JSON.stringify(allowedConfig.variantId)} is not declared`,
      );
    }
    const pair = `${allowedConfig.difficultyId}\u0000${allowedConfig.variantId}`;
    if (pairs.has(pair)) {
      invalid("playConfig.allowedConfigs must not contain duplicate difficulty/variant pairs");
    }
    pairs.add(pair);
  }

  for (const difficultyId of difficultyIds) {
    if (!allowedConfigs.some((allowedConfig) => allowedConfig.difficultyId === difficultyId)) {
      invalid(`playConfig.allowedConfigs must include difficulty ${JSON.stringify(difficultyId)}`);
    }
  }
  for (const variantId of variantIds) {
    if (!allowedConfigs.some((allowedConfig) => allowedConfig.variantId === variantId)) {
      invalid(`playConfig.allowedConfigs must include variant ${JSON.stringify(variantId)}`);
    }
  }

  const defaultDifficultyId =
    input.difficulties?.find((difficulty) => difficulty.default === true)?.id ??
    input.difficulties?.[0]?.id ??
    "normal";
  const defaultVariantId = variants.find((variant) => variant.default === true)?.id;
  if (
    defaultVariantId === undefined ||
    !pairs.has(`${defaultDifficultyId}\u0000${defaultVariantId}`)
  ) {
    invalid("playConfig.allowedConfigs must include the default difficulty/variant pair");
  }
  if (input.result.score === null) invalid("playConfig requires result.score");
  if (input.leaderboard?.enabled !== true) {
    invalid("playConfig requires leaderboard.enabled to be true");
  }
  if (!input.genericPlayModeAvailable) {
    invalid("playConfig requires single or local-multi in game.playModes");
  }

  return {
    version: OWOGG_PLAY_CONFIG_VERSION,
    rulesetRevision,
    verifierId,
    variants,
    allowedConfigs,
  };
}

const PROGRESSION_TYPES = [
  "none",
  "endless",
  "stage",
  "level",
  "round",
  "wave",
  "chapter",
  "lap",
  "custom",
] as const satisfies readonly OwoggProgressionType[];

function parseProgression(value: unknown): OwoggProgressionDefinition {
  const source = record(value, "progression");
  exactKeys(source, ["type", "range"], "progression");
  const type = enumValue(source, "type", "progression", PROGRESSION_TYPES);
  const range =
    source.range === undefined ? undefined : parseRange(source.range, "progression.range");
  if (type === "none" && range !== undefined) {
    invalid('progression.range is not allowed when progression.type is "none"');
  }
  return { type, ...(range !== undefined ? { range } : {}) };
}

function parseScore(value: unknown): OwoggScoreDefinition {
  const source = record(value, "result.score");
  exactKeys(source, ["unit", "direction", "precision", "range"], "result.score");
  const precision = source.precision;
  if (
    precision !== undefined &&
    (typeof precision !== "number" ||
      !Number.isInteger(precision) ||
      precision < 0 ||
      precision > 6)
  ) {
    invalid("result.score.precision must be an integer between 0 and 6");
  }
  if (source.range === undefined) invalid("result.score.range is required");
  return {
    unit: requiredString(source, "unit", "result.score", { min: 1 }),
    direction: enumValue(source, "direction", "result.score", ["asc", "desc"] as const),
    ...(typeof precision === "number" ? { precision } : {}),
    range: parseRange(source.range, "result.score.range"),
  };
}

function parseMetric(value: unknown, path: string): OwoggMetricDefinition {
  const source = record(value, path);
  exactKeys(source, ["type", "range"], path);
  const type = enumValue(source, "type", path, [
    "integer",
    "number",
  ] as const satisfies readonly OwoggMetricType[]);
  const range = source.range === undefined ? undefined : parseRange(source.range, `${path}.range`);
  return { type, ...(range !== undefined ? { range } : {}) };
}

const FACT_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

function parseMetrics(value: unknown): Readonly<Record<string, OwoggMetricDefinition>> {
  const source = record(value, "result.metrics");
  return Object.fromEntries(
    Object.entries(source).map(([key, metric]) => {
      if (!FACT_KEY_PATTERN.test(key))
        invalid(`result.metrics key ${JSON.stringify(key)} is invalid`);
      return [key, parseMetric(metric, `result.metrics.${key}`)];
    }),
  );
}

function parseResult(value: unknown): OwoggResultDefinition {
  const source = record(value, "result");
  exactKeys(source, ["outcome", "score", "metrics"], "result");
  if (!("score" in source)) invalid("result.score is required");

  let outcome: OwoggResultDefinition["outcome"];
  if (source.outcome === null) {
    outcome = null;
  } else if (source.outcome !== undefined) {
    const outcomeSource = record(source.outcome, "result.outcome");
    exactKeys(outcomeSource, ["values"], "result.outcome");
    const values = uniqueStrings(outcomeSource.values, "result.outcome.values", [
      "neutral",
      "success",
      "failure",
      "win",
      "loss",
      "draw",
    ] as const satisfies readonly OwoggOutcome[]) as readonly OwoggOutcome[];
    if (values.length === 0) invalid("result.outcome.values must not be empty");
    outcome = { values };
  }

  const metrics = source.metrics === undefined ? undefined : parseMetrics(source.metrics);
  return {
    ...(outcome !== undefined ? { outcome } : {}),
    score: source.score === null ? null : parseScore(source.score),
    ...(metrics !== undefined ? { metrics } : {}),
  };
}

function parseEvents(value: unknown): Readonly<Record<string, OwoggEventDefinition>> {
  const source = record(value, "events");
  return Object.fromEntries(
    Object.entries(source).map(([key, event]) => {
      if (!FACT_KEY_PATTERN.test(key)) invalid(`events key ${JSON.stringify(key)} is invalid`);
      const path = `events.${key}`;
      const eventSource = record(event, path);
      exactKeys(eventSource, ["maxPerAttempt"], path);
      const maxPerAttempt = eventSource.maxPerAttempt;
      if (
        maxPerAttempt !== undefined &&
        (typeof maxPerAttempt !== "number" || !Number.isInteger(maxPerAttempt) || maxPerAttempt < 1)
      ) {
        invalid(`${path}.maxPerAttempt must be a positive integer`);
      }
      return [key, typeof maxPerAttempt === "number" ? { maxPerAttempt } : {}];
    }),
  );
}

const ACHIEVEMENT_SOURCES = [
  "score",
  "outcome",
  "progression",
  "metric",
  "event",
] as const satisfies readonly OwoggAchievementSource[];
const ACHIEVEMENT_AGGREGATES = [
  "max",
  "min",
  "sum",
  "count",
] as const satisfies readonly OwoggAchievementAggregate[];
const COMPARISON_OPERATORS = [
  "==",
  "!=",
  ">",
  ">=",
  "<",
  "<=",
] as const satisfies readonly OwoggComparisonOperator[];

function parseCondition(value: unknown, path: string): OwoggAchievementCondition {
  const source = record(value, path);
  exactKeys(source, ["source", "key", "aggregate", "operator", "value"], path);
  const factSource = enumValue(source, "source", path, ACHIEVEMENT_SOURCES);
  const key = optionalString(source, "key", path, { min: 1 });
  const aggregate =
    source.aggregate === undefined
      ? undefined
      : enumValue(source, "aggregate", path, ACHIEVEMENT_AGGREGATES);
  const operator = enumValue(source, "operator", path, COMPARISON_OPERATORS);
  const conditionValue = source.value;
  if (
    (typeof conditionValue !== "number" || !Number.isFinite(conditionValue)) &&
    typeof conditionValue !== "string" &&
    typeof conditionValue !== "boolean"
  ) {
    invalid(`${path}.value must be a finite number, string, or boolean`);
  }
  return {
    source: factSource,
    ...(key !== undefined ? { key } : {}),
    ...(aggregate !== undefined ? { aggregate } : {}),
    operator,
    value: conditionValue,
  };
}

function validateCondition(
  achievement: OwoggAchievementDefinition,
  result: OwoggResultDefinition,
  progression: OwoggProgressionDefinition,
  events: Readonly<Record<string, OwoggEventDefinition>>,
): void {
  const { condition, scope } = achievement;
  const path = `achievements.${achievement.id}.condition`;
  const needsNumericValue = condition.source !== "outcome";
  if (needsNumericValue && typeof condition.value !== "number") {
    invalid(`${path}.value must be numeric for source ${condition.source}`);
  }
  if (condition.source === "outcome") {
    if (condition.key !== undefined || condition.aggregate !== undefined) {
      invalid(`${path} must not declare key or aggregate for outcome`);
    }
    if (
      typeof condition.value !== "string" ||
      !result.outcome?.values.includes(condition.value as OwoggOutcome)
    ) {
      invalid(`${path}.value must be one of the declared outcome values`);
    }
    if (condition.operator !== "==" && condition.operator !== "!=") {
      invalid(`${path}.operator must be == or != for outcome`);
    }
    return;
  }

  if (condition.source === "metric" || condition.source === "event") {
    if (!condition.key) invalid(`${path}.key is required for ${condition.source}`);
    const definitions = condition.source === "metric" ? result.metrics : events;
    if (!definitions || !(condition.key in definitions)) {
      invalid(`${path}.key must reference a declared ${condition.source}`);
    }
  } else if (condition.key !== undefined) {
    invalid(`${path}.key is not allowed for ${condition.source}`);
  }

  if (condition.source === "score" && result.score === null) {
    invalid(`${path} references score but result.score is null`);
  }
  if (condition.source === "progression" && progression.type === "none") {
    invalid(`${path} references progression but progression.type is none`);
  }
  if (
    condition.source === "event" &&
    condition.aggregate !== undefined &&
    condition.aggregate !== "count"
  ) {
    invalid(`${path}.aggregate must be count for event`);
  }
  if (scope === "lifetime" && condition.aggregate === undefined) {
    invalid(`${path}.aggregate is required for lifetime numeric facts`);
  }
}

function parseAchievements(
  value: unknown,
  result: OwoggResultDefinition,
  progression: OwoggProgressionDefinition,
  events: Readonly<Record<string, OwoggEventDefinition>>,
): readonly OwoggAchievementDefinition[] {
  if (!Array.isArray(value)) invalid("achievements must be an array");
  const achievements = value.map((entry, index) => {
    const path = `achievements[${index}]`;
    const source = record(entry, path);
    exactKeys(source, ["id", "title", "description", "scope", "condition"], path);
    if (source.condition === undefined) invalid(`${path}.condition is required`);
    const description = optionalString(source, "description", path, { max: 300 });
    const scope =
      source.scope === undefined
        ? "session"
        : enumValue(source, "scope", path, [
            "session",
            "lifetime",
          ] as const satisfies readonly OwoggAchievementScope[]);
    return {
      id: requiredString(source, "id", path, { min: 1, max: 64, pattern: /^[a-z0-9-]+$/ }),
      title: requiredString(source, "title", path, { min: 1, max: 80 }),
      ...(description !== undefined ? { description } : {}),
      scope,
      condition: parseCondition(source.condition, `${path}.condition`),
    };
  });
  const ids = achievements.map((achievement) => achievement.id);
  if (new Set(ids).size !== ids.length) invalid("achievement ids must be unique");
  for (const achievement of achievements)
    validateCondition(achievement, result, progression, events);
  return achievements;
}

/** Parses the single supported OWOGG Game Creator Manifest v1 contract. */
export function parseGameCreatorManifest(value: unknown): OwoggGameCreatorManifest {
  const source = record(value, "manifest");
  const schemaVersion = source.schemaVersion;
  if (schemaVersion !== OWOGG_GAME_CREATOR_MANIFEST_VERSION) {
    invalid(`schemaVersion must be ${OWOGG_GAME_CREATOR_MANIFEST_VERSION}`);
  }
  exactKeys(
    source,
    [
      "$schema",
      "schemaVersion",
      "game",
      "input",
      "presentation",
      "difficulties",
      "progression",
      "result",
      "leaderboard",
      "events",
      "achievements",
      "multiplayer",
      "playConfig",
    ],
    "manifest",
  );
  if (source.game === undefined) invalid("game is required");
  if (source.progression === undefined) invalid("progression is required");
  if (source.result === undefined) invalid("result is required");
  const schema = optionalString(source, "$schema", "manifest");
  if (schema !== undefined && schema !== OWOGG_GAME_CREATOR_MANIFEST_SCHEMA_URL) {
    invalid(`manifest.$schema must be ${OWOGG_GAME_CREATOR_MANIFEST_SCHEMA_URL} for v1`);
  }
  const game = parseGame(source.game);
  const input =
    source.input === undefined
      ? undefined
      : (uniqueStrings(source.input, "input", [
          "keyboard",
          "mouse",
          "touch",
          "gamepad",
        ] as const satisfies readonly OwoggInputMethod[]) as readonly OwoggInputMethod[]);
  const presentation =
    source.presentation === undefined ? undefined : parsePresentation(source.presentation);
  const difficulties =
    source.difficulties === undefined ? undefined : parseDifficulties(source.difficulties);
  const progression = parseProgression(source.progression);
  const result = parseResult(source.result);

  let leaderboard: { readonly enabled: boolean } | undefined;
  if (source.leaderboard !== undefined) {
    const leaderboardSource = record(source.leaderboard, "leaderboard");
    exactKeys(leaderboardSource, ["enabled"], "leaderboard");
    if (typeof leaderboardSource.enabled !== "boolean")
      invalid("leaderboard.enabled must be a boolean");
    leaderboard = { enabled: leaderboardSource.enabled };
  }
  if (leaderboard?.enabled === true && result.score === null) {
    invalid("leaderboard.enabled cannot be true when result.score is null");
  }

  const events = source.events === undefined ? {} : parseEvents(source.events);
  const achievements =
    source.achievements === undefined
      ? undefined
      : parseAchievements(source.achievements, result, progression, events);

  const common = {
    ...(schema !== undefined ? { $schema: schema } : {}),
    game,
    ...(input !== undefined ? { input } : {}),
    ...(presentation !== undefined ? { presentation } : {}),
    ...(difficulties !== undefined ? { difficulties } : {}),
    progression,
    result,
    ...(leaderboard !== undefined ? { leaderboard } : {}),
    ...(source.events !== undefined ? { events } : {}),
    ...(achievements !== undefined ? { achievements } : {}),
  };

  let multiplayer: OwoggGameCreatorManifest["multiplayer"];
  if (source.multiplayer !== undefined) {
    try {
      multiplayer = toOwoggMultiplayerRuntimeRequestV1(
        parseMultiplayerRuntimeProfileRequestV1(source.multiplayer),
      );
    } catch (error) {
      if (error instanceof MultiplayerProfileRequestValidationError) {
        invalid(error.detail);
      }
      throw error;
    }
  }
  if (multiplayer !== undefined && !game.playModes.includes("online-multi")) {
    invalid("multiplayer requires online-multi in game.playModes");
  }
  if (multiplayer !== undefined && game.mode !== "multi") {
    invalid('multiplayer requires game.mode "multi"');
  }
  const genericPlayModeAvailable = game.playModes.some(
    (playMode) => playMode === "single" || playMode === "local-multi",
  );
  if (
    multiplayer !== undefined &&
    leaderboard?.enabled === true &&
    source.playConfig === undefined
  ) {
    invalid("online manifests can enable leaderboard only for a hybrid PlayConfig path");
  }

  const playConfig =
    source.playConfig === undefined
      ? undefined
      : parsePlayConfig(source.playConfig, {
          difficulties,
          result,
          leaderboard,
          genericPlayModeAvailable,
        });

  return {
    ...common,
    schemaVersion: OWOGG_GAME_CREATOR_MANIFEST_VERSION,
    game,
    ...(multiplayer !== undefined ? { multiplayer } : {}),
    ...(playConfig !== undefined ? { playConfig } : {}),
  };
}

/**
 * Returns the normalized untrusted runtime request declared by a validated manifest. This is
 * still only review input; callers must never treat its presence as an approved online profile.
 */
export function getMultiplayerRuntimeProfileRequestV1(
  manifest: OwoggGameCreatorManifest,
): ReturnType<typeof parseMultiplayerRuntimeProfileRequestV1> | null {
  return manifest.multiplayer !== undefined
    ? parseMultiplayerRuntimeProfileRequestV1(manifest.multiplayer)
    : null;
}

export interface GameCreatorManifestMultiplayerPlanV1 {
  /** Local multiplayer stays entirely inside the game and needs no online runtime profile. */
  readonly local: { readonly topology: "local-multi" } | null;
  /** Online availability is resolved from the normalized request; presence is not approval. */
  readonly online: MultiplayerRuntimeRequestResolutionV1 | null;
}

/**
 * Resolves the two independent multiplayer surfaces declared by a validated manifest. A game may
 * expose both same-device local play and a separately reviewed online runtime.
 */
export function resolveGameCreatorManifestMultiplayerPlanV1(
  manifest: OwoggGameCreatorManifest,
): GameCreatorManifestMultiplayerPlanV1 {
  const request = getMultiplayerRuntimeProfileRequestV1(manifest);
  return {
    local: manifest.game.playModes.includes("local-multi") ? { topology: "local-multi" } : null,
    online: request ? resolveMultiplayerRuntimeProfileRequestV1(request) : null,
  };
}

/** Reads the required root-level `owogg.json` file from a prepared ZIP. */
export function extractGameCreatorManifest(
  files: readonly PreparedBundleFile[],
): OwoggGameCreatorManifest | null {
  const file = files.find((candidate) => candidate.path === OWOGG_GAME_CREATOR_MANIFEST_FILENAME);
  if (!file) return null;
  const manifest = parseGameCreatorManifestBytes(file.bytes);
  validateGameCreatorDescriptionFiles(manifest, files);
  return manifest;
}

export function gameDescriptionFilePaths(
  manifest: OwoggGameCreatorManifest,
): readonly OwoggDescriptionFile[] {
  return Array.isArray(manifest.game.description) ? manifest.game.description : [];
}

export function gameDescriptionImagePaths(manifest: OwoggGameCreatorManifest): readonly string[] {
  return manifest.game.description_images ?? [];
}

function decodeDescriptionMarkdown(file: PreparedBundleFile): string {
  if (file.bytes.byteLength === 0) invalid(`${file.path} must not be empty`);
  if (file.bytes.byteLength > GAME_DESCRIPTION_POLICY.MAX_MARKDOWN_BYTES_PER_FILE) {
    invalid(`${file.path} exceeds ${GAME_DESCRIPTION_POLICY.MAX_MARKDOWN_BYTES_PER_FILE} bytes`);
  }
  let markdown: string;
  try {
    markdown = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes);
  } catch {
    return invalid(`${file.path} must be valid UTF-8 Markdown`);
  }
  if (markdown.trim().length === 0) invalid(`${file.path} must not be blank`);
  return markdown;
}

/** Validates every file reference against the normalized immutable bundle. No public route may
 * serve a description asset that did not pass this exact allowlist boundary at publication. */
export function validateGameCreatorDescriptionFiles(
  manifest: OwoggGameCreatorManifest,
  files: readonly PreparedBundleFile[],
): void {
  const descriptionPaths = gameDescriptionFilePaths(manifest);
  const imagePaths = gameDescriptionImagePaths(manifest);
  if (imagePaths.length > 0 && descriptionPaths.length === 0) {
    invalid("game.description_images requires file-based game.description");
  }

  const filesByPath = new Map(files.map((file) => [file.path, file]));
  for (const path of descriptionPaths) {
    const file = filesByPath.get(path);
    if (!file) invalid(`game.description references missing file ${path}`);
    decodeDescriptionMarkdown(file);
  }

  for (const path of imagePaths) {
    if (normalizeBundleEntryPath(path) !== path) {
      invalid(`game.description_images contains an invalid path: ${path}`);
    }
    const file = filesByPath.get(path);
    if (!file) invalid(`game.description_images references missing file ${path}`);
    if (
      !new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]).has(
        resolveBundleContentType(path).contentType,
      )
    ) {
      invalid(`game.description_images must reference a raster image: ${path}`);
    }
    if (file.bytes.byteLength === 0) invalid(`${path} must not be empty`);
    if (file.bytes.byteLength > GAME_DESCRIPTION_POLICY.MAX_IMAGE_BYTES_PER_FILE) {
      invalid(`${path} exceeds ${GAME_DESCRIPTION_POLICY.MAX_IMAGE_BYTES_PER_FILE} bytes`);
    }
  }
}

export function extractGameDescriptionDocuments(
  manifest: OwoggGameCreatorManifest,
  files: readonly PreparedBundleFile[],
): readonly GameDescriptionDocument[] {
  validateGameCreatorDescriptionFiles(manifest, files);
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  return gameDescriptionFilePaths(manifest).map((path) => ({
    locale: GAME_DESCRIPTION_FILE_LOCALES[path],
    path,
    markdown: decodeDescriptionMarkdown(filesByPath.get(path) as PreparedBundleFile),
  }));
}

/** Canonical's legacy string remains a compact default-language fallback for catalog consumers. */
export function defaultGameDescription(
  manifest: OwoggGameCreatorManifest,
  files: readonly PreparedBundleFile[],
): string | undefined {
  if (typeof manifest.game.description === "string") return manifest.game.description;
  return extractGameDescriptionDocuments(manifest, files).find(
    (document) => document.locale === "en",
  )?.markdown;
}

function parseGameCreatorManifestJsonBytes(bytes: ArrayBuffer | Uint8Array): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    invalid(`${OWOGG_GAME_CREATOR_MANIFEST_FILENAME} is not valid JSON`);
  }
  return parsed;
}

export function parseGameCreatorManifestBytes(
  bytes: ArrayBuffer | Uint8Array,
): OwoggGameCreatorManifest {
  return parseGameCreatorManifest(parseGameCreatorManifestJsonBytes(bytes));
}
