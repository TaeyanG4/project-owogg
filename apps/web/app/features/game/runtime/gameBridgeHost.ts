import { parseGameToHostMessage } from "@owogg/game-sdk/bridge";
import type { OwoggCompletionPayload } from "@owogg/game-sdk/contracts";

/** The minimal subset of the iframe's `contentWindow` this file touches — lets a test supply a
 * fake without a DOM/real iframe. Real callers pass `iframe.contentWindow` (a genuine `Window`,
 * which satisfies this structurally). */
export interface GameBridgeIframeWindowLike {
  postMessage(message: unknown, targetOrigin: string, transfer: Transferable[]): void;
}

export interface GameBridgeHostCallbacks {
  onReady?: () => void;
  onStarted?: () => void;
  /** Fires at most once per bridge — a second GAME_COMPLETE is dropped before this is called
   * again. See createGameBridgeHost's doc comment for why that has to be enforced here, not just
   * trusted from the game side. */
  onEvent?: (name: string, data?: unknown) => void;
  onComplete?: (result: OwoggCompletionPayload & { metadata?: Record<string, unknown> }) => void;
  onCancel?: () => void;
  onError?: (message?: string) => void;
}

export interface GameBridgeHost {
  /** Idempotent. Stops listening and releases the port — call on unmount and on every retry
   * (a new attempt gets a fresh bridge, never a reused one). */
  close(): void;
}

/**
 * Host-side half of the Game Bridge: creates the MessageChannel, sends the one-time bootstrap to
 * the iframe, and listens on `port1` for the five game -> host messages, dispatching each to its
 * callback.
 *
 * `iframeWindow.postMessage(..., "*", [port2])` is the ONLY place this controller (or anything
 * downstream of it) ever calls `postMessage` with a wildcard target — every message after the
 * bootstrap travels over the MessagePort instead. "*" is unavoidable here specifically: a
 * sandboxed iframe without `allow-same-origin` (see GameFrame's GAME_IFRAME_SANDBOX) has an opaque
 * origin, so there is no real origin string the host could name as the target even if it wanted
 * to. Everything downstream of the bootstrap is where the actual security work happens instead —
 * the port itself, once transferred, cannot be intercepted by any other frame or script on the
 * page, opaque origin or not.
 *
 * Every inbound message is validated through `parseGameToHostMessage` before anything is
 * dispatched — an iframe is untrusted code by construction (see GameFrame's own doc comment), so
 * a malformed or unexpected message is silently ignored, never allowed to throw or to reach a
 * callback in some partially-trusted shape. `onComplete` in particular is enforced to fire at most
 * once here, at the host — a compromised or buggy game could bypass the game-sdk client's own
 * (convenience-only) duplicate guard and write directly to the port, so the host cannot treat that
 * guard as its security boundary.
 */
export interface GameBridgeHostOptions {
  /** Threaded into HOST_INIT's own optional `difficultyId` field (see protocol.ts's
   * HostInitMessage) — only a game with real difficulty tiers (aim-test) reads it; every other
   * caller omits this and the bootstrap stays exactly the bare `{type:"HOST_INIT"}` it always was.
   * Never auth/token/API address — see this file's own doc comment on what HOST_INIT carries. */
  difficultyId?: string;
}

export function createGameBridgeHost(
  iframeWindow: GameBridgeIframeWindowLike,
  callbacks: GameBridgeHostCallbacks,
  options?: GameBridgeHostOptions,
): GameBridgeHost {
  const channel = new MessageChannel();
  let completed = false;
  let closed = false;

  channel.port1.onmessage = (event: MessageEvent) => {
    if (closed) return;
    const message = parseGameToHostMessage(event.data);
    if (!message) return;

    switch (message.type) {
      case "GAME_READY":
        callbacks.onReady?.();
        return;
      case "GAME_STARTED":
        callbacks.onStarted?.();
        return;
      case "GAME_EVENT":
        callbacks.onEvent?.(message.name, message.data);
        return;
      case "GAME_COMPLETE":
        if (completed) return;
        completed = true;
        callbacks.onComplete?.({
          ...(message.outcome !== undefined ? { outcome: message.outcome } : {}),
          ...(message.score !== undefined ? { score: message.score } : {}),
          ...(message.progression !== undefined ? { progression: message.progression } : {}),
          ...(message.metrics !== undefined ? { metrics: message.metrics } : {}),
          ...(message.metadata !== undefined ? { metadata: message.metadata } : {}),
        });
        return;
      case "GAME_CANCEL":
        callbacks.onCancel?.();
        return;
      case "GAME_ERROR":
        callbacks.onError?.(message.message);
        return;
    }
  };
  // Assigning `.onmessage` starts the port implicitly per the MessagePort spec — no explicit
  // `.start()` call needed (that's only required for the addEventListener("message", ...) style,
  // which this deliberately doesn't use).

  iframeWindow.postMessage(
    { type: "HOST_INIT", ...(options?.difficultyId ? { difficultyId: options.difficultyId } : {}) },
    "*",
    [channel.port2],
  );

  return {
    close() {
      if (closed) return;
      closed = true;
      channel.port1.onmessage = null;
      channel.port1.close();
    },
  };
}
