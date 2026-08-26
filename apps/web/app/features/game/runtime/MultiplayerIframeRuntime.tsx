import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type {
  MultiplayerRematchResponse,
  MultiplayerRoomPlayer,
  MultiplayerRoomResponse,
} from "@owogg/contracts";
import { ApiClientError } from "../../../lib/api/errors";
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
import {
  fetchMultiplayerRematchStatus,
  fetchMultiplayerRoomRoster,
  leaveMultiplayerRoom,
  requestMultiplayerRematch,
} from "./multiplayerRoomApi";

function PlayerProfileCard({
  player,
  seatIndex,
  selfParticipantId,
}: {
  readonly player: MultiplayerRoomPlayer | undefined;
  readonly seatIndex: 0 | 1;
  readonly selfParticipantId: string;
}) {
  const isSelf = player?.participantId === selfParticipantId;
  const stoneLabel = seatIndex === 0 ? "흑" : "백";
  return (
    <div
      className={`flex min-w-0 items-center gap-2 ${seatIndex === 1 ? "justify-end text-right" : ""}`}
    >
      {seatIndex === 1 && (
        <span className="hidden min-w-0 sm:block">
          <span className="block truncate text-xs font-black text-text-primary">
            {player?.nickname ?? "상대 대기 중"}
          </span>
          <span className="block text-[10px] font-bold text-text-muted">
            {player ? `${stoneLabel}${isSelf ? " · 나" : ""}` : stoneLabel}
          </span>
        </span>
      )}
      <span
        className={`relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border text-xs font-black ${
          seatIndex === 0
            ? "border-slate-500 bg-slate-950 text-white"
            : "border-slate-200 bg-slate-100 text-slate-900"
        }`}
        aria-hidden="true"
      >
        {player?.avatarUrl ? (
          <img
            src={player.avatarUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
          />
        ) : (
          player?.nickname.trim().charAt(0) || stoneLabel
        )}
      </span>
      {seatIndex === 0 && (
        <span className="hidden min-w-0 sm:block">
          <span className="block truncate text-xs font-black text-text-primary">
            {player?.nickname ?? "플레이어 대기 중"}
          </span>
          <span className="block text-[10px] font-bold text-text-muted">
            {player ? `${stoneLabel}${isSelf ? " · 나" : ""}` : stoneLabel}
          </span>
        </span>
      )}
    </div>
  );
}

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
  readonly onRoomChange: (room: MultiplayerRoomResponse) => void;
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
  onRoomChange,
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
  const [players, setPlayers] = useState<readonly MultiplayerRoomPlayer[]>([]);
  const [rematchState, setRematchState] = useState<
    "CHECKING" | "AVAILABLE" | "WAITING" | "OPPONENT_REQUESTED" | "STARTING" | "UNAVAILABLE"
  >("CHECKING");
  const [rematchBusy, setRematchBusy] = useState(false);
  const [rematchError, setRematchError] = useState<string | null>(null);
  const bridgeRef = useRef<MultiplayerBridgeHost | null>(null);
  const transportRef = useRef<MultiplayerParentTransport | null>(null);
  const openAttemptRef = useRef(0);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rosterRequestRef = useRef(0);
  const rematchRequestRef = useRef(0);

  const refreshRoster = useCallback(() => {
    const request = ++rosterRequestRef.current;
    void fetchMultiplayerRoomRoster(room.instance.id)
      .then((response) => {
        if (request !== rosterRequestRef.current || response.instanceId !== room.instance.id)
          return;
        setPlayers(response.players);
      })
      .catch(() => {
        // Roster decoration is non-authoritative and must never interrupt the match transport.
      });
  }, [room.instance.id]);

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
    setPlayers([]);
    setRematchState("CHECKING");
    setRematchBusy(false);
    setRematchError(null);
    rematchRequestRef.current += 1;
    refreshRoster();
  }, [
    closeCurrent,
    refreshRoster,
    room.instance.id,
    room.instance.generation,
    room.participant.connectionGeneration,
  ]);

  const applyRematchResponse = useCallback(
    (response: MultiplayerRematchResponse) => {
      setRematchError(null);
      if (response.state === "STARTED") {
        setRematchState("STARTING");
        onRoomChange(response.room);
        return;
      }
      setRematchState(response.state);
    },
    [onRoomChange],
  );

  const refreshRematch = useCallback(() => {
    const request = ++rematchRequestRef.current;
    void fetchMultiplayerRematchStatus({
      instanceId: room.instance.id,
      expectedGeneration: room.instance.generation,
    })
      .then((response) => {
        if (request === rematchRequestRef.current) applyRematchResponse(response);
      })
      .catch((reason: unknown) => {
        if (request !== rematchRequestRef.current) return;
        if (reason instanceof ApiClientError && reason.code === "INSTANCE_NOT_JOINABLE") {
          setRematchState("UNAVAILABLE");
          setRematchError(null);
          return;
        }
        setRematchError(
          reason instanceof Error && reason.message
            ? reason.message
            : "재대결 상태를 확인하지 못했습니다.",
        );
      });
  }, [applyRematchResponse, room.instance.generation, room.instance.id]);

  useEffect(() => {
    if (connectionState.status !== "TERMINAL_COMMITTED") return;
    refreshRematch();
    const timer = window.setInterval(refreshRematch, 15_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [connectionState.status, refreshRematch]);

  const handleConnectionState = useCallback(
    (nextState: MultiplayerParentConnectionState) => {
      if (nextState.status === "CONNECTED") {
        reconnectAttemptRef.current = 0;
        setConnectionState(nextState);
        refreshRoster();
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
    [closeCurrent, refreshRoster],
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
            {
              onConnectionState: handleConnectionState,
              onRosterChange: refreshRoster,
              onRematchChange: refreshRematch,
            },
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
    [
      closeCurrent,
      connectionGeneration,
      handleConnectionState,
      refreshRematch,
      refreshRoster,
      room.instance.id,
    ],
  );

  const retry = useCallback(() => {
    closeCurrent();
    reconnectAttemptRef.current = 0;
    setConnectionState({ status: "CONNECTING" });
    setRetryKey((current) => current + 1);
  }, [closeCurrent]);

  const leave = useCallback(async () => {
    setLeaving(true);
    if (
      connectionState.status !== "DISCONNECTED" &&
      connectionState.status !== "TERMINAL_COMMITTED" &&
      connectionState.status !== "ABORTED"
    ) {
      bridgeRef.current?.leave();
    }
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

  const requestRematch = useCallback(async () => {
    setRematchBusy(true);
    setRematchError(null);
    try {
      applyRematchResponse(
        await requestMultiplayerRematch({
          instanceId: room.instance.id,
          expectedGeneration: room.instance.generation,
        }),
      );
    } catch (reason) {
      setRematchError(
        reason instanceof Error && reason.message
          ? reason.message
          : "재대결을 요청하지 못했습니다.",
      );
    } finally {
      setRematchBusy(false);
    }
  }, [applyRematchResponse, room.instance.generation, room.instance.id]);

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

  const rematchActions =
    connectionState.status === "TERMINAL_COMMITTED" ? (
      <div className="mt-5 border-t border-border pt-5">
        {rematchState === "OPPONENT_REQUESTED" ? (
          <p className="text-sm font-bold text-brand-light">상대방이 재대결을 요청했습니다.</p>
        ) : rematchState === "WAITING" ? (
          <p className="text-sm font-semibold text-text-secondary">
            상대방의 재대결 응답을 기다리는 중입니다.
          </p>
        ) : rematchState === "STARTING" ? (
          <p className="text-sm font-semibold text-text-secondary">새 경기를 준비하고 있습니다.</p>
        ) : rematchState === "UNAVAILABLE" ? (
          <p className="text-sm font-semibold text-text-muted">
            재대결 가능 시간이 종료되었습니다.
          </p>
        ) : (
          <p className="text-sm text-text-secondary">같은 상대와 한 판 더 진행할 수 있습니다.</p>
        )}
        {(rematchState === "AVAILABLE" || rematchState === "OPPONENT_REQUESTED") && (
          <button
            type="button"
            disabled={rematchBusy}
            onClick={() => void requestRematch()}
            className="mt-3 rounded-xl bg-brand px-5 py-2.5 text-sm font-black text-white disabled:cursor-wait disabled:opacity-60"
          >
            {rematchBusy
              ? "처리 중"
              : rematchState === "OPPONENT_REQUESTED"
                ? "재대결 수락"
                : "다시하기"}
          </button>
        )}
        {rematchState === "CHECKING" && (
          <p className="mt-2 text-xs font-semibold text-text-muted">재대결 가능 여부 확인 중</p>
        )}
        {rematchError && (
          <p role="alert" className="mt-2 text-xs font-semibold text-accent-red">
            {rematchError}
          </p>
        )}
      </div>
    ) : undefined;

  const leftPlayer = players.find((player) => player.seatIndex === 0);
  const rightPlayer = players.find((player) => player.seatIndex === 1);
  const connectionLabel =
    connectionState.status === "CONNECTED"
      ? "서버 연결됨"
      : connectionState.status === "CONNECTING"
        ? "연결 중"
        : connectionState.status === "TERMINAL_PENDING"
          ? "결과 저장 중"
          : connectionState.status === "TERMINAL_COMMITTED"
            ? "경기 종료"
            : "연결 확인 필요";

  return (
    <div className="w-full bg-[#08090d]">
      <div className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-b border-white/10 bg-surface-raised px-3 py-2 sm:px-4">
        <PlayerProfileCard
          player={leftPlayer}
          seatIndex={0}
          selfParticipantId={room.participant.id}
        />
        <div className="flex flex-col items-center gap-1">
          <div className="flex flex-wrap items-center justify-center gap-1.5 text-[10px] font-bold text-text-secondary sm:text-[11px]">
            <span className="whitespace-nowrap rounded-full border border-border bg-surface px-2 py-1">
              방 코드 {room.instance.publicCode}
            </span>
            <button
              type="button"
              onClick={() => void copyRoom("CODE")}
              className="cursor-pointer rounded-full border border-border px-2 py-1 hover:bg-surface-overlay"
            >
              {copied === "CODE" ? "복사됨" : "코드 복사"}
            </button>
            {shareValue && (
              <button
                type="button"
                onClick={() => void copyRoom("LINK")}
                className="cursor-pointer rounded-full border border-brand/40 px-2 py-1 text-brand-light hover:bg-brand/10"
              >
                {copied === "LINK" ? "복사됨" : "링크 복사"}
              </button>
            )}
            <button
              type="button"
              disabled={leaving}
              onClick={() => void leave()}
              className="cursor-pointer rounded-full border border-red-300/20 px-2 py-1 text-red-300 hover:bg-red-400/10 disabled:cursor-wait disabled:opacity-60"
            >
              {leaving ? "나가는 중" : "나가기"}
            </button>
          </div>
          <span
            className={`text-[10px] font-bold ${
              connectionState.status === "CONNECTED" ? "text-emerald-400" : "text-text-muted"
            }`}
          >
            {connectionLabel}
          </span>
        </div>
        <PlayerProfileCard
          player={rightPlayer}
          seatIndex={1}
          selfParticipantId={room.participant.id}
        />
      </div>
      <div className="relative w-full overflow-hidden">
        <GameFrame
          key={`${attemptKey}:${room.instance.generation}:${retryKey}`}
          src={src}
          title={title}
          autoStart
          frameClassName={frameClassName}
          frameStyle={frameStyle}
          iframeStyle={iframeStyle}
          onFrameLoad={handleFrameLoad}
          showReloadControl={false}
          disableScrolling
        />
        <MultiplayerConnectionOverlay
          state={connectionState}
          canonicalResult={canonicalResult}
          terminalActions={rematchActions}
          onRetry={retry}
          onLeave={() => void leave()}
          hideConnectedStatus
        />
      </div>
    </div>
  );
}
