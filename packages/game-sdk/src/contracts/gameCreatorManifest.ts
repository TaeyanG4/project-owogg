import type {
  HostToGameMultiplayerMessage,
  MultiInitMessage,
} from "../bridge/multiplayerProtocol.js";
import type {
  AuthorizedStartContext,
  JsonSafeValue,
  PlayConfigSelection,
  PublicPlayConfigDescriptor,
} from "../bridge/protocol.js";
import type { OwoggMultiplayerRequest } from "./multiplayerManifest.js";

/** Public, engine-neutral OWOGG Game Creator Manifest contracts. */

export const OWOGG_GAME_CREATOR_MANIFEST_SCHEMA_URL =
  "https://owogg.com/schemas/manifest/v1.json" as const;
export const OWOGG_GAME_CREATOR_MANIFEST_VERSION = 1 as const;
export const OWOGG_GAME_CREATOR_MANIFEST_FILENAME = "owogg.json" as const;
export const OWOGG_PLAY_CONFIG_VERSION = 1 as const;

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
export type OwoggPlayMode = "single" | "local-multi" | "online-multi";

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
  /** Explicit runtime topology. This is required for every manifest v1 game. */
  readonly playModes: readonly OwoggPlayMode[];
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

export interface OwoggPlayConfigVariantDefinition {
  readonly id: string;
  readonly title: string;
  /** Omitted for every variant is normalized by the parser to `true` on the first variant. */
  readonly default?: boolean | undefined;
}

export interface OwoggPlayConfigAllowedConfig {
  readonly difficultyId: string;
  readonly variantId: string;
  readonly rewardFactor: number;
}

/** Untrusted author declaration. It becomes runtime authority only after review and canonicalization. */
export interface OwoggManifestPlayConfig {
  readonly version: typeof OWOGG_PLAY_CONFIG_VERSION;
  readonly rulesetRevision: number;
  readonly verifierId: string;
  readonly variants: readonly OwoggPlayConfigVariantDefinition[];
  readonly allowedConfigs: readonly OwoggPlayConfigAllowedConfig[];
}

interface OwoggGameCreatorManifestCommon {
  readonly $schema?: string | undefined;
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

/** The expanded v1 contract and OWOGG's only manifest shape. */
export interface OwoggGameCreatorManifest extends OwoggGameCreatorManifestCommon {
  readonly schemaVersion: typeof OWOGG_GAME_CREATOR_MANIFEST_VERSION;
  readonly multiplayer?: OwoggMultiplayerRequest | undefined;
  readonly playConfig?: OwoggManifestPlayConfig | undefined;
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

export type OwoggMultiplayerSendRequest =
  | { readonly delivery: "broadcast"; readonly payload: unknown }
  | {
      readonly delivery: "direct";
      readonly targetParticipantId: string;
      readonly payload: unknown;
    };

export type OwoggMultiplayerMessage = Exclude<HostToGameMultiplayerMessage, MultiInitMessage>;

export interface OwoggMultiplayerBrowserApi {
  /** Sanitized parent bootstrap; `null` until an online multiplayer host connects. */
  readonly bootstrap: MultiInitMessage | null;
  ready(): boolean;
  send(request: OwoggMultiplayerSendRequest): boolean;
  broadcast(payload: unknown): boolean;
  direct(targetParticipantId: string, payload: unknown): boolean;
  /** Host-only opaque reconnect snapshot for Relay profiles that enable it. */
  snapshot(payload: unknown): boolean;
  leave(): void;
  subscribe(listener: (message: OwoggMultiplayerMessage) => void): () => void;
}

export interface OwoggBrowserApi {
  /** Approved topology choices for a game-owned launcher; empty when no negotiation is required. */
  readonly playModes: readonly OwoggPlayMode[];
  selectPlayMode(playMode: OwoggPlayMode): Promise<OwoggPlayMode>;
  /** Approved public choices for a verifier-backed generic attempt; null for legacy/online. */
  readonly playConfig: PublicPlayConfigDescriptor | null;
  requestStart(config: PlayConfigSelection): Promise<AuthorizedStartContext>;
  start(): void;
  event(name: string, data?: unknown): void;
  complete(result?: OwoggCompletionPayload & { readonly evidence?: JsonSafeValue }): void;
  cancel(): void;
  /** Stable managed-online API. It remains inert for single/local game sessions. */
  readonly multiplayer: OwoggMultiplayerBrowserApi;
}
