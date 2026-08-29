import {
  OWOGG_MULTIPLAYER_PROTOCOL_VERSION,
  OWOGG_MULTIPLAYER_RECONNECT_MODES,
  OWOGG_MULTIPLAYER_REQUEST_VERSION,
  OWOGG_MULTIPLAYER_RUNTIME_KINDS,
  OWOGG_MULTIPLAYER_TRANSPORT_KINDS,
  type OwoggMultiplayerReconnectMode,
  type OwoggMultiplayerRuntimeKind,
  type OwoggMultiplayerRuntimeRequestV1,
  type OwoggMultiplayerTransportKind,
} from "@owogg/game-sdk/contracts";
import { sha256Hex } from "../../../domain/contentHash.js";

export const MULTIPLAYER_PROFILE_REQUEST_SCHEMA_VERSION = 1 as const;
export const MULTIPLAYER_RELAY_MIN_PLAYERS = 2 as const;
export const MULTIPLAYER_RELAY_MAX_PLAYERS = 8 as const;

export interface MultiplayerRuntimeProfileRequestV1 {
  readonly requestSchemaVersion: typeof MULTIPLAYER_PROFILE_REQUEST_SCHEMA_VERSION;
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
  readonly features: {
    readonly reconnect: OwoggMultiplayerReconnectMode;
    readonly directMessages: boolean;
    readonly hostSnapshot: boolean;
    readonly joinInProgress: boolean;
    readonly spectators: boolean;
  };
}

export const MULTIPLAYER_RELAY_UNAVAILABLE_CAPABILITIES = ["joinInProgress", "spectators"] as const;
export type MultiplayerRelayUnavailableCapability =
  (typeof MULTIPLAYER_RELAY_UNAVAILABLE_CAPABILITIES)[number];

/** Server-owned initial Relay limits. They are intentionally absent from `owogg.json`. */
export interface MultiplayerRelayProfilePolicyV1 {
  readonly transportKind: "websocket";
  readonly runtimeKind: "relay";
  readonly protocolVersion: typeof OWOGG_MULTIPLAYER_PROTOCOL_VERSION;
  readonly reconnectPolicy: OwoggMultiplayerReconnectMode;
  readonly directMessages: boolean;
  readonly hostSnapshot: boolean;
  readonly minPlayers: number;
  readonly maxPlayers: number;
  readonly allowedVisibility: readonly ["PRIVATE"];
  readonly allowedJoinPolicies: readonly ["OPEN"];
  readonly hostDeparturePolicy: "close";
  readonly resultTrust: "UNVERIFIED";
  readonly maxMessageBytes: 4096;
  readonly maxSnapshotBytes: 0 | 16384;
  readonly messagesPerSecond: 20;
  readonly roomBytesPerSecond: 262144;
  readonly roomTtlSeconds: 7200;
}

export type MultiplayerRuntimeRequestResolutionV1 =
  | {
      readonly status: "SUPPORTED_V1";
      readonly request: MultiplayerRuntimeProfileRequestV1;
      readonly transportKind: "websocket";
      readonly runtimeKind: "relay";
      readonly protocolVersion: typeof OWOGG_MULTIPLAYER_PROTOCOL_VERSION;
      readonly resultTrust: "UNVERIFIED";
      readonly policy: MultiplayerRelayProfilePolicyV1;
    }
  | {
      readonly status: "RUNTIME_NOT_AVAILABLE";
      readonly request: MultiplayerRuntimeProfileRequestV1;
      readonly runtimeKind: "worker" | "container";
      readonly reason: "MULTIPLAYER_RUNTIME_NOT_AVAILABLE";
    }
  | {
      readonly status: "CAPABILITY_NOT_AVAILABLE";
      readonly request: MultiplayerRuntimeProfileRequestV1;
      readonly runtimeKind: "relay";
      readonly unsupportedCapabilities: readonly MultiplayerRelayUnavailableCapability[];
      readonly reason: "MULTIPLAYER_CAPABILITY_NOT_AVAILABLE";
    };

export class MultiplayerProfileRequestValidationError extends Error {
  constructor(public readonly detail: string) {
    super(`INVALID_MULTIPLAYER_PROFILE_REQUEST: ${detail}`);
  }
}

