/**
 * Short-lived, single-use admission ticket for a multiplayer WebSocket connection.
 *
 * The browser parent receives this token from an authenticated API call and carries it only in a
 * `Sec-WebSocket-Protocol` value. It must never be placed in a URL, iframe message, referrer, or
 * log. The outer Worker verifies the HMAC and request context before looking up a Durable Object;
 * the Durable Object then consumes `jti` transactionally so a copied/replayed handshake fails.
 */

export const MULTIPLAYER_TICKET_ISSUER = "owogg-api" as const;
export const MULTIPLAYER_TICKET_AUDIENCE = "owogg-multiplayer-instance" as const;
export const MULTIPLAYER_WEBSOCKET_PROTOCOL = "owogg.multiplayer.v1" as const;
export const MULTIPLAYER_TICKET_PROTOCOL_PREFIX = "owogg.ticket." as const;

export const MULTIPLAYER_JOIN_TICKET_POLICY = {
  EXPIRY_SECONDS: 30,
  MAX_EXPIRY_SECONDS: 60,
  MAX_CLOCK_SKEW_SECONDS: 5,
  MAX_TOKEN_BYTES: 2 * 1024,
  MAX_PROTOCOL_HEADER_BYTES: 4 * 1024,
  MIN_SECRET_BYTES: 32,
} as const;

const TOKEN_VERSION = "mpt1";
const textEncoder = new TextEncoder();
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const JTI_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const BASE64_URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export type MultiplayerTicketParticipantRole = "HOST" | "PLAYER";

interface MultiplayerJoinTicketCommonClaims {
  readonly iss: typeof MULTIPLAYER_TICKET_ISSUER;
  readonly aud: typeof MULTIPLAYER_TICKET_AUDIENCE;
  readonly kid: string;
  /** Unix seconds. */
  readonly iat: number;
  /** Unix seconds. */
  readonly exp: number;
  readonly jti: string;
  readonly instanceId: string;
  readonly participantId: string;
  readonly userId: number;
  readonly gameVersionId: number;
  readonly profileId: number;
  readonly profileRevision: number;
  readonly generation: number;
  readonly connectionGeneration: number;
  readonly seatIndex: number;
  readonly role: MultiplayerTicketParticipantRole;
}

/** Exact server-owned Relay limits copied from the approved runtime profile into a short ticket. */
export interface MultiplayerRelayTicketRuntimeV1 {
  readonly kind: "relay";
  readonly protocolVersion: 1;
  readonly reconnect: "none" | "resume";
  readonly directMessages: boolean;
  readonly hostSnapshot: boolean;
  readonly maxMessageBytes: number;
  readonly maxSnapshotBytes: number;
  readonly messagesPerSecond: number;
  readonly roomBytesPerSecond: number;
  readonly roomTtlSeconds: number;
  readonly hostDeparturePolicy: "close";
  readonly resultTrust: "UNVERIFIED";
}

export interface MultiplayerRelayJoinTicketClaims extends MultiplayerJoinTicketCommonClaims {
  /** Exact immutable ZIP/version identity authorized by profile, room, and admission. */
  readonly contentHash: string;
  readonly runtime: MultiplayerRelayTicketRuntimeV1;
}

export type MultiplayerJoinTicketClaims = MultiplayerRelayJoinTicketClaims;

export interface MultiplayerTicketSigningKey {
  readonly kid: string;
  readonly secret: string;
}

export interface MultiplayerTicketKeyring {
  readonly active: MultiplayerTicketSigningKey;
  /** Includes the active key and, during rotation, any still-valid previous key. */
  readonly verificationKeys: ReadonlyMap<string, string>;
}

export type MultiplayerJoinTicketVerifyError =
  "MALFORMED" | "BAD_SIGNATURE" | "UNKNOWN_KEY" | "EXPIRED" | "NOT_YET_VALID" | "CONTEXT_MISMATCH";

export type MultiplayerJoinTicketVerifyResult =
  | { readonly ok: true; readonly claims: MultiplayerJoinTicketClaims }
  | { readonly ok: false; readonly error: MultiplayerJoinTicketVerifyError };

export interface MultiplayerJoinTicketExpectedContext {
  readonly instanceId?: string;
  readonly participantId?: string;
  readonly userId?: number;
  readonly profileId?: number;
  readonly contentHash?: string;
  readonly generation?: number;
  readonly connectionGeneration?: number;
  readonly seatIndex?: number;
}

const COMMON_CLAIM_KEYS = [
  "iss",
  "aud",
  "kid",
  "iat",
  "exp",
  "jti",
  "instanceId",
  "participantId",
  "userId",
  "gameVersionId",
  "profileId",
  "profileRevision",
  "generation",
  "connectionGeneration",
  "seatIndex",
  "role",
] as const;

