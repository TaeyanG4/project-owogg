import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Check, Clock3, ShieldAlert, X } from "lucide-react";
import { useAuth } from "../features/auth";
import {
  applyManualStreamerReviewApi,
  fetchManualStreamerReviewsApi,
} from "../features/streamers/adminStreamerApi";
import type {
  StreamerManualReviewAction,
  StreamerManualReviewQueueResponse,
} from "@owogg/contracts";
import { ApiClientError } from "../lib/api";

export function meta() {
  return [
    { title: "Streamer 수동 심사 | OwOGG" },
    { name: "description", content: "OwOGG Featured Streamer 수동 심사" },
    { name: "robots", content: "noindex,nofollow" },
  ];
}

export default function AdminStreamersRoute() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [data, setData] = useState<StreamerManualReviewQueueResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [busyJobId, setBusyJobId] = useState<number | null>(null);

  const loadQueue = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchManualStreamerReviewsApi());
    } catch (err) {
      if (err instanceof ApiClientError && (err.status === 401 || err.status === 403)) {
        setAccessDenied(true);
        setError(
          err.code === "ADMIN_SESSION_REQUIRED"
            ? "관리자 로그인이 필요합니다. /admin 에서 본인 확인을 먼저 완료해주세요."
            : "이 페이지는 지정된 OwOGG 관리자만 사용할 수 있습니다.",
        );
      } else {
        setError(err instanceof Error ? err.message : "수동 심사 큐를 불러올 수 없습니다.");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && isAuthenticated) void loadQueue();
  }, [authLoading, isAuthenticated]);

  const handleAction = async (jobId: number, action: StreamerManualReviewAction) => {
    const reason = reasons[jobId]?.trim() ?? "";
    if (reason.length < 3) {
      setError("각 수동 심사 결정에는 3자 이상의 명시적인 사유가 필요합니다.");
      return;
    }

    setBusyJobId(jobId);
    setError(null);
    try {
      await applyManualStreamerReviewApi(jobId, { action, reason });
      setReasons((previous) =>
        Object.fromEntries(Object.entries(previous).filter(([key]) => Number(key) !== jobId)),
      );
      await loadQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : "수동 심사 결정에 실패했습니다.");
    } finally {
      setBusyJobId(null);
    }
  };

  if (authLoading) {
    return <PageMessage>접근 권한을 확인하는 중...</PageMessage>;
  }

  if (!isAuthenticated) {
    return (
      <PageMessage>
        관리자 심사 도구를 사용하려면 <Link to="/profile">OwOGG 로그인</Link>이 필요합니다.
      </PageMessage>
    );
  }

  if (accessDenied) {
    return (
      <PageMessage>
        <h1 className="text-lg font-black text-text-primary">접근 권한이 없습니다</h1>
        <p className="mt-2 text-sm text-text-muted">
          지정된 OwOGG 관리자 계정만 Streamer 심사를 진행할 수 있습니다.
        </p>
        <Link
          to="/admin"
          className="mt-6 inline-flex rounded-xl bg-brand px-4 py-2.5 text-xs font-bold text-white hover:bg-brand-light focus:outline-none focus:ring-2 focus:ring-brand"
        >
          관리자 센터로 돌아가기
        </Link>
      </PageMessage>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 md:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-accent-yellow">
            <ShieldAlert className="h-5 w-5" />
            <span className="text-xs font-bold uppercase tracking-[0.2em]">Admin Safety</span>
          </div>
          <h1 className="text-2xl font-black text-text-primary">Streamer 수동 심사</h1>
          <p className="mt-1 text-xs text-text-muted">
            소유권과 Featured 자격 데이터만 표시합니다. 모든 결정은 감사 원장에 기록됩니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadQueue()}
          className="rounded-xl border border-border bg-surface-raised px-3 py-2 text-xs font-bold text-text-primary hover:border-brand focus:outline-none focus:ring-2 focus:ring-brand"
        >
          새로고침
        </button>
      </header>

      {error && (
        <div className="rounded-2xl border border-accent-red/30 bg-accent-red/10 p-4 text-xs text-accent-red">
          {error}
        </div>
      )}

      {loading && !data ? (
        <PageMessage>수동 심사 큐를 불러오는 중...</PageMessage>
      ) : data ? (
        <>
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Clock3 className="h-4 w-4 text-accent-yellow" />
              <h2 className="text-sm font-bold text-text-primary">
                대기 중인 수동 심사 ({data.total})
              </h2>
            </div>
            {data.items.length === 0 ? (
              <div className="rounded-2xl border border-border bg-surface-raised p-6 text-sm text-text-muted">
                현재 대기 중인 수동 심사가 없습니다.
              </div>
            ) : (
              data.items.map((item) => {
                const reason = reasons[item.job.id] ?? "";
                const disabled = busyJobId === item.job.id || reason.trim().length < 3;
                return (
                  <article
                    key={item.job.id}
                    className="rounded-2xl border border-border bg-surface-raised p-5 shadow-md"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-black text-text-primary">
                          {item.nickname} · {item.platformAccount.platform}
                        </p>
                        <a
                          href={item.platformAccount.channelUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-bold text-brand-light hover:underline"
                        >
                          {item.platformAccount.channelName} ↗
                        </a>
                      </div>
                      <span className="rounded-full border border-accent-yellow/30 bg-accent-yellow/10 px-2.5 py-1 text-[10px] font-bold text-accent-yellow">
                        {item.job.reviewType === "REVALIDATION" ? "재검증" : "취득 심사"} · 수동
                        확인
                      </span>
                    </div>

                    <dl className="mt-4 grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
                      <DataPoint
                        label="소유권"
                        value={`${item.streamerStatus} / ${item.platformAccount.verificationStatus}`}
                      />
                      <DataPoint
                        label="구독자/팔로워"
                        value={
                          item.platformAccount.audienceCount === null
                            ? "확인 불가"
                            : `${item.platformAccount.audienceCount.toLocaleString()}명`
                        }
                      />
                      <DataPoint
                        label="채널 생성일"
                        value={item.platformAccount.channelCreatedAt?.split("T")[0] ?? "확인 불가"}
                      />
                      <DataPoint
                        label="최근 지표 동기화"
                        value={item.platformAccount.metricsSyncedAt?.split("T")[0] ?? "없음"}
                      />
                    </dl>
                    <p className="mt-4 rounded-xl bg-surface px-3 py-2 text-xs text-text-muted">
                      시스템 사유: {item.job.reviewReason ?? "추가 확인 필요"}
                    </p>

                    <div className="mt-4 space-y-2">
                      <label
                        className="block text-xs font-bold text-text-primary"
                        htmlFor={`reason-${item.job.id}`}
                      >
                        결정 사유 (필수)
                      </label>
                      <textarea
                        id={`reason-${item.job.id}`}
                        value={reason}
                        onChange={(event) =>
                          setReasons((previous) => ({
                            ...previous,
                            [item.job.id]: event.target.value,
                          }))
                        }
                        maxLength={1000}
                        rows={2}
                        placeholder="공식 지표와 소유권 확인 결과를 근거로 입력하세요."
                        className="w-full resize-y rounded-xl border border-border bg-surface px-3 py-2 text-xs text-text-primary outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                      />
                      <div className="flex flex-wrap gap-2">
                        <ActionButton
                          label="Featured 승인"
                          icon={<Check className="h-3.5 w-3.5" />}
                          disabled={
                            disabled || item.platformAccount.verificationStatus !== "VERIFIED"
                          }
                          onClick={() => void handleAction(item.job.id, "APPROVE_FEATURED")}
                          className="bg-accent-green/15 text-accent-green hover:bg-accent-green/25"
                        />
                        <ActionButton
                          label="기준 미달 처리"
                          icon={<X className="h-3.5 w-3.5" />}
                          disabled={disabled}
                          onClick={() => void handleAction(item.job.id, "REJECT_FEATURED")}
                          className="bg-accent-red/15 text-accent-red hover:bg-accent-red/25"
                        />
                        <ActionButton
                          label="검토 유지"
                          icon={<Clock3 className="h-3.5 w-3.5" />}
                          disabled={disabled}
                          onClick={() => void handleAction(item.job.id, "KEEP_FOR_REVIEW")}
                          className="bg-accent-yellow/15 text-accent-yellow hover:bg-accent-yellow/25"
                        />
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-bold text-text-primary">최근 감사 이력</h2>
            <div className="overflow-x-auto rounded-2xl border border-border bg-surface-raised">
              {data.audits.entries.length === 0 ? (
                <p className="p-5 text-xs text-text-muted">아직 수동 결정 이력이 없습니다.</p>
              ) : (
                <table className="w-full min-w-[680px] text-left text-xs">
                  <thead className="border-b border-border text-text-muted">
                    <tr>
                      <th className="px-4 py-3">시각</th>
                      <th className="px-4 py-3">플랫폼</th>
                      <th className="px-4 py-3">액션</th>
                      <th className="px-4 py-3">상태 전이</th>
                      <th className="px-4 py-3">사유</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.audits.entries.map((audit) => (
                      <tr key={audit.id} className="border-b border-border/60 last:border-0">
                        <td className="whitespace-nowrap px-4 py-3 text-text-muted">
                          {audit.createdAt.replace("T", " ").slice(0, 16)}
                        </td>
                        <td className="px-4 py-3 font-bold text-text-primary">
                          {audit.platform ?? "-"}
                        </td>
                        <td className="px-4 py-3 text-text-primary">{audit.action}</td>
                        <td className="px-4 py-3 text-text-muted">
                          {audit.previousStatus} → {audit.newStatus}
                        </td>
                        <td className="max-w-[320px] px-4 py-3 text-text-muted">{audit.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function PageMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-20 text-center text-sm text-text-muted">
      {children}
    </div>
  );
}

function DataPoint({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface p-3">
      <dt className="text-[10px] font-bold text-text-muted">{label}</dt>
      <dd className="mt-1 break-words font-bold text-text-primary">{value}</dd>
    </div>
  );
}

function ActionButton({
  label,
  icon,
  disabled,
  onClick,
  className,
}: {
  label: string;
  icon: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
  className: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-brand disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    >
      {icon}
      {label}
    </button>
  );
}
