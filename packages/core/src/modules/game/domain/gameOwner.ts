/**
 * Who a game belongs to — the one axis on which an official OwOGG game and a Game Creator upload
 * genuinely differ. Pure domain, same style as domain/sandboxGames.ts's constant + predicate pairs.
 *
 * Everything else about the two is meant to converge: both are registered, versioned, published to
 * immutable object storage, served from the isolated game origin, and played through the same host.
 * "Sandbox" is a security implementation detail (an iframe on a separate origin), not a second kind
 * of game — so it is deliberately absent from this union.
 *
 * This also replaces a real piece of accidental typing. `apps/web` currently tells an uploaded game
 * apart from a built-in one by checking `GameManifest.version === "sandbox"` — a field the SDK
 * itself documents as a free-form, no-contract debug marker (see
 * packages/game-sdk/src/contracts/manifest.ts). Owner is what that check was reaching for, so
 * GameDefinition carries this instead of a `version` string.
 */

export const GAME_OWNER_TYPES = ["SYSTEM", "CREATOR"] as const;
export type GameOwnerType = (typeof GAME_OWNER_TYPES)[number];

/** An official game maintained in this repository — no submitting user, no review workflow. */
export interface SystemGameOwner {
  readonly type: "SYSTEM";
}

/** A game uploaded through the Game Creator program. `userId` is the submitting Game Creator's OwOGG
 * user id (`sandbox_games.developer_user_id` today). */
export interface CreatorGameOwner {
  readonly type: "CREATOR";
  readonly userId: number;
}

export type GameOwner = SystemGameOwner | CreatorGameOwner;

export function isValidGameOwnerType(value: unknown): value is GameOwnerType {
  return typeof value === "string" && (GAME_OWNER_TYPES as readonly string[]).includes(value);
}

export function isCreatorOwned(owner: GameOwner): owner is CreatorGameOwner {
  return owner.type === "CREATOR";
}
