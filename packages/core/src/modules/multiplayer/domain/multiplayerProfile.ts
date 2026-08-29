export const MULTIPLAYER_PROFILE_VERSION = 1 as const;
export const MULTIPLAYER_PROTOCOL_VERSION = 1 as const;
export const MULTIPLAYER_V1_MAX_PLAYERS = 8;
export const MULTIPLAYER_RECONNECT_POLICIES = ["none", "resume"] as const;
export const MULTIPLAYER_VISIBILITIES = ["PUBLIC", "UNLISTED", "PRIVATE"] as const;
export const MULTIPLAYER_JOIN_POLICIES = ["OPEN", "INVITE_ONLY"] as const;

export type MultiplayerReconnectPolicy = (typeof MULTIPLAYER_RECONNECT_POLICIES)[number];
export type MultiplayerVisibility = (typeof MULTIPLAYER_VISIBILITIES)[number];
export type MultiplayerJoinPolicy = (typeof MULTIPLAYER_JOIN_POLICIES)[number];

/** The only profile shape that can be approved or activated after the Relay cutover. */
export interface ApprovedRelayMultiplayerProfileV1 {
  readonly profileVersion: typeof MULTIPLAYER_PROFILE_VERSION;
  readonly gameId: number;
  readonly gameVersionId: number;
  readonly contentHash: string;
  readonly sourceRequestHash: string;
  readonly profileRevision: number;
  readonly transportKind: "websocket";
  readonly runtimeKind: "relay";
  readonly protocolVersion: typeof MULTIPLAYER_PROTOCOL_VERSION;
  readonly lifecycle: "match";
  readonly reconnectPolicy: MultiplayerReconnectPolicy;
  readonly directMessages: boolean;
  readonly hostSnapshot: boolean;
  readonly minPlayers: number;
  readonly maxPlayers: number;
  readonly allowedVisibility: readonly ["PRIVATE"];
  readonly allowedJoinPolicies: readonly ["OPEN"];
  readonly hostDeparturePolicy: "close";
  readonly resultTrust: "UNVERIFIED";
  readonly maxMessageBytes: number;
  readonly maxSnapshotBytes: number;
  readonly messagesPerSecond: number;
  readonly roomBytesPerSecond: number;
  readonly roomTtlSeconds: number;
  readonly enabled: boolean;
}

export type ApprovedMultiplayerProfileV1 = ApprovedRelayMultiplayerProfileV1;

export function isApprovedRelayMultiplayerProfileV1(
  profile: ApprovedMultiplayerProfileV1,
): profile is ApprovedRelayMultiplayerProfileV1 {
  return profile.runtimeKind === "relay";
}

export class MultiplayerProfileValidationError extends Error {
  constructor(public readonly detail: string) {
    super(`INVALID_MULTIPLAYER_PROFILE: ${detail}`);
  }
}

function invalid(detail: string): never {
  throw new MultiplayerProfileValidationError(detail);
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
  for (const key of allowed) {
    if (!(key in source)) invalid(`${path}.${key} is required`);
  }
}

function positiveInteger(source: Record<string, unknown>, key: string): number {
  const value = source[key];
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    invalid(`${key} must be a positive integer`);
  }
  return value as number;
}

function boundedInteger(
  source: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum: number,
): number {
  const value = source[key];
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    invalid(`${key} must be an integer between ${minimum} and ${maximum}`);
  }
  return value as number;
}

function booleanValue(source: Record<string, unknown>, key: string): boolean {
  const value = source[key];
  if (typeof value !== "boolean") invalid(`${key} must be a boolean`);
  return value;
}

function hashValue(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    invalid(`${key} must be a lowercase SHA-256 hex digest`);
  }
  return value as string;
}

