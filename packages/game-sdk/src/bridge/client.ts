import {
  isHostInitMessage,
  isGamePlayMode,
  isJsonSafeValue,
  isPlayConfigSelection,
  isWithinBridgePayloadLimit,
  parseHostToGameMessage,
  type AuthorizedStartContext,
  type GameCompleteMessage,
  type GamePlayMode,
  type GameEventMessage,
  type HostPlayModeErrorCode,
  type HostStartErrorCode,
  type JsonSafeValue,
  type PlayConfigSelection,
  type PublicPlayConfigDescriptor,
} from "./protocol.js";
import type { OwoggCompletionPayload } from "../contracts/gameCreatorManifest.js";

/** The minimal subset of `Window` this file touches — lets a test supply a fake without a DOM.
 * Real callers never pass this; `connectGameBridge()` defaults to the real `window`. */
export interface GameBridgeWindowLike {
  parent: unknown;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
}

export interface GameBridgeClient {
  /** The `difficultyId` the host's HOST_INIT bootstrap carried, or `undefined` when the host
   * didn't send one. Read once at connect time and never updated after: this
   * protocol has no live-update message, so a host-side difficulty change means a fresh iframe
   * mount (a new HOST_INIT), not a change to an already-connected client — see
   * apps/web/app/features/game/GameHost.tsx's own doc comment on why. */
  readonly difficultyId?: string;
  /** Approved public choices only. Verifier identity, token and attempt identity never cross. */
  readonly playConfig: PublicPlayConfigDescriptor | null;
  /** Approved topology choices for a game-owned launcher; empty for games that do not negotiate. */
  readonly playModes: readonly GamePlayMode[];
  /** Selects topology before any local lifecycle or PlayConfig start request. */
  selectPlayMode(playMode: GamePlayMode): Promise<GamePlayMode>;
  /** Requests the one allowed authorization for this iframe attempt. */
  requestStart(config: PlayConfigSelection): Promise<AuthorizedStartContext>;
  /** Call once the game's own assets have finished loading and it's ready to be shown. */
  ready(): void;
  /** Call when the player actually starts a round (as opposed to e.g. sitting on a menu). */
  started(): void;
  event(name: string, data?: unknown): void;
  /** Call exactly once per round, when it ends. A second call is ignored — see the module doc
   * comment on why this alone isn't the security boundary, only host-side convenience. */
  complete(
    result: OwoggCompletionPayload & {
      metadata?: Record<string, unknown>;
      evidence?: JsonSafeValue;
    },
  ): void;
  /** Requests a fresh attempt. Keep the visible restart button inside the game; the parent host
   * rotates verifier/session state and remounts the sandbox. */
  restart(): void;
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

export class GameStartRequestError extends Error {
  readonly code: HostStartErrorCode;

  constructor(code: HostStartErrorCode) {
    super(code);
    this.name = "GameStartRequestError";
    this.code = code;
  }
}

export class GamePlayModeSelectionError extends Error {
  readonly code: HostPlayModeErrorCode;

