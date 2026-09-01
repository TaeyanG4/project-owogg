import { defaultUrlTransform } from "react-markdown";
import Markdown from "react-markdown";
import type { PublicGame } from "@owogg/contracts";

type GameDescriptionLocale = "en" | "ko" | "ja" | "zh";

function descriptionLocale(locale: string): GameDescriptionLocale {
  if (locale.startsWith("ko")) return "ko";
  if (locale.startsWith("ja")) return "ja";
  if (locale.startsWith("zh")) return "zh";
  return "en";
}

export function selectLocalizedGameDescription(
  game: PublicGame,
  locale: GameDescriptionLocale,
): string {
  return (
    game.descriptions?.find((document) => document.locale === locale)?.markdown ??
    game.descriptions?.find((document) => document.locale === "en")?.markdown ??
    game.description
  );
}

/** CommonMark renderer with raw HTML disabled. Image sources are replaced only when their exact
 * bundle-relative path appears in owogg.json's description_images allowlist. */
export function GameDescriptionMarkdown({ game, locale }: { game: PublicGame; locale: string }) {
  const markdown = selectLocalizedGameDescription(game, descriptionLocale(locale));
  const imageUrls = new Map(game.descriptionImages?.map((image) => [image.path, image.url]) ?? []);
  if (!markdown.trim()) return null;

  return (
    <div className="mt-4 space-y-4 text-sm leading-7 text-text-secondary [&_blockquote]:border-l-4 [&_blockquote]:border-brand/40 [&_blockquote]:pl-4 [&_code]:rounded [&_code]:bg-surface-overlay [&_code]:px-1.5 [&_code]:py-0.5 [&_h1]:text-2xl [&_h1]:font-black [&_h1]:text-text-primary [&_h2]:pt-2 [&_h2]:text-xl [&_h2]:font-black [&_h2]:text-text-primary [&_h3]:pt-1 [&_h3]:text-lg [&_h3]:font-extrabold [&_h3]:text-text-primary [&_hr]:border-border [&_li]:ml-5 [&_ol]:list-decimal [&_p]:whitespace-normal [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-surface-overlay [&_pre]:p-4 [&_ul]:list-disc">
      <Markdown
        skipHtml
        urlTransform={(url, key) =>
          key === "src" ? (imageUrls.get(url) ?? "") : defaultUrlTransform(url)
        }
        components={{
          a: ({ children, ...props }) => (
            <a
              {...props}
              className="font-bold text-brand-light underline decoration-brand/40 underline-offset-4"
              rel="noreferrer noopener"
              target="_blank"
            >
              {children}
            </a>
          ),
          img: ({ alt, ...props }) =>
            props.src ? (
              <img
                {...props}
                alt={alt ?? ""}
                className="my-5 max-h-[560px] w-auto max-w-full rounded-2xl border border-border object-contain"
                loading="lazy"
              />
            ) : null,
        }}
      >
        {markdown}
      </Markdown>
    </div>
  );
}
