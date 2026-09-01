import { useMemo, useRef, useState } from "react";
import { FileArchive, FileText, Loader2, Save, X } from "lucide-react";
import type { GameContentLocale, GameEditorContext, PublicGame } from "@owogg/contracts";
import { patchDevGameContent, replaceDevGameDescription } from "../../features/devApi";
import {
  patchAdminSandboxGameContent,
  patchOfficialGameContent,
  replaceAdminSandboxGameDescription,
  replaceOfficialGameDescription,
} from "../../features/adminApi";
import { resolveGameLocale } from "../../features/catalog/gameLocalization";

const DESCRIPTION_FILE_NAMES: Record<GameContentLocale, string> = {
  en: "description.md",
  ko: "description_kr.md",
  ja: "description_ja.md",
  zh: "description_zh.md",
};

const LANGUAGE_LABELS: Record<GameContentLocale, string> = {
  en: "English (기본)",
  ko: "한국어",
  ja: "日本語",
  zh: "中文",
};

interface Draft {
  title: string;
  shortDescription: string;
  descriptionMarkdown: string;
}

function initialDrafts(game: PublicGame): Record<GameContentLocale, Draft> {
  const description = (locale: GameContentLocale) =>
    game.descriptions?.find((document) => document.locale === locale)?.markdown ??
    (locale === "en" ? game.description : "");
  return {
    en: {
      title: game.title,
      shortDescription: game.shortDescription,
      descriptionMarkdown: description("en"),
    },
    ko: {
      title: game.localizations?.ko?.title ?? "",
      shortDescription: game.localizations?.ko?.shortDescription ?? "",
      descriptionMarkdown: description("ko"),
    },
    ja: {
      title: game.localizations?.ja?.title ?? "",
      shortDescription: game.localizations?.ja?.shortDescription ?? "",
      descriptionMarkdown: description("ja"),
    },
    zh: {
      title: game.localizations?.zh?.title ?? "",
      shortDescription: game.localizations?.zh?.shortDescription ?? "",
      descriptionMarkdown: description("zh"),
    },
  };
}

