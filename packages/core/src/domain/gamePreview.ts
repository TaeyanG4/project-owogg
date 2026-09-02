/**
 * Short-lived capability used to serve one exact private Game Creator draft from the dedicated
 * game origin. The token is deliberately a different protocol (`gp1`) from score Game Sessions
 * (`gs1`), even though both derive HMAC signatures from the environment's GAME_SESSION_SECRET.
 */

export interface GamePreviewPayload {
  readonly userId: number;
  readonly gameId: number;
  readonly versionId: number;
  readonly nonce: string;
  /** Unix seconds. */
  readonly exp: number;
}

export const GAME_PREVIEW_POLICY = {
  EXPIRY_SECONDS: 10 * 60,
} as const;

const TOKEN_VERSION = "gp1";

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index] ?? 0);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

function isPayload(value: unknown): value is GamePreviewPayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(payload.userId) &&
    Number(payload.userId) > 0 &&
    Number.isSafeInteger(payload.gameId) &&
    Number(payload.gameId) > 0 &&
    Number.isSafeInteger(payload.versionId) &&
    Number(payload.versionId) > 0 &&
    typeof payload.nonce === "string" &&
    payload.nonce.length > 0 &&
    Number.isSafeInteger(payload.exp) &&
    Number(payload.exp) > 0
  );
}

async function importKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

export async function signGamePreview(
  payload: GamePreviewPayload,
  secret: string,
): Promise<string> {
  const encodedPayload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${TOKEN_VERSION}.${encodedPayload}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      await importKey(secret, "sign"),
      new TextEncoder().encode(signingInput),
    ),
  );
  return `${signingInput}.${bytesToBase64Url(signature)}`;
}

export type GamePreviewVerifyResult =
  | { ok: true; payload: GamePreviewPayload }
  | { ok: false; error: "MALFORMED" | "BAD_SIGNATURE" | "EXPIRED" };

export async function verifyGamePreview(
  token: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<GamePreviewVerifyResult> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return { ok: false, error: "MALFORMED" };
  const encodedPayload = parts[1] ?? "";
  const payloadBytes = base64UrlToBytes(encodedPayload);
  const signatureBytes = base64UrlToBytes(parts[2] ?? "");
  if (!payloadBytes || !signatureBytes) return { ok: false, error: "MALFORMED" };

  const valid = await crypto.subtle.verify(
    "HMAC",
    await importKey(secret, "verify"),
    signatureBytes.slice().buffer as ArrayBuffer,
    new TextEncoder().encode(`${TOKEN_VERSION}.${encodedPayload}`),
  );
  if (!valid) return { ok: false, error: "BAD_SIGNATURE" };

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return { ok: false, error: "MALFORMED" };
  }
  if (!isPayload(payload)) return { ok: false, error: "MALFORMED" };
  if (payload.exp <= nowSeconds) return { ok: false, error: "EXPIRED" };
  return { ok: true, payload };
}
