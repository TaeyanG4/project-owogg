import { ChevronLeft, ChevronRight } from "lucide-react";

export type AdminGamePageSize = 10 | 20 | 30;

function visiblePages(page: number, totalPages: number): number[] {
  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
  const end = Math.min(totalPages, start + 4);
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

export function formatServerUploadDate(value: string | null): string {
  if (!value) return "기록 없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  }).format(date);
}

export function AdminGamePagination({
  page,
  pageSize,
  total,
  totalPages,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: AdminGamePageSize;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: AdminGamePageSize) => void;
}) {
  return (
    <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-border bg-surface-raised px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2 text-xs text-text-muted">
        <span>총 {total.toLocaleString("ko-KR")}개</span>
        <label className="flex items-center gap-2">
          <span>표시</span>
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value) as AdminGamePageSize)}
            className="rounded-lg border border-border bg-surface px-2 py-1.5 font-bold text-text-primary outline-none focus:ring-2 focus:ring-brand"
          >
            <option value={10}>10개</option>
            <option value={20}>20개</option>
            <option value={30}>30개</option>
          </select>
        </label>
      </div>

      <nav aria-label="게임 목록 페이지" className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="이전 페이지"
          className="rounded-lg border border-border p-2 text-text-muted hover:border-brand hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        {visiblePages(page, totalPages).map((pageNumber) => (
          <button
            key={pageNumber}
            type="button"
            onClick={() => onPageChange(pageNumber)}
            aria-current={pageNumber === page ? "page" : undefined}
            className={`min-w-8 rounded-lg border px-2 py-1.5 text-xs font-bold ${
              pageNumber === page
                ? "border-brand bg-brand text-white"
                : "border-border text-text-muted hover:border-brand hover:text-text-primary"
            }`}
          >
            {pageNumber}
          </button>
        ))}
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label="다음 페이지"
          className="rounded-lg border border-border p-2 text-text-muted hover:border-brand hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </nav>
    </div>
  );
}
