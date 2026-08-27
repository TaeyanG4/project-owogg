import {
  MULTIPLAYER_PROTOCOL_VERSION,
  parseApprovedMultiplayerProfileV1,
  type ApprovedMultiplayerProfileV1,
  type MultiplayerRuntimeBackend,
} from "./multiplayerProfile.js";
import {
  OWOGG_MULTIPLAYER_MANAGED_TEMPLATE_IDS,
  OWOGG_MULTIPLAYER_REQUEST_VERSION,
  type OwoggManagedMultiplayerRequestV1,
  type OwoggMultiplayerManagedTemplateId,
  type OwoggMultiplayerSimulation,
} from "@owogg/game-sdk/contracts";
import { sha256Hex } from "../../../domain/contentHash.js";
import {
  parseMultiplayerCapabilityRequestV1,
  resolveMultiplayerRuntimeV1,
  MultiplayerCapabilityValidationError,
  type MultiplayerCapabilityRequestV1,
  type MultiplayerRuntimeResolutionV1,
} from "./multiplayerCapability.js";

export const MULTIPLAYER_PROFILE_REQUEST_SCHEMA_VERSION = 1 as const;
export const MULTIPLAYER_MANAGED_TEMPLATE_IDS = OWOGG_MULTIPLAYER_MANAGED_TEMPLATE_IDS;

export type MultiplayerManagedTemplateId = OwoggMultiplayerManagedTemplateId;

export interface ManagedMultiplayerProfileRequestV1 {
  readonly requestSchemaVersion: typeof MULTIPLAYER_PROFILE_REQUEST_SCHEMA_VERSION;
  readonly kind: "managed-template";
  readonly template: {
    readonly id: MultiplayerManagedTemplateId;
    readonly version: 1;
  };
  readonly capability: MultiplayerCapabilityRequestV1;
  readonly config: Readonly<Record<string, number>>;
  readonly client: {
    readonly protocolVersion: typeof MULTIPLAYER_PROTOCOL_VERSION;
  };
}

export type ManagedMultiplayerRequestResolutionV1 =
  | {
      readonly status: "SUPPORTED_V1";
      readonly request: ManagedMultiplayerProfileRequestV1;
      readonly resolvedClass: "M1" | "M2";
      readonly runtimeBackend: MultiplayerRuntimeBackend;
      readonly checkpointPolicy: "accepted-action" | "phase-boundary";
      readonly activeRestartPolicy: "restore-checkpoint" | "abort-infra";
    }
  | Exclude<MultiplayerRuntimeResolutionV1, { readonly status: "SUPPORTED_V1" }>;

export interface ManagedMultiplayerProfilePolicyV1 {
  readonly resolvedClass: "M1" | "M2";
  readonly simulationModel: Extract<
    MultiplayerCapabilityRequestV1["simulation"],
    "turn" | "event" | "realtime"
  >;
  readonly runtimeBackend: MultiplayerRuntimeBackend;
  readonly rulesetKey:
    "managed:turn-grid:v1" | "managed:reaction-arena:v1" | "managed:realtime-paddle:v1";
  readonly rulesetRevision: 1;
  readonly resolvedConfigJson: string;
  readonly lifecycle: Extract<MultiplayerCapabilityRequestV1["lifecycle"], "match" | "continuous">;
  readonly persistence: "match";
  readonly latencyProfile: Extract<
    MultiplayerCapabilityRequestV1["latency"],
    "relaxed" | "interactive"
  >;
  readonly reconnectPolicy: MultiplayerCapabilityRequestV1["reconnect"];
  readonly minPlayers: number;
  readonly maxPlayers: number;
  readonly allowedVisibility: readonly ["PRIVATE"];
  readonly allowedJoinPolicies: readonly ["OPEN"];
  readonly maxActionBytes: number;
  readonly maxStateBytes: number;
  readonly actionRateLimit: number;
  readonly rewardPolicyId: null;
}

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
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    invalid(`${path}.${key} must be an integer between ${minimum} and ${maximum}`);
  }
  return value as number;
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

