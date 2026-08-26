import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { MultiplayerRoomResponse } from "@owogg/contracts";
import { GameFrame } from "../GameFrame";
import {
  createMultiplayerBridgeHost,
  type MultiplayerBridgeHost,
  type MultiplayerParentConnectionState,
} from "./multiplayerBridgeHost";
import { MultiplayerConnectionOverlay } from "./MultiplayerConnectionOverlay";
import {
  MultiplayerTransportError,
  openMultiplayerParentTransport,
  type MultiplayerParentTransport,
} from "./multiplayerTransport";
import { leaveMultiplayerRoom } from "./multiplayerRoomApi";

export function multiplayerTerminalLabel(result: unknown, viewerSeatIndex: number): string {
  if (typeof result !== "object" || result === null || Array.isArray(result)) return "경기 종료";
  const terminal = result as Record<string, unknown>;
  if (terminal.kind === "DRAW") return "무승부";
  if (
    terminal.kind === "WIN" &&
    (terminal.winnerSeatIndex === 0 || terminal.winnerSeatIndex === 1)
  ) {
    return terminal.winnerSeatIndex === viewerSeatIndex ? "승리" : "패배";
  }
  return "경기 종료";
}

export function multiplayerRoomClipboardValue(
  kind: "CODE" | "LINK",
  publicCode: string,
  shareValue?: string,
): string | null {
  return kind === "CODE" ? publicCode : (shareValue ?? null);
}

type MultiplayerDisconnectCode = Extract<
  MultiplayerParentConnectionState,
  { readonly status: "DISCONNECTED" }
>["code"];

export function multiplayerReconnectDelay(
  code: MultiplayerDisconnectCode,
  attemptsCompleted: number,
): number | null {
  if (code !== "NETWORK_LOST" && code !== "SERVER_UNAVAILABLE" && code !== "AUTH_EXPIRED") {
    return null;
  }
  return [750, 1_500, 3_000][attemptsCompleted] ?? null;
}

export interface MultiplayerIframeRuntimeProps {
  readonly src: string;
  readonly title: string;
  readonly room: MultiplayerRoomResponse;
  readonly attemptKey: number;
  readonly frameClassName?: string;
  readonly frameStyle?: CSSProperties;
  readonly iframeStyle?: CSSProperties;
  readonly shareValue?: string;
  readonly onExit: () => void;
}

/**
 * Parent-owned multiplayer runtime. It intentionally does not create the legacy GAME_COMPLETE
 * bridge: the sandbox receives only MULTI_INIT and canonical server projections, while tickets,
 * socket URLs, reconnect generations, leave fallback, and result presentation stay in GameHost.
 */
