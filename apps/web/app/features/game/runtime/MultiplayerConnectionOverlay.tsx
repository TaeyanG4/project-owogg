import React, { type ReactNode } from "react";
import type { MultiplayerParentConnectionState } from "./multiplayerBridgeHost";

export interface MultiplayerConnectionOverlayLabels {
  readonly connecting: string;
  readonly connected: string;
  readonly disconnected: string;
  readonly terminalPending: string;
  readonly aborted: string;
  readonly retry: string;
  readonly leave: string;
}

const DEFAULT_LABELS: MultiplayerConnectionOverlayLabels = {
  connecting: "멀티플레이 서버에 연결 중입니다.",
  connected: "서버 연결됨",
  disconnected: "서버 연결이 끊어졌습니다.",
  terminalPending: "서버에서 경기 결과를 확정하고 있습니다.",
  aborted: "경기가 서버에서 중단되었습니다.",
  retry: "다시 연결",
  leave: "나가기",
};

export interface MultiplayerConnectionOverlayProps {
  readonly state: MultiplayerParentConnectionState;
  readonly labels?: Partial<MultiplayerConnectionOverlayLabels>;
  /** Parent-rendered canonical result. The iframe never controls this node. */
  readonly canonicalResult?: ReactNode;
  readonly terminalActions?: ReactNode;
  readonly onRetry?: () => void;
  readonly onLeave?: () => void;
  /** The multiplayer room header can own the compact connected indicator so it does not cover
   * controls rendered by the game document. */
  readonly hideConnectedStatus?: boolean;
}

/**
 * Connection/result surface rendered by OwOGG outside the sandbox iframe. It deliberately accepts
 * no ticket, socket URL, user id, iframe callback, or client-submitted score.
 */
export function MultiplayerConnectionOverlay({
  state,
  labels: labelOverrides,
  canonicalResult,
  terminalActions,
  onRetry,
  onLeave,
  hideConnectedStatus = false,
}: MultiplayerConnectionOverlayProps) {
  const labels = { ...DEFAULT_LABELS, ...labelOverrides };

  if (state.status === "CONNECTED") {
    if (hideConnectedStatus) return null;
    return (
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none absolute right-3 top-3 z-30 rounded-full border border-emerald-400/30 bg-black/70 px-3 py-1.5 text-xs font-bold text-emerald-300 backdrop-blur"
      >
        {labels.connected}
      </div>
    );
  }

  const title =
    state.status === "CONNECTING"
      ? labels.connecting
      : state.status === "DISCONNECTED"
        ? labels.disconnected
        : state.status === "TERMINAL_PENDING"
          ? labels.terminalPending
          : state.status === "ABORTED"
            ? labels.aborted
            : null;

  if (state.status === "TERMINAL_COMMITTED") {
    return (
      <section
        role="dialog"
        aria-modal="true"
        aria-label="멀티플레이 경기 결과"
        className="absolute inset-0 z-40 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      >
        <div className="w-full max-w-md rounded-3xl border border-border bg-surface-raised p-6 text-center shadow-2xl">
          {canonicalResult}
          {terminalActions}
          {onLeave && (
            <button
              type="button"
              onClick={onLeave}
              className="mt-5 rounded-xl bg-brand px-5 py-2.5 text-sm font-black text-white"
            >
              {labels.leave}
            </button>
          )}
        </div>
      </section>
    );
  }

  return (
    <section
      role={
        state.status === "CONNECTING" || state.status === "TERMINAL_PENDING" ? "status" : "alert"
      }
      aria-live="assertive"
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-sm rounded-3xl border border-border bg-surface-raised p-6 text-center shadow-2xl">
        <p className="font-bold text-text-primary">{title}</p>
        {(state.status === "DISCONNECTED" || state.status === "ABORTED") && (
          <div className="mt-5 flex justify-center gap-3">
            {state.status === "DISCONNECTED" && onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="rounded-xl bg-brand px-4 py-2 text-sm font-black text-white"
              >
                {labels.retry}
              </button>
            )}
            {onLeave && (
              <button
                type="button"
                onClick={onLeave}
                className="rounded-xl border border-border px-4 py-2 text-sm font-bold text-text-secondary"
              >
                {labels.leave}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