function parseConfig(
  templateId: MultiplayerManagedTemplateId,
  value: unknown,
): Readonly<Record<string, number>> {
  const source = record(value, "multiplayer.config");
  if (templateId === "turn-grid") {
    exactKeys(source, ["boardWidth", "boardHeight", "winLength"], "multiplayer.config");
    const boardWidth = integer(source, "boardWidth", "multiplayer.config", 3, 25);
    const boardHeight = integer(source, "boardHeight", "multiplayer.config", 3, 25);
    const winLength = integer(source, "winLength", "multiplayer.config", 3, 25);
    if (winLength > Math.max(boardWidth, boardHeight)) {
      invalid("multiplayer.config.winLength cannot exceed both board dimensions");
    }
    return { boardWidth, boardHeight, winLength };
  }
  if (templateId === "reaction-arena") {
    exactKeys(source, ["rounds", "responseWindowMs"], "multiplayer.config");
    return {
      rounds: integer(source, "rounds", "multiplayer.config", 1, 20),
      responseWindowMs: integer(source, "responseWindowMs", "multiplayer.config", 100, 10_000),
    };
  }
  exactKeys(source, ["fieldWidth", "fieldHeight", "targetScore"], "multiplayer.config");
  return {
    fieldWidth: integer(source, "fieldWidth", "multiplayer.config", 320, 4096),
    fieldHeight: integer(source, "fieldHeight", "multiplayer.config", 180, 2160),
    targetScore: integer(source, "targetScore", "multiplayer.config", 1, 21),
  };
}

function assertTemplateCompatibility(
  templateId: MultiplayerManagedTemplateId,
  capability: MultiplayerCapabilityRequestV1,
): void {
  if (templateId === "turn-grid") {
    if (
      capability.players.min !== 2 ||
      capability.players.max !== 2 ||
      capability.simulation !== "turn" ||
      capability.lifecycle !== "match" ||
      capability.persistence !== "match" ||
      capability.latency !== "relaxed" ||
      capability.reconnect !== "resume" ||
      capability.capabilities.hiddenInformation ||
      capability.capabilities.simultaneousResponse ||
      capability.capabilities.joinInProgress ||
      capability.capabilities.spectators
    ) {
      invalid("turn-grid requirements do not match the managed template contract");
    }
    return;
  }
  if (templateId === "reaction-arena") {
    if (
      capability.players.min < 2 ||
      capability.players.max > 8 ||
      capability.simulation !== "event" ||
      capability.lifecycle !== "match" ||
      capability.persistence !== "match" ||
      capability.latency !== "interactive" ||
      capability.reconnect !== "none" ||
      !capability.capabilities.simultaneousResponse ||
      capability.capabilities.hiddenInformation ||
      capability.capabilities.joinInProgress ||
      capability.capabilities.spectators
    ) {
      invalid("reaction-arena requirements do not match the managed template contract");
    }
    return;
  }
  if (
    capability.players.min !== 2 ||
    capability.players.max !== 2 ||
    capability.simulation !== "realtime" ||
    capability.lifecycle !== "continuous" ||
    capability.persistence !== "match" ||
    capability.latency !== "interactive" ||
    capability.reconnect !== "resume" ||
    !capability.capabilities.simultaneousResponse ||
    capability.capabilities.hiddenInformation ||
    capability.capabilities.joinInProgress ||
    capability.capabilities.spectators
  ) {
    invalid("realtime-paddle requirements do not match the managed template contract");
  }
}

