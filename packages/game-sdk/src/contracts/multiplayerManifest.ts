/**
 * Public, provider-neutral multiplayer request embedded in `owogg.json` v2.
 *
 * This contract describes what the game needs. It deliberately cannot select a capability class,
 * runtime backend, server ruleset, rate limit, reward, ranking policy, endpoint, or executable
 * server code. OWOGG resolves those trusted values during exact-version review.
 */

export const OWOGG_MULTIPLAYER_REQUEST_VERSION = 1 as const;
export const OWOGG_MULTIPLAYER_PROTOCOL_VERSION = 1 as const;

export const OWOGG_MULTIPLAYER_MANAGED_TEMPLATE_IDS = [
  "turn-grid",
  "reaction-arena",
  "realtime-paddle",
] as const;

export type OwoggMultiplayerManagedTemplateId =
  (typeof OWOGG_MULTIPLAYER_MANAGED_TEMPLATE_IDS)[number];

/**
 * Game-facing simulation vocabulary. `continuous` is normalized to the platform's internal
 * `realtime` model at the trust boundary; the provider-neutral public manifest never exposes that
 * implementation detail.
 */
export type OwoggMultiplayerSimulation = "turn" | "event" | "continuous" | "rollback";
export type OwoggMultiplayerLifecycle = "match" | "continuous" | "persistent";
export type OwoggMultiplayerPersistence = "none" | "match" | "player" | "world";
export type OwoggMultiplayerLatency = "relaxed" | "interactive" | "critical";
export type OwoggMultiplayerReconnect = "none" | "rejoin" | "resume";

export interface OwoggMultiplayerRequirementsV1 {
  readonly simulation: OwoggMultiplayerSimulation;
  readonly lifecycle: OwoggMultiplayerLifecycle;
  readonly persistence: OwoggMultiplayerPersistence;
  readonly latency: OwoggMultiplayerLatency;
  readonly reconnect: OwoggMultiplayerReconnect;
  readonly hiddenInformation: boolean;
  readonly simultaneousResponse: boolean;
  readonly joinInProgress: boolean;
  readonly spectators: boolean;
}

export interface OwoggTurnGridConfigV1 {
  readonly boardWidth: number;
  readonly boardHeight: number;
  readonly winLength: number;
}

export interface OwoggReactionArenaConfigV1 {
  readonly rounds: number;
  readonly responseWindowMs: number;
}

export interface OwoggRealtimePaddleConfigV1 {
  readonly fieldWidth: number;
  readonly fieldHeight: number;
  readonly targetScore: number;
}

interface OwoggManagedMultiplayerRequestBaseV1<
  TemplateId extends OwoggMultiplayerManagedTemplateId,
  Config extends object,
> {
  /** Version of this `multiplayer` request shape, independent from manifest/protocol versions. */
  readonly requestVersion: typeof OWOGG_MULTIPLAYER_REQUEST_VERSION;
  readonly kind: "managed-template";
  readonly template: {
    readonly id: TemplateId;
    readonly version: 1;
  };
  readonly players: {
    readonly min: number;
    readonly max: number;
  };
  readonly requirements: OwoggMultiplayerRequirementsV1;
  readonly config: Readonly<Config>;
  readonly client: {
    readonly protocolVersion: typeof OWOGG_MULTIPLAYER_PROTOCOL_VERSION;
  };
}

/**
 * Exact request shapes supported by multiplayer request schema v1. Adding a template is additive;
 * changing an existing template's config or semantics requires a new template version.
 */
export type OwoggManagedMultiplayerRequestV1 =
  | OwoggManagedMultiplayerRequestBaseV1<"turn-grid", OwoggTurnGridConfigV1>
  | OwoggManagedMultiplayerRequestBaseV1<"reaction-arena", OwoggReactionArenaConfigV1>
  | OwoggManagedMultiplayerRequestBaseV1<"realtime-paddle", OwoggRealtimePaddleConfigV1>;

export type OwoggMultiplayerRequest = OwoggManagedMultiplayerRequestV1;
