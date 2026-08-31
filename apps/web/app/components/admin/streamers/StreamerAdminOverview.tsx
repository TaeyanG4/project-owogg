import { ArrowRight, Clock3, RadioTower, ShieldAlert, UserCheck, Users } from "lucide-react";
import type {
  StreamerAdminPageSize,
  StreamerAdminSection,
  StreamerAdminWorkspaceData,
} from "@owogg/contracts";
import {
  formatStreamerDateTime,
  formatStreamerPlatform,
} from "../../../features/streamers/adminStreamerViewModel";
import { isStreamerUiPlatform } from "../../../features/streamers/streamerPlatforms";
import { StreamerBadge, StreamerPagination, StreamerPanel } from "./StreamerAdminShared";

export function StreamerAdminOverview({
  data,
  onNavigate,
  onPageChange,
}: {
  data: StreamerAdminWorkspaceData;
  onNavigate: (section: StreamerAdminSection) => void;
  onPageChange: (page: number, pageSize: StreamerAdminPageSize) => void;
}) {
  const visibleOverviewQueue = data.overviewQueue.items.filter((review) =>
    isStreamerUiPlatform(review.platformAccount.platform),
  );
  const visibleProviders = data.providers.filter((provider) =>
    isStreamerUiPlatform(provider.platform),
  );
  const metrics = [
    {
      label: "전체 신청자",
      value: data.overview.totalApplicants,
      detail: `승인 스트리머 ${data.overview.approvedStreamers.toLocaleString()}명`,
      icon: Users,
      tone: "text-brand-light bg-brand/10",
    },
    {
      label: "연결 플랫폼",
      value: data.overview.connectedPlatforms,
      detail: `심사 대기 ${data.overview.pendingPlatformReviews.toLocaleString()}건`,
      icon: RadioTower,
      tone: "text-accent-green bg-accent-green/10",
    },
    {
      label: "미배정 심사",
      value: data.overview.unassignedReviews,
      detail: `내 작업 ${data.overview.myClaimedReviews.toLocaleString()}건`,
      icon: UserCheck,
      tone: "text-accent-blue bg-accent-blue/10",
    },
    {
      label: "기한 초과",
      value: data.overview.overdueReviews,
      detail: `중단 ${data.overview.suspendedStreamers.toLocaleString()}명`,
      icon: ShieldAlert,
      tone:
        data.overview.overdueReviews > 0
          ? "text-accent-red bg-accent-red/10"
          : "text-text-secondary bg-surface",
    },
  ];

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <StreamerPanel key={metric.label} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-bold text-text-muted">{metric.label}</p>
                  <p className="mt-2 text-2xl font-black tabular-nums text-text-primary">
                    {metric.value.toLocaleString()}
                  </p>
                  <p className="mt-1 text-[10px] text-text-muted">{metric.detail}</p>
                </div>
                <span className={`grid h-9 w-9 place-items-center rounded-xl ${metric.tone}`}>
                  <Icon className="h-4 w-4" />
                </span>
              </div>
            </StreamerPanel>
          );
        })}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
        <StreamerPanel className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div>
              <h2 className="text-sm font-black text-text-primary">지금 처리할 플랫폼 심사</h2>
              <p className="mt-1 text-[11px] text-text-muted">
                한 스트리머의 플랫폼도 각각 독립된 작업으로 표시됩니다.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate("REVIEWS")}
              className="inline-flex items-center gap-1 text-[11px] font-black text-brand-light"
            >
              작업함 열기 <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
          {visibleOverviewQueue.length === 0 ? (
            <p className="p-6 text-xs text-text-muted">활성 심사가 없습니다.</p>
          ) : (
            <div className="divide-y divide-border/70">
              {visibleOverviewQueue.map((review) => (
                <button
                  key={review.id}
                  type="button"
                  onClick={() => onNavigate("REVIEWS")}
                  className="grid w-full gap-3 px-5 py-4 text-left hover:bg-surface sm:grid-cols-[1fr_auto]"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-xs font-black text-text-primary">
                        {review.nickname} · {review.platformAccount.channelName}
                      </span>
                      <StreamerBadge tone={review.priority === "URGENT" ? "danger" : "neutral"}>
                        {formatStreamerPlatform(review.platformAccount.platform)}
                      </StreamerBadge>
                    </div>
                    <p className="mt-1 text-[10px] text-text-muted">
                      {review.reviewType} · {review.claimedBy?.nickname ?? "미배정"}
                    </p>
                  </div>
                  <span className="flex items-center gap-1.5 whitespace-nowrap text-[10px] text-text-muted">
                    <Clock3 className="h-3.5 w-3.5" /> {formatStreamerDateTime(review.dueAt)}
                  </span>
                </button>
              ))}
            </div>
          )}
          <StreamerPagination
            {...data.overviewQueue}
            onChange={({ page, pageSize }) => onPageChange(page, pageSize)}
          />
        </StreamerPanel>

        <div className="space-y-5">
          <StreamerPanel className="p-5">
            <h2 className="text-sm font-black text-text-primary">소유권 만료 예정</h2>
            <p className="mt-2 text-3xl font-black text-accent-yellow">
              {data.overview.ownershipExpiringSoon.toLocaleString()}
            </p>
            <button
              type="button"
              onClick={() => onNavigate("STREAMERS")}
              className="mt-4 inline-flex w-full items-center justify-between rounded-xl border border-border bg-surface px-3 py-2.5 text-[11px] font-black text-text-secondary"
            >
              스트리머 목록에서 확인 <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </StreamerPanel>
          <StreamerPanel className="p-5">
            <h2 className="text-sm font-black text-text-primary">플랫폼 연결 상태</h2>
            <div className="mt-4 space-y-2">
              {visibleProviders.map((provider) => (
                <div
                  key={provider.platform}
                  className="flex items-center justify-between rounded-xl bg-surface px-3 py-2.5"
                >
                  <span className="text-xs font-black text-text-primary">
                    {provider.displayName}
                  </span>
                  <StreamerBadge tone={provider.reasonCode === "READY" ? "success" : "danger"}>
                    {provider.reasonCode}
                  </StreamerBadge>
                </div>
              ))}
            </div>
          </StreamerPanel>
        </div>
      </div>
    </div>
  );
}
