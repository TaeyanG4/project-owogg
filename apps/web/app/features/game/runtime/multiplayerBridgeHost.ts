import {
  MULTIPLAYER_BRIDGE_PROTOCOL_VERSION,
  MULTIPLAYER_HOST_MAX_PAYLOAD_BYTES,
  MULTIPLAYER_PLAYER_CONNECTION_CHANGED_EVENT,
  MULTIPLAYER_REMATCH_CHANGED_EVENT,
  parseGameToHostMultiplayerMessage,
  parseHostToGameMultiplayerMessage,
  type HostToGameMultiplayerMessage,
  type MultiInitMessage,
  type MultiplayerAbortCode,
  type MultiplayerDisconnectCode,
} from "@owogg/game-sdk/bridge";
import { MULTIPLAYER_HEARTBEAT_REQUEST, MULTIPLAYER_HEARTBEAT_RESPONSE } from "@owogg/contracts";

export interface MultiplayerBridgeIframeWindowLike {
  postMessage(message: unknown, targetOrigin: string, transfer: Transferable[]): void;
}

interface SocketMessageEventLike {
  readonly data: unknown;
}

interface SocketCloseEventLike {
  readonly code: number;
  readonly reason?: string;
}

export interface MultiplayerBridgeSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open" | "error", listener: () => void): void;
  addEventListener(type: "message", listener: (event: SocketMessageEventLike) => void): void;
  addEventListener(type: "close", listener: (event: SocketCloseEventLike) => void): void;
  removeEventListener(type: "open" | "error", listener: () => void): void;
  removeEventListener(type: "message", listener: (event: SocketMessageEventLike) => void): void;
  removeEventListener(type: "close", listener: (event: SocketCloseEventLike) => void): void;
}

export type MultiplayerParentConnectionState =
  | { readonly status: "CONNECTING" }
  | { readonly status: "CONNECTED"; readonly connectionGeneration: number }
  | { readonly status: "DISCONNECTED"; readonly code: MultiplayerDisconnectCode }
  | { readonly status: "TERMINAL_PENDING" }
  | { readonly status: "TERMINAL_COMMITTED"; readonly result: unknown }
  | { readonly status: "ABORTED"; readonly code: MultiplayerAbortCode };

export type MultiplayerPlayerConnectionState =
  | {
      readonly participantId: string;
      readonly status: "CONNECTED";
      readonly reconnectDeadlineAt: null;
    }
  | {
      readonly participantId: string;
      readonly status: "RECONNECTING";
      readonly reconnectDeadlineAt: string;
    }
  | {
      readonly participantId: string;
      readonly status: "LEFT" | "TIMED_OUT";
      readonly reconnectDeadlineAt: null;
    };

export interface MultiplayerBridgeHostCallbacks {
  onReady?: () => void;
  onLeave?: () => void;
  onConnectionState?: (state: MultiplayerParentConnectionState) => void;
  onTerminalCommitted?: (result: unknown) => void;
  /** Parent-only hint to refetch rematch consent. It is never forwarded into the game iframe. */
  onRematchChange?: () => void;
  /** Server-authoritative peer connectivity used only by the trusted parent room chrome. */
  onPlayerConnectionChange?: (state: MultiplayerPlayerConnectionState) => void;
  onProtocolDrop?: (direction: "GAME_TO_HOST" | "SERVER_TO_HOST") => void;
}

export interface MultiplayerBridgeHost {
  /** Sends the authenticated parent's explicit leave intent without exposing the socket to UI. */
  leave(): boolean;
  /** Idempotently releases the MessagePort, socket listeners, and parent-owned WebSocket. */
  close(): void;
}

export interface MultiplayerBridgeHostDependencies {
  readonly setInterval?: (
    callback: () => void,
    intervalMs: number,
  ) => ReturnType<typeof setInterval>;
  readonly clearInterval?: (handle: ReturnType<typeof setInterval>) => void;
}

const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;
const MAX_QUEUED_GAME_MESSAGES = 32;
const HEARTBEAT_INTERVAL_MS = 30_000;
const textEncoder = new TextEncoder();

function hasServerSequence(
  message: HostToGameMultiplayerMessage,
): message is HostToGameMultiplayerMessage & { readonly serverSeq: number } {
  return "serverSeq" in message;
}

function parsePlayerConnectionState(payload: unknown): MultiplayerPlayerConnectionState | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const source = payload as Record<string, unknown>;
  const keys = Object.keys(source);
  if (
    keys.length !== 3 ||
    !keys.every((key) => ["participantId", "status", "reconnectDeadlineAt"].includes(key)) ||
    typeof source.participantId !== "string" ||
    !/^[A-Za-z0-9_-]{8,128}$/.test(source.participantId)
  ) {
    return null;
  }
  if (source.status === "RECONNECTING") {
    return typeof source.reconnectDeadlineAt === "string" &&
      Number.isFinite(Date.parse(source.reconnectDeadlineAt))
      ? {
          participantId: source.participantId,
          status: "RECONNECTING",
          reconnectDeadlineAt: source.reconnectDeadlineAt,
        }
      : null;
  }
  if (
    (source.status === "CONNECTED" || source.status === "LEFT" || source.status === "TIMED_OUT") &&
    source.reconnectDeadlineAt === null
  ) {
    return {
      participantId: source.participantId,
      status: source.status,
      reconnectDeadlineAt: null,
    };
  }
  return null;
}

