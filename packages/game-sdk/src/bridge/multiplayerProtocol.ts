import { isJsonSafeValue } from "./protocol.js";

/** Relay-only MessagePort protocol shared by the sandboxed game and OWOGG parent. */
export const MULTIPLAYER_BRIDGE_PROTOCOL_VERSION = 1 as const;
export const MULTIPLAYER_CLIENT_MAX_PAYLOAD_BYTES = 4 * 1024;
export const MULTIPLAYER_RELAY_MAX_SNAPSHOT_BYTES = 16 * 1024;
export const MULTIPLAYER_RELAY_MAX_CLIENT_ENVELOPE_BYTES = 20 * 1024;
export const MULTIPLAYER_HOST_MAX_PAYLOAD_BYTES = 20 * 1024;

export const MULTIPLAYER_DISCONNECT_CODES = [
  "NETWORK_LOST",
  "SERVER_UNAVAILABLE",
  "REPLACED_BY_NEW_CONNECTION",
  "AUTH_EXPIRED",
  "SLOW_CONSUMER",
  "LEFT",
] as const;
export const MULTIPLAYER_RELAY_REJECTION_CODES = [
  "MATCH_NOT_ACTIVE",
  "DIRECT_MESSAGES_DISABLED",
  "TARGET_UNAVAILABLE",
  "SNAPSHOT_DISABLED",
  "HOST_REQUIRED",
] as const;
export const MULTIPLAYER_RELAY_CLOSE_CODES = [
  "HOST_LEFT",
  "PARTICIPANT_LEFT",
  "ROOM_EXPIRED",
  "ADMIN_KILLED",
  "SERVER_UNAVAILABLE",
] as const;

export type MultiplayerDisconnectCode = (typeof MULTIPLAYER_DISCONNECT_CODES)[number];
export type MultiplayerRelayRejectionCode = (typeof MULTIPLAYER_RELAY_REJECTION_CODES)[number];
export type MultiplayerRelayCloseCode = (typeof MULTIPLAYER_RELAY_CLOSE_CODES)[number];

type ProtocolVersion = typeof MULTIPLAYER_BRIDGE_PROTOCOL_VERSION;

export interface MultiplayerBootstrapRuntime {
  readonly kind: "relay";
  readonly protocolVersion: ProtocolVersion;
  readonly resultTrust: "UNVERIFIED";
}

export interface MultiplayerBootstrapParticipant {
  readonly participantId: string;
  readonly seatIndex: number;
  readonly role: "HOST" | "PLAYER";
}

export interface MultiplayerBootstrapCapabilities {
  readonly reconnect: "none" | "resume";
  readonly broadcast: true;
  readonly directMessages: boolean;
  readonly hostSnapshot: boolean;
}

export interface MultiReadyMessage {
  readonly type: "MULTI_READY";
  readonly v: ProtocolVersion;
  readonly generation: number;
}

export interface MultiLeaveMessage {
  readonly type: "MULTI_LEAVE";
  readonly v: ProtocolVersion;
  readonly generation: number;
}

export type RelaySendMessage =
  | {
      readonly type: "RELAY_SEND";
      readonly v: ProtocolVersion;
      readonly generation: number;
      readonly clientSeq: number;
      readonly delivery: "broadcast";
      readonly payload: unknown;
    }
  | {
      readonly type: "RELAY_SEND";
      readonly v: ProtocolVersion;
      readonly generation: number;
      readonly clientSeq: number;
      readonly delivery: "direct";
      readonly targetParticipantId: string;
      readonly payload: unknown;
    };

export interface RelaySnapshotSetMessage {
  readonly type: "RELAY_SNAPSHOT_SET";
  readonly v: ProtocolVersion;
  readonly generation: number;
  readonly clientSeq: number;
  readonly payload: unknown;
}

export type GameToHostRelayMessage =
  MultiReadyMessage | MultiLeaveMessage | RelaySendMessage | RelaySnapshotSetMessage;

export interface MultiInitMessage {
  readonly type: "MULTI_INIT";
  readonly v: ProtocolVersion;
  readonly gameVersionId: number;
  readonly contentHash: string;
  readonly profileRevision: number;
  readonly generation: number;
  readonly runtime: MultiplayerBootstrapRuntime;
  readonly self: MultiplayerBootstrapParticipant;
  readonly roster: readonly MultiplayerBootstrapParticipant[];
  readonly capabilities: MultiplayerBootstrapCapabilities;
}

export interface MultiConnectedMessage {
  readonly type: "MULTI_CONNECTED";
  readonly v: ProtocolVersion;
  readonly generation: number;
  readonly connectionGeneration: number;
}

