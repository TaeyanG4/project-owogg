import type { ExternalGameRecord } from "@owogg/contracts";
import { Bookmark, ExternalLink, MonitorPlay, Search } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { useAuth } from "../features/auth";
import { fetchExternalGames, setExternalGameBookmark } from "../features/externalGamesApi";

type ExternalGameSort = "newest" | "bookmarks";

export function meta() {
  return [
    { title: "타 플랫폼 게임 | OwOGG" },
    {
      name: "description",
      content: "OwOGG 이용자가 소개하고 운영진이 검토한 타 플랫폼 게임을 둘러보세요.",
    },
  ];
}

export default function ExternalGames() {
  const [searchParams, setSearchParams] = useSearchParams();
  const page = positiveInteger(searchParams.get("page"));
  const sort: ExternalGameSort = searchParams.get("sort") === "bookmarks" ? "bookmarks" : "newest";
  const search = searchParams.get("search")?.trim() ?? "";
  const [searchInput, setSearchInput] = useState(search);
  const [games, setGames] = useState<ExternalGameRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bookmarkBusy, setBookmarkBusy] = useState<number | null>(null);
  const { isAuthenticated, openLoginModal } = useAuth();

  useEffect(() => setSearchInput(search), [search]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void fetchExternalGames({ page, pageSize: 24, sort, search })
      .then((response) => {
        if (!active) return;
        setGames(response.games);
        setTotal(response.total);
        setTotalPages(response.totalPages);
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        setError(
          loadError instanceof Error ? loadError.message : "타 플랫폼 게임을 불러오지 못했습니다.",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page, search, sort]);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const next = new URLSearchParams(searchParams);
    const value = searchInput.trim();
    if (value) next.set("search", value);
    else next.delete("search");
    next.delete("page");
    setSearchParams(next);
  };

  const changeSort = (nextSort: ExternalGameSort) => {
    const next = new URLSearchParams(searchParams);
    next.set("sort", nextSort);
    next.delete("page");
    setSearchParams(next);
  };

  const changePage = (nextPage: number) => {
    const next = new URLSearchParams(searchParams);
    if (nextPage <= 1) next.delete("page");
    else next.set("page", String(nextPage));
    setSearchParams(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toggleBookmark = async (game: ExternalGameRecord) => {
    if (!isAuthenticated) {
      openLoginModal();
      return;
    }
    setBookmarkBusy(game.id);
    setError(null);
    try {
      const result = await setExternalGameBookmark(game.slug, !game.isBookmarked);
      setGames((current) =>
        current.map((item) =>
          item.id === game.id
            ? { ...item, isBookmarked: result.bookmarked, bookmarkCount: result.bookmarkCount }
            : item,
        ),
      );
    } catch (bookmarkError) {
      setError(
        bookmarkError instanceof Error ? bookmarkError.message : "북마크를 변경하지 못했습니다.",
      );
    } finally {
      setBookmarkBusy(null);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-7 px-4 py-8 sm:px-6 lg:px-8 xl:px-10">
      <header className="flex flex-col justify-between gap-5 border-b border-border/60 pb-6 lg:flex-row lg:items-end">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-cyan-300">
            <MonitorPlay className="h-4 w-4" aria-hidden="true" />
            <span>External games</span>
          </div>
          <h1 className="text-3xl font-black text-text-primary md:text-4xl">타 플랫폼 게임</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-muted">
            이용자가 소개하고 OwOGG 운영진이 검토한 게임입니다. 플레이 버튼을 누르면 해당 게임
            사이트로 이동합니다.
          </p>
          {!loading && (
            <p className="mt-2 text-xs font-bold text-text-secondary">
              총 {total.toLocaleString()}개
            </p>
          )}
        </div>

        <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
          <form onSubmit={submitSearch} className="relative min-w-0 flex-1 lg:w-80">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="게임, 플랫폼, 태그 검색"
              aria-label="타 플랫폼 게임 검색"
              className="w-full rounded-xl border border-border bg-surface-raised py-2.5 pl-10 pr-4 text-sm text-text-primary outline-none transition focus:border-brand/60 focus:ring-2 focus:ring-brand/20"
            />
          </form>
          <select
            value={sort}
            onChange={(event) => changeSort(event.target.value as ExternalGameSort)}
            aria-label="타 플랫폼 게임 정렬"
            className="rounded-xl border border-border bg-surface-raised px-3 py-2.5 text-sm font-bold text-text-secondary outline-none focus:border-brand/60"
          >
            <option value="newest">최신 소개 순</option>
            <option value="bookmarks">북마크 순</option>
          </select>
        </div>
      </header>

      {error && (
        <p
          role="alert"
          className="rounded-xl border border-accent-red/30 bg-accent-red/10 px-4 py-3 text-sm font-semibold text-accent-red"
        >
          {error}
        </p>
      )}

      {loading ? (
        <ExternalGameGridSkeleton />
      ) : games.length === 0 ? (
        <div className="flex min-h-72 flex-col items-center justify-center rounded-3xl border border-dashed border-border bg-surface-raised/50 p-8 text-center">
          <MonitorPlay className="h-10 w-10 text-text-muted" aria-hidden="true" />
          <h2 className="mt-4 text-lg font-black text-text-primary">소개된 게임이 없습니다</h2>
          <p className="mt-2 text-sm text-text-muted">
            {search ? "검색 조건을 바꿔보세요." : "Game Creator Center에서 첫 게임을 소개해보세요."}
          </p>
          <Link
            to="/game-creator?tool=external"
            className="mt-5 rounded-xl bg-brand px-4 py-2.5 text-xs font-black text-white hover:bg-brand-hover"
          >
            게임 소개 작성
          </Link>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {games.map((game) => (
            <ExternalGameCard
              key={game.id}
              game={game}
              bookmarkBusy={bookmarkBusy === game.id}
              onBookmark={() => void toggleBookmark(game)}
            />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <nav
          aria-label="타 플랫폼 게임 페이지"
          className="flex items-center justify-center gap-3 pt-2"
        >
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => changePage(page - 1)}
            className={pageButtonClass}
          >
            이전
          </button>
          <span className="text-xs font-black text-text-muted">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages || loading}
            onClick={() => changePage(page + 1)}
            className={pageButtonClass}
          >
            다음
          </button>
        </nav>
      )}
    </div>
  );
}

function ExternalGameCard({
  game,
  bookmarkBusy,
  onBookmark,
}: {
  game: ExternalGameRecord;
  bookmarkBusy: boolean;
  onBookmark: () => void;
}) {
  const banner = game.media.find((item) => item.kind === "BANNER");
  const screenshot = game.media.find((item) => item.kind === "SCREENSHOT");
  const cover = banner ?? screenshot;

  return (
    <article className="group overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-lg transition hover:-translate-y-1 hover:border-brand/40 hover:shadow-brand/10">
      <Link
        to={`/external-games/${game.slug}`}
        className="relative block aspect-video overflow-hidden bg-surface-overlay"
      >
        {cover ? (
          <img
            src={cover.url}
            alt={cover.altText || `${game.title} 소개 이미지`}
            loading="lazy"
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <span className="flex h-full items-center justify-center">
            <MonitorPlay className="h-10 w-10 text-text-muted" />
          </span>
        )}
        <span className="absolute left-3 top-3 rounded-full border border-white/15 bg-black/65 px-2.5 py-1 text-[10px] font-black text-white backdrop-blur">
          {game.platformName}
        </span>
      </Link>
      <div className="p-4">
        <div className="flex items-start gap-3">
          <Link to={`/external-games/${game.slug}`} className="min-w-0 flex-1">
            <h2 className="truncate text-base font-black text-text-primary group-hover:text-brand-light">
              {game.title}
            </h2>
            <p className="mt-1 line-clamp-2 min-h-10 text-xs leading-5 text-text-muted">
              {game.shortDescription}
            </p>
          </Link>
          <button
            type="button"
            onClick={onBookmark}
            disabled={bookmarkBusy}
            aria-label={game.isBookmarked ? `${game.title} 북마크 해제` : `${game.title} 북마크`}
            aria-pressed={game.isBookmarked}
            className={`rounded-full border p-2 transition disabled:opacity-40 ${game.isBookmarked ? "border-brand/50 bg-brand/15 text-brand-light" : "border-border text-text-muted hover:border-brand/40 hover:text-brand-light"}`}
          >
            <Bookmark className={`h-4 w-4 ${game.isBookmarked ? "fill-current" : ""}`} />
          </button>
        </div>
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-border/60 pt-3 text-[11px] text-text-muted">
          <span className="truncate">소개 {game.introducerName}</span>
          <span className="inline-flex shrink-0 items-center gap-1">
            <Bookmark className="h-3 w-3" /> {game.bookmarkCount.toLocaleString()}
          </span>
        </div>
        <Link
          to={`/external-games/${game.slug}`}
          className="mt-3 inline-flex items-center gap-1 text-xs font-black text-brand-light"
        >
          소개 보기 <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>
    </article>
  );
}

function ExternalGameGridSkeleton() {
  return (
    <div
      className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
      aria-label="목록 불러오는 중"
    >
      {Array.from({ length: 8 }, (_, index) => (
        <div
          key={index}
          className="overflow-hidden rounded-2xl border border-border bg-surface-raised"
        >
          <div className="aspect-video animate-pulse bg-surface-overlay" />
          <div className="space-y-3 p-4">
            <div className="h-4 w-2/3 animate-pulse rounded bg-surface-overlay" />
            <div className="h-9 animate-pulse rounded bg-surface-overlay" />
          </div>
        </div>
      ))}
    </div>
  );
}

function positiveInteger(value: string | null): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

const pageButtonClass =
  "rounded-xl border border-border bg-surface-raised px-4 py-2 text-xs font-black text-text-secondary transition hover:border-brand/40 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40";
