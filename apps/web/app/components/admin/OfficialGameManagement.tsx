import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  FileArchive,
  FileJson,
  FileText,
  FlaskConical,
  Gamepad2,
  Image,
  Loader2,
  Pencil,
  Power,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import type {
  AdminGameListResponse,
  AdminGameCatalogRole,
  GameAvailabilityDto,
  PlatformFeatureSettingsResponse,
} from "@owogg/contracts";
import {
  deleteOfficialGame,
  fetchAdminGames,
  fetchAdminPlatformFeatureSettings,
  patchAdminPlatformFeatureSettings,
  postAdminGameCatalogRole,
  postToggleAdminGame,
  uploadOfficialGame,
  replaceOfficialGameBundle,
  replaceOfficialGameManifest,
  replaceOfficialGameLogo,
  replaceOfficialGameDescription,
  patchOfficialGameBasicMetadata,
} from "../../features/adminApi";
import { useAuth } from "../../features/auth/AuthContext";
import { publishPlatformFeatureSettings } from "../../features/catalog/gameAvailability";
import { ApiClientError } from "../../lib/api";
import { GameBundleDropzone } from "../game/GameBundleDropzone";
import {
  AdminGamePagination,
  formatServerUploadDate,
  type AdminGamePageSize,
} from "./AdminGamePagination";
import { ManagedRelayProfileControl } from "./ManagedRelayProfileControl";
import {
  createOfficialGameUploadQueue,
  type OfficialGameBatchUploadResult,
} from "./officialGameUploadQueue";

export { uploadOfficialGameBatch } from "./officialGameUploadQueue";

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

export function adminGameCatalogBadge(game: GameAvailabilityDto): {
  readonly label: string;
  readonly className: string;
  readonly hint: string | null;
} {
  if (!game.enabled) {
    return {
      label: "안전 차단",
      className: "bg-accent-red/10 text-accent-red",
      hint: game.disabledReason ? `비활성화 사유: ${game.disabledReason}` : null,
    };
  }
  if (game.catalogState === "READY") {
    return game.catalogRole === "INTERNAL_TOOL"
      ? {
          label: "테스트 가능",
          className: "bg-accent-green/10 text-accent-green",
          hint: "실행 정보는 준비됐지만 공개 게임 catalog에서는 제외됩니다.",
        }
      : { label: "공개 중", className: "bg-accent-green/10 text-accent-green", hint: null };
  }
  if (game.catalogState === "PRIVATE") {
    return {
      label: "미공개",
      className: "bg-accent-yellow/10 text-accent-yellow",
      hint: "라이브 버전은 있지만 catalog 공개 상태가 아닙니다.",
    };
  }
  if (game.catalogState === "NO_LIVE_VERSION") {
    return {
      label: "라이브 버전 없음",
      className: "bg-surface-overlay text-text-secondary",
      hint: "삭제되지 않은 identity만 남아 있습니다. 새 규격 ZIP을 재등록하거나 삭제할 수 있습니다.",
    };
  }
  return {
    label: "실행 정보 확인 불가",
    className: "bg-accent-yellow/10 text-accent-yellow",
    hint: "공개 identity는 남아 있지만 현재 canonical 실행 정보를 확인할 수 없습니다.",
  };
}

/** `games.moderate` portion of the combined admin game workspace.
 *
 * Review permission remains independent, so this panel fails closed without hiding the review
 * tools from moderators who intentionally do not hold the official-publication permission.
 */
