import {
  isWithinBridgePayloadLimit,
  parseGameToHostMessage,
  parseHostToGameMessage,
  type AuthorizedStartContext,
  type GamePlayMode,
  type HostPlayModeErrorCode,
  type HostStartErrorCode,
  type JsonSafeValue,
  type PlayConfigSelection,
  type PublicPlayConfigDescriptor,
} from "@owogg/game-sdk/bridge";
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
  onComplete?: (
    result: OwoggCompletionPayload & {
      metadata?: Record<string, unknown>;
      evidence?: JsonSafeValue;
    },
  ) => void;
  onRequestStart?: (
    playConfig: PlayConfigSelection,
  ) => Promise<GameBridgeStartDecision> | GameBridgeStartDecision;
  onSelectPlayMode?: (
    playMode: GamePlayMode,
  ) => Promise<GameBridgePlayModeDecision> | GameBridgePlayModeDecision;
  /** Runs only after HOST_PLAY_MODE_SELECTED was successfully queued on the private port. This
   * lets GameHost replace the launcher iframe without racing the acknowledgement itself. */
  onPlayModeSelected?: (playMode: GamePlayMode) => void;
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
 * the iframe, and listens on `port1` for game -> host messages, dispatching each to its
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
   * HostInitMessage). Games without host-selected difficulty tiers omit it and the bootstrap stays
   * exactly the bare `{type:"HOST_INIT"}` it always was.
   * Never auth/token/API address — see this file's own doc comment on what HOST_INIT carries. */
  difficultyId?: string;
  /** Public canonical choices only. Its presence switches this bridge to verifier-backed mode. */
  playConfig?: PublicPlayConfigDescriptor;
  /** Approved launcher choices only; online authority still requires the parent profile flow. */
  playModes?: readonly GamePlayMode[];
}

export type GameBridgeStartDecision =
  | { readonly ok: true; readonly context: AuthorizedStartContext }
  | { readonly ok: false; readonly code: HostStartErrorCode };

export type GameBridgePlayModeDecision =
  | { readonly ok: true; readonly playMode: GamePlayMode }
  | { readonly ok: false; readonly code: HostPlayModeErrorCode };

