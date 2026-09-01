/**
 * How a game WANTS to be presented — viewport sizing preferences, fullscreen support, and mobile
 * support — declared by the game itself (via {@link GameManifest.presentation}) and reused
 * verbatim by the platform's own catalog type (`GameDefinition.presentation`, packages/core/src/
 * modules/game/domain/gameDefinition.ts), the same way `DifficultyConfig`/`ScoreConfig` already
 * are. Framework-independent, matching every other file under contracts/ — see this directory's
 * own index.ts doc comment: this describes a game as *data*, not how any particular host applies
 * it.
 *
 * Every field here is a PREFERENCE, not an instruction a host must obey. The actual viewport a
 * player ends up seeing is always `Game preference ∩ Platform constraints ∩ Actual device
 * viewport`, decided by the host — a game's `minWidth`, for instance, is a claim about what the
 * game itself needs to be playable, not a size the host is obligated to reserve regardless of what
 * the platform's own layout or the player's actual screen allows. GameHost computes that
 * intersection through `presentationLayoutResolver` and contains both dimensions within its own
 * viewport-height budget.
 *
 * Entirely optional: a game with no `presentation` field keeps the platform's legacy frame. Game
 * Creator manifests can project an aspect ratio into preferred dimensions, while GameHost applies
 * the same generic host policy to official and user-published games.
 */
export interface GamePresentation {
  readonly viewport: GamePresentationViewport;
  readonly fullscreen: GamePresentationFullscreen;
  readonly mobile: GamePresentationMobile;
  /** Host layout selected on first load. This is a preference and never removes the player toggle. */
  readonly defaultMode?: "default" | "theater" | undefined;
}

/**
 * "responsive" — the game adapts to whatever space a host ultimately gives it (the common case).
 * `preferredWidth`/`preferredHeight` are a hint toward the host's own sizing decision;
 * `min*`/`max*` describe the game's own playability bounds — inputs to the
 * `Game preference ∩ Platform constraints ∩ Actual device viewport` decision a host makes, not
 * bounds the host is obligated to satisfy exactly (a platform constraint or a small real device
 * screen can still win).
 *
 * "fixed" — the game was authored at one LOGICAL/DESIGN resolution (e.g. a pixel-art game built
 * for exactly 640x360, or a Unity/Godot canvas with a fixed design size) and expects to be scaled
 * as a whole to fit rather than reflowed. `preferredWidth`/`preferredHeight` in this mode ARE that
 * design resolution — not merely a hint, which is why the type requires both whenever
 * `mode === "fixed"` (see {@link GamePresentationFixedViewport}): a host that dropped them would
 * have no way to know the aspect ratio it's supposed to scale/letterbox, unlike "responsive" mode
 * where they were always optional to begin with.
 */
export type GamePresentationViewport =
  GamePresentationResponsiveViewport | GamePresentationFixedViewport;

export interface GamePresentationResponsiveViewport {
  readonly mode: "responsive";
  readonly preferredWidth?: number | undefined;
  readonly preferredHeight?: number | undefined;
  readonly minWidth?: number | undefined;
  readonly minHeight?: number | undefined;
  readonly maxWidth?: number | undefined;
  readonly maxHeight?: number | undefined;
}

export interface GamePresentationFixedViewport {
  readonly mode: "fixed";
  /** The game's own design resolution — required in this mode; see
   * {@link GamePresentationViewport}'s own doc comment for why. */
  readonly preferredWidth: number;
  readonly preferredHeight: number;
  readonly minWidth?: number | undefined;
  readonly minHeight?: number | undefined;
  readonly maxWidth?: number | undefined;
  readonly maxHeight?: number | undefined;
}

export interface GamePresentationFullscreen {
  readonly supported: boolean;
  /** A hint that fullscreen meaningfully improves the experience (e.g. an action/shooter game) —
   * never something a host is obligated to enforce, which is why there is deliberately no
   * `required` field here: a player (or a host's own layout constraints) always keeps the final
   * say over whether a game actually goes fullscreen. */
  readonly recommended?: boolean | undefined;
}

export interface GamePresentationMobile {
  readonly support: "supported" | "experimental" | "unsupported";
  /** Independent of `InputMethod` (./manifest.js) — a game can list "touch" as an input method
   * and still be `support: "unsupported"` on mobile in practice (e.g. a desktop game whose click
   * handlers happen to also fire for touch taps, but whose layout/performance was never designed
   * for a phone screen), or the reverse. Neither field implies the other. */
  readonly orientation?: "any" | "portrait" | "landscape" | undefined;
}