function futureEditLabel(value: string | null): string | null {
  if (!value || Date.parse(value) <= Date.now()) return null;
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

async function saveContent(
  slug: string,
  editor: GameEditorContext,
  input: Parameters<typeof patchOfficialGameContent>[1],
) {
  if (editor.mode === "OFFICIAL_ADMIN") return patchOfficialGameContent(slug, input);
  if (editor.mode === "USER_ADMIN") return patchAdminSandboxGameContent(editor.gameId, input);
  return patchDevGameContent(editor.gameId, input);
}

async function uploadDescriptionPackage(slug: string, editor: GameEditorContext, file: File) {
  if (editor.mode === "OFFICIAL_ADMIN") return replaceOfficialGameDescription(slug, file);
  if (editor.mode === "USER_ADMIN") return replaceAdminSandboxGameDescription(editor.gameId, file);
  return replaceDevGameDescription(editor.gameId, file);
}

export function GameInformationEditor({
  game,
  editor,
  interfaceLocale,
  onSaved,
  onClose,
}: {
  game: PublicGame;
  editor: GameEditorContext;
  interfaceLocale: string;
  onSaved: (message: string, publishedImmediately: boolean) => Promise<void> | void;
  onClose: () => void;
}) {
  const [language, setLanguage] = useState<GameContentLocale>(() =>
    resolveGameLocale(interfaceLocale),
  );
  const [drafts, setDrafts] = useState(() => initialDrafts(game));
  const [tags, setTags] = useState(
    game.catalog.type === "GENRE_MODE"
      ? (game.catalog.tags ?? []).join(", ")
      : game.catalog.tags.join(", "),
  );
  const [busy, setBusy] = useState<"save" | "package" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const loadFileInput = useRef<HTMLInputElement>(null);
  const packageInput = useRef<HTMLInputElement>(null);
  const draft = drafts[language];
  const unlockLabel =
    editor.mode === "USER_CREATOR" ? futureEditLabel(editor.contentEditAvailableAt) : null;
  const publishedImmediately = editor.mode === "OFFICIAL_ADMIN";
  const parsedTags = useMemo(
    () =>
      Array.from(
        new Set(
          tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
        ),
      ),
    [tags],
  );

  const updateDraft = (patch: Partial<Draft>) =>
    setDrafts((current) => ({
      ...current,
      [language]: { ...current[language], ...patch },
    }));

  return (
    <div className="mt-5 rounded-2xl border border-brand/30 bg-surface p-4 sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-black text-text-primary">게임 정보 수정</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
            영어 제목은 필수 기본값이며, 한국어·일본어·중국어는 선택 번역입니다. 저장하면
            owogg.json과 선택한 description Markdown이 같은 새 버전에 반영됩니다.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="편집 닫기"
          className="rounded-lg p-1.5 text-text-muted hover:bg-surface-overlay hover:text-text-primary"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[180px_minmax(0,1fr)]">
        <label className="flex flex-col gap-1.5 text-[11px] font-bold text-text-muted">
          언어
          <select
            value={language}
            onChange={(event) => setLanguage(event.target.value as GameContentLocale)}
            className="rounded-xl border border-border bg-surface-raised px-3 py-2.5 text-sm font-bold text-text-primary outline-none focus:border-brand"
          >
            {(Object.keys(LANGUAGE_LABELS) as GameContentLocale[]).map((locale) => (
              <option key={locale} value={locale}>
                {LANGUAGE_LABELS[locale]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-[11px] font-bold text-text-muted">
          게임명 {language === "en" ? "(영어 기본값)" : "(번역)"}
          <input
            value={draft.title}
            onChange={(event) => updateDraft({ title: event.target.value })}
            maxLength={60}
            placeholder={language === "en" ? "English title" : game.title}
            className="rounded-xl border border-border bg-surface-raised px-3 py-2.5 text-sm text-text-primary outline-none focus:border-brand"
          />
        </label>
      </div>

      <label className="mt-4 flex flex-col gap-1.5 text-[11px] font-bold text-text-muted">
        짧은 설명
        <input
          value={draft.shortDescription}
          onChange={(event) => updateDraft({ shortDescription: event.target.value })}
          maxLength={200}
          className="rounded-xl border border-border bg-surface-raised px-3 py-2.5 text-sm text-text-primary outline-none focus:border-brand"
        />
      </label>

      <label className="mt-4 flex flex-col gap-1.5 text-[11px] font-bold text-text-muted">
        태그 (모든 언어 공통, 쉼표 구분 · 최대 20개)
        <input
          value={tags}
          onChange={(event) => setTags(event.target.value)}
          className="rounded-xl border border-border bg-surface-raised px-3 py-2.5 text-sm text-text-primary outline-none focus:border-brand"
        />
      </label>

      <div className="mt-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] font-bold text-text-muted">
            상세 설명 · {DESCRIPTION_FILE_NAMES[language]}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => loadFileInput.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-bold text-text-secondary hover:border-brand/50"
            >
              <FileText className="h-3.5 w-3.5" /> 파일 불러오기
            </button>
            <button
              type="button"
              disabled={busy !== null || unlockLabel !== null}
              onClick={() => packageInput.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-bold text-text-secondary hover:border-brand/50 disabled:opacity-50"
            >
              {busy === "package" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileArchive className="h-3.5 w-3.5" />
              )}
              Markdown/ZIP 바로 제출
            </button>
          </div>
        </div>
        <textarea
          value={draft.descriptionMarkdown}
          onChange={(event) => updateDraft({ descriptionMarkdown: event.target.value })}
          rows={12}
          spellCheck={false}
          className="w-full rounded-xl border border-border bg-surface-raised px-3 py-3 font-mono text-xs leading-6 text-text-primary outline-none focus:border-brand"
        />
        <input
          ref={loadFileInput}
          type="file"
          accept=".md,text/markdown,text/plain"
          className="hidden"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            try {
              updateDraft({ descriptionMarkdown: await file.text() });
              setError(null);
              setNotice(`${file.name} 내용을 편집기에 불러왔습니다.`);
            } catch {
              setError("파일을 읽지 못했습니다.");
            }
          }}
        />
        <input
          ref={packageInput}
          type="file"
          accept=".md,.zip,text/markdown,application/zip"
          className="hidden"
          onChange={async (event) => {
            const selected = event.target.files?.[0];
            event.target.value = "";
            if (!selected) return;
            setBusy("package");
            setError(null);
            setNotice(null);
            try {
              const file = selected.name.toLowerCase().endsWith(".zip")
                ? selected
                : new File([selected], DESCRIPTION_FILE_NAMES[language], {
                    type: "text/markdown",
                  });
              await uploadDescriptionPackage(game.slug, editor, file);
              const message = publishedImmediately
                ? "상세 설명을 새 공식 버전으로 게시했습니다."
                : "상세 설명을 새 버전으로 제출했습니다. 승인 후 공개 화면에 반영됩니다.";
              setNotice(message);
              await onSaved(message, publishedImmediately);
            } catch (caught) {
              setError(
                caught instanceof Error ? caught.message : "설명 파일을 제출하지 못했습니다.",
              );
            } finally {
              setBusy(null);
            }
          }}
        />
      </div>

      {unlockLabel && (
        <p className="mt-3 text-xs font-bold text-accent-yellow">
          제작자 수정 제한 중입니다. 다음 수정 가능: {unlockLabel}
        </p>
      )}
      {error && <p className="mt-3 text-xs font-bold text-accent-red">{error}</p>}
      {notice && <p className="mt-3 text-xs font-bold text-accent-green">{notice}</p>}

      <button
        type="button"
        disabled={
          busy !== null ||
          unlockLabel !== null ||
          !draft.title.trim() ||
          parsedTags.length > 20 ||
          parsedTags.some((tag) => tag.length > 40)
        }
        onClick={async () => {
          setBusy("save");
          setError(null);
          setNotice(null);
          try {
            await saveContent(game.slug, editor, {
              locale: language,
              title: draft.title.trim(),
              shortDescription: draft.shortDescription.trim() || null,
              tags: parsedTags,
              ...(draft.descriptionMarkdown.trim()
                ? { descriptionMarkdown: draft.descriptionMarkdown }
                : {}),
            });
            const message = publishedImmediately
              ? "게임 정보를 새 공식 버전으로 게시했습니다."
              : "게임 정보를 새 버전으로 제출했습니다. 승인 후 공개 화면에 반영됩니다.";
            setNotice(message);
            await onSaved(message, publishedImmediately);
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : "게임 정보를 저장하지 못했습니다.");
          } finally {
            setBusy(null);
          }
        }}
        className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2.5 text-xs font-black text-white hover:bg-brand-light disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy === "save" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Save className="h-3.5 w-3.5" />
        )}
        새 버전으로 저장
      </button>
    </div>
  );
}
