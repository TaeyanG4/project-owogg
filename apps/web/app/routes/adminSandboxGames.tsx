import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";
import {
  Check,
  Eye,
  EyeOff,
  Gamepad2,
  History,
  ListChecks,
  Loader2,
  Package,
  RotateCcw,
  Search,
  ShieldAlert,
  Trash2,
  X,
  FileArchive,
  FileJson,
  FileText,
  Image,
} from "lucide-react";
import { useAuth } from "../features/auth";
import {
  fetchSandboxReviewQueue,
  fetchAllSandboxGames,
  fetchAdminSandboxGameDetail,
  postApproveSandboxVersion,
  postRejectSandboxVersion,
  postRevokeSandboxVersion,
  patchSandboxGameMetadata,
  patchAdminSandboxGameBasicMetadata,
  patchSandboxGameVisibility,
  deleteSandboxGame,
  purgeSandboxGame,
  uploadAdminSandboxGameVersion,
  replaceAdminSandboxGameManifest,
  replaceAdminSandboxGameDescription,
  replaceAdminSandboxGameLogo,
} from "../features/adminApi";
import type {
  SandboxGameReviewQueueResponse,
  SandboxGameDetailResponse,
  SandboxGameRecord,
  AdminSandboxGameListResponse,
} from "@owogg/contracts";
import { ApiClientError } from "../lib/api";
import { OfficialGameManagement } from "../components/admin/OfficialGameManagement";
import {
  AdminGamePagination,
  formatServerUploadDate,
  type AdminGamePageSize,
} from "../components/admin/AdminGamePagination";

export function meta() {
  return [
    { title: "게임 관리 및 심사 | OwOGG" },
    { name: "description", content: "OWOGG 공식 게임 게시와 사용자 제작 게임 심사·공개 관리" },
    { name: "robots", content: "noindex,nofollow" },
  ];
}