export function MultiplayerIframeRuntime({
  src,
  title,
  room,
  attemptKey,
  frameClassName,
  frameStyle,
  iframeStyle,
  shareValue,
  onExit,
}: MultiplayerIframeRuntimeProps) {
  const [connectionState, setConnectionState] = useState<MultiplayerParentConnectionState>({
    status: "CONNECTING",
  });
  const [connectionGeneration, setConnectionGeneration] = useState(
    room.participant.connectionGeneration,
  );
  const [retryKey, setRetryKey] = useState(0);
  const [copied, setCopied] = useState<"CODE" | "LINK" | null>(null);
  const [leaving, setLeaving] = useState(false);
  const bridgeRef = useRef<MultiplayerBridgeHost | null>(null);
  const transportRef = useRef<MultiplayerParentTransport | null>(null);
  const openAttemptRef = useRef(0);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const closeCurrent = useCallback(() => {
    openAttemptRef.current += 1;
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    bridgeRef.current?.close();
    bridgeRef.current = null;
    const transport = transportRef.current;
    transportRef.current = null;
    if (transport) {
      transport.releaseProtocolGuard();
      if (transport.socket.readyState === 0 || transport.socket.readyState === 1) {
        try {
          transport.socket.close(1000, "runtime replaced");
        } catch {
          // Browser implementations may reject close() while still negotiating.
        }
      }
    }
  }, []);

  useEffect(() => closeCurrent, [closeCurrent]);

  useEffect(() => {
    closeCurrent();
    setConnectionGeneration(room.participant.connectionGeneration);
    setConnectionState({ status: "CONNECTING" });
    reconnectAttemptRef.current = 0;
    setRetryKey(0);
  }, [closeCurrent, room.instance.id, room.participant.connectionGeneration]);

  const handleConnectionState = useCallback(
    (nextState: MultiplayerParentConnectionState) => {
      if (nextState.status === "CONNECTED") {
        reconnectAttemptRef.current = 0;
        setConnectionState(nextState);
        return;
      }
      if (nextState.status === "DISCONNECTED") {
        const delay = multiplayerReconnectDelay(nextState.code, reconnectAttemptRef.current);
        if (delay !== null) {
          reconnectAttemptRef.current += 1;
          setConnectionState({ status: "CONNECTING" });
          if (reconnectTimerRef.current !== null) clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            closeCurrent();
            setRetryKey((current) => current + 1);
          }, delay);
          return;
        }
      }
      setConnectionState(nextState);
    },
    [closeCurrent],
  );

  const handleFrameLoad = useCallback(
    (iframe: HTMLIFrameElement) => {
      const contentWindow = iframe.contentWindow;
      if (!contentWindow) return;
      closeCurrent();
      const openAttempt = openAttemptRef.current;
      setConnectionState({ status: "CONNECTING" });

      void openMultiplayerParentTransport({
        instanceId: room.instance.id,
        expectedConnectionGeneration: connectionGeneration,
      })
        .then((transport) => {
          if (openAttempt !== openAttemptRef.current) {
            transport.releaseProtocolGuard();
            transport.socket.close(1000, "stale runtime open");
            return;
          }
          transportRef.current = transport;
          setConnectionGeneration(transport.connectionGeneration);
          bridgeRef.current = createMultiplayerBridgeHost(
            contentWindow,
            transport.socket,
            transport.bootstrap,
            { onConnectionState: handleConnectionState },
          );
        })
        .catch((error: unknown) => {
          if (openAttempt !== openAttemptRef.current) return;
          handleConnectionState({
            status: "DISCONNECTED",
            code:
              error instanceof MultiplayerTransportError && error.code === "TICKET_EXPIRED"
                ? "AUTH_EXPIRED"
                : "SERVER_UNAVAILABLE",
          });
        });
    },
    [closeCurrent, connectionGeneration, handleConnectionState, room.instance.id],
  );

  const retry = useCallback(() => {
    closeCurrent();
    reconnectAttemptRef.current = 0;
    setConnectionState({ status: "CONNECTING" });
    setRetryKey((current) => current + 1);
  }, [closeCurrent]);

  const leave = useCallback(async () => {
    if (connectionState.status === "TERMINAL_COMMITTED" || connectionState.status === "ABORTED") {
      closeCurrent();
      onExit();
      return;
    }
    setLeaving(true);
    if (connectionState.status !== "DISCONNECTED") bridgeRef.current?.leave();
    try {
      await leaveMultiplayerRoom({
        instanceId: room.instance.id,
        expectedGeneration: room.instance.generation,
      });
    } finally {
      closeCurrent();
      onExit();
    }
  }, [closeCurrent, connectionState.status, onExit, room.instance.generation, room.instance.id]);

  const copyRoom = useCallback(
    async (kind: "CODE" | "LINK") => {
      const value = multiplayerRoomClipboardValue(kind, room.instance.publicCode, shareValue);
      if (value === null) return;
      try {
        await navigator.clipboard.writeText(value);
        setCopied(kind);
        window.setTimeout(() => setCopied(null), 2_000);
      } catch {
        setCopied(null);
      }
    },
    [room.instance.publicCode, shareValue],
  );

  const canonicalResult =
    connectionState.status === "TERMINAL_COMMITTED" ? (
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-text-muted">
          공식 경기 결과
        </p>
        <p className="mt-2 text-4xl font-black text-text-primary">
          {multiplayerTerminalLabel(connectionState.result, room.participant.seatIndex)}
        </p>
      </div>
    ) : undefined;

  return (
    <div className="relative w-full">
      <GameFrame
        key={`${attemptKey}:${retryKey}`}
        src={src}
        title={title}
        autoStart
        frameClassName={frameClassName}
        frameStyle={frameStyle}
        iframeStyle={iframeStyle}
        onFrameLoad={handleFrameLoad}
        showReloadControl={false}
      />
      <div className="absolute left-3 top-3 z-30 flex max-w-[calc(100%_-_5.5rem)] flex-wrap items-center gap-2 rounded-2xl border border-white/15 bg-black/75 px-3 py-2 text-xs font-bold text-white shadow-lg backdrop-blur">
        <span className="whitespace-nowrap">방 코드 {room.instance.publicCode}</span>
        <button
          type="button"
          onClick={() => void copyRoom("CODE")}
          className="cursor-pointer rounded-full border border-white/20 px-2 py-0.5 text-[11px] hover:bg-white/10"
        >
          {copied === "CODE" ? "코드 복사됨" : "코드 복사"}
        </button>
        {shareValue && (
          <button
            type="button"
            onClick={() => void copyRoom("LINK")}
            className="cursor-pointer rounded-full border border-brand/50 px-2 py-0.5 text-[11px] text-brand-light hover:bg-brand/15"
          >
            {copied === "LINK" ? "링크 복사됨" : "초대 링크 복사"}
          </button>
        )}
        <button
          type="button"
          disabled={leaving}
          onClick={() => void leave()}
          className="cursor-pointer rounded-full border border-red-300/30 px-2 py-0.5 text-[11px] text-red-200 hover:bg-red-400/10 disabled:cursor-wait disabled:opacity-60"
        >
          {leaving ? "나가는 중" : "나가기"}
        </button>
      </div>
      <MultiplayerConnectionOverlay
        state={connectionState}
        canonicalResult={canonicalResult}
        onRetry={retry}
        onLeave={() => void leave()}
      />
    </div>
  );
}
