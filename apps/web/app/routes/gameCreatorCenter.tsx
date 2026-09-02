import { useState, useEffect, useCallback } from "react";
import { Link, useSearchParams } from "react-router";
import {
  ArrowLeft,
  Loader2,
  Gamepad2,
  Trash2,
  Upload,
  XCircle,
  Send,
  Clock3,
  ShieldAlert,
  FileJson,
  FileText,
  Image,
  Pencil,
  Eye,
  MonitorPlay,
} from "lucide-react";
import { useAuth } from "../features/auth";
import {
  fetchDevMe,
  fetchMyGames,
  fetchMyGameDrafts,
  uploadDevGameVersion,
  uploadGameFromBundle,
  withdrawDevGameSubmission,
  deleteDevGame,
  applyForGameCreator,
  withdrawGameCreatorApplication,
  countActiveSubmissions,
  replaceDevGameManifest,
  replaceDevGameLogo,
  replaceDevGameDescription,
  patchDevGameBasicMetadata,
} from "../features/devApi";
import type {
  GameCreatorMeResponse,
  SandboxGameRecord,
  SandboxGameVersionRecord,
} from "@owogg/contracts";
import { GameBundleDropzone } from "../components/game/GameBundleDropzone";
import { ExternalGameCreatorPanel } from "../components/externalGames/ExternalGameCreatorPanel";

export function meta() {
  return [
    { title: "게임 크리에이터 센터 | OwOGG" },
    { name: "description", content: "샌드박스 게임 신청, 업로드, 버전 관리" },
  ];
}

type LoadState = "loading" | "success" | "error";

/** /game-creator — the Game Creator program's own page: self-serve application (if not yet
 * approved) or the full upload/manage tools (once approved). Moved out of /settings so it has
 * room to be a real page rather than a buried card — see docs/AUTHORIZATION.md's Game Creator
 * program section. GAME_CREATOR is a Program/Entitlement, never a Staff Role. */
export default function GameCreatorCenterRoute() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTool = searchParams.get("tool") === "external" ? "EXTERNAL" : "OWOGG";
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [devMe, setDevMe] = useState<GameCreatorMeResponse | null>(null);
  const [myGames, setMyGames] = useState<SandboxGameRecord[] | null>(null);
  const [drafts, setDrafts] = useState<SandboxGameVersionRecord[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const me = await fetchDevMe();
      setDevMe(me);
      if (me.hasAccess) {
        const [games, draftVersions] = await Promise.all([fetchMyGames(), fetchMyGameDrafts()]);
        setMyGames(games.games);
        setDrafts(draftVersions.drafts);
      }
      setState("success");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "정보를 불러올 수 없습니다.");
      setState("error");
    }
  }, []);

  useEffect(() => {
    if (!authLoading && isAuthenticated) void load();
  }, [authLoading, isAuthenticated, load]);

  if (authLoading || (isAuthenticated && state === "loading")) {
    return <PageMessage>불러오는 중...</PageMessage>;
  }

  if (!isAuthenticated) {
    return (
      <PageMessage>
        게임 크리에이터 센터를 사용하려면 <Link to="/profile">OwOGG 로그인</Link>이 필요합니다.
      </PageMessage>
    );
  }

  if (state === "error" || !devMe) {
    return (
      <PageMessage>
        <ShieldAlert className="mx-auto mb-4 h-10 w-10 text-text-muted" />
        <p className="text-sm text-text-muted">{error || "정보를 불러올 수 없습니다."}</p>
        <button
          onClick={() => void load()}
          className="mt-6 inline-flex items-center rounded-xl bg-brand px-4 py-2.5 text-xs font-bold text-white hover:bg-brand-light"
        >
          다시 시도
        </button>
      </PageMessage>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8 md:px-8">
      <Link
        to="/settings"
        className="inline-flex items-center gap-1.5 text-xs font-bold text-text-muted hover:text-text-primary"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> 설정으로
      </Link>

      <header>
        <div className="mb-2 flex items-center gap-2 text-brand">
          <Gamepad2 className="h-5 w-5" />
          <span className="text-xs font-bold uppercase tracking-[0.2em]">Game Creator</span>
        </div>
        <h1 className="text-2xl font-black text-text-primary">게임 크리에이터 센터</h1>
        <p className="mt-1 text-xs text-text-muted">
          직접 만든 OwOGG 게임을 관리하거나 다른 플랫폼의 좋은 게임을 소개하고 심사를 요청합니다.
        </p>
      </header>

      {error && (
        <p className="rounded-xl border border-accent-red/30 bg-accent-red/10 px-3 py-2 text-[11px] font-semibold text-accent-red">
          {error}
        </p>
      )}

      <div
        role="tablist"
        aria-label="게임 크리에이터 도구"
        className="grid gap-2 rounded-2xl border border-border bg-surface-raised p-2 sm:grid-cols-2"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTool === "OWOGG"}
          onClick={() => setSearchParams({})}
          className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-black ${activeTool === "OWOGG" ? "bg-brand text-white" : "text-text-muted hover:bg-surface-overlay hover:text-text-primary"}`}
        >
          <Gamepad2 className="h-4 w-4" /> OwOGG 게임 업로드
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTool === "EXTERNAL"}
          onClick={() => setSearchParams({ tool: "external" })}
          className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-black ${activeTool === "EXTERNAL" ? "bg-cyan-500 text-slate-950" : "text-text-muted hover:bg-surface-overlay hover:text-text-primary"}`}
        >
          <MonitorPlay className="h-4 w-4" /> 타 플랫폼 게임 소개
        </button>
      </div>

      {activeTool === "EXTERNAL" ? (
        <ExternalGameCreatorPanel />
      ) : devMe.hasAccess ? (
        <ManageGamesPanel
          myGames={myGames}
          drafts={drafts}
          onChanged={() => void load()}
          onError={setError}
        />
      ) : (
        <ApplicationPanel devMe={devMe} onChanged={() => void load()} onError={setError} />
      )}
    </div>
  );
}

