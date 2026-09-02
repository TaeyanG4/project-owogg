import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  ExternalLink,
  ImagePlus,
  Loader2,
  Pencil,
  Plus,
  Send,
  Trash2,
  Undo2,
} from "lucide-react";
import type {
  ExternalGameCreateRequest,
  ExternalGameRecord,
  ExternalGameUpdateRequest,
} from "@owogg/contracts";
import {
  createExternalGame,
  deleteExternalGame,
  deleteExternalGameMedia,
  fetchMyExternalGames,
  submitExternalGame,
  updateExternalGame,
  uploadExternalGameMedia,
  withdrawExternalGame,
} from "../../features/externalGamesApi";

const EMPTY_FORM = {
  slug: "",
  title: "",
  shortDescription: "",
  descriptionMarkdown: "",
  platformName: "",
  externalUrl: "https://",
  releaseDate: "",
  tags: "",
  ownershipType: "THIRD_PARTY" as const,
  rightsNote: "",
};

type FormState =
  | typeof EMPTY_FORM
  | (Omit<typeof EMPTY_FORM, "ownershipType"> & {
      ownershipType: "OWN_GAME" | "THIRD_PARTY";
    });

export function ExternalGameCreatorPanel() {
  const [games, setGames] = useState<ExternalGameRecord[] | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetchMyExternalGames();
      setGames(response.games);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "소개 목록을 불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activeReviewCount = useMemo(
    () => games?.filter((game) => game.reviewSlot !== null).length ?? 0,
    [games],
  );
  const editingGame = games?.find((game) => game.id === editingId) ?? null;

  const resetForm = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setRightsConfirmed(false);
  };

  const startEditing = (game: ExternalGameRecord) => {
    setEditingId(game.id);
    setForm({
      slug: game.slug,
      title: game.title,
      shortDescription: game.shortDescription,
      descriptionMarkdown: game.descriptionMarkdown,
      platformName: game.platformName,
      externalUrl: game.externalUrl,
      releaseDate: game.releaseDate ?? "",
      tags: game.tags.join(", "),
      ownershipType: game.ownershipType,
      rightsNote: game.rightsNote,
    });
    setRightsConfirmed(false);
    setError(null);
  };

  const contentInput = (): ExternalGameUpdateRequest => ({
    title: form.title.trim(),
    shortDescription: form.shortDescription.trim(),
    descriptionMarkdown: form.descriptionMarkdown.trim(),
    platformName: form.platformName.trim(),
    externalUrl: form.externalUrl.trim(),
    releaseDate: form.releaseDate || null,
    tags: form.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
    ownershipType: form.ownershipType,
    rightsNote: form.rightsNote.trim(),
  });

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy("save");
    setError(null);
    try {
      if (editingId === null) {
        const input: ExternalGameCreateRequest = {
          slug: form.slug.trim(),
          ...contentInput(),
        };
        const created = await createExternalGame(input);
        await load();
        startEditing(created);
      } else {
        await updateExternalGame(editingId, contentInput());
        await load();
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "소개를 저장하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  };

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

  const upload = async (kind: "BANNER" | "SCREENSHOT", file: File | undefined) => {
    if (!editingGame || !file) return;
    await run(`upload-${kind}`, async () => {
      await uploadExternalGameMedia({
        gameId: editingGame.id,
        kind,
        file,
        altText: kind === "BANNER" ? `${editingGame.title} 배너` : `${editingGame.title} 소개 화면`,
      });
    });
  };

  return (
    <section className="space-y-5">
      <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-4 sm:flex sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-black text-text-primary">타 플랫폼 게임 소개</h2>
          <p className="mt-1 text-xs leading-relaxed text-text-muted">
            본인 게임이 아니어도 소개할 수 있습니다. 단, 설명과 이미지를 게시할 권리가 있는지 직접
            확인해야 하며 모든 소개는 관리자 심사를 거칩니다.
          </p>
        </div>
        <div className="mt-3 shrink-0 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-black text-text-secondary sm:mt-0">
          심사 슬롯 {activeReviewCount}/3
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

      <form
        onSubmit={save}
        className="space-y-4 rounded-3xl border border-border bg-surface-raised p-5 shadow-xl md:p-6"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-black text-text-primary">
              {editingGame ? `${editingGame.title} 수정` : "새 게임 소개 작성"}
            </h3>
            <p className="mt-1 text-[11px] text-text-muted">
              저장 후 배너와 소개 이미지를 등록하고 심사에 제출할 수 있습니다.
            </p>
          </div>
          {editingGame && (
            <button
              type="button"
              onClick={resetForm}
              className="rounded-xl border border-border px-3 py-2 text-xs font-bold text-text-muted hover:text-text-primary"
            >
              새 글 작성
            </button>
          )}
        </div>

        {editingGame?.moderationStatus === "APPROVED" && (
          <div className="flex gap-2 rounded-xl border border-accent-yellow/30 bg-accent-yellow/10 p-3 text-[11px] leading-relaxed text-accent-yellow">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> 승인된 소개를 수정하면 공개가 잠시
            중단되고 새 심사를 받아야 합니다.
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="URL ID" hint="영문 소문자, 숫자, 하이픈">
            <input
              required
              minLength={3}
              maxLength={48}
              pattern="[a-z0-9-]+"
              disabled={editingId !== null}
              value={form.slug}
              onChange={(event) => setForm({ ...form, slug: event.target.value.toLowerCase() })}
              className={inputClass}
              placeholder="my-favorite-game"
            />
          </Field>
          <Field label="플랫폼/게임 사이트">
            <input
              required
              maxLength={60}
              value={form.platformName}
              onChange={(event) => setForm({ ...form, platformName: event.target.value })}
              className={inputClass}
              placeholder="Steam, itch.io, 공식 웹사이트"
            />
          </Field>
          <Field label="게임 이름">
            <input
              required
              minLength={2}
              maxLength={120}
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="출시일" hint="선택 사항">
            <input
              type="date"
              value={form.releaseDate}
              onChange={(event) => setForm({ ...form, releaseDate: event.target.value })}
              className={inputClass}
            />
          </Field>
        </div>

        <Field label="게임 플레이 링크" hint="HTTPS 주소만 허용">
          <input
            required
            type="url"
            maxLength={2048}
            value={form.externalUrl}
            onChange={(event) => setForm({ ...form, externalUrl: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="한 줄 소개">
          <input
            required
            maxLength={240}
            value={form.shortDescription}
            onChange={(event) => setForm({ ...form, shortDescription: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="상세 소개" hint="Markdown 사용 가능 · 최대 20,000자">
          <textarea
            required
            rows={7}
            maxLength={20_000}
            value={form.descriptionMarkdown}
            onChange={(event) => setForm({ ...form, descriptionMarkdown: event.target.value })}
            className={inputClass}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="태그" hint="쉼표로 구분 · 최대 8개">
            <input
              value={form.tags}
              onChange={(event) => setForm({ ...form, tags: event.target.value })}
              className={inputClass}
              placeholder="indie, puzzle, co-op"
            />
          </Field>
          <Field label="게임과의 관계">
            <select
              value={form.ownershipType}
              onChange={(event) =>
                setForm({
                  ...form,
                  ownershipType: event.target.value as FormState["ownershipType"],
                })
              }
              className={inputClass}
            >
              <option value="THIRD_PARTY">다른 사람의 게임을 소개합니다</option>
              <option value="OWN_GAME">제가 만든 게임입니다</option>
            </select>
          </Field>
        </div>
        <Field
          label="권리 확인 메모"
          hint="관리자가 출처와 게시 권한을 확인할 수 있는 내용을 적어주세요"
        >
          <textarea
            rows={3}
            maxLength={1000}
            value={form.rightsNote}
            onChange={(event) => setForm({ ...form, rightsNote: event.target.value })}
            className={inputClass}
            placeholder="예: 공식 press kit의 재배포 허용 이미지를 사용했습니다."
          />
        </Field>

        <button
          type="submit"
          disabled={busy !== null || editingGame?.moderationStatus === "PENDING_REVIEW"}
          className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-xs font-black text-white hover:bg-brand-light disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy === "save" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : editingGame ? (
            <Pencil className="h-4 w-4" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          {editingGame ? "소개 내용 저장" : "초안 만들기"}
        </button>
      </form>

      {editingGame &&
        editingGame.moderationStatus !== "PENDING_REVIEW" &&
        editingGame.deletedAt === null && (
          <section className="space-y-4 rounded-3xl border border-border bg-surface-raised p-5 md:p-6">
            <div>
              <h3 className="text-sm font-black text-text-primary">소개 이미지</h3>
              <p className="mt-1 text-[11px] text-text-muted">
                배너 1개(선택)와 스크린샷 최대 8개를 등록할 수 있습니다. 각 파일은 5MB 이하의 래스터
                이미지여야 합니다.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <ImageUploadButton
                label="배너 추가"
                busy={busy === "upload-BANNER"}
                disabled={editingGame.media.some((item) => item.kind === "BANNER")}
                onFile={(file) => void upload("BANNER", file)}
              />
              <ImageUploadButton
                label="스크린샷 추가"
                busy={busy === "upload-SCREENSHOT"}
                disabled={
                  editingGame.media.filter((item) => item.kind === "SCREENSHOT").length >= 8
                }
                onFile={(file) => void upload("SCREENSHOT", file)}
              />
            </div>
            {editingGame.media.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {editingGame.media.map((media) => (
                  <figure
                    key={media.id}
                    className="overflow-hidden rounded-2xl border border-border bg-surface"
                  >
                    <img
                      src={media.url}
                      alt={media.altText || editingGame.title}
                      className="aspect-video w-full object-cover"
                    />
                    <figcaption className="flex items-center justify-between gap-2 px-3 py-2 text-[10px] font-bold text-text-muted">
                      <span>
                        {media.kind === "BANNER" ? "배너" : `스크린샷 ${media.sortOrder + 1}`}
                      </span>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() =>
                          void run(`delete-media-${media.id}`, () =>
                            deleteExternalGameMedia(editingGame.id, media.id),
                          )
                        }
                        className="text-accent-red hover:underline"
                      >
                        삭제
                      </button>
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}

            <label className="flex items-start gap-2 rounded-xl border border-border bg-surface p-3 text-xs leading-relaxed text-text-secondary">
              <input
                type="checkbox"
                checked={rightsConfirmed}
                onChange={(event) => setRightsConfirmed(event.target.checked)}
                className="mt-0.5 h-4 w-4 accent-brand"
              />
              <span>
                이 소개에 사용한 설명·배너·이미지와 외부 링크가 저작권 또는 이용 정책을 침해하지
                않으며, 관리자가 문제가 있다고 판단하면 비공개 또는 삭제할 수 있음에 동의합니다.
              </span>
            </label>
            <button
              type="button"
              disabled={
                busy !== null ||
                !rightsConfirmed ||
                editingGame.media.every((item) => item.kind !== "SCREENSHOT") ||
                activeReviewCount >= 3
              }
              onClick={() =>
                void run(`submit-${editingGame.id}`, () => submitExternalGame(editingGame.id))
              }
              className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-xs font-black text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy === `submit-${editingGame.id}` ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}{" "}
              심사 제출
            </button>
          </section>
        )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black text-text-primary">내가 소개한 게임</h3>
          <span className="text-[11px] font-bold text-text-muted">{games?.length ?? 0}개</span>
        </div>
        {games === null ? (
          <p className="rounded-2xl border border-border bg-surface-raised p-6 text-center text-xs text-text-muted">
            불러오는 중...
          </p>
        ) : games.length === 0 ? (
          <p className="rounded-2xl border border-border bg-surface-raised p-6 text-center text-xs text-text-muted">
            아직 작성한 타 플랫폼 게임 소개가 없습니다.
          </p>
        ) : (
          <div className="space-y-3">
            {games.map((game) => (
              <article
                key={game.id}
                className={`rounded-2xl border p-4 ${editingId === game.id ? "border-brand/60 bg-brand/5" : "border-border bg-surface-raised"}`}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="truncate text-sm font-black text-text-primary">
                        {game.title}
                      </h4>
                      <StatusBadge game={game} />
                    </div>
                    <p className="mt-1 truncate text-[11px] text-text-muted">
                      {game.platformName} · /external-games/{game.slug}
                    </p>
                    {game.rejectReason && (
                      <p className="mt-1 text-[11px] font-semibold text-accent-red">
                        반려 사유: {game.rejectReason}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {game.moderationStatus === "APPROVED" && game.visibility === "PUBLIC" && (
                      <a href={`/external-games/${game.slug}`} className={smallButtonClass}>
                        <ExternalLink className="h-3.5 w-3.5" /> 공개 페이지
                      </a>
                    )}
                    {game.moderationStatus === "PENDING_REVIEW" ? (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() =>
                          void run(`withdraw-${game.id}`, () => withdrawExternalGame(game.id))
                        }
                        className={smallButtonClass}
                      >
                        <Undo2 className="h-3.5 w-3.5" /> 제출 철회
                      </button>
                    ) : game.deletedAt === null ? (
                      <button
                        type="button"
                        onClick={() => startEditing(game)}
                        className={smallButtonClass}
                      >
                        <Pencil className="h-3.5 w-3.5" /> 수정
                      </button>
                    ) : null}
                    {game.publishedAt === null &&
                      game.moderationStatus !== "PENDING_REVIEW" &&
                      game.deletedAt === null && (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => {
                            if (window.confirm("이 소개 초안을 삭제할까요?"))
                              void run(`delete-${game.id}`, async () => {
                                await deleteExternalGame(game.id);
                                if (editingId === game.id) resetForm();
                              });
                          }}
                          className={`${smallButtonClass} text-accent-red`}
                        >
                          <Trash2 className="h-3.5 w-3.5" /> 삭제
                        </button>
                      )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block text-xs font-bold text-text-secondary">
      <span>{label}</span>
      {hint && <span className="ml-1 font-medium text-text-muted">· {hint}</span>}
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}

function ImageUploadButton({
  label,
  busy,
  disabled,
  onFile,
}: {
  label: string;
  busy: boolean;
  disabled: boolean;
  onFile: (file: File | undefined) => void;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-brand/40 bg-brand/5 px-4 py-4 text-xs font-black text-brand-light hover:bg-brand/10 ${disabled ? "pointer-events-none opacity-40" : ""}`}
    >
      <input
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
        className="sr-only"
        disabled={busy || disabled}
        onChange={(event) => {
          onFile(event.target.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
      {label}
    </label>
  );
}

function StatusBadge({ game }: { game: ExternalGameRecord }) {
  const config =
    game.deletedAt !== null
      ? ["삭제됨", "text-text-muted bg-surface"]
      : game.moderationStatus === "APPROVED"
        ? [
            game.visibility === "PUBLIC" ? "공개" : "승인·비공개",
            "text-accent-green bg-accent-green/10",
          ]
        : game.moderationStatus === "PENDING_REVIEW"
          ? [`심사 대기 · 슬롯 ${game.reviewSlot}`, "text-accent-yellow bg-accent-yellow/10"]
          : game.moderationStatus === "REJECTED"
            ? ["반려", "text-accent-red bg-accent-red/10"]
            : ["초안", "text-brand-light bg-brand/10"];
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${config[1]}`}>
      {config[0]}
    </span>
  );
}

const inputClass =
  "w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-text-primary outline-none placeholder:text-text-muted/60 focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-50";
const smallButtonClass =
  "inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-[11px] font-bold text-text-secondary hover:border-brand/40 hover:text-text-primary";
