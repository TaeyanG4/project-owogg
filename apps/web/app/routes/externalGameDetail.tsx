import type { ExternalGameMedia, ExternalGameRecord } from "@owogg/contracts";
import {
  ArrowLeft,
  Bookmark,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Maximize2,
  MonitorPlay,
  Share2,
  Tag,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import { Link, useParams } from "react-router";
import { useAuth } from "../features/auth";
import { fetchExternalGame, setExternalGameBookmark } from "../features/externalGamesApi";

export function meta() {
  return [
    { title: "타 플랫폼 게임 소개 | OwOGG" },
    { name: "description", content: "OwOGG 이용자가 소개한 타 플랫폼 게임 정보" },
  ];
}

export default function ExternalGameDetail() {
  const { slug = "" } = useParams();
  const { isAuthenticated, openLoginModal } = useAuth();
  const [game, setGame] = useState<ExternalGameRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  const [shared, setShared] = useState(false);
  const galleryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setActiveIndex(0);
    void fetchExternalGame(slug)
      .then((response) => {
        if (active) setGame(response);
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        setError(
          loadError instanceof Error ? loadError.message : "게임 소개를 불러오지 못했습니다.",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [slug]);

  const screenshots = useMemo(
    () => game?.media.filter((item) => item.kind === "SCREENSHOT") ?? [],
    [game],
  );
  const banner = game?.media.find((item) => item.kind === "BANNER") ?? null;
  const activeScreenshot =
    screenshots[Math.min(activeIndex, Math.max(0, screenshots.length - 1))] ?? null;

  const moveGallery = (direction: -1 | 1) => {
    if (screenshots.length <= 1) return;
    setActiveIndex((current) => (current + direction + screenshots.length) % screenshots.length);
  };

  const toggleBookmark = async () => {
    if (!game) return;
    if (!isAuthenticated) {
      openLoginModal();
      return;
    }
    setBookmarkBusy(true);
    setError(null);
    try {
      const result = await setExternalGameBookmark(game.slug, !game.isBookmarked);
      setGame({ ...game, isBookmarked: result.bookmarked, bookmarkCount: result.bookmarkCount });
    } catch (bookmarkError) {
      setError(
        bookmarkError instanceof Error ? bookmarkError.message : "북마크를 변경하지 못했습니다.",
      );
    } finally {
      setBookmarkBusy(false);
    }
  };

  const share = async () => {
    if (!game) return;
    const data = {
      title: `${game.title} | OwOGG`,
      text: game.shortDescription,
      url: window.location.href,
    };
    try {
      if (navigator.share) await navigator.share(data);
      else await navigator.clipboard.writeText(window.location.href);
      setShared(true);
      window.setTimeout(() => setShared(false), 1800);
    } catch {
      // Native share cancellation is not an error the page needs to surface.
    }
  };

  const fullscreen = async () => {
    if (!galleryRef.current || typeof document === "undefined" || !document.fullscreenEnabled)
      return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await galleryRef.current.requestFullscreen();
  };

  if (loading) {
    return <DetailSkeleton />;
  }

  if (!game) {
    return (
      <div className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col items-center justify-center px-6 text-center">
        <MonitorPlay className="h-12 w-12 text-text-muted" />
        <h1 className="mt-5 text-2xl font-black text-text-primary">게임 소개를 찾을 수 없습니다</h1>
        <p className="mt-2 text-sm text-text-muted">
          {error ?? "비공개되었거나 삭제된 소개입니다."}
        </p>
        <Link
          to="/external-games"
          className="mt-6 rounded-xl bg-brand px-4 py-2.5 text-xs font-black text-white"
        >
          목록으로 돌아가기
        </Link>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-1 flex-col bg-surface">
      {banner && (
        <div className="relative h-28 overflow-hidden border-b border-border sm:h-40 lg:h-48">
          <img
            src={banner.url}
            alt={banner.altText || `${game.title} 배너`}
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/20 to-black/10" />
        </div>
      )}

      <div
        className={`mx-auto flex w-full max-w-[1500px] flex-1 flex-col gap-5 px-3 pb-8 sm:px-5 lg:px-7 ${banner ? "-mt-8 relative z-10" : "pt-5"}`}
      >
        <section className="overflow-hidden rounded-2xl border border-border bg-black shadow-2xl shadow-black/30">
          <div
            ref={galleryRef}
            className="group relative flex aspect-video items-center justify-center bg-black"
          >
            {activeScreenshot ? (
              <img
                src={activeScreenshot.url}
                alt={activeScreenshot.altText || `${game.title} 소개 화면 ${activeIndex + 1}`}
                className="h-full w-full object-contain"
              />
            ) : (
              <div className="flex flex-col items-center gap-3 text-text-muted">
                <MonitorPlay className="h-12 w-12" />
                <span className="text-sm font-bold">등록된 소개 이미지가 없습니다</span>
              </div>
            )}
            {screenshots.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => moveGallery(-1)}
                  aria-label="이전 이미지"
                  className="absolute left-3 rounded-full border border-white/15 bg-black/60 p-2.5 text-white backdrop-blur transition hover:bg-black/80"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => moveGallery(1)}
                  aria-label="다음 이미지"
                  className="absolute right-3 rounded-full border border-white/15 bg-black/60 p-2.5 text-white backdrop-blur transition hover:bg-black/80"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
                <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/65 px-2.5 py-1 text-[10px] font-black text-white">
                  {activeIndex + 1} / {screenshots.length}
                </span>
              </>
            )}
            <button
              type="button"
              onClick={() => void fullscreen()}
              aria-label="이미지 전체 화면"
              className="absolute right-3 top-3 rounded-full border border-white/15 bg-black/60 p-2.5 text-white backdrop-blur transition hover:bg-black/80"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
          </div>
          {screenshots.length > 1 && (
            <GalleryThumbnails
              media={screenshots}
              activeIndex={activeIndex}
              onSelect={setActiveIndex}
            />
          )}
        </section>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <article className="min-w-0 rounded-2xl border border-border bg-surface-raised p-5 sm:p-6">
            <div className="flex flex-col gap-5 border-b border-border/70 pb-5 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <Link
                  to="/external-games"
                  className="mb-3 inline-flex items-center gap-1.5 text-xs font-bold text-text-muted hover:text-text-primary"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> 타 플랫폼 게임
                </Link>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-black text-text-primary sm:text-3xl">
                    {game.title}
                  </h1>
                  <span className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-2.5 py-1 text-[10px] font-black text-cyan-300">
                    {game.platformName}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-text-secondary">
                  {game.shortDescription}
                </p>
              </div>
              <a
                href={game.externalUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-brand px-5 py-3 text-sm font-black text-white shadow-lg shadow-brand/25 transition hover:bg-brand-hover"
              >
                게임 플레이 <ExternalLink className="h-4 w-4" />
              </a>
            </div>

            <div className="flex flex-wrap gap-2 border-b border-border/70 py-4">
              <button
                type="button"
                onClick={() => void toggleBookmark()}
                disabled={bookmarkBusy}
                aria-pressed={game.isBookmarked}
                className={`${actionClass} ${game.isBookmarked ? "border-brand/50 bg-brand/15 text-brand-light" : ""}`}
              >
                <Bookmark className={`h-4 w-4 ${game.isBookmarked ? "fill-current" : ""}`} />{" "}
                {game.isBookmarked ? "북마크됨" : "북마크"}
              </button>
              <button type="button" onClick={() => void share()} className={actionClass}>
                {shared ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}{" "}
                {shared ? "링크 복사됨" : "공유"}
              </button>
            </div>

            {error && (
              <p
                role="alert"
                className="mt-4 rounded-xl border border-accent-red/30 bg-accent-red/10 p-3 text-xs font-semibold text-accent-red"
              >
                {error}
              </p>
            )}

            <div className="external-game-markdown pt-6 text-sm leading-7 text-text-secondary [&_a]:font-bold [&_a]:text-brand-light [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-brand/40 [&_blockquote]:pl-4 [&_code]:rounded [&_code]:bg-surface-overlay [&_code]:px-1.5 [&_h1]:text-2xl [&_h1]:font-black [&_h1]:text-text-primary [&_h2]:pt-3 [&_h2]:text-xl [&_h2]:font-black [&_h2]:text-text-primary [&_h3]:pt-2 [&_h3]:text-lg [&_h3]:font-black [&_h3]:text-text-primary [&_li]:ml-5 [&_ol]:list-decimal [&_p]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-surface-overlay [&_pre]:p-4 [&_ul]:list-disc">
              <Markdown
                skipHtml
                urlTransform={defaultUrlTransform}
                components={{
                  a: ({ children, ...props }) => (
                    <a {...props} target="_blank" rel="noopener noreferrer nofollow">
                      {children}
                    </a>
                  ),
                  img: () => null,
                }}
              >
                {game.descriptionMarkdown}
              </Markdown>
            </div>
          </article>

          <aside className="space-y-4">
            <div className="rounded-2xl border border-border bg-surface-raised p-5">
              <h2 className="text-sm font-black text-text-primary">게임 정보</h2>
              <dl className="mt-4 space-y-4 text-xs">
                <Info icon={<UserRound className="h-4 w-4" />} label="소개한 사람">
                  <Link
                    to={`/users/${game.introducerUserId}`}
                    className="font-black text-brand-light hover:underline"
                  >
                    {game.introducerName}
                  </Link>
                </Info>
                <Info icon={<MonitorPlay className="h-4 w-4" />} label="플랫폼">
                  {game.platformName}
                </Info>
                <Info icon={<CalendarDays className="h-4 w-4" />} label="출시일">
                  {game.releaseDate ? formatReleaseDate(game.releaseDate) : "미입력"}
                </Info>
                <Info icon={<Bookmark className="h-4 w-4" />} label="북마크">
                  {game.bookmarkCount.toLocaleString()}명
                </Info>
              </dl>
              {game.tags.length > 0 && (
                <div className="mt-5 border-t border-border pt-4">
                  <p className="flex items-center gap-1.5 text-[11px] font-black text-text-muted">
                    <Tag className="h-3.5 w-3.5" /> 태그
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {game.tags.map((tag) => (
                      <Link
                        key={tag}
                        to={`/external-games?search=${encodeURIComponent(tag)}`}
                        className="rounded-full bg-surface-overlay px-2.5 py-1 text-[10px] font-bold text-text-secondary hover:text-brand-light"
                      >
                        #{tag}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="rounded-2xl border border-accent-yellow/25 bg-accent-yellow/5 p-4 text-xs leading-5 text-text-muted">
              <p className="font-black text-accent-yellow">외부 사이트 이동 안내</p>
              <p className="mt-1">
                OwOGG는 이 게임을 직접 실행하거나 운영하지 않습니다. 플레이 버튼을 누르면 외부
                사이트의 약관과 개인정보처리방침이 적용됩니다.
              </p>
            </div>
          </aside>
        </section>
      </div>
    </div>
  );
}

function GalleryThumbnails({
  media,
  activeIndex,
  onSelect,
}: {
  media: ExternalGameMedia[];
  activeIndex: number;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto border-t border-white/10 bg-surface-raised p-2 [scrollbar-width:thin]">
      {media.map((item, index) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onSelect(index)}
          aria-label={`소개 이미지 ${index + 1} 보기`}
          aria-current={index === activeIndex ? "true" : undefined}
          className={`relative h-16 w-28 shrink-0 overflow-hidden rounded-lg border-2 transition ${index === activeIndex ? "border-brand" : "border-transparent opacity-60 hover:opacity-100"}`}
        >
          <img src={item.url} alt="" className="h-full w-full object-cover" />
        </button>
      ))}
    </div>
  );
}

function Info({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 text-brand-light">{icon}</span>
      <div>
        <dt className="text-[10px] font-bold uppercase tracking-wider text-text-muted">{label}</dt>
        <dd className="mt-1 font-bold text-text-primary">{children}</dd>
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 px-3 py-5 sm:px-5 lg:px-7">
      <div className="aspect-video animate-pulse rounded-2xl border border-border bg-surface-raised" />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="h-96 animate-pulse rounded-2xl border border-border bg-surface-raised" />
        <div className="h-64 animate-pulse rounded-2xl border border-border bg-surface-raised" />
      </div>
    </div>
  );
}

function formatReleaseDate(value: string): string {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${year}.${month}.${day}` : value;
}

const actionClass =
  "inline-flex items-center justify-center gap-2 rounded-full border border-border bg-surface px-3.5 py-2.5 text-xs font-black text-text-secondary transition hover:border-brand/40 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40";