  constructor(code: HostPlayModeErrorCode) {
    super(code);
    this.name = "GamePlayModeSelectionError";
    this.code = code;
  }
}

/**
 * Runs inside the game's iframe. Waits for the host's `HOST_INIT` bootstrap message, then returns
 * a client whose methods send the game -> host messages over the `MessagePort` the bootstrap
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
      resolve(
        createClient(port, event.data.difficultyId, event.data.playConfig, event.data.playModes),
      );
    }

    windowLike.addEventListener("message", onMessage);
  });
}

function freezePlayConfig(
  playConfig: PublicPlayConfigDescriptor | undefined,
): PublicPlayConfigDescriptor | null {
  if (playConfig === undefined) return null;
  const frozen = {
    defaultDifficultyId: playConfig.defaultDifficultyId,
    defaultVariantId: playConfig.defaultVariantId,
    difficulties: Object.freeze(
      playConfig.difficulties.map((difficulty) => Object.freeze({ ...difficulty })),
    ),
    variants: Object.freeze(playConfig.variants.map((variant) => Object.freeze({ ...variant }))),
    allowedConfigs: Object.freeze(
      playConfig.allowedConfigs.map((config) => Object.freeze({ ...config })),
    ),
  };
  return Object.freeze(frozen);
}

function createClient(
  port: MessagePort,
  difficultyId?: string,
  initPlayConfig?: PublicPlayConfigDescriptor,
  initPlayModes?: readonly GamePlayMode[],
): GameBridgeClient {
  let completed = false;
  let disconnected = false;
  let startRequested = false;
  let authorized = false;
  let playModeRequested = false;
  let selectedPlayMode: GamePlayMode | null =
    initPlayModes?.length === 1 ? (initPlayModes[0] ?? null) : null;
  let pendingStart: {
    readonly requested: PlayConfigSelection;
    readonly resolve: (context: AuthorizedStartContext) => void;
    readonly reject: (error: GameStartRequestError) => void;
  } | null = null;
  let pendingPlayMode: {
    readonly requested: GamePlayMode;
    readonly resolve: (playMode: GamePlayMode) => void;
    readonly reject: (error: GamePlayModeSelectionError) => void;
  } | null = null;
  const playConfig = freezePlayConfig(initPlayConfig);
  const playModes = Object.freeze([...(initPlayModes ?? [])]);

  function genericPlayModeIsAuthorized(): boolean {
    if (playModes.length === 0) return true;
    if (playModes.length === 1) return playModes[0] !== "online-multi";
    return selectedPlayMode === "single" || selectedPlayMode === "local-multi";
  }

  function send(
    message:
      | GameCompleteMessage
      | GameEventMessage
      | { type: "GAME_READY" | "GAME_STARTED" | "GAME_RESTART" | "GAME_CANCEL" }
      | { type: "GAME_REQUEST_START"; playConfig: PlayConfigSelection }
      | { type: "GAME_SELECT_PLAY_MODE"; playMode: GamePlayMode }
      | { type: "GAME_ERROR"; message?: string },
  ): boolean {
    if (disconnected) return false;
    // Same "reject outright, don't let it be silently reshaped" posture as the host-side
    // validator (protocol.ts) — a game passing a Map/Date/ArrayBuffer in metadata gets a dropped
    // message here rather than one that quietly arrives as something else.
    if (!isJsonSafeValue(message)) return false;
    if (!isWithinBridgePayloadLimit(message)) return false;
    try {
      port.postMessage(message);
      return true;
    } catch {
      return false;
    }
  }

  port.onmessage = (event: MessageEvent) => {
    if (disconnected) return;
    const message = parseHostToGameMessage(event.data);
    if (!message) return;
    if (message.type === "HOST_PLAY_MODE_ERROR") {
      if (pendingPlayMode === null) return;
      const pending = pendingPlayMode;
      pendingPlayMode = null;
      pending.reject(new GamePlayModeSelectionError(message.code));
      return;
    }
    if (message.type === "HOST_PLAY_MODE_SELECTED") {
      if (pendingPlayMode === null) return;
      const pending = pendingPlayMode;
      pendingPlayMode = null;
      if (message.playMode !== pending.requested) {
        pending.reject(new GamePlayModeSelectionError("MODE_UNAVAILABLE"));
        return;
      }
      selectedPlayMode = message.playMode;
      pending.resolve(message.playMode);
      return;
    }
    if (pendingStart === null) return;
    const pending = pendingStart;
    pendingStart = null;
    if (message.type === "HOST_START_ERROR") {
      pending.reject(new GameStartRequestError(message.code));
      return;
    }
    if (
      message.context.playConfig.difficultyId !== pending.requested.difficultyId ||
      message.context.playConfig.variantId !== pending.requested.variantId
    ) {
      pending.reject(new GameStartRequestError("GAME_UNAVAILABLE"));
      return;
    }
    authorized = true;
    pending.resolve(message.context);
  };

  return {
    ...(difficultyId !== undefined ? { difficultyId } : {}),
    playConfig,
    playModes,
    selectPlayMode(playMode) {
      if (disconnected) {
        return Promise.reject(new GamePlayModeSelectionError("MODE_UNAVAILABLE"));
      }
      if (playModeRequested) {
        return Promise.reject(new GamePlayModeSelectionError("ALREADY_SELECTED"));
      }
      if (!isGamePlayMode(playMode) || !playModes.includes(playMode)) {
        return Promise.reject(new GamePlayModeSelectionError("INVALID_PLAY_MODE"));
      }
      playModeRequested = true;
      return new Promise<GamePlayMode>((resolve, reject) => {
        pendingPlayMode = { requested: playMode, resolve, reject };
        if (!send({ type: "GAME_SELECT_PLAY_MODE", playMode })) {
          pendingPlayMode = null;
          reject(new GamePlayModeSelectionError("MODE_UNAVAILABLE"));
        }
      });
    },
    requestStart(config) {
      if (disconnected) return Promise.reject(new GameStartRequestError("GAME_UNAVAILABLE"));
      if (startRequested) return Promise.reject(new GameStartRequestError("ALREADY_REQUESTED"));
      if (!genericPlayModeIsAuthorized()) {
        return Promise.reject(new GameStartRequestError("GAME_UNAVAILABLE"));
      }
      if (
        playConfig === null ||
        !isPlayConfigSelection(config) ||
        !playConfig.allowedConfigs.some(
          (allowed) =>
            allowed.difficultyId === config.difficultyId && allowed.variantId === config.variantId,
        )
      ) {
        return Promise.reject(new GameStartRequestError("INVALID_PLAY_CONFIG"));
      }
      startRequested = true;
      return new Promise<AuthorizedStartContext>((resolve, reject) => {
        pendingStart = {
          requested: { ...config },
          resolve,
          reject,
        };
        if (!send({ type: "GAME_REQUEST_START", playConfig: { ...config } })) {
          pendingStart = null;
          reject(new GameStartRequestError("GAME_UNAVAILABLE"));
        }
      });
    },
    ready() {
      send({ type: "GAME_READY" });
    },
    started() {
      if (!genericPlayModeIsAuthorized()) return;
      if (playConfig !== null && !authorized) return;
      send({ type: "GAME_STARTED" });
    },
    event(name, data) {
      if (!genericPlayModeIsAuthorized()) return;
      send({ type: "GAME_EVENT", name, ...(data !== undefined ? { data } : {}) });
    },
    complete(result) {
      if (completed) return;
      if (!genericPlayModeIsAuthorized()) return;
      if (
        playConfig !== null &&
        (!authorized ||
          result.evidence === undefined ||
          result.outcome !== undefined ||
          result.score !== undefined ||
          result.progression !== undefined ||
          result.metrics !== undefined)
      ) {
        return;
      }
      completed = true;
      send({
        type: "GAME_COMPLETE",
        ...(result.outcome !== undefined ? { outcome: result.outcome } : {}),
        ...(result.score !== undefined ? { score: result.score } : {}),
        ...(result.progression !== undefined ? { progression: result.progression } : {}),
        ...(result.metrics !== undefined ? { metrics: result.metrics } : {}),
        ...(result.metadata !== undefined ? { metadata: result.metadata } : {}),
        ...(result.evidence !== undefined ? { evidence: result.evidence } : {}),
      });
    },
    restart() {
      send({ type: "GAME_RESTART" });
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
      const pending = pendingStart;
      pendingStart = null;
      pending?.reject(new GameStartRequestError("GAME_UNAVAILABLE"));
      const pendingMode = pendingPlayMode;
      pendingPlayMode = null;
      pendingMode?.reject(new GamePlayModeSelectionError("MODE_UNAVAILABLE"));
      port.onmessage = null;
      port.close();
    },
  };
}
