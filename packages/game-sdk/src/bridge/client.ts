import {
  isHostInitMessage,
  isJsonSafeValue,
  isWithinBridgePayloadLimit,
  type GameCompleteMessage,
  type GameEventMessage,
} from "./protocol.js";
import type { OwoggCompletionPayload } from "../contracts/creatorManifest.js";

/** The minimal subset of `Window` this file touches — lets a test supply a fake without a DOM.
 * Real callers never pass this; `connectGameBridge()` defaults to the real `window`. */
export interface GameBridgeWindowLike {
  parent: unknown;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
}

export interface GameBridgeClient {
  /** The `difficultyId` the host's HOST_INIT bootstrap carried, or `undefined` when the host
   * didn't send one — every existing bootstrap (reaction-time, Creator games, ball-dodge) and
   * every game with no difficulty tiers. Read once at connect time and never updated after: this
   * protocol has no live-update message, so a host-side difficulty change means a fresh iframe
   * mount (a new HOST_INIT), not a change to an already-connected client — see
   * apps/web/app/features/game/GameHost.tsx's own doc comment on why. */
  readonly difficultyId?: string;
  /** Call once the game's own assets have finished loading and it's ready to be shown. */
  ready(): void;
  /** Call when the player actually starts a round (as opposed to e.g. sitting on a menu). */
  started(): void;
  event(name: string, data?: unknown): void;
  /** Call exactly once per round, when it ends. A second call is ignored — see the module doc
   * comment on why this alone isn't the security boundary, only host-side convenience. */
  complete(result: OwoggCompletionPayload & { metadata?: Record<string, unknown> }): void;
  /** Call if the player backs out without finishing a round. */
  cancel(): void;
  /** Call on an unrecoverable in-game error. `message` is optional and capped at 500 characters
   * host-side; keep it short and free of anything sensitive — it may be surfaced in host logs. */
  error(message?: string): void;
  /** Releases the underlying MessagePort. Idempotent. A game bundle rarely needs this itself (the
   * whole iframe context is torn down by the host on retry/navigation regardless), but the port
   * is a real, ref'd handle until closed — nothing else in this client's public surface can
   * release it, so this exists so a caller (or a test driving this client directly, without a
   * real iframe teardown to rely on) has a way to. */
  disconnect(): void;
}

/**
 * Runs inside the game's iframe. Waits for the host's `HOST_INIT` bootstrap message, then returns
 * a client whose methods send the five game -> host messages over the `MessagePort` the bootstrap
 * handed over — never `window.postMessage` again after that point.
 *
 * Security properties, each directly answering one of the Game Bridge rules:
 *   - `event.source !== windowLike.parent` is rejected before anything else runs. Only the
 *     document that actually framed this page may complete the handshake; a compromised sibling
 *     frame or a script racing to post its own fake HOST_INIT cannot impersonate the host.
 *   - The bootstrap `message` listener is removed the instant a valid HOST_INIT is accepted — win.
 *     addEventListener("message", ...) is not left listening for the lifetime of the page, so
 *     nothing arriving on `window` after bootstrap (valid or not) is ever acted on.
 *   - A second HOST_INIT cannot re-trigger bootstrap: the listener guards on `settled` before the
 *     listener removal has even had a chance to run, and is gone immediately after regardless.
 *
 * Never resolves if no valid HOST_INIT ever arrives — deliberately no timeout/retry here (YAGNI);
 * a caller that wants one can race this against its own.
 */
export function connectGameBridge(
  windowLike: GameBridgeWindowLike = window as unknown as GameBridgeWindowLike,
): Promise<GameBridgeClient> {
  return new Promise((resolve) => {
    let settled = false;

    function onMessage(event: MessageEvent): void {
      if (settled) return;
      if (event.source !== windowLike.parent) return;
      if (!isHostInitMessage(event.data)) return;

      const port = event.ports[0];
      if (!port) return;

      settled = true;
      windowLike.removeEventListener("message", onMessage);
      resolve(createClient(port, event.data.difficultyId));
    }

    windowLike.addEventListener("message", onMessage);
  });
}

function createClient(port: MessagePort, difficultyId?: string): GameBridgeClient {
  let completed = false;
  let disconnected = false;

  function send(
    message:
      | GameCompleteMessage
      | GameEventMessage
      | { type: "GAME_READY" | "GAME_STARTED" | "GAME_CANCEL" }
      | { type: "GAME_ERROR"; message?: string },
  ): void {
    if (disconnected) return;
    // Same "reject outright, don't let it be silently reshaped" posture as the host-side
    // validator (protocol.ts) — a game passing a Map/Date/ArrayBuffer in metadata gets a dropped
    // message here rather than one that quietly arrives as something else.
    if (!isJsonSafeValue(message)) return;
    if (!isWithinBridgePayloadLimit(message)) return;
    port.postMessage(message);
  }

  return {
    ...(difficultyId !== undefined ? { difficultyId } : {}),
    ready() {
      send({ type: "GAME_READY" });
    },
    started() {
      send({ type: "GAME_STARTED" });
    },
    event(name, data) {
      send({ type: "GAME_EVENT", name, ...(data !== undefined ? { data } : {}) });
    },
    complete(result) {
      if (completed) return;
      completed = true;
      send({
        type: "GAME_COMPLETE",
        ...(result.outcome !== undefined ? { outcome: result.outcome } : {}),
        ...(result.score !== undefined ? { score: result.score } : {}),
        ...(result.progression !== undefined ? { progression: result.progression } : {}),
        ...(result.metrics !== undefined ? { metrics: result.metrics } : {}),
        ...(result.metadata !== undefined ? { metadata: result.metadata } : {}),
      });
    },
    cancel() {
      send({ type: "GAME_CANCEL" });
    },
    error(message) {
      send({ type: "GAME_ERROR", ...(message !== undefined ? { message } : {}) });
    },
    disconnect() {
      if (disconnected) return;
      disconnected = true;
      port.close();
    },
  };
}
