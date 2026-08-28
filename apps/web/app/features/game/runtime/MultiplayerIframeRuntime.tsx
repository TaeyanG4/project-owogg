import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Check, Copy, Link2, LogOut } from "lucide-react";
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
  type MultiplayerPlayerConnectionState,
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
  connection,
}: {
  readonly player: MultiplayerRoomPlayer | undefined;
  readonly seatIndex: 0 | 1;
  readonly selfParticipantId: string;
  readonly connection?: MultiplayerPlayerConnectionState;
}) {
  const isSelf = player?.participantId === selfParticipantId;
  const participantLabel = player?.role === "HOST" ? "방장" : "플레이어";
  const connectionLabel =
    connection?.status === "RECONNECTING"
      ? "재접속 대기"
      : connection?.status === "LEFT"
        ? "나감"
        : connection?.status === "TIMED_OUT"
          ? "연결 만료"
          : null;
  return (
    <div
      className={`flex min-w-0 items-center gap-2.5 ${seatIndex === 1 ? "justify-end text-right" : ""}`}
    >
      {seatIndex === 1 && (
        <span className="hidden min-w-0 sm:block">
          <span className="block truncate text-sm font-black text-text-primary">
            {player?.nickname ?? "상대 대기 중"}
          </span>
          <span className="block text-xs font-bold text-text-muted">
            {player
              ? `${participantLabel}${isSelf ? " · 나" : ""}${connectionLabel ? ` · ${connectionLabel}` : ""}`
              : `슬롯 ${seatIndex + 1}`}
          </span>
        </span>
      )}
      <span
        className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-brand/35 bg-brand/10 text-sm font-black text-text-primary"
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
          player?.nickname.trim().charAt(0) || String(seatIndex + 1)
        )}
      </span>
      {seatIndex === 0 && (
        <span className="hidden min-w-0 sm:block">
          <span className="block truncate text-sm font-black text-text-primary">
            {player?.nickname ?? "플레이어 대기 중"}
          </span>
          <span className="block text-xs font-bold text-text-muted">
            {player
              ? `${participantLabel}${isSelf ? " · 나" : ""}${connectionLabel ? ` · ${connectionLabel}` : ""}`
              : `슬롯 ${seatIndex + 1}`}
          </span>
        </span>
      )}
    </div>
  );
}

export function multiplayerTerminalLabel(result: unknown, viewer: number | string): string {
  if (typeof result !== "object" || result === null || Array.isArray(result)) return "경기 종료";
  const terminal = result as Record<string, unknown>;
  if (terminal.kind === "DRAW") return "무승부";
  if (
    terminal.kind === "FORFEIT" &&
    typeof terminal.winnerParticipantId === "string" &&
    typeof viewer === "string"
  ) {
    return terminal.winnerParticipantId === viewer ? "기권승" : "기권패";
  }
  if (
    terminal.kind === "WIN" &&
    typeof terminal.winnerParticipantId === "string" &&
    typeof viewer === "string"
  ) {
    return terminal.winnerParticipantId === viewer ? "승리" : "패배";
  }
  if (
    terminal.kind === "WIN" &&
    (terminal.winnerSeatIndex === 0 || terminal.winnerSeatIndex === 1)
  ) {
    return terminal.winnerSeatIndex === viewer ? "승리" : "패배";
  }
  return "경기 종료";
}

function PeerConnectionNotice({ state }: { readonly state: MultiplayerPlayerConnectionState }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (state.status !== "RECONNECTING") return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [state.status]);

  const message = multiplayerPeerConnectionMessage(state, now);
  if (!message) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={`border-b px-4 py-2.5 text-center text-sm font-bold ${
        state.status === "RECONNECTING"
          ? "border-amber-300/20 bg-amber-300/10 text-amber-100"
          : "border-red-300/20 bg-red-400/10 text-red-200"
      }`}
    >
      {message}
    </div>
  );
}

export function multiplayerPeerConnectionMessage(
  state: MultiplayerPlayerConnectionState,
  nowMs = Date.now(),
): string | null {
  if (state.status === "CONNECTED") return null;
  if (state.status !== "RECONNECTING") {
    return state.status === "LEFT"
      ? "상대가 게임에서 나갔습니다."
      : "상대가 30초 안에 재접속하지 않아 기권 처리되었습니다.";
  }
  const seconds = Math.max(0, Math.ceil((Date.parse(state.reconnectDeadlineAt) - nowMs) / 1_000));
  return seconds > 0
    ? `상대 네트워크 연결이 불안정합니다. ${seconds}초 동안 재접속을 기다립니다.`
    : "재접속 유예 시간이 끝났습니다. 공식 기권 결과를 확인하고 있습니다.";
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
  readonly initialPlayers?: readonly MultiplayerRoomPlayer[];
  readonly onRoomChange: (room: MultiplayerRoomResponse) => void;
  readonly onExit: () => void;
}