export function createGameBridgeHost(
  iframeWindow: GameBridgeIframeWindowLike,
  callbacks: GameBridgeHostCallbacks,
  options?: GameBridgeHostOptions,
): GameBridgeHost {
  const channel = new MessageChannel();
  let completed = false;
  let closed = false;
  let startRequested = false;
  let startAuthorized = false;
  let playModeRequested = false;
  let selectedPlayMode: GamePlayMode | null =
    options?.playModes?.length === 1 ? (options.playModes[0] ?? null) : null;

  function sendToGame(message: unknown): boolean {
    if (closed || !isWithinBridgePayloadLimit(message) || !parseHostToGameMessage(message)) {
      return false;
    }
    try {
      channel.port1.postMessage(message);
      return true;
    } catch {
      return false;
    }
  }

  function sendStartError(code: HostStartErrorCode): void {
    sendToGame({ type: "HOST_START_ERROR", code });
  }

  function sendPlayModeError(code: HostPlayModeErrorCode): void {
    sendToGame({ type: "HOST_PLAY_MODE_ERROR", code });
  }

  async function selectPlayMode(playMode: GamePlayMode): Promise<void> {
    if (playModeRequested) {
      sendPlayModeError("ALREADY_SELECTED");
      return;
    }
    playModeRequested = true;
    if (!options?.playModes?.includes(playMode) || !callbacks.onSelectPlayMode) {
      sendPlayModeError("INVALID_PLAY_MODE");
      return;
    }

    let decision: GameBridgePlayModeDecision;
    try {
      decision = await callbacks.onSelectPlayMode(playMode);
    } catch {
      decision = { ok: false, code: "MODE_UNAVAILABLE" };
    }
    if (closed || completed) return;
    if (!decision.ok) {
      sendPlayModeError(decision.code);
      return;
    }
    if (decision.playMode !== playMode || !options.playModes.includes(decision.playMode)) {
      sendPlayModeError("MODE_UNAVAILABLE");
      return;
    }
    if (sendToGame({ type: "HOST_PLAY_MODE_SELECTED", playMode: decision.playMode })) {
      selectedPlayMode = decision.playMode;
      callbacks.onPlayModeSelected?.(decision.playMode);
    }
  }

  function allowedConfig(selection: PlayConfigSelection) {
    return options?.playConfig?.allowedConfigs.find(
      (candidate) =>
        candidate.difficultyId === selection.difficultyId &&
        candidate.variantId === selection.variantId,
    );
  }

  function genericPlayModeIsAuthorized(): boolean {
    if (!options?.playModes) return true;
    if (options.playModes.length === 1) return options.playModes[0] !== "online-multi";
    return selectedPlayMode === "single" || selectedPlayMode === "local-multi";
  }

  async function authorizeStart(selection: PlayConfigSelection): Promise<void> {
    if (startRequested) {
      sendStartError("ALREADY_REQUESTED");
      return;
    }
    startRequested = true;
    if (!genericPlayModeIsAuthorized()) {
      sendStartError("GAME_UNAVAILABLE");
      return;
    }
    const allowed = allowedConfig(selection);
    if (!options?.playConfig || !allowed || !callbacks.onRequestStart) {
      sendStartError("INVALID_PLAY_CONFIG");
      return;
    }

    let decision: GameBridgeStartDecision;
    try {
      decision = await callbacks.onRequestStart({ ...selection });
    } catch {
      decision = { ok: false, code: "SESSION_UNAVAILABLE" };
    }
    if (closed || completed) return;
    if (!decision.ok) {
      sendStartError(decision.code);
      return;
    }
    const message = parseHostToGameMessage({ type: "HOST_START", context: decision.context });
    if (
      message?.type !== "HOST_START" ||
      message.context.playConfig.difficultyId !== selection.difficultyId ||
      message.context.playConfig.variantId !== selection.variantId ||
      message.context.rewardFactor !== allowed.rewardFactor
    ) {
      sendStartError("GAME_UNAVAILABLE");
      return;
    }
    startAuthorized = sendToGame(message);
  }

  channel.port1.onmessage = (event: MessageEvent) => {
    if (closed) return;
    const message = parseGameToHostMessage(event.data);
    if (!message) return;

    switch (message.type) {
      case "GAME_READY":
        callbacks.onReady?.();
        return;
      case "GAME_STARTED":
        if (!genericPlayModeIsAuthorized()) return;
        if (options?.playConfig && !startAuthorized) return;
        callbacks.onStarted?.();
        return;
      case "GAME_REQUEST_START":
        void authorizeStart(message.playConfig);
        return;
      case "GAME_SELECT_PLAY_MODE":
        void selectPlayMode(message.playMode);
        return;
      case "GAME_EVENT":
        if (!genericPlayModeIsAuthorized()) return;
        callbacks.onEvent?.(message.name, message.data);
        return;
      case "GAME_COMPLETE":
        if (completed) return;
        if (!genericPlayModeIsAuthorized()) return;
        if (
          options?.playConfig &&
          (!startAuthorized ||
            message.evidence === undefined ||
            message.outcome !== undefined ||
            message.score !== undefined ||
            message.progression !== undefined ||
            message.metrics !== undefined)
        ) {
          return;
        }
        completed = true;
        callbacks.onComplete?.({
          ...(message.outcome !== undefined ? { outcome: message.outcome } : {}),
          ...(message.score !== undefined ? { score: message.score } : {}),
          ...(message.progression !== undefined ? { progression: message.progression } : {}),
          ...(message.metrics !== undefined ? { metrics: message.metrics } : {}),
          ...(message.metadata !== undefined ? { metadata: message.metadata } : {}),
          ...(message.evidence !== undefined ? { evidence: message.evidence } : {}),
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
    {
      type: "HOST_INIT",
      ...(options?.difficultyId && !options.playConfig
        ? { difficultyId: options.difficultyId }
        : {}),
      ...(options?.playConfig ? { playConfig: options.playConfig } : {}),
      ...(options?.playModes ? { playModes: options.playModes } : {}),
    },
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
