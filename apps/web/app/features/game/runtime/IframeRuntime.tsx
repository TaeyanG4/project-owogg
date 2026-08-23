import { useCallback, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { GameFrame } from "../GameFrame";
import { createGameBridgeHost, type GameBridgeHost } from "./gameBridgeHost";
import type { OwoggCompletionPayload } from "@owogg/game-sdk/contracts";

export interface IframeRuntimeProps {
  src: string;
  title: string;
  poster?: ReactNode;
  className?: string;
  frameClassName?: string;
  frameStyle?: React.CSSProperties | undefined;
  iframeStyle?: React.CSSProperties | undefined;
  /** Bumped by GameHost's retry handler. Applied as GameFrame's `key`, so a retry fully remounts
   * the iframe (fresh `started`/loading
   * state, a real reload — not just a Bridge reset) exactly the way "다시 시작" already worked;
   * the Bridge for the previous attempt is torn down in the same effect that reacts to this. */
  attemptKey: number;
  /** Threaded into HOST_INIT's own optional `difficultyId` field (see gameBridgeHost.ts /
   * protocol.ts's HostInitMessage) — only a game with real difficulty tiers (aim-test) needs
   * this; every other caller simply omits it. Bootstrap-only: this protocol has no live-update
   * message, so a difficulty change reaching a game already mid-session requires a fresh mount
   * (a new `attemptKey`) — see GameHost.tsx's own doc comment for how that's enforced. */
  difficultyId?: string;
  onReady?: () => void;
  onStarted?: () => void;
  onEvent?: (name: string, data?: unknown) => void;
  onComplete?: (result: OwoggCompletionPayload & { metadata?: Record<string, unknown> }) => void;
  onCancel?: () => void;
  onError?: (message?: string) => void;
}

/**
 * Mounts a Bridge-driven game inside GameFrame's lazy-mount/sandbox embed and wires the Game
 * Bridge to it. GameHost is the sole runtime consumer for every publisher.
 */
export function IframeRuntime({
  src,
  title,
  poster,
  className,
  frameClassName,
  frameStyle,
  iframeStyle,
  attemptKey,
  difficultyId,
  onReady,
  onStarted,
  onEvent,
  onComplete,
  onCancel,
  onError,
}: IframeRuntimeProps) {
  const bridgeRef = useRef<GameBridgeHost | null>(null);

  const closeBridge = useCallback(() => {
    bridgeRef.current?.close();
    bridgeRef.current = null;
  }, []);

  // Safety net for "unmount/retry -> port.close() + listener cleanup": covers both a true unmount
  // and an attemptKey change, even in the (should-never-happen) case where the new attempt's
  // iframe never fires `load` to trigger the defensive close in handleFrameLoad below.
  useEffect(() => {
    return closeBridge;
  }, [attemptKey, closeBridge]);

  const handleFrameLoad = useCallback(
    (iframe: HTMLIFrameElement) => {
      // Defensive: GameFrame's own "다시 시작" button reloads the iframe (a fresh `load` event)
      // independently of attemptKey, so a bridge from the previous load must never be left
      // dangling here either.
      closeBridge();

      const contentWindow = iframe.contentWindow;
      if (!contentWindow) return;

      bridgeRef.current = createGameBridgeHost(
        contentWindow,
        {
          ...(onReady ? { onReady } : {}),
          ...(onStarted ? { onStarted } : {}),
          ...(onEvent ? { onEvent } : {}),
          ...(onComplete ? { onComplete } : {}),
          ...(onCancel ? { onCancel } : {}),
          ...(onError ? { onError } : {}),
        },
        difficultyId ? { difficultyId } : undefined,
      );
    },
    [closeBridge, onReady, onStarted, onEvent, onComplete, onCancel, onError, difficultyId],
  );

  return (
    <GameFrame
      key={attemptKey}
      src={src}
      title={title}
      poster={poster}
      className={className}
      frameClassName={frameClassName}
      frameStyle={frameStyle}
      iframeStyle={iframeStyle}
      onFrameLoad={handleFrameLoad}
    />
  );
}
