import type { GamePresentation } from "@owogg/game-sdk";

/**
 * Pure math for turning a game's {@link GamePresentation} preference into the concrete box
 * GameHost renders IframeRuntime/GameFrame into. No React, no DOM — `available` is whatever
 * GameHost has already measured (width from its own `useElementSize` ResizeObserver, height from
 * `useViewportHeight` — deliberately two different, independent sources; see GameHost.tsx's own
 * doc comments on why) so this stays trivially testable with plain numbers, exercised directly in
 * apps/web/app/test/presentationLayoutResolver.test.ts.
 *
 * The one principle every branch below enforces: `Game preference ∩ Platform constraints ∩ Actual
 * available viewport → Host decides` (see GamePresentation's own doc comment,
 * packages/game-sdk/src/contracts/presentation.ts). `available` always wins — nothing this
 * function returns can exceed it, so a game's own min/max preferences can shrink the result but
 * never force the page to overflow.
 */
export interface AvailableViewport {
  readonly width: number;
  readonly height: number;
}

export type PresentationLayout =
  | {
      /** No presentation declared — every game shipped today. GameHost keeps its current,
       * unchanged static layout for this case (see GameHost.tsx's own `frameClassName`) rather
       * than this module computing anything: that layout is CSS-driven (`vh` units) and already
       * correct, and re-deriving it here in JS would just be a second copy that could drift. */
      readonly kind: "legacy";
    }
  | {
      readonly kind: "responsive";
      readonly displayWidth: number;
      readonly displayHeight: number;
    }
  | {
      readonly kind: "fixed";
      /** The game's own design resolution, unscaled — what GameFrame sizes the actual `<iframe>`
       * element to, so the game's document sees this as its viewport regardless of how small the
       * displayed surface below ends up. */
      readonly logicalWidth: number;
      readonly logicalHeight: number;
      /** The on-screen box the (possibly scaled-down) iframe is displayed within. */
      readonly displayWidth: number;
      readonly displayHeight: number;
      /** Applied to the iframe as `transform: scale(...)` with `transformOrigin: "top left"` — the
       * iframe's own layout box stays `logicalWidth × logicalHeight`; only its painted, on-screen
       * size shrinks. Never exceeds 1: a design resolution smaller than the available space is
       * shown at its native size, not stretched up to fill the space. */
      readonly scale: number;
    };

/**
 * `available` is `null | AvailableViewport` rather than always-required: GameHost doesn't always
 * have a real, independent measurement to hand this yet (no ResizeObserver/viewport reading has
 * landed, or landed with a bogus 0/negative value — see GameHost.tsx's own doc comments on why
 * height specifically has to come from `window`/`visualViewport`, not a DOM measurement of
 * anything this layout itself sizes). Folding that fail-safe in here, rather than leaving it as
 * untested conditional logic in GameHost, is what makes it something this module's own test suite
 * actually covers: an invalid measurement is exactly as "no measurement yet" as `available` being
 * `null` outright, and both fall back to `legacy` the same way `presentation` being absent does —
 * never a collapsed 0px iframe.
 */
export function resolvePresentationLayout(
  presentation: GamePresentation | undefined,
  available: AvailableViewport | null,
): PresentationLayout {
  if (!presentation || !available) return { kind: "legacy" };
  if (available.width <= 0 || available.height <= 0) return { kind: "legacy" };

  return presentation.viewport.mode === "fixed"
    ? resolveFixedLayout(presentation.viewport, available)
    : resolveResponsiveLayout(presentation.viewport, available);
}

function resolveResponsiveLayout(
  viewport: Extract<GamePresentation["viewport"], { mode: "responsive" }>,
  available: AvailableViewport,
): PresentationLayout {
  if (viewport.preferredWidth !== undefined && viewport.preferredHeight !== undefined) {
    const { preferredWidth, preferredHeight } = viewport;
    const minimumScale = Math.max(
      viewport.minWidth !== undefined ? viewport.minWidth / preferredWidth : 0,
      viewport.minHeight !== undefined ? viewport.minHeight / preferredHeight : 0,
    );
    const maximumScale = Math.min(
      available.width / preferredWidth,
      available.height / preferredHeight,
      viewport.maxWidth !== undefined
        ? viewport.maxWidth / preferredWidth
        : Number.POSITIVE_INFINITY,
      viewport.maxHeight !== undefined
        ? viewport.maxHeight / preferredHeight
        : Number.POSITIVE_INFINITY,
    );
    // A pair of preferred dimensions defines one coherent canvas, not two unrelated caps. Keep
    // that ratio while fitting it into the platform box. The preferred native size (scale 1) wins
    // when possible; declared minima can enlarge it only when the real viewport still allows it.
    // If a minimum conflicts with the device, the actual viewport remains authoritative.
    const scale = Math.min(Math.max(1, minimumScale), maximumScale);
    return {
      kind: "responsive",
      displayWidth: preferredWidth * scale,
      displayHeight: preferredHeight * scale,
    };
  }

  const displayWidth = clampToAvailable(
    viewport.preferredWidth ?? available.width,
    viewport.minWidth,
    viewport.maxWidth,
    available.width,
  );
  const displayHeight = clampToAvailable(
    viewport.preferredHeight ?? available.height,
    viewport.minHeight,
    viewport.maxHeight,
    available.height,
  );
  return { kind: "responsive", displayWidth, displayHeight };
}

/** Clamps `value` into [min, max] (either bound optional), then caps the result at `ceiling` —
 * the actual available space, which always wins even over an explicit minWidth/minHeight. That
 * order matters: a game asking for more than the device has is a preference that loses, not an
 * error and not something worth forcing (see this module's own doc comment). */
function clampToAvailable(
  value: number,
  min: number | undefined,
  max: number | undefined,
  ceiling: number,
): number {
  let result = value;
  if (min !== undefined && result < min) result = min;
  if (max !== undefined && result > max) result = max;
  return Math.min(result, ceiling);
}

function resolveFixedLayout(
  viewport: Extract<GamePresentation["viewport"], { mode: "fixed" }>,
  available: AvailableViewport,
): PresentationLayout {
  const { preferredWidth: logicalWidth, preferredHeight: logicalHeight } = viewport;

  // "contain" fit: the largest scale that keeps both dimensions within `available`, capped at 1
  // so a design resolution smaller than the available space is never stretched up (see this
  // function's own PresentationLayout["scale"] doc comment).
  const scale = Math.min(available.width / logicalWidth, available.height / logicalHeight, 1);

  return {
    kind: "fixed",
    logicalWidth,
    logicalHeight,
    displayWidth: logicalWidth * scale,
    displayHeight: logicalHeight * scale,
    scale,
  };
}
