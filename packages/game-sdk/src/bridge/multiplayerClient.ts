import {
  MULTIPLAYER_BRIDGE_PROTOCOL_VERSION,
  parseGameToHostRelayMessage,
  parseHostToGameMultiplayerMessage,
  type GameToHostRelayMessage,
  type HostToGameMultiplayerMessage,
  type MultiInitMessage,
} from "./multiplayerProtocol.js";

export interface MultiplayerBridgeWindowLike {
  readonly parent: unknown;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
}

export type MultiplayerRelaySendRequest =
  | { readonly delivery: "broadcast"; readonly payload: unknown }
  | {
      readonly delivery: "direct";
      readonly targetParticipantId: string;
      readonly payload: unknown;
    };

export type MultiplayerMessageListener = (
  message: Exclude<HostToGameMultiplayerMessage, MultiInitMessage>,
) => void;

export interface MultiplayerBridgeClient {
  /** Sanitized iframe-visible bootstrap. It never includes a user id, ticket, URL, or cookie. */
  readonly bootstrap: MultiInitMessage;
  ready(): boolean;
  send(request: MultiplayerRelaySendRequest): boolean;
  broadcast(payload: unknown): boolean;
  direct(targetParticipantId: string, payload: unknown): boolean;
  /** Replaces the host-owned opaque reconnect snapshot. Only the host may call it. */
  snapshot(payload: unknown): boolean;
  leave(): void;
  subscribe(listener: MultiplayerMessageListener): () => void;
  disconnect(): void;
}

/**
 * Game-side Relay bridge. A one-time `MULTI_INIT` transfers a private MessagePort; every later
 * intent and delivery uses that port, never the global window channel.
 */
export function connectMultiplayerBridge(
  windowLike: MultiplayerBridgeWindowLike = window as unknown as MultiplayerBridgeWindowLike,
): Promise<MultiplayerBridgeClient> {
  return new Promise((resolve) => {
    let settled = false;

    function onMessage(event: MessageEvent): void {
      if (settled || event.source !== windowLike.parent) return;
      const bootstrap = parseHostToGameMultiplayerMessage(event.data);
      if (!bootstrap || bootstrap.type !== "MULTI_INIT") return;
      const port = event.ports[0];
      if (!port) return;

      settled = true;
      windowLike.removeEventListener("message", onMessage);
      resolve(createMultiplayerClient(port, bootstrap));
    }

    windowLike.addEventListener("message", onMessage);
  });
}

function createMultiplayerClient(
  port: MessagePort,
  bootstrap: MultiInitMessage,
): MultiplayerBridgeClient {
  const listeners = new Set<MultiplayerMessageListener>();
  let clientSeq = 0;
  let lastServerSeq = -1;
  let readySent = false;
  let left = false;
  let disconnected = false;

  function post(message: GameToHostRelayMessage): boolean {
    if (disconnected || left) return false;
    const parsed = parseGameToHostRelayMessage(message);
    if (!parsed || parsed.generation !== bootstrap.generation) return false;
    try {
      port.postMessage(parsed);
      return true;
    } catch {
      return false;
    }
  }

  port.onmessage = (event: MessageEvent) => {
    if (disconnected) return;
    const message = parseHostToGameMultiplayerMessage(event.data);
    if (!message || message.type === "MULTI_INIT" || message.generation !== bootstrap.generation) {
      return;
    }
    if ("serverSeq" in message) {
      if (message.serverSeq <= lastServerSeq) return;
      lastServerSeq = message.serverSeq;
    }
    for (const listener of [...listeners]) listener(message);
  };
  port.start();

  function nextSequence(): number | null {
    const next = clientSeq + 1;
    return Number.isSafeInteger(next) ? next : null;
  }

  function broadcast(payload: unknown): boolean {
    const nextSeq = nextSequence();
    if (nextSeq === null) return false;
    const sent = post({
      type: "RELAY_SEND",
      v: MULTIPLAYER_BRIDGE_PROTOCOL_VERSION,
      generation: bootstrap.generation,
      clientSeq: nextSeq,
      delivery: "broadcast",
      payload,
    });
    if (sent) clientSeq = nextSeq;
    return sent;
  }

  function direct(targetParticipantId: string, payload: unknown): boolean {
    if (!bootstrap.capabilities.directMessages) return false;
    const nextSeq = nextSequence();
    if (nextSeq === null) return false;
    const sent = post({
      type: "RELAY_SEND",
      v: MULTIPLAYER_BRIDGE_PROTOCOL_VERSION,
      generation: bootstrap.generation,
      clientSeq: nextSeq,
      delivery: "direct",
      targetParticipantId,
      payload,
    });
    if (sent) clientSeq = nextSeq;
    return sent;
  }

  function snapshot(payload: unknown): boolean {
    if (!bootstrap.capabilities.hostSnapshot || bootstrap.self.role !== "HOST") return false;
    const nextSeq = nextSequence();
    if (nextSeq === null) return false;
    const sent = post({
      type: "RELAY_SNAPSHOT_SET",
      v: MULTIPLAYER_BRIDGE_PROTOCOL_VERSION,
      generation: bootstrap.generation,
      clientSeq: nextSeq,
      payload,
    });
    if (sent) clientSeq = nextSeq;
    return sent;
  }

  return {
    bootstrap,
    ready() {
      if (readySent) return false;
      const sent = post({
        type: "MULTI_READY",
        v: MULTIPLAYER_BRIDGE_PROTOCOL_VERSION,
        generation: bootstrap.generation,
      });
      if (sent) readySent = true;
      return sent;
    },
    send(request) {
      try {
        if (typeof request !== "object" || request === null || Array.isArray(request)) return false;
        const keys = Object.keys(request);
        if (
          request.delivery === "broadcast" &&
          keys.length === 2 &&
          keys.every((key) => key === "delivery" || key === "payload")
        ) {
          return broadcast(request.payload);
        }
        if (
          request.delivery === "direct" &&
          keys.length === 3 &&
          keys.every(
            (key) => key === "delivery" || key === "targetParticipantId" || key === "payload",
          )
        ) {
          return direct(request.targetParticipantId, request.payload);
        }
      } catch {
        return false;
      }
      return false;
    },
    broadcast,
    direct,
    snapshot,
    leave() {
      if (disconnected || left) return;
      if (
        post({
          type: "MULTI_LEAVE",
          v: MULTIPLAYER_BRIDGE_PROTOCOL_VERSION,
          generation: bootstrap.generation,
        })
      ) {
        left = true;
      }
    },
    subscribe(listener) {
      if (disconnected || typeof listener !== "function") return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    disconnect() {
      if (disconnected) return;
      disconnected = true;
      listeners.clear();
      port.onmessage = null;
      port.close();
    },
  };
}
