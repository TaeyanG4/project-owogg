import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";
import {
  Ban,
  ChevronLeft,
  ChevronRight,
  Clock,
  History,
  Loader2,
  Lock,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserX,
} from "lucide-react";
import { useAuth } from "../features/auth";
import { fetchMyAccess } from "../features/myAccess";
import {
  fetchAdminUserList,
  fetchAdminUserDetail,
  postSuspendUser,
  postBanUser,
  postUnsuspendUser,
  postScoreSubmissionBlock,
  postResetUserScores,
  postRestoreUserScores,
  type AdminUserListParams,
} from "../features/adminApi";
import type {
  AdminUserSearchResponse,
  AdminUserDetailResponse,
  AdminUserPeriod,
  AdminUserSort,
  PermissionValue,
  UserSuspensionDurationDays,
} from "@owogg/contracts";
import { ApiClientError } from "../lib/api";

export function meta() {
  return [
    { title: "유저 관리 | OwOGG" },
    { name: "description", content: "OwOGG 사용자 검색, 정지/밴, 점수 제출 차단 및 롤백" },
    { name: "robots", content: "noindex,nofollow" },
  ];
}

const PAGE_SIZE = 20;

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: "bg-accent-green/10 text-accent-green",
  SUSPENDED: "bg-accent-yellow/10 text-accent-yellow",
  BANNED: "bg-accent-red/10 text-accent-red",
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "정상",
  SUSPENDED: "정지",
  BANNED: "영구 밴",
};

const ACTION_LABEL: Record<string, string> = {
  SUSPENDED: "임시정지",
  BANNED: "영구 밴",
  UNSUSPENDED: "정지 해제",
  SCORE_SUBMISSION_BLOCKED: "점수 제출 차단",
  SCORE_SUBMISSION_UNBLOCKED: "점수 제출 차단 해제",
  SCORES_RESET: "점수 초기화",
  SCORES_RESTORED: "점수 복구",
};

const PERIOD_OPTIONS: { value: AdminUserPeriod; label: string }[] = [
  { value: "all", label: "전체 기간" },
  { value: "today", label: "오늘 가입" },
  { value: "week", label: "이번 주 가입" },
  { value: "month", label: "이번 달 가입" },
];

const SORT_OPTIONS: { value: AdminUserSort; label: string }[] = [
  { value: "createdAt_desc", label: "최근 가입일순" },
  { value: "createdAt_asc", label: "최초 가입일순" },
];

const SUSPENSION_OPTIONS: { value: UserSuspensionDurationDays; label: string }[] = [
  { value: 7, label: "7일" },
  { value: 30, label: "30일" },
  { value: 180, label: "180일" },
];

