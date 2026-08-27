import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Check, Copy, Crown, Link2, LogOut, Play, UserRound, UsersRound } from "lucide-react";
import type {
  MultiplayerLobbyChangedMessage,
  MultiplayerRoomPlayer,
  MultiplayerRoomResponse,
} from "@owogg/contracts";
import {
  fetchMultiplayerRoomRoster,
  leaveMultiplayerRoom,
  setMultiplayerRoomReady,
  startMultiplayerRoom,
} from "./multiplayerRoomApi";
import {
  openMultiplayerLobbyRealtime,
  type MultiplayerLobbyRealtimeHandle,
} from "./multiplayerLobbyRealtime";
import { playMultiplayerLobbySound, type MultiplayerLobbySound } from "./multiplayerLobbySound";
import { ApiClientError } from "../../../lib/api/errors";

// A healthy lobby socket performs no recurring roster reads. These timers run only while the
// socket is disconnected, bounding D1 cost without hiding changes during a transport outage.
const DISCONNECTED_ROSTER_REFRESH_DELAYS_MS = [2_000, 2_000, 3_000, 5_000, 10_000, 15_000, 30_000];
const BACKGROUND_DISCONNECTED_ROSTER_REFRESH_MS = 30_000;
const LOBBY_INVALIDATION_DEBOUNCE_MS = 120;
const LOBBY_RATE_LIMIT_RECOVERY_MS = 3_000;
const LOBBY_RECONNECT_DELAYS_MS = [1_000, 3_000, 10_000, 30_000] as const;
const LOBBY_RECONNECT_STABLE_MS = 60_000;
const MAX_RENDERED_LOBBY_SLOTS = 16;

export function multiplayerLobbyCanStart(
  players: readonly MultiplayerRoomPlayer[],
  minPlayers: number,
): boolean {
  return (
    players.length >= minPlayers &&
    players.every((player) => player.role === "HOST" || player.status === "READY")
  );
}

export function multiplayerLobbySlotCount(maxPlayers: number, occupiedPlayers: number): number {
  return Math.min(Math.max(maxPlayers, occupiedPlayers), MAX_RENDERED_LOBBY_SLOTS);
}

export function multiplayerLobbyRosterSounds(
  previousParticipantIds: ReadonlySet<string> | null,
  players: readonly MultiplayerRoomPlayer[],
  selfParticipantId: string,
): readonly MultiplayerLobbySound[] {
  if (previousParticipantIds === null) return [];
  const currentParticipantIds = new Set(players.map((player) => player.participantId));
  const sounds: MultiplayerLobbySound[] = [];
  if (
    players.some(
      (player) =>
        player.participantId !== selfParticipantId &&
        !previousParticipantIds.has(player.participantId),
    )
  ) {
    sounds.push("JOIN");
  }
  if (
    [...previousParticipantIds].some(
      (participantId) =>
        participantId !== selfParticipantId && !currentParticipantIds.has(participantId),
    )
  ) {
    sounds.push("LEAVE");
  }
  return sounds;
}

export function applyMultiplayerLobbyChange(
  players: readonly MultiplayerRoomPlayer[],
  message: MultiplayerLobbyChangedMessage,
  missedEvents: boolean,
): readonly MultiplayerRoomPlayer[] | null {
  const change = message.change;
  if (missedEvents || change.kind !== "PARTICIPANT_READY") return null;
  let matched = false;
  const updated = players.map((player) => {
    if (player.participantId !== change.participantId) return player;
    matched = true;
    return player.status === change.status ? player : { ...player, status: change.status };
  });
  return matched ? updated : null;
}

export interface MultiplayerRoomLobbyProps {
  readonly title: string;
  readonly room: MultiplayerRoomResponse;
  readonly minPlayers: number;
  readonly shareValue: string;
  readonly frameClassName?: string;
  readonly frameStyle?: CSSProperties;
  readonly onRoomChange: (room: MultiplayerRoomResponse) => void;
  readonly onExit: () => void;
}

function messageFor(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "대기실 상태를 확인하지 못했습니다.";
}

function isTransientLobbySyncError(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    (error.code === "RATE_LIMITED" ||
      error.kind === "NetworkError" ||
      (error.status !== undefined && error.status >= 500))
  );
}

