import type { GamePresentation } from "./presentation.js";

export type GameMode = "single" | "local-multi" | "online-multi";

export type GameStatus = "draft" | "beta" | "published" | "hidden";

/** What a player physically uses to play — informational metadata (device recommendations,
 * data collection, future filtering), not an enforcement mechanism. List every method the game
 * actually responds to; a game driven entirely by onClick handlers responds to both "mouse" and
 * "touch" (React's onClick fires for touch taps too), so most games list both. */
export type InputMethod = "mouse" | "keyboard" | "touch" | "gamepad";

export interface DifficultyLevel {
  /** Stable identifier — used as the URL query param / score submission field / leaderboard
   * partition key. Never rename once a game ships with it; scores keyed by the old id would
   * become orphaned. */
  readonly id: string;
  readonly label: string;
}

/** Declares that a game has multiple, separately-scored difficulty tiers. Absent entirely
 * (`GameManifest.difficulty === undefined`) means "single difficulty, no selector shown" — the
 * common case today for all 4 shipped games. See docs/GAME_CREATION_GUIDE.md for the difficulty
 * rollout plan. */
export interface DifficultyConfig {
  readonly levels: readonly DifficultyLevel[];
  readonly defaultLevelId: string;
}

export interface ScoreConfig {
  readonly unit: string;
  readonly direction: "asc" | "desc";
  readonly min: number;
  readonly max: number;
  readonly precision?: number;
  readonly outOfRange?: "clamp" | "reject";
  /** Prefix prepended before the score number in display (e.g. "Level ") */
  readonly displayPrefix?: string;
  /** Suffix appended after the score number in display (e.g. " ms") */
  readonly displaySuffix?: string;
}

/**
 * Format a score value according to the ScoreConfig display rules.
 * Falls back to plain string when no prefix/suffix is defined.
 */
export function formatScore(score: number, config: ScoreConfig | undefined): string {
  if (!config) return String(score);
  const prefix = config.displayPrefix ?? "";
  const suffix = config.displaySuffix ?? "";
  return `${prefix}${score}${suffix}`;
}

export interface GameManifest {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly shortDescription: string;
  readonly description: string;
  readonly modes: readonly GameMode[];
  readonly status: GameStatus;
  readonly categories: readonly string[];
  readonly tags: readonly string[];
  readonly minPlayers: number;
  readonly maxPlayers: number;
  readonly thumbnail: string;
  readonly accent?: string | undefined;
  readonly estimatedRoundSeconds?: number | undefined;
  readonly requiresAuth: boolean;
  readonly supportsLeaderboard: boolean;
  /** What the player actually uses to play — see {@link InputMethod}. */
  readonly inputMethods: readonly InputMethod[];
  /** Multiple separately-scored difficulty tiers (normal/hard/...). Undefined = single
   * difficulty, no selector — see {@link DifficultyConfig}. */
  readonly difficulty?: DifficultyConfig | undefined;
  /** Whether this game supports recording/replaying a play session. Every current game is
   * `false` — none has been refactored to a seeded-RNG, replay-capable engine yet. See
   * docs/GAME_CREATION_GUIDE.md for the replay feasibility findings. */
  readonly supportsReplay: boolean;
  /** Informal per-game-package version, bumped at the game author's discretion — not tied to
   * any semver contract or release process; purely a "this build changed" marker for debugging. */
  readonly version: string;
  readonly scoreConfig?: ScoreConfig | undefined;
  /** Viewport/fullscreen/mobile presentation preferences — see {@link GamePresentation}'s own doc
   * comment. Undefined for every game shipped today; nothing reads this field yet (a host-side PR
   * that actually computes a viewport from it comes later). */
  readonly presentation?: GamePresentation | undefined;
}