/** Strict parser for the planned owogg.json v2 `multiplayer` request block. */
export function parseManagedMultiplayerProfileRequestV1(
  value: unknown,
): ManagedMultiplayerProfileRequestV1 {
  const source = record(value, "multiplayer");
  exactKeys(
    source,
    ["requestVersion", "kind", "template", "players", "requirements", "config", "client"],
    "multiplayer",
  );
  if (source.requestVersion !== OWOGG_MULTIPLAYER_REQUEST_VERSION) {
    invalid(`multiplayer.requestVersion must be ${OWOGG_MULTIPLAYER_REQUEST_VERSION}`);
  }
  if (source.kind !== "managed-template") invalid('multiplayer.kind must be "managed-template"');

  const templateSource = record(source.template, "multiplayer.template");
  exactKeys(templateSource, ["id", "version"], "multiplayer.template");
  const templateId = enumValue(
    templateSource,
    "id",
    "multiplayer.template",
    MULTIPLAYER_MANAGED_TEMPLATE_IDS,
  );
  if (templateSource.version !== 1) invalid("multiplayer.template.version must be exactly 1");

  const players = record(source.players, "multiplayer.players");
  exactKeys(players, ["min", "max"], "multiplayer.players");
  const requirements = record(source.requirements, "multiplayer.requirements");
  exactKeys(
    requirements,
    [
      "simulation",
      "lifecycle",
      "persistence",
      "latency",
      "reconnect",
      "hiddenInformation",
      "simultaneousResponse",
      "joinInProgress",
      "spectators",
    ],
    "multiplayer.requirements",
  );
  const requestedSimulation = enumValue(requirements, "simulation", "multiplayer.requirements", [
    "turn",
    "event",
    "continuous",
    "rollback",
  ] as const satisfies readonly OwoggMultiplayerSimulation[]);
  let capability: MultiplayerCapabilityRequestV1;
  try {
    capability = parseMultiplayerCapabilityRequestV1({
      players: {
        min: integer(players, "min", "multiplayer.players", 2, 64),
        max: integer(players, "max", "multiplayer.players", 2, 64),
      },
      simulation: requestedSimulation === "continuous" ? "realtime" : requestedSimulation,
      authority: "server",
      lifecycle: requirements.lifecycle,
      persistence: requirements.persistence,
      latency: requirements.latency,
      reconnect: requirements.reconnect,
      capabilities: {
        hiddenInformation: booleanValue(
          requirements,
          "hiddenInformation",
          "multiplayer.requirements",
        ),
        simultaneousResponse: booleanValue(
          requirements,
          "simultaneousResponse",
          "multiplayer.requirements",
        ),
        joinInProgress: booleanValue(requirements, "joinInProgress", "multiplayer.requirements"),
        spectators: booleanValue(requirements, "spectators", "multiplayer.requirements"),
      },
    });
  } catch (error) {
    if (error instanceof MultiplayerCapabilityValidationError) invalid(error.detail);
    throw error;
  }
  assertTemplateCompatibility(templateId, capability);

  const clientSource = record(source.client, "multiplayer.client");
  exactKeys(clientSource, ["protocolVersion"], "multiplayer.client");
  if (clientSource.protocolVersion !== MULTIPLAYER_PROTOCOL_VERSION) {
    invalid(`multiplayer.client.protocolVersion must be ${MULTIPLAYER_PROTOCOL_VERSION}`);
  }

  return {
    requestSchemaVersion: MULTIPLAYER_PROFILE_REQUEST_SCHEMA_VERSION,
    kind: "managed-template",
    template: { id: templateId, version: 1 },
    capability,
    config: parseConfig(templateId, source.config),
    client: { protocolVersion: MULTIPLAYER_PROTOCOL_VERSION },
  };
}

export function resolveManagedMultiplayerProfileRequestV1(
  request: ManagedMultiplayerProfileRequestV1,
): ManagedMultiplayerRequestResolutionV1 {
  const runtime = resolveMultiplayerRuntimeV1(request.capability);
  return runtime.status === "SUPPORTED_V1" ? { ...runtime, request } : runtime;
}

function canonicalManagedConfig(request: ManagedMultiplayerProfileRequestV1) {
  return request.template.id === "turn-grid"
    ? {
        boardWidth: request.config.boardWidth,
        boardHeight: request.config.boardHeight,
        winLength: request.config.winLength,
      }
    : request.template.id === "reaction-arena"
      ? {
          rounds: request.config.rounds,
          responseWindowMs: request.config.responseWindowMs,
        }
      : {
          fieldWidth: request.config.fieldWidth,
          fieldHeight: request.config.fieldHeight,
          targetScore: request.config.targetScore,
        };
}