function PlayerSlot({
  player,
  slotIndex,
  isSelf,
}: {
  readonly player: MultiplayerRoomPlayer | undefined;
  readonly slotIndex: number;
  readonly isSelf: boolean;
}) {
  if (!player) {
    return (
      <div className="flex min-h-24 items-center gap-3 rounded-2xl border border-dashed border-border bg-surface/40 px-4 py-3 text-text-muted">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border bg-surface">
          <UserRound className="h-5 w-5" />
        </span>
        <span>
          <span className="block text-xs font-black uppercase tracking-wider">
            슬롯 {slotIndex + 1}
          </span>
          <span className="mt-1 block text-sm font-semibold">플레이어 대기 중</span>
        </span>
      </div>
    );
  }

  return (
    <div className="flex min-h-24 items-center gap-3 rounded-2xl border border-brand/25 bg-brand/5 px-4 py-3 shadow-sm">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/15 bg-surface text-sm font-black text-text-primary">
        {player.avatarUrl ? (
          <img
            src={player.avatarUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
          />
        ) : (
          player.nickname.slice(0, 1).toUpperCase()
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <strong className="truncate text-sm text-text-primary">{player.nickname}</strong>
          {isSelf && <span className="shrink-0 text-xs font-black text-brand-light">나</span>}
        </span>
        <span className="mt-1.5 flex flex-col items-start gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-xs font-bold text-text-secondary">
            {player.role === "HOST" ? <Crown className="h-3 w-3 text-amber-300" /> : null}
            {player.role === "HOST" ? "방장" : `플레이어 ${slotIndex + 1}`}
          </span>
          {player.role === "PLAYER" ? (
            player.status === "READY" ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 text-xs font-black text-emerald-300">
                <Check className="h-3 w-3" /> 준비 완료
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-amber-300/10 px-2 py-0.5 text-xs font-black text-amber-200">
                준비 미완료
              </span>
            )
          ) : null}
        </span>
      </span>
    </div>
  );
}

/** Shared parent-owned waiting room. Game iframes are mounted only after the host starts a match. */
export function MultiplayerRoomLobby({
  title,
  room,
  minPlayers,
  shareValue,
  frameClassName,
  frameStyle,
  onRoomChange,
  onExit,
}: MultiplayerRoomLobbyProps) {
  const [players, setPlayers] = useState<readonly MultiplayerRoomPlayer[]>([]);
  const [busy, setBusy] = useState<"START" | "LEAVE" | "READY" | null>(null);
  const [copied, setCopied] = useState<"CODE" | "LINK" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const playersRef = useRef<readonly MultiplayerRoomPlayer[]>([]);
  const previousParticipantIdsRef = useRef<ReadonlySet<string> | null>(null);
  const latestRoomRef = useRef(room);
  const onRoomChangeRef = useRef(onRoomChange);
  latestRoomRef.current = room;
  onRoomChangeRef.current = onRoomChange;
  const isHost = room.participant.role === "HOST";

  useEffect(() => {
    let active = true;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let invalidationTimer: ReturnType<typeof setTimeout> | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let reconnectStableTimer: ReturnType<typeof setTimeout> | undefined;
    let initialRosterTimer: ReturnType<typeof setTimeout> | undefined;
    let realtime: MultiplayerLobbyRealtimeHandle | undefined;
    let reconnectAttempt = 0;
    let disconnectedPollAttempt = 0;
    let realtimeConnected = false;
    let realtimeRevision = 0;
    let terminalRoom = false;
    let refreshInFlight = false;
    let refreshQueued = false;
    previousParticipantIdsRef.current = null;
    playersRef.current = [];

    const refreshOnce = async () => {
      const startedRevision = realtimeRevision;
      try {
        const roster = await fetchMultiplayerRoomRoster(room.instance.id);
        if (!active || roster.generation !== room.instance.generation) return;
        if (startedRevision !== realtimeRevision) {
          // A newer socket delta won the race against this HTTP snapshot. Reconcile again instead
          // of letting an older response visually undo an immediate ready-state change.
          refreshQueued = true;
          return;
        }
        const rosterSounds = multiplayerLobbyRosterSounds(
          previousParticipantIdsRef.current,
          roster.players,
          room.participant.id,
        );
        previousParticipantIdsRef.current = new Set(
          roster.players.map((player) => player.participantId),
        );
        rosterSounds.forEach(playMultiplayerLobbySound);
        playersRef.current = roster.players;
        setPlayers(roster.players);
        setError(null);
        if (roster.instance.status === "ACTIVE") {
          onRoomChangeRef.current({ ...latestRoomRef.current, instance: roster.instance });
          return;
        }
        if (["ABORTED", "CLOSED", "EXPIRED"].includes(roster.instance.status)) {
          terminalRoom = true;
          realtimeConnected = true;
          realtime?.close();
          realtime = undefined;
          if (pollTimer) {
            clearTimeout(pollTimer);
            pollTimer = undefined;
          }
          setError("대기실이 종료되었습니다. 새 방을 만들어 주세요.");
          return;
        }
      } catch (reason) {
        if (!active) return;
        if (isTransientLobbySyncError(reason)) {
          if (reason instanceof ApiClientError && reason.code === "RATE_LIMITED") {
            scheduleInvalidationRefresh(LOBBY_RATE_LIMIT_RECOVERY_MS);
          }
          return;
        }
        setError(messageFor(reason));
      }
    };
    const refresh = async () => {
      if (refreshInFlight) {
        refreshQueued = true;
        return;
      }
      refreshInFlight = true;
      try {
        do {
          refreshQueued = false;
          await refreshOnce();
        } while (active && refreshQueued);
      } finally {
        refreshInFlight = false;
      }
    };
    const disconnectedPoll = async () => {
      pollTimer = undefined;
      if (!active || realtimeConnected) return;
      await refresh();
      if (!active || realtimeConnected) return;
      pollTimer = setTimeout(
        () => void disconnectedPoll(),
        typeof document !== "undefined" && document.visibilityState === "hidden"
          ? BACKGROUND_DISCONNECTED_ROSTER_REFRESH_MS
          : DISCONNECTED_ROSTER_REFRESH_DELAYS_MS[
              Math.min(disconnectedPollAttempt++, DISCONNECTED_ROSTER_REFRESH_DELAYS_MS.length - 1)
            ],
      );
    };
    const scheduleDisconnectedPoll = () => {
      if (!active || terminalRoom || realtimeConnected || pollTimer) return;
      pollTimer = setTimeout(
        () => void disconnectedPoll(),
        typeof document !== "undefined" && document.visibilityState === "hidden"
          ? BACKGROUND_DISCONNECTED_ROSTER_REFRESH_MS
          : DISCONNECTED_ROSTER_REFRESH_DELAYS_MS[
              Math.min(disconnectedPollAttempt++, DISCONNECTED_ROSTER_REFRESH_DELAYS_MS.length - 1)
            ],
      );
    };
    function scheduleInvalidationRefresh(delay = LOBBY_INVALIDATION_DEBOUNCE_MS) {
      if (!active || invalidationTimer) return;
      invalidationTimer = setTimeout(() => {
        invalidationTimer = undefined;
        void refresh();
      }, delay);
    }
    const connectRealtime = () => {
      if (!active || terminalRoom) return;
      try {
        realtime = openMultiplayerLobbyRealtime({
          instanceId: room.instance.id,
          generation: room.instance.generation,
          onConnected: () => {
            realtimeConnected = true;
            disconnectedPollAttempt = 0;
            if (initialRosterTimer) {
              clearTimeout(initialRosterTimer);
              initialRosterTimer = undefined;
            }
            if (pollTimer) {
              clearTimeout(pollTimer);
              pollTimer = undefined;
            }
            // Reconcile once after the authenticated socket is established to close the small
            // race between the initial roster snapshot and WebSocket admission.
            void refresh();
            // Do not reset backoff for a socket that opens and immediately drops. Apart from
            // avoiding a reconnect storm, this keeps the edge's ten-connects-per-minute limiter
            // available for genuine tab/network recovery. A minute-long connection is considered
            // stable and earns the fast first retry again.
            if (reconnectStableTimer) clearTimeout(reconnectStableTimer);
            reconnectStableTimer = setTimeout(() => {
              reconnectStableTimer = undefined;
              reconnectAttempt = 0;
            }, LOBBY_RECONNECT_STABLE_MS);
          },
          onChanged: (message, missedEvents) => {
            realtimeRevision += 1;
            const updated = applyMultiplayerLobbyChange(playersRef.current, message, missedEvents);
            if (updated) {
              playersRef.current = updated;
              setPlayers(updated);
              setError(null);
              return;
            }
            scheduleInvalidationRefresh();
          },
          onDisconnected: () => {
            realtime = undefined;
            realtimeConnected = false;
            if (initialRosterTimer) {
              clearTimeout(initialRosterTimer);
              initialRosterTimer = undefined;
            }
            if (reconnectStableTimer) {
              clearTimeout(reconnectStableTimer);
              reconnectStableTimer = undefined;
            }
            // A host leave/room abort can close all DO sockets before a final invalidation frame.
            // Reconcile once immediately so peers do not wait for the slow resilience poll.
            scheduleInvalidationRefresh();
            scheduleDisconnectedPoll();
            if (!active || terminalRoom || reconnectTimer) return;
            const delay =
              LOBBY_RECONNECT_DELAYS_MS[
                Math.min(reconnectAttempt, LOBBY_RECONNECT_DELAYS_MS.length - 1)
              ];
            reconnectAttempt += 1;
            reconnectTimer = setTimeout(() => {
              reconnectTimer = undefined;
              connectRealtime();
            }, delay);
          },
        });
      } catch {
        realtimeConnected = false;
        scheduleDisconnectedPoll();
        if (!active || terminalRoom || reconnectTimer) return;
        const delay =
          LOBBY_RECONNECT_DELAYS_MS[
            Math.min(reconnectAttempt, LOBBY_RECONNECT_DELAYS_MS.length - 1)
          ];
        reconnectAttempt += 1;
        reconnectTimer = setTimeout(() => {
          reconnectTimer = undefined;
          connectRealtime();
        }, delay);
      }
    };

    // Prefer one roster read after authenticated socket admission. A short fallback prevents a
    // browser/proxy handshake that stays pending from leaving the lobby visually empty.
    initialRosterTimer = setTimeout(() => {
      initialRosterTimer = undefined;
      void refresh();
    }, 2_000);
    connectRealtime();
    return () => {
      active = false;
      realtime?.close();
      if (pollTimer) clearTimeout(pollTimer);
      if (invalidationTimer) clearTimeout(invalidationTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (reconnectStableTimer) clearTimeout(reconnectStableTimer);
      if (initialRosterTimer) clearTimeout(initialRosterTimer);
    };
  }, [room.instance.generation, room.instance.id, room.participant.id]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 1_800);
    return () => clearTimeout(timer);
  }, [copied]);

  const slots = useMemo(() => {
    const slotCount = multiplayerLobbySlotCount(room.instance.maxPlayers, players.length);
    const bySeat = new Map(players.map((player) => [player.seatIndex, player]));
    return Array.from({ length: slotCount }, (_, slotIndex) => bySeat.get(slotIndex));
  }, [players, room.instance.maxPlayers]);
  const allReady = multiplayerLobbyCanStart(players, minPlayers);
  const hasMinimumPlayers = players.length >= minPlayers;
  const selfPlayer = players.find((player) => player.participantId === room.participant.id);
  const selfReady = (selfPlayer?.status ?? room.participant.status) === "READY";

  const copyValue = useCallback(
    async (kind: "CODE" | "LINK") => {
      try {
        await navigator.clipboard.writeText(
          kind === "CODE" ? room.instance.publicCode : shareValue,
        );
        setCopied(kind);
      } catch {
        setError("클립보드에 복사하지 못했습니다.");
      }
    },
    [room.instance.publicCode, shareValue],
  );

  const start = useCallback(async () => {
    if (!isHost || !allReady || busy) return;
    setBusy("START");
    setError(null);
    try {
      const started = await startMultiplayerRoom({
        instanceId: room.instance.id,
        expectedGeneration: room.instance.generation,
      });
      onRoomChange(started);
    } catch (reason) {
      setError(messageFor(reason));
      setBusy(null);
    }
  }, [allReady, busy, isHost, onRoomChange, room.instance.generation, room.instance.id]);

  const toggleReady = useCallback(async () => {
    if (isHost || busy) return;
    const nextReady = !selfReady;
    setBusy("READY");
    setError(null);
    try {
      const updated = await setMultiplayerRoomReady({
        instanceId: room.instance.id,
        expectedGeneration: room.instance.generation,
        ready: nextReady,
      });
      const updatedStatus: MultiplayerRoomPlayer["status"] =
        updated.participant.status === "READY" ? "READY" : "JOINED";
      setPlayers((current) => {
        const next = current.map((player) =>
          player.participantId === updated.participant.id
            ? { ...player, status: updatedStatus }
            : player,
        );
        playersRef.current = next;
        return next;
      });
      onRoomChange(updated);
    } catch (reason) {
      setError(messageFor(reason));
    } finally {
      setBusy(null);
    }
  }, [busy, isHost, onRoomChange, room.instance.generation, room.instance.id, selfReady]);

  const leave = useCallback(async () => {
    if (busy) return;
    setBusy("LEAVE");
    setError(null);
    try {
      await leaveMultiplayerRoom({
        instanceId: room.instance.id,
        expectedGeneration: room.instance.generation,
      });
      onExit();
    } catch (reason) {
      setError(messageFor(reason));
      setBusy(null);
    }
  }, [busy, onExit, room.instance.generation, room.instance.id]);

  return (
    <div
      className={`${frameClassName ?? ""} flex w-full items-center justify-center bg-[#09090b] p-4 sm:p-6`}
      style={frameStyle}
    >
      <section className="w-full max-w-5xl rounded-3xl border border-border bg-surface-raised p-5 shadow-2xl sm:p-7">
        <div className="flex flex-col gap-5 border-b border-border pb-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="xl:max-w-md">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-brand">
              OWOGG Multiplayer Lobby
            </p>
            <h3 className="mt-2 text-2xl font-black text-text-primary">{title}</h3>
            <p className="mt-2 text-sm text-text-secondary">
              플레이어는 입장 시 기본으로 준비 완료됩니다. 방장은 별도 준비 없이 경기 시작으로
              참가를 확정합니다.
            </p>
          </div>
          <div className="flex w-full min-w-0 flex-nowrap items-center gap-2 overflow-x-auto pb-1 xl:w-[32rem] xl:shrink-0 xl:overflow-visible xl:pb-0">
            <span className="flex min-h-11 min-w-36 flex-1 items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2">
              <span className="text-[11px] font-black uppercase tracking-wider text-text-muted">
                방 코드
              </span>
              <code className="min-w-0 truncate text-sm font-black tracking-wide text-text-primary">
                {room.instance.publicCode}
              </code>
            </span>
            <button
              type="button"
              onClick={() => void copyValue("CODE")}
              className="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-xl border border-border px-3 py-2 text-sm font-black text-text-primary hover:bg-surface-overlay"
            >
              {copied === "CODE" ? (
                <Check className="h-4 w-4 text-emerald-300" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              {copied === "CODE" ? "복사됨" : "코드 복사"}
            </button>
            <button
              type="button"
              onClick={() => void copyValue("LINK")}
              className="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-xl border border-brand/40 bg-brand/10 px-3 py-2 text-sm font-black text-brand-light hover:bg-brand/20"
            >
              {copied === "LINK" ? (
                <Check className="h-4 w-4 text-emerald-300" />
              ) : (
                <Link2 className="h-4 w-4" />
              )}
              {copied === "LINK" ? "복사됨" : "링크 복사"}
            </button>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 text-sm font-bold text-text-secondary">
            <UsersRound className="h-5 w-5 text-brand-light" />
            <span>
              {players.length}/{room.instance.maxPlayers}명 · 시작 최소 {minPlayers}명
            </span>
          </div>
          <span
            role="status"
            className={`rounded-full px-3 py-1.5 text-xs font-black ${
              allReady ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-300/10 text-amber-200"
            }`}
          >
            {allReady
              ? "경기 시작 가능"
              : hasMinimumPlayers
                ? "플레이어 준비를 기다리는 중"
                : "플레이어를 기다리는 중"}
          </span>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {slots.map((player, index) => (
            <PlayerSlot
              key={player?.participantId ?? `empty-${index}`}
              player={player}
              slotIndex={index}
              isSelf={player?.participantId === room.participant.id}
            />
          ))}
        </div>

        <div className="mt-5 rounded-2xl border border-border bg-surface p-4">
          <div className="flex gap-3">
            {isHost ? (
              <button
                type="button"
                disabled={!allReady || busy !== null}
                onClick={() => void start()}
                className="inline-flex min-h-12 min-w-0 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl bg-brand px-5 text-base font-black text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Play className="h-5 w-5 fill-current" />
                {busy === "START" ? "경기 시작 중" : "경기 시작"}
              </button>
            ) : (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void toggleReady()}
                aria-pressed={selfReady}
                className={`inline-flex min-h-12 min-w-0 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border px-5 text-base font-black transition-colors disabled:cursor-wait disabled:opacity-55 ${
                  selfReady
                    ? "border-emerald-300/35 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20"
                    : "border-brand bg-brand text-white hover:bg-brand-hover"
                }`}
              >
                <Check className="h-5 w-5" />
                {busy === "READY" ? "변경 중" : selfReady ? "준비 취소" : "준비 완료"}
              </button>
            )}
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void leave()}
              className="inline-flex min-h-12 min-w-28 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-red-300/25 bg-red-400/5 px-4 text-base font-black text-red-300 transition-colors hover:bg-red-400/15 disabled:cursor-wait disabled:opacity-60"
            >
              <LogOut className="h-5 w-5" />
              {busy === "LEAVE" ? "나가는 중" : "나가기"}
            </button>
          </div>
          {error && (
            <p role="alert" className="mt-3 text-center text-sm font-semibold text-accent-red">
              {error}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
