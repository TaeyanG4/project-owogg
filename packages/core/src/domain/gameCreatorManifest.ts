import {
  OWOGG_GAME_CREATOR_MANIFEST_FILENAME,
  OWOGG_GAME_CREATOR_MANIFEST_VERSION,
  type OwoggAchievementAggregate,
  type OwoggAchievementCondition,
  type OwoggAchievementDefinition,
  type OwoggAchievementScope,
  type OwoggAchievementSource,
  type OwoggComparisonOperator,
  type OwoggGameCreatorManifest,
  type OwoggDifficultyDefinition,
  type OwoggEventDefinition,
  type OwoggInputMethod,
  type OwoggManifestGame,
  type OwoggManifestPresentation,
  type OwoggMetricDefinition,
  type OwoggMetricType,
  type OwoggOrientation,
  type OwoggOutcome,
  type OwoggProgressionDefinition,
  type OwoggProgressionType,
  type OwoggRangeDefinition,
  type OwoggRangePolicy,
  type OwoggResultDefinition,
  type OwoggScoreDefinition,
} from "@owogg/game-sdk/contracts";
import { SANDBOX_GAME_POLICY } from "./sandboxGames.js";
import type { PreparedBundleFile } from "./sandboxGameBundle.js";

export { OWOGG_GAME_CREATOR_MANIFEST_FILENAME };

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
    ["slug", "title", "genre", "mode", "shortDescription", "description", "tags"],
    "game",
  );
  const shortDescription = optionalString(source, "shortDescription", "game", {
    max: SANDBOX_GAME_POLICY.MAX_SHORT_DESCRIPTION_LENGTH,
  });
  const description = optionalString(source, "description", "game", {
    max: SANDBOX_GAME_POLICY.MAX_DESCRIPTION_LENGTH,
  });
  const tags = source.tags === undefined ? undefined : uniqueStrings(source.tags, "game.tags");
  return {
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
    mode: enumValue(source, "mode", "game", ["single", "multi"] as const),
    ...(shortDescription !== undefined ? { shortDescription } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(tags !== undefined ? { tags } : {}),
  };
}

function parsePresentation(value: unknown): OwoggManifestPresentation {
  const source = record(value, "presentation");
  exactKeys(source, ["orientation", "aspectRatio"], "presentation");
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
  return {
    ...(orientation !== undefined ? { orientation } : {}),
    ...(aspectRatio !== undefined ? { aspectRatio } : {}),
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

/** Parses and semantically validates an OWOGG Game Creator Manifest v1 value. */
export function parseGameCreatorManifest(value: unknown): OwoggGameCreatorManifest {
  const source = record(value, "manifest");
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
    ],
    "manifest",
  );
  if (source.schemaVersion !== OWOGG_GAME_CREATOR_MANIFEST_VERSION) {
    invalid(`schemaVersion must be ${OWOGG_GAME_CREATOR_MANIFEST_VERSION}`);
  }
  if (source.game === undefined) invalid("game is required");
  if (source.progression === undefined) invalid("progression is required");
  if (source.result === undefined) invalid("result is required");
  const schema = optionalString(source, "$schema", "manifest");
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

  return {
    ...(schema !== undefined ? { $schema: schema } : {}),
    schemaVersion: OWOGG_GAME_CREATOR_MANIFEST_VERSION,
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
}

/** Reads the required root-level `owogg.json` file from a prepared ZIP. */
export function extractGameCreatorManifest(
  files: readonly PreparedBundleFile[],
): OwoggGameCreatorManifest | null {
  const file = files.find((candidate) => candidate.path === OWOGG_GAME_CREATOR_MANIFEST_FILENAME);
  if (!file) return null;
  return parseGameCreatorManifestBytes(file.bytes);
}

/** Parses the standalone `owogg.json` upload used by partial game updates. */
export function parseGameCreatorManifestBytes(
  bytes: ArrayBuffer | Uint8Array,
): OwoggGameCreatorManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    invalid(`${OWOGG_GAME_CREATOR_MANIFEST_FILENAME} is not valid JSON`);
  }
  return parseGameCreatorManifest(parsed);
}