/** Strictly parse the trusted generic Relay profile snapshot read from storage. */
export function parseApprovedRelayMultiplayerProfileV1(
  value: unknown,
): ApprovedRelayMultiplayerProfileV1 {
  const source = record(value, "profile");
  exactKeys(
    source,
    [
      "profileVersion",
      "gameId",
      "gameVersionId",
      "contentHash",
      "sourceRequestHash",
      "profileRevision",
      "transportKind",
      "runtimeKind",
      "protocolVersion",
      "lifecycle",
      "reconnectPolicy",
      "directMessages",
      "hostSnapshot",
      "minPlayers",
      "maxPlayers",
      "allowedVisibility",
      "allowedJoinPolicies",
      "hostDeparturePolicy",
      "resultTrust",
      "maxMessageBytes",
      "maxSnapshotBytes",
      "messagesPerSecond",
      "roomBytesPerSecond",
      "roomTtlSeconds",
      "enabled",
    ],
    "profile",
  );
  if (source.profileVersion !== MULTIPLAYER_PROFILE_VERSION) invalid("profileVersion must be 1");
  if (source.transportKind !== "websocket") invalid("transportKind must be websocket");
  if (source.runtimeKind !== "relay") invalid("runtimeKind must be relay");
  if (source.protocolVersion !== MULTIPLAYER_PROTOCOL_VERSION) invalid("protocolVersion must be 1");
  if (source.lifecycle !== "match") invalid("lifecycle must be match");
  if (source.reconnectPolicy !== "none" && source.reconnectPolicy !== "resume") {
    invalid("reconnectPolicy must be none or resume");
  }
  if (!(MULTIPLAYER_RECONNECT_POLICIES as readonly string[]).includes(source.reconnectPolicy)) {
    invalid("reconnectPolicy is unsupported");
  }
  if (source.hostDeparturePolicy !== "close") invalid("hostDeparturePolicy must be close");
  if (source.resultTrust !== "UNVERIFIED") invalid("resultTrust must be UNVERIFIED");
  if (
    !Array.isArray(source.allowedVisibility) ||
    source.allowedVisibility.length !== 1 ||
    source.allowedVisibility[0] !== "PRIVATE"
  ) {
    invalid("allowedVisibility must be [PRIVATE]");
  }
  if (
    !Array.isArray(source.allowedJoinPolicies) ||
    source.allowedJoinPolicies.length !== 1 ||
    source.allowedJoinPolicies[0] !== "OPEN"
  ) {
    invalid("allowedJoinPolicies must be [OPEN]");
  }

  const minPlayers = boundedInteger(source, "minPlayers", 2, MULTIPLAYER_V1_MAX_PLAYERS);
  const maxPlayers = boundedInteger(source, "maxPlayers", 2, MULTIPLAYER_V1_MAX_PLAYERS);
  if (minPlayers > maxPlayers) invalid("minPlayers must not exceed maxPlayers");
  const hostSnapshot = booleanValue(source, "hostSnapshot");
  const maxSnapshotBytes = boundedInteger(source, "maxSnapshotBytes", 0, 16 * 1024);
  if ((!hostSnapshot && maxSnapshotBytes !== 0) || (hostSnapshot && maxSnapshotBytes === 0)) {
    invalid("maxSnapshotBytes must match hostSnapshot");
  }

  return {
    profileVersion: MULTIPLAYER_PROFILE_VERSION,
    gameId: positiveInteger(source, "gameId"),
    gameVersionId: positiveInteger(source, "gameVersionId"),
    contentHash: hashValue(source, "contentHash"),
    sourceRequestHash: hashValue(source, "sourceRequestHash"),
    profileRevision: positiveInteger(source, "profileRevision"),
    transportKind: "websocket",
    runtimeKind: "relay",
    protocolVersion: MULTIPLAYER_PROTOCOL_VERSION,
    lifecycle: "match",
    reconnectPolicy: source.reconnectPolicy,
    directMessages: booleanValue(source, "directMessages"),
    hostSnapshot,
    minPlayers,
    maxPlayers,
    allowedVisibility: ["PRIVATE"],
    allowedJoinPolicies: ["OPEN"],
    hostDeparturePolicy: "close",
    resultTrust: "UNVERIFIED",
    maxMessageBytes: boundedInteger(source, "maxMessageBytes", 1, 4 * 1024),
    maxSnapshotBytes,
    messagesPerSecond: boundedInteger(source, "messagesPerSecond", 1, 20),
    roomBytesPerSecond: boundedInteger(source, "roomBytesPerSecond", 1, 256 * 1024),
    roomTtlSeconds: boundedInteger(source, "roomTtlSeconds", 1, 2 * 60 * 60),
    enabled: booleanValue(source, "enabled"),
  };
}

/** Phase 4 storage writes are Relay-only. */
export const parseApprovedMultiplayerProfileV1 = parseApprovedRelayMultiplayerProfileV1;
