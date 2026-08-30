/**
 * Administrator step-up authentication policy (pure domain constants + tiny pure predicates).
 * No D1, Hono, Cloudflare bindings, or Web Crypto here — those live in apps/api/src/auth/.
 *
 * ADMIN_USER_IDS remains the ROOT authorization boundary (unchanged). This policy governs the
 * additional elevated layer required before an eligible user may actually use admin
 * capabilities: fresh Google step-up + admin username/password + a short-lived admin session.
 */

export const ADMIN_AUTH_POLICY = {
  /** Google step-up challenge lifetime once verified — must complete admin login within this. */
  STEP_UP_CHALLENGE_TTL_MS: 5 * 60 * 1000,
  /** Default elevated admin session absolute lifetime. Production keeps this default. */
  ADMIN_SESSION_TTL_MS: 30 * 60 * 1000,
  /** Hard upper bound for an environment-specific elevated admin session lifetime. */
  ADMIN_SESSION_MAX_TTL_MS: 12 * 60 * 60 * 1000,
  /** Failed admin password attempts allowed within the rate-limit window before lockout. */
  LOGIN_RATE_LIMIT_MAX_ATTEMPTS: 5,
  /** Rolling window over which failed attempts are counted. */
  LOGIN_RATE_LIMIT_WINDOW_MS: 15 * 60 * 1000,
  /** PBKDF2-HMAC-SHA256 iteration count for the admin password hash. Capped at 100,000 — this is
   * a Cloudflare Workers `crypto.subtle` platform limit, not an app-chosen value. A higher count
   * (OWASP currently recommends 600,000+ for PBKDF2-SHA256) throws `NotSupportedError: Pbkdf2
   * failed: iteration counts above 100000 are not supported` in the Workers runtime specifically
   * — Node.js has no such cap, so this was never caught by the local test suite (`node --test`),
   * only surfaced by an actual production login attempt. Every password hash/verify in this app
   * runs inside a Worker, so this ceiling applies everywhere admin passwords are handled. */
  PBKDF2_ITERATIONS: 100_000,
  /** A fresh Google ID token must have been issued (iat) within this many seconds of "now" to
   * count as step-up proof — rejects a stale/cached token even though it is still cryptographically valid. */
  GOOGLE_TOKEN_MAX_AGE_SECONDS: 300,
} as const;

/**
 * Resolve an optional environment-provided session lifetime. Invalid, zero, or over-limit
 * values fail closed to the shorter default instead of extending administrator access.
 */
export function resolveAdminSessionTtlMs(configuredSeconds: string | undefined): number {
  const normalized = configuredSeconds?.trim();
  if (!normalized || !/^[1-9]\d*$/.test(normalized)) {
    return ADMIN_AUTH_POLICY.ADMIN_SESSION_TTL_MS;
  }

  const ttlMs = Number(normalized) * 1000;
  if (!Number.isSafeInteger(ttlMs) || ttlMs > ADMIN_AUTH_POLICY.ADMIN_SESSION_MAX_TTL_MS) {
    return ADMIN_AUTH_POLICY.ADMIN_SESSION_TTL_MS;
  }
  return ttlMs;
}

/** Never authorize by email/nickname/OAuth provider identity — only an allowlisted, canonical
 * Google OIDC subject (`sub`) counts as admin step-up proof. */
export function isAdminGoogleSub(sub: string, configuredSubs: string | undefined): boolean {
  if (!configuredSubs || !sub) return false;
  return configuredSubs
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .includes(sub);
}

export interface RateLimitDecision {
  locked: boolean;
  retryAfterSeconds: number;
}

/**
 * Pure lockout decision: given the failed attempts still inside the rolling window (each as an
 * epoch-ms timestamp, oldest first) and the current time, decide whether the account is locked
 * and how long until the oldest counted failure ages out of the rate-limit period
 */
export function evaluateLoginRateLimit(
  failedAttemptTimestampsMs: number[],
  nowMs: number,
): RateLimitDecision {
  if (failedAttemptTimestampsMs.length < ADMIN_AUTH_POLICY.LOGIN_RATE_LIMIT_MAX_ATTEMPTS) {
    return { locked: false, retryAfterSeconds: 0 };
  }
  const oldest = Math.min(...failedAttemptTimestampsMs);
  const unlocksAtMs = oldest + ADMIN_AUTH_POLICY.LOGIN_RATE_LIMIT_WINDOW_MS;
  const retryAfterSeconds = Math.max(0, Math.ceil((unlocksAtMs - nowMs) / 1000));
  return { locked: retryAfterSeconds > 0, retryAfterSeconds };
}