function formatModerationDate(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function AdminUsersRoute() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  const [queryInput, setQueryInput] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [period, setPeriod] = useState<AdminUserPeriod>("all");
  const [sort, setSort] = useState<AdminUserSort>("createdAt_desc");
  const [page, setPage] = useState(1);

  const [list, setList] = useState<AdminUserSearchResponse | null>(null);
  const [listLoading, setListLoading] = useState(false);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<AdminUserDetailResponse | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [permissions, setPermissions] = useState<PermissionValue[]>([]);

  const listParams: AdminUserListParams = {
    query: activeQuery || undefined,
    period,
    sort,
    page,
    pageSize: PAGE_SIZE,
  };

  const loadList = async () => {
    setListLoading(true);
    setError(null);
    try {
      setList(await fetchAdminUserList(listParams));
    } catch (err) {
      if (err instanceof ApiClientError && (err.status === 401 || err.status === 403)) {
        setAccessDenied(true);
      }
      setError(err instanceof Error ? err.message : "목록을 불러오지 못했습니다.");
    } finally {
      setListLoading(false);
    }
  };

  // Any filter change starts back at page 1 — an old page number from a previous, larger result
  // set could otherwise land past the end of a narrower one.
  useEffect(() => {
    setPage(1);
  }, [activeQuery, period, sort]);

  useEffect(() => {
    if (authLoading || !isAuthenticated) return;
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isAuthenticated, activeQuery, period, sort, page]);

  useEffect(() => {
    if (authLoading || !isAuthenticated) return;
    void fetchMyAccess()
      .then((access) => setPermissions(access.permissions))
      .catch(() => setPermissions([]));
  }, [authLoading, isAuthenticated]);

  const handleSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    setActiveQuery(queryInput.trim());
  };

  const loadDetail = async (userId: number) => {
    setSelectedId(userId);
    setLoadingDetail(true);
    setError(null);
    try {
      setDetail(await fetchAdminUserDetail(userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "사용자 정보를 불러올 수 없습니다.");
    } finally {
      setLoadingDetail(false);
    }
  };

  // Every mutating action follows the same shape: run it, then reload this user's detail (and
  // the current list page) so the UI never shows stale moderation state after a click.
  const runAction = async (action: () => Promise<unknown>) => {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      await loadDetail(selectedId);
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "작업에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  if (authLoading) {
    return <PageMessage>접근 권한을 확인하는 중...</PageMessage>;
  }

  if (!isAuthenticated) {
    return (
      <PageMessage>
        유저 관리 도구를 사용하려면 <Link to="/profile">OwOGG 로그인</Link>이 필요합니다.
      </PageMessage>
    );
  }

  if (accessDenied) {
    return (
      <PageMessage>
        <h1 className="text-lg font-black text-text-primary">접근 권한이 없습니다</h1>
        <p className="mt-2 text-sm text-text-muted">
          지정된 OwOGG 관리자 계정만 유저 관리 도구를 사용할 수 있습니다.
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

  const total = list?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8 md:px-8">
      <header>
        <div className="mb-2 flex items-center gap-2 text-accent-yellow">
          <ShieldAlert className="h-5 w-5" />
          <span className="text-xs font-bold uppercase tracking-[0.2em]">Admin Safety</span>
        </div>
        <h1 className="text-2xl font-black text-text-primary">유저 관리</h1>
        <p className="mt-1 text-xs text-text-muted">
          닉네임/이메일 일부 또는 정확한 사용자 ID로 검색하세요. 정지/밴/점수 관련 조치는 모두
          사유가 필수이며 감사 로그에 영구 기록됩니다. 관리자 계정은 정지/차단 대상에서 자동으로
          제외됩니다.
        </p>
      </header>

      <section className="space-y-3 rounded-2xl border border-border bg-surface-raised p-4">
        <div className="flex flex-wrap items-end gap-3">
          <form
            onSubmit={handleSearchSubmit}
            className="flex min-w-[220px] flex-1 flex-col gap-1.5"
          >
            <span className="text-[11px] font-bold text-text-muted">검색</span>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                <input
                  type="text"
                  value={queryInput}
                  onChange={(e) => setQueryInput(e.target.value)}
                  placeholder="닉네임, 이메일 일부, 또는 사용자 ID"
                  className="w-full rounded-xl border border-border bg-surface py-2.5 pl-10 pr-4 text-sm text-text-primary outline-none focus:ring-2 focus:ring-brand"
                />
              </div>
              <button
                type="submit"
                disabled={listLoading}
                className="shrink-0 rounded-xl bg-brand px-4 py-2.5 text-xs font-bold text-white hover:bg-brand-light disabled:opacity-50"
              >
                {listLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "검색"}
              </button>
            </div>
          </form>

          <FilterField label="가입 시기">
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value as AdminUserPeriod)}
              className="rounded-xl border border-border bg-surface px-3 py-2.5 text-xs font-bold text-text-primary outline-none focus:ring-2 focus:ring-brand"
            >
              {PERIOD_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </FilterField>

          <FilterField label="정렬">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as AdminUserSort)}
              className="rounded-xl border border-border bg-surface px-3 py-2.5 text-xs font-bold text-text-primary outline-none focus:ring-2 focus:ring-brand"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </FilterField>
        </div>
      </section>

      {error && (
        <div className="rounded-2xl border border-accent-red/30 bg-accent-red/10 p-4 text-xs text-accent-red">
          {error}
        </div>
      )}

      {list && (
        <section className="space-y-3">
          <div className="flex items-center justify-between text-xs text-text-muted">
            <span>
              총 <span className="font-bold text-text-primary">{total.toLocaleString()}</span>명
            </span>
            {listLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          </div>

          <div className="overflow-x-auto rounded-2xl border border-border bg-surface-raised">
            {list.users.length === 0 ? (
              <p className="p-6 text-center text-xs text-text-muted">검색 결과가 없습니다.</p>
            ) : (
              <table className="w-full min-w-[560px] text-left text-xs">
                <thead className="border-b border-border text-text-muted">
                  <tr>
                    <th className="px-4 py-3 font-bold">사용자</th>
                    <th className="px-4 py-3 font-bold">이메일</th>
                    <th className="px-4 py-3 font-bold">가입일</th>
                    <th className="px-4 py-3 text-right font-bold">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {list.users.map((u) => (
                    <tr
                      key={u.id}
                      onClick={() => void loadDetail(u.id)}
                      className={`cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-surface-overlay ${
                        selectedId === u.id ? "bg-surface-overlay" : ""
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-text-primary">{u.nickname}</span>
                          <span className="shrink-0 text-[10px] font-bold text-text-muted">
                            #{u.id}
                          </span>
                          {u.isProtectedAdmin && <AdminBadge />}
                        </div>
                      </td>
                      <td className="max-w-[220px] truncate px-4 py-3 text-text-muted">
                        {u.email ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-text-muted">
                        {u.createdAt.split("T")[0]}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLE[u.moderationStatus]}`}
                        >
                          {STATUS_LABEL[u.moderationStatus] ?? u.moderationStatus}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {total > 0 && (
            <div className="flex items-center justify-between gap-3 text-xs text-text-muted">
              <span>
                {page} / {totalPages} 페이지
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={page <= 1 || listLoading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-raised text-text-primary hover:border-brand disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="이전 페이지"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages || listLoading}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-raised text-text-primary hover:border-brand disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="다음 페이지"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {loadingDetail && <PageMessage small>사용자 정보를 불러오는 중...</PageMessage>}

      {detail && !loadingDetail && (
        <UserDetailPanel
          detail={detail}
          busy={busy}
          permissions={permissions}
          runAction={runAction}
        />
      )}
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-bold text-text-muted">{label}</span>
      {children}
    </div>
  );
}

function AdminBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-[10px] font-bold text-brand-light">
      <Lock className="h-2.5 w-2.5" /> 관리자
    </span>
  );
}

function UserDetailPanel({
  detail,
  busy,
  permissions,
  runAction,
}: {
  detail: AdminUserDetailResponse;
  busy: boolean;
  permissions: PermissionValue[];
  runAction: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [suspendDays, setSuspendDays] = useState<UserSuspensionDurationDays>(7);
  const [suspendReason, setSuspendReason] = useState("");
  const [banReason, setBanReason] = useState("");
  const [scoreBlockReason, setScoreBlockReason] = useState("");
  const [resetReason, setResetReason] = useState("");

  const m = detail.moderation;
  const status = m?.status ?? "ACTIVE";
  const scoreBlocked = m?.scoreSubmissionBlocked ?? false;
  const canSuspend = permissions.includes("users.suspend");
  const canBan = permissions.includes("users.ban");
  const canModerateScores = permissions.includes("users.score_moderation");
  const canLiftCurrentStatus = status === "BANNED" ? canBan : canSuspend;

  return (
    <div className="flex flex-col gap-6 rounded-2xl border border-border bg-surface-raised p-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-black text-text-primary">{detail.nickname}</h2>
          <span className="text-xs font-bold text-text-muted">#{detail.id}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLE[status]}`}
          >
            {STATUS_LABEL[status] ?? status}
          </span>
          {scoreBlocked && (
            <span className="rounded-full bg-accent-red/10 px-2 py-0.5 text-[10px] font-bold text-accent-red">
              점수 제출 차단됨
            </span>
          )}
          {detail.isProtectedAdmin && <AdminBadge />}
        </div>
        <p className="mt-2 text-xs text-text-muted">
          {detail.email ?? "이메일 없음"} · 가입일 {detail.createdAt.split("T")[0]} · 연동:{" "}
          {detail.providers.length > 0 ? detail.providers.join(", ") : "없음"}
        </p>
        {m?.reason && <p className="mt-1.5 text-[11px] text-text-muted">최근 사유: {m.reason}</p>}
        {status === "SUSPENDED" && m?.suspendedUntil && (
          <p className="mt-1.5 flex items-center gap-1 text-[11px] text-accent-yellow">
            <Clock className="h-3 w-3" />
            {formatModerationDate(m.suspendedUntil)}까지 정지
          </p>
        )}
      </div>

      {/* Game bests — read-only context for the admin, not editable here. */}
      {detail.gameBests.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {detail.gameBests.map((b) => (
            <span
              key={b.gameId}
              className="rounded-full bg-surface px-3 py-1 text-[11px] font-bold text-text-secondary"
            >
              {b.gameId}: {b.formattedScore}
            </span>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 border-t border-border pt-6 md:grid-cols-2">
        {/* Suspend / Ban / Unsuspend */}
        <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
          <h3 className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wide text-text-primary">
            <UserX className="h-3.5 w-3.5" /> 계정 정지 및 밴
          </h3>

          {detail.isProtectedAdmin ? (
            <div className="flex items-start gap-2 rounded-lg border border-brand/30 bg-brand/5 p-3 text-[11px] text-text-secondary">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-light" />
              <span>
                이 계정은 OwOGG 관리자입니다. 관리자 계정은 정지/영구 밴 대상에서 제외되며,
                서버에서도 동일하게 거부됩니다.
              </span>
            </div>
          ) : status === "ACTIVE" ? (
            <>
              {canSuspend && (
                <div className="space-y-3">
                  <p className="text-[11px] font-bold text-text-muted">임시정지</p>
                  <LabeledField label="정지 기간" htmlFor="suspend-days">
                    <select
                      id="suspend-days"
                      value={suspendDays}
                      onChange={(e) =>
                        setSuspendDays(Number(e.target.value) as UserSuspensionDurationDays)
                      }
                      className="w-full rounded-lg border border-border bg-surface-raised px-2.5 py-2 text-xs text-text-primary"
                    >
                      {SUSPENSION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </LabeledField>
                  <LabeledField label="정지 사유 (필수)" htmlFor="suspend-reason">
                    <input
                      id="suspend-reason"
                      type="text"
                      placeholder="예: 어뷰징 신고 접수"
                      value={suspendReason}
                      onChange={(e) => setSuspendReason(e.target.value)}
                      className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs text-text-primary outline-none focus:ring-2 focus:ring-brand"
                    />
                  </LabeledField>
                  <ActionButton
                    label="임시정지 적용"
                    icon={<Clock className="h-3.5 w-3.5" />}
                    disabled={busy || !suspendReason.trim()}
                    tone="yellow"
                    onClick={() =>
                      void runAction(() => postSuspendUser(detail.id, suspendDays, suspendReason))
                    }
                  />
                </div>
              )}

              {canBan && (
                <div className="space-y-3 border-t border-border/60 pt-3">
                  <p className="text-[11px] font-bold text-text-muted">영구 밴</p>
                  <LabeledField label="영구 밴 사유 (필수)" htmlFor="ban-reason">
                    <input
                      id="ban-reason"
                      type="text"
                      placeholder="예: 반복 어뷰징 확인"
                      value={banReason}
                      onChange={(e) => setBanReason(e.target.value)}
                      className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs text-text-primary outline-none focus:ring-2 focus:ring-brand"
                    />
                  </LabeledField>
                  <ActionButton
                    label="영구 밴 적용"
                    icon={<Ban className="h-3.5 w-3.5" />}
                    disabled={busy || !banReason.trim()}
                    tone="red"
                    onClick={() => {
                      if (
                        !window.confirm(
                          `${detail.nickname} #${detail.id} 계정을 영구 밴하시겠습니까? 기존 로그인 세션이 즉시 종료됩니다.`,
                        )
                      ) {
                        return;
                      }
                      void runAction(() => postBanUser(detail.id, banReason));
                    }}
                  />
                </div>
              )}

              {!canSuspend && !canBan && (
                <p className="rounded-lg border border-border bg-surface-raised p-3 text-[11px] text-text-muted">
                  이 계정은 조회만 가능합니다. 임시정지 또는 영구 밴 권한이 필요합니다.
                </p>
              )}
            </>
          ) : canLiftCurrentStatus ? (
            <ActionButton
              label={status === "BANNED" ? "밴 해제" : "정지 해제"}
              icon={<ShieldCheck className="h-3.5 w-3.5" />}
              disabled={busy}
              tone="green"
              onClick={() => void runAction(() => postUnsuspendUser(detail.id))}
            />
          ) : (
            <p className="rounded-lg border border-border bg-surface-raised p-3 text-[11px] text-text-muted">
              {status === "BANNED"
                ? "밴 해제에는 영구 밴 권한이 필요합니다."
                : "정지 해제 권한이 없습니다."}
            </p>
          )}
        </div>

        {/* Score-submission block + reset/restore */}
        <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
          <h3 className="text-xs font-black uppercase tracking-wide text-text-primary">
            점수 관리
          </h3>

          {!canModerateScores ? (
            <p className="rounded-lg border border-border bg-surface-raised p-3 text-[11px] text-text-muted">
              점수 조치 권한이 없어 현재 상태만 조회할 수 있습니다.
            </p>
          ) : (
            <>
              <div className="space-y-3">
                <p className="text-[11px] font-bold text-text-muted">점수 제출 차단</p>
                {!scoreBlocked ? (
                  <>
                    <LabeledField label="차단 사유 (필수)" htmlFor="score-block-reason">
                      <input
                        id="score-block-reason"
                        type="text"
                        placeholder="예: 비정상 점수 패턴"
                        value={scoreBlockReason}
                        onChange={(e) => setScoreBlockReason(e.target.value)}
                        className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs text-text-primary outline-none focus:ring-2 focus:ring-brand"
                      />
                    </LabeledField>
                    <ActionButton
                      label="점수 제출 차단 (로그인은 유지)"
                      disabled={busy || !scoreBlockReason.trim()}
                      tone="yellow"
                      onClick={() =>
                        void runAction(() =>
                          postScoreSubmissionBlock(detail.id, true, scoreBlockReason),
                        )
                      }
                    />
                  </>
                ) : (
                  <ActionButton
                    label="점수 제출 차단 해제"
                    disabled={busy}
                    tone="green"
                    onClick={() =>
                      void runAction(() => postScoreSubmissionBlock(detail.id, false, null))
                    }
                  />
                )}
              </div>

              <div className="space-y-3 border-t border-border/60 pt-3">
                <p className="text-[11px] font-bold text-text-muted">점수 초기화</p>
                <LabeledField label="초기화 사유 (필수)" htmlFor="reset-reason">
                  <input
                    id="reset-reason"
                    type="text"
                    placeholder="예: 확인된 부정 점수 삭제"
                    value={resetReason}
                    onChange={(e) => setResetReason(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs text-text-primary outline-none focus:ring-2 focus:ring-brand"
                  />
                </LabeledField>
                <ActionButton
                  label="이 유저 점수 전체 초기화"
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  disabled={busy || !resetReason.trim()}
                  tone="red"
                  onClick={() => void runAction(() => postResetUserScores(detail.id, resetReason))}
                />
                <p className="text-[10px] leading-relaxed text-text-muted">
                  초기화된 점수는 소프트 삭제되어 아래 버튼으로 즉시 복구할 수 있습니다.
                </p>
                <ActionButton
                  label="최근 초기화된 점수 복구"
                  icon={<RotateCcw className="h-3.5 w-3.5" />}
                  disabled={busy}
                  tone="neutral"
                  onClick={() => void runAction(() => postRestoreUserScores(detail.id))}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Audit log */}
      <div className="border-t border-border pt-6">
        <h3 className="mb-3 flex items-center gap-1.5 text-xs font-black uppercase tracking-wide text-text-primary">
          <History className="h-3.5 w-3.5" /> 조치 이력
        </h3>
        {detail.auditLog.length === 0 ? (
          <p className="text-xs text-text-muted">아직 조치 이력이 없습니다.</p>
        ) : (
          <div className="flex flex-col divide-y divide-border/60">
            {detail.auditLog.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between gap-3 py-2.5 text-xs"
              >
                <div className="min-w-0">
                  <span className="font-bold text-text-primary">
                    {ACTION_LABEL[entry.action] ?? entry.action}
                  </span>
                  {entry.reason && <span className="ml-2 text-text-muted">— {entry.reason}</span>}
                </div>
                <span className="shrink-0 text-[10px] text-text-muted">
                  {entry.createdAt.split("T")[0]} · admin #{entry.actorAdminId}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LabeledField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-[11px] font-bold text-text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

const ACTION_BUTTON_TONE: Record<string, string> = {
  yellow:
    "border-accent-yellow/30 bg-accent-yellow/10 text-accent-yellow hover:bg-accent-yellow/20",
  red: "border-accent-red/30 bg-accent-red/10 text-accent-red hover:bg-accent-red/20",
  green: "border-accent-green/30 bg-accent-green/10 text-accent-green hover:bg-accent-green/20",
  neutral: "border-border bg-surface-raised text-text-primary hover:border-brand",
};

function ActionButton({
  label,
  icon,
  disabled,
  tone,
  onClick,
}: {
  label: string;
  icon?: ReactNode;
  disabled: boolean;
  tone: "yellow" | "red" | "green" | "neutral";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2.5 text-xs font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-brand disabled:cursor-not-allowed disabled:opacity-40 ${ACTION_BUTTON_TONE[tone]}`}
    >
      {icon}
      {label}
    </button>
  );
}

function PageMessage({ children, small }: { children: ReactNode; small?: boolean }) {
  return (
    <div
      className={
        small
          ? "px-4 py-6 text-center text-xs text-text-muted"
          : "mx-auto max-w-xl px-4 py-24 text-center"
      }
    >
      {children}
    </div>
  );
}
