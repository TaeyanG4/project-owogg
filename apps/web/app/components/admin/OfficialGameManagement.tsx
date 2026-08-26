import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  FileArchive,
  FileJson,
  Gamepad2,
  Image,
  Loader2,
  Network,
  Pencil,
  Power,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import type {
  AdminGameListResponse,
  AdminOfficialMultiplayerProfileResponse,
  GameAvailabilityDto,
} from "@owogg/contracts";
import {
  deleteOfficialGame,
  fetchAdminGames,
  fetchOfficialMultiplayerProfile,
  postOfficialMultiplayerProfileEnabled,
  postToggleAdminGame,
  uploadOfficialGame,
  replaceOfficialGameBundle,
  replaceOfficialGameManifest,
  replaceOfficialGameLogo,
  patchOfficialGameBasicMetadata,
} from "../../features/adminApi";
import { ApiClientError } from "../../lib/api";
import { GameBundleDropzone } from "../game/GameBundleDropzone";
import {
  AdminGamePagination,
  formatServerUploadDate,
  type AdminGamePageSize,
} from "./AdminGamePagination";

/** Keeps a successful destructive mutation visible even if an older in-flight list request or a
 * briefly stale edge response arrives afterwards. The total is adjusted only when the returned
 * page still contains a hidden row, so an already-fresh server response is not decremented twice. */
export function hideDeletedAdminGames(
  data: AdminGameListResponse,
  deletedGameIds: ReadonlySet<string>,
): AdminGameListResponse {
  const hiddenCount = data.games.reduce(
    (count, game) => count + (deletedGameIds.has(game.gameId) ? 1 : 0),
    0,
  );
  if (hiddenCount === 0) return data;

  const total = Math.max(0, data.total - hiddenCount);
  const totalPages = Math.max(1, Math.ceil(total / data.pageSize));
  return {
    ...data,
    games: data.games.filter((game) => !deletedGameIds.has(game.gameId)),
    total,
    page: Math.min(data.page, totalPages),
    totalPages,
  };
}

/** `games.moderate` portion of the combined admin game workspace.
 *
 * Review permission remains independent, so this panel fails closed without hiding the review
 * tools from moderators who intentionally do not hold the official-publication permission.
 */