export default function AdminSandboxGamesRoute() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [activeSection, setActiveSection] = useState<"OWOGG" | "USER">("OWOGG");
  const [queue, setQueue] = useState<SandboxGameReviewQueueResponse | null>(null);
  const [allGames, setAllGames] = useState<AdminSandboxGameListResponse | null>(null);
  const [userPage, setUserPage] = useState(1);
  const [userPageSize, setUserPageSize] = useState<AdminGamePageSize>(10);
  const [togglingGameId, setTogglingGameId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewAccessDenied, setReviewAccessDenied] = useState(false);
  const [busyVersionId, setBusyVersionId] = useState<number | null>(null);
  const [rejectReasons, setRejectReasons] = useState<Record<number, string>>({});

  const [gameIdInput, setGameIdInput] = useState("");
  const [detail, setDetail] = useState<SandboxGameDetailResponse | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const loadQueue = async (targetPage: number, targetPageSize: AdminGamePageSize) => {
    setError(null);
    try {
      const [queueRes, gamesRes] = await Promise.all([
        fetchSandboxReviewQueue(),
        fetchAllSandboxGames(targetPage, targetPageSize),
      ]);
      setQueue(queueRes);
      if (targetPage > gamesRes.totalPages) {
        setUserPage(gamesRes.totalPages);
        return;
      }
      setAllGames(gamesRes);
      setReviewAccessDenied(false);
    } catch (err) {
      if (err instanceof ApiClientError && (err.status === 401 || err.status === 403)) {
        setReviewAccessDenied(true);
      } else {
        setError(err instanceof Error ? err.message : "심사 큐를 불러올 수 없습니다.");
      }
    }
  };

  useEffect(() => {
    if (!authLoading && isAuthenticated && activeSection === "USER") {
      void loadQueue(userPage, userPageSize);
    }
  }, [authLoading, isAuthenticated, activeSection, userPage, userPageSize]);

  // Inline activate/deactivate from the game list — same action as GameDetailPanel's visibility
  // toggle, just without opening the detail panel first.
  const handleToggleGameVisibility = async (gameRecord: SandboxGameRecord) => {
    if (togglingGameId !== null) return;
    setTogglingGameId(gameRecord.id);
    setError(null);
    try {
      const updated = await patchSandboxGameVisibility(
        gameRecord.id,
        gameRecord.visibility === "PUBLIC" ? "PRIVATE" : "PUBLIC",
      );
      setAllGames((prev) =>
        prev
          ? {
              ...prev,
              entries: prev.entries.map((entry) =>
                entry.game.id === updated.id ? { ...entry, game: updated } : entry,
              ),
            }
          : prev,
      );
      if (detail?.game.id === updated.id) setDetail({ ...detail, game: updated });
    } catch (err) {
      setError(err instanceof Error ? err.message : "공개 상태 변경에 실패했습니다.");
    } finally {
      setTogglingGameId(null);
    }
  };

  // The row is gone after this (see purgeSandboxGame) — unlike every other action here, there is
  // no updated record to fold back in. Drop it from the list and close the detail panel if it was
  // showing this game.
  const handlePurged = (gameId: number) => {
    setDetail((prev) => (prev?.game.id === gameId ? null : prev));
    void loadQueue(userPage, userPageSize);
  };

  const handleOpenGame = async (id: number) => {
    setGameIdInput(String(id));
    setLoadingDetail(true);
    setError(null);
    try {
      setDetail(await fetchAdminSandboxGameDetail(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "게임 정보를 불러올 수 없습니다.");
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleApprove = async (versionId: number) => {
    setBusyVersionId(versionId);
    setError(null);
    try {
      await postApproveSandboxVersion(versionId);
      await loadQueue(userPage, userPageSize);
    } catch (err) {
      setError(err instanceof Error ? err.message : "승인에 실패했습니다.");
    } finally {
      setBusyVersionId(null);
    }
  };

  const handleReject = async (versionId: number) => {
    const reason = rejectReasons[versionId]?.trim();
    if (!reason) {
      setError("반려 사유를 입력하세요.");
      return;
    }
    setBusyVersionId(versionId);
    setError(null);
    try {
      await postRejectSandboxVersion(versionId, reason);
      setRejectReasons((prev) =>
        Object.fromEntries(Object.entries(prev).filter(([id]) => Number(id) !== versionId)),
      );
      await loadQueue(userPage, userPageSize);
    } catch (err) {
      setError(err instanceof Error ? err.message : "반려에 실패했습니다.");
    } finally {
      setBusyVersionId(null);
    }
  };

  const handleLoadGame = async (e: FormEvent) => {
    e.preventDefault();
    const id = Number(gameIdInput.trim());
    if (!Number.isInteger(id) || id <= 0) {
      setError("유효한 게임 ID를 입력하세요.");
      return;
    }
    setLoadingDetail(true);
    setError(null);
    try {
      setDetail(await fetchAdminSandboxGameDetail(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "게임 정보를 불러올 수 없습니다.");
    } finally {
      setLoadingDetail(false);
    }
  };

  if (authLoading) return <PageMessage>접근 권한을 확인하는 중...</PageMessage>;

  if (!isAuthenticated) {
    return (
      <PageMessage>
        게임 심사 도구를 사용하려면 <Link to="/profile">OwOGG 로그인</Link>이 필요합니다.
      </PageMessage>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8 md:px-8">
      <header>
        <div className="mb-2 flex items-center gap-2 text-accent-yellow">
          <ShieldAlert className="h-5 w-5" />
          <span className="text-xs font-bold uppercase tracking-[0.2em]">Admin Safety</span>
        </div>
        <h1 className="text-2xl font-black text-text-primary">게임 관리 및 심사</h1>
        <p className="mt-1 text-xs text-text-muted">
          OWOGG 공식 게임 게시와 사용자 제작 게임 심사를 한곳에서 관리합니다. 사용자 게임의 버전
          승인은 공개와 별개이며, 승인 후 "공개 전환"을 해야 서비스가 시작됩니다.
        </p>
      </header>

      <div
        role="tablist"
        aria-label="게임 관리 구분"
        className="grid gap-2 rounded-2xl border border-border bg-surface-raised p-2 sm:grid-cols-2"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeSection === "OWOGG"}
          onClick={() => setActiveSection("OWOGG")}
          className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-black transition-colors ${
            activeSection === "OWOGG"
              ? "bg-brand text-white shadow-lg"
              : "text-text-muted hover:bg-surface-overlay hover:text-text-primary"
          }`}
        >
          <ShieldAlert className="h-4 w-4" /> 공식 게임
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeSection === "USER"}
          onClick={() => setActiveSection("USER")}
          className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-black transition-colors ${
            activeSection === "USER"
              ? "bg-brand text-white shadow-lg"
              : "text-text-muted hover:bg-surface-overlay hover:text-text-primary"
          }`}
        >
          <Gamepad2 className="h-4 w-4" /> 사용자 제작 게임
        </button>
      </div>

      {error && (
        <div className="rounded-2xl border border-accent-red/30 bg-accent-red/10 p-4 text-xs text-accent-red">
          {error}
        </div>
      )}

      {activeSection === "OWOGG" ? (
        <OfficialGameManagement />
      ) : reviewAccessDenied ? (
        <section className="rounded-2xl border border-border bg-surface-raised p-5">
          <h2 className="text-sm font-black text-text-primary">사용자 제작 게임 심사</h2>
          <p className="mt-2 text-xs text-text-muted">
            심사 큐와 사용자 게임 공개 관리에는 sandbox_games.review 권한과 관리자 로그인이
            필요합니다.
          </p>
          <Link
            to="/admin"
            className="mt-4 inline-flex rounded-xl border border-border px-3 py-2 text-xs font-bold text-text-primary hover:border-brand"
          >
            관리자 센터로 돌아가기
          </Link>
        </section>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="flex items-center gap-1.5 text-sm font-bold text-text-primary">
              <Package className="h-4 w-4" /> 심사 대기 ({queue?.total ?? 0})
            </h2>
            {!queue ? (
              <PageMessage small>불러오는 중...</PageMessage>
            ) : queue.entries.length === 0 ? (
              <p className="rounded-2xl border border-border bg-surface-raised p-6 text-center text-xs text-text-muted">
                대기 중인 심사가 없습니다.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {queue.entries.map((entry) => {
                  const busy = busyVersionId === entry.version.id;
                  return (
                    <div
                      key={entry.version.id}
                      className="flex flex-col gap-3 rounded-2xl border border-border bg-surface-raised p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-bold text-text-primary">
                            {entry.gameTitle}{" "}
                            <span className="text-[10px] font-bold text-text-muted">
                              #{entry.gameId} · {entry.gameSlug}
                            </span>
                          </p>
                          <p className="text-[11px] text-text-muted">
                            제작자 #{entry.developerUserId} · 업로드{" "}
                            {entry.version.uploadedAt.split("T")[0]} ·{" "}
                            {(entry.version.bundleBytes / 1024 / 1024).toFixed(1)}MB
                          </p>
                        </div>
                        <span className="rounded-full bg-accent-yellow/10 px-2 py-0.5 text-[10px] font-bold text-accent-yellow">
                          {entry.version.status === "PENDING_REVIEW"
                            ? "심사 대기"
                            : entry.version.status}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleApprove(entry.version.id)}
                          className="flex items-center gap-1.5 rounded-xl border border-accent-green/30 bg-accent-green/10 px-3 py-2 text-xs font-bold text-accent-green hover:bg-accent-green/20 disabled:opacity-50"
                        >
                          {busy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Check className="h-3.5 w-3.5" />
                          )}
                          승인
                        </button>
                        <input
                          type="text"
                          placeholder="반려 사유 (필수)"
                          value={rejectReasons[entry.version.id] ?? ""}
                          onChange={(e) =>
                            setRejectReasons((prev) => ({
                              ...prev,
                              [entry.version.id]: e.target.value,
                            }))
                          }
                          className="min-w-[180px] flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-xs text-text-primary outline-none focus:ring-2 focus:ring-brand"
                        />
                        <button
                          type="button"
                          disabled={busy || !rejectReasons[entry.version.id]?.trim()}
                          onClick={() => void handleReject(entry.version.id)}
                          className="flex items-center gap-1.5 rounded-xl border border-accent-red/30 bg-accent-red/10 px-3 py-2 text-xs font-bold text-accent-red hover:bg-accent-red/20 disabled:opacity-50"
                        >
                          <X className="h-3.5 w-3.5" />
                          반려
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="space-y-3 border-t border-border pt-6">
            <h2 className="flex items-center gap-1.5 text-sm font-bold text-text-primary">
              <ListChecks className="h-4 w-4" /> 사용자 제작 게임 관리 ({allGames?.total ?? 0})
            </h2>
            {!allGames ? (
              <PageMessage small>불러오는 중...</PageMessage>
            ) : allGames.entries.length === 0 ? (
              <p className="rounded-2xl border border-border bg-surface-raised p-6 text-center text-xs text-text-muted">
                등록된 게임이 없습니다.
              </p>
            ) : (
              <div className="flex flex-col divide-y divide-border/60 rounded-2xl border border-border bg-surface-raised px-4">
                {allGames.entries.map(({ game: g, latestUploadedAt }) => (
                  <div
                    key={g.id}
                    className="flex flex-col justify-between gap-3 py-3 sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-text-primary">
                        {g.title}{" "}
                        <span className="text-[10px] font-bold text-text-muted">#{g.id}</span>
                      </p>
                      <p className="flex flex-wrap items-center gap-1.5 text-[10px] text-text-muted">
                        <span
                          className={`rounded-full px-1.5 py-0.5 font-bold ${
                            g.visibility === "PUBLIC"
                              ? "bg-accent-green/10 text-accent-green"
                              : "bg-surface-overlay text-text-muted"
                          }`}
                        >
                          {g.visibility === "PUBLIC" ? "활성" : "비활성"}
                        </span>
                        {g.deletedAt && (
                          <span className="rounded-full bg-accent-red/10 px-1.5 py-0.5 font-bold text-accent-red">
                            삭제됨
                          </span>
                        )}
                        <span>제작자 #{g.developerUserId}</span>
                        <span>{g.slug}</span>
                      </p>
                      <p className="mt-1 text-[10px] text-text-muted">
                        서버 업로드 (KST) {formatServerUploadDate(latestUploadedAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        disabled={
                          togglingGameId !== null ||
                          g.deletedAt !== null ||
                          (g.visibility === "PRIVATE" && g.liveVersionId === null)
                        }
                        onClick={() => void handleToggleGameVisibility(g)}
                        title={
                          g.deletedAt !== null
                            ? "삭제된 게임입니다. 승인 이력이 없는 초안만 완전 삭제할 수 있습니다."
                            : g.liveVersionId === null
                              ? "승인된 버전이 있어야 활성화할 수 있습니다."
                              : undefined
                        }
                        className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold disabled:opacity-40 ${
                          g.visibility === "PUBLIC"
                            ? "border-accent-green/30 bg-accent-green/10 text-accent-green hover:bg-accent-green/20"
                            : "border-border bg-surface text-text-primary hover:border-brand"
                        }`}
                      >
                        {togglingGameId === g.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : g.visibility === "PUBLIC" ? (
                          <Eye className="h-3.5 w-3.5" />
                        ) : (
                          <EyeOff className="h-3.5 w-3.5" />
                        )}
                        {g.visibility === "PUBLIC" ? "활성" : "비활성"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleOpenGame(g.id)}
                        className="rounded-xl border border-border bg-surface px-3 py-2 text-xs font-bold text-text-primary hover:border-brand"
                      >
                        관리
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {allGames && (
              <AdminGamePagination
                page={allGames.page}
                pageSize={userPageSize}
                total={allGames.total}
                totalPages={allGames.totalPages}
                onPageChange={setUserPage}
                onPageSizeChange={(nextPageSize) => {
                  setUserPageSize(nextPageSize);
                  setUserPage(1);
                }}
              />
            )}
          </section>

          <section className="space-y-3 border-t border-border pt-6">
            <h2 className="flex items-center gap-1.5 text-sm font-bold text-text-primary">
              <Gamepad2 className="h-4 w-4" /> 사용자 게임 메타데이터 / 공개 관리
            </h2>
            <form onSubmit={(e) => void handleLoadGame(e)} className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                <input
                  type="text"
                  inputMode="numeric"
                  value={gameIdInput}
                  onChange={(e) => setGameIdInput(e.target.value)}
                  placeholder="게임 ID (심사 큐의 # 뒤 번호)"
                  className="w-full rounded-xl border border-border bg-surface-raised py-2.5 pl-10 pr-4 text-sm text-text-primary outline-none focus:ring-2 focus:ring-brand"
                />
              </div>
              <button
                type="submit"
                disabled={loadingDetail}
                className="rounded-xl bg-brand px-4 py-2.5 text-xs font-bold text-white hover:bg-brand-light disabled:opacity-50"
              >
                {loadingDetail ? <Loader2 className="h-4 w-4 animate-spin" /> : "불러오기"}
              </button>
            </form>

            {detail && (
              <GameDetailPanel
                key={`${detail.game.id}:${detail.game.updatedAt}`}
                detail={detail}
                onChanged={setDetail}
                onPurged={handlePurged}
                onError={setError}
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}

function GameDetailPanel({
  detail,
  onChanged,
  onPurged,
  onError,
}: {
  detail: SandboxGameDetailResponse;
  onChanged: (detail: SandboxGameDetailResponse) => void;
  onPurged: (gameId: number) => void;
  onError: (message: string) => void;
}) {
  const { game } = detail;
  const slugPermanentlyReserved =
    detail.versions.some((version) => version.status === "APPROVED") ||
    detail.auditLog.some((entry) => entry.action === "VERSION_APPROVED");
  const [title, setTitle] = useState(game.title);
  const [shortDescription, setShortDescription] = useState(game.shortDescription ?? "");
  const [genre, setGenre] = useState(game.genre);
  const [mode, setMode] = useState<"single" | "multi">(game.mode);
  const [tags, setTags] = useState(game.tags.join(", "));
  const [defaultScreenMode, setDefaultScreenMode] = useState<"default" | "theater">(
    game.defaultScreenMode,
  );
  const [xp, setXp] = useState(String(game.xpPerCompletion));
  const [scoreUnit, setScoreUnit] = useState(game.scoreUnit ?? "");
  const [scoreDirection, setScoreDirection] = useState(game.scoreDirection ?? "");
  const [scoreMin, setScoreMin] = useState(game.scoreMin === null ? "" : String(game.scoreMin));
  const [scoreMax, setScoreMax] = useState(game.scoreMax === null ? "" : String(game.scoreMax));
  const [saving, setSaving] = useState(false);
  const [togglingVisibility, setTogglingVisibility] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [purging, setPurging] = useState(false);
  const [revokingVersionId, setRevokingVersionId] = useState<number | null>(null);
  const [uploadingPart, setUploadingPart] = useState<
    "bundle" | "manifest" | "description" | "logo" | null
  >(null);

  const handleSaveMetadata = async () => {
    setSaving(true);
    onError("");
    try {
      const nextTitle = title.trim();
      const nextShortDescription = shortDescription.trim() || null;
      const nextGenre = genre.trim();
      const nextTags = tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
      const basicChanged =
        nextTitle !== game.title ||
        nextShortDescription !== game.shortDescription ||
        nextGenre !== game.genre ||
        mode !== game.mode ||
        nextTags.length !== game.tags.length ||
        nextTags.some((tag, index) => tag !== game.tags[index]) ||
        defaultScreenMode !== game.defaultScreenMode;
      const nextXp = Number(xp) || 0;
      const nextScoreUnit = scoreUnit.trim() || null;
      const nextScoreDirection = (scoreDirection || null) as "asc" | "desc" | null;
      const nextScoreMin = scoreMin === "" ? null : Number(scoreMin);
      const nextScoreMax = scoreMax === "" ? null : Number(scoreMax);
      const operationalChanged =
        nextXp !== game.xpPerCompletion ||
        nextScoreUnit !== game.scoreUnit ||
        nextScoreDirection !== game.scoreDirection ||
        nextScoreMin !== game.scoreMin ||
        nextScoreMax !== game.scoreMax;

      if (basicChanged) {
        await patchAdminSandboxGameBasicMetadata(game.id, {
          title: nextTitle,
          shortDescription: nextShortDescription,
          genre: nextGenre,
          mode,
          tags: nextTags,
          defaultScreenMode,
        });
      }
      if (operationalChanged) {
        await patchSandboxGameMetadata(game.id, {
          xpPerCompletion: nextXp,
          scoreUnit: nextScoreUnit,
          scoreDirection: nextScoreDirection,
          scoreMin: nextScoreMin,
          scoreMax: nextScoreMax,
        });
      }
      if (basicChanged || operationalChanged) {
        onChanged(await fetchAdminSandboxGameDetail(game.id));
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : "메타데이터 저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const handleSupportUpload = async (
    kind: "bundle" | "manifest" | "description" | "logo",
    file: File,
  ) => {
    setUploadingPart(kind);
    onError("");
    try {
      if (kind === "bundle") await uploadAdminSandboxGameVersion(game.id, file);
      if (kind === "manifest") await replaceAdminSandboxGameManifest(game.id, file);
      if (kind === "description") await replaceAdminSandboxGameDescription(game.id, file);
      if (kind === "logo") await replaceAdminSandboxGameLogo(game.id, file);
      onChanged(await fetchAdminSandboxGameDetail(game.id));
    } catch (err) {
      onError(err instanceof Error ? err.message : "게임 파일을 재업로드하지 못했습니다.");
    } finally {
      setUploadingPart(null);
    }
  };

  const handleToggleVisibility = async () => {
    setTogglingVisibility(true);
    onError("");
    try {
      const game2 = await patchSandboxGameVisibility(
        game.id,
        game.visibility === "PUBLIC" ? "PRIVATE" : "PUBLIC",
      );
      onChanged({ ...detail, game: game2 });
    } catch (err) {
      onError(err instanceof Error ? err.message : "공개 상태 변경에 실패했습니다.");
    } finally {
      setTogglingVisibility(false);
    }
  };

  // ADMIN/OPERATOR only (sandbox_games.delete) — enforced server-side; a MODERATOR who reaches
  // this page (they hold sandbox_games.review) sees the button but gets a 403 from the API if
  // they click it, surfaced the same way any other action-level failure is here.
  const handleDelete = async () => {
    if (deleting) return;
    if (
      !window.confirm(
        `"${game.title}" 게임을 삭제할까요? 즉시 비공개로 전환되며, 심사 중이던 제출도 함께 철회됩니다.`,
      )
    ) {
      return;
    }
    setDeleting(true);
    onError("");
    try {
      const game2 = await deleteSandboxGame(game.id);
      onChanged({ ...detail, game: game2 });
    } catch (err) {
      onError(err instanceof Error ? err.message : "삭제에 실패했습니다.");
    } finally {
      setDeleting(false);
    }
  };

  // Only reachable once the game is already soft-deleted (see the button's own guard). Separate,
  // stronger confirmation from handleDelete's — this is the one action on this page with no undo
  // and no audit trail left behind afterward.
  const handlePurge = async () => {
    if (purging) return;
    if (
      !window.confirm(
        `"${game.title}" 게임을 완전히 삭제할까요? 되돌릴 수 없고 감사 기록도 함께 사라집니다. 서버가 영구 슬러그 예약을 다시 확인하며, 승인 이력이 없는 경우에만 "${game.slug}"를 재사용할 수 있습니다.`,
      )
    ) {
      return;
    }
    setPurging(true);
    onError("");
    try {
      await purgeSandboxGame(game.id);
      onPurged(game.id);
    } catch (err) {
      onError(err instanceof Error ? err.message : "완전 삭제에 실패했습니다.");
      setPurging(false);
    }
  };

  // Undoes a mistaken approval — reverts the version to PENDING_REVIEW and, if it was the live
  // version, forces the game back to PRIVATE server-side. Re-fetches the full detail afterward
  // (rather than patching state by hand) since both the version and the game record can change.
  const handleRevoke = async (versionId: number) => {
    if (revokingVersionId !== null) return;
    const reason = window.prompt("철회 사유 (선택 사항, 감사 로그에 기록됩니다):");
    if (reason === null) return; // user cancelled the prompt
    setRevokingVersionId(versionId);
    onError("");
    try {
      await postRevokeSandboxVersion(versionId, reason.trim() || null);
      onChanged(await fetchAdminSandboxGameDetail(game.id));
    } catch (err) {
      onError(err instanceof Error ? err.message : "철회에 실패했습니다.");
    } finally {
      setRevokingVersionId(null);
    }
  };

  return (
    <div className="flex flex-col gap-6 rounded-2xl border border-border bg-surface-raised p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-black text-text-primary">{game.title}</h3>
            <span className="text-xs font-bold text-text-muted">
              #{game.id} · {game.slug}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-text-muted">
            제작자 #{game.developerUserId} · 등록일 {game.createdAt.split("T")[0]}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={
              togglingVisibility ||
              game.deletedAt !== null ||
              (game.visibility === "PRIVATE" && game.liveVersionId === null)
            }
            onClick={() => void handleToggleVisibility()}
            title={
              game.liveVersionId === null
                ? "승인된 버전이 있어야 공개로 전환할 수 있습니다."
                : undefined
            }
            className={`flex items-center gap-1.5 rounded-xl border px-4 py-2.5 text-xs font-bold disabled:opacity-40 ${
              game.visibility === "PUBLIC"
                ? "border-accent-green/30 bg-accent-green/10 text-accent-green hover:bg-accent-green/20"
                : "border-border bg-surface text-text-primary hover:border-brand"
            }`}
          >
            {togglingVisibility ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : game.visibility === "PUBLIC" ? (
              <Eye className="h-3.5 w-3.5" />
            ) : (
              <EyeOff className="h-3.5 w-3.5" />
            )}
            {game.visibility === "PUBLIC"
              ? "공개 중 (클릭 시 비공개)"
              : "비공개 (클릭 시 공개 전환)"}
          </button>
          <button
            type="button"
            disabled={deleting || game.deletedAt !== null}
            onClick={() => void handleDelete()}
            className="flex items-center gap-1.5 rounded-xl border border-accent-red/30 bg-accent-red/10 px-4 py-2.5 text-xs font-bold text-accent-red hover:bg-accent-red/20 disabled:opacity-40"
          >
            {deleting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            {game.deletedAt !== null ? "삭제됨" : "게임 삭제"}
          </button>
          {game.deletedAt !== null && (
            <button
              type="button"
              disabled={purging || slugPermanentlyReserved}
              onClick={() => void handlePurge()}
              title={
                slugPermanentlyReserved
                  ? "승인 이력이 있는 게임의 슬러그는 과거 기록 보호를 위해 영구 예약됩니다."
                  : "승인 이력이 없는 초안의 행·버전·감사 기록을 완전히 지우고 슬러그를 해제합니다."
              }
              className="flex items-center gap-1.5 rounded-xl border border-accent-red/60 bg-accent-red px-4 py-2.5 text-xs font-bold text-white hover:bg-accent-red/80 disabled:opacity-40"
            >
              {purging ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <X className="h-3.5 w-3.5" />
              )}
              {slugPermanentlyReserved ? "승인 이력 보존" : "완전 삭제 (슬러그 해제)"}
            </button>
          )}
        </div>
      </div>

      {game.deletedAt !== null && (
        <p className="rounded-xl border border-accent-red/30 bg-accent-red/10 px-3 py-2 text-[11px] font-semibold text-accent-red">
          이 게임은 {game.deletedAt.split("T")[0]}에 삭제되었습니다 (관리자 #{game.deletedByAdminId}
          ). 더 이상 플레이어에게 제공되지 않습니다.
        </p>
      )}

      {game.deletedAt === null && (
        <div className="rounded-xl border border-border bg-surface p-4">
          <h4 className="text-xs font-black text-text-primary">제작자 지원 재업로드</h4>
          <p className="mt-1 text-[11px] text-text-muted">
            전체 ZIP, owogg.json, 게임 설명은 새 심사 버전이 되며, 로고는 게임 공통 이미지로 즉시
            교체됩니다. 관리자는 설명·태그 수정의 24시간 제한을 적용받지 않습니다.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <SupportUploadLabel
              label="전체 ZIP"
              accept=".zip"
              busy={uploadingPart === "bundle"}
              disabled={uploadingPart !== null}
              icon={<FileArchive className="h-3.5 w-3.5" />}
              onFile={(file) => void handleSupportUpload("bundle", file)}
            />
            <SupportUploadLabel
              label="owogg.json"
              accept=".json,application/json"
              busy={uploadingPart === "manifest"}
              disabled={uploadingPart !== null}
              icon={<FileJson className="h-3.5 w-3.5" />}
              onFile={(file) => void handleSupportUpload("manifest", file)}
            />
            <SupportUploadLabel
              label="게임 설명"
              accept=".md,.zip,text/markdown,application/zip"
              busy={uploadingPart === "description"}
              disabled={uploadingPart !== null}
              icon={<FileText className="h-3.5 w-3.5" />}
              onFile={(file) => void handleSupportUpload("description", file)}
            />
            <SupportUploadLabel
              label="로고"
              accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml"
              busy={uploadingPart === "logo"}
              disabled={uploadingPart !== null}
              icon={<Image className="h-3.5 w-3.5" />}
              onFile={(file) => void handleSupportUpload("logo", file)}
            />
          </div>
        </div>
      )}

      <p className="rounded-xl border border-border/70 bg-surface px-3 py-2 text-[11px] leading-relaxed text-text-muted">
        제목·장르·모드·짧은 설명·태그·기본 화면은 새 <strong>owogg.json 심사 버전</strong>으로
        저장됩니다. XP와 점수 정책은 관리자 운영값으로 즉시 저장됩니다.
      </p>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <LabeledField label="제목">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-primary outline-none focus:ring-2 focus:ring-brand"
          />
        </LabeledField>
        <LabeledField label="장르">
          <input
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
            placeholder="예: 슈터, 퍼즐, 캐주얼"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-primary outline-none focus:ring-2 focus:ring-brand"
          />
        </LabeledField>
        <LabeledField label="모드">
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as "single" | "multi")}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-primary"
          >
            <option value="single">single</option>
            <option value="multi">multi</option>
          </select>
        </LabeledField>
        <LabeledField label="짧은 설명">
          <input
            value={shortDescription}
            onChange={(e) => setShortDescription(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-primary outline-none focus:ring-2 focus:ring-brand"
          />
        </LabeledField>
        <LabeledField label="완료 시 지급 XP">
          <input
            type="number"
            min={0}
            value={xp}
            onChange={(e) => setXp(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-primary outline-none focus:ring-2 focus:ring-brand"
          />
        </LabeledField>
        <LabeledField label="기본 게임 화면">
          <select
            value={defaultScreenMode}
            onChange={(e) => setDefaultScreenMode(e.target.value as "default" | "theater")}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-primary"
          >
            <option value="default">기본 모드</option>
            <option value="theater">영화관 모드</option>
          </select>
        </LabeledField>
        <LabeledField label="태그 (쉼표로 구분, 최대 20개)">
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-primary outline-none focus:ring-2 focus:ring-brand"
          />
        </LabeledField>
        <LabeledField label="점수 단위">
          <input
            value={scoreUnit}
            onChange={(e) => setScoreUnit(e.target.value)}
            placeholder="예: ms, 점"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-primary outline-none focus:ring-2 focus:ring-brand"
          />
        </LabeledField>
        <LabeledField label="랭크 정렬 방향">
          <select
            value={scoreDirection}
            onChange={(e) => setScoreDirection(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-primary"
          >
            <option value="">미설정</option>
            <option value="asc">낮을수록 우수 (asc)</option>
            <option value="desc">높을수록 우수 (desc)</option>
          </select>
        </LabeledField>
        <div className="grid grid-cols-2 gap-3">
          <LabeledField label="점수 최소">
            <input
              type="number"
              value={scoreMin}
              onChange={(e) => setScoreMin(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-primary outline-none focus:ring-2 focus:ring-brand"
            />
          </LabeledField>
          <LabeledField label="점수 최대">
            <input
              type="number"
              value={scoreMax}
              onChange={(e) => setScoreMax(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-primary outline-none focus:ring-2 focus:ring-brand"
            />
          </LabeledField>
        </div>
      </div>

      <button
        type="button"
        disabled={saving || game.deletedAt !== null}
        onClick={() => void handleSaveMetadata()}
        className="w-full rounded-xl bg-brand px-4 py-2.5 text-xs font-bold text-white hover:bg-brand-light disabled:opacity-50"
      >
        {saving ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "메타데이터 저장"}
      </button>

      <div className="border-t border-border pt-4">
        <h4 className="mb-2 text-xs font-black uppercase tracking-wide text-text-primary">
          버전 이력
        </h4>
        <div className="flex flex-col divide-y divide-border/60">
          {detail.versions.map((v) => (
            <div key={v.id} className="flex items-center justify-between gap-2 py-2 text-xs">
              <span className="text-text-muted">
                {v.uploadedAt.split("T")[0]} · {(v.bundleBytes / 1024 / 1024).toFixed(1)}MB
              </span>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    v.status === "APPROVED"
                      ? "bg-accent-green/10 text-accent-green"
                      : v.status === "REJECTED"
                        ? "bg-accent-red/10 text-accent-red"
                        : "bg-accent-yellow/10 text-accent-yellow"
                  }`}
                >
                  {v.status}
                </span>
                {v.status === "APPROVED" && (
                  <button
                    type="button"
                    disabled={revokingVersionId !== null}
                    onClick={() => void handleRevoke(v.id)}
                    title="승인 결정을 취소하고 재심사 대기로 되돌립니다."
                    className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] font-bold text-text-muted hover:border-accent-red hover:text-accent-red disabled:opacity-50"
                  >
                    {revokingVersionId === v.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3 w-3" />
                    )}
                    철회
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {detail.auditLog.length > 0 && (
        <div className="border-t border-border pt-4">
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-black uppercase tracking-wide text-text-primary">
            <History className="h-3.5 w-3.5" /> 조치 이력
          </h4>
          <div className="flex flex-col divide-y divide-border/60">
            {detail.auditLog.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between py-2 text-xs">
                <span className="text-text-primary">
                  {entry.action}
                  {entry.reason && <span className="ml-2 text-text-muted">— {entry.reason}</span>}
                </span>
                <span className="text-[10px] text-text-muted">
                  {entry.createdAt.split("T")[0]} · admin #{entry.actorAdminId}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SupportUploadLabel({
  label,
  accept,
  busy,
  disabled,
  icon,
  onFile,
}: {
  label: string;
  accept: string;
  busy: boolean;
  disabled: boolean;
  icon: ReactNode;
  onFile: (file: File) => void;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-border bg-surface-raised px-3 py-2 text-xs font-bold text-text-primary hover:border-brand">
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

function LabeledField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[11px] font-bold text-text-muted">{label}</label>
      {children}
    </div>
  );
}

function PageMessage({ children, small }: { children: ReactNode; small?: boolean }) {
  return (
    <div
      className={
        small
          ? "px-4 py-6 text-center text-xs text-text-muted"
          : "mx-auto max-w-xl px-4 py-24 text-center"
      }
    >
      {children}
    </div>
  );
}