const RELAY_RUNTIME_KEYS = [
  "kind",
  "protocolVersion",
  "reconnect",
  "directMessages",
  "hostSnapshot",
  "maxMessageBytes",
  "maxSnapshotBytes",
  "messagesPerSecond",
  "roomBytesPerSecond",
  "roomTtlSeconds",
  "hostDeparturePolicy",
  "resultTrust",
] as const;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(source: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(source);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isOpaqueId(value: unknown): value is string {
  return typeof value === "string" && OPAQUE_ID_PATTERN.test(value);
}

export function parseMultiplayerRelayTicketRuntimeV1(
  value: unknown,
): MultiplayerRelayTicketRuntimeV1 | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, RELAY_RUNTIME_KEYS)) return null;
  if (
    value.kind !== "relay" ||
    value.protocolVersion !== 1 ||
    (value.reconnect !== "none" && value.reconnect !== "resume") ||
    typeof value.directMessages !== "boolean" ||
    typeof value.hostSnapshot !== "boolean" ||
    !isPositiveSafeInteger(value.maxMessageBytes) ||
    value.maxMessageBytes > 4 * 1024 ||
    !isNonNegativeSafeInteger(value.maxSnapshotBytes) ||
    value.maxSnapshotBytes > 16 * 1024 ||
    (!value.hostSnapshot && value.maxSnapshotBytes !== 0) ||
    (value.hostSnapshot && value.maxSnapshotBytes === 0) ||
    !isPositiveSafeInteger(value.messagesPerSecond) ||
    value.messagesPerSecond > 20 ||
    !isPositiveSafeInteger(value.roomBytesPerSecond) ||
    value.roomBytesPerSecond > 256 * 1024 ||
    !isPositiveSafeInteger(value.roomTtlSeconds) ||
    value.roomTtlSeconds > 2 * 60 * 60 ||
    value.hostDeparturePolicy !== "close" ||
    value.resultTrust !== "UNVERIFIED"
  ) {
    return null;
  }
  return {
    kind: "relay",
    protocolVersion: 1,
    reconnect: value.reconnect,
    directMessages: value.directMessages,
    hostSnapshot: value.hostSnapshot,
    maxMessageBytes: value.maxMessageBytes,
    maxSnapshotBytes: value.maxSnapshotBytes,
    messagesPerSecond: value.messagesPerSecond,
    roomBytesPerSecond: value.roomBytesPerSecond,
    roomTtlSeconds: value.roomTtlSeconds,
    hostDeparturePolicy: "close",
    resultTrust: "UNVERIFIED",
  };
}

/** Strict parser used for both locally-created and untrusted decoded claims. */
export function parseMultiplayerJoinTicketClaims(
  value: unknown,
): MultiplayerJoinTicketClaims | null {
  if (!isPlainRecord(value)) return null;
  if (!hasExactKeys(value, [...COMMON_CLAIM_KEYS, "contentHash", "runtime"])) return null;

  if (value.iss !== MULTIPLAYER_TICKET_ISSUER) return null;
  if (value.aud !== MULTIPLAYER_TICKET_AUDIENCE) return null;
  if (typeof value.kid !== "string" || !KEY_ID_PATTERN.test(value.kid)) return null;
  if (!isNonNegativeSafeInteger(value.iat) || !isPositiveSafeInteger(value.exp)) return null;
  if (value.exp <= value.iat) return null;
  if (value.exp - value.iat > MULTIPLAYER_JOIN_TICKET_POLICY.MAX_EXPIRY_SECONDS) return null;
  if (typeof value.jti !== "string" || !JTI_PATTERN.test(value.jti)) return null;
  if (!isOpaqueId(value.instanceId) || !isOpaqueId(value.participantId)) return null;
  if (!isPositiveSafeInteger(value.userId)) return null;
  if (!isPositiveSafeInteger(value.gameVersionId)) return null;
  if (!isPositiveSafeInteger(value.profileId)) return null;
  if (!isPositiveSafeInteger(value.profileRevision)) return null;
  if (!isPositiveSafeInteger(value.generation)) return null;
  if (!isPositiveSafeInteger(value.connectionGeneration)) return null;
  if (!isNonNegativeSafeInteger(value.seatIndex) || value.seatIndex > 7) return null;
  if (value.role !== "HOST" && value.role !== "PLAYER") return null;

  // Return a freshly-shaped object so signing has a deterministic field order and no unknown
  // prototype/properties can survive the trust boundary.
  const common: MultiplayerJoinTicketCommonClaims = {
    iss: MULTIPLAYER_TICKET_ISSUER,
    aud: MULTIPLAYER_TICKET_AUDIENCE,
    kid: value.kid,
    iat: value.iat,
    exp: value.exp,
    jti: value.jti,
    instanceId: value.instanceId,
    participantId: value.participantId,
    userId: value.userId,
    gameVersionId: value.gameVersionId,
    profileId: value.profileId,
    profileRevision: value.profileRevision,
    generation: value.generation,
    connectionGeneration: value.connectionGeneration,
    seatIndex: value.seatIndex,
    role: value.role,
  };
  const runtime = parseMultiplayerRelayTicketRuntimeV1(value.runtime);
  return runtime &&
    typeof value.contentHash === "string" &&
    /^[a-f0-9]{64}$/.test(value.contentHash)
    ? { ...common, contentHash: value.contentHash, runtime }
    : null;
}

