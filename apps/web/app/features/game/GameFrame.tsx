import { useRef, useState } from "react";

/**
 * Attributes granted to a game's iframe. Exported so tests can assert the policy directly, and so
 * there is exactly one definition of it rather than a string duplicated across every page that
 * embeds a game.
 *
 * The iframe sandbox is **not** an anti-cheat measure — a player fully controls their own browser,
 * and the score model treats client-reported results as untrusted regardless. Its job is the other
 * direction: protecting OwOGG and its users from third-party code that a developer uploaded.
 *
 * `allow-same-origin` is deliberately absent. Adding it would hand the game a real origin and
 * therefore access to storage and (with a same-site host) potentially cookies — collapsing the
 * boundary this exists to create. It must not be added for convenience; only a demonstrated engine
 * requirement, verified against a real build, would justify revisiting it, and the fix would more
 * likely be to move games to a separate registrable domain first.
 */
export const GAME_IFRAME_SANDBOX = "allow-scripts allow-pointer-lock";

/** Fullscreen is a common expectation for action/shooter builds, and is safe: it's a user-gesture
 * gated presentation change, not a capability grant. */
export const GAME_IFRAME_ALLOW = "fullscreen";
export const GAME_IFRAME_REFERRER_POLICY = "no-referrer";

export interface GameFrameProps {
  /** Full URL the iframe loads. GameFrame itself has no opinion on where a game's bytes come
   * from. */
  src: string;
  title: string;
  /** Rendered before the player starts, so a catalog or detail page costs no game download. */
  poster?: React.ReactNode | undefined;
  className?: string | undefined;
  /** Mounts the iframe immediately. GameHost enables this because a dedicated game page already
   * represents an explicit play intent; callers that render only a preview can keep the lazy
   * PLAY gate by leaving it false. */
  autoStart?: boolean | undefined;
  /** Wraps the iframe itself (poster/play-button and the loading overlay use `className`
   * instead) — lets a page control the frame's aspect ratio independent of the poster's own
   * layout. Defaults to filling `className`'s box. */
  frameClassName?: string | undefined;
  /** Inline sizing for the same wrapper `frameClassName` styles — for a caller (GameHost, via
   * presentationLayoutResolver.ts) that computed an exact pixel box rather than a static Tailwind
   * class. Merges over `frameClassName`; inline `style` always wins over a class in the cascade,
   * so this is additive, not a replacement. */
  frameStyle?: React.CSSProperties | undefined;
  /** Inline sizing/transform for the `<iframe>` element itself, overriding its default `h-full
   * w-full`. The one case this exists for: `mode: "fixed"` presentation, where the iframe must be
   * sized to the game's own logical/design resolution (so the framed document sees that as its
   * viewport) and then visually scaled down with `transform: scale(...)` to fit the displayed
   * surface `frameStyle` shapes — see GameHost.tsx's own doc comment on why that's a `transform`
   * on the iframe and not a change to `frameStyle`/the wrapper. `transform: scale()` shrinks how
   * the iframe paints, not its layout box (still the full, unscaled logical size) — the wrapper
   * below carries its own `overflow-hidden` specifically so that box never contributes scrollable
   * overflow beyond the (smaller) displayed surface. */
  iframeStyle?: React.CSSProperties | undefined;
  /** Controls the framed document's own scroll surface. `auto` preserves the generic game
   * behavior, `disabled` keeps viewport-fitted managed multiplayer free of a nested scrollbar,
   * and `enabled` is reserved for explicit tools such as the admin Relay probe. */
  documentScrolling?: "auto" | "disabled" | "enabled" | undefined;
  /** Fires once per iframe `load` event, after GameFrame's own loading-overlay state is cleared —
   * the hook a runtime (see runtime/IframeRuntime.tsx) uses to establish the Game Bridge once the
   * framed document actually exists to receive it. Receives the
   * live iframe element, never a src string or anything else: the Bridge needs the real
   * `HTMLIFrameElement` to reach `.contentWindow`. */
  onFrameLoad?: ((iframe: HTMLIFrameElement) => void) | undefined;
}

/**
 * Embeds a game for either publisher. Dedicated play pages can opt into immediate mounting, while
 * preview surfaces can retain the explicit PLAY gate.
 *
 * Deferring the mount can matter for real reasons, not just polish: a game bundle can be tens of
 * megabytes of WASM and assets, so auto-loading on page view would spend the player's bandwidth and
 * the project's storage egress on games nobody chose to play — and a page listing several games
 * would multiply that. Once started, the game runs entirely on the player's own CPU/GPU; OwOGG
 * serves files and never executes game code.
 *
 * The iframe is always Bridge-driven through IframeRuntime; there is no publisher-specific
 * wrapper or fallback runtime.
 */
export function GameFrame({
  src,
  title,
  poster,
  className,
  autoStart = false,
  frameClassName,
  frameStyle,
  iframeStyle,
  documentScrolling = "auto",
  onFrameLoad,
}: GameFrameProps) {
  const [started, setStarted] = useState(autoStart);
  const [loading, setLoading] = useState(autoStart);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const start = () => {
    setLoading(true);
    setStarted(true);
  };

  const handleLoad = () => {
    setLoading(false);
    if (onFrameLoad && iframeRef.current) {
      onFrameLoad(iframeRef.current);
    }
  };

  // GameHost places this component directly inside a flex row. A flex item with no intrinsic
  // width can otherwise shrink to the iframe's fallback size (or effectively zero before the
  // iframe mounts), making the entire player look like an empty black surface. Keep the runtime
  // root full-width regardless of whether a caller supplied additional classes.
  const rootClassName = className ? `w-full ${className}` : "w-full";

  if (!started) {
    return (
      <div className={rootClassName}>
        <div className={`relative overflow-hidden ${frameClassName ?? ""}`} style={frameStyle}>
          {poster}
          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
            <button
              type="button"
              onClick={start}
              className="inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-light"
            >
              PLAY
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={rootClassName}>
      <div className={`relative overflow-hidden ${frameClassName ?? ""}`} style={frameStyle}>
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface-raised">
            <span className="text-xs font-bold text-text-muted">불러오는 중...</span>
          </div>
        )}
        <iframe
          ref={iframeRef}
          className={`block h-full w-full ${
            documentScrolling === "enabled" ? "overflow-auto" : "overflow-hidden"
          }`}
          style={iframeStyle}
          src={src}
          title={title}
          sandbox={GAME_IFRAME_SANDBOX}
          allow={GAME_IFRAME_ALLOW}
          scrolling={
            documentScrolling === "disabled"
              ? "no"
              : documentScrolling === "enabled"
                ? "yes"
                : undefined
          }
          // The game's own document additionally carries `connect-src 'none'` from the serving
          // Worker (apps/api/src/routes/gameServing.ts), so it cannot reach the network at all.
          referrerPolicy={GAME_IFRAME_REFERRER_POLICY}
          onLoad={handleLoad}
        />
      </div>
    </div>
  );
}