function ApplicationPanel({
  devMe,
  onChanged,
  onError,
}: {
  devMe: GameCreatorMeResponse;
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const application = devMe.latestApplication;

  if (application?.status === "PENDING") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-3xl border border-border bg-surface-raised p-8 text-center shadow-xl">
        <Clock3 className="h-8 w-8 text-accent-yellow" />
        <h2 className="text-lg font-bold text-text-primary">신청 심사 대기 중</h2>
        <p className="max-w-md text-xs text-text-muted">
          {application.createdAt.split("T")[0]}에 제출한 게임 크리에이터 신청이 아직 심사 대기
          중입니다. 승인되면 이 페이지에서 바로 게임을 등록할 수 있습니다.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await withdrawGameCreatorApplication(application.id);
              onChanged();
            } catch (err) {
              onError(err instanceof Error ? err.message : "철회에 실패했습니다.");
            } finally {
              setBusy(false);
            }
          }}
          className="mt-2 inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-bold text-text-muted hover:border-accent-red hover:text-accent-red disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <XCircle className="h-3.5 w-3.5" />
          )}
          신청 철회
        </button>
      </div>
    );
  }

  if (!devMe.canApply) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-3xl border border-border bg-surface-raised p-8 text-center shadow-xl">
        <Clock3 className="h-8 w-8 text-text-muted" />
        <h2 className="text-lg font-bold text-text-primary">
          게임 크리에이터 센터 — 추후 업데이트 예정
        </h2>
        <p className="max-w-md text-xs text-text-muted">
          게임 크리에이터 셀프서비스 신청은 현재 준비 중이라 잠시 닫혀 있습니다. 정식 운영이
          시작되면 이 페이지에서 바로 신청할 수 있도록 안내해드리겠습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-3xl border border-border bg-surface-raised p-6 shadow-xl md:p-8">
      <div>
        <h2 className="text-lg font-bold text-text-primary">게임 크리에이터 신청</h2>
        <p className="mt-1 text-xs text-text-muted">
          {application?.status === "REJECTED" && (
            <>
              지난 신청이 거절되었습니다
              {application.rejectReason ? ` (사유: ${application.rejectReason})` : ""}. 다시 신청할
              수 있습니다.
              <br />
            </>
          )}
          간단한 소개를 남기면 심사에 도움이 됩니다 (선택 사항).
        </p>
      </div>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="예: 인디 퍼즐 게임을 만들고 있습니다. 포트폴리오: ..."
        maxLength={1000}
        rows={4}
        className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-brand"
      />
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await applyForGameCreator(message.trim() || null);
            onChanged();
          } catch (err) {
            onError(err instanceof Error ? err.message : "신청에 실패했습니다.");
          } finally {
            setBusy(false);
          }
        }}
        className="inline-flex w-fit items-center gap-1.5 rounded-xl bg-brand px-4 py-2.5 text-xs font-bold text-white hover:bg-brand-light disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        신청하기
      </button>
    </div>
  );
}