function validateSigningKey(key: MultiplayerTicketSigningKey): void {
  if (!KEY_ID_PATTERN.test(key.kid)) {
    throw new RangeError("multiplayer ticket key id must be 1-32 URL-safe characters");
  }
  if (key.secret !== key.secret.trim()) {
    throw new RangeError("multiplayer ticket secret must not have surrounding whitespace");
  }
  if (textEncoder.encode(key.secret).byteLength < MULTIPLAYER_JOIN_TICKET_POLICY.MIN_SECRET_BYTES) {
    throw new RangeError(
      `multiplayer ticket secret must be at least ${MULTIPLAYER_JOIN_TICKET_POLICY.MIN_SECRET_BYTES} bytes`,
    );
  }
}

/** Build a validated keyring. The active key is always accepted for verification as well. */
export function createMultiplayerTicketKeyring(
  active: MultiplayerTicketSigningKey,
  previous: readonly MultiplayerTicketSigningKey[] = [],
): MultiplayerTicketKeyring {
  validateSigningKey(active);
  const keys = new Map<string, string>([[active.kid, active.secret]]);
  for (const key of previous) {
    validateSigningKey(key);
    if (keys.has(key.kid)) throw new RangeError("multiplayer ticket key ids must be unique");
    keys.set(key.kid, key.secret);
  }
  return { active: { ...active }, verificationKeys: keys };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index++) {
    binary += String.fromCharCode(bytes[index] ?? 0);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array | null {
  if (!value || !BASE64_URL_PATTERN.test(value)) return null;
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    // Reject non-canonical encodings instead of letting multiple strings represent the same
    // signed bytes.
    return bytesToBase64Url(bytes) === value ? bytes : null;
  } catch {
    return null;
  }
}

async function importHmacKey(secret: string, usages: readonly KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages as KeyUsage[],
  );
}

export async function signMultiplayerJoinTicket(
  claims: MultiplayerJoinTicketClaims,
  keyring: MultiplayerTicketKeyring,
): Promise<string> {
  const parsed = parseMultiplayerJoinTicketClaims(claims);
  if (!parsed) throw new RangeError("invalid multiplayer join ticket claims");
  if (parsed.kid !== keyring.active.kid) {
    throw new RangeError("multiplayer join ticket kid must match the active signing key");
  }

  const encodedClaims = bytesToBase64Url(textEncoder.encode(JSON.stringify(parsed)));
  const signingInput = `${TOKEN_VERSION}.${parsed.kid}.${encodedClaims}`;
  const key = await importHmacKey(keyring.active.secret, ["sign"]);
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, textEncoder.encode(signingInput)),
  );
  const token = `${signingInput}.${bytesToBase64Url(signature)}`;
  if (textEncoder.encode(token).byteLength > MULTIPLAYER_JOIN_TICKET_POLICY.MAX_TOKEN_BYTES) {
    throw new RangeError("multiplayer join ticket exceeds the transport limit");
  }
  return token;
}

function contextMatches(
  claims: MultiplayerJoinTicketClaims,
  expected: MultiplayerJoinTicketExpectedContext,
): boolean {
  return (
    (expected.instanceId === undefined || claims.instanceId === expected.instanceId) &&
    (expected.participantId === undefined || claims.participantId === expected.participantId) &&
    (expected.userId === undefined || claims.userId === expected.userId) &&
    (expected.profileId === undefined || claims.profileId === expected.profileId) &&
    (expected.contentHash === undefined || claims.contentHash === expected.contentHash) &&
    (expected.generation === undefined || claims.generation === expected.generation) &&
    (expected.connectionGeneration === undefined ||
      claims.connectionGeneration === expected.connectionGeneration) &&
    (expected.seatIndex === undefined || claims.seatIndex === expected.seatIndex)
  );
}