/** Parent-synthesized transport loss notice. It is never accepted from a game client. */
export interface MultiDisconnectedMessage {
  readonly type: "MULTI_DISCONNECTED";
  readonly v: ProtocolVersion;
  readonly generation: number;
  readonly code: MultiplayerDisconnectCode;
}

export interface RelaySender {
  readonly participantId: string;
  readonly seatIndex: number;
  readonly role: "HOST" | "PLAYER";
}

export type RelayMessage =
  | {
      readonly type: "RELAY_MESSAGE";
      readonly v: ProtocolVersion;
      readonly generation: number;
      readonly serverSeq: number;
      readonly sender: RelaySender;
      readonly delivery: "broadcast";
      readonly payload: unknown;
    }
  | {
      readonly type: "RELAY_MESSAGE";
      readonly v: ProtocolVersion;
      readonly generation: number;
      readonly serverSeq: number;
      readonly sender: RelaySender;
      readonly delivery: "direct";
      readonly targetParticipantId: string;
      readonly payload: unknown;
    };

export interface RelaySnapshot {
  readonly revision: number;
  readonly hash: string;
  readonly payload: unknown;
}

export interface RelaySyncMessage {
  readonly type: "RELAY_SYNC";
  readonly v: ProtocolVersion;
  readonly generation: number;
  readonly serverSeq: number;
  readonly snapshot: RelaySnapshot | null;
}

export interface RelayRejectedMessage {
  readonly type: "RELAY_REJECTED";
  readonly v: ProtocolVersion;
  readonly generation: number;
  readonly clientSeq: number;
  readonly code: MultiplayerRelayRejectionCode;
}

export interface RelayClosedMessage {
  readonly type: "RELAY_CLOSED";
  readonly v: ProtocolVersion;
  readonly generation: number;
  readonly code: MultiplayerRelayCloseCode;
}

export type HostToGameMultiplayerMessage =
  | MultiInitMessage
  | MultiConnectedMessage
  | MultiDisconnectedMessage
  | RelayMessage
  | RelaySyncMessage
  | RelayRejectedMessage
  | RelayClosedMessage;

const textEncoder = new TextEncoder();
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(data: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(data);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

type ProtocolEnvelope = Record<string, unknown> & { readonly v: ProtocolVersion };
type ClientEnvelope = ProtocolEnvelope & { readonly generation: number };
type ServerEnvelope = ClientEnvelope & { readonly serverSeq: number };

function isProtocolEnvelope(data: Record<string, unknown>): data is ProtocolEnvelope {
  return data.v === MULTIPLAYER_BRIDGE_PROTOCOL_VERSION;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
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
  return commonClientEnvelope(data) && isNonNegativeInteger(data.serverSeq);
}

export function parseGameToHostRelayMessage(value: unknown): GameToHostRelayMessage | null {
  if (!isWithinPayloadLimit(value, MULTIPLAYER_RELAY_MAX_CLIENT_ENVELOPE_BYTES)) return null;
  if (!isPlainObject(value) || typeof value.type !== "string" || !commonClientEnvelope(value)) {
    return null;
  }
  if (value.type === "MULTI_READY" || value.type === "MULTI_LEAVE") {
    return hasExactKeys(value, ["type", "v", "generation"])
      ? { type: value.type, v: 1, generation: value.generation }
      : null;
  }
  if (value.type === "RELAY_SEND") {
    if (
      !isPositiveInteger(value.clientSeq) ||
      (value.delivery !== "broadcast" && value.delivery !== "direct") ||
      !isJsonSafeValue(value.payload) ||
      !isWithinPayloadLimit(value.payload, MULTIPLAYER_CLIENT_MAX_PAYLOAD_BYTES)
    ) {
      return null;
    }
    if (value.delivery === "broadcast") {
      return hasExactKeys(value, ["type", "v", "generation", "clientSeq", "delivery", "payload"])
        ? {
            type: "RELAY_SEND",
            v: 1,
            generation: value.generation,
            clientSeq: value.clientSeq,
            delivery: "broadcast",
            payload: value.payload,
          }
        : null;
    }
    if (
      !hasExactKeys(value, [
        "type",
        "v",
        "generation",
        "clientSeq",
        "delivery",
        "targetParticipantId",
        "payload",
      ]) ||
      !isOpaqueId(value.targetParticipantId)
    ) {
      return null;
    }
    return {
      type: "RELAY_SEND",
      v: 1,
      generation: value.generation,
      clientSeq: value.clientSeq,
      delivery: "direct",
      targetParticipantId: value.targetParticipantId,
      payload: value.payload,
    };
  }
  if (
    value.type === "RELAY_SNAPSHOT_SET" &&
    hasExactKeys(value, ["type", "v", "generation", "clientSeq", "payload"]) &&
    isPositiveInteger(value.clientSeq) &&
    isJsonSafeValue(value.payload) &&
    isWithinPayloadLimit(value.payload, MULTIPLAYER_RELAY_MAX_SNAPSHOT_BYTES)
  ) {
    return {
      type: "RELAY_SNAPSHOT_SET",
      v: 1,
      generation: value.generation,
      clientSeq: value.clientSeq,
      payload: value.payload,
    };
  }
  return null;
}

function parseRelaySender(value: unknown): RelaySender | null {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, ["participantId", "seatIndex", "role"]) ||
    !isOpaqueId(value.participantId) ||
    !isNonNegativeInteger(value.seatIndex) ||
    value.seatIndex > 7 ||
    (value.role !== "HOST" && value.role !== "PLAYER")
  ) {
    return null;
  }
  return { participantId: value.participantId, seatIndex: value.seatIndex, role: value.role };
}

