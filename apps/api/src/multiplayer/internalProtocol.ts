import { parseMultiplayerJoinTicketClaims, type MultiplayerJoinTicketClaims } from "@owogg/core";

/** Never contains the raw signed ticket. Only an outer-Worker-verified canonical claim set. */
export const MULTIPLAYER_INTERNAL_CLAIMS_HEADER = "X-Owogg-Multiplayer-Claims";
/** Separates the trusted Worker→DO hop from the browser's subprotocol negotiation. */
export const MULTIPLAYER_INTERNAL_PROTOCOL_HEADER = "X-Owogg-Multiplayer-Protocol";
export const MULTIPLAYER_INTERNAL_CONNECT_PATH = "/internal/multiplayer/connect";

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
