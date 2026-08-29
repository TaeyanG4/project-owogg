import React from "react";
import type { MultiplayerParentConnectionState } from "./multiplayerBridgeHost";

export interface MultiplayerConnectionOverlayLabels {
  readonly connecting: string;
  readonly connected: string;
  readonly disconnected: string;
  readonly closed: string;
  readonly retry: string;
  readonly leave: string;
}

const DEFAULT_LABELS: MultiplayerConnectionOverlayLabels = {
  connecting: "멀티플레이 서버에 연결 중입니다.",
  connected: "서버 연결됨",
  disconnected: "서버 연결이 끊어졌습니다.",
  closed: "멀티플레이 방이 종료되었습니다.",
  retry: "다시 연결",
  leave: "나가기",
};

export interface MultiplayerConnectionOverlayProps {
  readonly state: MultiplayerParentConnectionState;
  readonly labels?: Partial<MultiplayerConnectionOverlayLabels>;
  readonly onRetry?: () => void;
  readonly onLeave?: () => void;
  readonly hideConnectedStatus?: boolean;
}

/** Trusted parent connection surface. It never accepts a ticket, socket URL, or game result. */
export function MultiplayerConnectionOverlay({
  state,
  labels: labelOverrides,
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
        : labels.closed;

  return (
    <section
      role={state.status === "CONNECTING" ? "status" : "alert"}
      aria-live="assertive"
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-sm rounded-3xl border border-border bg-surface-raised p-6 text-center shadow-2xl">
        <p className="font-bold text-text-primary">{title}</p>
        {(state.status === "DISCONNECTED" || state.status === "CLOSED") && (
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
