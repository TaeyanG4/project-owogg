import {
  MULTIPLAYER_BRIDGE_PROTOCOL_VERSION,
  MULTIPLAYER_HOST_MAX_PAYLOAD_BYTES,
  parseGameToHostRelayMessage,
  parseHostToGameMultiplayerMessage,
  type HostToGameMultiplayerMessage,
  type MultiInitMessage,
  type MultiplayerDisconnectCode,
  type MultiplayerRelayCloseCode,
} from "@owogg/game-sdk/bridge";
import {
  MULTIPLAYER_HEARTBEAT_REQUEST,
  MULTIPLAYER_HEARTBEAT_RESPONSE,
  MultiplayerLatencySyncMessageSchema,
  type MultiplayerLatencySample,
} from "@owogg/contracts";

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
  | { readonly status: "CLOSED"; readonly code: MultiplayerRelayCloseCode };

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
  onLatencySamples?: (samples: readonly MultiplayerLatencySample[]) => void;
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
  readonly now?: () => number;
}

const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;
const MAX_QUEUED_GAME_MESSAGES = 32;
// The heartbeat is answered by the DO auto-response path and does not wake the object. Reporting
// the resulting RTT does, so shared roster updates are intentionally no more frequent than this.
const HEARTBEAT_INTERVAL_MS = 30_000;
const LATENCY_REPORT_MIN_INTERVAL_MS = 30_000;
const LATENCY_REPORT_CHANGE_MS = 20;
const LATENCY_REPORT_REFRESH_MS = 5 * 60_000;
const textEncoder = new TextEncoder();

function hasServerSequence(
  message: HostToGameMultiplayerMessage,
): message is HostToGameMultiplayerMessage & { readonly serverSeq: number } {
  return "serverSeq" in message;
}

function closeCodeToDisconnectCode(code: number): MultiplayerDisconnectCode {
  if (code === 4001) return "REPLACED_BY_NEW_CONNECTION";
  if (code === 4003) return "AUTH_EXPIRED";
  if (code === 4008) return "SLOW_CONSUMER";
  if (code === 1000) return "LEFT";
  return "NETWORK_LOST";
}

