import { useEffect, useMemo, useState } from "react";
import {
  ClipboardCheck,
  FileClock,
  LayoutDashboard,
  RadioTower,
  RefreshCw,
  Settings2,
  ShieldAlert,
  Users,
  X,
} from "lucide-react";
import {
  StreamerAdminActionRequestSchema,
  type StreamerAdminAction,
  type StreamerAdminActionRequest,
  type StreamerAdminSection,
  type StreamerAdminWorkspaceData,
  type StreamerAdminWorkspaceQuery,
} from "@owogg/contracts";
import {
  canPerformStreamerAdminAction,
  canViewStreamerAdminSection,
  formatStreamerDateTime,
  STREAMER_ADMIN_SECTION_LABELS,
} from "../../../features/streamers/adminStreamerViewModel";
import { StreamerAdminAudit } from "./StreamerAdminAudit";
import { StreamerAdminOverview } from "./StreamerAdminOverview";
import { StreamerAdminPolicy } from "./StreamerAdminPolicy";
import { StreamerAdminProviders } from "./StreamerAdminProviders";
import { StreamerAdminReviews } from "./StreamerAdminReviews";
import { StreamerAdminRoster } from "./StreamerAdminRoster";
import {
  StreamerActionButton,
  StreamerBadge,
  StreamerErrorBanner,
  StreamerPanel,
  type StreamerActionControls,
  type StreamerActionIntent,
} from "./StreamerAdminShared";

const SECTIONS: StreamerAdminSection[] = [
  "OVERVIEW",
  "STREAMERS",
  "REVIEWS",
  "POLICY",
  "PROVIDERS",
  "AUDIT",
];

const SECTION_ICONS = {
  OVERVIEW: LayoutDashboard,
  STREAMERS: Users,
  REVIEWS: ClipboardCheck,
  POLICY: Settings2,
  PROVIDERS: RadioTower,
  AUDIT: FileClock,
} as const;

export function StreamerAdminWorkspace({
  data,
  query,
  loading = false,
  error = null,
  currentReviewerUserId = null,
  onQueryChange,
  onRefresh,
  onAction,
}: {
  data: StreamerAdminWorkspaceData;
  query: StreamerAdminWorkspaceQuery;
  loading?: boolean;
  error?: string | null;
  currentReviewerUserId?: number | null;
  onQueryChange: (patch: Partial<StreamerAdminWorkspaceQuery>) => void;
  onRefresh?: () => void;
  onAction?: (request: StreamerAdminActionRequest) => Promise<void>;
}) {
  const visibleSections = useMemo(
    () => SECTIONS.filter((section) => canViewStreamerAdminSection(data.permissions, section)),
    [data.permissions],
  );
  const [section, setSection] = useState<StreamerAdminSection>(visibleSections[0] ?? "OVERVIEW");
  const [intent, setIntent] = useState<StreamerActionIntent | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!visibleSections.includes(section)) setSection(visibleSections[0] ?? "OVERVIEW");
  }, [section, visibleSections]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const actionDisabledReason = (action: StreamerAdminAction) => {
    if (!canPerformStreamerAdminAction(data.permissions, action)) {
      return "이 작업에 필요한 권한이 없습니다.";
    }
    if (!onAction) return "작업 처리기가 연결되지 않았습니다.";
    return null;
  };
  const actions: StreamerActionControls = {
    requestAction: setIntent,
    isActionEnabled: (action) => actionDisabledReason(action) === null,
    actionDisabledReason,
  };

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-6 md:px-8 md:py-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-brand-light">
            <ShieldAlert className="h-5 w-5" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em]">
              Streamer Operations
            </span>
            <StreamerBadge tone="success">LIVE</StreamerBadge>
          </div>
          <h1 className="mt-2 text-2xl font-black text-text-primary">스트리머 관리 및 심사</h1>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-text-muted">
            별도 등급 없이 모든 승인 대상을 스트리머로 관리합니다. 한 사용자가 여러 플랫폼을
            연결하면 플랫폼마다 같은 수동 심사를 독립적으로 처리합니다.
          </p>
          <p className="mt-2 text-[10px] text-text-muted">
            데이터 생성 {formatStreamerDateTime(data.generatedAt)}
          </p>
        </div>
        <StreamerActionButton disabled={!onRefresh || loading} onClick={() => onRefresh?.()}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> 새로고침
        </StreamerActionButton>
      </header>

      {error && <StreamerErrorBanner>{error}</StreamerErrorBanner>}
      <nav
        aria-label="스트리머 관리 섹션"
        className="flex gap-1 overflow-x-auto rounded-2xl border border-border bg-surface-raised p-1.5"
      >
        {visibleSections.map((item) => {
          const Icon = SECTION_ICONS[item];
          const active = item === section;
          return (
            <button
              key={item}
              type="button"
              onClick={() => setSection(item)}
              aria-current={active ? "page" : undefined}
              className={`flex min-w-max flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-[11px] font-black transition-colors focus:outline-none focus:ring-2 focus:ring-brand ${active ? "bg-brand text-white shadow-lg shadow-brand/20" : "text-text-muted hover:bg-surface hover:text-text-primary"}`}
            >
              <Icon className="h-3.5 w-3.5" /> {STREAMER_ADMIN_SECTION_LABELS[item]}
            </button>
          );
        })}
      </nav>

      <div className={loading ? "pointer-events-none opacity-60" : ""} aria-busy={loading}>
        {data.sectionSources[section] === "UNAVAILABLE" ? (
          <StreamerPanel className="p-8 text-center text-xs text-text-muted">
            이 섹션의 서버 데이터를 사용할 수 없습니다.
          </StreamerPanel>
        ) : section === "OVERVIEW" ? (
          <StreamerAdminOverview
            data={data}
            onNavigate={setSection}
            onPageChange={(page, pageSize) =>
              onQueryChange({ overviewPage: page, overviewPageSize: pageSize })
            }
          />
        ) : section === "STREAMERS" ? (
          <StreamerAdminRoster
            data={data}
            query={query}
            actions={actions}
            onQueryChange={onQueryChange}
          />
        ) : section === "REVIEWS" ? (
          <StreamerAdminReviews
            data={data}
            query={query}
            actions={actions}
            currentReviewerUserId={currentReviewerUserId}
            onQueryChange={onQueryChange}
          />
        ) : section === "POLICY" ? (
          <StreamerAdminPolicy
            data={data}
            query={query}
            actions={actions}
            onQueryChange={onQueryChange}
          />
        ) : section === "PROVIDERS" ? (
          <StreamerAdminProviders data={data} actions={actions} />
        ) : (
          <StreamerAdminAudit data={data} query={query} onQueryChange={onQueryChange} />
        )}
      </div>

      {intent && (
        <StreamerActionDialog
          intent={intent}
          onClose={() => setIntent(null)}
          onSubmit={async (request) => {
            if (!onAction) return;
            await onAction(request);
            setIntent(null);
            setToast(`${intent.title} 작업을 처리했습니다.`);
          }}
        />
      )}
      {toast && (
        <div
          role="status"
          className="fixed bottom-5 right-5 z-[70] max-w-sm rounded-2xl border border-accent-green/30 bg-surface-overlay px-4 py-3 text-xs font-bold text-accent-green shadow-2xl"
        >
          {toast}
        </div>
      )}
    </div>
  );
}

