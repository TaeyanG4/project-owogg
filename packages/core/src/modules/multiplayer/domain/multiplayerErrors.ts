/**
 * Stable application/domain error codes for the multiplayer control plane.
 *
 * These codes are safe to place in API response bodies. Diagnostic detail belongs in structured
 * server logs and must never be copied into the public message field.
 */
export const MULTIPLAYER_ERROR_CODES = [
  "INVALID_REQUEST",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "MULTIPLAYER_UNAVAILABLE",
  "PROFILE_DISABLED",
  "VERSION_MISMATCH",
  "IDEMPOTENCY_CONFLICT",
  "INSTANCE_NOT_FOUND",
  "INSTANCE_NOT_JOINABLE",
  "INSTANCE_FULL",
  "INVITE_INVALID",
  "INVITE_EXHAUSTED",
  "ALREADY_JOINED",
  "MATCH_NOT_ACTIVE",
  "NOT_PARTICIPANT",
  "NOT_YOUR_TURN",
  "ACTION_INVALID",
  "ACTION_CONFLICT",
  "ACTION_ID_REUSED",
  "STALE_GENERATION",
  "TICKET_INVALID",
  "TICKET_EXPIRED",
  "TICKET_REPLAYED",
  "RATE_LIMITED",
  "INTERNAL_RETRYABLE",
] as const;

export type MultiplayerErrorCode = (typeof MULTIPLAYER_ERROR_CODES)[number];

export const MULTIPLAYER_ERROR_HTTP_STATUS = {
  INVALID_REQUEST: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  MULTIPLAYER_UNAVAILABLE: 503,
  PROFILE_DISABLED: 409,
  VERSION_MISMATCH: 409,
  IDEMPOTENCY_CONFLICT: 409,
  INSTANCE_NOT_FOUND: 404,
  INSTANCE_NOT_JOINABLE: 409,
  INSTANCE_FULL: 409,
  INVITE_INVALID: 404,
  INVITE_EXHAUSTED: 410,
  ALREADY_JOINED: 409,
  MATCH_NOT_ACTIVE: 409,
  NOT_PARTICIPANT: 403,
  NOT_YOUR_TURN: 409,
  ACTION_INVALID: 422,
  ACTION_CONFLICT: 409,
  ACTION_ID_REUSED: 409,
  STALE_GENERATION: 409,
  TICKET_INVALID: 401,
  TICKET_EXPIRED: 401,
  TICKET_REPLAYED: 401,
  RATE_LIMITED: 429,
  INTERNAL_RETRYABLE: 503,
} as const satisfies Readonly<Record<MultiplayerErrorCode, number>>;

const RETRYABLE_MULTIPLAYER_ERRORS = new Set<MultiplayerErrorCode>([
  "ACTION_CONFLICT",
  "STALE_GENERATION",
  "RATE_LIMITED",
  "INTERNAL_RETRYABLE",
]);

export interface MultiplayerFailure {
  readonly ok: false;
  readonly error: {
    readonly code: MultiplayerErrorCode;
    readonly retryable: boolean;
  };
}

export function isMultiplayerErrorCode(value: unknown): value is MultiplayerErrorCode {
  return (
    typeof value === "string" && (MULTIPLAYER_ERROR_CODES as readonly string[]).includes(value)
  );
}

export function multiplayerFailure(code: MultiplayerErrorCode): MultiplayerFailure {
  return {
    ok: false,
    error: {
      code,
      retryable: RETRYABLE_MULTIPLAYER_ERRORS.has(code),
    },
  };
}