function isCreatorContentEditLocked(game: SandboxGameRecord): boolean {
  return (
    game.contentEditAvailableAt !== null && Date.parse(game.contentEditAvailableAt) > Date.now()
  );
}

function creatorContentEditUnlockLabel(game: SandboxGameRecord): string | null {
  if (!isCreatorContentEditLocked(game) || game.contentEditAvailableAt === null) return null;
  return new Date(game.contentEditAvailableAt).toLocaleString();
}

function ManageGamesPanel({
  myGames,
  drafts,
  onChanged,
  onError,
}: {
  myGames: SandboxGameRecord[] | null;
  drafts: SandboxGameVersionRecord[];
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const [uploadingGameId, setUploadingGameId] = useState<number | null>(null);
  const [withdrawingGameId, setWithdrawingGameId] = useState<number | null>(null);
  const [deletingGameId, setDeletingGameId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const [partBusy, setPartBusy] = useState<string | null>(null);
  const [editingGameId, setEditingGameId] = useState<number | null>(null);
  const latestDraftByGame = new Map<number, SandboxGameVersionRecord>();
  for (const draft of drafts) {
    if (!latestDraftByGame.has(draft.gameId)) latestDraftByGame.set(draft.gameId, draft);
  }

  // Drag-and-drop registration: a ZIP whose root contains a valid owogg.json v1 manifest.
  // creates the game *and* its first version in one call — see devApi.uploadGameFromBundle. This
  // is now the only registration path (2026-08-18 — the manual slug/title/genre form was removed).
  const handleDropRegister = async (file: File) => {
    if (registering) return;
    setRegistering(true);
    try {
      const { game } = await uploadGameFromBundle(file);
      setNotice(`"${game.title}" 초안이 저장되었습니다. 미리보기에서 확인 후 제출해주세요.`);
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "등록에 실패했습니다.");
    } finally {
      setRegistering(false);
    }
  };

  const handleUploadVersion = async (gameId: number, file: File) => {
    setUploadingGameId(gameId);
    try {
      await uploadDevGameVersion(gameId, file);
      setNotice("새 초안이 저장되었습니다. 미리보기에서 확인 후 제출해주세요.");
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "업로드에 실패했습니다.");
    } finally {
      setUploadingGameId(null);
    }
  };

  const handleReplaceManifest = async (gameId: number, file: File) => {
    setPartBusy(`${gameId}:manifest`);
    try {
      await replaceDevGameManifest(gameId, file);
      setNotice("owogg.json 교체본을 새 초안으로 만들었습니다. 미리보기에서 확인해주세요.");
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "owogg.json 재업로드에 실패했습니다.");
    } finally {
      setPartBusy(null);
    }
  };

  const handleReplaceLogo = async (gameId: number, file: File) => {
    setPartBusy(`${gameId}:logo`);
    try {
      await replaceDevGameLogo(gameId, file);
      setNotice("게임 로고를 교체했습니다.");
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "로고 재업로드에 실패했습니다.");
    } finally {
      setPartBusy(null);
    }
  };

  const handleReplaceDescription = async (gameId: number, file: File) => {
    setPartBusy(`${gameId}:description`);
    try {
      await replaceDevGameDescription(gameId, file);
      setNotice("게임 설명 교체본을 새 초안으로 만들었습니다. 미리보기에서 확인해주세요.");
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "게임 설명 업로드에 실패했습니다.");
    } finally {
      setPartBusy(null);
    }
  };

  // Frees the review slot this game is holding (see SANDBOX_GAME_POLICY.MAX_CONCURRENT_REVIEW_SLOTS)
  // by withdrawing its pending version — the slot becomes immediately available for a new submission.
  const handleWithdraw = async (gameId: number) => {
    if (withdrawingGameId !== null) return;
    if (!window.confirm("심사 중인 제출을 철회할까요? 철회하면 슬롯이 즉시 반환됩니다.")) return;
    setWithdrawingGameId(gameId);
    try {
      await withdrawDevGameSubmission(gameId);
      setNotice("제출을 철회했습니다. 심사 슬롯이 반환되었습니다.");
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "철회에 실패했습니다.");
    } finally {
      setWithdrawingGameId(null);
    }
  };

  // Game Creator self-service full removal — only offered for a game that has never been approved
  // (liveVersionId === null client-side proxy; the server enforces the real rule and returns
  // CANNOT_DELETE_APPROVED_GAME otherwise). Unlike admin's soft-delete, this is a genuine hard
  // delete, so the slug becomes reusable immediately.
  const handleDelete = async (gameId: number, title: string) => {
    if (deletingGameId !== null) return;
    if (!window.confirm(`"${title}" 게임을 완전히 삭제할까요? 되돌릴 수 없습니다.`)) return;
    setDeletingGameId(gameId);
    try {
      await deleteDevGame(gameId);
      setNotice(`"${title}" 게임을 삭제했습니다.`);
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "삭제에 실패했습니다.");
    } finally {
      setDeletingGameId(null);
    }
  };

  return (
    <div className="flex flex-col gap-5 rounded-3xl border border-border bg-surface-raised p-6 shadow-xl md:p-8">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
            countActiveSubmissions(myGames ?? []) >= 2
              ? "bg-accent-yellow/10 text-accent-yellow"
              : "bg-surface-overlay text-text-muted"
          }`}
        >
          심사 슬롯 {countActiveSubmissions(myGames ?? [])}/2 사용 중
        </span>
      </div>

      {notice && (
        <p className="rounded-xl border border-accent-green/30 bg-accent-green/10 px-3 py-2 text-[11px] font-semibold text-accent-green">
          {notice}
        </p>
      )}

      <GameBundleDropzone
        busy={registering}
        title="owogg.json이 포함된 ZIP을 여기로 끌어다 놓으면 자동 등록됩니다"
        onFile={handleDropRegister}
      />

      <div className="flex flex-col divide-y divide-border/60">
        {(myGames ?? []).length === 0 ? (
          <p className="py-3 text-center text-xs text-text-muted">아직 등록한 게임이 없습니다.</p>
        ) : (
          (myGames ?? []).map((g) => (
            <div key={g.id} className="flex items-center justify-between gap-3 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <Gamepad2 className="h-4 w-4 shrink-0 text-brand-light" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-text-primary">
                    {g.title} <span className="text-[10px] font-bold text-text-muted">#{g.id}</span>
                  </p>
                  <p className="flex flex-wrap items-center gap-1.5 text-[10px] text-text-muted">
                    <span
                      className={`rounded-full px-1.5 py-0.5 font-bold ${
                        g.visibility === "PUBLIC"
                          ? "bg-accent-green/10 text-accent-green"
                          : "bg-surface-overlay text-text-muted"
                      }`}
                    >
                      {g.visibility === "PUBLIC" ? "공개" : "비공개"}
                    </span>
                    <span>{g.liveVersionId ? "승인된 버전 있음" : "승인 전"}</span>
                    {g.reviewSlot !== null && (
                      <span className="rounded-full bg-accent-yellow/10 px-1.5 py-0.5 font-bold text-accent-yellow">
                        심사 대기 중 (슬롯 {g.reviewSlot})
                      </span>
                    )}
                    {latestDraftByGame.has(g.id) && (
                      <span className="rounded-full bg-brand/10 px-1.5 py-0.5 font-bold text-brand-light">
                        제출 전 초안
                      </span>
                    )}
                    {isCreatorContentEditLocked(g) && (
                      <span
                        className="rounded-full bg-brand/10 px-1.5 py-0.5 font-bold text-brand-light"
                        title={`설명·태그 수정 가능: ${creatorContentEditUnlockLabel(g)}`}
                      >
                        설명·태그 24시간 대기
                      </span>
                    )}
                    {/* A row can only ever reach this list with deletedAt set via the admin's
                        soft-delete — the Game Creator's own self-delete (deleteOwnGame) is a hard
                        delete that removes the row outright, so it never appears here at all.
                        No need to attribute "by admin" — there is no other case. */}
                    {g.deletedAt && (
                      <span
                        className="rounded-full bg-accent-red/10 px-1.5 py-0.5 font-bold text-accent-red"
                        title="삭제되었습니다. 기록은 감사 목적으로 남아 있으며, 같은 이름(슬러그)으로는 재등록할 수 없습니다."
                      >
                        삭제됨
                      </span>
                    )}
                  </p>
                </div>
              </div>
              {/* A game an admin has soft-deleted keeps its row (for audit) but is otherwise a
                  dead end for the Game Creator — no new version can attach to it, and self-delete only
                  ever applied to never-approved games anyway. Showing live-looking action buttons
                  here previously let a Game Creator "버전 업로드" or re-register the same slug and hit
                  an error with no explanation (2026-08-18). */}
              {!g.deletedAt && (
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  {latestDraftByGame.get(g.id) && (
                    <Link
                      to={`/game-creator/games/${g.id}/versions/${latestDraftByGame.get(g.id)?.id}/preview`}
                      className="flex items-center gap-1.5 rounded-xl bg-brand px-3 py-2 text-xs font-bold text-white hover:bg-brand-light"
                    >
                      <Eye className="h-3.5 w-3.5" /> 미리보기
                    </Link>
                  )}
                  {g.reviewSlot !== null && (
                    <button
                      type="button"
                      onClick={() => void handleWithdraw(g.id)}
                      disabled={withdrawingGameId !== null}
                      className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-xs font-bold text-text-muted hover:border-accent-red hover:text-accent-red disabled:opacity-50"
                    >
                      {withdrawingGameId === g.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5" />
                      )}
                      철회
                    </button>
                  )}
                  <label
                    title={
                      isCreatorContentEditLocked(g)
                        ? `설명 수정 가능: ${creatorContentEditUnlockLabel(g)}`
                        : undefined
                    }
                    className={`flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-xs font-bold text-text-primary ${
                      isCreatorContentEditLocked(g)
                        ? "cursor-not-allowed opacity-50"
                        : "cursor-pointer hover:border-brand"
                    }`}
                  >
                    {uploadingGameId === g.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Upload className="h-3.5 w-3.5" />
                    )}
                    전체 ZIP
                    <input
                      type="file"
                      accept=".zip"
                      className="hidden"
                      disabled={uploadingGameId !== null}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (file) void handleUploadVersion(g.id, file);
                      }}
                    />
                  </label>
                  <label className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-xs font-bold text-text-primary hover:border-brand">
                    {partBusy === `${g.id}:manifest` ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <FileJson className="h-3.5 w-3.5" />
                    )}
                    owogg.json
                    <input
                      type="file"
                      accept=".json,application/json"
                      className="hidden"
                      disabled={partBusy !== null}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (file) void handleReplaceManifest(g.id, file);
                      }}
                    />
                  </label>
                  <label className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-xs font-bold text-text-primary hover:border-brand">
                    {partBusy === `${g.id}:description` ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <FileText className="h-3.5 w-3.5" />
                    )}
                    게임 설명
                    <input
                      type="file"
                      accept=".md,.zip,text/markdown,application/zip"
                      className="hidden"
                      disabled={partBusy !== null || isCreatorContentEditLocked(g)}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (file) void handleReplaceDescription(g.id, file);
                      }}
                    />
                  </label>
                  <label className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-xs font-bold text-text-primary hover:border-brand">
                    {partBusy === `${g.id}:logo` ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Image className="h-3.5 w-3.5" />
                    )}
                    로고
                    <input
                      type="file"
                      accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml"
                      className="hidden"
                      disabled={partBusy !== null}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (file) void handleReplaceLogo(g.id, file);
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => setEditingGameId((current) => (current === g.id ? null : g.id))}
                    className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-xs font-bold text-text-primary hover:border-brand"
                  >
                    <Pencil className="h-3.5 w-3.5" /> 속성 편집
                  </button>
                  {g.liveVersionId === null && (
                    <button
                      type="button"
                      onClick={() => void handleDelete(g.id, g.title)}
                      disabled={deletingGameId !== null}
                      title="관리자 승인 전까지만 직접 삭제할 수 있습니다."
                      className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-xs font-bold text-text-muted hover:border-accent-red hover:text-accent-red disabled:opacity-50"
                    >
                      {deletingGameId === g.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                      삭제
                    </button>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {editingGameId !== null &&
        (() => {
          const game = (myGames ?? []).find((entry) => entry.id === editingGameId);
          return game ? (
            <CreatorGameMetadataEditor
              key={game.id}
              game={game}
              onSaved={() => {
                setNotice("수정한 속성으로 새 초안을 만들었습니다. 미리보기에서 확인해주세요.");
                setEditingGameId(null);
                onChanged();
              }}
              onError={onError}
            />
          ) : null;
        })()}
    </div>
  );
}

function CreatorGameMetadataEditor({
  game,
  onSaved,
  onError,
}: {
  game: SandboxGameRecord;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [title, setTitle] = useState(game.title);
  const [shortDescription, setShortDescription] = useState(game.shortDescription ?? "");
  const [genre, setGenre] = useState(game.genre);
  const [mode, setMode] = useState<"single" | "multi">(game.mode);
  const [tags, setTags] = useState(game.tags.join(", "));
  const [defaultScreenMode, setDefaultScreenMode] = useState<"default" | "theater">(
    game.defaultScreenMode,
  );
  const [busy, setBusy] = useState(false);
  const contentEditUnlockLabel = creatorContentEditUnlockLabel(game);

  return (
    <div className="space-y-4 rounded-2xl border border-brand/30 bg-surface p-4">
      <div>
        <h3 className="text-sm font-black text-text-primary">{game.title} 핵심 속성 편집</h3>
        <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
          slug는 게임 ID이므로 변경할 수 없습니다. 저장하면 원본 ZIP을 훼손하지 않고 수정된
          owogg.json을 포함한 새 버전이 생성되어 다시 심사됩니다.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="제목">
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} />
        </Field>
        <Field label="장르">
          <input value={genre} onChange={(e) => setGenre(e.target.value)} maxLength={40} />
        </Field>
        <Field label="모드">
          <select value={mode} onChange={(e) => setMode(e.target.value as "single" | "multi")}>
            <option value="single">single</option>
            <option value="multi">multi</option>
          </select>
        </Field>
        <Field label="짧은 설명">
          <input
            value={shortDescription}
            onChange={(e) => setShortDescription(e.target.value)}
            maxLength={200}
          />
        </Field>
        <Field label="기본 게임 화면">
          <select
            value={defaultScreenMode}
            onChange={(e) => setDefaultScreenMode(e.target.value as "default" | "theater")}
          >
            <option value="default">기본 모드</option>
            <option value="theater">영화관 모드</option>
          </select>
        </Field>
      </div>
      <Field label="태그 (쉼표로 구분, 최대 20개)">
        <input
          value={tags}
          disabled={contentEditUnlockLabel !== null}
          title={contentEditUnlockLabel ? `태그 수정 가능: ${contentEditUnlockLabel}` : undefined}
          onChange={(e) => setTags(e.target.value)}
        />
      </Field>
      <p className="text-[11px] leading-relaxed text-text-muted">
        상세 설명은 게임 설명 버튼에서 description.md 또는 ZIP으로 제출합니다. 태그나 설명을 변경한
        게임 제작자는 24시간 동안 다시 수정할 수 없습니다.
        {contentEditUnlockLabel ? ` 다음 수정 가능 시각: ${contentEditUnlockLabel}` : ""}
      </p>
      <button
        type="button"
        disabled={busy || !title.trim() || !genre.trim()}
        onClick={async () => {
          setBusy(true);
          try {
            await patchDevGameBasicMetadata(game.id, {
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
            onSaved();
          } catch (err) {
            onError(err instanceof Error ? err.message : "속성 수정에 실패했습니다.");
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[11px] font-bold text-text-muted [&_input]:rounded-xl [&_input]:border [&_input]:border-border [&_input]:bg-surface-raised [&_input]:px-3 [&_input]:py-2 [&_input]:text-sm [&_input]:text-text-primary [&_input:disabled]:cursor-not-allowed [&_input:disabled]:opacity-50 [&_select]:rounded-xl [&_select]:border [&_select]:border-border [&_select]:bg-surface-raised [&_select]:px-3 [&_select]:py-2 [&_select]:text-sm [&_select]:text-text-primary [&_textarea]:rounded-xl [&_textarea]:border [&_textarea]:border-border [&_textarea]:bg-surface-raised [&_textarea]:px-3 [&_textarea]:py-2 [&_textarea]:text-sm [&_textarea]:text-text-primary">
      {label}
      {children}
    </label>
  );
}

function PageMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center text-sm text-text-muted">
      {children}
    </div>
  );
}
