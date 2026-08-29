/**
 * Verifier-backed Game Session token. The internal `gs2` wire prefix distinguishes evidence-
 * verified attempts from the older client-facts token; it is not a manifest schema version.
 *
 * `gs2` binds one authenticated player and exact live game version to one server-approved
 * generic topology (`single` or `local-multi`) and one canonical PlayConfig pair. Managed
 * `online-multi` attempts never receive this token; their authority remains the room/ticket/DO
 * path.
 */

export type VerifiedGameSessionPlayMode = "single" | "local-multi";

export interface VerifiedGameSessionPayload {
  readonly userId: number;
  readonly gameId: number;
  readonly versionId: number;
  readonly attemptId: string;
  readonly playMode: VerifiedGameSessionPlayMode;
  readonly difficultyId: string;
  readonly variantId: string;
  readonly rewardFactor: number;
  readonly rulesetRevision: number;
  readonly verifierId: string;
  readonly challengeSeed: string;
  readonly issuedAtMs: number;
  /** Unix seconds, matching the existing gs1 expiry convention. */
  readonly exp: number;
}

const TOKEN_VERSION = "gs2";
const PAYLOAD_KEYS = [
  "userId",
  "gameId",
  "versionId",
  "attemptId",
  "playMode",
  "difficultyId",
  "variantId",
  "rewardFactor",
  "rulesetRevision",
  "verifierId",
  "challengeSeed",
  "issuedAtMs",
  "exp",
] as const;
const VERIFIER_ID_PATTERN = /^[a-z0-9][a-z0-9._:/-]{0,95}$/;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index] ?? 0);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array | null {
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

async function importHmacKey(secret: string, usages: readonly KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages as KeyUsage[],
  );
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isBoundedCanonicalId(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= 100 && value === value.trim()
  );
}

function isVerifiedGameSessionPayload(value: unknown): value is VerifiedGameSessionPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  const keys = Object.keys(payload);
  if (
    keys.length !== PAYLOAD_KEYS.length ||
    !keys.every((key) => (PAYLOAD_KEYS as readonly string[]).includes(key))
  ) {
    return false;
  }
  return (
    isPositiveSafeInteger(payload.userId) &&
    isPositiveSafeInteger(payload.gameId) &&
    isPositiveSafeInteger(payload.versionId) &&
    typeof payload.attemptId === "string" &&
    OPAQUE_ID_PATTERN.test(payload.attemptId) &&
    (payload.playMode === "single" || payload.playMode === "local-multi") &&
    isBoundedCanonicalId(payload.difficultyId) &&
    isBoundedCanonicalId(payload.variantId) &&
    typeof payload.rewardFactor === "number" &&
    Number.isFinite(payload.rewardFactor) &&
    payload.rewardFactor > 0 &&
    isPositiveSafeInteger(payload.rulesetRevision) &&
    typeof payload.verifierId === "string" &&
    VERIFIER_ID_PATTERN.test(payload.verifierId) &&
    typeof payload.challengeSeed === "string" &&
    OPAQUE_ID_PATTERN.test(payload.challengeSeed) &&
    isPositiveSafeInteger(payload.issuedAtMs) &&
    isPositiveSafeInteger(payload.exp) &&
    payload.issuedAtMs < payload.exp * 1000
  );
}

/** Signs only a strict, normalized payload. Raw request objects must never be passed here. */
export async function signVerifiedGameSession(
  payload: VerifiedGameSessionPayload,
  secret: string,
): Promise<string> {
  if (!isVerifiedGameSessionPayload(payload)) {
    throw new TypeError("Invalid gs2 payload");
  }
  const encodedPayload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${TOKEN_VERSION}.${encodedPayload}`;
  const key = await importHmacKey(secret, ["sign"]);
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput)),
  );
  return `${signingInput}.${bytesToBase64Url(signature)}`;
}

export type VerifiedGameSessionVerifyError = "MALFORMED" | "BAD_SIGNATURE" | "EXPIRED";
export type VerifiedGameSessionVerifyResult =
  | { readonly ok: true; readonly payload: VerifiedGameSessionPayload }
  | { readonly ok: false; readonly error: VerifiedGameSessionVerifyError };

export async function verifyVerifiedGameSession(
  token: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<VerifiedGameSessionVerifyResult> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return { ok: false, error: "MALFORMED" };
  const [, encodedPayload, encodedSignature] = parts;
  const payloadBytes = base64UrlToBytes(encodedPayload ?? "");
  const signatureBytes = base64UrlToBytes(encodedSignature ?? "");
  if (!payloadBytes || !signatureBytes) return { ok: false, error: "MALFORMED" };

  const key = await importHmacKey(secret, ["verify"]);
  const validSignature = await crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes.slice().buffer as ArrayBuffer,
    new TextEncoder().encode(`${TOKEN_VERSION}.${encodedPayload}`),
  );
  if (!validSignature) return { ok: false, error: "BAD_SIGNATURE" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return { ok: false, error: "MALFORMED" };
  }
  if (!isVerifiedGameSessionPayload(parsed)) return { ok: false, error: "MALFORMED" };
  if (parsed.exp <= nowSeconds) return { ok: false, error: "EXPIRED" };
  return { ok: true, payload: parsed };
}

/** Revalidates signed canonical claims against the current live runtime at result submission. */
export function verifiedGameSessionMatches(
  payload: VerifiedGameSessionPayload,
  expected: Omit<VerifiedGameSessionPayload, "attemptId" | "challengeSeed" | "issuedAtMs" | "exp">,
): boolean {
  return (
    payload.userId === expected.userId &&
    payload.gameId === expected.gameId &&
    payload.versionId === expected.versionId &&
    payload.playMode === expected.playMode &&
    payload.difficultyId === expected.difficultyId &&
    payload.variantId === expected.variantId &&
    payload.rewardFactor === expected.rewardFactor &&
    payload.rulesetRevision === expected.rulesetRevision &&
    payload.verifierId === expected.verifierId
  );
}
