import type { PublicGameCard } from "./publicGameAdapter";
import type { ResolvedGameGenre } from "./gameGenres";

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
  localized?: {
    readonly title: string;
    readonly shortDescription: string;
    readonly genre?: string;
  },
): boolean {
  const normalizedQuery = normalizeCatalogValue(query);
  if (!normalizedQuery) return true;

  const fields = [
    localized?.title ?? game.title,
    localized?.shortDescription ?? game.shortDescription,
    game.description,
    game.genre ?? "",
    localized?.genre ?? "",
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
  resolveGenre: (genre: string | undefined) => ResolvedGameGenre,
): readonly GenreGroup[] {
  const groups = new Map<string, { label: string; games: PublicGameCard[] }>();

  for (const game of games) {
    const { key, label } = resolveGenre(game.genre);
    const existing = groups.get(key);
    if (existing) {
      existing.games.push(game);
    } else {
      groups.set(key, { label, games: [game] });
    }
  }

  return Array.from(groups, ([key, value]) => ({ key, ...value })).sort((a, b) =>
    a.label.localeCompare(b.label),
  );
}
