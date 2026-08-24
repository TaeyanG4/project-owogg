/**
 * Unified Game Platform, Stage U-1 — who published a game, independent of storage/deployment
 * mechanics. This is the foundation for the eventual architecture direction: OwOGG's official
 * games and user-published games converge on the same D1 identity/runtime + B2 canonical/bundle
 * model (see gameCanonicalDocument.ts's own top doc comment) — the ONE remaining real difference
 * between them is who published the game and what review/permission policy applies, which is
 * exactly what this type exists to express. Nothing in this PR wires this into D1 or changes any
 * existing SYSTEM/CREATOR ownerType/contract — see this file's own doc comment on what's
 * deliberately deferred.
 *
 * Deliberately NOT a free-text/display-name concept. `displayName` (whatever a UI shows next to a
 * game — "OwOGG", a Game Creator's nickname, ...) is presentation, never authorization: a user could
 * set their own display name to look like "owogg", so "is this the official publisher" can never
 * be answered by comparing strings. `GamePublisher` is instead:
 *
 *   - `{ type: "OWOGG" }` — server/admin-controlled authority. There is no `id` here to spoof or
 *     compare against, because OWOGG-ness isn't a row a caller looks up; it's a fact only the
 *     platform itself asserts (an official game's D1 identity row is created by an
 *     admin/publisher process, never a public "publish as OWOGG" request path).
 *   - `{ type: "USER"; userId: number }` — the exact same relational identity
 *     `CreatorGameOwner.userId` (gameOwner.ts) already carries today, foreign-keyed to `users`
 *     the same way, subject to the same account moderation/merge concerns.
 *
 * NOT done in this PR: `GameOwner`/`SystemGameOwner`/`CreatorGameOwner` (gameOwner.ts) and every
 * existing SYSTEM/CREATOR-named contract stay exactly as they are — this type is not wired into
 * `GameDefinition`, `PublicGame`, D1, or any route yet. A large, behavior-changing rename across
 * the existing owner/publisher vocabulary is explicitly a later Stage's job, not this foundation
 * PR's.
 */

export const GAME_PUBLISHER_TYPES = ["OWOGG", "USER"] as const;
export type GamePublisherType = (typeof GAME_PUBLISHER_TYPES)[number];

/** OwOGG's own official games — server/admin-controlled authority, not a lookup-able identity.
 * See this file's own top doc comment for why there is deliberately no `id` field here. */
export interface OwoggGamePublisher {
  readonly type: "OWOGG";
}

/** A game published by a specific platform user — `userId` is that user's OwOGG identity, the
 * same relational fact `CreatorGameOwner.userId` already is today. */
export interface UserGamePublisher {
  readonly type: "USER";
  readonly userId: number;
}

export type GamePublisher = OwoggGamePublisher | UserGamePublisher;

export function isValidGamePublisherType(value: unknown): value is GamePublisherType {
  return typeof value === "string" && (GAME_PUBLISHER_TYPES as readonly string[]).includes(value);
}

export function isUserPublished(publisher: GamePublisher): publisher is UserGamePublisher {
  return publisher.type === "USER";
}

/**
 * Validates whether a value satisfies the structural and domain invariants of a `GamePublisher`.
 * Fail-closed:
 * - `{ type: "OWOGG" }`: strictly authority without extra relational fields (e.g. `userId` must not be present).
 * - `{ type: "USER", userId }`: `userId` must be a finite positive integer.
 */
export function isValidGamePublisher(value: unknown): value is GamePublisher {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.type === "OWOGG") {
    return !("userId" in candidate);
  }
  if (candidate.type === "USER") {
    return (
      typeof candidate.userId === "number" &&
      Number.isInteger(candidate.userId) &&
      candidate.userId > 0
    );
  }
  return false;
}
