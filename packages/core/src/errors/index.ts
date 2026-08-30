export class GameNotFoundError extends Error {
  constructor(slug: string) {
    super(`Game not found: ${slug}`);
    this.name = "GameNotFoundError";
  }
}

export class InvalidGameResultError extends Error {
  constructor(reason: string) {
    super(`Invalid game result: ${reason}`);
    this.name = "InvalidGameResultError";
  }
}

export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class RateLimitedError extends Error {
  constructor(message = "Rate limited") {
    super(message);
    this.name = "RateLimitedError";
  }
}

export type OAuthIdentityConflictCode =
  "ACCOUNT_ALREADY_LINKED" | "PROVIDER_ALREADY_LINKED" | "ACCOUNT_PREVIOUSLY_REGISTERED";

/**
 * Persistence-level OAuth ownership conflict. The application use case converts this into its
 * public discriminated result, while login routes can also fail closed when a historical
 * registration no longer has a valid OwOGG user.
 */
export class OAuthIdentityConflictError extends Error {
  constructor(
    readonly code: OAuthIdentityConflictCode,
    readonly conflictUserId?: number,
  ) {
    super(code);
    this.name = "OAuthIdentityConflictError";
  }
}
