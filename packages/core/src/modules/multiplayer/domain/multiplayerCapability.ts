/**
 * Provider-neutral multiplayer capability classification. A game or Creator request describes
 * requirements; only the platform resolves a class and runtime backend.
 */

export const MULTIPLAYER_CLASSES = ["M0", "M1", "M2", "M3", "M4", "M5", "M6"] as const;

export type MultiplayerClass = (typeof MULTIPLAYER_CLASSES)[number];

export const MULTIPLAYER_SIMULATION_MODELS = ["turn", "event", "realtime", "rollback"] as const;

export type MultiplayerSimulationModel = (typeof MULTIPLAYER_SIMULATION_MODELS)[number];

export const MULTIPLAYER_LIFECYCLES = ["match", "continuous", "persistent"] as const;
export type MultiplayerLifecycle = (typeof MULTIPLAYER_LIFECYCLES)[number];

export const MULTIPLAYER_PERSISTENCE_MODES = ["none", "match", "player", "world"] as const;
export type MultiplayerPersistenceMode = (typeof MULTIPLAYER_PERSISTENCE_MODES)[number];

export const MULTIPLAYER_LATENCY_PROFILES = ["relaxed", "interactive", "critical"] as const;
export type MultiplayerLatencyProfile = (typeof MULTIPLAYER_LATENCY_PROFILES)[number];

export const MULTIPLAYER_RECONNECT_POLICIES = ["none", "rejoin", "resume"] as const;
export type MultiplayerReconnectPolicy = (typeof MULTIPLAYER_RECONNECT_POLICIES)[number];

export const MULTIPLAYER_AUTHORITIES = ["server"] as const;
export type MultiplayerAuthority = (typeof MULTIPLAYER_AUTHORITIES)[number];

export const MULTIPLAYER_V1_MAX_PLAYERS = 8;
export const MULTIPLAYER_CAPABILITY_MAX_DECLARED_PLAYERS = 64;

export interface MultiplayerCapabilityFlags {
  readonly hiddenInformation: boolean;
  readonly simultaneousResponse: boolean;
  readonly joinInProgress: boolean;
  readonly spectators: boolean;
}

export interface MultiplayerCapabilityRequestV1 {
  readonly players: {
    readonly min: number;
    readonly max: number;
  };
  readonly simulation: MultiplayerSimulationModel;
  readonly authority: MultiplayerAuthority;
  readonly lifecycle: MultiplayerLifecycle;
  readonly persistence: MultiplayerPersistenceMode;
  readonly latency: MultiplayerLatencyProfile;
  readonly reconnect: MultiplayerReconnectPolicy;
  readonly capabilities: MultiplayerCapabilityFlags;
}

export type MultiplayerClassResolution =
  | {
      readonly status: "SUPPORTED_V1";
      readonly resolvedClass: "M1" | "M2";
    }
  | {
      readonly status: "DEFERRED";
      readonly requiredClass: "M3" | "M5";
      readonly reason: string;
    }
  | {
      readonly status: "UNSUPPORTED_V1";
      readonly reason: string;
    };

export type MultiplayerRuntimeResolutionV1 =
  | {
      readonly status: "SUPPORTED_V1";
      readonly resolvedClass: "M1" | "M2";
      readonly runtimeBackend: "durable-object";
      readonly checkpointPolicy: "accepted-action" | "phase-boundary";
      readonly activeRestartPolicy: "restore-checkpoint" | "abort-infra";
    }
  | Exclude<MultiplayerClassResolution, { readonly status: "SUPPORTED_V1" }>;

export class MultiplayerCapabilityValidationError extends Error {
  constructor(public readonly detail: string) {
    super(`INVALID_MULTIPLAYER_CAPABILITY: ${detail}`);
  }
}