function publicSimulation(
  simulation: MultiplayerCapabilityRequestV1["simulation"],
): OwoggMultiplayerSimulation {
  return simulation === "realtime" ? "continuous" : simulation;
}

/** Rebuild the normalized public `owogg.json` v2 multiplayer request object. */
export function toOwoggManagedMultiplayerRequestV1(
  request: ManagedMultiplayerProfileRequestV1,
): OwoggManagedMultiplayerRequestV1 {
  const normalized = {
    requestVersion: OWOGG_MULTIPLAYER_REQUEST_VERSION,
    kind: request.kind,
    template: {
      id: request.template.id,
      version: request.template.version,
    },
    players: {
      min: request.capability.players.min,
      max: request.capability.players.max,
    },
    requirements: {
      simulation: publicSimulation(request.capability.simulation),
      lifecycle: request.capability.lifecycle,
      persistence: request.capability.persistence,
      latency: request.capability.latency,
      reconnect: request.capability.reconnect,
      hiddenInformation: request.capability.capabilities.hiddenInformation,
      simultaneousResponse: request.capability.capabilities.simultaneousResponse,
      joinInProgress: request.capability.capabilities.joinInProgress,
      spectators: request.capability.capabilities.spectators,
    },
    config: canonicalManagedConfig(request),
    client: {
      protocolVersion: request.client.protocolVersion,
    },
  };
  return normalized as OwoggManagedMultiplayerRequestV1;
}

/** Resolve the server-owned ruleset identity and config for one approved managed request. */
export function deriveManagedMultiplayerProfilePolicyV1(
  request: ManagedMultiplayerProfileRequestV1,
): ManagedMultiplayerProfilePolicyV1 {
  const resolution = resolveManagedMultiplayerProfileRequestV1(request);
  if (resolution.status !== "SUPPORTED_V1") {
    invalid(`request cannot be approved by the V1 runtime: ${resolution.reason}`);
  }
  const resourcePolicy =
    request.template.id === "turn-grid"
      ? { maxActionBytes: 1024, maxStateBytes: 8192, actionRateLimit: 5 }
      : request.template.id === "reaction-arena"
        ? { maxActionBytes: 512, maxStateBytes: 4096, actionRateLimit: 12 }
        : { maxActionBytes: 256, maxStateBytes: 8192, actionRateLimit: 30 };
  return {
    resolvedClass: resolution.resolvedClass,
    simulationModel: request.capability
      .simulation as ManagedMultiplayerProfilePolicyV1["simulationModel"],
    runtimeBackend: resolution.runtimeBackend,
    rulesetKey: `managed:${request.template.id}:v1`,
    rulesetRevision: 1,
    resolvedConfigJson: JSON.stringify(canonicalManagedConfig(request)),
    lifecycle: request.capability.lifecycle as ManagedMultiplayerProfilePolicyV1["lifecycle"],
    persistence: "match",
    latencyProfile: request.capability
      .latency as ManagedMultiplayerProfilePolicyV1["latencyProfile"],
    reconnectPolicy: request.capability.reconnect,
    minPlayers: request.capability.players.min,
    maxPlayers: request.capability.players.max,
    allowedVisibility: ["PRIVATE"],
    allowedJoinPolicies: ["OPEN"],
    ...resourcePolicy,
    rewardPolicyId: null,
  };
}

/**
 * Builds the only trusted profile shape that may result from a managed request. The profile always
 * starts disabled; activation remains a separate audited control-plane decision after the exact
 * game version has passed moderation and Staging validation.
 */