/** Verify signature, time bounds, exact claims, and the caller's route/admission context. */
export async function verifyMultiplayerJoinTicket(
  token: string,
  keyring: MultiplayerTicketKeyring,
  expected: MultiplayerJoinTicketExpectedContext = {},
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<MultiplayerJoinTicketVerifyResult> {
  if (
    typeof token !== "string" ||
    !token ||
    textEncoder.encode(token).byteLength > MULTIPLAYER_JOIN_TICKET_POLICY.MAX_TOKEN_BYTES
  ) {
    return { ok: false, error: "MALFORMED" };
  }
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== TOKEN_VERSION) {
    return { ok: false, error: "MALFORMED" };
  }
  const [, kid = "", encodedClaims = "", encodedSignature = ""] = parts;
  if (!KEY_ID_PATTERN.test(kid)) return { ok: false, error: "MALFORMED" };

  const secret = keyring.verificationKeys.get(kid);
  if (!secret) return { ok: false, error: "UNKNOWN_KEY" };
  const claimsBytes = base64UrlToBytes(encodedClaims);
  const signatureBytes = base64UrlToBytes(encodedSignature);
  if (!claimsBytes || !signatureBytes || signatureBytes.byteLength !== 32) {
    return { ok: false, error: "MALFORMED" };
  }

  try {
    const key = await importHmacKey(secret, ["verify"]);
    const signingInput = `${TOKEN_VERSION}.${kid}.${encodedClaims}`;
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes.slice().buffer as ArrayBuffer,
      textEncoder.encode(signingInput),
    );
    if (!valid) return { ok: false, error: "BAD_SIGNATURE" };
  } catch {
    return { ok: false, error: "BAD_SIGNATURE" };
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(claimsBytes));
  } catch {
    return { ok: false, error: "MALFORMED" };
  }
  const claims = parseMultiplayerJoinTicketClaims(decoded);
  if (!claims || claims.kid !== kid) return { ok: false, error: "MALFORMED" };
  if (claims.iat > nowSeconds + MULTIPLAYER_JOIN_TICKET_POLICY.MAX_CLOCK_SKEW_SECONDS) {
    return { ok: false, error: "NOT_YET_VALID" };
  }
  if (claims.exp <= nowSeconds) return { ok: false, error: "EXPIRED" };
  if (!contextMatches(claims, expected)) return { ok: false, error: "CONTEXT_MISMATCH" };
  return { ok: true, claims };
}

export type MultiplayerWebSocketProtocolParseResult =
  { readonly ok: true; readonly ticket: string } | { readonly ok: false };

/**
 * Accept exactly the application protocol plus one ticket carrier. Unknown/duplicate protocols
 * are rejected so a proxy or caller cannot create ambiguous parsing between the Worker and DO.
 */
export function parseMultiplayerWebSocketProtocols(
  header: string | null | undefined,
): MultiplayerWebSocketProtocolParseResult {
  if (
    !header ||
    textEncoder.encode(header).byteLength > MULTIPLAYER_JOIN_TICKET_POLICY.MAX_PROTOCOL_HEADER_BYTES
  ) {
    return { ok: false };
  }
  const values = header.split(",").map((value) => value.trim());
  if (values.length !== 2 || values.some((value) => !value)) return { ok: false };
  if (new Set(values).size !== values.length) return { ok: false };
  if (!values.includes(MULTIPLAYER_WEBSOCKET_PROTOCOL)) return { ok: false };

  const ticketCarrier = values.find((value) =>
    value.startsWith(MULTIPLAYER_TICKET_PROTOCOL_PREFIX),
  );
  if (!ticketCarrier) return { ok: false };
  const ticket = ticketCarrier.slice(MULTIPLAYER_TICKET_PROTOCOL_PREFIX.length);
  if (
    !ticket ||
    values.some((value) => value !== MULTIPLAYER_WEBSOCKET_PROTOCOL && value !== ticketCarrier)
  ) {
    return { ok: false };
  }
  if (textEncoder.encode(ticket).byteLength > MULTIPLAYER_JOIN_TICKET_POLICY.MAX_TOKEN_BYTES) {
    return { ok: false };
  }
  return { ok: true, ticket };
}

export function buildMultiplayerWebSocketProtocols(ticket: string): readonly [string, string] {
  if (
    !ticket ||
    textEncoder.encode(ticket).byteLength > MULTIPLAYER_JOIN_TICKET_POLICY.MAX_TOKEN_BYTES
  ) {
    throw new RangeError("invalid multiplayer join ticket transport value");
  }
  return [MULTIPLAYER_WEBSOCKET_PROTOCOL, `${MULTIPLAYER_TICKET_PROTOCOL_PREFIX}${ticket}`];
}