function invalid(detail: string): never {
  throw new MultiplayerCapabilityValidationError(detail);
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

function requiredBoolean(source: Record<string, unknown>, key: string, path: string): boolean {
  const value = source[key];
  if (typeof value !== "boolean") invalid(`${path}.${key} must be a boolean`);
  return value;
}

function playerCount(source: Record<string, unknown>, key: "min" | "max"): number {
  const value = source[key];
  if (!Number.isInteger(value)) invalid(`players.${key} must be an integer`);
  if ((value as number) < 2 || (value as number) > MULTIPLAYER_CAPABILITY_MAX_DECLARED_PLAYERS) {
    invalid(`players.${key} must be between 2 and ${MULTIPLAYER_CAPABILITY_MAX_DECLARED_PLAYERS}`);
  }
  return value as number;
}

/** Parse and semantically validate an untrusted capability request. */
export function parseMultiplayerCapabilityRequestV1(
  value: unknown,
): MultiplayerCapabilityRequestV1 {
  const source = record(value, "multiplayer");
  exactKeys(
    source,
    [
      "players",
      "simulation",
      "authority",
      "lifecycle",
      "persistence",
      "latency",
      "reconnect",
      "capabilities",
    ],
    "multiplayer",
  );

  const playersSource = record(source.players, "players");
  exactKeys(playersSource, ["min", "max"], "players");
  const players = {
    min: playerCount(playersSource, "min"),
    max: playerCount(playersSource, "max"),
  };
  if (players.min > players.max) invalid("players.min must not exceed players.max");

  const capabilitiesSource = record(source.capabilities, "capabilities");
  exactKeys(
    capabilitiesSource,
    ["hiddenInformation", "simultaneousResponse", "joinInProgress", "spectators"],
    "capabilities",
  );
  const capabilities: MultiplayerCapabilityFlags = {
    hiddenInformation: requiredBoolean(capabilitiesSource, "hiddenInformation", "capabilities"),
    simultaneousResponse: requiredBoolean(
      capabilitiesSource,
      "simultaneousResponse",
      "capabilities",
    ),
    joinInProgress: requiredBoolean(capabilitiesSource, "joinInProgress", "capabilities"),
    spectators: requiredBoolean(capabilitiesSource, "spectators", "capabilities"),
  };

  const simulation = enumValue(source, "simulation", "multiplayer", MULTIPLAYER_SIMULATION_MODELS);
  const authority = enumValue(source, "authority", "multiplayer", MULTIPLAYER_AUTHORITIES);
  const lifecycle = enumValue(source, "lifecycle", "multiplayer", MULTIPLAYER_LIFECYCLES);
  const persistence = enumValue(
    source,
    "persistence",
    "multiplayer",
    MULTIPLAYER_PERSISTENCE_MODES,
  );
  const latency = enumValue(source, "latency", "multiplayer", MULTIPLAYER_LATENCY_PROFILES);
  const reconnect = enumValue(source, "reconnect", "multiplayer", MULTIPLAYER_RECONNECT_POLICIES);

  if (simulation === "rollback" && latency !== "critical") {
    invalid("rollback simulation requires critical latency");
  }
  if (simulation === "turn" && latency === "critical") {
    invalid("turn simulation must not request critical latency");
  }
  if (simulation === "realtime" && latency === "relaxed") {
    invalid("realtime simulation requires interactive or critical latency");
  }
  if (lifecycle === "persistent" && persistence !== "world") {
    invalid("persistent lifecycle requires world persistence");
  }
  if (persistence === "world" && lifecycle !== "persistent") {
    invalid("world persistence requires persistent lifecycle");
  }
  if (reconnect === "resume" && persistence === "none") {
    invalid("resume reconnect requires durable match, player, or world persistence");
  }

  return {
    players,
    simulation,
    authority,
    lifecycle,
    persistence,
    latency,
    reconnect,
    capabilities,
  };
}

/**
 * Resolve only what the current V1 contract can prove from declared capabilities. M4/M6 require
 * measured platform load/topology and must never be inferred from player count alone.
 */
export function resolveMultiplayerClassV1(
  capability: MultiplayerCapabilityRequestV1,
): MultiplayerClassResolution {
  if (capability.lifecycle === "persistent" || capability.persistence === "world") {
    return {
      status: "DEFERRED",
      requiredClass: "M5",
      reason: "persistent world capabilities are gated after M1/M2 production measurements",
    };
  }

  if (capability.simulation === "rollback" || capability.latency === "critical") {
    return {
      status: "DEFERRED",
      requiredClass: "M3",
      reason: "critical deterministic/rollback capabilities require the M3 evidence gate",
    };
  }

  if (capability.players.max > MULTIPLAYER_V1_MAX_PLAYERS) {
    return {
      status: "UNSUPPORTED_V1",
      reason: `V1 profiles are capped at ${MULTIPLAYER_V1_MAX_PLAYERS} participants pending load data`,
    };
  }

  if (capability.capabilities.spectators) {
    return {
      status: "UNSUPPORTED_V1",
      reason: "spectators are outside the V1 transport and projection contract",
    };
  }

  if (capability.simulation === "realtime") {
    return { status: "SUPPORTED_V1", resolvedClass: "M2" };
  }

  if (capability.simulation === "event" && capability.latency === "interactive") {
    return { status: "SUPPORTED_V1", resolvedClass: "M2" };
  }

  return { status: "SUPPORTED_V1", resolvedClass: "M1" };
}

/**
 * Resolve the internal runtime only after capability validation/classification. Creator input can
 * never select this backend or its persistence policy directly.
 */
export function resolveMultiplayerRuntimeV1(
  capability: MultiplayerCapabilityRequestV1,
): MultiplayerRuntimeResolutionV1 {
  const classification = resolveMultiplayerClassV1(capability);
  if (classification.status !== "SUPPORTED_V1") return classification;
  return classification.resolvedClass === "M1"
    ? {
        ...classification,
        runtimeBackend: "durable-object",
        checkpointPolicy: "accepted-action",
        activeRestartPolicy: "restore-checkpoint",
      }
    : {
        ...classification,
        runtimeBackend: "durable-object",
        checkpointPolicy: "phase-boundary",
        activeRestartPolicy: "abort-infra",
      };
}
