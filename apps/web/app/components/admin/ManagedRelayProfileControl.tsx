import { useCallback, useEffect, useState } from "react";
import { Loader2, Network, Play, Power, RefreshCw, ShieldCheck } from "lucide-react";
import type { AdminManagedMultiplayerExactVersionResponse } from "@owogg/contracts";
import {
  fetchManagedMultiplayerExactVersion,
  postManagedMultiplayerProfileActivation,
  postManagedMultiplayerProfileReview,
} from "../../features/adminApi";
import { MultiplayerGameSurface } from "../../features/game/runtime/MultiplayerGameSurface";

const ignoreMultiplayerRuntimeResolution = () => undefined;

function requestStatusMessage(control: AdminManagedMultiplayerExactVersionResponse): string {
  if (control.gameVersionId === null) return "현재 라이브 게임 버전이 없습니다.";
  const request = control.request;
  if (!request) return "현재 라이브 ZIP은 online Relay를 요청하지 않았습니다.";
  if (request.status === "REJECTED") {
    return "이 버전의 Relay 요청은 거절되었습니다. 변경된 ZIP을 새 버전으로 등록해야 합니다.";
  }
  if (request.status === "WITHDRAWN") {
    return "이 버전의 Relay 요청은 철회되었습니다. 변경된 ZIP을 새 버전으로 등록해야 합니다.";
  }
  if (request.resolution.status === "RUNTIME_NOT_AVAILABLE") {
    return `${request.resolution.runtimeKind} runtime은 아직 활성화할 수 없습니다.`;
  }
  if (request.resolution.status === "CAPABILITY_NOT_AVAILABLE") {
    return `아직 지원하지 않는 Relay 기능: ${request.resolution.unsupportedCapabilities.join(
      ", ",
    )}`;
  }
  if (request.status === "PENDING_REVIEW") {
    return "현재 exact-version Relay 요청이 승인 대기 중입니다.";
  }
  if (!control.profile) {
    return "승인 기록은 있지만 Relay 프로필 생성이 완료되지 않았습니다.";
  }
  return control.profile.enabled
    ? "현재 exact-version Relay 프로필이 활성화되어 새 방을 만들 수 있습니다."
    : "승인된 exact-version Relay 프로필이 비활성 상태입니다.";
}