function parseRelaySnapshot(value: unknown): RelaySnapshot | null {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, ["revision", "hash", "payload"]) ||
    !isPositiveInteger(value.revision) ||
    typeof value.hash !== "string" ||
    !SHA256_PATTERN.test(value.hash) ||
    !isJsonSafeValue(value.payload) ||
    !isWithinPayloadLimit(value.payload, MULTIPLAYER_RELAY_MAX_SNAPSHOT_BYTES)
  ) {
    return null;
  }
  return { revision: value.revision, hash: value.hash, payload: value.payload };
}

function parseBootstrapParticipant(value: unknown): MultiplayerBootstrapParticipant | null {
  return parseRelaySender(value);
}

function sameBootstrapParticipant(
  left: MultiplayerBootstrapParticipant,
  right: MultiplayerBootstrapParticipant,
): boolean {
  return (
    left.participantId === right.participantId &&
    left.seatIndex === right.seatIndex &&
    left.role === right.role
  );
}

function parseBootstrapRuntime(value: unknown): MultiplayerBootstrapRuntime | null {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, ["kind", "protocolVersion", "resultTrust"]) ||
    value.kind !== "relay" ||
    value.protocolVersion !== MULTIPLAYER_BRIDGE_PROTOCOL_VERSION ||
    value.resultTrust !== "UNVERIFIED"
  ) {
    return null;
  }
  return { kind: "relay", protocolVersion: 1, resultTrust: "UNVERIFIED" };
}

function parseBootstrapCapabilities(value: unknown): MultiplayerBootstrapCapabilities | null {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, ["reconnect", "broadcast", "directMessages", "hostSnapshot"]) ||
    (value.reconnect !== "none" && value.reconnect !== "resume") ||
    value.broadcast !== true ||
    typeof value.directMessages !== "boolean" ||
    typeof value.hostSnapshot !== "boolean"
  ) {
    return null;
  }
  return {
    reconnect: value.reconnect,
    broadcast: true,
    directMessages: value.directMessages,
    hostSnapshot: value.hostSnapshot,
  };
}

