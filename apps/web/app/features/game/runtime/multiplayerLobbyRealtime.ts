import {
  MULTIPLAYER_HEARTBEAT_REQUEST,
  MULTIPLAYER_HEARTBEAT_RESPONSE,
  MULTIPLAYER_LOBBY_WEBSOCKET_PROTOCOL,
  MultiplayerLobbyConnectedMessageSchema,
  MultiplayerLobbyChangedMessageSchema,
  type MultiplayerLobbyChangedMessage,
} from "@owogg/contracts";
import { API_URL } from "../../../lib/api/config.js";

const INSTANCE_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const HEARTBEAT_INTERVAL_MS = 15_000;

export interface MultiplayerLobbySocketLike {
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

export interface MultiplayerLobbyRealtimeDependencies {
  readonly apiUrl?: string;
  readonly createSocket?: (url: string, protocol: string) => MultiplayerLobbySocketLike;
  readonly setInterval?: (callback: () => void, delay: number) => ReturnType<typeof setInterval>;
  readonly clearInterval?: (handle: ReturnType<typeof setInterval>) => void;
}

export interface MultiplayerLobbyRealtimeInput {
  readonly instanceId: string;
  readonly generation: number;
  readonly onConnected?: () => void;
  readonly onChanged: (message: MultiplayerLobbyChangedMessage, missedEvents: boolean) => void;
  readonly onDisconnected: () => void;
}

export interface MultiplayerLobbyRealtimeHandle {
  close(): void;
}

/** Builds a credential-free lobby socket URL on the configured API origin. Authentication stays
 * in the API session cookie and is never copied into the URL or a client-readable message. */
export function multiplayerLobbySocketUrl(apiUrl: string, instanceId: string): string {
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
    api.hash !== ""
  ) {
    throw new TypeError("invalid multiplayer API origin");
  }
  if (!INSTANCE_ID_PATTERN.test(instanceId)) {
    throw new TypeError("invalid multiplayer instance id");
  }

  const socket = new URL(
    `/api/multiplayer/instances/${encodeURIComponent(instanceId)}/lobby-socket`,
    api.origin,
  );
  socket.protocol = api.protocol === "https:" ? "wss:" : "ws:";
  return socket.toString();
}

function createBrowserSocket(url: string, protocol: string): MultiplayerLobbySocketLike {
  return new WebSocket(url, protocol);
}

/** Opens the parent-only lobby channel. Ready-state deltas can repaint immediately; identity and
 * full-roster reconciliation remain behind the authenticated HTTP endpoint. */
export function openMultiplayerLobbyRealtime(
  input: MultiplayerLobbyRealtimeInput,
  dependencies: MultiplayerLobbyRealtimeDependencies = {},
): MultiplayerLobbyRealtimeHandle {
  if (!Number.isSafeInteger(input.generation) || input.generation <= 0) {
    throw new TypeError("invalid multiplayer generation");
  }
  const url = multiplayerLobbySocketUrl(dependencies.apiUrl ?? API_URL, input.instanceId);
  const socket = (dependencies.createSocket ?? createBrowserSocket)(
    url,
    MULTIPLAYER_LOBBY_WEBSOCKET_PROTOCOL,
  );
  const startInterval = dependencies.setInterval ?? setInterval;
  const stopInterval = dependencies.clearInterval ?? clearInterval;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let stopped = false;
  let disconnected = false;
  let lastSequence = 0;

  const clearHeartbeat = () => {
    if (heartbeat === undefined) return;
    stopInterval(heartbeat);
    heartbeat = undefined;
  };
  const signalDisconnected = () => {
    if (stopped || disconnected) return;
    disconnected = true;
    clearHeartbeat();
    input.onDisconnected();
  };
  const onOpen = () => {
    if (stopped) return;
    if (socket.protocol !== MULTIPLAYER_LOBBY_WEBSOCKET_PROTOCOL) {
      try {
        socket.close(1002, "invalid multiplayer lobby protocol");
      } finally {
        signalDisconnected();
      }
      return;
    }
    input.onConnected?.();
    heartbeat = startInterval(() => {
      if (socket.readyState !== 1) return;
      try {
        socket.send(MULTIPLAYER_HEARTBEAT_REQUEST);
      } catch {
        signalDisconnected();
      }
    }, HEARTBEAT_INTERVAL_MS);
  };
  const onMessage = (event: { readonly data?: unknown }) => {
    if (stopped || typeof event.data !== "string") return;
    if (event.data === MULTIPLAYER_HEARTBEAT_RESPONSE) return;
    let decoded: unknown;
    try {
      decoded = JSON.parse(event.data);
    } catch {
      return;
    }
    const connected = MultiplayerLobbyConnectedMessageSchema.safeParse(decoded);
    if (
      connected.success &&
      connected.data.instanceId === input.instanceId &&
      connected.data.generation === input.generation
    ) {
      lastSequence = Math.max(lastSequence, connected.data.sequence);
      return;
    }
    const parsed = MultiplayerLobbyChangedMessageSchema.safeParse(decoded);
    if (
      !parsed.success ||
      parsed.data.instanceId !== input.instanceId ||
      parsed.data.generation !== input.generation ||
      parsed.data.sequence <= lastSequence
    ) {
      return;
    }
    const missedEvents =
      lastSequence === 0 ? parsed.data.sequence !== 1 : parsed.data.sequence !== lastSequence + 1;
    lastSequence = parsed.data.sequence;
    input.onChanged(parsed.data, missedEvents);
  };
  const onClose = () => signalDisconnected();
  const onError = () => signalDisconnected();

  socket.addEventListener("open", onOpen);
  socket.addEventListener("message", onMessage);
  socket.addEventListener("close", onClose);
  socket.addEventListener("error", onError);

  return {
    close() {
      if (stopped) return;
      stopped = true;
      clearHeartbeat();
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", onClose);
      socket.removeEventListener("error", onError);
      if (socket.readyState < 2) socket.close(1000, "lobby closed");
    },
  };
}
