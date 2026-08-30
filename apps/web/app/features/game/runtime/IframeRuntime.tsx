import { useCallback, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { GameFrame } from "../GameFrame";
import { createGameBridgeHost, type GameBridgeHost } from "./gameBridgeHost";
import type { OwoggCompletionPayload } from "@owogg/game-sdk/contracts";
import type {
  GamePlayMode,
  JsonSafeValue,
  PlayConfigSelection,
  PublicPlayConfigDescriptor,
} from "@owogg/game-sdk/bridge";
import type { GameBridgePlayModeDecision, GameBridgeStartDecision } from "./gameBridgeHost";

export interface IframeRuntimeProps {
  src: string;
  title: string;
  poster?: ReactNode;
  className?: string;
  autoStart?: boolean | undefined;
  frameClassName?: string;
  frameStyle?: React.CSSProperties | undefined;
  iframeStyle?: React.CSSProperties | undefined;
  /** Bumped by GameHost's retry handler. Applied as GameFrame's `key`, so a retry fully remounts
   * the iframe (fresh `started`/loading
   * state, a real reload — not just a Bridge reset) exactly the way "다시 시작" already worked;
   * the Bridge for the previous attempt is torn down in the same effect that reacts to this. */
  attemptKey: number;
  /** Threaded into HOST_INIT's own optional `difficultyId` field (see gameBridgeHost.ts /
   * protocol.ts's HostInitMessage). Games without host-selected difficulty tiers omit it.
   * Bootstrap-only: this protocol has no live-update
   * message, so a difficulty change reaching a game already mid-session requires a fresh mount
   * (a new `attemptKey`) — see GameHost.tsx's own doc comment for how that's enforced. */
  difficultyId?: string;
  playConfig?: PublicPlayConfigDescriptor;
  playModes?: readonly GamePlayMode[];
  onReady?: () => void;
  onStarted?: () => void;
  onEvent?: (name: string, data?: unknown) => void;
  onComplete?: (
    result: OwoggCompletionPayload & {
      metadata?: Record<string, unknown>;
      evidence?: JsonSafeValue;
    },
  ) => void;
  onRequestStart?: (
    playConfig: PlayConfigSelection,
  ) => Promise<GameBridgeStartDecision> | GameBridgeStartDecision;
  onSelectPlayMode?: (
    playMode: GamePlayMode,
  ) => Promise<GameBridgePlayModeDecision> | GameBridgePlayModeDecision;
  onPlayModeSelected?: (playMode: GamePlayMode) => void;
  onCancel?: () => void;
  onError?: (message?: string) => void;
}

/**
 * Mounts a Bridge-driven game inside GameFrame's sandbox embed and wires the Game Bridge to it.
 * GameHost enables immediate mounting; preview callers may retain GameFrame's lazy gate. GameHost
 * is the sole runtime consumer for every publisher.
 */
export function IframeRuntime({
  src,
  title,
  poster,
  className,
  autoStart,
  frameClassName,
  frameStyle,
  iframeStyle,
  attemptKey,
  difficultyId,
  playConfig,
  playModes,
  onReady,
  onStarted,
  onEvent,
  onComplete,
  onRequestStart,
  onSelectPlayMode,
  onPlayModeSelected,
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
          ...(onRequestStart ? { onRequestStart } : {}),
          ...(onSelectPlayMode ? { onSelectPlayMode } : {}),
          ...(onPlayModeSelected ? { onPlayModeSelected } : {}),
          ...(onCancel ? { onCancel } : {}),
          ...(onError ? { onError } : {}),
        },
        difficultyId || playConfig || playModes
          ? {
              ...(difficultyId && !playConfig ? { difficultyId } : {}),
              ...(playConfig ? { playConfig } : {}),
              ...(playModes ? { playModes } : {}),
            }
          : undefined,
      );
    },
    [
      closeBridge,
      onReady,
      onStarted,
      onEvent,
      onComplete,
      onRequestStart,
      onSelectPlayMode,
      onPlayModeSelected,
      onCancel,
      onError,
      difficultyId,
      playConfig,
      playModes,
    ],
  );

  return (
    <GameFrame
      key={attemptKey}
      src={src}
      title={title}
      poster={poster}
      className={className}
      autoStart={autoStart}
      frameClassName={frameClassName}
      frameStyle={frameStyle}
      iframeStyle={iframeStyle}
      onFrameLoad={handleFrameLoad}
    />
  );
}
