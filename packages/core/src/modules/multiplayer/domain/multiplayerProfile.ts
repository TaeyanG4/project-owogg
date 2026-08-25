import {
  MULTIPLAYER_LATENCY_PROFILES,
  MULTIPLAYER_LIFECYCLES,
  MULTIPLAYER_RECONNECT_POLICIES,
  MULTIPLAYER_SIMULATION_MODELS,
  MULTIPLAYER_V1_MAX_PLAYERS,
  type MultiplayerLatencyProfile,
  type MultiplayerLifecycle,
  type MultiplayerReconnectPolicy,
  type MultiplayerSimulationModel,
} from "./multiplayerCapability.js";

export const MULTIPLAYER_PROFILE_VERSION = 1 as const;
export const MULTIPLAYER_PROTOCOL_VERSION = 1 as const;
export const MULTIPLAYER_RUNTIME_BACKENDS = ["durable-object"] as const;
export const MULTIPLAYER_VISIBILITIES = ["PUBLIC", "UNLISTED", "PRIVATE"] as const;
export const MULTIPLAYER_JOIN_POLICIES = ["OPEN", "INVITE_ONLY"] as const;

export type MultiplayerRuntimeBackend = (typeof MULTIPLAYER_RUNTIME_BACKENDS)[number];
export type MultiplayerVisibility = (typeof MULTIPLAYER_VISIBILITIES)[number];
export type MultiplayerJoinPolicy = (typeof MULTIPLAYER_JOIN_POLICIES)[number];

export interface ApprovedMultiplayerProfileV1 {
  readonly profileVersion: typeof MULTIPLAYER_PROFILE_VERSION;
  readonly gameId: number;
  readonly gameVersionId: number;
  readonly sourceRequestHash: string | null;
  readonly profileRevision: number;
  readonly protocolVersion: typeof MULTIPLAYER_PROTOCOL_VERSION;
  readonly resolvedClass: "M1" | "M2";
  readonly simulationModel: Extract<MultiplayerSimulationModel, "turn" | "event" | "realtime">;
  readonly runtimeBackend: MultiplayerRuntimeBackend;
  readonly rulesetKey: string;
  readonly rulesetRevision: number;
  readonly resolvedConfigJson: string;
  readonly lifecycle: Extract<MultiplayerLifecycle, "match" | "continuous">;
  readonly persistence: "match";
  readonly latencyProfile: Extract<MultiplayerLatencyProfile, "relaxed" | "interactive">;
  readonly reconnectPolicy: MultiplayerReconnectPolicy;
  readonly minPlayers: number;
  readonly maxPlayers: number;
  readonly allowedVisibility: readonly MultiplayerVisibility[];
  readonly allowedJoinPolicies: readonly MultiplayerJoinPolicy[];
  readonly maxActionBytes: number;
  readonly maxStateBytes: number;
  readonly actionRateLimit: number;
  readonly rewardPolicyId: string | null;
  readonly enabled: boolean;
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
}

function positiveInteger(source: Record<string, unknown>, key: string): number {
  const value = source[key];
  if (!Number.isInteger(value) || (value as number) <= 0) {
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
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    invalid(`${key} must be an integer between ${minimum} and ${maximum}`);
  }
  return value as number;
}

function enumValue<T extends string>(
  source: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T {
  const value = source[key];
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    invalid(`${key} must be one of ${allowed.join(", ")}`);
  }
  return value as T;
}

function nullableIdentifier(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  if (value === null) return null;
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._:/-]{0,95}$/.test(value)) {
    invalid(`${key} must be null or a stable lowercase identifier`);
  }
  return value;
}

function requiredIdentifier(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._:/-]{0,95}$/.test(value)) {
    invalid(`${key} must be a stable lowercase identifier`);
  }
  return value;
}

function stringArray<T extends string>(
  source: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): readonly T[] {
  const value = source[key];
  if (!Array.isArray(value) || value.length === 0) invalid(`${key} must be a non-empty array`);
  const parsed = value.map((candidate) => {
    if (typeof candidate !== "string" || !(allowed as readonly string[]).includes(candidate)) {
      invalid(`${key} contains an unsupported value`);
    }
    return candidate as T;
  });
  if (new Set(parsed).size !== parsed.length) invalid(`${key} must not contain duplicates`);
  return parsed;
}

function parseConfigJson(value: unknown): string {
  if (typeof value !== "string") invalid("resolvedConfigJson must be a JSON string");
  if (new TextEncoder().encode(value).byteLength > 32 * 1024) {
    invalid("resolvedConfigJson exceeds 32 KiB");
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      invalid("resolvedConfigJson must contain a JSON object");
    }
  } catch (error) {
    if (error instanceof MultiplayerProfileValidationError) throw error;
    invalid("resolvedConfigJson must contain valid JSON");
  }
  return value;
}

