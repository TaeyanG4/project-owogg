import { useEffect, useState } from "react";
import {
  FileArchive,
  FileJson,
  Gamepad2,
  Image,
  Loader2,
  Pencil,
  Power,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import type { AdminGameListResponse, GameAvailabilityDto } from "@owogg/contracts";
import {
  deleteOfficialGame,
  fetchAdminGames,
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
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<AdminGamePageSize>(10);

  const loadGames = async (targetPage: number, targetPageSize: AdminGamePageSize) => {
    setError(null);
    try {
      const result = await fetchAdminGames(targetPage, targetPageSize);
      if (targetPage > result.totalPages) {
        setPage(result.totalPages);
        return;
      }
      setData(result);
      setAccessDenied(false);
    } catch (err) {
      if (err instanceof ApiClientError && (err.status === 401 || err.status === 403)) {
        setAccessDenied(true);
        return;
      }
      setError(err instanceof Error ? err.message : "공개 게임 목록을 불러올 수 없습니다.");
    }
  };

  useEffect(() => {
    void loadGames(page, pageSize);
  }, [page, pageSize]);

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
      `"${title}" 공식 게임을 B2와 DB에서 완전히 삭제합니다. 기존 리더보드와 즐겨찾기도 제거되며 되돌릴 수 없습니다. 계속하려면 slug "${gameId}"를 입력하세요.`,
    );
    if (confirmation !== gameId) return;

    setBusyGameId(gameId);
    setError(null);
    setUploadMessage(null);
    try {
      const result = await deleteOfficialGame(gameId);
      setUploadMessage(
        `${result.slug} 공식 게임과 ${result.deletedVersionCount}개 버전을 완전히 삭제했습니다. 같은 slug로 다시 등록할 수 있습니다.`,
      );
      await loadGames(page, pageSize);
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

  const editingGame = editingSlug
    ? data?.games.find((game) => game.gameId === editingSlug)
    : undefined;

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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-black text-text-primary">전체 공개 게임 안전 제어</h3>
            <p className="mt-1 text-xs text-text-muted">
              비활성화하면 카탈로그와 랭킹에서 즉시 숨겨지고 새 점수 제출도 거부됩니다.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadGames(page, pageSize)}
            className="rounded-xl border border-border bg-surface-raised px-3 py-2 text-xs font-bold text-text-primary hover:border-brand"
          >
            새로고침
          </button>
        </div>

        {!data ? (
          <p className="py-6 text-center text-xs text-text-muted">게임 목록을 불러오는 중...</p>
        ) : data.games.length === 0 ? (
          <p className="py-6 text-center text-xs text-text-muted">등록된 공개 게임이 없습니다.</p>
        ) : (
          <div className="mt-3 flex flex-col divide-y divide-border rounded-2xl border border-border bg-surface-raised">
            {data.games.map((game) => {
              const busy = busyGameId === game.gameId;
              return (
                <div
                  key={game.gameId}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center"
                >
                  <div className="flex flex-1 items-center gap-3">
                    <Gamepad2 className="h-4 w-4 shrink-0 text-brand-light" />
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-text-primary">{game.title}</span>
                        <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-bold text-text-muted">
                          {game.gameId}
                        </span>
                        <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-bold text-text-muted">
                          {game.publisherType === "OWOGG" ? "공식" : "사용자"}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            game.enabled
                              ? "bg-accent-green/10 text-accent-green"
                              : "bg-accent-red/10 text-accent-red"
                          }`}
                        >
                          {game.enabled ? "활성" : "비활성"}
                        </span>
                      </div>
                      {!game.enabled && game.disabledReason && (
                        <p className="mt-1 text-[11px] text-text-muted">
                          사유: {game.disabledReason}
                        </p>
                      )}
                      <p className="mt-1 text-[11px] text-text-muted">
                        서버 업로드 (KST) {formatServerUploadDate(game.latestUploadedAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {game.publisherType === "OWOGG" && (
                      <>
                        <PartUploadLabel
                          busy={partBusy === `${game.gameId}:bundle`}
                          icon={<FileArchive className="h-3.5 w-3.5" />}
                          label="전체 ZIP"
                          accept=".zip"
                          disabled={partBusy !== null}
                          onFile={(file) => void handlePartUpload(game.gameId, "bundle", file)}
                        />
                        <PartUploadLabel
                          busy={partBusy === `${game.gameId}:manifest`}
                          icon={<FileJson className="h-3.5 w-3.5" />}
                          label="owogg.json"
                          accept=".json,application/json"
                          disabled={partBusy !== null}
                          onFile={(file) => void handlePartUpload(game.gameId, "manifest", file)}
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
                          className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-bold text-text-primary hover:border-brand"
                        >
                          <Pencil className="h-3.5 w-3.5" /> 속성
                        </button>
                      </>
                    )}
                    {game.enabled && (
                      <input
                        type="text"
                        placeholder="비활성화 사유 (선택)"
                        value={reasons[game.gameId] ?? ""}
                        onChange={(event) =>
                          setReasons((previous) => ({
                            ...previous,
                            [game.gameId]: event.target.value,
                          }))
                        }
                        className="w-40 rounded-xl border border-border bg-surface px-3 py-2 text-xs text-text-primary outline-none focus:ring-2 focus:ring-brand sm:w-48"
                      />
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleToggle(game.gameId, !game.enabled)}
                      className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold disabled:opacity-50 ${
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
                      {game.enabled ? "비활성화" : "활성화"}
                    </button>
                    {game.publisherType === "OWOGG" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleOfficialDelete(game.gameId, game.title)}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-accent-red/40 bg-accent-red/10 px-3 py-2 text-xs font-bold text-accent-red hover:bg-accent-red/20 disabled:opacity-50"
                      >
                        {busy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                        완전 삭제
                      </button>
                    )}
                  </div>
                </div>
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
        {editingSlug && editingGame && (
          <OfficialMetadataEditor
            key={editingSlug}
            game={editingGame}
            onSaved={async (message) => {
              setUploadMessage(message);
              setEditingSlug(null);
              await loadGames(page, pageSize);
            }}
            onError={setError}
          />
        )}
      </div>
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