function invalid(detail: string): never {
  throw new MultiplayerProfileRequestValidationError(detail);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  source: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  for (const key of Object.keys(source)) {
    if (!allowed.includes(key)) invalid(`${path}.${key} is not allowed`);
  }
}

function booleanValue(source: Record<string, unknown>, key: string, path: string): boolean {
  const value = source[key];
  if (typeof value !== "boolean") invalid(`${path}.${key} must be a boolean`);
  return value;
}

function integer(
  source: Record<string, unknown>,
  key: string,
  path: string,
  minimum: number,
  maximum: number,
): number {
  const value = source[key];
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    invalid(`${path}.${key} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function enumValue<T extends string>(
  source: Record<string, unknown>,
  key: string,
  path: string,
  allowed: readonly T[],
): T {
  const value = source[key];
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    invalid(`${path}.${key} must be one of ${allowed.join(", ")}`);
  }
  return value as T;
}

/** Strict parser for the unified manifest v1 `multiplayer` request block. */
export function parseMultiplayerRuntimeProfileRequestV1(
  value: unknown,
): MultiplayerRuntimeProfileRequestV1 {
  const source = record(value, "multiplayer");
  exactKeys(source, ["version", "transport", "runtime", "players", "features"], "multiplayer");
  if (source.version !== OWOGG_MULTIPLAYER_REQUEST_VERSION) {
    invalid(`multiplayer.version must be ${OWOGG_MULTIPLAYER_REQUEST_VERSION}`);
  }

  const transportSource = record(source.transport, "multiplayer.transport");
  exactKeys(transportSource, ["kind", "protocolVersion"], "multiplayer.transport");
  const transportKind = enumValue(
    transportSource,
    "kind",
    "multiplayer.transport",
    OWOGG_MULTIPLAYER_TRANSPORT_KINDS,
  );
  if (transportSource.protocolVersion !== OWOGG_MULTIPLAYER_PROTOCOL_VERSION) {
    invalid(`multiplayer.transport.protocolVersion must be ${OWOGG_MULTIPLAYER_PROTOCOL_VERSION}`);
  }

  const runtimeSource = record(source.runtime, "multiplayer.runtime");
  exactKeys(runtimeSource, ["kind"], "multiplayer.runtime");
  const runtimeKind = enumValue(
    runtimeSource,
    "kind",
    "multiplayer.runtime",
    OWOGG_MULTIPLAYER_RUNTIME_KINDS,
  );

  const playersSource = record(source.players, "multiplayer.players");
  exactKeys(playersSource, ["min", "max"], "multiplayer.players");
  const minPlayers = integer(
    playersSource,
    "min",
    "multiplayer.players",
    MULTIPLAYER_RELAY_MIN_PLAYERS,
    MULTIPLAYER_RELAY_MAX_PLAYERS,
  );
  const maxPlayers = integer(
    playersSource,
    "max",
    "multiplayer.players",
    MULTIPLAYER_RELAY_MIN_PLAYERS,
    MULTIPLAYER_RELAY_MAX_PLAYERS,
  );
  if (minPlayers > maxPlayers) invalid("multiplayer.players.min cannot exceed max");

  const featuresSource = record(source.features, "multiplayer.features");
  exactKeys(
    featuresSource,
    ["reconnect", "directMessages", "hostSnapshot", "joinInProgress", "spectators"],
    "multiplayer.features",
  );

  return {
    requestSchemaVersion: MULTIPLAYER_PROFILE_REQUEST_SCHEMA_VERSION,
    transport: {
      kind: transportKind,
      protocolVersion: OWOGG_MULTIPLAYER_PROTOCOL_VERSION,
    },
    runtime: { kind: runtimeKind },
    players: { min: minPlayers, max: maxPlayers },
    features: {
      reconnect: enumValue(
        featuresSource,
        "reconnect",
        "multiplayer.features",
        OWOGG_MULTIPLAYER_RECONNECT_MODES,
      ),
      directMessages: booleanValue(featuresSource, "directMessages", "multiplayer.features"),
      hostSnapshot: booleanValue(featuresSource, "hostSnapshot", "multiplayer.features"),
      joinInProgress: booleanValue(featuresSource, "joinInProgress", "multiplayer.features"),
      spectators: booleanValue(featuresSource, "spectators", "multiplayer.features"),
    },
  };
}

function relayPolicy(request: MultiplayerRuntimeProfileRequestV1): MultiplayerRelayProfilePolicyV1 {
  return {
    transportKind: "websocket",
    runtimeKind: "relay",
    protocolVersion: OWOGG_MULTIPLAYER_PROTOCOL_VERSION,
    reconnectPolicy: request.features.reconnect,
    directMessages: request.features.directMessages,
    hostSnapshot: request.features.hostSnapshot,
    minPlayers: request.players.min,
    maxPlayers: request.players.max,
    allowedVisibility: ["PRIVATE"],
    allowedJoinPolicies: ["OPEN"],
    hostDeparturePolicy: "close",
    resultTrust: "UNVERIFIED",
    maxMessageBytes: 4096,
    maxSnapshotBytes: request.features.hostSnapshot ? 16384 : 0,
    messagesPerSecond: 20,
    roomBytesPerSecond: 262144,
    roomTtlSeconds: 7200,
  };
}

/** Resolves availability only; it does not approve or activate a profile. */
export function resolveMultiplayerRuntimeProfileRequestV1(
  request: MultiplayerRuntimeProfileRequestV1,
): MultiplayerRuntimeRequestResolutionV1 {
  if (request.runtime.kind !== "relay") {
    return {
      status: "RUNTIME_NOT_AVAILABLE",
      request,
      runtimeKind: request.runtime.kind,
      reason: "MULTIPLAYER_RUNTIME_NOT_AVAILABLE",
    };
  }

  const unsupportedCapabilities = MULTIPLAYER_RELAY_UNAVAILABLE_CAPABILITIES.filter(
    (capability) => request.features[capability],
  );
  if (unsupportedCapabilities.length > 0) {
    return {
      status: "CAPABILITY_NOT_AVAILABLE",
      request,
      runtimeKind: "relay",
      unsupportedCapabilities,
      reason: "MULTIPLAYER_CAPABILITY_NOT_AVAILABLE",
    };
  }

  const policy = relayPolicy(request);
  return {
    status: "SUPPORTED_V1",
    request,
    transportKind: "websocket",
    runtimeKind: "relay",
    protocolVersion: OWOGG_MULTIPLAYER_PROTOCOL_VERSION,
    resultTrust: "UNVERIFIED",
    policy,
  };
}

export function deriveMultiplayerRelayProfilePolicyV1(
  request: MultiplayerRuntimeProfileRequestV1,
): MultiplayerRelayProfilePolicyV1 {
  const resolution = resolveMultiplayerRuntimeProfileRequestV1(request);
  if (resolution.status !== "SUPPORTED_V1") {
    invalid(`request cannot use the Relay V1 runtime: ${resolution.reason}`);
  }
  return resolution.policy;
}

/** Rebuilds the normalized public request in a fixed property order. */
export function toOwoggMultiplayerRuntimeRequestV1(
  request: MultiplayerRuntimeProfileRequestV1,
): OwoggMultiplayerRuntimeRequestV1 {
  return {
    version: OWOGG_MULTIPLAYER_REQUEST_VERSION,
    transport: {
      kind: request.transport.kind,
      protocolVersion: request.transport.protocolVersion,
    },
    runtime: { kind: request.runtime.kind },
    players: { min: request.players.min, max: request.players.max },
    features: {
      reconnect: request.features.reconnect,
      directMessages: request.features.directMessages,
      hostSnapshot: request.features.hostSnapshot,
      joinInProgress: request.features.joinInProgress,
      spectators: request.features.spectators,
    },
  };
}

export function serializeMultiplayerRuntimeProfileRequestV1(
  request: MultiplayerRuntimeProfileRequestV1,
): string {
  const normalized = parseMultiplayerRuntimeProfileRequestV1(
    toOwoggMultiplayerRuntimeRequestV1(request),
  );
  return JSON.stringify(toOwoggMultiplayerRuntimeRequestV1(normalized));
}

export async function hashMultiplayerRuntimeProfileRequestV1(
  request: MultiplayerRuntimeProfileRequestV1,
): Promise<string> {
  const bytes = new TextEncoder().encode(serializeMultiplayerRuntimeProfileRequestV1(request));
  return sha256Hex(bytes.buffer);
}
