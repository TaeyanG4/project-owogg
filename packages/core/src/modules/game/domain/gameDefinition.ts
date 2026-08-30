/**
 * What a game *is*, independent of how it is stored or who uploaded it.
 *
 * Legacy source-shape contract retained for compatibility with external core consumers. Runtime
 * catalog resolution no longer consumes this type: every publisher resolves through D1 identity/
 * version plus the B2 GameCanonicalDocument.
 *
 * Deliberately a discriminated union on `owner.type`, not one flat shape with optional fields on
 * both sides — the same reasoning `./publicGame.ts`'s `PublicGame` union already documents for the
 * public-facing shape this mirrors. A SYSTEM game has a fixed category/tag taxonomy, a fixed set of
 * input methods and a bundled thumbnail asset; a CREATOR game has a free-text genre, a coarser
 * single/multi mode, and a logo served from its own byte endpoint. Forcing both into one
 * optional-everything shape would mean either inventing categories/tags/thumbnail a Game Creator game
 * doesn't have or silently dropping genre/mode from a
 * SYSTEM one. `{@link GameDefinitionCommon}` holds only what both owners genuinely share.
 *
 * Built on `@owogg/game-sdk/contracts`' existing vocabulary (GameMode, InputMethod,
 * DifficultyConfig, ScoreConfig, GamePresentation) rather than redeclaring parallel copies of it. A
 * SYSTEM definition must be expressible from today's GameManifest without loss.
 */

import type {
  DifficultyConfig,
  GameMode,
  GamePresentation,
  GameStatus,
  InputMethod,
  ScoreConfig,
} from "@owogg/game-sdk/contracts";
import type { CreatorGameOwner, SystemGameOwner } from "./gameOwner.js";
import type { SandboxGameMode } from "../../../domain/sandboxGames.js";

/**
 * The half a game's author does NOT get to decide.
 *
 * A Game Creator's `owogg.json` is a validated public runtime contract — registration metadata and
 * title and genre"), not policy. Scoring bounds, leaderboard participation, XP and auth
 * requirements are operator decisions, because each of them is directly farmable: XP in particular
 * is capped per game (progression.ts's XP_DAILY_CAP_COMPLETIONS_PER_GAME), so a self-declared
 * value would let anyone multiply their own cap by publishing more games. Keeping the two apart in
 * the type system is what stops a future route from accidentally trusting one as the other.
 */
export interface GamePolicy {
  /**
   * Scoring rules, or `null` for a game that isn't scored at all. Reuses the SDK's ScoreConfig so
   * that direction/min/max/unit/display formatting have exactly one definition across the
   * codebase — `formatScore` already reads this shape, and score validation will read it from
   * from canonical metadata at runtime.
   */
  readonly score: ScoreConfig | null;
  /** Whether accepted submissions appear on a public leaderboard. */
  readonly leaderboard: boolean;
  /** Server-authoritative XP per accepted completion. Starts at 0 for Game Creator games and is raised
   * only by an operator — see docs/GAME_CREATION_GUIDE.md §3.5. */
  readonly xpPerCompletion: number;
  /** Whether a player must be signed in to play at all (distinct from needing an account to
   * *submit* a score, which authentication already governs). */
  readonly requiresAuth: boolean;
}

/** Multiple separately-scored difficulty tiers, or `undefined` for the single-tier default. */
export type GameDifficulty = DifficultyConfig;

/**
 * Fields every game has, regardless of owner. Nothing here presumes a fixed taxonomy, a player
 * count, or a thumbnail asset — those are SYSTEM-specific (see {@link SystemGameDefinition}).
 */
export interface GameDefinitionCommon {
  /**
   * Global identity, and the only one. Scores, leaderboards, favorites and recent-plays are all
   * keyed by it, so it must never change once a game ships — see docs/GAME_CREATION_GUIDE.md and
   * the migration plan's "slug is identity" rule.
   *
   * Uniqueness is global across SYSTEM and CREATOR games, which is what today's schema cannot
   * express: `sandbox_games.slug` is UNIQUE only among sandbox rows, so nothing currently stops an
   * uploaded game from claiming a platform-owned slug. The registry is where that gets enforced.
   */
  readonly slug: string;

  readonly title: string;
  readonly shortDescription: string;
  readonly description: string;

  readonly status: GameStatus;

  readonly difficulty?: GameDifficulty | undefined;
  /** Whether the game can record/replay a session. Every game is `false` today. */
  readonly supportsReplay: boolean;

  readonly policy: GamePolicy;

  /** Reuses `@owogg/game-sdk/contracts`' GamePresentation verbatim — see that type's own doc
   * comment. `undefined` for a game that hasn't declared one; a definition without one behaves
   * exactly as it always has. */
  readonly presentation?: GamePresentation | undefined;
}

/** An official-game source shape retained as a public core type. Fixed category/tag taxonomy, a
 * bundled thumbnail asset path, and the richer `GameMode`/`InputMethod` vocabulary — none of which
 * a CREATOR game has any equivalent for (see this file's own top doc comment). */
export interface SystemGameDefinition extends GameDefinitionCommon {
  readonly owner: SystemGameOwner;

  readonly categories: readonly string[];
  readonly tags: readonly string[];

  readonly modes: readonly GameMode[];
  readonly inputMethods: readonly InputMethod[];
  readonly minPlayers: number;
  readonly maxPlayers: number;

  readonly thumbnail: string;
  readonly accent?: string | undefined;
  readonly estimatedRoundSeconds?: number | undefined;
}

/** A game uploaded through the Game Creator program — D1 identity/runtime combined with generic
 * canonical metadata/policy. */
export interface CreatorGameDefinition extends GameDefinitionCommon {
  readonly owner: CreatorGameOwner;

  /** Free-text, not one of SYSTEM's fixed `categories` — see this file's own top doc comment on
   * why this migration does not invent a mapping between the two. */
  readonly genre: string;
  /** `"single" | "multi"` — sandbox_games' own coarser player-count vocabulary (see
   * domain/sandboxGames.ts's SandboxGameMode), never translated into SYSTEM's richer
   * `"local-multi" | "online-multi"` distinction, which a Game Creator submission has no way to
   * declare (OwOGG runs no server-side game-state relay — see
   * docs/GAME_CREATION_GUIDE.md §3.2.2). */
  readonly mode: SandboxGameMode;
  /** Whether this game has an uploaded logo — mirrors `SandboxGameRecord.logoKey !== null`
   * (`toPublicCreatorGame` derives the same `hasLogo` boolean from the same column for the same
   * reason: the client fetches the logo from its own byte endpoint, never a raw storage key). */
  readonly hasLogo: boolean;
}

export type GameDefinition = SystemGameDefinition | CreatorGameDefinition;

/** Narrows a {@link GameDefinition} to its SYSTEM variant — the owner-narrowing pattern this
 * file's own top doc comment points to `./publicGame.ts`'s `PublicGame` union for. */
export function isSystemGameDefinition(
  definition: GameDefinition,
): definition is SystemGameDefinition {
  return definition.owner.type === "SYSTEM";
}

/** Narrows a {@link GameDefinition} to its CREATOR variant — see {@link isSystemGameDefinition}. */
export function isCreatorGameDefinition(
  definition: GameDefinition,
): definition is CreatorGameDefinition {
  return definition.owner.type === "CREATOR";
}

/** Whether a submitted score is even meaningful for this game. */
export function isScored(definition: GameDefinition): boolean {
  return definition.policy.score !== null;
}
