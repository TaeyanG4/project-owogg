import { ExternalLink, Search, ShieldOff, UserRoundCheck } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  StreamerAdminWorkspaceData,
  StreamerAdminWorkspaceQuery,
  StreamerPlatform,
  StreamerPlatformApprovalStatus,
} from "@owogg/contracts";
import {
  formatStreamerAudience,
  formatStreamerDateTime,
  formatStreamerPlatform,
  STREAMER_APPROVAL_LABELS,
  STREAMER_OWNERSHIP_LABELS,
  STREAMER_PLATFORM_LABELS,
} from "../../../features/streamers/adminStreamerViewModel";
import { isStreamerUiPlatform } from "../../../features/streamers/streamerPlatforms";
import {
  StreamerActionButton,
  StreamerBadge,
  StreamerPagination,
  StreamerPanel,
  type StreamerActionControls,
} from "./StreamerAdminShared";

export function StreamerAdminRoster({
  data,
  query,
  actions,
  onQueryChange,
}: {
  data: StreamerAdminWorkspaceData;
  query: StreamerAdminWorkspaceQuery;
  actions: StreamerActionControls;
  onQueryChange: (patch: Partial<StreamerAdminWorkspaceQuery>) => void;
}) {
  const [search, setSearch] = useState(query.rosterQuery);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  useEffect(() => setSearch(query.rosterQuery), [query.rosterQuery]);
  const visibleRosterItems = data.roster.items.filter(
    (item) =>
      item.platformAccounts.length === 0 ||
      item.platformAccounts.some((account) => isStreamerUiPlatform(account.platform)),
  );
  const selected = visibleRosterItems.find((item) => item.streamerId === selectedId) ?? null;

  const submitSearch = () => onQueryChange({ rosterQuery: search.trim(), rosterPage: 1 });
  return (
    <div className="space-y-4">
      <StreamerPanel className="p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_180px_180px]">
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              submitSearch();
            }}
          >
            <label className="relative block flex-1">
              <span className="sr-only">스트리머 검색</span>
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
            aria-label="플랫폼 필터"
            value={query.rosterPlatform}
            onChange={(event) =>
              onQueryChange({
                rosterPlatform: event.target.value as "ALL" | StreamerPlatform,
                rosterPage: 1,
              })
            }
            className="rounded-xl border border-border bg-surface px-3 text-xs text-text-primary"
          >
            <option value="ALL">전체 플랫폼</option>
            {Object.entries(STREAMER_PLATFORM_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            aria-label="승인 상태 필터"
            value={query.rosterApproval}
            onChange={(event) =>
              onQueryChange({
                rosterApproval: event.target.value as "ALL" | StreamerPlatformApprovalStatus,
                rosterPage: 1,
              })
            }
            className="rounded-xl border border-border bg-surface px-3 text-xs text-text-primary"
          >
            <option value="ALL">전체 승인 상태</option>
            {Object.entries(STREAMER_APPROVAL_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </StreamerPanel>

      <StreamerPanel className="overflow-hidden">
        {visibleRosterItems.length === 0 ? (
          <p className="p-10 text-center text-xs text-text-muted">
            조건에 맞는 스트리머가 없습니다.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-xs">
              <thead className="border-b border-border bg-surface/70 text-[10px] uppercase tracking-wider text-text-muted">
                <tr>
                  <th className="px-5 py-3">스트리머</th>
                  <th className="px-4 py-3">프로그램 상태</th>
                  <th className="px-4 py-3">플랫폼별 상태</th>
                  <th className="px-4 py-3">심사</th>
                  <th className="px-5 py-3 text-right">상세</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {visibleRosterItems.map((item) => (
                  <tr key={item.streamerId} className="hover:bg-surface/70">
                    <td className="px-5 py-4">
                      <p className="font-black text-text-primary">{item.nickname}</p>
                      <p className="mt-1 text-[10px] text-text-muted">
                        사용자 #{item.userId} · Streamer #{item.streamerId}
                      </p>
                    </td>
                    <td className="px-4 py-4">
                      <StreamerBadge
                        tone={
                          item.programStatus === "VERIFIED"
                            ? "success"
                            : item.programStatus === "SUSPENDED"
                              ? "danger"
                              : "warning"
                        }
                      >
                        {item.programStatus}
                      </StreamerBadge>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex max-w-md flex-wrap gap-1.5">
                        {item.platformAccounts
                          .filter((account) => isStreamerUiPlatform(account.platform))
                          .map((account) => (
                            <StreamerBadge
                              key={account.id}
                              tone={account.approvalStatus === "APPROVED" ? "success" : "warning"}
                            >
                              {formatStreamerPlatform(account.platform)} ·{" "}
                              {STREAMER_APPROVAL_LABELS[account.approvalStatus]}
                            </StreamerBadge>
                          ))}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-[10px] text-text-muted">
                      대기 {item.pendingReviewCount}건 · 승인 플랫폼 {item.approvedPlatformCount}개
                    </td>
                    <td className="px-5 py-4 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedId(selectedId === item.streamerId ? null : item.streamerId)
                        }
                        className="rounded-lg border border-border px-3 py-1.5 text-[10px] font-black text-text-secondary"
                      >
                        {selectedId === item.streamerId ? "닫기" : "상세 열기"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <StreamerPagination
          {...data.roster}
          onChange={({ page, pageSize }) =>
            onQueryChange({ rosterPage: page, rosterPageSize: pageSize })
          }
        />
      </StreamerPanel>

      {selected && <StreamerDetail item={selected} actions={actions} />}
    </div>
  );
}

function StreamerDetail({
  item,
  actions,
}: {
  item: StreamerAdminWorkspaceData["roster"]["items"][number];
  actions: StreamerActionControls;
}) {
  const request = actions.requestAction;
  const profileAction =
    item.programStatus === "SUSPENDED" ? "RESTORE_STREAMER" : "SUSPEND_STREAMER";
  return (
    <StreamerPanel className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-black text-text-primary">{item.nickname}</h3>
          <p className="mt-1 text-[10px] text-text-muted">
            다음 조치 {formatStreamerDateTime(item.nextActionAt)}
          </p>
        </div>
        <StreamerActionButton
          tone={profileAction === "SUSPEND_STREAMER" ? "danger" : "success"}
          disabled={!actions.isActionEnabled(profileAction)}
          disabledReason={actions.actionDisabledReason(profileAction)}
          onClick={() =>
            request({
              action: profileAction,
              targetId: String(item.streamerId),
              expectedVersion: item.rowVersion,
              title:
                profileAction === "SUSPEND_STREAMER" ? "스트리머 활동 중단" : "스트리머 활동 복구",
              description: "프로그램 상태만 변경하며 각 플랫폼의 심사 이력은 유지됩니다.",
              danger: profileAction === "SUSPEND_STREAMER",
              ...(profileAction === "SUSPEND_STREAMER" ? { effectiveAt: "OPTIONAL" as const } : {}),
            })
          }
        >
          {profileAction === "SUSPEND_STREAMER" ? (
            <ShieldOff className="h-3.5 w-3.5" />
          ) : (
            <UserRoundCheck className="h-3.5 w-3.5" />
          )}
          {profileAction === "SUSPEND_STREAMER" ? "활동 중단" : "활동 복구"}
        </StreamerActionButton>
      </div>

      <div className="mt-5 grid gap-3 xl:grid-cols-2">
        {item.platformAccounts
          .filter((account) => isStreamerUiPlatform(account.platform))
          .map((account) => (
            <div key={account.id} className="rounded-2xl border border-border bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-black text-text-primary">
                    {formatStreamerPlatform(account.platform)} · {account.channelName}
                  </p>
                  <p className="mt-1 text-[10px] text-text-muted">{account.maskedCanonicalId}</p>
                </div>
                <a
                  href={account.channelUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-text-muted hover:text-white"
                  aria-label="채널 열기"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <StreamerBadge
                  tone={account.verificationStatus === "VERIFIED" ? "success" : "danger"}
                >
                  소유권 {STREAMER_OWNERSHIP_LABELS[account.verificationStatus]}
                </StreamerBadge>
                <StreamerBadge tone={account.approvalStatus === "APPROVED" ? "success" : "warning"}>
                  {STREAMER_APPROVAL_LABELS[account.approvalStatus]}
                </StreamerBadge>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-2 text-[10px]">
                <div>
                  <dt className="text-text-muted">Audience</dt>
                  <dd className="mt-1 text-text-primary">
                    {formatStreamerAudience(account.audienceCount)}
                  </dd>
                </div>
                <div>
                  <dt className="text-text-muted">소유권 만료</dt>
                  <dd className="mt-1 text-text-primary">
                    {formatStreamerDateTime(account.ownershipExpiresAt)}
                  </dd>
                </div>
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                {account.approvalStatus !== "APPROVED" && (
                  <StreamerActionButton
                    disabled={
                      account.verificationStatus !== "VERIFIED" ||
                      !actions.isActionEnabled("CREATE_REVIEW")
                    }
                    disabledReason={
                      account.verificationStatus !== "VERIFIED"
                        ? "유효한 소유권 확인이 먼저 필요합니다."
                        : actions.actionDisabledReason("CREATE_REVIEW")
                    }
                    onClick={() =>
                      request({
                        action: "CREATE_REVIEW",
                        targetId: String(account.id),
                        expectedVersion: account.rowVersion,
                        title: "플랫폼 심사 생성",
                        description: `${formatStreamerPlatform(account.platform)} 연결에 별도의 수동 심사를 생성합니다.`,
                      })
                    }
                  >
                    심사 생성
                  </StreamerActionButton>
                )}
                {account.approvalStatus === "APPROVED" && (
                  <StreamerActionButton
                    tone="warning"
                    disabled={!actions.isActionEnabled("REVOKE_STREAMER_APPROVAL")}
                    disabledReason={actions.actionDisabledReason("REVOKE_STREAMER_APPROVAL")}
                    onClick={() =>
                      request({
                        action: "REVOKE_STREAMER_APPROVAL",
                        targetId: String(account.id),
                        expectedVersion: account.rowVersion,
                        title: "플랫폼 승인 철회",
                        description:
                          "이 플랫폼의 승인만 철회합니다. 다른 승인 플랫폼은 유지됩니다.",
                        danger: true,
                      })
                    }
                  >
                    승인 철회
                  </StreamerActionButton>
                )}
                <StreamerActionButton
                  tone="danger"
                  disabled={
                    account.verificationStatus !== "VERIFIED" ||
                    !actions.isActionEnabled("INVALIDATE_OWNERSHIP")
                  }
                  disabledReason={
                    account.verificationStatus !== "VERIFIED"
                      ? "현재 유효한 소유권이 없습니다."
                      : actions.actionDisabledReason("INVALIDATE_OWNERSHIP")
                  }
                  onClick={() =>
                    request({
                      action: "INVALIDATE_OWNERSHIP",
                      targetId: String(account.id),
                      expectedVersion: account.rowVersion,
                      title: "플랫폼 소유권 무효화",
                      description:
                        "소유권과 해당 플랫폼 승인을 함께 무효화하고 활성 심사를 닫습니다.",
                      danger: true,
                    })
                  }
                >
                  소유권 무효화
                </StreamerActionButton>
              </div>
            </div>
          ))}
      </div>
    </StreamerPanel>
  );
}
