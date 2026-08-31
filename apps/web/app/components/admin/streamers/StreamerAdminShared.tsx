import type { ReactNode } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import type {
  StreamerAdminAction,
  StreamerAdminPageSize,
  StreamerPolicyValues,
} from "@owogg/contracts";

export interface StreamerActionIntent {
  action: StreamerAdminAction;
  targetId: string;
  expectedVersion: number | null;
  title: string;
  description: string;
  danger?: boolean;
  effectiveAt?: "OPTIONAL" | "REQUIRED";
  policyValues?: StreamerPolicyValues;
}

export interface StreamerActionControls {
  requestAction: (intent: StreamerActionIntent) => void;
  isActionEnabled: (action: StreamerAdminAction) => boolean;
  actionDisabledReason: (action: StreamerAdminAction) => string | null;
}

export function StreamerPanel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-border bg-surface-raised shadow-[0_16px_50px_rgba(0,0,0,0.12)] ${className}`}
    >
      {children}
    </section>
  );
}

export function StreamerBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "brand" | "success" | "warning" | "danger" | "info";
}) {
  const tones = {
    neutral: "border-border bg-surface text-text-secondary",
    brand: "border-brand/30 bg-brand/10 text-brand-light",
    success: "border-accent-green/30 bg-accent-green/10 text-accent-green",
    warning: "border-accent-yellow/30 bg-accent-yellow/10 text-accent-yellow",
    danger: "border-accent-red/30 bg-accent-red/10 text-accent-red",
    info: "border-accent-blue/30 bg-accent-blue/10 text-accent-blue",
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-black tracking-wide ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function StreamerActionButton({
  children,
  disabled,
  disabledReason,
  onClick,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  disabled?: boolean;
  disabledReason?: string | null;
  onClick: () => void;
  tone?: "neutral" | "primary" | "success" | "warning" | "danger";
  className?: string;
}) {
  const tones = {
    neutral: "border-border bg-surface text-text-secondary hover:border-brand/50 hover:text-white",
    primary: "border-brand bg-brand text-white hover:bg-brand-light",
    success: "border-accent-green/30 bg-accent-green/10 text-accent-green hover:bg-accent-green/20",
    warning:
      "border-accent-yellow/30 bg-accent-yellow/10 text-accent-yellow hover:bg-accent-yellow/20",
    danger: "border-accent-red/30 bg-accent-red/10 text-accent-red hover:bg-accent-red/20",
  } as const;
  return (
    <button
      type="button"
      disabled={disabled}
      title={disabled ? (disabledReason ?? undefined) : undefined}
      onClick={onClick}
      className={`inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-[11px] font-black transition-colors focus:outline-none focus:ring-2 focus:ring-brand disabled:cursor-not-allowed disabled:opacity-40 ${tones[tone]} ${className}`}
    >
      {children}
    </button>
  );
}

export function StreamerPagination({
  page,
  pageSize,
  total,
  totalPages,
  onChange,
}: {
  page: number;
  pageSize: StreamerAdminPageSize;
  total: number;
  totalPages: number;
  onChange: (next: { page: number; pageSize: StreamerAdminPageSize }) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
      <div className="flex items-center gap-2 text-[10px] text-text-muted">
        <span>총 {total.toLocaleString()}건</span>
        <label className="flex items-center gap-1.5">
          페이지당
          <select
            value={pageSize}
            onChange={(event) =>
              onChange({ page: 1, pageSize: Number(event.target.value) as StreamerAdminPageSize })
            }
            className="rounded-lg border border-border bg-surface px-2 py-1.5 text-[10px] text-text-primary outline-none focus:border-brand"
          >
            {[10, 20, 30, 50].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="이전 페이지"
          disabled={page <= 1}
          onClick={() => onChange({ page: page - 1, pageSize })}
          className="rounded-lg border border-border p-2 text-text-secondary disabled:opacity-30"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span className="min-w-20 text-center text-[10px] font-black text-text-secondary">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          aria-label="다음 페이지"
          disabled={page >= totalPages}
          onClick={() => onChange({ page: page + 1, pageSize })}
          className="rounded-lg border border-border p-2 text-text-secondary disabled:opacity-30"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export function StreamerErrorBanner({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-2xl border border-accent-red/30 bg-accent-red/10 p-4 text-xs leading-5 text-accent-red"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
