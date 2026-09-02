import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { useNavigate, useParams } from "react-router";
import type { SandboxGamePreviewSessionResponse } from "@owogg/contracts";
import { createDevGamePreview, submitDevGameDraft } from "../features/devApi";
import { IframeRuntime } from "../features/game/runtime/IframeRuntime";
import { gamePreviewUrl } from "../lib/api/config";

export function meta() {
  return [
    { title: "비공개 게임 미리보기 | OwOGG" },
    { name: "robots", content: "noindex,nofollow,noarchive" },
  ];
}

/** Dedicated full-viewport confirmation surface for one immutable B2 draft. No score/session
 * acceptance is wired here: the Bridge is used only to prove the iframe finished loading before
 * the explicit review-submit action becomes available. */
export default function GameCreatorPreviewRoute() {
  const params = useParams();
  const navigate = useNavigate();
  const gameId = Number(params.gameId);
  const versionId = Number(params.versionId);
  const [preview, setPreview] = useState<SandboxGamePreviewSessionResponse | null>(null);
  const [attemptKey, setAttemptKey] = useState(0);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPreview = useCallback(async () => {
    if (
      !Number.isSafeInteger(gameId) ||
      gameId <= 0 ||
      !Number.isSafeInteger(versionId) ||
      versionId <= 0
    ) {
      setError("올바르지 않은 게임 초안 경로입니다.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setReady(false);
    setError(null);
    try {
      const issued = await createDevGamePreview(gameId, versionId);
      setPreview(issued);
      setAttemptKey((current) => current + 1);
    } catch (cause) {
      setPreview(null);
      setError(cause instanceof Error ? cause.message : "미리보기를 열 수 없습니다.");
    } finally {
      setLoading(false);
    }
  }, [gameId, versionId]);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  const submit = async () => {
    if (!preview || !ready || submitting) return;
    if (!window.confirm("현재 미리보기 버전을 관리자 심사에 제출할까요?")) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitDevGameDraft(gameId, versionId, preview.previewToken);
      window.alert("확인한 초안을 관리자 심사에 제출했습니다.");
      navigate("/game-creator", { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "심사 제출에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="fixed inset-0 z-[100] bg-black text-white">
      {preview && (
        <IframeRuntime
          src={gamePreviewUrl(preview.previewPath)}
          title={`게임 #${gameId} 초안 v${versionId} 미리보기`}
          autoStart
          attemptKey={attemptKey}
          className="h-full"
          frameClassName="h-full w-full"
          onReady={() => setReady(true)}
          onError={(message) => setError(message || "게임 실행 중 오류가 발생했습니다.")}
        />
      )}

      {(loading || !preview) && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-raised">
          <div className="max-w-md px-6 text-center">
            {loading ? (
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand-light" />
            ) : (
              <ShieldCheck className="mx-auto h-9 w-9 text-text-muted" />
            )}
            <p className="mt-4 text-sm font-bold text-text-primary">
              {loading ? "B2 초안을 불러오는 중..." : error || "미리보기를 열 수 없습니다."}
            </p>
            {!loading && (
              <button
                type="button"
                onClick={() => void loadPreview()}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-xs font-bold text-white hover:bg-brand-light"
              >
                <RefreshCw className="h-4 w-4" /> 다시 시도
              </button>
            )}
          </div>
        </div>
      )}

      <div className="absolute left-3 right-3 top-3 z-20 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/15 bg-black/75 p-2 shadow-2xl backdrop-blur md:left-5 md:right-5 md:top-5">
        <button
          type="button"
          onClick={() => navigate("/game-creator")}
          className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-white/80 hover:bg-white/10 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" /> 업로드 화면
        </button>
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-xs font-black">
            비공개 초안 #{gameId} · 버전 {versionId}
          </p>
          <p className="text-[10px] text-white/60">
            {ready ? "실행 확인 완료 · 제출 가능" : "게임 실행을 확인하는 중입니다"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadPreview()}
            disabled={loading || submitting}
            title="새 미리보기 세션으로 다시 불러오기"
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 px-3 py-2 text-xs font-bold text-white/80 hover:bg-white/10 disabled:opacity-40"
          >
            <RefreshCw className="h-3.5 w-3.5" /> 다시 불러오기
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!ready || !preview || submitting}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-3 py-2 text-xs font-black text-white hover:bg-brand-light disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" />
            )}
            확인 후 심사 제출
          </button>
        </div>
      </div>

      {error && preview && (
        <p className="absolute bottom-4 left-1/2 z-20 max-w-xl -translate-x-1/2 rounded-xl border border-accent-red/40 bg-black/80 px-4 py-2 text-center text-xs font-bold text-accent-red backdrop-blur">
          {error}
        </p>
      )}
    </main>
  );
}
