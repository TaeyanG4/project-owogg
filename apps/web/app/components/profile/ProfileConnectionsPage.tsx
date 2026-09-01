import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, ChevronLeft, ChevronRight, UserRoundCheck, UsersRound } from "lucide-react";
import { formatPublicUserTag } from "@owogg/core";
import type { ProfileConnectionsResponse } from "@owogg/contracts";
import { fetchProfileConnectionsApi } from "../../features/profile/api";
import { useI18n } from "../../features/i18n/I18nContext";

const PAGE_SIZES = [10, 20, 30, 50] as const;

export function ProfileConnectionsPage({ kind }: { kind: "followers" | "following" }) {
  const { id } = useParams();
  const { dict } = useI18n();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(20);
  const [data, setData] = useState<ProfileConnectionsResponse | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setState("loading");
    void fetchProfileConnectionsApi(id, kind, page, pageSize)
      .then((response) => {
        if (cancelled) return;
        setData(response);
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [id, kind, page, pageSize]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((data?.total ?? 0) / pageSize)),
    [data?.total, pageSize],
  );
  const title =
    kind === "followers" ? dict.userProfile.followersTitle : dict.userProfile.followingTitle;
  const empty =
    kind === "followers" ? dict.userProfile.followersEmpty : dict.userProfile.followingEmpty;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 md:py-12">
      <Link
        to={`/users/${id ?? ""}`}
        className="inline-flex items-center gap-2 text-xs font-bold text-text-muted hover:text-text-primary"
      >
        <ArrowLeft className="h-4 w-4" /> {dict.userProfile.backToProfile}
      </Link>

      <section className="mt-5 overflow-hidden rounded-3xl border border-white/[0.08] bg-surface-raised/55 ring-1 ring-inset ring-white/[0.03]">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 px-5 py-5 sm:px-7">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.15em] text-brand-light">
              {data
                ? formatPublicUserTag(data.user.nickname, data.user.id)
                : dict.userProfile.eyebrow}
            </p>
            <h1 className="mt-1 flex items-center gap-2 text-xl font-black text-text-primary">
              {kind === "followers" ? (
                <UsersRound className="h-5 w-5 text-brand-light" />
              ) : (
                <UserRoundCheck className="h-5 w-5 text-brand-light" />
              )}
              {title}
              {data && (
                <span className="text-sm font-bold tabular-nums text-text-muted">
                  {data.total.toLocaleString()}
                </span>
              )}
            </h1>
          </div>
          <label className="flex items-center gap-2 text-[11px] font-bold text-text-muted">
            {dict.userProfile.pageSizeLabel}
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value) as (typeof PAGE_SIZES)[number]);
                setPage(1);
              }}
              className="rounded-xl border border-border bg-surface px-3 py-2 text-xs font-bold text-text-primary outline-none focus:border-brand"
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        </header>

        {state === "loading" ? (
          <p className="px-6 py-16 text-center text-sm text-text-muted">{dict.common.loading}</p>
        ) : state === "error" || !data ? (
          <p className="px-6 py-16 text-center text-sm text-accent-red">
            {dict.userProfile.loadErrorBody}
          </p>
        ) : data.items.length === 0 ? (
          <p className="px-6 py-16 text-center text-sm text-text-muted">{empty}</p>
        ) : (
          <div className="divide-y divide-border/55 px-5 sm:px-7">
            {data.items.map((connection) => (
              <Link
                key={connection.userId}
                to={`/users/${connection.userId}`}
                className="flex items-center gap-4 py-4 transition-colors hover:bg-white/[0.025]"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface text-sm font-black text-brand-light ring-1 ring-white/10">
                  {connection.avatarUrl ? (
                    <img src={connection.avatarUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    connection.nickname.slice(0, 2)
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-black text-text-primary">
                    {formatPublicUserTag(connection.nickname, connection.userId)}
                  </p>
                  <p className="mt-1 text-[11px] text-text-muted">
                    {new Date(connection.followedAt).toLocaleDateString()}
                  </p>
                </div>
                {connection.country && (
                  <span className="rounded-full bg-white/[0.04] px-2.5 py-1 text-[10px] font-bold uppercase text-text-muted">
                    {connection.country}
                  </span>
                )}
              </Link>
            ))}
          </div>
        )}

        {data && data.total > 0 && (
          <footer className="flex items-center justify-between border-t border-border/60 px-5 py-4 sm:px-7">
            <button
              type="button"
              disabled={page <= 1 || state === "loading"}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-bold text-text-muted hover:bg-surface hover:text-text-primary disabled:opacity-35"
            >
              <ChevronLeft className="h-4 w-4" /> {dict.userProfile.previousPage}
            </button>
            <span className="text-xs font-bold tabular-nums text-text-muted">
              {page.toLocaleString()} / {totalPages.toLocaleString()}
            </span>
            <button
              type="button"
              disabled={page >= totalPages || state === "loading"}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-bold text-text-muted hover:bg-surface hover:text-text-primary disabled:opacity-35"
            >
              {dict.userProfile.nextPage} <ChevronRight className="h-4 w-4" />
            </button>
          </footer>
        )}
      </section>
    </div>
  );
}