export function ManagedRelayProfileControl({
  gameSlug,
  title,
  viewer,
  showTester,
}: {
  readonly gameSlug: string;
  readonly title: string;
  readonly viewer: { readonly nickname: string; readonly avatarUrl: string | null } | null;
  readonly showTester: boolean;
}) {
  const [control, setControl] = useState<AdminManagedMultiplayerExactVersionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"REVIEW" | "ACTIVATION" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testerOpen, setTesterOpen] = useState(false);
  const [attemptKey, setAttemptKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setControl(await fetchManagedMultiplayerExactVersion(gameSlug));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Relay 운영 상태를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [gameSlug]);

  useEffect(() => {
    setTesterOpen(false);
    void load();
  }, [load]);

  const approve = async () => {
    const request = control?.request;
    if (!request) return;
    const message =
      request.status === "APPROVED"
        ? `버전 #${request.gameVersionId}의 비활성 Relay 프로필 생성을 복구할까요?`
        : `버전 #${request.gameVersionId}의 exact-version Relay 요청을 승인할까요? 프로필 활성화는 다음 단계에서 별도로 수행합니다.`;
    if (!window.confirm(message)) return;
    setBusy("REVIEW");
    setError(null);
    try {
      await postManagedMultiplayerProfileReview(request.id);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Relay 요청을 승인하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  };

  const toggleProfile = async () => {
    const profile = control?.profile;
    if (!profile) return;
    const enabled = !profile.enabled;
    if (
      !window.confirm(
        enabled
          ? `프로필 #${profile.id}를 활성화해 이 버전의 새 Relay 방 생성을 허용할까요?`
          : `프로필 #${profile.id}를 비활성화해 이 버전의 새 Relay 방 생성을 차단할까요?`,
      )
    ) {
      return;
    }
    setBusy("ACTIVATION");
    setError(null);
    try {
      await postManagedMultiplayerProfileActivation(
        profile.id,
        enabled,
        enabled ? null : "ADMIN_DISABLED",
      );
      if (!enabled) setTesterOpen(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Relay 프로필 상태를 바꾸지 못했습니다.");
    } finally {
      setBusy(null);
    }
  };

  const request = control?.request ?? null;
  const profile = control?.profile ?? null;
  const supported = request?.resolution.status === "SUPPORTED_V1";
  const canApprove =
    request !== null &&
    request.resolution.status === "SUPPORTED_V1" &&
    (request.status === "PENDING_REVIEW" || (request.status === "APPROVED" && !profile));

  return (
    <section className="mt-4 border-t border-border pt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h5 className="flex items-center gap-1.5 text-xs font-black text-text-primary">
            <Network className="h-3.5 w-3.5" /> 온라인 Relay 운영
          </h5>
          <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-text-muted">
            현재 라이브 버전의 manifest 요청을 확인합니다. 승인은 비활성 프로필만 만들고, 새 방
            허용은 별도 활성화로 결정합니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || busy !== null}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-bold text-text-primary hover:border-brand disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> 상태 새로고침
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-xl border border-accent-red/30 bg-accent-red/10 px-3 py-2 text-xs text-accent-red">
          {error}
        </p>
      )}

      {loading && !control ? (
        <p className="mt-3 text-xs text-text-muted">현재 버전의 Relay 상태를 확인하는 중...</p>
      ) : control ? (
        <div className="mt-3 rounded-xl border border-border bg-surface-raised p-3">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <strong className="text-text-primary">
              {control.gameVersionId === null
                ? "라이브 버전 없음"
                : `버전 #${control.gameVersionId}`}
            </strong>
            {request && <span className="text-text-muted">요청 #{request.id}</span>}
            {profile && <span className="text-text-muted">프로필 #{profile.id}</span>}
            {profile?.enabled && (
              <span className="inline-flex items-center gap-1 rounded-full bg-accent-green/10 px-2 py-0.5 font-bold text-accent-green">
                <ShieldCheck className="h-3 w-3" /> 활성
              </span>
            )}
          </div>
          <p className="mt-2 text-[11px] text-text-muted">{requestStatusMessage(control)}</p>
          {request && (
            <p className="mt-1 break-all font-mono text-[10px] text-text-muted">
              sha256:{request.contentHash}
            </p>
          )}
          {supported && request && (
            <p className="mt-1 text-[11px] text-text-muted">
              Relay v{request.request.transport.protocolVersion} · {request.request.players.min}~
              {request.request.players.max}명 · reconnect {request.request.features.reconnect}
              {request.request.features.directMessages ? " · direct" : ""}
              {request.request.features.hostSnapshot ? " · host snapshot" : ""} · 결과 미검증
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {canApprove && request && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void approve()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-accent-green/30 bg-accent-green/10 px-3 py-2 text-xs font-bold text-accent-green disabled:opacity-50"
              >
                {busy === "REVIEW" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="h-3.5 w-3.5" />
                )}
                {request.status === "APPROVED" ? "프로필 생성 복구" : "Relay 요청 승인"}
              </button>
            )}
            {profile && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void toggleProfile()}
                className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold disabled:opacity-50 ${
                  profile.enabled
                    ? "border-accent-red/30 bg-accent-red/10 text-accent-red"
                    : "border-accent-green/30 bg-accent-green/10 text-accent-green"
                }`}
              >
                {busy === "ACTIVATION" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Power className="h-3.5 w-3.5" />
                )}
                {profile.enabled ? "Relay 비활성화" : "Relay 활성화"}
              </button>
            )}
            {showTester && profile?.enabled && (
              <button
                type="button"
                onClick={() => {
                  if (testerOpen) {
                    setTesterOpen(false);
                    return;
                  }
                  setAttemptKey((current) => current + 1);
                  setTesterOpen(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-3 py-2 text-xs font-bold text-white"
              >
                <Play className="h-3.5 w-3.5" />
                {testerOpen ? "테스터 닫기" : "테스터 열기"}
              </button>
            )}
          </div>
        </div>
      ) : null}

      {showTester && testerOpen && profile?.enabled && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-border">
          <MultiplayerGameSurface
            gameSlug={gameSlug}
            title={title}
            attemptKey={attemptKey}
            viewer={viewer}
            onRuntimeResolved={ignoreMultiplayerRuntimeResolution}
            frameClassName="min-h-[560px]"
            fallback={
              <div className="flex min-h-[320px] items-center justify-center bg-surface p-6 text-center text-sm text-text-secondary">
                활성화 상태가 바뀌었습니다. Relay 상태를 새로고침한 뒤 다시 시도하세요.
              </div>
            }
          />
        </div>
      )}
    </section>
  );
}
