import { isJsonSafeValue } from "./protocol.js";

/**
 * The multiplayer MessagePort protocol. It is deliberately separate from the legacy completion
 * bridge so an online match can never smuggle GAME_COMPLETE/GAME_EVENT facts into progression.
 */

export const MULTIPLAYER_BRIDGE_PROTOCOL_VERSION = 1 as const;
export const MULTIPLAYER_CLIENT_MAX_PAYLOAD_BYTES = 4 * 1024;
export const MULTIPLAYER_HOST_MAX_PAYLOAD_BYTES = 16 * 1024;
/** Parent-owned control hint. The host consumes it and never forwards it into the game iframe. */
export const MULTIPLAYER_REMATCH_CHANGED_EVENT = "OWOGG_REMATCH_CHANGED" as const;
/** Server-authoritative participant connectivity notice consumed by the parent room chrome. */
export const MULTIPLAYER_PLAYER_CONNECTION_CHANGED_EVENT =
  "OWOGG_PLAYER_CONNECTION_CHANGED" as const;

export const MULTIPLAYER_ACTION_REJECTION_CODES = [
  "MATCH_NOT_ACTIVE",
  "NOT_PARTICIPANT",
  "NOT_YOUR_TURN",
  "ACTION_INVALID",
  "ACTION_CONFLICT",
  "ACTION_ID_REUSED",
  "STALE_GENERATION",
  "RATE_LIMITED",
] as const;
export const MULTIPLAYER_DISCONNECT_CODES = [
  "NETWORK_LOST",
  "SERVER_UNAVAILABLE",
  "REPLACED_BY_NEW_CONNECTION",
  "AUTH_EXPIRED",
  "SLOW_CONSUMER",
  "LEFT",
] as const;
export const MULTIPLAYER_ABORT_CODES = [
  "INSUFFICIENT_PLAYERS",
  "PARTICIPANT_LEFT",
  "RULE_VIOLATION",
  "INFRA_FAILURE",
  "ADMIN_KILLED",
  "VERSION_UNAVAILABLE",
] as const;

export type MultiplayerActionRejectionCode = (typeof MULTIPLAYER_ACTION_REJECTION_CODES)[number];
export type MultiplayerDisconnectCode = (typeof MULTIPLAYER_DISCONNECT_CODES)[number];
export type MultiplayerAbortCode = (typeof MULTIPLAYER_ABORT_CODES)[number];

type ProtocolVersion = typeof MULTIPLAYER_BRIDGE_PROTOCOL_VERSION;

export interface MultiReadyMessage {
  readonly type: "MULTI_READY";
  readonly v: ProtocolVersion;
  readonly generation: number;
}

export interface MultiActionMessage {
  readonly type: "MULTI_ACTION";
  readonly v: ProtocolVersion;
  readonly generation: number;
  readonly clientSeq: number;
  readonly clientActionId: string;
  readonly expectedRevision: number;
  readonly payload: unknown;
}

export interface MultiInputMessage {
  readonly type: "MULTI_INPUT";
  readonly v: ProtocolVersion;
  readonly generation: number;
  readonly clientSeq: number;
  readonly payload: unknown;
}

export interface MultiLeaveMessage {
  readonly type: "MULTI_LEAVE";
  readonly v: ProtocolVersion;
  readonly generation: number;
}

export type GameToHostMultiplayerMessage =
  MultiReadyMessage | MultiActionMessage | MultiInputMessage | MultiLeaveMessage;

export interface MultiInitMessage {
  readonly type: "MULTI_INIT";
  readonly v: ProtocolVersion;
  readonly participantId: string;
  readonly gameVersionId: number;
  readonly profileRevision: number;
  readonly rulesetKey: string;
  readonly rulesetRevision: number;
  readonly generation: number;
}

export interface MultiConnectedMessage {
  readonly type: "MULTI_CONNECTED";
  readonly v: ProtocolVersion;
  readonly generation: number;
  readonly connectionGeneration: number;
}