export function parseHostToGameMultiplayerMessage(
  value: unknown,
): HostToGameMultiplayerMessage | null {
  if (!isWithinPayloadLimit(value, MULTIPLAYER_HOST_MAX_PAYLOAD_BYTES)) return null;
  if (!isPlainObject(value) || typeof value.type !== "string" || !isProtocolEnvelope(value)) {
    return null;
  }

  if (value.type === "MULTI_INIT") {
    if (
      !hasExactKeys(value, [
        "type",
        "v",
        "gameVersionId",
        "contentHash",
        "profileRevision",
        "generation",
        "runtime",
        "self",
        "roster",
        "capabilities",
      ]) ||
      !isPositiveInteger(value.gameVersionId) ||
      typeof value.contentHash !== "string" ||
      !SHA256_PATTERN.test(value.contentHash) ||
      !isPositiveInteger(value.profileRevision) ||
      !isPositiveInteger(value.generation) ||
      !Array.isArray(value.roster) ||
      value.roster.length < 2 ||
      value.roster.length > 8
    ) {
      return null;
    }
    const runtime = parseBootstrapRuntime(value.runtime);
    const self = parseBootstrapParticipant(value.self);
    const capabilities = parseBootstrapCapabilities(value.capabilities);
    const roster = value.roster.map(parseBootstrapParticipant);
    if (!runtime || !self || !capabilities || roster.some((participant) => participant === null)) {
      return null;
    }
    const parsedRoster = roster as MultiplayerBootstrapParticipant[];
    if (
      new Set(parsedRoster.map((participant) => participant.participantId)).size !==
        parsedRoster.length ||
      new Set(parsedRoster.map((participant) => participant.seatIndex)).size !==
        parsedRoster.length ||
      parsedRoster.filter((participant) => participant.role === "HOST").length !== 1 ||
      parsedRoster.some((participant, index) => {
        const previous = parsedRoster[index - 1];
        return previous !== undefined && participant.seatIndex <= previous.seatIndex;
      }) ||
      !parsedRoster.some((participant) => sameBootstrapParticipant(participant, self))
    ) {
      return null;
    }
    return {
      type: "MULTI_INIT",
      v: 1,
      gameVersionId: value.gameVersionId,
      contentHash: value.contentHash,
      profileRevision: value.profileRevision,
      generation: value.generation,
      runtime,
      self,
      roster: parsedRoster,
      capabilities,
    };
  }

  if (value.type === "MULTI_CONNECTED") {
    return hasExactKeys(value, ["type", "v", "generation", "connectionGeneration"]) &&
      isPositiveInteger(value.generation) &&
      isPositiveInteger(value.connectionGeneration)
      ? {
          type: "MULTI_CONNECTED",
          v: 1,
          generation: value.generation,
          connectionGeneration: value.connectionGeneration,
        }
      : null;
  }

  if (value.type === "MULTI_DISCONNECTED") {
    return hasExactKeys(value, ["type", "v", "generation", "code"]) &&
      isPositiveInteger(value.generation) &&
      isAllowedString(value.code, MULTIPLAYER_DISCONNECT_CODES)
      ? {
          type: "MULTI_DISCONNECTED",
          v: 1,
          generation: value.generation,
          code: value.code,
        }
      : null;
  }

  if (value.type === "RELAY_MESSAGE") {
    if (
      !commonServerEnvelope(value) ||
      (value.delivery !== "broadcast" && value.delivery !== "direct") ||
      !isJsonSafeValue(value.payload) ||
      !isWithinPayloadLimit(value.payload, MULTIPLAYER_CLIENT_MAX_PAYLOAD_BYTES)
    ) {
      return null;
    }
    const sender = parseRelaySender(value.sender);
    if (!sender) return null;
    if (value.delivery === "broadcast") {
      return hasExactKeys(value, [
        "type",
        "v",
        "generation",
        "serverSeq",
        "sender",
        "delivery",
        "payload",
      ])
        ? {
            type: "RELAY_MESSAGE",
            v: 1,
            generation: value.generation,
            serverSeq: value.serverSeq,
            sender,
            delivery: "broadcast",
            payload: value.payload,
          }
        : null;
    }
    if (
      !hasExactKeys(value, [
        "type",
        "v",
        "generation",
        "serverSeq",
        "sender",
        "delivery",
        "targetParticipantId",
        "payload",
      ]) ||
      !isOpaqueId(value.targetParticipantId)
    ) {
      return null;
    }
    return {
      type: "RELAY_MESSAGE",
      v: 1,
      generation: value.generation,
      serverSeq: value.serverSeq,
      sender,
      delivery: "direct",
      targetParticipantId: value.targetParticipantId,
      payload: value.payload,
    };
  }

  if (value.type === "RELAY_SYNC") {
    if (
      !hasExactKeys(value, ["type", "v", "generation", "serverSeq", "snapshot"]) ||
      !commonServerEnvelope(value)
    ) {
      return null;
    }
    const snapshot = value.snapshot === null ? null : parseRelaySnapshot(value.snapshot);
    return value.snapshot === null || snapshot
      ? {
          type: "RELAY_SYNC",
          v: 1,
          generation: value.generation,
          serverSeq: value.serverSeq,
          snapshot,
        }
      : null;
  }

  if (value.type === "RELAY_REJECTED") {
    return hasExactKeys(value, ["type", "v", "generation", "clientSeq", "code"]) &&
      commonClientEnvelope(value) &&
      isPositiveInteger(value.clientSeq) &&
      isAllowedString(value.code, MULTIPLAYER_RELAY_REJECTION_CODES)
      ? {
          type: "RELAY_REJECTED",
          v: 1,
          generation: value.generation,
          clientSeq: value.clientSeq,
          code: value.code,
        }
      : null;
  }

  if (value.type === "RELAY_CLOSED") {
    return hasExactKeys(value, ["type", "v", "generation", "code"]) &&
      isPositiveInteger(value.generation) &&
      isAllowedString(value.code, MULTIPLAYER_RELAY_CLOSE_CODES)
      ? {
          type: "RELAY_CLOSED",
          v: 1,
          generation: value.generation,
          code: value.code,
        }
      : null;
  }

  return null;
}
