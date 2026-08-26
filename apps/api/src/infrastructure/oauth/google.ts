export interface GoogleUserProfile {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string;
  picture: string | null;
  /** Token issued-at (epoch seconds). Used by admin step-up to reject a stale/cached token even
   * though it remains cryptographically valid until `exp`. */
  iat: number;
}

export interface GoogleTokenVerifyResult {
  valid: boolean;
  profile?: GoogleUserProfile;
  reason?: string;
}

const GOOGLE_JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token";
const VALID_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

export interface GoogleAuthorizationCodeExchangeParams {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GoogleAuthorizationCodeExchangeResult {
  valid: boolean;
  idToken?: string;
  reason?: string;
}

/**
 * Exchanges one short-lived browser authorization code for a Google-signed ID token. Access and
 * refresh tokens from the response are deliberately neither returned nor stored: OwOGG uses this
 * grant only to establish identity, never to call Google APIs on a user's behalf.
 */
export async function exchangeGoogleAuthorizationCode({
  code,
  clientId,
  clientSecret,
  redirectUri,
}: GoogleAuthorizationCodeExchangeParams): Promise<GoogleAuthorizationCodeExchangeResult> {
  let response: Response;
  try {
    response = await fetch(GOOGLE_TOKEN_URI, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
  } catch {
    return { valid: false, reason: "Google token endpoint is unavailable" };
  }

  if (!response.ok) {
    return { valid: false, reason: "Google authorization code exchange failed" };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { valid: false, reason: "Google token response was malformed" };
  }

  const idToken =
    typeof body === "object" && body !== null && "id_token" in body
      ? (body as { id_token?: unknown }).id_token
      : undefined;
  if (typeof idToken !== "string" || !idToken) {
    return { valid: false, reason: "Google token response did not contain an ID token" };
  }

  return { valid: true, idToken };
}

interface GoogleJwk {
  kty: string;
  kid?: string;
  alg?: string;
  use?: string;
  n: string;
  e: string;
}

interface JwksCache {
  keys: GoogleJwk[];
  expiresAt: number;
}

let jwksCache: JwksCache | null = null;
const JWKS_TTL_MS = 60 * 60 * 1000;

function base64UrlDecodeToUint8Array(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

interface DecodedJwt {
  header: { kid?: string; alg?: string };
  payload: Record<string, unknown>;
  signingInput: ArrayBuffer;
  signature: ArrayBuffer;
}

function decodeJwt(token: string): DecodedJwt | null {
  const parts = token.split(".");
  if (parts.length < 3) return null;
  const headerB64 = parts[0];
  const payloadB64 = parts[1];
  const signatureB64 = parts[2];
  if (headerB64 === undefined || payloadB64 === undefined || signatureB64 === undefined) {
    return null;
  }

  let header: { kid?: string; alg?: string };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlDecodeToUint8Array(headerB64))) as {
      kid?: string;
      alg?: string;
    };
    payload = JSON.parse(
      new TextDecoder().decode(base64UrlDecodeToUint8Array(payloadB64)),
    ) as Record<string, unknown>;
  } catch {
    return null;
  }

  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64UrlDecodeToUint8Array(signatureB64);

  return {
    header,
    payload,
    signingInput: toArrayBuffer(signingInput),
    signature: toArrayBuffer(signature),
  };
}

async function fetchGoogleJwks(): Promise<GoogleJwk[]> {
  const now = Date.now();
  if (jwksCache && jwksCache.expiresAt > now) {
    return jwksCache.keys;
  }

  const res = await fetch(GOOGLE_JWKS_URI);
  if (!res.ok) {
    throw new Error("Failed to fetch Google JWKS");
  }

  const data = (await res.json()) as { keys?: GoogleJwk[] };
  const keys = data.keys ?? [];
  jwksCache = { keys, expiresAt: now + JWKS_TTL_MS };
  return keys;
}

export function clearGoogleJwksCache(): void {
  jwksCache = null;
}

async function verifySignature(
  jwk: GoogleJwk,
  signingInput: ArrayBuffer,
  signature: ArrayBuffer,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { ...jwk, ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signingInput);
  } catch {
    return false;
  }
}

export async function verifyGoogleToken(
  credential: string,
  expectedClientId?: string,
): Promise<GoogleTokenVerifyResult> {
  if (!expectedClientId) {
    return { valid: false, reason: "Audience cannot be verified without a configured client ID" };
  }

  const decoded = decodeJwt(credential);
  if (!decoded) {
    return { valid: false, reason: "Malformed Google ID token" };
  }

  const { header, payload, signingInput, signature } = decoded;

  if (header.alg !== "RS256") {
    return { valid: false, reason: "Unsupported token algorithm" };
  }

  // Issuer
  const iss = typeof payload.iss === "string" ? payload.iss : null;
  if (!iss || !VALID_ISSUERS.has(iss)) {
    return { valid: false, reason: "Invalid issuer" };
  }

  // Audience
  const aud = payload.aud;
  const audMatch =
    typeof aud === "string"
      ? aud === expectedClientId
      : Array.isArray(aud) && aud.includes(expectedClientId);
  if (!audMatch) {
    return { valid: false, reason: "Audience mismatch" };
  }

  // Expiration
  const exp = typeof payload.exp === "number" ? payload.exp : null;
  if (exp === null) {
    return { valid: false, reason: "Missing expiration" };
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (exp <= nowSeconds) {
    return { valid: false, reason: "Token expired" };
  }

  // Subject (canonical Google identity)
  const sub = typeof payload.sub === "string" ? payload.sub : null;
  if (!sub) {
    return { valid: false, reason: "Missing subject (sub)" };
  }

  // Signature via Google JWKS
  let keys: GoogleJwk[];
  try {
    keys = await fetchGoogleJwks();
  } catch (err) {
    return {
      valid: false,
      reason: err instanceof Error ? err.message : "Failed to fetch Google JWKS",
    };
  }

  const kid = header.kid;
  const candidate = kid ? keys.find((k) => k.kid === kid) : keys[0];
  if (!candidate) {
    return { valid: false, reason: "No matching Google signing key" };
  }

  const signatureValid = await verifySignature(candidate, signingInput, signature);
  if (!signatureValid) {
    return { valid: false, reason: "Invalid signature" };
  }

  const emailVerified = payload.email_verified === true || payload.email_verified === "true";

  return {
    valid: true,
    profile: {
      sub,
      email: typeof payload.email === "string" ? payload.email : null,
      emailVerified,
      name: typeof payload.name === "string" ? payload.name : "Google User",
      picture: typeof payload.picture === "string" ? payload.picture : null,
      iat: typeof payload.iat === "number" ? payload.iat : 0,
    },
  };
}
