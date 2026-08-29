/** Public, provider-neutral multiplayer request embedded in the unified `owogg.json` v1. */

export const OWOGG_MULTIPLAYER_REQUEST_VERSION = 1 as const;
export const OWOGG_MULTIPLAYER_PROTOCOL_VERSION = 1 as const;

export const OWOGG_MULTIPLAYER_TRANSPORT_KINDS = ["websocket"] as const;
export const OWOGG_MULTIPLAYER_RUNTIME_KINDS = ["relay", "worker", "container"] as const;
export const OWOGG_MULTIPLAYER_RECONNECT_MODES = ["none", "resume"] as const;

export type OwoggMultiplayerTransportKind = (typeof OWOGG_MULTIPLAYER_TRANSPORT_KINDS)[number];
export type OwoggMultiplayerRuntimeKind = (typeof OWOGG_MULTIPLAYER_RUNTIME_KINDS)[number];
export type OwoggMultiplayerReconnectMode = (typeof OWOGG_MULTIPLAYER_RECONNECT_MODES)[number];

export interface OwoggMultiplayerFeaturesV1 {
  readonly reconnect: OwoggMultiplayerReconnectMode;
  readonly directMessages: boolean;
  readonly hostSnapshot: boolean;
  readonly joinInProgress: boolean;
  readonly spectators: boolean;
}

/**
 * Runtime request, not runtime authority. OWOGG still decides whether the requested runtime and
 * features are available for the exact immutable game version before review or activation.
 */
export interface OwoggMultiplayerRuntimeRequestV1 {
  readonly version: typeof OWOGG_MULTIPLAYER_REQUEST_VERSION;
  readonly transport: {
    readonly kind: OwoggMultiplayerTransportKind;
    readonly protocolVersion: typeof OWOGG_MULTIPLAYER_PROTOCOL_VERSION;
  };
  readonly runtime: {
    readonly kind: OwoggMultiplayerRuntimeKind;
  };
  readonly players: {
    readonly min: number;
    readonly max: number;
  };
  readonly features: OwoggMultiplayerFeaturesV1;
}

export type OwoggMultiplayerRequest = OwoggMultiplayerRuntimeRequestV1;