export function buildApprovedManagedMultiplayerProfileV1(input: {
  readonly gameId: number;
  readonly gameVersionId: number;
  readonly requestHash: string;
  readonly profileRevision: number;
  readonly request: ManagedMultiplayerProfileRequestV1;
}): ApprovedMultiplayerProfileV1 {
  const policy = deriveManagedMultiplayerProfilePolicyV1(input.request);
  return parseApprovedMultiplayerProfileV1({
    profileVersion: 1,
    gameId: input.gameId,
    gameVersionId: input.gameVersionId,
    sourceRequestHash: input.requestHash,
    profileRevision: input.profileRevision,
    protocolVersion: MULTIPLAYER_PROTOCOL_VERSION,
    ...policy,
    enabled: false,
  });
}

/**
 * Defense-in-depth for the trusted profile write path. Creator input selects only a managed
 * template; it cannot be reviewed into a different ruleset, capability class, or player model.
 */
export function assertManagedMultiplayerProfileMatchesRequestV1(
  request: ManagedMultiplayerProfileRequestV1,
  profile: ApprovedMultiplayerProfileV1,
): void {
  const policy = deriveManagedMultiplayerProfilePolicyV1(request);
  if (
    profile.resolvedClass !== policy.resolvedClass ||
    profile.simulationModel !== policy.simulationModel ||
    profile.runtimeBackend !== policy.runtimeBackend ||
    profile.rulesetKey !== policy.rulesetKey ||
    profile.rulesetRevision !== policy.rulesetRevision ||
    profile.resolvedConfigJson !== policy.resolvedConfigJson ||
    profile.lifecycle !== policy.lifecycle ||
    profile.persistence !== policy.persistence ||
    profile.latencyProfile !== policy.latencyProfile ||
    profile.reconnectPolicy !== policy.reconnectPolicy ||
    profile.minPlayers !== policy.minPlayers ||
    profile.maxPlayers !== policy.maxPlayers ||
    JSON.stringify(profile.allowedVisibility) !== JSON.stringify(policy.allowedVisibility) ||
    JSON.stringify(profile.allowedJoinPolicies) !== JSON.stringify(policy.allowedJoinPolicies) ||
    profile.maxActionBytes !== policy.maxActionBytes ||
    profile.maxStateBytes !== policy.maxStateBytes ||
    profile.actionRateLimit !== policy.actionRateLimit ||
    profile.rewardPolicyId !== policy.rewardPolicyId
  ) {
    invalid("approved profile does not match the server-resolved managed template policy");
  }
}

/**
 * Rebuild the public owogg.json request shape in a fixed property order. Storage and review use
 * this representation rather than the uploader's original whitespace or property ordering, so
 * semantically identical requests have one stable hash.
 */
export function serializeManagedMultiplayerProfileRequestV1(
  request: ManagedMultiplayerProfileRequestV1,
): string {
  const parsed = parseManagedMultiplayerProfileRequestV1({
    requestVersion: OWOGG_MULTIPLAYER_REQUEST_VERSION,
    kind: request.kind,
    template: {
      id: request.template.id,
      version: request.template.version,
    },
    players: {
      min: request.capability.players.min,
      max: request.capability.players.max,
    },
    requirements: {
      simulation: publicSimulation(request.capability.simulation),
      lifecycle: request.capability.lifecycle,
      persistence: request.capability.persistence,
      latency: request.capability.latency,
      reconnect: request.capability.reconnect,
      hiddenInformation: request.capability.capabilities.hiddenInformation,
      simultaneousResponse: request.capability.capabilities.simultaneousResponse,
      joinInProgress: request.capability.capabilities.joinInProgress,
      spectators: request.capability.capabilities.spectators,
    },
    config: request.config,
    client: {
      protocolVersion: request.client.protocolVersion,
    },
  });

  return JSON.stringify(toOwoggManagedMultiplayerRequestV1(parsed));
}

export async function hashManagedMultiplayerProfileRequestV1(
  request: ManagedMultiplayerProfileRequestV1,
): Promise<string> {
  const bytes = new TextEncoder().encode(serializeManagedMultiplayerProfileRequestV1(request));
  return sha256Hex(bytes.buffer);
}
