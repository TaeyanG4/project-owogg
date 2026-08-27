import {
  MULTIPLAYER_HEARTBEAT_REQUEST,
  MULTIPLAYER_HEARTBEAT_RESPONSE,
  MULTIPLAYER_LOBBY_SIGNAL_PROTOCOL,
  MultiplayerLobbySignalChangedMessageSchema,
  MultiplayerLobbySignalConnectedMessageSchema,
  type MultiplayerLobbySignalChange,
} from "@owogg/contracts";
import { API_URL } from "../../../lib/api/config.js";

const INSTANCE_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const SOCKET_OPEN = 1;
const SOCKET_CLOSING = 2;
const ADMISSION_TIMEOUT_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 120_000;
const RECONNECT_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000] as const;
const RECOVERY_REFRESH_DELAYS_MS = [0, 15_000, 30_000, 60_000, 120_000] as const;

export const MULTIPLAYER_LOBBY_SIGNAL_INITIAL_FALLBACK_MS = 1_500;
export const MULTIPLAYER_LOBBY_SIGNAL_RECONCILE_MS = 300_000;

export interface MultiplayerLobbySignalSocketLike {
  readonly protocol: string;
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: "open" | "message" | "close" | "error",
    listener: (event: { readonly data?: unknown }) => void,
  ): void;
  removeEventListener(
    type: "open" | "message" | "close" | "error",
    listener: (event: { readonly data?: unknown }) => void,
  ): void;
}

export interface MultiplayerLobbySignalDependencies {
  readonly apiUrl?: string;
  readonly createSocket?: (url: string, protocol: string) => MultiplayerLobbySignalSocketLike;
  readonly setHeartbeat?: (callback: () => void, delay: number) => ReturnType<typeof setInterval>;
  readonly clearHeartbeat?: (timer: ReturnType<typeof setInterval>) => void;
}

export interface MultiplayerLobbySignalInput {
  readonly instanceId: string;
  readonly generation: number;
  readonly onConnected: () => void;
  readonly onChanged: (change: MultiplayerLobbySignalChange) => void;
  readonly onDisconnected: () => void;
}

export interface MultiplayerLobbySignalHandle {
  close(): void;
}

export function multiplayerLobbySignalSocketUrl(apiUrl: string, instanceId: string): string {
  let api: URL;
  try {
    api = new URL(apiUrl);
  } catch {
    throw new TypeError("invalid multiplayer API origin");
  }
  if (
    (api.protocol !== "http:" && api.protocol !== "https:") ||
    api.username !== "" ||
    api.password !== "" ||
    api.pathname !== "/" ||
    api.search !== "" ||
    api.hash !== "" ||
    !INSTANCE_ID_PATTERN.test(instanceId)
  ) {
    throw new TypeError("invalid multiplayer lobby signal address");
  }
  const socket = new URL(
    `/api/multiplayer/instances/${encodeURIComponent(instanceId)}/lobby-signal`,
    api.origin,
  );
  socket.protocol = api.protocol === "https:" ? "wss:" : "ws:";
  return socket.toString();
}

export function multiplayerLobbySignalReconnectDelay(attempt: number): number {
  const index = Math.min(Math.max(0, Math.trunc(attempt)), RECONNECT_DELAYS_MS.length - 1);
  return RECONNECT_DELAYS_MS[index] ?? 120_000;
}

export function multiplayerLobbyRecoveryRefreshDelay(attempt: number): number {
  const index = Math.min(Math.max(0, Math.trunc(attempt)), RECOVERY_REFRESH_DELAYS_MS.length - 1);
  return RECOVERY_REFRESH_DELAYS_MS[index] ?? 120_000;
}

function createBrowserSocket(url: string, protocol: string): MultiplayerLobbySignalSocketLike {
  return new WebSocket(url, protocol);
}

/** Opens one authenticated, parent-only, hibernatable signal channel. It never carries roster
 * identity and never writes game state; HTTP remains the mutation and reconciliation path. */
