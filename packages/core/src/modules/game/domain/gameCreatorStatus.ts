/**
 * Projects a Game Creator game's `GameDefinition["status"]` from D1 runtime/lifecycle state — never
 * from B2 canonical (the canonical document has no concept of review/publish state at all, by
 * design: review/publish status, visibility, and liveVersionId are excluded from it).
 *
 * `GameStatus` (@owogg/game-sdk/contracts) is `"draft" | "beta" | "published" | "hidden"` — SYSTEM
 * games are the only ones that ever use `"beta"` (a build-time editorial choice, declared in
 * an old Git metadata file); nothing about a Game Creator game's D1 lifecycle maps to it,
 * so {@link GameCreatorRuntimeStatus} deliberately excludes it at the type level rather than just
 * by convention.
 *
 * Rules (D1 runtime axes only — see sandbox_games' own migration comment for what each column
 * means):
 *   - `liveVersionId === null` → `"draft"` — no approved version has ever gone live yet.
 *   - `liveVersionId !== null && visibility === "PRIVATE"` → `"hidden"` — an approved version
 *     exists, but an admin/developer has it turned off.
 *   - `liveVersionId !== null && visibility === "PUBLIC"` → `"published"`.
 */

import type { SandboxGameRecord } from "../../../ports/sandboxGames.js";

export const GAME_CREATOR_RUNTIME_STATUSES = ["draft", "hidden", "published"] as const;
export type GameCreatorRuntimeStatus = (typeof GAME_CREATOR_RUNTIME_STATUSES)[number];

/** The subset of `SandboxGameRecord` this projection actually reads. */
export type GameCreatorStatusSource = Pick<
  SandboxGameRecord,
  "liveVersionId" | "visibility" | "deletedAt"
>;

/**
 * `row.deletedAt !== null` is a fail-closed assertion, not a case this returns a status for — a
 * soft-deleted Game Creator game must never reach status projection at all. Control-plane callers must
 * filter deleted rows before projecting anything; reaching this throw means that invariant broke
 * and must fail loudly rather than silently produce a status for a game that no longer exists.
 */
export function projectGameCreatorStatus(row: GameCreatorStatusSource): GameCreatorRuntimeStatus {
  if (row.deletedAt !== null) {
    throw new Error(
      "projectGameCreatorStatus called with a soft-deleted row — deleted Game Creator games must " +
        "never reach status projection (control-plane reads must exclude deleted_at rows)",
    );
  }

  if (row.liveVersionId === null) {
    return "draft";
  }

  switch (row.visibility) {
    case "PRIVATE":
      return "hidden";
    case "PUBLIC":
      return "published";
    default: {
      // Exhaustiveness guard — SandboxGameVisibility is "PRIVATE" | "PUBLIC" today
      // (domain/sandboxGames.ts). A future third value must fail loudly here, not silently fall
      // through to "published".
      const unreachable: never = row.visibility;
      throw new Error(
        `projectGameCreatorStatus: unknown sandbox game visibility "${String(unreachable)}"`,
      );
    }
  }
}