function StreamerActionDialog({
  intent,
  onClose,
  onSubmit,
}: {
  intent: StreamerActionIntent;
  onClose: () => void;
  onSubmit: (request: StreamerAdminActionRequest) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [effectiveAt, setEffectiveAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const effectiveAtMissing = intent.effectiveAt === "REQUIRED" && effectiveAt === "";
  const effectiveAtLabel =
    intent.action === "HOLD_REVIEW"
      ? "보류 종료 시각"
      : intent.action === "SUSPEND_STREAMER"
        ? "활동 중단 종료 시각"
        : "적용 시각";

  const submit = async () => {
    setDialogError(null);
    const effectiveAtValue = effectiveAt ? new Date(effectiveAt) : null;
    if (effectiveAtValue && Number.isNaN(effectiveAtValue.getTime())) {
      setDialogError("유효한 날짜와 시각을 입력하세요.");
      return;
    }
    const effectiveAtIso = effectiveAtValue?.toISOString() ?? null;
    const parsed = StreamerAdminActionRequestSchema.safeParse({
      action: intent.action,
      targetId: intent.targetId,
      expectedVersion: intent.expectedVersion,
      reason,
      internalNote: internalNote.trim() ? internalNote : null,
      effectiveAt: effectiveAtIso,
      policyValues: intent.policyValues ?? null,
    });
    if (!parsed.success) {
      setDialogError(parsed.error.issues[0]?.message ?? "요청 값을 확인하세요.");
      return;
    }
    setBusy(true);
    try {
      await onSubmit(parsed.data);
    } catch (caught) {
      setDialogError(caught instanceof Error ? caught.message : "요청 처리에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/75 backdrop-blur-sm"
        onClick={busy ? undefined : onClose}
        aria-label="작업 확인 닫기"
      />
      <div className="relative z-10 w-full max-w-lg rounded-3xl border border-border bg-surface-overlay p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            {intent.danger && <StreamerBadge tone="danger">주의 작업</StreamerBadge>}
            <h2 className="mt-3 text-lg font-black text-text-primary">{intent.title}</h2>
            <p className="mt-2 text-xs leading-5 text-text-muted">{intent.description}</p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-xl border border-border p-2 text-text-muted"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="text-[11px] font-black text-text-secondary">결정 사유 · 필수</span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={1000}
              rows={3}
              placeholder="정책과 증거에 근거해 3자 이상 입력하세요."
              className="mt-2 w-full resize-y rounded-xl border border-border bg-surface px-3 py-2.5 text-xs text-text-primary outline-none focus:border-brand"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-black text-accent-yellow">
              내부 메모 · 사용자 비공개
            </span>
            <textarea
              value={internalNote}
              onChange={(event) => setInternalNote(event.target.value)}
              maxLength={1000}
              rows={2}
              className="mt-2 w-full resize-y rounded-xl border border-accent-yellow/20 bg-accent-yellow/5 px-3 py-2.5 text-xs text-text-primary outline-none"
            />
          </label>
          {intent.effectiveAt && (
            <label className="block">
              <span className="text-[11px] font-black text-text-secondary">
                {effectiveAtLabel} {intent.effectiveAt === "REQUIRED" ? "· 필수" : "· 선택"}
              </span>
              <input
                type="datetime-local"
                value={effectiveAt}
                onChange={(event) => setEffectiveAt(event.target.value)}
                className="mt-2 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-xs text-text-primary"
              />
            </label>
          )}
        </div>
        {dialogError && (
          <p className="mt-4 rounded-xl border border-accent-red/30 bg-accent-red/10 p-3 text-[10px] text-accent-red">
            {dialogError}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <StreamerActionButton disabled={busy} onClick={onClose}>
            취소
          </StreamerActionButton>
          <StreamerActionButton
            tone={intent.danger ? "danger" : "primary"}
            disabled={busy || reason.trim().length < 3 || effectiveAtMissing}
            onClick={() => void submit()}
          >
            {busy ? "처리 중..." : "사유와 함께 실행"}
          </StreamerActionButton>
        </div>
      </div>
    </div>
  );
}