export function openMultiplayerLobbySignal(
  input: MultiplayerLobbySignalInput,
  dependencies: MultiplayerLobbySignalDependencies = {},
): MultiplayerLobbySignalHandle {
  if (!Number.isSafeInteger(input.generation) || input.generation <= 0) {
    throw new TypeError("invalid multiplayer generation");
  }
  const socket = (dependencies.createSocket ?? createBrowserSocket)(
    multiplayerLobbySignalSocketUrl(dependencies.apiUrl ?? API_URL, input.instanceId),
    MULTIPLAYER_LOBBY_SIGNAL_PROTOCOL,
  );
  const setHeartbeat = dependencies.setHeartbeat ?? setInterval;
  const clearHeartbeat = dependencies.clearHeartbeat ?? clearInterval;
  let stopped = false;
  let disconnected = false;
  let connected = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let admissionTimer: ReturnType<typeof setTimeout> | undefined;

  const stopHeartbeat = () => {
    if (heartbeat === undefined) return;
    clearHeartbeat(heartbeat);
    heartbeat = undefined;
  };
  const signalDisconnected = () => {
    if (stopped || disconnected) return;
    disconnected = true;
    if (admissionTimer !== undefined) {
      clearTimeout(admissionTimer);
      admissionTimer = undefined;
    }
    stopHeartbeat();
    input.onDisconnected();
  };
  const onOpen = () => {
    if (stopped || socket.protocol === MULTIPLAYER_LOBBY_SIGNAL_PROTOCOL) return;
    socket.close(1002, "invalid multiplayer lobby signal protocol");
    signalDisconnected();
  };
  const onMessage = (event: { readonly data?: unknown }) => {
    if (stopped || disconnected || typeof event.data !== "string") return;
    if (event.data === MULTIPLAYER_HEARTBEAT_RESPONSE) return;
    let decoded: unknown;
    try {
      decoded = JSON.parse(event.data);
    } catch {
      return;
    }
    const admitted = MultiplayerLobbySignalConnectedMessageSchema.safeParse(decoded);
    if (
      admitted.success &&
      admitted.data.instanceId === input.instanceId &&
      admitted.data.generation === input.generation
    ) {
      if (connected) return;
      connected = true;
      if (admissionTimer !== undefined) {
        clearTimeout(admissionTimer);
        admissionTimer = undefined;
      }
      heartbeat = setHeartbeat(() => {
        if (socket.readyState !== SOCKET_OPEN) {
          signalDisconnected();
          return;
        }
        try {
          socket.send(MULTIPLAYER_HEARTBEAT_REQUEST);
        } catch {
          signalDisconnected();
        }
      }, HEARTBEAT_INTERVAL_MS);
      input.onConnected();
      return;
    }
    const changed = MultiplayerLobbySignalChangedMessageSchema.safeParse(decoded);
    if (
      !connected ||
      !changed.success ||
      changed.data.instanceId !== input.instanceId ||
      changed.data.generation !== input.generation
    ) {
      return;
    }
    input.onChanged(changed.data.change);
  };
  const onClose = () => signalDisconnected();
  const onError = () => signalDisconnected();

  socket.addEventListener("open", onOpen);
  socket.addEventListener("message", onMessage);
  socket.addEventListener("close", onClose);
  socket.addEventListener("error", onError);
  admissionTimer = setTimeout(() => {
    if (stopped || disconnected || connected) return;
    socket.close(1013, "lobby signal admission timed out");
    signalDisconnected();
  }, ADMISSION_TIMEOUT_MS);

  return {
    close() {
      if (stopped) return;
      stopped = true;
      if (admissionTimer !== undefined) {
        clearTimeout(admissionTimer);
        admissionTimer = undefined;
      }
      stopHeartbeat();
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", onClose);
      socket.removeEventListener("error", onError);
      if (socket.readyState < SOCKET_CLOSING) socket.close(1000, "lobby signal closed");
    },
  };
}
