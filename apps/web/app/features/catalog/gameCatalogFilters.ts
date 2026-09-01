import type { PublicGameCard } from "./publicGameAdapter";

export type GamePlayModeFilter = "single" | "multi";

export interface GenreGroup {
  readonly key: string;
  readonly label: string;
  readonly games: readonly PublicGameCard[];
}

/** Canonical comparison form only. UI keeps the first source spelling as the display label. */
export function normalizeCatalogValue(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

export function matchesGameSearch(
  game: PublicGameCard,
  query: string,
  localized?: { readonly title: string; readonly shortDescription: string },
): boolean {
  const normalizedQuery = normalizeCatalogValue(query);
  if (!normalizedQuery) return true;

  const fields = [
    localized?.title ?? game.title,
    localized?.shortDescription ?? game.shortDescription,
    game.description,
    game.genre ?? "",
    ...game.tags,
    ...game.categories,
  ];
  return fields.some((field) => normalizeCatalogValue(field).includes(normalizedQuery));
}

export function matchesGamePlayMode(
  game: PublicGameCard,
  filter: GamePlayModeFilter | null,
): boolean {
  if (filter === null) return true;
  if (filter === "single") return game.modes.includes("single");
  return game.modes.some((mode) => mode === "local-multi" || mode === "online-multi");
}

export function groupGamesByGenre(
  games: readonly PublicGameCard[],
  uncategorizedLabel: string,
): readonly GenreGroup[] {
  const groups = new Map<string, { label: string; games: PublicGameCard[] }>();

  for (const game of games) {
    const displayGenre = game.genre?.normalize("NFC").trim() || uncategorizedLabel;
    const key = game.genre ? normalizeCatalogValue(game.genre) : "__uncategorized__";
    const existing = groups.get(key);
    if (existing) {
      existing.games.push(game);
    } else {
      groups.set(key, { label: displayGenre, games: [game] });
    }
  }

  return Array.from(groups, ([key, value]) => ({ key, ...value })).sort((a, b) =>
    a.label.localeCompare(b.label),
  );
}
