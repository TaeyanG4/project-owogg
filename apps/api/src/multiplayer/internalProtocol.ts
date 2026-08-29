import { parseMultiplayerJoinTicketClaims, type MultiplayerJoinTicketClaims } from "@owogg/core";

/** Never contains the raw signed ticket. Only an outer-Worker-verified canonical claim set. */
export const MULTIPLAYER_INTERNAL_CLAIMS_HEADER = "X-Owogg-Multiplayer-Claims";
/** Separates the trusted Worker→DO hop from the browser's subprotocol negotiation. */
export const MULTIPLAYER_INTERNAL_PROTOCOL_HEADER = "X-Owogg-Multiplayer-Protocol";
export const MULTIPLAYER_INTERNAL_CONNECT_PATH = "/internal/multiplayer/connect";
export const MULTIPLAYER_INTERNAL_LEAVE_PATH = "/internal/multiplayer/leave";
export const MULTIPLAYER_INTERNAL_LOBBY_SIGNAL_CONNECT_PATH =
  "/internal/multiplayer/lobby-signal-connect";
export const MULTIPLAYER_INTERNAL_LOBBY_SIGNAL_NOTIFY_PATH =
  "/internal/multiplayer/lobby-signal-changed";
export const MULTIPLAYER_INTERNAL_LOBBY_SIGNAL_CLAIMS_HEADER =
  "X-Owogg-Multiplayer-Lobby-Signal-Claims";

export interface VerifiedMultiplayerLobbySignalClaims {
  readonly instanceId: string;
  readonly participantId: string;
  readonly generation: number;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isOpaqueId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(value);
}

function parseVerifiedMultiplayerLobbySignalClaims(
  value: unknown,
): VerifiedMultiplayerLobbySignalClaims | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const keys = Object.keys(source);
  if (
    keys.length !== 3 ||
    !keys.every((key) => ["instanceId", "participantId", "generation"].includes(key)) ||
    !isOpaqueId(source.instanceId) ||
    !isOpaqueId(source.participantId) ||
    !isPositiveInteger(source.generation)
  ) {
    return null;
  }
  return {
    instanceId: source.instanceId,
    participantId: source.participantId,
    generation: source.generation,
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

/** Encodes only the room membership already authenticated by the outer Worker. */
export function encodeVerifiedMultiplayerLobbySignalClaims(
  claims: VerifiedMultiplayerLobbySignalClaims,
): string {
  const parsed = parseVerifiedMultiplayerLobbySignalClaims(claims);
  if (!parsed) throw new RangeError("invalid verified multiplayer lobby signal claims");
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(parsed)));
}

export function decodeVerifiedMultiplayerLobbySignalClaims(
  encoded: string | null | undefined,
): VerifiedMultiplayerLobbySignalClaims | null {
  if (!encoded) return null;
  const bytes = base64UrlToBytes(encoded);
  if (!bytes) return null;
  try {
    return parseVerifiedMultiplayerLobbySignalClaims(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
  } catch {
    return null;
  }
}
