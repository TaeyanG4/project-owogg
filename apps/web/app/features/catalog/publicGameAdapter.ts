import type { PublicGame } from "@owogg/contracts";
import { localizedPublicGameMetadata } from "./gameLocalization";

export interface PublicGameCard {
  readonly slug: string;
  readonly title: string;
  readonly shortDescription: string;
  readonly description: string;
  readonly localizations?: PublicGame["localizations"];
  readonly modes: readonly string[];
  readonly thumbnail: string;
  readonly accent?: string | undefined;
  readonly categories: readonly string[];
  readonly tags: readonly string[];
  readonly publisherType: PublicGame["publisherType"];
  readonly publisherName: string;
  readonly catalogType: PublicGame["catalog"]["type"];
  readonly genre?: string | undefined;
  readonly scoreUnit?: string | undefined;
  readonly publishedAt: string;
  readonly playerCount: number;
  readonly bookmarkCount: number;
  readonly popularityScore: number;
}

/** Web-only view model. It preserves GENRE_MODE as a real shape: no fake taxonomy categories,
 * tags, thumbnail, or player counts are manufactured for USER games. */
export function publicGameToCard(game: PublicGame, locale = "en"): PublicGameCard {
  const localized = localizedPublicGameMetadata(game, locale);
  if (game.catalog.type === "TAXONOMY") {
    return {
      slug: game.slug,
      title: localized.title,
      shortDescription: localized.shortDescription,
      description: game.description,
      localizations: game.localizations,
      modes: game.playModes,
      // `catalog.thumbnail` is retained only as canonical migration metadata. Runtime artwork
      // comes exclusively from the public D1/B2 media projection; an empty value makes the shared
      // thumbnail component render its deterministic text/accent fallback without a doomed HTTP
      // request to the removed Git game directory.
      thumbnail: game.mediaUrl ?? "",
      ...(game.catalog.accent !== undefined ? { accent: game.catalog.accent } : {}),
      categories: game.catalog.categories,
      tags: game.catalog.tags,
      publisherType: game.publisherType,
      publisherName: game.publisherName,
      catalogType: game.catalog.type,
      publishedAt: game.publishedAt,
      playerCount: game.stats.playerCount,
      bookmarkCount: game.stats.bookmarkCount,
      popularityScore: game.stats.popularityScore,
      ...(game.policy.score ? { scoreUnit: game.policy.score.unit } : {}),
    };
  }

  return {
    slug: game.slug,
    title: localized.title,
    shortDescription: localized.shortDescription,
    description: game.description,
    localizations: game.localizations,
    // The top-level projection carries the exact declared topology; the coarse legacy `mode`
    // remains compatibility metadata and must not erase local/online distinctions in discovery.
    modes: game.playModes,
    thumbnail: game.mediaUrl ?? "",
    categories: [],
    tags: game.catalog.tags ?? [],
    publisherType: game.publisherType,
    publisherName: game.publisherName,
    catalogType: game.catalog.type,
    publishedAt: game.publishedAt,
    playerCount: game.stats.playerCount,
    bookmarkCount: game.stats.bookmarkCount,
    popularityScore: game.stats.popularityScore,
    genre: game.catalog.genre,
    ...(game.policy.score ? { scoreUnit: game.policy.score.unit } : {}),
  };
}