function closeCodeToDisconnectCode(code: number): MultiplayerDisconnectCode {
  if (code === 4001) return "REPLACED_BY_NEW_CONNECTION";
  if (code === 4003) return "AUTH_EXPIRED";
  if (code === 4008) return "SLOW_CONSUMER";
  if (code === 1000) return "LEFT";
  return "NETWORK_LOST";
}

/**
 * Parent-only multiplayer transport boundary. The browser parent owns the authenticated ticket
 * request and WebSocket; the sandboxed game receives only a sanitized MULTI_INIT, canonical
 * server projections, and a private MessagePort. No URL, cookie, global user id, or ticket enters
 * the iframe.
 */
export function createMultiplayerBridgeHost(
  iframeWindow: MultiplayerBridgeIframeWindowLike,
  socket: MultiplayerBridgeSocketLike,
  bootstrapInput: MultiInitMessage,
  callbacks: MultiplayerBridgeHostCallbacks = {},
  dependencies: MultiplayerBridgeHostDependencies = {},
): MultiplayerBridgeHost {
  const parsedBootstrap = parseHostToGameMultiplayerMessage(bootstrapInput);
  if (!parsedBootstrap || parsedBootstrap.type !== "MULTI_INIT") {
    throw new RangeError("invalid multiplayer iframe bootstrap");
  }
  const bootstrap = parsedBootstrap;
  const channel = new MessageChannel();
  const queuedGameMessages: string[] = [];
  let closed = false;
  let ready = false;
  let left = false;
  let disconnectNotified = false;
  let terminalCommitted = false;
  let aborted = false;
  let lastClientSeq = 0;
  let lastServerSeq = -1;
  let lastConnectionGeneration = 0;
  const scheduleInterval = dependencies.setInterval ?? setInterval;
  const cancelInterval = dependencies.clearInterval ?? clearInterval;

  function notifyDrop(direction: "GAME_TO_HOST" | "SERVER_TO_HOST") {
    callbacks.onProtocolDrop?.(direction);
  }

  function sendToSocket(message: unknown): void {
    const encoded = JSON.stringify(message);
    if (socket.readyState === SOCKET_OPEN) {
      try {
        socket.send(encoded);
      } catch {
        // readyState can change between the check and send(). A reconnect uses a new connection
        // generation, so retaining this old-generation intent for retry would be unsafe.
        notifyDrop("GAME_TO_HOST");
      }
      return;
    }
    if (
      socket.readyState === SOCKET_CONNECTING &&
      queuedGameMessages.length < MAX_QUEUED_GAME_MESSAGES
    ) {
      queuedGameMessages.push(encoded);
      return;
    }
    notifyDrop("GAME_TO_HOST");
  }

  function flushQueuedGameMessages(): void {
    if (closed || socket.readyState !== SOCKET_OPEN) return;
    for (const encoded of queuedGameMessages.splice(0)) {
      try {
        socket.send(encoded);
      } catch {
        notifyDrop("GAME_TO_HOST");
        break;
      }
    }
  }

  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  const stopHeartbeat = () => {
    if (heartbeatTimer === undefined) return;
    cancelInterval(heartbeatTimer);
    heartbeatTimer = undefined;
  };
  heartbeatTimer = scheduleInterval(() => {
    if (closed || terminalCommitted || aborted || left || socket.readyState !== SOCKET_OPEN) return;
    try {
      socket.send(MULTIPLAYER_HEARTBEAT_REQUEST);
    } catch {
      notifyDrop("GAME_TO_HOST");
    }
  }, HEARTBEAT_INTERVAL_MS);

  channel.port1.onmessage = (event: MessageEvent) => {
    if (closed) return;
    const message = parseGameToHostMultiplayerMessage(event.data);
    if (!message || message.generation !== bootstrap.generation || left) {
      notifyDrop("GAME_TO_HOST");
      return;
    }

    if (message.type === "MULTI_ACTION" || message.type === "MULTI_INPUT") {
      if (message.clientSeq !== lastClientSeq + 1) {
        notifyDrop("GAME_TO_HOST");
        return;
      }
      lastClientSeq = message.clientSeq;
    } else if (message.type === "MULTI_READY") {
      if (ready) {
        notifyDrop("GAME_TO_HOST");
        return;
      }
      ready = true;
      callbacks.onReady?.();
    } else if (message.type === "MULTI_LEAVE") {
      left = true;
      sendToSocket(message);
      stopHeartbeat();
      callbacks.onLeave?.();
      return;
    }
    sendToSocket(message);
  };
  channel.port1.start();

  const onOpen = () => flushQueuedGameMessages();
  const onMessage = (event: SocketMessageEventLike) => {
    if (closed || typeof event.data !== "string") {
      if (!closed) notifyDrop("SERVER_TO_HOST");
      return;
    }
    if (textEncoder.encode(event.data).byteLength > MULTIPLAYER_HOST_MAX_PAYLOAD_BYTES) {
      notifyDrop("SERVER_TO_HOST");
      return;
    }
    if (event.data === MULTIPLAYER_HEARTBEAT_RESPONSE) return;
    let decoded: unknown;
    try {
      decoded = JSON.parse(event.data);
    } catch {
      notifyDrop("SERVER_TO_HOST");
      return;
    }
    const message = parseHostToGameMultiplayerMessage(decoded);
    if (!message || message.type === "MULTI_INIT" || message.generation !== bootstrap.generation) {
      notifyDrop("SERVER_TO_HOST");
      return;
    }
    if (hasServerSequence(message)) {
      if (message.serverSeq <= lastServerSeq) {
        notifyDrop("SERVER_TO_HOST");
        return;
      }
      lastServerSeq = message.serverSeq;
    }
    if (message.type === "MULTI_EVENT" && message.name === MULTIPLAYER_REMATCH_CHANGED_EVENT) {
      callbacks.onRematchChange?.();
      return;
    }
    if (
      message.type === "MULTI_EVENT" &&
      message.name === MULTIPLAYER_PLAYER_CONNECTION_CHANGED_EVENT
    ) {
      const presence = parsePlayerConnectionState(message.payload);
      if (!presence) {
        notifyDrop("SERVER_TO_HOST");
        return;
      }
      callbacks.onPlayerConnectionChange?.(presence);
      return;
    }
    if (message.type === "MULTI_CONNECTED") {
      if (message.connectionGeneration <= lastConnectionGeneration) {
        notifyDrop("SERVER_TO_HOST");
        return;
      }
      lastConnectionGeneration = message.connectionGeneration;
      callbacks.onConnectionState?.({
        status: "CONNECTED",
        connectionGeneration: message.connectionGeneration,
      });
    } else if (message.type === "MULTI_DISCONNECTED") {
      disconnectNotified = true;
      callbacks.onConnectionState?.({ status: "DISCONNECTED", code: message.code });
    } else if (message.type === "MULTI_TERMINAL_PENDING") {
      callbacks.onConnectionState?.({ status: "TERMINAL_PENDING" });
    } else if (message.type === "MULTI_TERMINAL_COMMITTED") {
      if (terminalCommitted) {
        notifyDrop("SERVER_TO_HOST");
        return;
      }
      terminalCommitted = true;
      stopHeartbeat();
      callbacks.onConnectionState?.({ status: "TERMINAL_COMMITTED", result: message.result });
      callbacks.onTerminalCommitted?.(message.result);
    } else if (message.type === "MULTI_ABORTED") {
      aborted = true;
      stopHeartbeat();
      callbacks.onConnectionState?.({ status: "ABORTED", code: message.code });
    }
    channel.port1.postMessage(message);
  };
  const onClose = (event: SocketCloseEventLike) => {
    if (closed || disconnectNotified || terminalCommitted || aborted) return;
    disconnectNotified = true;
    const code = closeCodeToDisconnectCode(event.code);
    const message = {
      type: "MULTI_DISCONNECTED",
      v: MULTIPLAYER_BRIDGE_PROTOCOL_VERSION,
      generation: bootstrap.generation,
      code,
    } as const;
    channel.port1.postMessage(message);
    callbacks.onConnectionState?.({ status: "DISCONNECTED", code });
  };
  const onError = () => {
    if (!closed) notifyDrop("SERVER_TO_HOST");
  };

  socket.addEventListener("open", onOpen);
  socket.addEventListener("message", onMessage);
  socket.addEventListener("close", onClose);
  socket.addEventListener("error", onError);
  callbacks.onConnectionState?.({ status: "CONNECTING" });

  iframeWindow.postMessage(bootstrap, "*", [channel.port2]);

  return {
    leave() {
      if (closed || left) return false;
      left = true;
      sendToSocket({
        type: "MULTI_LEAVE",
        v: MULTIPLAYER_BRIDGE_PROTOCOL_VERSION,
        generation: bootstrap.generation,
      });
      stopHeartbeat();
      callbacks.onLeave?.();
      return true;
    },
    close() {
      if (closed) return;
      closed = true;
      stopHeartbeat();
      queuedGameMessages.length = 0;
      channel.port1.onmessage = null;
      channel.port1.close();
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", onClose);
      socket.removeEventListener("error", onError);
      if (socket.readyState === SOCKET_CONNECTING || socket.readyState === SOCKET_OPEN) {
        try {
          socket.close(1000, "bridge closed");
        } catch {
          // A browser can reject close() while CONNECTING. Listener cleanup is already complete.
        }
      }
    },
  };
}
