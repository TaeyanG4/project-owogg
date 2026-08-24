/** Public, engine-neutral OWOGG Game Creator Manifest v1 contract. */

export const OWOGG_GAME_CREATOR_MANIFEST_SCHEMA_URL =
  "https://owogg.com/schemas/manifest/v1.json" as const;
export const OWOGG_GAME_CREATOR_MANIFEST_VERSION = 1 as const;
export const OWOGG_GAME_CREATOR_MANIFEST_FILENAME = "owogg.json" as const;

export type OwoggInputMethod = "keyboard" | "mouse" | "touch" | "gamepad";
export type OwoggOrientation = "any" | "landscape" | "portrait";
export type OwoggRangePolicy = "clamp" | "reject";
export type OwoggProgressionType =
  "none" | "endless" | "stage" | "level" | "round" | "wave" | "chapter" | "lap" | "custom";
export type OwoggOutcome = "neutral" | "success" | "failure" | "win" | "loss" | "draw";
export type OwoggMetricType = "integer" | "number";
export type OwoggAchievementScope = "session" | "lifetime";
export type OwoggAchievementSource = "score" | "outcome" | "progression" | "metric" | "event";
export type OwoggAchievementAggregate = "max" | "min" | "sum" | "count";
export type OwoggComparisonOperator = "==" | "!=" | ">" | ">=" | "<" | "<=";

export interface OwoggRangeDefinition {
  readonly min: number;
  readonly max: number;
  /** Omitted in source manifests is normalized to `clamp`. */
  readonly outOfRange: OwoggRangePolicy;
}

export interface OwoggManifestGame {
  readonly slug: string;
  readonly title: string;
  readonly genre: string;
  readonly mode: "single" | "multi";
  readonly shortDescription?: string | undefined;
  readonly description?: string | undefined;
  readonly tags?: readonly string[] | undefined;
}

export interface OwoggManifestPresentation {
  readonly orientation?: OwoggOrientation | undefined;
  readonly aspectRatio?: string | undefined;
}

export interface OwoggDifficultyDefinition {
  readonly id: string;
  readonly title: string;
  readonly default?: boolean | undefined;
}

export interface OwoggProgressionDefinition {
  readonly type: OwoggProgressionType;
  readonly range?: OwoggRangeDefinition | undefined;
}

export interface OwoggScoreDefinition {
  readonly unit: string;
  readonly direction: "asc" | "desc";
  readonly precision?: number | undefined;
  readonly range: OwoggRangeDefinition;
}

export interface OwoggMetricDefinition {
  readonly type: OwoggMetricType;
  readonly range?: OwoggRangeDefinition | undefined;
}

export interface OwoggResultDefinition {
  readonly outcome?: { readonly values: readonly OwoggOutcome[] } | null | undefined;
  readonly score: OwoggScoreDefinition | null;
  readonly metrics?: Readonly<Record<string, OwoggMetricDefinition>> | undefined;
}

export interface OwoggEventDefinition {
  readonly maxPerAttempt?: number | undefined;
}

export interface OwoggAchievementCondition {
  readonly source: OwoggAchievementSource;
  readonly key?: string | undefined;
  readonly aggregate?: OwoggAchievementAggregate | undefined;
  readonly operator: OwoggComparisonOperator;
  readonly value: number | string | boolean;
}

export interface OwoggAchievementDefinition {
  readonly id: string;
  readonly title: string;
  readonly description?: string | undefined;
  /** Omitted in source manifests is normalized to `session`. */
  readonly scope: OwoggAchievementScope;
  readonly condition: OwoggAchievementCondition;
}

export interface OwoggGameCreatorManifest {
  readonly $schema?: string | undefined;
  readonly schemaVersion: typeof OWOGG_GAME_CREATOR_MANIFEST_VERSION;
  readonly game: OwoggManifestGame;
  readonly input?: readonly OwoggInputMethod[] | undefined;
  readonly presentation?: OwoggManifestPresentation | undefined;
  readonly difficulties?: readonly OwoggDifficultyDefinition[] | undefined;
  readonly progression: OwoggProgressionDefinition;
  readonly result: OwoggResultDefinition;
  readonly leaderboard?: { readonly enabled: boolean } | undefined;
  readonly events?: Readonly<Record<string, OwoggEventDefinition>> | undefined;
  readonly achievements?: readonly OwoggAchievementDefinition[] | undefined;
}

/** Canonical subset needed by the host/result validator after registration metadata is projected. */
export interface OwoggRuntimeContract {
  readonly input: readonly OwoggInputMethod[];
  readonly presentation?: OwoggManifestPresentation | undefined;
  readonly progression: OwoggProgressionDefinition;
  readonly outcome: { readonly values: readonly OwoggOutcome[] } | null;
  readonly metrics: Readonly<Record<string, OwoggMetricDefinition>>;
  readonly events: Readonly<Record<string, OwoggEventDefinition>>;
  readonly achievements: readonly OwoggAchievementDefinition[];
}

export interface OwoggCompletionPayload {
  readonly outcome?: OwoggOutcome | undefined;
  readonly score?: number | undefined;
  readonly progression?: { readonly value: number } | undefined;
  readonly metrics?: Readonly<Record<string, number>> | undefined;
}

export interface OwoggBrowserApi {
  start(): void;
  event(name: string, data?: unknown): void;
  complete(result?: OwoggCompletionPayload): void;
  cancel(): void;
}
