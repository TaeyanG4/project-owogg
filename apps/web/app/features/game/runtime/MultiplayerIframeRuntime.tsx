import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Check, Copy, Link2, LogOut } from "lucide-react";
import type { MultiplayerRoomPlayer, MultiplayerRoomResponse } from "@owogg/contracts";
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
import { fetchMultiplayerRoomRoster, leaveMultiplayerRoom } from "./multiplayerRoomApi";

function PlayerRosterCard({
  player,
  selfParticipantId,
  pingMs,
}: {
  readonly player: MultiplayerRoomPlayer;
  readonly selfParticipantId: string;
  readonly pingMs: number | null;
}) {
  const isSelf = player.participantId === selfParticipantId;
  const participantLabel = player.role === "HOST" ? "방장" : "플레이어";
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-xl border border-white/10 bg-black/15 px-3 py-2">
      <span
        className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-brand/35 bg-brand/10 text-sm font-black text-text-primary"
        aria-hidden="true"
      >
        {player.avatarUrl ? (
          <img
            src={player.avatarUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
          />
        ) : (
          player.nickname.trim().charAt(0) || String(player.seatIndex + 1)
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-black text-text-primary">
          {player.nickname}
        </span>
        <span className="block text-xs font-bold text-text-muted">
          {`슬롯 ${player.seatIndex + 1} · ${participantLabel}${isSelf ? " · 나" : ""}`}
          <span
            className={multiplayerPingTone(pingMs)}
          >{` · ${multiplayerPingLabel(pingMs)}`}</span>
        </span>
      </span>
    </div>
  );
}

export function multiplayerPingLabel(pingMs: number | null): string {
  return pingMs === null ? "핑 측정 중" : `핑 ${pingMs}ms`;
}

export function multiplayerPingTone(pingMs: number | null): string {
  if (pingMs === null) return "text-text-muted";
  if (pingMs <= 80) return "text-emerald-400";
  if (pingMs <= 180) return "text-amber-300";
  return "text-red-300";
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
  readonly onExit: () => void;
}

export function multiplayerRuntimeInitialRoster(
  room: MultiplayerRoomResponse,
  initialPlayers?: readonly MultiplayerRoomPlayer[],
): readonly MultiplayerRoomPlayer[] | null {
  if (
    !initialPlayers ||
    initialPlayers.length < 2 ||
    initialPlayers.length > 8 ||
    initialPlayers.length !== room.instance.participantCount ||
    !initialPlayers.some((player) => player.participantId === room.participant.id) ||
    new Set(initialPlayers.map((player) => player.participantId)).size !== initialPlayers.length ||
    new Set(initialPlayers.map((player) => player.seatIndex)).size !== initialPlayers.length
  ) {
    return null;
  }
  return initialPlayers;
}

/**
 * Parent-owned Relay runtime. The sandbox receives only sanitized multiplayer messages while
 * tickets, socket URLs, reconnect generations, and leave fallback stay in the parent.
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
  const [latencies, setLatencies] = useState<ReadonlyMap<string, number>>(() => new Map());
  const bridgeRef = useRef<MultiplayerBridgeHost | null>(null);
  const transportRef = useRef<MultiplayerParentTransport | null>(null);
  const openAttemptRef = useRef(0);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rosterRequestRef = useRef(0);

  const refreshRoster = useCallback(() => {
    const request = ++rosterRequestRef.current;
    void fetchMultiplayerRoomRoster(room.instance.id)
      .then((response) => {
        if (request !== rosterRequestRef.current || response.instanceId !== room.instance.id)
          return;
        setPlayers(response.players);
      })
      .catch(() => {
        // Roster decoration must never interrupt the Relay transport.
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
    setLatencies(new Map());
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

  const handleLatencySamples = useCallback(
    (samples: readonly { readonly participantId: string; readonly rttMs: number }[]) => {
      setLatencies((current) => {
        const next = new Map(current);
        for (const sample of samples) next.set(sample.participantId, sample.rttMs);
        return next;
      });
    },
    [],
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
        expectedGameVersionId: room.instance.gameVersionId,
        expectedContentHash: room.instance.contentHash,
        expectedProfileRevision: room.instance.profileRevision,
        expectedGeneration: room.instance.generation,
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
              onLatencySamples: handleLatencySamples,
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
      handleLatencySamples,
      room.instance.contentHash,
      room.instance.gameVersionId,
      room.instance.generation,
      room.instance.id,
      room.instance.profileRevision,
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
    try {
      await leaveMultiplayerRoom({
        instanceId: room.instance.id,
        expectedGeneration: room.instance.generation,
      });
    } catch {
      // Fall back to the already-authenticated socket only when the HTTP control response is lost.
      if (connectionState.status !== "DISCONNECTED" && connectionState.status !== "CLOSED") {
        bridgeRef.current?.leave();
      }
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

  const orderedPlayers = [...players].sort((left, right) => left.seatIndex - right.seatIndex);
  const connectionLabel =
    connectionState.status === "CONNECTED"
      ? "서버 연결됨"
      : connectionState.status === "CONNECTING"
        ? "연결 중"
        : connectionState.status === "CLOSED"
          ? "방 종료"
          : "연결 확인 필요";

  return (
    <div className="w-full bg-[#08090d]">
      <div className="border-b border-white/10 bg-surface-raised px-3 py-3 sm:px-4">
        <div className="flex min-w-0 flex-col items-center gap-2">
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
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {orderedPlayers.map((player) => (
            <PlayerRosterCard
              key={player.participantId}
              player={player}
              selfParticipantId={room.participant.id}
              pingMs={latencies.get(player.participantId) ?? null}
            />
          ))}
          {orderedPlayers.length === 0 && (
            <p className="col-span-full py-2 text-center text-sm font-semibold text-text-muted">
              참가자 정보를 불러오는 중입니다.
            </p>
          )}
        </div>
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
          onRetry={retry}
          onLeave={() => void leave()}
          hideConnectedStatus
        />
      </div>
    </div>
  );
}