export function OfficialGameManagement() {
  const [data, setData] = useState<AdminGameListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busyGameId, setBusyGameId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [partBusy, setPartBusy] = useState<string | null>(null);
  const [expandedGameId, setExpandedGameId] = useState<string | null>(null);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<AdminGamePageSize>(10);
  const listRequestIdRef = useRef(0);
  const deletedGameIdsRef = useRef<Set<string>>(new Set());

  const loadGames = useCallback(async (targetPage: number, targetPageSize: AdminGamePageSize) => {
    const requestId = ++listRequestIdRef.current;
    setError(null);
    try {
      const fetched = await fetchAdminGames(targetPage, targetPageSize);
      if (requestId !== listRequestIdRef.current) return;
      const result = hideDeletedAdminGames(fetched, deletedGameIdsRef.current);
      setData(result);
      setAccessDenied(false);
      if (targetPage > result.totalPages) setPage(result.totalPages);
    } catch (err) {
      if (requestId !== listRequestIdRef.current) return;
      if (err instanceof ApiClientError && (err.status === 401 || err.status === 403)) {
        setAccessDenied(true);
        return;
      }
      setError(err instanceof Error ? err.message : "공개 게임 목록을 불러올 수 없습니다.");
    }
  }, []);

  useEffect(() => {
    void loadGames(page, pageSize);
  }, [loadGames, page, pageSize]);

  const handleToggle = async (gameId: string, nextEnabled: boolean) => {
    const reason = nextEnabled ? null : (reasons[gameId]?.trim() ?? "") || null;
    setBusyGameId(gameId);
    setError(null);
    try {
      await postToggleAdminGame(gameId, nextEnabled, reason);
      await loadGames(page, pageSize);
    } catch (err) {
      setError(err instanceof Error ? err.message : "게임 상태를 변경하지 못했습니다.");
    } finally {
      setBusyGameId(null);
    }
  };

  const handleOfficialUpload = async (file: File) => {
    setUploading(true);
    setError(null);
    setUploadMessage(null);
    try {
      const result = await uploadOfficialGame(file);
      deletedGameIdsRef.current.delete(result.slug);
      setUploadMessage(`${result.title} (${result.slug})을 OWOGG 공식 게임으로 게시했습니다.`);
      await loadGames(page, pageSize);
    } catch (err) {
      setError(err instanceof Error ? err.message : "공식 게임을 게시하지 못했습니다.");
    } finally {
      setUploading(false);
    }
  };

  const handleOfficialDelete = async (gameId: string, title: string) => {
    const confirmation = window.prompt(
      `"${title}" 공식 게임의 B2 콘텐츠와 공개 상태를 삭제합니다. 멀티플레이 감사 기록이 있으면 내부 식별자는 보존되지만 같은 slug로 다시 등록할 수 있습니다. 계속하려면 slug "${gameId}"를 입력하세요.`,
    );
    if (confirmation !== gameId) return;

    setBusyGameId(gameId);
    setError(null);
    setUploadMessage(null);
    try {
      const result = await deleteOfficialGame(gameId);
      deletedGameIdsRef.current.add(result.slug);
      // Invalidate any refresh that began before the DELETE completed, then remove the row before
      // making another network request. This makes the confirmed server mutation immediately
      // visible and prevents a late stale response from resurrecting the card.
      listRequestIdRef.current += 1;
      const nextData = data ? hideDeletedAdminGames(data, deletedGameIdsRef.current) : data;
      setData(nextData);
      if (expandedGameId === result.slug) setExpandedGameId(null);
      if (editingSlug === result.slug) setEditingSlug(null);
      setUploadMessage(
        result.identityRetainedForHistory
          ? `${result.slug} 공식 게임 콘텐츠를 삭제했습니다. 멀티플레이 감사 기록을 위해 내부 식별자는 보존되며 같은 slug로 다시 등록할 수 있습니다.`
          : `${result.slug} 공식 게임과 ${result.deletedVersionCount}개 버전을 완전히 삭제했습니다. 같은 slug로 다시 등록할 수 있습니다.`,
      );
      const nextPage = nextData?.page ?? page;
      if (nextPage !== page) setPage(nextPage);
      else await loadGames(nextPage, pageSize);
    } catch (err) {
      setError(err instanceof Error ? err.message : "공식 게임을 완전히 삭제하지 못했습니다.");
    } finally {
      setBusyGameId(null);
    }
  };

  const handlePartUpload = async (
    gameId: string,
    kind: "bundle" | "manifest" | "logo",
    file: File,
  ) => {
    setPartBusy(`${gameId}:${kind}`);
    setError(null);
    try {
      if (kind === "bundle") await replaceOfficialGameBundle(gameId, file);
      if (kind === "manifest") await replaceOfficialGameManifest(gameId, file);
      if (kind === "logo") await replaceOfficialGameLogo(gameId, file);
      setUploadMessage(
        kind === "logo"
          ? `${gameId} 로고를 교체했습니다.`
          : `${gameId} ${kind === "bundle" ? "전체 ZIP" : "owogg.json"}을 새 공식 버전으로 게시했습니다.`,
      );
      await loadGames(page, pageSize);
    } catch (err) {
      setError(err instanceof Error ? err.message : "게임 파일을 재업로드하지 못했습니다.");
    } finally {
      setPartBusy(null);
    }
  };

  if (accessDenied) {
    return (
      <section className="rounded-2xl border border-border bg-surface-raised p-5">
        <h2 className="flex items-center gap-1.5 text-sm font-black text-text-primary">
          <ShieldCheck className="h-4 w-4" /> OWOGG 공식 게임 관리
        </h2>
        <p className="mt-2 text-xs text-text-muted">
          공식 게임 업로드와 전체 게임 강제 비활성화에는 games.moderate 권한과 관리자 로그인이
          필요합니다.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="flex items-center gap-1.5 text-sm font-black text-text-primary">
          <ShieldCheck className="h-4 w-4" /> OWOGG 공식 게임 업로드
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-text-muted">
          게임 크리에이터 센터와 동일하게 index.html, owogg.json, owogg.logo 파일이 포함된
          standalone ZIP을 등록합니다. 이 관리자 경로의 제작자와 공식 표시는 서버가 OWOGG로 고정하며
          ZIP 내부 값으로 변경할 수 없습니다.
        </p>
      </div>

      <GameBundleDropzone
        busy={uploading}
        title="owogg.json이 포함된 ZIP을 여기로 끌어다 놓으면 OWOGG 공식 게임으로 게시됩니다"
        onFile={handleOfficialUpload}
      />

      {uploadMessage && (
        <p className="rounded-xl border border-accent-green/30 bg-accent-green/10 px-3 py-2 text-xs font-semibold text-accent-green">
          {uploadMessage}
        </p>
      )}
      {error && (
        <p className="rounded-xl border border-accent-red/30 bg-accent-red/10 px-3 py-2 text-xs text-accent-red">
          {error}
        </p>
      )}

      <div className="border-t border-border pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-black text-text-primary">전체 공개 게임 안전 제어</h3>
            <p className="mt-1 text-xs text-text-muted">
              비활성화하면 카탈로그에서 즉시 숨겨지고, 랭킹 대상 게임은 랭킹에서도 숨겨지며 새 결과
              제출이 거부됩니다.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadGames(page, pageSize)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface-raised px-3 py-2 text-xs font-bold text-text-primary transition-colors hover:border-brand hover:bg-surface-overlay"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            새로고침
          </button>
        </div>

        {!data ? (
          <p className="py-6 text-center text-xs text-text-muted">게임 목록을 불러오는 중...</p>
        ) : data.games.length === 0 ? (
          <p className="py-6 text-center text-xs text-text-muted">등록된 공개 게임이 없습니다.</p>
        ) : (
          <div className="mt-4 grid gap-3">
            {data.games.map((game) => {
              const busy = busyGameId === game.gameId;
              const expanded = expandedGameId === game.gameId;
              return (
                <article
                  key={game.gameId}
                  className={`overflow-hidden rounded-2xl border bg-surface-raised transition-colors ${
                    expanded ? "border-brand/50" : "border-border hover:border-brand/30"
                  }`}
                >
                  <div className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex min-w-0 items-start gap-3.5">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-brand/20 bg-brand/10 text-brand-light">
                        <Gamepad2 className="h-5 w-5" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="min-w-0 truncate text-sm font-black text-text-primary sm:text-base">
                            {game.title}
                          </h4>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
                              game.enabled
                                ? "bg-accent-green/10 text-accent-green"
                                : "bg-accent-red/10 text-accent-red"
                            }`}
                          >
                            {game.enabled ? "공개 중" : "비활성"}
                          </span>
                          {game.mode === "multi" && (
                            <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-bold text-brand-light">
                              멀티
                            </span>
                          )}
                        </div>
                        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-text-muted">
                          <span className="font-mono font-semibold text-text-secondary">
                            {game.gameId}
                          </span>
                          <span aria-hidden="true" className="text-text-muted/50">
                            •
                          </span>
                          <span>
                            {game.publisherType === "OWOGG" ? "OWOGG 공식" : "사용자 제작"}
                          </span>
                          <span aria-hidden="true" className="text-text-muted/50">
                            •
                          </span>
                          <span>업로드 {formatServerUploadDate(game.latestUploadedAt)} KST</span>
                        </p>
                        {!game.enabled && game.disabledReason && (
                          <p className="mt-1.5 text-[11px] text-accent-red">
                            비활성화 사유: {game.disabledReason}
                          </p>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={`official-game-management-${game.gameId}`}
                      onClick={() => {
                        setExpandedGameId(expanded ? null : game.gameId);
                        if (editingSlug !== null) setEditingSlug(null);
                      }}
                      className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition-colors ${
                        expanded
                          ? "border-brand/40 bg-brand/10 text-brand-light"
                          : "border-border bg-surface text-text-primary hover:border-brand"
                      }`}
                    >
                      <Settings2 className="h-3.5 w-3.5" />
                      {expanded ? "관리 닫기" : "관리 열기"}
                      <ChevronDown
                        className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
                      />
                    </button>
                  </div>

                  {expanded && (
                    <div
                      id={`official-game-management-${game.gameId}`}
                      className="border-t border-border bg-surface/55 p-4 sm:p-5"
                    >
                      <div
                        className={`grid gap-5 ${
                          game.publisherType === "OWOGG"
                            ? "xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.75fr)]"
                            : ""
                        }`}
                      >
                        {game.publisherType === "OWOGG" && (
                          <section>
                            <div>
                              <h5 className="text-xs font-black text-text-primary">
                                콘텐츠 및 기본 정보
                              </h5>
                              <p className="mt-1 text-[11px] text-text-muted">
                                게임 파일을 교체하거나 표시 정보를 새 버전으로 게시합니다.
                              </p>
                            </div>
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <PartUploadLabel
                                busy={partBusy === `${game.gameId}:bundle`}
                                icon={<FileArchive className="h-3.5 w-3.5" />}
                                label="전체 ZIP"
                                accept=".zip"
                                disabled={partBusy !== null}
                                onFile={(file) =>
                                  void handlePartUpload(game.gameId, "bundle", file)
                                }
                              />
                              <PartUploadLabel
                                busy={partBusy === `${game.gameId}:manifest`}
                                icon={<FileJson className="h-3.5 w-3.5" />}
                                label="owogg.json"
                                accept=".json,application/json"
                                disabled={partBusy !== null}
                                onFile={(file) =>
                                  void handlePartUpload(game.gameId, "manifest", file)
                                }
                              />
                              <PartUploadLabel
                                busy={partBusy === `${game.gameId}:logo`}
                                icon={<Image className="h-3.5 w-3.5" />}
                                label="로고"
                                accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml"
                                disabled={partBusy !== null}
                                onFile={(file) => void handlePartUpload(game.gameId, "logo", file)}
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setEditingSlug((current) =>
                                    current === game.gameId ? null : game.gameId,
                                  )
                                }
                                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface-raised px-3 py-2 text-xs font-bold text-text-primary transition-colors hover:border-brand"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                {editingSlug === game.gameId ? "속성 닫기" : "속성 편집"}
                              </button>
                            </div>
                          </section>
                        )}

                        <section>
                          <div>
                            <h5 className="text-xs font-black text-text-primary">서비스 상태</h5>
                            <p className="mt-1 text-[11px] text-text-muted">
                              공개 상태를 바꾸면 카탈로그와 결과 제출에 즉시 반영됩니다.
                            </p>
                          </div>
                          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                            {game.enabled && (
                              <input
                                type="text"
                                aria-label={`${game.title} 비활성화 사유`}
                                placeholder="비활성화 사유 (선택)"
                                value={reasons[game.gameId] ?? ""}
                                onChange={(event) =>
                                  setReasons((previous) => ({
                                    ...previous,
                                    [game.gameId]: event.target.value,
                                  }))
                                }
                                className="min-w-0 flex-1 rounded-xl border border-border bg-surface-raised px-3 py-2 text-xs text-text-primary outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
                              />
                            )}
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handleToggle(game.gameId, !game.enabled)}
                              className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition-colors disabled:opacity-50 ${
                                game.enabled
                                  ? "border-accent-red/30 bg-accent-red/10 text-accent-red hover:bg-accent-red/20"
                                  : "border-accent-green/30 bg-accent-green/10 text-accent-green hover:bg-accent-green/20"
                              }`}
                            >
                              {busy ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Power className="h-3.5 w-3.5" />
                              )}
                              {game.enabled ? "게임 비활성화" : "게임 활성화"}
                            </button>
                          </div>
                        </section>
                      </div>

                      {supportsOfficialOmokProfileControl(game) && (
                        <section className="mt-4 rounded-xl border border-border bg-surface-raised p-3">
                          <h5 className="text-xs font-black text-text-primary">멀티플레이 서버</h5>
                          <OfficialOmokProfileControl gameId={game.gameId} />
                        </section>
                      )}

                      {game.publisherType === "OWOGG" && (
                        <section className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <h5 className="text-xs font-black text-text-primary">위험 작업</h5>
                            <p className="mt-1 text-[11px] text-text-muted">
                              게임 콘텐츠와 공개 상태를 삭제합니다. 실행 전 slug를 다시 확인합니다.
                            </p>
                          </div>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleOfficialDelete(game.gameId, game.title)}
                            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl border border-accent-red/40 bg-accent-red/10 px-3 py-2 text-xs font-bold text-accent-red transition-colors hover:bg-accent-red/20 disabled:opacity-50"
                          >
                            {busy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                            게임 삭제
                          </button>
                        </section>
                      )}

                      {editingSlug === game.gameId && (
                        <OfficialMetadataEditor
                          key={game.gameId}
                          game={game}
                          onSaved={async (message) => {
                            setUploadMessage(message);
                            setEditingSlug(null);
                            await loadGames(page, pageSize);
                          }}
                          onError={setError}
                        />
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
        {data && (
          <AdminGamePagination
            page={data.page}
            pageSize={pageSize}
            total={data.total}
            totalPages={data.totalPages}
            onPageChange={setPage}
            onPageSizeChange={(nextPageSize) => {
              setPageSize(nextPageSize);
              setPage(1);
            }}
          />
        )}
      </div>
    </section>
  );
}

export function supportsOfficialOmokProfileControl(game: GameAvailabilityDto): boolean {
  return game.publisherType === "OWOGG" && game.gameId === "official-omok" && game.mode === "multi";
}

function OfficialOmokProfileControl({ gameId }: { gameId: string }) {
  const [profile, setProfile] = useState<AdminOfficialMultiplayerProfileResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setProfile(await fetchOfficialMultiplayerProfile(gameId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "멀티플레이 프로필을 조회하지 못했습니다.");
    }
  }, [gameId]);

  useEffect(() => {
    void load();
  }, [load]);

  const enabled = profile?.status === "ENABLED";
  const requiresCodeAccessUpgrade = profile?.profile?.allowedJoinPolicies[0] === "INVITE_ONLY";
  const statusLabel =
    profile === null
      ? error
        ? "조회 실패"
        : "조회 중"
      : profile.status === "ENABLED"
        ? "서버 멀티 활성"
        : profile.status === "DISABLED"
          ? "서버 멀티 비활성"
          : "서버 승인 전";

  const handleToggle = async () => {
    const nextEnabled = requiresCodeAccessUpgrade ? true : !enabled;
    const confirmed = window.confirm(
      requiresCodeAccessUpgrade
        ? "기존 일회용 초대 방식에서 비공개 방 코드 참가 방식으로 프로필을 갱신할까요? 기존 진행 중인 방에는 영향을 주지 않습니다."
        : nextEnabled
          ? "현재 live 버전에 OWOGG 서버 권위형 오목 프로필을 활성화할까요? 점수 랭킹은 생성되지 않습니다."
          : "새 방 생성·입장·재연결을 차단할까요? 이미 연결된 방은 즉시 종료되지 않을 수 있습니다.",
    );
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      setProfile(
        await postOfficialMultiplayerProfileEnabled(
          gameId,
          nextEnabled,
          nextEnabled ? null : "ADMIN_DISABLED",
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "멀티플레이 프로필을 변경하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-1 font-bold ${
          enabled ? "bg-accent-green/10 text-accent-green" : "border border-border text-text-muted"
        }`}
      >
        <Network className="h-3 w-3" /> {statusLabel}
      </span>
      <span className="rounded-full border border-border px-2 py-1 font-bold text-text-muted">
        랭킹 없음 · 2인 비공개 코드방
      </span>
      <button
        type="button"
        disabled={busy || profile === null}
        onClick={() => void handleToggle()}
        className="inline-flex items-center gap-1 rounded-lg border border-brand/40 px-2 py-1 font-bold text-brand-light hover:bg-brand/10 disabled:opacity-50"
      >
        {busy && <Loader2 className="h-3 w-3 animate-spin" />}
        {requiresCodeAccessUpgrade ? "코드 참가로 갱신" : enabled ? "멀티 비활성화" : "멀티 활성화"}
      </button>
      {error && (
        <span className="basis-full text-accent-red">
          {error}{" "}
          <button type="button" onClick={() => void load()} className="font-bold underline">
            다시 시도
          </button>
        </span>
      )}
    </div>
  );
}

function PartUploadLabel({
  busy,
  icon,
  label,
  accept,
  disabled,
  onFile,
}: {
  busy: boolean;
  icon: React.ReactNode;
  label: string;
  accept: string;
  disabled: boolean;
  onFile: (file: File) => void;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-bold text-text-primary hover:border-brand">
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      {label}
      <input
        type="file"
        accept={accept}
        disabled={disabled}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onFile(file);
        }}
      />
    </label>
  );
}

function OfficialMetadataEditor({
  game,
  onSaved,
  onError,
}: {
  game: GameAvailabilityDto;
  onSaved: (message: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [title, setTitle] = useState(game.title);
  const [shortDescription, setShortDescription] = useState(game.shortDescription ?? "");
  const [description, setDescription] = useState(game.description ?? "");
  const [genre, setGenre] = useState(game.genre ?? "");
  const [mode, setMode] = useState<"single" | "multi">(game.mode ?? "single");
  const [busy, setBusy] = useState(false);

  return (
    <div className="mt-4 space-y-3 rounded-2xl border border-brand/30 bg-surface p-4">
      <div>
        <h4 className="text-sm font-black text-text-primary">{game.gameId} 핵심 속성</h4>
        <p className="mt-1 text-[11px] text-text-muted">
          slug는 변경되지 않습니다. 저장하면 수정된 owogg.json을 포함한 새 공식 버전이 게시됩니다.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <AdminField label="제목">
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} />
        </AdminField>
        <AdminField label="장르">
          <input value={genre} onChange={(e) => setGenre(e.target.value)} maxLength={40} />
        </AdminField>
        <AdminField label="모드">
          <select value={mode} onChange={(e) => setMode(e.target.value as "single" | "multi")}>
            <option value="single">single</option>
            <option value="multi">multi</option>
          </select>
        </AdminField>
        <AdminField label="짧은 설명">
          <input
            value={shortDescription}
            onChange={(e) => setShortDescription(e.target.value)}
            maxLength={200}
          />
        </AdminField>
      </div>
      <AdminField label="상세 설명">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={4000}
          rows={4}
        />
      </AdminField>
      <button
        type="button"
        disabled={busy || !title.trim() || !genre.trim()}
        onClick={async () => {
          setBusy(true);
          try {
            const result = await patchOfficialGameBasicMetadata(game.gameId, {
              title: title.trim(),
              shortDescription: shortDescription.trim() || null,
              description: description.trim() || null,
              genre: genre.trim(),
              mode,
            });
            await onSaved(`${result.slug} 핵심 속성을 새 공식 버전으로 게시했습니다.`);
          } catch (err) {
            onError(err instanceof Error ? err.message : "속성을 수정하지 못했습니다.");
          } finally {
            setBusy(false);
          }
        }}
        className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2.5 text-xs font-bold text-white hover:bg-brand-light disabled:opacity-50"
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Pencil className="h-3.5 w-3.5" />
        )}
        새 버전으로 저장
      </button>
    </div>
  );
}

function AdminField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[11px] font-bold text-text-muted [&_input]:rounded-xl [&_input]:border [&_input]:border-border [&_input]:bg-surface-raised [&_input]:px-3 [&_input]:py-2 [&_input]:text-sm [&_input]:text-text-primary [&_select]:rounded-xl [&_select]:border [&_select]:border-border [&_select]:bg-surface-raised [&_select]:px-3 [&_select]:py-2 [&_select]:text-sm [&_select]:text-text-primary [&_textarea]:rounded-xl [&_textarea]:border [&_textarea]:border-border [&_textarea]:bg-surface-raised [&_textarea]:px-3 [&_textarea]:py-2 [&_textarea]:text-sm [&_textarea]:text-text-primary">
      {label}
      {children}
    </label>
  );
}