export interface MultiParticipantMessage {
  readonly type: "MULTI_PLAYER_JOINED" | "MULTI_PLAYER_LEFT";
  readonly v: ProtocolVersion;
  readonly generation: number;
  readonly serverSeq: number;
  readonly participantId: string;
}

export interface MultiStateMessage {
  readonly type: "MULTI_SYNC" | "MULTI_STATE";
  readonly v: ProtocolVersion;
  readonly generation: number;
  readonly serverSeq: number;
  readonly revision: number;
  readonly payload: unknown;
}

export interface MultiEventMessage {
  readonly type: "MULTI_EVENT";
  readonly v: ProtocolVersion;
  readonly generation: number;
  readonly serverSeq: number;
  readonly name: string;
  readonly payload?: unknown;
}

export interface MultiTerminalPendingMessage {
  readonly type: "MULTI_TERMINAL_PENDING";
  readonly v: ProtocolVersion;
  readonly generation: number;
  readonly serverSeq: number;
}

export interface MultiTerminalCommittedMessage {
  readonly type: "MULTI_TERMINAL_COMMITTED";
  readonly v: ProtocolVersion;
  readonly generation: number;
  readonly serverSeq: number;
  readonly result: unknown;
}

export interface MultiActionRejectedMessage {
  readonly type: "MULTI_ACTION_REJECTED";
  readonly v: ProtocolVersion;
  readonly generation: number;
  readonly serverSeq: number;
  readonly clientActionId: string;
  readonly code: MultiplayerActionRejectionCode;
  readonly currentRevision: number;
}

export interface MultiDisconnectedMessage {
  readonly type: "MULTI_DISCONNECTED";
  readonly v: ProtocolVersion;
  readonly generation: number;
  readonly code: MultiplayerDisconnectCode;
}

export interface MultiAbortedMessage {
  readonly type: "MULTI_ABORTED";
  readonly v: ProtocolVersion;
  readonly generation: number;
  readonly code: MultiplayerAbortCode;
}

export type HostToGameMultiplayerMessage =
  | MultiInitMessage
  | MultiConnectedMessage
  | MultiParticipantMessage
  | MultiStateMessage
  | MultiEventMessage
  | MultiTerminalPendingMessage
  | MultiTerminalCommittedMessage
  | MultiActionRejectedMessage
  | MultiDisconnectedMessage
  | MultiAbortedMessage;

const textEncoder = new TextEncoder();
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const ACTION_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const RULESET_KEY_PATTERN = /^[a-z0-9][a-z0-9._:/-]{0,95}$/;
const EVENT_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(data: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(data).every((key) => allowed.includes(key));
}

type ProtocolEnvelope = Record<string, unknown> & { readonly v: ProtocolVersion };
type ClientEnvelope = ProtocolEnvelope & { readonly generation: number };
type ServerEnvelope = ClientEnvelope & { readonly serverSeq: number };

