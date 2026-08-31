import { ExternalLink, Search } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  StreamerAdminWorkspaceData,
  StreamerAdminWorkspaceQuery,
  StreamerReviewWorkState,
} from "@owogg/contracts";
import {
  formatStreamerAudience,
  formatStreamerDateTime,
  formatStreamerPlatform,
  STREAMER_OWNERSHIP_LABELS,
  STREAMER_REVIEW_STATE_LABELS,
} from "../../../features/streamers/adminStreamerViewModel";
import { isStreamerUiPlatform } from "../../../features/streamers/streamerPlatforms";
import {
  StreamerActionButton,
  StreamerBadge,
  StreamerPagination,
  StreamerPanel,
  type StreamerActionControls,
} from "./StreamerAdminShared";

export function StreamerAdminReviews({
  data,
  query,
  actions,
  currentReviewerUserId,
  onQueryChange,
}: {
  data: StreamerAdminWorkspaceData;
  query: StreamerAdminWorkspaceQuery;
  actions: StreamerActionControls;
  currentReviewerUserId: number | null;
  onQueryChange: (patch: Partial<StreamerAdminWorkspaceQuery>) => void;
}) {
  const [search, setSearch] = useState(query.reviewQuery);
  useEffect(() => setSearch(query.reviewQuery), [query.reviewQuery]);
  const submitSearch = () => onQueryChange({ reviewQuery: search.trim(), reviewPage: 1 });
  const visibleReviews = data.reviews.items.filter((review) =>
    isStreamerUiPlatform(review.platformAccount.platform),
  );

  return (
    <div className="space-y-4">
      <StreamerPanel className="p-4">
        <div className="grid gap-3 xl:grid-cols-[minmax(280px,1fr)_180px_180px]">
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              submitSearch();
            }}
          >
            <label className="relative block flex-1">
              <span className="sr-only">심사 검색</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="닉네임, 채널, 사용자 ID"
                className="w-full rounded-xl border border-border bg-surface py-2.5 pl-9 pr-3 text-xs text-text-primary outline-none focus:border-brand"
              />
            </label>
            <StreamerActionButton onClick={submitSearch}>검색</StreamerActionButton>
          </form>
          <select
            aria-label="담당자 필터"
            value={query.reviewAssignment}
            onChange={(event) =>
              onQueryChange({
                reviewAssignment: event.target.value as "ALL" | "UNASSIGNED" | "MINE",
                reviewPage: 1,
              })
            }
            className="rounded-xl border border-border bg-surface px-3 text-xs text-text-primary"
          >
            <option value="ALL">전체 담당 상태</option>
            <option value="UNASSIGNED">미배정</option>
            <option value="MINE">내 작업</option>
          </select>
          <select
            aria-label="심사 상태 필터"
            value={query.reviewState}
            onChange={(event) =>
              onQueryChange({
                reviewState: event.target.value as "ALL" | StreamerReviewWorkState,
                reviewPage: 1,
              })
            }
            className="rounded-xl border border-border bg-surface px-3 text-xs text-text-primary"
          >
            <option value="ALL">전체 심사 상태</option>
            {Object.entries(STREAMER_REVIEW_STATE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </StreamerPanel>

      {visibleReviews.length === 0 ? (
        <StreamerPanel className="p-10 text-center text-xs text-text-muted">
          조건에 맞는 플랫폼 심사가 없습니다.
        </StreamerPanel>
      ) : (
        <div className="space-y-3">
          {visibleReviews.map((review) => (
            <ReviewCard
              key={review.id}
              review={review}
              actions={actions}
              currentReviewerUserId={currentReviewerUserId}
            />
          ))}
        </div>
      )}
      <StreamerPanel className="overflow-hidden">
        <StreamerPagination
          {...data.reviews}
          onChange={({ page, pageSize }) =>
            onQueryChange({ reviewPage: page, reviewPageSize: pageSize })
          }
        />
      </StreamerPanel>
    </div>
  );
}

