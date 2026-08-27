import { parseMultiplayerJoinTicketClaims, type MultiplayerJoinTicketClaims } from "@owogg/core";

/** Never contains the raw signed ticket. Only an outer-Worker-verified canonical claim set. */
export const MULTIPLAYER_INTERNAL_CLAIMS_HEADER = "X-Owogg-Multiplayer-Claims";
/** Separates the trusted Worker→DO hop from the browser's subprotocol negotiation. */
export const MULTIPLAYER_INTERNAL_PROTOCOL_HEADER = "X-Owogg-Multiplayer-Protocol";
export const MULTIPLAYER_INTERNAL_CONNECT_PATH = "/internal/multiplayer/connect";
export const MULTIPLAYER_INTERNAL_LEAVE_PATH = "/internal/multiplayer/leave";
export const MULTIPLAYER_INTERNAL_READY_PATH = "/internal/multiplayer/ready";
export const MULTIPLAYER_INTERNAL_REMATCH_NOTIFY_PATH = "/internal/multiplayer/rematch-changed";
export const MULTIPLAYER_INTERNAL_LOBBY_CONNECT_PATH = "/internal/multiplayer/lobby-connect";
export const MULTIPLAYER_INTERNAL_LOBBY_NOTIFY_PATH = "/internal/multiplayer/lobby-changed";
export const MULTIPLAYER_INTERNAL_LOBBY_CLAIMS_HEADER = "X-Owogg-Multiplayer-Lobby-Claims";

export interface VerifiedMultiplayerLobbyClaims {
  readonly instanceId: string;
  readonly participantId: string;
  readonly userId: number;
  readonly generation: number;
  /** Exact D1-authoritative instance expiry, expressed as Unix seconds for a one-shot DO alarm. */
  readonly expiresAt: number;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isOpaqueId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(value);
}

function parseVerifiedMultiplayerLobbyClaims(
  value: unknown,
): VerifiedMultiplayerLobbyClaims | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const keys = Object.keys(source);
  if (
    keys.length !== 5 ||
    !keys.every((key) =>
      ["instanceId", "participantId", "userId", "generation", "expiresAt"].includes(key),
    ) ||
    !isOpaqueId(source.instanceId) ||
    !isOpaqueId(source.participantId) ||
    !isPositiveInteger(source.userId) ||
    !isPositiveInteger(source.generation) ||
    !isPositiveInteger(source.expiresAt)
  ) {
    return null;
  }
  return {
    instanceId: source.instanceId,
    participantId: source.participantId,
    userId: source.userId,
    generation: source.generation,
    expiresAt: source.expiresAt,
  };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index++) {
    binary += String.fromCharCode(bytes[index] ?? 0);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 4096) return null;
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytesToBase64Url(bytes) === value ? bytes : null;
  } catch {
    return null;
  }
}

export function encodeVerifiedMultiplayerClaims(claims: MultiplayerJoinTicketClaims): string {
  const parsed = parseMultiplayerJoinTicketClaims(claims);
  if (!parsed) throw new RangeError("invalid verified multiplayer claims");
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(parsed)));
}

export function decodeVerifiedMultiplayerClaims(
  encoded: string | null | undefined,
): MultiplayerJoinTicketClaims | null {
  if (!encoded) return null;
  const bytes = base64UrlToBytes(encoded);
  if (!bytes) return null;
  try {
    return parseMultiplayerJoinTicketClaims(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
  } catch {
    return null;
  }
}

/** Encodes only the identity already authenticated by the outer Worker. No session cookie or
 * gameplay ticket is forwarded into the Durable Object. */
export function encodeVerifiedMultiplayerLobbyClaims(
  claims: VerifiedMultiplayerLobbyClaims,
): string {
  const parsed = parseVerifiedMultiplayerLobbyClaims(claims);
  if (!parsed) throw new RangeError("invalid verified multiplayer lobby claims");
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(parsed)));
}

export function decodeVerifiedMultiplayerLobbyClaims(
  encoded: string | null | undefined,
): VerifiedMultiplayerLobbyClaims | null {
  if (!encoded) return null;
  const bytes = base64UrlToBytes(encoded);
  if (!bytes) return null;
  try {
    return parseVerifiedMultiplayerLobbyClaims(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
  } catch {
    return null;
  }
}
