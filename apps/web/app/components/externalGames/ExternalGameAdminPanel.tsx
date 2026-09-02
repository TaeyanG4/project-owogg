import { useCallback, useEffect, useState } from "react";
import {
  Check,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  MonitorPlay,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import type { ExternalGameRecord } from "@owogg/contracts";
import {
  decideAdminExternalGame,
  deleteAdminExternalGame,
  fetchAdminExternalGames,
  setAdminExternalGameVisibility,
} from "../../features/externalGamesApi";
import { ApiClientError } from "../../lib/api";

export function ExternalGameAdminPanel() {
  const [games, setGames] = useState<ExternalGameRecord[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetchAdminExternalGames({ page, pageSize: 20 });
      setGames(response.games);
      setTotal(response.total);
      setTotalPages(response.totalPages);
      setAccessDenied(false);
      setError(null);
    } catch (loadError) {
      if (loadError instanceof ApiClientError && [401, 403].includes(loadError.status ?? 0)) {
        setAccessDenied(true);
      } else {
        setError(
          loadError instanceof Error ? loadError.message : "외부 게임 소개를 불러오지 못했습니다.",
        );
      }
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await action();
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "요청을 처리하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  };

  if (accessDenied) {
    return (
      <section className="rounded-2xl border border-border bg-surface-raised p-5">
        <h2 className="flex items-center gap-2 text-sm font-black text-text-primary">
          <ShieldAlert className="h-4 w-4" /> 타 플랫폼 게임 심사
        </h2>
        <p className="mt-2 text-xs text-text-muted">
          이 화면에는 sandbox_games.review 권한과 관리자 로그인이 필요합니다.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-black text-text-primary">
            <MonitorPlay className="h-4 w-4" /> 타 플랫폼 게임 소개 관리 ({total})
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-text-muted">
            소개 내용·외부 링크·이미지와 권리 확인 메모를 검토합니다. 승인은 즉시 공개되며 작성자의
            심사 슬롯을 비웁니다.
          </p>
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-xl border border-accent-red/30 bg-accent-red/10 px-3 py-2 text-xs font-semibold text-accent-red"
        >
          {error}
        </p>
      )}

      {games === null ? (
        <p className="rounded-2xl border border-border bg-surface-raised p-8 text-center text-xs text-text-muted">
          불러오는 중...
        </p>
      ) : games.length === 0 ? (
        <p className="rounded-2xl border border-border bg-surface-raised p-8 text-center text-xs text-text-muted">
          등록된 타 플랫폼 게임 소개가 없습니다.
        </p>
      ) : (
        <div className="space-y-4">
          {games.map((game) => {
            const pending = game.moderationStatus === "PENDING_REVIEW";
            const reason = reasons[game.id] ?? "";
            return (
              <article
                key={game.id}
                className={`overflow-hidden rounded-2xl border bg-surface-raised ${pending ? "border-accent-yellow/40" : "border-border"}`}
              >
                {game.media.find((item) => item.kind === "BANNER") && (
                  <img
                    src={game.media.find((item) => item.kind === "BANNER")?.url}
                    alt={`${game.title} 배너`}
                    className="h-28 w-full object-cover sm:h-40"
                  />
                )}
                <div className="space-y-4 p-4 sm:p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-black text-text-primary">{game.title}</h3>
                        <AdminStatus game={game} />
                      </div>
                      <p className="mt-1 text-xs text-text-muted">
                        #{game.id} · {game.platformName} · 소개자 {game.introducerName} (사용자 #
                        {game.introducerUserId})
                      </p>
                      <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                        {game.shortDescription}
                      </p>
                    </div>
                    <a
                      href={game.externalUrl}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-black text-text-secondary hover:border-brand/40 hover:text-text-primary"
                    >
                      <ExternalLink className="h-4 w-4" /> 링크 확인
                    </a>
                  </div>

                  <div className="grid gap-3 rounded-xl border border-border/70 bg-surface p-3 text-[11px] leading-relaxed text-text-secondary sm:grid-cols-2">
                    <div>
                      <span className="font-black text-text-primary">게임 관계</span>
                      <p>
                        {game.ownershipType === "OWN_GAME" ? "본인이 만든 게임" : "제3자 게임 소개"}
                      </p>
                    </div>
                    <div>
                      <span className="font-black text-text-primary">출시일</span>
                      <p>{game.releaseDate ?? "미입력"}</p>
                    </div>
                    <div className="sm:col-span-2">
                      <span className="font-black text-text-primary">권리 확인 메모</span>
                      <p className="whitespace-pre-wrap">{game.rightsNote || "메모 없음"}</p>
                    </div>
                  </div>

                  {game.media.filter((item) => item.kind === "SCREENSHOT").length > 0 && (
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {game.media
                        .filter((item) => item.kind === "SCREENSHOT")
                        .map((media) => (
                          <img
                            key={media.id}
                            src={media.url}
                            alt={media.altText || game.title}
                            className="aspect-video w-full rounded-xl border border-border object-cover"
                          />
                        ))}
                    </div>
                  )}

                  {game.rejectReason && (
                    <p className="rounded-xl border border-accent-red/20 bg-accent-red/5 p-3 text-xs font-semibold text-accent-red">
                      최근 반려 사유: {game.rejectReason}
                    </p>
                  )}

                  {pending ? (
                    <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row">
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() =>
                          void run(`approve-${game.id}`, () =>
                            decideAdminExternalGame(game.id, "APPROVED", null),
                          )
                        }
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-accent-green/30 bg-accent-green/10 px-3 py-2.5 text-xs font-black text-accent-green hover:bg-accent-green/20 disabled:opacity-50"
                      >
                        {busy === `approve-${game.id}` ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4" />
                        )}{" "}
                        승인·공개
                      </button>
                      <input
                        value={reason}
                        onChange={(event) =>
                          setReasons((current) => ({ ...current, [game.id]: event.target.value }))
                        }
                        maxLength={1000}
                        placeholder="반려 사유 (필수)"
                        className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-xs text-text-primary outline-none focus:ring-2 focus:ring-brand"
                      />
                      <button
                        type="button"
                        disabled={busy !== null || !reason.trim()}
                        onClick={() =>
                          void run(`reject-${game.id}`, () =>
                            decideAdminExternalGame(game.id, "REJECTED", reason.trim()),
                          )
                        }
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-accent-red/30 bg-accent-red/10 px-3 py-2.5 text-xs font-black text-accent-red hover:bg-accent-red/20 disabled:opacity-50"
                      >
                        <X className="h-4 w-4" /> 반려
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                      {game.moderationStatus === "APPROVED" && game.deletedAt === null && (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() =>
                            void run(`visibility-${game.id}`, () =>
                              setAdminExternalGameVisibility(
                                game.id,
                                game.visibility === "PUBLIC" ? "PRIVATE" : "PUBLIC",
                              ),
                            )
                          }
                          className={actionClass}
                        >
                          {game.visibility === "PUBLIC" ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                          {game.visibility === "PUBLIC" ? "비공개" : "다시 공개"}
                        </button>
                      )}
                      {game.deletedAt === null && (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => {
                            const reasonText = window.prompt("삭제 사유를 입력하세요 (선택)");
                            if (reasonText !== null)
                              void run(`delete-${game.id}`, () =>
                                deleteAdminExternalGame(game.id, reasonText.trim() || null),
                              );
                          }}
                          className={`${actionClass} text-accent-red`}
                        >
                          <Trash2 className="h-4 w-4" /> 삭제
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <nav
          aria-label="타 플랫폼 게임 목록 페이지"
          className="flex items-center justify-center gap-3"
        >
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            className={actionClass}
          >
            이전
          </button>
          <span className="text-xs font-bold text-text-muted">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
            className={actionClass}
          >
            다음
          </button>
        </nav>
      )}
    </section>
  );
}

function AdminStatus({ game }: { game: ExternalGameRecord }) {
  const label = game.deletedAt
    ? "삭제됨"
    : game.moderationStatus === "PENDING_REVIEW"
      ? `심사 대기 · 슬롯 ${game.reviewSlot}`
      : game.moderationStatus === "APPROVED"
        ? game.visibility === "PUBLIC"
          ? "승인·공개"
          : "승인·비공개"
        : game.moderationStatus === "REJECTED"
          ? "반려"
          : "초안";
  return (
    <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-black text-brand-light">
      {label}
    </span>
  );
}

const actionClass =
  "inline-flex items-center justify-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-bold text-text-secondary hover:border-brand/40 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40";
