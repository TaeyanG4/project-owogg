import type { GameContentLocale, PublicGame } from "@owogg/contracts";

export function resolveGameLocale(locale: string): GameContentLocale {
  if (locale.startsWith("ko")) return "ko";
  if (locale.startsWith("ja")) return "ja";
  if (locale.startsWith("zh")) return "zh";
  return "en";
}

/** Public top-level metadata is the mandatory English/default fallback. Optional manifest
 * translations override only the requested language, field by field. */
export function localizedPublicGameMetadata(game: PublicGame, locale: string) {
  const contentLocale = resolveGameLocale(locale);
  const translated = contentLocale === "en" ? undefined : game.localizations?.[contentLocale];
  return {
    title: translated?.title ?? game.title,
    shortDescription: translated?.shortDescription ?? game.shortDescription,
  };
}
