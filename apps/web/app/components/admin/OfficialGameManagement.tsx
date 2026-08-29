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
  AdminManagedMultiplayerProfile,
  AdminManagedMultiplayerProfileRequestListResponse,
  GameAvailabilityDto,
} from "@owogg/contracts";
import {
  deleteOfficialGame,
  fetchAdminGames,
  fetchManagedMultiplayerProfileRequests,
  fetchManagedMultiplayerProfiles,
  postManagedMultiplayerProfileActivation,
  postManagedMultiplayerProfileReview,
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

      <ManagedMultiplayerRelayControl />

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

type ManagedMultiplayerRequest =
  AdminManagedMultiplayerProfileRequestListResponse["requests"][number];

export function managedMultiplayerResolutionLabel(request: ManagedMultiplayerRequest): string {
  if (request.resolution.status === "SUPPORTED_V1") return "Relay v1 지원";
  if (request.resolution.status === "RUNTIME_NOT_AVAILABLE") {
    return `${request.resolution.runtimeKind} runtime 미지원`;
  }
  return `Relay 기능 미지원: ${request.resolution.unsupportedCapabilities.join(", ")}`;
}

function ManagedMultiplayerRelayControl() {
  const [requests, setRequests] = useState<readonly ManagedMultiplayerRequest[]>([]);
  const [profiles, setProfiles] = useState<readonly AdminManagedMultiplayerProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [requestResult, profileResult] = await Promise.all([
        fetchManagedMultiplayerProfileRequests(),
        fetchManagedMultiplayerProfiles(),
      ]);
      setRequests(requestResult.requests);
      setProfiles(profileResult.profiles);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Relay 심사 상태를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const review = async (request: ManagedMultiplayerRequest, decision: "APPROVED" | "REJECTED") => {
    let reasonCode: string | null = null;
    if (decision === "REJECTED") {
      const entered = window.prompt(
        "거절 사유 코드를 입력하세요. 영문 대문자, 숫자, 밑줄만 사용할 수 있습니다.",
        "ADMIN_REJECTED",
      );
      if (entered === null) return;
      reasonCode = entered.trim().toUpperCase();
      if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(reasonCode)) {
        setError("거절 사유 코드는 영문 대문자로 시작하는 1~64자 코드여야 합니다.");
        return;
      }
    } else if (
      !window.confirm(
        `요청 #${request.id}를 승인해 exact bundle용 비활성 Relay 프로필을 생성할까요? 실행 활성화는 별도 단계입니다.`,
      )
    ) {
      return;
    }

    setBusyKey(`request:${request.id}`);
    setError(null);
    try {
      await postManagedMultiplayerProfileReview(request.id, decision, reasonCode);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Relay 요청을 심사하지 못했습니다.");
    } finally {
      setBusyKey(null);
    }
  };

  const toggleProfile = async (profile: AdminManagedMultiplayerProfile) => {
    const enabled = !profile.enabled;
    if (
      !window.confirm(
        enabled
          ? `프로필 #${profile.id}를 활성화해 새 Relay 방 생성을 허용할까요?`
          : `프로필 #${profile.id}를 비활성화해 새 방 생성을 차단할까요?`,
      )
    ) {
      return;
    }
    setBusyKey(`profile:${profile.id}`);
    setError(null);
    try {
      await postManagedMultiplayerProfileActivation(
        profile.id,
        enabled,
        enabled ? null : "ADMIN_DISABLED",
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Relay 프로필 상태를 변경하지 못했습니다.");
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-surface-raised p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-black text-text-primary">
            <Network className="h-4 w-4" /> 일반 Multiplayer Relay 심사
          </h3>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-text-muted">
            ZIP은 실행 권한을 직접 얻지 않습니다. exact game version과 content hash에 묶인 요청을
            심사하면 비활성 프로필이 생성되고, 아래에서 별도로 활성화해야 새 방이 열립니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || busyKey !== null}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-bold text-text-primary hover:border-brand disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> 새로고침
        </button>
      </div>

      {error && <p className="mt-3 text-xs text-accent-red">{error}</p>}
      {loading ? (
        <p className="mt-4 text-xs text-text-muted">Relay 요청과 프로필을 불러오는 중...</p>
      ) : (
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <div>
            <h4 className="text-xs font-black text-text-primary">
              대기 중 요청 ({requests.length})
            </h4>
            <div className="mt-2 space-y-2">
              {requests.length === 0 && (
                <p className="rounded-xl border border-border p-3 text-xs text-text-muted">
                  심사 대기 중인 요청이 없습니다.
                </p>
              )}
              {requests.map((request) => {
                const busy = busyKey === `request:${request.id}`;
                const supported = request.resolution.status === "SUPPORTED_V1";
                return (
                  <article key={request.id} className="rounded-xl border border-border p-3">
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <strong className="text-text-primary">요청 #{request.id}</strong>
                      <span className="text-text-muted">
                        game {request.gameId} · version {request.gameVersionId}
                      </span>
                      <span
                        className={
                          supported
                            ? "rounded-full bg-accent-green/10 px-2 py-0.5 font-bold text-accent-green"
                            : "rounded-full bg-accent-red/10 px-2 py-0.5 font-bold text-accent-red"
                        }
                      >
                        {managedMultiplayerResolutionLabel(request)}
                      </span>
                    </div>
                    <p className="mt-2 break-all font-mono text-[10px] text-text-muted">
                      sha256:{request.contentHash}
                    </p>
                    <p className="mt-1 text-[11px] text-text-muted">
                      {request.request.players.min}~{request.request.players.max}명 · reconnect{" "}
                      {request.request.features.reconnect}
                      {request.request.features.directMessages ? " · direct" : ""}
                      {request.request.features.hostSnapshot ? " · host snapshot" : ""}
                    </p>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        disabled={busyKey !== null || !supported}
                        onClick={() => void review(request, "APPROVED")}
                        className="rounded-lg border border-accent-green/40 px-2.5 py-1.5 text-[11px] font-bold text-accent-green disabled:opacity-40"
                      >
                        {busy && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}
                        승인 후 프로필 생성
                      </button>
                      <button
                        type="button"
                        disabled={busyKey !== null}
                        onClick={() => void review(request, "REJECTED")}
                        className="rounded-lg border border-accent-red/40 px-2.5 py-1.5 text-[11px] font-bold text-accent-red disabled:opacity-40"
                      >
                        거절
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>

          <div>
            <h4 className="text-xs font-black text-text-primary">
              승인된 Relay 프로필 ({profiles.length})
            </h4>
            <div className="mt-2 space-y-2">
              {profiles.length === 0 && (
                <p className="rounded-xl border border-border p-3 text-xs text-text-muted">
                  승인된 일반 Relay 프로필이 없습니다.
                </p>
              )}
              {profiles.map((profile) => {
                const busy = busyKey === `profile:${profile.id}`;
                return (
                  <article key={profile.id} className="rounded-xl border border-border p-3">
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <strong className="text-text-primary">프로필 #{profile.id}</strong>
                      <span className="text-text-muted">version {profile.gameVersionId}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 font-bold ${
                          profile.enabled
                            ? "bg-accent-green/10 text-accent-green"
                            : "border border-border text-text-muted"
                        }`}
                      >
                        {profile.enabled ? "활성" : "비활성"}
                      </span>
                    </div>
                    <p className="mt-2 break-all font-mono text-[10px] text-text-muted">
                      sha256:{profile.contentHash}
                    </p>
                    <p className="mt-1 text-[11px] text-text-muted">
                      Relay v{profile.protocolVersion} · {profile.minPlayers}~{profile.maxPlayers}명
                      · reconnect {profile.reconnect}
                      {profile.directMessages ? " · direct" : ""}
                      {profile.hostSnapshot ? " · host snapshot" : ""} · 결과 미검증
                    </p>
                    <button
                      type="button"
                      disabled={busyKey !== null}
                      onClick={() => void toggleProfile(profile)}
                      className={`mt-3 inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold disabled:opacity-40 ${
                        profile.enabled
                          ? "border-accent-red/40 text-accent-red"
                          : "border-accent-green/40 text-accent-green"
                      }`}
                    >
                      {busy ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Power className="h-3 w-3" />
                      )}
                      {profile.enabled ? "비활성화" : "별도 활성화"}
                    </button>
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
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