/** Strictly parse the trusted profile snapshot read from storage. */
export function parseApprovedMultiplayerProfileV1(value: unknown): ApprovedMultiplayerProfileV1 {
  const source = record(value, "profile");
  exactKeys(
    source,
    [
      "profileVersion",
      "gameId",
      "gameVersionId",
      "sourceRequestHash",
      "profileRevision",
      "protocolVersion",
      "resolvedClass",
      "simulationModel",
      "runtimeBackend",
      "rulesetKey",
      "rulesetRevision",
      "resolvedConfigJson",
      "lifecycle",
      "persistence",
      "latencyProfile",
      "reconnectPolicy",
      "minPlayers",
      "maxPlayers",
      "allowedVisibility",
      "allowedJoinPolicies",
      "maxActionBytes",
      "maxStateBytes",
      "actionRateLimit",
      "rewardPolicyId",
      "enabled",
    ],
    "profile",
  );

  if (source.profileVersion !== MULTIPLAYER_PROFILE_VERSION) {
    invalid(`profileVersion must be ${MULTIPLAYER_PROFILE_VERSION}`);
  }
  if (source.protocolVersion !== MULTIPLAYER_PROTOCOL_VERSION) {
    invalid(`protocolVersion must be ${MULTIPLAYER_PROTOCOL_VERSION}`);
  }

  const sourceRequestHash = source.sourceRequestHash;
  if (
    sourceRequestHash !== null &&
    (typeof sourceRequestHash !== "string" || !/^[a-f0-9]{64}$/.test(sourceRequestHash))
  ) {
    invalid("sourceRequestHash must be null or a lowercase SHA-256 hex digest");
  }

  const resolvedClass = enumValue(source, "resolvedClass", ["M1", "M2"] as const);
  const simulationModel = enumValue(
    source,
    "simulationModel",
    MULTIPLAYER_SIMULATION_MODELS.filter(
      (value): value is "turn" | "event" | "realtime" => value !== "rollback",
    ),
  );
  const lifecycle = enumValue(
    source,
    "lifecycle",
    MULTIPLAYER_LIFECYCLES.filter(
      (value): value is "match" | "continuous" => value !== "persistent",
    ),
  );
  const latencyProfile = enumValue(
    source,
    "latencyProfile",
    MULTIPLAYER_LATENCY_PROFILES.filter(
      (value): value is "relaxed" | "interactive" => value !== "critical",
    ),
  );

  const minPlayers = boundedInteger(source, "minPlayers", 2, MULTIPLAYER_V1_MAX_PLAYERS);
  const maxPlayers = boundedInteger(source, "maxPlayers", 2, MULTIPLAYER_V1_MAX_PLAYERS);
  if (minPlayers > maxPlayers) invalid("minPlayers must not exceed maxPlayers");

  if (resolvedClass === "M1" && simulationModel === "realtime") {
    invalid("M1 profiles cannot use realtime simulation");
  }
  if (resolvedClass === "M2" && simulationModel === "turn") {
    invalid("M2 profiles cannot use turn simulation");
  }
  if (resolvedClass === "M1" && latencyProfile !== "relaxed") {
    invalid("M1 profiles require relaxed latency");
  }
  if (resolvedClass === "M2" && latencyProfile !== "interactive") {
    invalid("M2 profiles require interactive latency");
  }
  if (resolvedClass === "M1" && lifecycle !== "match") {
    invalid("M1 V1 profiles require match lifecycle");
  }

  const persistence = source.persistence;
  if (persistence !== "match") invalid("persistence must be match in V1");

  const enabled = source.enabled;
  if (typeof enabled !== "boolean") invalid("enabled must be a boolean");

  return {
    profileVersion: MULTIPLAYER_PROFILE_VERSION,
    gameId: positiveInteger(source, "gameId"),
    gameVersionId: positiveInteger(source, "gameVersionId"),
    sourceRequestHash: sourceRequestHash as string | null,
    profileRevision: positiveInteger(source, "profileRevision"),
    protocolVersion: MULTIPLAYER_PROTOCOL_VERSION,
    resolvedClass,
    simulationModel,
    runtimeBackend: enumValue(source, "runtimeBackend", MULTIPLAYER_RUNTIME_BACKENDS),
    rulesetKey: requiredIdentifier(source, "rulesetKey"),
    rulesetRevision: positiveInteger(source, "rulesetRevision"),
    resolvedConfigJson: parseConfigJson(source.resolvedConfigJson),
    lifecycle,
    persistence: "match",
    latencyProfile,
    reconnectPolicy: enumValue(source, "reconnectPolicy", MULTIPLAYER_RECONNECT_POLICIES),
    minPlayers,
    maxPlayers,
    allowedVisibility: stringArray(source, "allowedVisibility", MULTIPLAYER_VISIBILITIES),
    allowedJoinPolicies: stringArray(source, "allowedJoinPolicies", MULTIPLAYER_JOIN_POLICIES),
    maxActionBytes: boundedInteger(source, "maxActionBytes", 1, 4 * 1024),
    maxStateBytes: boundedInteger(source, "maxStateBytes", 1, 16 * 1024),
    actionRateLimit: boundedInteger(source, "actionRateLimit", 1, 60),
    rewardPolicyId: nullableIdentifier(source, "rewardPolicyId"),
    enabled,
  };
}