/**
 * Parent-only Relay transport boundary. The parent owns the ticket and WebSocket; the sandboxed
 * game receives only sanitized bootstrap/delivery messages through a private MessagePort.
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
  let runtimeClosed = false;
  let lastClientSeq = 0;
  let lastServerSeq = -1;
  let lastConnectionGeneration = 0;
  const scheduleInterval = dependencies.setInterval ?? setInterval;
  const cancelInterval = dependencies.clearInterval ?? clearInterval;
  const now = dependencies.now ?? Date.now;

  function notifyDrop(direction: "GAME_TO_HOST" | "SERVER_TO_HOST") {
    callbacks.onProtocolDrop?.(direction);
  }

  function sendToSocket(message: unknown): void {
    const encoded = JSON.stringify(message);
    if (socket.readyState === SOCKET_OPEN) {
      try {
        socket.send(encoded);
      } catch {
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
  let heartbeatSentAt: number | null = null;
  let lastReportedLatency: number | null = null;
  let lastLatencyReportAt = 0;
  const stopHeartbeat = () => {
    if (heartbeatTimer === undefined) return;
    cancelInterval(heartbeatTimer);
    heartbeatTimer = undefined;
  };

  const sendHeartbeat = () => {
    if (closed || runtimeClosed || left || socket.readyState !== SOCKET_OPEN) return;
    try {
      heartbeatSentAt = now();
      socket.send(MULTIPLAYER_HEARTBEAT_REQUEST);
    } catch {
      heartbeatSentAt = null;
      notifyDrop("GAME_TO_HOST");
    }
  };

  channel.port1.onmessage = (event: MessageEvent) => {
    if (closed) return;
    const message = parseGameToHostRelayMessage(event.data);
    if (!message || message.generation !== bootstrap.generation || left) {
      notifyDrop("GAME_TO_HOST");
      return;
    }

    if (message.type === "RELAY_SEND" || message.type === "RELAY_SNAPSHOT_SET") {
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
    } else {
      left = true;
      sendToSocket(message);
      stopHeartbeat();
      callbacks.onLeave?.();
      return;
    }
    sendToSocket(message);
  };
  channel.port1.start();

  const onOpen = () => {
    flushQueuedGameMessages();
    sendHeartbeat();
  };
  const onMessage = (event: SocketMessageEventLike) => {
    if (closed || typeof event.data !== "string") {
      if (!closed) notifyDrop("SERVER_TO_HOST");
      return;
    }
    if (textEncoder.encode(event.data).byteLength > MULTIPLAYER_HOST_MAX_PAYLOAD_BYTES) {
      notifyDrop("SERVER_TO_HOST");
      return;
    }
    if (event.data === MULTIPLAYER_HEARTBEAT_RESPONSE) {
      if (heartbeatSentAt === null) return;
      const sampledAt = now();
      const rttMs = Math.min(60_000, Math.max(0, Math.round(sampledAt - heartbeatSentAt)));
      heartbeatSentAt = null;
      callbacks.onLatencySamples?.([
        {
          participantId: bootstrap.self.participantId,
          seatIndex: bootstrap.self.seatIndex,
          rttMs,
          sampledAt,
        },
      ]);
      const mayReport =
        lastReportedLatency === null ||
        sampledAt - lastLatencyReportAt >= LATENCY_REPORT_MIN_INTERVAL_MS;
      const shouldReport =
        lastReportedLatency === null ||
        Math.abs(lastReportedLatency - rttMs) >= LATENCY_REPORT_CHANGE_MS ||
        sampledAt - lastLatencyReportAt >= LATENCY_REPORT_REFRESH_MS;
      if (mayReport && shouldReport) {
        sendToSocket({
          type: "MULTI_LATENCY_REPORT",
          v: MULTIPLAYER_BRIDGE_PROTOCOL_VERSION,
          generation: bootstrap.generation,
          rttMs,
        });
        lastReportedLatency = rttMs;
        lastLatencyReportAt = sampledAt;
      }
      return;
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(event.data);
    } catch {
      notifyDrop("SERVER_TO_HOST");
      return;
    }
    const latencySync = MultiplayerLatencySyncMessageSchema.safeParse(decoded);
    if (latencySync.success) {
      if (latencySync.data.generation !== bootstrap.generation) {
        notifyDrop("SERVER_TO_HOST");
        return;
      }
      callbacks.onLatencySamples?.(latencySync.data.samples);
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
    } else if (message.type === "RELAY_CLOSED") {
      runtimeClosed = true;
      stopHeartbeat();
      callbacks.onConnectionState?.({ status: "CLOSED", code: message.code });
    }
    channel.port1.postMessage(message);
  };
  const onClose = (event: SocketCloseEventLike) => {
    if (closed || disconnectNotified || runtimeClosed) return;
    disconnectNotified = true;
    const code = closeCodeToDisconnectCode(event.code);
    channel.port1.postMessage({
      type: "MULTI_DISCONNECTED",
      v: MULTIPLAYER_BRIDGE_PROTOCOL_VERSION,
      generation: bootstrap.generation,
      code,
    });
    callbacks.onConnectionState?.({ status: "DISCONNECTED", code });
  };
  const onError = () => {
    if (!closed) notifyDrop("SERVER_TO_HOST");
  };

  socket.addEventListener("open", onOpen);
  socket.addEventListener("message", onMessage);
  socket.addEventListener("close", onClose);
  socket.addEventListener("error", onError);
  heartbeatTimer = scheduleInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
  if (socket.readyState === SOCKET_OPEN) sendHeartbeat();
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
          // Listener cleanup is already complete if a browser rejects close while CONNECTING.
        }
      }
    },
  };
}
