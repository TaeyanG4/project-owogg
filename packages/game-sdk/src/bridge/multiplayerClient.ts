import {
  MULTIPLAYER_BRIDGE_PROTOCOL_VERSION,
  parseGameToHostMultiplayerMessage,
  parseHostToGameMultiplayerMessage,
  type GameToHostMultiplayerMessage,
  type HostToGameMultiplayerMessage,
  type MultiInitMessage,
} from "./multiplayerProtocol.js";
import type { OwoggMultiplayerActionRequest } from "../contracts/gameCreatorManifest.js";

export interface MultiplayerBridgeWindowLike {
  readonly parent: unknown;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
}

export type MultiplayerActionRequest = OwoggMultiplayerActionRequest;

export type MultiplayerMessageListener = (message: HostToGameMultiplayerMessage) => void;

export interface MultiplayerBridgeClient {
  /** Sanitized iframe-visible bootstrap. It never includes a user id, ticket, URL, or cookie. */
  readonly bootstrap: MultiInitMessage;
  ready(): boolean;
  /** Returns the idempotency id when sent, or `null` when the request is invalid/closed. */
  action(request: MultiplayerActionRequest): string | null;
  input(payload: unknown): boolean;
  leave(): void;
  subscribe(listener: MultiplayerMessageListener): () => void;
  disconnect(): void;
}

export interface MultiplayerBridgeClientOptions {
  /** Test seam and deterministic-game seam. Production defaults to `crypto.randomUUID()`. */
  readonly createActionId?: () => string;
}

function defaultActionId(): string {
  return crypto.randomUUID();
}

function hasServerSequence(
  message: HostToGameMultiplayerMessage,
): message is HostToGameMultiplayerMessage & { readonly serverSeq: number } {
  return "serverSeq" in message;
}

/**
 * Game-side multiplayer bridge. The one-time `MULTI_INIT` window message transfers a private
 * MessagePort; every later intent/state message uses that port. Only the actual parent window may
 * complete the handshake, and a second bootstrap is ignored after the listener is removed.
 */
export function connectMultiplayerBridge(
  windowLike: MultiplayerBridgeWindowLike = window as unknown as MultiplayerBridgeWindowLike,
  options: MultiplayerBridgeClientOptions = {},
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
      resolve(createMultiplayerClient(port, bootstrap, options.createActionId ?? defaultActionId));
    }

    windowLike.addEventListener("message", onMessage);
  });
}

function createMultiplayerClient(
  port: MessagePort,
  bootstrap: MultiInitMessage,
  createActionId: () => string,
): MultiplayerBridgeClient {
  const listeners = new Set<MultiplayerMessageListener>();
  let clientSeq = 0;
  let lastServerSeq = -1;
  let readySent = false;
  let left = false;
  let disconnected = false;

  function send(message: GameToHostMultiplayerMessage): boolean {
    if (disconnected || left) return false;
    const parsed = parseGameToHostMultiplayerMessage(message);
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
    if (hasServerSequence(message)) {
      if (message.serverSeq <= lastServerSeq) return;
      lastServerSeq = message.serverSeq;
    }
    for (const listener of [...listeners]) listener(message);
  };
  port.start();

  return {
    bootstrap,
    ready() {
      if (readySent) return false;
      const sent = send({
        type: "MULTI_READY",
        v: MULTIPLAYER_BRIDGE_PROTOCOL_VERSION,
        generation: bootstrap.generation,
      });
      if (sent) readySent = true;
      return sent;
    },
    action(request) {
      if (disconnected || left) return null;
      if (typeof request !== "object" || request === null || Array.isArray(request)) return null;
      let clientActionId: string;
      try {
        clientActionId = request.clientActionId ?? createActionId();
      } catch {
        return null;
      }
      const nextSeq = clientSeq + 1;
      const sent = send({
        type: "MULTI_ACTION",
        v: MULTIPLAYER_BRIDGE_PROTOCOL_VERSION,
        generation: bootstrap.generation,
        clientSeq: nextSeq,
        clientActionId,
        expectedRevision: request.expectedRevision,
        payload: request.payload,
      });
      if (!sent) return null;
      clientSeq = nextSeq;
      return clientActionId;
    },
    input(payload) {
      const nextSeq = clientSeq + 1;
      const sent = send({
        type: "MULTI_INPUT",
        v: MULTIPLAYER_BRIDGE_PROTOCOL_VERSION,
        generation: bootstrap.generation,
        clientSeq: nextSeq,
        payload,
      });
      if (sent) clientSeq = nextSeq;
      return sent;
    },
    leave() {
      if (disconnected || left) return;
      if (
        send({
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
