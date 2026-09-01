import type { Dictionary } from "../i18n/dictionary";
import type { PublicGameCard } from "./publicGameAdapter";

/** Public game metadata comes only from the D1/B2-backed API. Keep the dictionary parameter while
 * callers share one rendering path, but never overlay a slug-keyed catalog from the Web bundle. */
export function getLocalizedGameContent(_dict: Dictionary, game: PublicGameCard, locale = "en") {
  const contentLocale = locale.startsWith("ko")
    ? "ko"
    : locale.startsWith("ja")
      ? "ja"
      : locale.startsWith("zh")
        ? "zh"
        : "en";
  const translated = contentLocale === "en" ? undefined : game.localizations?.[contentLocale];
  return {
    title: translated?.title ?? game.title,
    shortDescription: translated?.shortDescription ?? game.shortDescription,
    description: game.description,
    tags: game.tags,
  };
}