export function multiplayerRuntimeInitialRoster(
  room: MultiplayerRoomResponse,
  initialPlayers?: readonly MultiplayerRoomPlayer[],
): readonly MultiplayerRoomPlayer[] | null {
  if (
    !initialPlayers ||
    initialPlayers.length !== room.instance.participantCount ||
    !initialPlayers.some((player) => player.participantId === room.participant.id) ||
    new Set(initialPlayers.map((player) => player.participantId)).size !== initialPlayers.length
  ) {
    return null;
  }
  return initialPlayers;
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
  initialPlayers,
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
  const [players, setPlayers] = useState<readonly MultiplayerRoomPlayer[]>(
    () => multiplayerRuntimeInitialRoster(room, initialPlayers) ?? [],
  );
  const [playerConnections, setPlayerConnections] = useState<
    ReadonlyMap<string, MultiplayerPlayerConnectionState>
  >(new Map());
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
    const rosterSeed = multiplayerRuntimeInitialRoster(room, initialPlayers);
    setPlayers(rosterSeed ?? []);
    setPlayerConnections(new Map());
    setRematchState("CHECKING");
    setRematchBusy(false);
    setRematchError(null);
    rematchRequestRef.current += 1;
    if (rosterSeed) rosterRequestRef.current += 1;
    else refreshRoster();
  }, [
    closeCurrent,
    refreshRoster,
    initialPlayers,
    room,
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
  }, [connectionState.status, refreshRematch]);

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
            {
              onConnectionState: handleConnectionState,
              onRematchChange: refreshRematch,
              onPlayerConnectionChange: (state) => {
                setPlayerConnections((current) => {
                  const next = new Map(current);
                  next.set(state.participantId, state);
                  return next;
                });
              },
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
    [closeCurrent, connectionGeneration, handleConnectionState, refreshRematch, room.instance.id],
  );

  const retry = useCallback(() => {
    closeCurrent();
    reconnectAttemptRef.current = 0;
    setConnectionState({ status: "CONNECTING" });
    setRetryKey((current) => current + 1);
  }, [closeCurrent]);

  const leave = useCallback(async () => {
    setLeaving(true);
    try {
      await leaveMultiplayerRoom({
        instanceId: room.instance.id,
        expectedGeneration: room.instance.generation,
      });
    } catch {
      // The authenticated HTTP control path is authoritative and serializes through the same
      // Durable Object as gameplay. Only fall back to the already-authenticated socket if the
      // HTTP response is lost; sending both concurrently can turn a forfeit into an abort race.
      if (
        connectionState.status !== "DISCONNECTED" &&
        connectionState.status !== "TERMINAL_COMMITTED" &&
        connectionState.status !== "ABORTED"
      ) {
        bridgeRef.current?.leave();
      }
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
          {multiplayerTerminalLabel(connectionState.result, room.participant.id)}
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
  const leftConnection = leftPlayer ? playerConnections.get(leftPlayer.participantId) : undefined;
  const rightConnection = rightPlayer
    ? playerConnections.get(rightPlayer.participantId)
    : undefined;
  const opponent = players.find((player) => player.participantId !== room.participant.id);
  const opponentConnection = opponent ? playerConnections.get(opponent.participantId) : undefined;
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
      <div className="grid min-h-20 grid-cols-2 items-center gap-3 border-b border-white/10 bg-surface-raised px-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:px-4">
        <PlayerProfileCard
          player={leftPlayer}
          seatIndex={0}
          selfParticipantId={room.participant.id}
          {...(leftConnection ? { connection: leftConnection } : {})}
        />
        <div className="order-3 col-span-2 flex min-w-0 flex-col items-center gap-2 sm:order-none sm:col-span-1">
          <div className="flex max-w-full flex-wrap items-stretch justify-center gap-2">
            <span className="flex min-h-11 items-center gap-2 rounded-xl border border-border bg-surface px-3.5 py-2">
              <span className="text-xs font-black uppercase tracking-wider text-text-muted">
                방 코드
              </span>
              <code className="whitespace-nowrap text-base font-black tracking-wide text-text-primary">
                {room.instance.publicCode}
              </code>
            </span>
            <button
              type="button"
              onClick={() => void copyRoom("CODE")}
              className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border bg-surface px-3.5 py-2 text-sm font-black text-text-primary transition-colors hover:border-brand/40 hover:bg-surface-overlay"
            >
              {copied === "CODE" ? (
                <Check className="h-4 w-4 text-accent-green" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              {copied === "CODE" ? "코드 복사됨" : "코드 복사"}
            </button>
            {shareValue && (
              <button
                type="button"
                onClick={() => void copyRoom("LINK")}
                className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-brand/40 bg-brand/10 px-3.5 py-2 text-sm font-black text-brand-light transition-colors hover:bg-brand/20"
              >
                {copied === "LINK" ? (
                  <Check className="h-4 w-4 text-accent-green" />
                ) : (
                  <Link2 className="h-4 w-4" />
                )}
                {copied === "LINK" ? "링크 복사됨" : "링크 복사"}
              </button>
            )}
            <button
              type="button"
              disabled={leaving}
              onClick={() => void leave()}
              className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-red-300/25 bg-red-400/5 px-3.5 py-2 text-sm font-black text-red-300 transition-colors hover:bg-red-400/15 disabled:cursor-wait disabled:opacity-60"
            >
              <LogOut className="h-4 w-4" />
              {leaving ? "나가는 중" : "나가기"}
            </button>
          </div>
          <span
            role="status"
            className={`inline-flex items-center gap-1.5 text-sm font-bold ${
              connectionState.status === "CONNECTED" ? "text-emerald-400" : "text-text-muted"
            }`}
          >
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 rounded-full ${
                connectionState.status === "CONNECTED" ? "bg-emerald-400" : "bg-text-muted"
              }`}
            />
            {connectionLabel}
          </span>
        </div>
        <div className="order-2 sm:order-none">
          <PlayerProfileCard
            player={rightPlayer}
            seatIndex={1}
            selfParticipantId={room.participant.id}
            {...(rightConnection ? { connection: rightConnection } : {})}
          />
        </div>
      </div>
      {opponentConnection && <PeerConnectionNotice state={opponentConnection} />}
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