function ReviewCard({
  review,
  actions,
  currentReviewerUserId,
}: {
  review: StreamerAdminWorkspaceData["reviews"]["items"][number];
  actions: StreamerActionControls;
  currentReviewerUserId: number | null;
}) {
  const active = review.workState === "QUEUED" || review.workState === "ON_HOLD";
  const claimIsCurrent = Boolean(
    review.claimedBy &&
    review.claimExpiresAt &&
    new Date(review.claimExpiresAt).getTime() > Date.now(),
  );
  const mine = claimIsCurrent && review.claimedBy?.userId === currentReviewerUserId;
  const claimedByOther = claimIsCurrent && !mine;
  const claimedByOtherReason = claimedByOther
    ? `${review.claimedBy?.nickname ?? "다른 운영자"}님이 현재 담당 중입니다.`
    : null;
  const invoke = (
    action: Parameters<StreamerActionControls["isActionEnabled"]>[0],
    title: string,
    description: string,
    options: {
      danger?: boolean;
      effectiveAt?: "OPTIONAL" | "REQUIRED";
      accountTarget?: boolean;
    } = {},
  ) => {
    actions.requestAction({
      action,
      targetId: String(options.accountTarget ? review.platformAccount.id : review.id),
      expectedVersion: options.accountTarget
        ? review.platformAccount.rowVersion
        : review.rowVersion,
      title,
      description,
      ...(options.danger === undefined ? {} : { danger: options.danger }),
      ...(options.effectiveAt === undefined ? {} : { effectiveAt: options.effectiveAt }),
    });
  };

  return (
    <StreamerPanel className="overflow-hidden">
      <div className="grid gap-5 p-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.72fr)]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-black text-text-primary">
              {review.nickname} · {review.platformAccount.channelName}
            </h3>
            <StreamerBadge
              tone={active ? "warning" : review.workState === "APPROVED" ? "success" : "neutral"}
            >
              {STREAMER_REVIEW_STATE_LABELS[review.workState]}
            </StreamerBadge>
            <StreamerBadge tone="info">
              {formatStreamerPlatform(review.platformAccount.platform)}
            </StreamerBadge>
          </div>
          <p className="mt-2 text-[10px] text-text-muted">
            심사 #{review.id} · 사용자 #{review.userId} · {review.reviewType} · 정책 v
            {review.evidence.policyVersion}
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Fact
              label="소유권"
              value={STREAMER_OWNERSHIP_LABELS[review.platformAccount.verificationStatus]}
            />
            <Fact label="Audience" value={formatStreamerAudience(review.evidence.audienceCount)} />
            <Fact
              label="채널 운영"
              value={
                review.evidence.channelAgeDays === null
                  ? "확인 불가"
                  : `${review.evidence.channelAgeDays}일`
              }
            />
            <Fact label="처리 기한" value={formatStreamerDateTime(review.dueAt)} />
          </div>
          <div className="mt-4 space-y-2">
            {review.evidence.conditions.map((condition) => (
              <div
                key={condition.field}
                className="flex items-center justify-between gap-3 rounded-xl bg-surface px-3 py-2.5 text-[10px]"
              >
                <span className="font-black text-text-secondary">{condition.field}</span>
                <StreamerBadge
                  tone={
                    condition.result === "PASS"
                      ? "success"
                      : condition.result === "FAIL"
                        ? "danger"
                        : "warning"
                  }
                >
                  {condition.result} · {condition.reasonCode}
                </StreamerBadge>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-black text-text-primary">작업 제어</p>
              <p className="mt-1 text-[10px] text-text-muted">
                담당자 {review.claimedBy?.nickname ?? "미배정"} · 만료{" "}
                {formatStreamerDateTime(review.claimExpiresAt)}
              </p>
            </div>
            <a
              href={review.platformAccount.channelUrl}
              target="_blank"
              rel="noreferrer"
              className="text-text-muted"
              aria-label="채널 열기"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {active && !mine && !claimIsCurrent && (
              <ReviewAction
                actions={actions}
                action="CLAIM_REVIEW"
                onClick={() =>
                  invoke("CLAIM_REVIEW", "심사 담당", "이 플랫폼 심사를 내 작업으로 가져옵니다.")
                }
              >
                담당하기
              </ReviewAction>
            )}
            {active && mine && (
              <ReviewAction
                actions={actions}
                action="RELEASE_REVIEW"
                onClick={() =>
                  invoke("RELEASE_REVIEW", "담당 해제", "이 플랫폼 심사의 담당 배정을 해제합니다.")
                }
              >
                담당 해제
              </ReviewAction>
            )}
            {active && (
              <>
                <ReviewAction
                  actions={actions}
                  action="REFRESH_METRICS"
                  blockedReason={claimedByOtherReason}
                  onClick={() =>
                    invoke(
                      "REFRESH_METRICS",
                      "공식 지표 갱신",
                      "공식 플랫폼 API에서 최신 지표를 수동으로 가져옵니다.",
                      { accountTarget: true },
                    )
                  }
                >
                  지표 갱신
                </ReviewAction>
                <ReviewAction
                  actions={actions}
                  action="HOLD_REVIEW"
                  tone="warning"
                  blockedReason={claimedByOtherReason}
                  onClick={() =>
                    invoke(
                      "HOLD_REVIEW",
                      "심사 보류",
                      "추가 자료를 기다리도록 심사를 보류합니다.",
                      { effectiveAt: "OPTIONAL" },
                    )
                  }
                >
                  보류
                </ReviewAction>
                <ReviewAction
                  actions={actions}
                  action="APPROVE_STREAMER"
                  tone="success"
                  blockedReason={claimedByOtherReason}
                  onClick={() =>
                    invoke(
                      "APPROVE_STREAMER",
                      "플랫폼 스트리머 승인",
                      "이 플랫폼 연결만 스트리머로 승인합니다.",
                    )
                  }
                >
                  승인
                </ReviewAction>
                <ReviewAction
                  actions={actions}
                  action="REJECT_STREAMER"
                  tone="danger"
                  blockedReason={claimedByOtherReason}
                  onClick={() =>
                    invoke(
                      "REJECT_STREAMER",
                      "플랫폼 스트리머 거절",
                      "이 플랫폼 연결만 거절합니다. 다른 플랫폼 결정은 바뀌지 않습니다.",
                      { danger: true },
                    )
                  }
                >
                  거절
                </ReviewAction>
                <ReviewAction
                  actions={actions}
                  action="REQUEST_REAUTH"
                  tone="warning"
                  blockedReason={claimedByOtherReason}
                  onClick={() =>
                    invoke(
                      "REQUEST_REAUTH",
                      "소유권 재인증 요청",
                      "이 플랫폼의 소유권을 다시 인증하도록 요청합니다.",
                    )
                  }
                >
                  재인증 요청
                </ReviewAction>
                <ReviewAction
                  actions={actions}
                  action="CANCEL_REVIEW"
                  tone="danger"
                  blockedReason={claimedByOtherReason}
                  onClick={() =>
                    invoke("CANCEL_REVIEW", "심사 취소", "이 심사 작업을 취소합니다.", {
                      danger: true,
                    })
                  }
                >
                  취소
                </ReviewAction>
              </>
            )}
            {review.workState === "REJECTED" && review.decisionCode === "STREAMER_REJECTED" && (
              <ReviewAction
                actions={actions}
                action="CREATE_RECONSIDERATION"
                onClick={() =>
                  invoke(
                    "CREATE_RECONSIDERATION",
                    "플랫폼 재심 생성",
                    "이 결정에 연결된 후속 수동 재심을 생성합니다.",
                  )
                }
              >
                재심 생성
              </ReviewAction>
            )}
          </div>
          {(review.publicReasonCode || review.internalNote) && (
            <div className="mt-4 rounded-xl border border-border p-3 text-[10px] leading-5 text-text-muted">
              <p>사유: {review.publicReasonCode ?? "—"}</p>
              {review.internalNote && (
                <p className="mt-1 text-accent-yellow">내부: {review.internalNote}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </StreamerPanel>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface p-3">
      <p className="text-[9px] text-text-muted">{label}</p>
      <p className="mt-1 text-[11px] font-black text-text-primary">{value}</p>
    </div>
  );
}

function ReviewAction({
  actions,
  action,
  children,
  tone = "neutral",
  blockedReason = null,
  onClick,
}: {
  actions: StreamerActionControls;
  action: Parameters<StreamerActionControls["isActionEnabled"]>[0];
  children: React.ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger";
  blockedReason?: string | null;
  onClick: () => void;
}) {
  return (
    <StreamerActionButton
      tone={tone}
      disabled={Boolean(blockedReason) || !actions.isActionEnabled(action)}
      disabledReason={blockedReason ?? actions.actionDisabledReason(action)}
      onClick={onClick}
    >
      {children}
    </StreamerActionButton>
  );
}