function isProtocolEnvelope(data: Record<string, unknown>): data is ProtocolEnvelope {
  return data.v === MULTIPLAYER_BRIDGE_PROTOCOL_VERSION;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isOpaqueId(value: unknown): value is string {
  return typeof value === "string" && OPAQUE_ID_PATTERN.test(value);
}

function isAllowedString<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function isWithinPayloadLimit(data: unknown, maximumBytes: number): boolean {
  try {
    const json = JSON.stringify(data);
    return typeof json === "string" && textEncoder.encode(json).byteLength <= maximumBytes;
  } catch {
    return false;
  }
}

function commonClientEnvelope(data: Record<string, unknown>): data is ClientEnvelope {
  return isProtocolEnvelope(data) && isPositiveInteger(data.generation);
}

function commonServerEnvelope(data: Record<string, unknown>): data is ServerEnvelope {
  return (
    isProtocolEnvelope(data) &&
    isPositiveInteger(data.generation) &&
    isNonNegativeInteger(data.serverSeq)
  );
}

export function parseGameToHostMultiplayerMessage(
  value: unknown,
): GameToHostMultiplayerMessage | null {
  if (!isWithinPayloadLimit(value, MULTIPLAYER_CLIENT_MAX_PAYLOAD_BYTES)) return null;
  if (!isPlainObject(value) || typeof value.type !== "string" || !commonClientEnvelope(value)) {
    return null;
  }

  switch (value.type) {
    case "MULTI_READY":
    case "MULTI_LEAVE":
      return hasExactKeys(value, ["type", "v", "generation"])
        ? ({ type: value.type, v: 1, generation: value.generation } as
            MultiReadyMessage | MultiLeaveMessage)
        : null;

    case "MULTI_ACTION":
      if (
        !hasExactKeys(value, [
          "type",
          "v",
          "generation",
          "clientSeq",
          "clientActionId",
          "expectedRevision",
          "payload",
        ]) ||
        !isNonNegativeInteger(value.clientSeq) ||
        typeof value.clientActionId !== "string" ||
        !ACTION_ID_PATTERN.test(value.clientActionId) ||
        !isNonNegativeInteger(value.expectedRevision) ||
        !isJsonSafeValue(value.payload)
      ) {
        return null;
      }
      return {
        type: "MULTI_ACTION",
        v: 1,
        generation: value.generation,
        clientSeq: value.clientSeq,
        clientActionId: value.clientActionId,
        expectedRevision: value.expectedRevision,
        payload: value.payload,
      };

    case "MULTI_INPUT":
      if (
        !hasExactKeys(value, ["type", "v", "generation", "clientSeq", "payload"]) ||
        !isNonNegativeInteger(value.clientSeq) ||
        !isJsonSafeValue(value.payload)
      ) {
        return null;
      }
      return {
        type: "MULTI_INPUT",
        v: 1,
        generation: value.generation,
        clientSeq: value.clientSeq,
        payload: value.payload,
      };

    default:
      return null;
  }
}

export function parseHostToGameMultiplayerMessage(
  value: unknown,
): HostToGameMultiplayerMessage | null {
  if (!isWithinPayloadLimit(value, MULTIPLAYER_HOST_MAX_PAYLOAD_BYTES)) return null;
  if (!isPlainObject(value) || typeof value.type !== "string" || !isProtocolEnvelope(value)) {
    return null;
  }

  switch (value.type) {
    case "MULTI_INIT":
      if (
        !hasExactKeys(value, [
          "type",
          "v",
          "participantId",
          "gameVersionId",
          "profileRevision",
          "rulesetKey",
          "rulesetRevision",
          "generation",
        ]) ||
        !isOpaqueId(value.participantId) ||
        !isPositiveInteger(value.gameVersionId) ||
        !isPositiveInteger(value.profileRevision) ||
        typeof value.rulesetKey !== "string" ||
        !RULESET_KEY_PATTERN.test(value.rulesetKey) ||
        !isPositiveInteger(value.rulesetRevision) ||
        !isPositiveInteger(value.generation)
      ) {
        return null;
      }
      return {
        type: "MULTI_INIT",
        v: 1,
        participantId: value.participantId,
        gameVersionId: value.gameVersionId,
        profileRevision: value.profileRevision,
        rulesetKey: value.rulesetKey,
        rulesetRevision: value.rulesetRevision,
        generation: value.generation,
      };

    case "MULTI_CONNECTED":
      if (
        !hasExactKeys(value, ["type", "v", "generation", "connectionGeneration"]) ||
        !isPositiveInteger(value.generation) ||
        !isPositiveInteger(value.connectionGeneration)
      ) {
        return null;
      }
      return {
        type: "MULTI_CONNECTED",
        v: 1,
        generation: value.generation,
        connectionGeneration: value.connectionGeneration,
      };

    case "MULTI_PLAYER_JOINED":
    case "MULTI_PLAYER_LEFT":
      if (
        !hasExactKeys(value, ["type", "v", "generation", "serverSeq", "participantId"]) ||
        !commonServerEnvelope(value) ||
        !isOpaqueId(value.participantId)
      ) {
        return null;
      }
      return {
        type: value.type,
        v: 1,
        generation: value.generation,
        serverSeq: value.serverSeq,
        participantId: value.participantId,
      };

    case "MULTI_SYNC":
    case "MULTI_STATE":
      if (
        !hasExactKeys(value, ["type", "v", "generation", "serverSeq", "revision", "payload"]) ||
        !commonServerEnvelope(value) ||
        !isNonNegativeInteger(value.revision) ||
        !isJsonSafeValue(value.payload)
      ) {
        return null;
      }
      return {
        type: value.type,
        v: 1,
        generation: value.generation,
        serverSeq: value.serverSeq,
        revision: value.revision,
        payload: value.payload,
      };

    case "MULTI_EVENT":
      if (
        !hasExactKeys(value, ["type", "v", "generation", "serverSeq", "name", "payload"]) ||
        !commonServerEnvelope(value) ||
        typeof value.name !== "string" ||
        !EVENT_NAME_PATTERN.test(value.name) ||
        ("payload" in value && value.payload !== undefined && !isJsonSafeValue(value.payload))
      ) {
        return null;
      }
      return {
        type: "MULTI_EVENT",
        v: 1,
        generation: value.generation,
        serverSeq: value.serverSeq,
        name: value.name,
        ...(value.payload !== undefined ? { payload: value.payload } : {}),
      };

    case "MULTI_TERMINAL_PENDING":
      if (
        !hasExactKeys(value, ["type", "v", "generation", "serverSeq"]) ||
        !commonServerEnvelope(value)
      ) {
        return null;
      }
      return {
        type: "MULTI_TERMINAL_PENDING",
        v: 1,
        generation: value.generation,
        serverSeq: value.serverSeq,
      };

    case "MULTI_TERMINAL_COMMITTED":
      if (
        !hasExactKeys(value, ["type", "v", "generation", "serverSeq", "result"]) ||
        !commonServerEnvelope(value) ||
        !isJsonSafeValue(value.result)
      ) {
        return null;
      }
      return {
        type: "MULTI_TERMINAL_COMMITTED",
        v: 1,
        generation: value.generation,
        serverSeq: value.serverSeq,
        result: value.result,
      };

    case "MULTI_ACTION_REJECTED":
      if (
        !hasExactKeys(value, [
          "type",
          "v",
          "generation",
          "serverSeq",
          "clientActionId",
          "code",
          "currentRevision",
        ]) ||
        !commonClientEnvelope(value) ||
        !isNonNegativeInteger(value.serverSeq) ||
        typeof value.clientActionId !== "string" ||
        !ACTION_ID_PATTERN.test(value.clientActionId) ||
        !isAllowedString(value.code, MULTIPLAYER_ACTION_REJECTION_CODES) ||
        !isNonNegativeInteger(value.currentRevision)
      ) {
        return null;
      }
      return {
        type: "MULTI_ACTION_REJECTED",
        v: 1,
        generation: value.generation,
        serverSeq: value.serverSeq,
        clientActionId: value.clientActionId,
        code: value.code,
        currentRevision: value.currentRevision,
      };

    case "MULTI_DISCONNECTED":
      if (
        !hasExactKeys(value, ["type", "v", "generation", "code"]) ||
        !isPositiveInteger(value.generation) ||
        !isAllowedString(value.code, MULTIPLAYER_DISCONNECT_CODES)
      ) {
        return null;
      }
      return {
        type: "MULTI_DISCONNECTED",
        v: 1,
        generation: value.generation,
        code: value.code,
      };

    case "MULTI_ABORTED":
      if (
        !hasExactKeys(value, ["type", "v", "generation", "code"]) ||
        !isPositiveInteger(value.generation) ||
        !isAllowedString(value.code, MULTIPLAYER_ABORT_CODES)
      ) {
        return null;
      }
      return {
        type: "MULTI_ABORTED",
        v: 1,
        generation: value.generation,
        code: value.code,
      };

    default:
      return null;
  }
}
