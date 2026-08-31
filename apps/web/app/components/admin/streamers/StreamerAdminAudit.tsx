import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  StreamerAdminAuditEntry,
  StreamerAdminWorkspaceData,
  StreamerAdminWorkspaceQuery,
} from "@owogg/contracts";
import { formatStreamerDateTime } from "../../../features/streamers/adminStreamerViewModel";
import {
  StreamerActionButton,
  StreamerBadge,
  StreamerPagination,
  StreamerPanel,
} from "./StreamerAdminShared";

export function StreamerAdminAudit({
  data,
  query,
  onQueryChange,
}: {
  data: StreamerAdminWorkspaceData;
  query: StreamerAdminWorkspaceQuery;
  onQueryChange: (patch: Partial<StreamerAdminWorkspaceQuery>) => void;
}) {
  const [search, setSearch] = useState(query.auditQuery);
  useEffect(() => setSearch(query.auditQuery), [query.auditQuery]);
  const submitSearch = () => onQueryChange({ auditQuery: search.trim(), auditPage: 1 });
  const visibleAudits = data.audits.items.filter(
    (entry) =>
      ![entry.targetLabel, entry.changeSummary, entry.internalNote]
        .filter((value): value is string => Boolean(value))
        .some((value) => /\bSOOP\b/i.test(value)),
  );
  return (
    <div className="space-y-4">
      <StreamerPanel className="p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_220px]">
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              submitSearch();
            }}
          >
            <label className="relative block flex-1">
              <span className="sr-only">감사 이력 검색</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="작업, 대상, 담당자, correlation ID"
                className="w-full rounded-xl border border-border bg-surface py-2.5 pl-9 pr-3 text-xs text-text-primary outline-none focus:border-brand"
              />
            </label>
            <StreamerActionButton onClick={submitSearch}>검색</StreamerActionButton>
          </form>
          <select
            aria-label="감사 대상 필터"
            value={query.auditTarget}
            onChange={(event) =>
              onQueryChange({
                auditTarget: event.target.value as StreamerAdminWorkspaceQuery["auditTarget"],
                auditPage: 1,
              })
            }
            className="rounded-xl border border-border bg-surface px-3 text-xs text-text-primary"
          >
            <option value="ALL">전체 대상</option>
            <option value="STREAMER">스트리머</option>
            <option value="PLATFORM_ACCOUNT">플랫폼 계정</option>
            <option value="REVIEW">심사</option>
            <option value="POLICY">정책</option>
            <option value="PROVIDER">플랫폼 연결</option>
          </select>
        </div>
      </StreamerPanel>

      <StreamerPanel className="overflow-hidden">
        {visibleAudits.length === 0 ? (
          <p className="p-10 text-center text-xs text-text-muted">감사 이력이 없습니다.</p>
        ) : (
          <div className="divide-y divide-border/70">
            {visibleAudits.map((entry) => (
              <AuditEntry key={entry.id} entry={entry} />
            ))}
          </div>
        )}
        <StreamerPagination
          {...data.audits}
          onChange={({ page, pageSize }) =>
            onQueryChange({ auditPage: page, auditPageSize: pageSize })
          }
        />
      </StreamerPanel>
    </div>
  );
}

function AuditEntry({ entry }: { entry: StreamerAdminAuditEntry }) {
  return (
    <article className="grid gap-3 px-5 py-4 lg:grid-cols-[160px_minmax(0,1fr)_220px]">
      <div>
        <p className="text-[10px] text-text-muted">{formatStreamerDateTime(entry.createdAt)}</p>
        <p className="mt-1 text-xs font-black text-text-primary">{entry.actor}</p>
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <StreamerBadge tone="brand">{entry.action}</StreamerBadge>
          <StreamerBadge>{entry.targetType}</StreamerBadge>
          {entry.policyVersion !== null && (
            <StreamerBadge tone="info">정책 v{entry.policyVersion}</StreamerBadge>
          )}
        </div>
        <p className="mt-2 text-xs font-black text-text-primary">{entry.targetLabel}</p>
        <p className="mt-1 text-[10px] leading-5 text-text-muted">{entry.changeSummary}</p>
        {entry.internalNote && (
          <p className="mt-1 text-[10px] text-accent-yellow">내부 메모: {entry.internalNote}</p>
        )}
      </div>
      <div className="break-all text-[9px] text-text-muted">
        <p>사유 {entry.publicReasonCode ?? "—"}</p>
        <p className="mt-1 font-mono">{entry.correlationId}</p>
      </div>
    </article>
  );
}
