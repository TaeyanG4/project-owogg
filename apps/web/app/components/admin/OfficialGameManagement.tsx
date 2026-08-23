import { useEffect, useState } from "react";
import { Gamepad2, Loader2, Power, ShieldCheck } from "lucide-react";
import type { AdminGameListResponse } from "@owogg/contracts";
import { fetchAdminGames, postToggleAdminGame, uploadOfficialGame } from "../../features/adminApi";
import { ApiClientError } from "../../lib/api";
import { GameBundleDropzone } from "../game/GameBundleDropzone";

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

  const loadGames = async () => {
    setError(null);
    try {
      setData(await fetchAdminGames());
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
    void loadGames();
  }, []);

  const handleToggle = async (gameId: string, nextEnabled: boolean) => {
    const reason = nextEnabled ? null : (reasons[gameId]?.trim() ?? "") || null;
    setBusyGameId(gameId);
    setError(null);
    try {
      await postToggleAdminGame(gameId, nextEnabled, reason);
      await loadGames();
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
      await loadGames();
    } catch (err) {
      setError(err instanceof Error ? err.message : "공식 게임을 게시하지 못했습니다.");
    } finally {
      setUploading(false);
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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-black text-text-primary">전체 공개 게임 안전 제어</h3>
            <p className="mt-1 text-xs text-text-muted">
              비활성화하면 카탈로그와 랭킹에서 즉시 숨겨지고 새 점수 제출도 거부됩니다.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadGames()}
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
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
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
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