export function OfficialGameManagement() {
  const { user } = useAuth();
  const [data, setData] = useState<AdminGameListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busyGameId, setBusyGameId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [uploadResults, setUploadResults] = useState<readonly OfficialGameBatchUploadResult[]>([]);
  const [partBusy, setPartBusy] = useState<string | null>(null);
  const [expandedGameId, setExpandedGameId] = useState<string | null>(null);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<AdminGamePageSize>(10);
  const [catalogRole, setCatalogRole] = useState<AdminGameCatalogRole>("GAME");
  const [listLoading, setListLoading] = useState(false);
  const [platformSettings, setPlatformSettings] = useState<PlatformFeatureSettingsResponse | null>(
    null,
  );
  const [platformSettingsBusy, setPlatformSettingsBusy] = useState<
    keyof PlatformFeatureSettingsResponse | null
  >(null);
  const [platformSettingsError, setPlatformSettingsError] = useState<string | null>(null);
  const listRequestIdRef = useRef(0);
  const deletedGameIdsRef = useRef<Set<string>>(new Set());
  const uploadListContextRef = useRef({ page, pageSize, catalogRole });
  uploadListContextRef.current = { page, pageSize, catalogRole };

  const loadGames = useCallback(
    async (
      targetPage: number,
      targetPageSize: AdminGamePageSize,
      targetCatalogRole: AdminGameCatalogRole,
    ) => {
      const requestId = ++listRequestIdRef.current;
      setListLoading(true);
      setError(null);
      try {
        const fetched = await fetchAdminGames(targetPage, targetPageSize, targetCatalogRole);
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
        setError(err instanceof Error ? err.message : "공식 identity 목록을 불러올 수 없습니다.");
      } finally {
        if (requestId === listRequestIdRef.current) setListLoading(false);
      }
    },
    [],
  );

  const officialUploadQueue = useMemo(
    () =>
      createOfficialGameUploadQueue<File>({
        publish: uploadOfficialGame,
        onProgress: setUploadResults,
        onRunningChange: setUploading,
        onIdle: (results) => {
          const succeeded = results.filter((result) => result.status === "SUCCESS");
          const failed = results.filter((result) => result.status === "FAILED");
          succeeded.forEach((result) => {
            if (result.slug) deletedGameIdsRef.current.delete(result.slug);
          });
          setUploadMessage(
            failed.length === 0
              ? `${succeeded.length}개 게임을 모두 게시했습니다.`
              : `${succeeded.length}개 게시 완료 · ${failed.length}개 실패 — 파일별 결과를 확인해 주세요.`,
          );
          if (succeeded.length > 0) {
            const context = uploadListContextRef.current;
            void loadGames(context.page, context.pageSize, context.catalogRole);
          }
        },
      }),
    [loadGames],
  );

  useEffect(() => {
    void loadGames(page, pageSize, catalogRole);
  }, [catalogRole, loadGames, page, pageSize]);

  useEffect(() => {
    let active = true;
    void fetchAdminPlatformFeatureSettings()
      .then((settings) => {
        if (active) setPlatformSettings(settings);
      })
      .catch((err) => {
        if (active) {
          setPlatformSettingsError(
            err instanceof Error ? err.message : "플랫폼 운영 설정을 불러오지 못했습니다.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const handlePlatformSetting = async (
    key: keyof PlatformFeatureSettingsResponse,
    enabled: boolean,
  ) => {
    setPlatformSettingsBusy(key);
    setPlatformSettingsError(null);
    try {
      const updated = await patchAdminPlatformFeatureSettings({ [key]: enabled });
      setPlatformSettings(updated);
      publishPlatformFeatureSettings(updated);
    } catch (err) {
      setPlatformSettingsError(
        err instanceof Error ? err.message : "플랫폼 운영 설정을 변경하지 못했습니다.",
      );
    } finally {
      setPlatformSettingsBusy(null);
    }
  };

  const handleToggle = async (gameId: string, nextEnabled: boolean) => {
    const reason = nextEnabled ? null : (reasons[gameId]?.trim() ?? "") || null;
    setBusyGameId(gameId);
    setError(null);
    try {
      await postToggleAdminGame(gameId, nextEnabled, reason);
      await loadGames(page, pageSize, catalogRole);
    } catch (err) {
      setError(err instanceof Error ? err.message : "게임 상태를 변경하지 못했습니다.");
    } finally {
      setBusyGameId(null);
    }
  };

  const handleOfficialUploads = (files: readonly File[]) => {
    if (files.length === 0) return;
    const wasRunning = officialUploadQueue.isRunning();
    setError(null);
    officialUploadQueue.enqueue(files);
    setUploadMessage(
      wasRunning
        ? `${files.length}개 ZIP을 현재 게시 큐 뒤에 추가했습니다.`
        : `${files.length}개 ZIP 게시를 시작합니다. 요청 제한 시 자동으로 기다렸다가 계속합니다.`,
    );
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
      else await loadGames(nextPage, pageSize, catalogRole);
    } catch (err) {
      setError(err instanceof Error ? err.message : "공식 게임을 완전히 삭제하지 못했습니다.");
    } finally {
      setBusyGameId(null);
    }
  };

  const handlePartUpload = async (
    gameId: string,
    kind: "bundle" | "manifest" | "logo" | "description",
    file: File,
  ) => {
    setPartBusy(`${gameId}:${kind}`);
    setError(null);
    try {
      if (kind === "bundle") await replaceOfficialGameBundle(gameId, file);
      if (kind === "manifest") await replaceOfficialGameManifest(gameId, file);
      if (kind === "logo") await replaceOfficialGameLogo(gameId, file);
      if (kind === "description") await replaceOfficialGameDescription(gameId, file);
      setUploadMessage(
        kind === "logo"
          ? `${gameId} 로고를 교체했습니다.`
          : `${gameId} ${kind === "bundle" ? "전체 ZIP" : kind === "manifest" ? "owogg.json" : "설명 파일"}을 새 공식 버전으로 게시했습니다.`,
      );
      await loadGames(page, pageSize, catalogRole);
    } catch (err) {
      setError(err instanceof Error ? err.message : "게임 파일을 재업로드하지 못했습니다.");
    } finally {
      setPartBusy(null);
    }
  };

  const handleCatalogRole = async (game: GameAvailabilityDto) => {
    const nextRole: AdminGameCatalogRole = game.catalogRole === "GAME" ? "INTERNAL_TOOL" : "GAME";
    const confirmed = window.confirm(
      nextRole === "INTERNAL_TOOL"
        ? `${game.title}을 공개 게임 목록에서 제외하고 내부 테스트 도구로 이동할까요?`
        : `${game.title}을 내부 도구에서 일반 게임 관리 목록으로 되돌릴까요?`,
    );
    if (!confirmed) return;

    setBusyGameId(game.gameId);
    setError(null);
    try {
      await postAdminGameCatalogRole(game.gameId, nextRole);
      setExpandedGameId(null);
      await loadGames(page, pageSize, catalogRole);
    } catch (err) {
      setError(err instanceof Error ? err.message : "게임 표시 분류를 변경하지 못했습니다.");
    } finally {
      setBusyGameId(null);
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
      <div className="rounded-2xl border border-border bg-surface-raised p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand-light">
            <Settings2 className="h-[18px] w-[18px]" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-black text-text-primary">플랫폼 운영 설정</h2>
            <p className="mt-1 text-xs leading-relaxed text-text-muted">
              배포 없이 즉시 적용되는 운영 스위치입니다. 전체 멀티플레이는 OWOGG 게임에만 적용되고,
              타 플랫폼 게임은 별도의 메뉴 노출만 제어합니다.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-2 lg:grid-cols-2">
          <PlatformSettingToggle
            icon={<Power className="h-4 w-4" aria-hidden="true" />}
            title="전체 멀티플레이 서버"
            description="신규 대기실·매칭·게임방 진입을 한 번에 차단합니다. 이미 열린 연결은 자연 종료되며, 배포 환경 스위치가 꺼져 있으면 여기서 켜도 실행되지 않습니다."
            enabled={platformSettings?.multiplayerEnabled ?? false}
            loading={platformSettings === null}
            busy={platformSettingsBusy === "multiplayerEnabled"}
            onChange={(enabled) => void handlePlatformSetting("multiplayerEnabled", enabled)}
          />
          <PlatformSettingToggle
            icon={<Gamepad2 className="h-4 w-4" aria-hidden="true" />}
            title="타 플랫폼 게임 메뉴"
            description="준비 중인 외부 플랫폼 게임 링크만 표시하거나 숨깁니다. OWOGG 멀티플레이 서버에는 영향을 주지 않습니다."
            enabled={platformSettings?.externalPlatformGamesVisible ?? false}
            loading={platformSettings === null}
            busy={platformSettingsBusy === "externalPlatformGamesVisible"}
            onChange={(enabled) =>
              void handlePlatformSetting("externalPlatformGamesVisible", enabled)
            }
          />
        </div>
        {platformSettingsError && (
          <p className="mt-3 text-xs font-semibold text-accent-red" role="alert">
            {platformSettingsError}
          </p>
        )}
      </div>

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
        title="owogg.json이 포함된 ZIP 하나 또는 여러 개를 끌어다 놓으면 slug별로 등록·업데이트됩니다"
        actionLabel="또는 ZIP 여러 개 선택"
        multiple
        acceptWhileBusy
        onFile={(file) => handleOfficialUploads([file])}
        onFiles={handleOfficialUploads}
      />

      {uploadMessage && (
        <p className="rounded-xl border border-accent-green/30 bg-accent-green/10 px-3 py-2 text-xs font-semibold text-accent-green">
          {uploadMessage}
        </p>
      )}
      {uploadResults.length > 0 && (
        <ul
          className="grid gap-2 rounded-xl border border-border bg-surface p-3"
          aria-live="polite"
        >
          {uploadResults.map((result) => (
            <li key={result.id} className="flex min-w-0 items-start gap-2 text-xs">
              {result.status === "PENDING" || result.status === "UPLOADING" ? (
                <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-brand" />
              ) : result.status === "RETRY_WAIT" ? (
                <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-yellow" />
              ) : result.status === "SUCCESS" ? (
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-green" />
              ) : (
                <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-red" />
              )}
              <span className="min-w-0">
                <strong className="break-all text-text-primary">{result.fileName}</strong>
                <span
                  className={`ml-2 ${
                    result.status === "FAILED"
                      ? "text-accent-red"
                      : result.status === "RETRY_WAIT"
                        ? "text-accent-yellow"
                        : "text-text-muted"
                  }`}
                >
                  {result.message}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="rounded-xl border border-accent-red/30 bg-accent-red/10 px-3 py-2 text-xs text-accent-red">
          {error}
        </p>
      )}

      <div className="border-t border-border pt-4">
        <div className="mb-4 inline-flex rounded-xl border border-border bg-surface p-1">
          <button
            type="button"
            aria-pressed={catalogRole === "GAME"}
            onClick={() => {
              listRequestIdRef.current += 1;
              setCatalogRole("GAME");
              setPage(1);
              setData(null);
              setExpandedGameId(null);
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold ${
              catalogRole === "GAME"
                ? "bg-brand text-white"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            <Gamepad2 className="h-3.5 w-3.5" /> 게임
          </button>
          <button
            type="button"
            aria-pressed={catalogRole === "INTERNAL_TOOL"}
            onClick={() => {
              listRequestIdRef.current += 1;
              setCatalogRole("INTERNAL_TOOL");
              setPage(1);
              setData(null);
              setExpandedGameId(null);
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold ${
              catalogRole === "INTERNAL_TOOL"
                ? "bg-brand text-white"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            <FlaskConical className="h-3.5 w-3.5" /> 내부 테스트 도구
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-black text-text-primary">
              {catalogRole === "GAME"
                ? "전체 공식 게임 identity 및 서비스 상태"
                : "내부 테스트 도구"}
            </h3>
            <p className="mt-1 text-xs text-text-muted">
              {catalogRole === "GAME"
                ? "실제 삭제된 identity는 표시하지 않습니다. 미공개·라이브 버전 없음·실행 정보 오류 상태는 재등록 또는 삭제를 위해 남겨 두며, 안전 차단은 catalog 준비 상태와 별도로 표시합니다."
                : "관리자가 명시적으로 분리한 Relay·SDK 검증 도구입니다. 공개 카탈로그에는 노출되지 않으며 여기서 일반 대기실과 Relay 실행을 점검합니다."}
            </p>
          </div>
          <button
            type="button"
            disabled={listLoading}
            onClick={() => void loadGames(page, pageSize, catalogRole)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface-raised px-3 py-2 text-xs font-bold text-text-primary transition-colors hover:border-brand hover:bg-surface-overlay disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${listLoading ? "animate-spin" : ""}`} />
            {listLoading ? "확인 중" : "새로고침"}
          </button>
        </div>

        {!data ? (
          <p className="py-6 text-center text-xs text-text-muted">게임 목록을 불러오는 중...</p>
        ) : data.games.length === 0 ? (
          <p className="py-6 text-center text-xs text-text-muted">
            {catalogRole === "GAME"
              ? "관리할 공식 게임 identity가 없습니다."
              : "분리된 내부 테스트 도구가 없습니다. 게임 관리에서 도구로 이동할 수 있습니다."}
          </p>
        ) : (
          <div className="mt-4 grid gap-3">
            {data.games.map((game) => {
              const busy = busyGameId === game.gameId;
              const expanded = expandedGameId === game.gameId;
              const catalogBadge = adminGameCatalogBadge(game);
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
                        {game.catalogRole === "INTERNAL_TOOL" ? (
                          <FlaskConical className="h-5 w-5" />
                        ) : (
                          <Gamepad2 className="h-5 w-5" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="min-w-0 truncate text-sm font-black text-text-primary sm:text-base">
                            {game.title}
                          </h4>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-black ${catalogBadge.className}`}
                          >
                            {catalogBadge.label}
                          </span>
                          {game.catalogRole === "INTERNAL_TOOL" && (
                            <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-bold text-brand-light">
                              카탈로그 제외
                            </span>
                          )}
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
                        {catalogBadge.hint && (
                          <p
                            className={`mt-1.5 text-[11px] ${
                              game.enabled ? "text-text-muted" : "text-accent-red"
                            }`}
                          >
                            {catalogBadge.hint}
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
                                busy={partBusy === `${game.gameId}:description`}
                                icon={<FileText className="h-3.5 w-3.5" />}
                                label="게임 설명"
                                accept=".md,.zip,text/markdown,application/zip"
                                disabled={partBusy !== null}
                                onFile={(file) =>
                                  void handlePartUpload(game.gameId, "description", file)
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

                      <section className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <h5 className="text-xs font-black text-text-primary">UI 분류</h5>
                          <p className="mt-1 text-[11px] text-text-muted">
                            {game.catalogRole === "GAME"
                              ? "일반 게임으로 공개 catalog 후보에 포함됩니다. 테스트 fixture라면 내부 도구로 분리하세요."
                              : "공개 catalog에서 제외된 서버 소유 테스트 도구입니다. ZIP은 이 분류를 직접 선언할 수 없습니다."}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleCatalogRole(game)}
                          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl border border-brand/30 bg-brand/10 px-3 py-2 text-xs font-bold text-brand-light transition-colors hover:bg-brand/20 disabled:opacity-50"
                        >
                          {busy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : game.catalogRole === "GAME" ? (
                            <FlaskConical className="h-3.5 w-3.5" />
                          ) : (
                            <Gamepad2 className="h-3.5 w-3.5" />
                          )}
                          {game.catalogRole === "GAME"
                            ? "내부 테스트 도구로 이동"
                            : "일반 게임으로 되돌리기"}
                        </button>
                      </section>

                      {game.mode === "multi" && (
                        <ManagedRelayProfileControl
                          gameSlug={game.gameId}
                          title={game.title}
                          viewer={
                            user
                              ? {
                                  userId: user.id,
                                  nickname: user.nickname,
                                  avatarUrl: user.avatar_url,
                                }
                              : null
                          }
                          showTester={game.catalogRole === "INTERNAL_TOOL"}
                        />
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
                            await loadGames(page, pageSize, catalogRole);
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

function PlatformSettingToggle({
  icon,
  title,
  description,
  enabled,
  loading,
  busy,
  onChange,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  enabled: boolean;
  loading: boolean;
  busy: boolean;
  onChange: (enabled: boolean) => void;
}) {
  const disabled = loading || busy;
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-border/80 bg-surface px-3.5 py-3">
      <span
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl ${
          enabled ? "bg-accent-green/10 text-accent-green" : "bg-surface-overlay text-text-muted"
        }`}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-extrabold text-text-primary">{title}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-text-muted">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={`${title} ${enabled ? "끄기" : "켜기"}`}
        disabled={disabled}
        onClick={() => onChange(!enabled)}
        className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:cursor-wait disabled:opacity-60 ${
          enabled ? "border-accent-green/50 bg-accent-green/25" : "border-border bg-surface-overlay"
        }`}
      >
        <span
          className={`absolute top-1 h-[18px] w-[18px] rounded-full shadow-sm transition-all ${
            enabled ? "left-6 bg-accent-green" : "left-1 bg-text-muted"
          }`}
        />
        {busy && (
          <Loader2 className="absolute inset-0 m-auto h-3.5 w-3.5 animate-spin text-text-primary" />
        )}
      </button>
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
  const [genre, setGenre] = useState(game.genre ?? "");
  const [mode, setMode] = useState<"single" | "multi">(game.mode ?? "single");
  const [tags, setTags] = useState(game.tags.join(", "));
  const [defaultScreenMode, setDefaultScreenMode] = useState<"default" | "theater">(
    game.defaultScreenMode,
  );
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
        <AdminField label="기본 게임 화면">
          <select
            value={defaultScreenMode}
            onChange={(e) => setDefaultScreenMode(e.target.value as "default" | "theater")}
          >
            <option value="default">기본 모드</option>
            <option value="theater">영화관 모드</option>
          </select>
        </AdminField>
      </div>
      <AdminField label="태그 (쉼표로 구분, 최대 20개)">
        <input value={tags} onChange={(e) => setTags(e.target.value)} />
      </AdminField>
      <p className="text-[11px] leading-relaxed text-text-muted">
        상세 설명은 위의 게임 설명 버튼에서 description.md 또는 설명 ZIP으로 관리합니다.
      </p>
      <button
        type="button"
        disabled={busy || !title.trim() || !genre.trim()}
        onClick={async () => {
          setBusy(true);
          try {
            const result = await patchOfficialGameBasicMetadata(game.gameId, {
              title: title.trim(),
              shortDescription: shortDescription.trim() || null,
              genre: genre.trim(),
              mode,
              tags: tags
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean),
              defaultScreenMode,
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
