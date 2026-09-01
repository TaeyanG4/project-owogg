import type { GameAsset } from "./gameAsset.js";
import type { GameCanonicalPlayConfig } from "./gameCanonicalDocument.js";
import type { RuntimeGame } from "./runtimeGame.js";
import type { OwoggManifestGame, OwoggPlayMode } from "@owogg/game-sdk/contracts";

/** A bookmark is a stronger, deliberate signal than opening a game once. The weight is public
 * product policy so every catalog surface ranks games identically. */
export const PUBLIC_GAME_BOOKMARK_POPULARITY_WEIGHT = 3;

export interface PublicGameStats {
  readonly playerCount: number;
  readonly bookmarkCount: number;
  readonly popularityScore: number;
}

function normalizedMetricCount(value: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

export function toPublicGameStats(input: {
  readonly playerCount: number;
  readonly bookmarkCount: number;
}): PublicGameStats {
  const playerCount = normalizedMetricCount(input.playerCount);
  const bookmarkCount = normalizedMetricCount(input.bookmarkCount);
  return {
    playerCount,
    bookmarkCount,
    popularityScore: playerCount + bookmarkCount * PUBLIC_GAME_BOOKMARK_POPULARITY_WEIGHT,
  };
}

export function emptyPublicGameStats(): PublicGameStats {
  return toPublicGameStats({ playerCount: 0, bookmarkCount: 0 });
}

/** Safe client-facing configuration choices. The server verifier id is intentionally excluded. */
export interface PublicGamePlayConfig {
  readonly version: GameCanonicalPlayConfig["version"];
  readonly rulesetRevision: number;
  readonly defaultVariantId: string;
  readonly variants: GameCanonicalPlayConfig["variants"];
  readonly allowedConfigs: GameCanonicalPlayConfig["allowedConfigs"];
}

function toPublicGamePlayConfig(playConfig: GameCanonicalPlayConfig): PublicGamePlayConfig {
  return {
    version: playConfig.version,
    rulesetRevision: playConfig.rulesetRevision,
    defaultVariantId: playConfig.defaultVariantId,
    variants: playConfig.variants.map((variant) => ({ ...variant })),
    allowedConfigs: playConfig.allowedConfigs.map((config) => ({ ...config })),
  };
}

/** Provider-neutral public projection. Publisher authority is reduced to a safe discriminant;
 * user ids, review state, storage keys, and live numeric ids never cross this boundary. */
export interface PublicGame {
  readonly publisherType: "OWOGG" | "USER";
  readonly publisherName: string;
  readonly slug: string;
  readonly title: string;
  readonly shortDescription: string;
  readonly description: string;
  /** Exact author-declared topology for current v1 games; never grants online authority. */
  readonly playModes: readonly OwoggPlayMode[];
  readonly catalog: RuntimeGame["canonical"]["catalog"];
  readonly policy: RuntimeGame["canonical"]["policy"];
  readonly presentation?: RuntimeGame["canonical"]["presentation"];
  readonly difficulty?: RuntimeGame["canonical"]["difficulty"];
  readonly playConfig?: PublicGamePlayConfig;
  readonly supportsReplay: boolean;
  /** Server-side game registration time. Version updates do not make an existing title a new
   * game again, so newest sorting uses identity.createdAt rather than the live version upload. */
  readonly publishedAt: string;
  readonly stats: PublicGameStats;
  /** Public URL/path only; the D1 object key is intentionally never exposed. */
  readonly mediaUrl: string | null;
  readonly localizations?: OwoggManifestGame["localizations"] | undefined;
}

export function publicGamePlayModes(runtime: RuntimeGame): readonly OwoggPlayMode[] {
  const declared = runtime.canonical.creatorManifest?.game.playModes;
  if (declared !== undefined) return [...declared];
  if (runtime.canonical.catalog.type === "TAXONOMY") {
    return [...runtime.canonical.catalog.modes];
  }
  // A canonical without a creator manifest predates exact topology. Preserve the safest local
  // interpretation; online discovery still requires an approved exact-version profile.
  return runtime.canonical.catalog.mode === "single" ? ["single"] : ["local-multi"];
}

export function toPublicGame(
  runtime: RuntimeGame,
  mediaUrl: string | null,
  publisherName = runtime.canonical.publisher.official ? "OWOGG" : "USER",
  stats: PublicGameStats = emptyPublicGameStats(),
): PublicGame {
  return {
    // Public official presentation comes from canonical metadata. D1 publisher identity remains
    // the authorization fact and is intentionally not exposed as the badge source.
    publisherType: runtime.canonical.publisher.official ? "OWOGG" : "USER",
    publisherName,
    slug: runtime.identity.slug,
    title: runtime.canonical.title,
    shortDescription: runtime.canonical.shortDescription,
    description: runtime.canonical.description,
    playModes: publicGamePlayModes(runtime),
    catalog: runtime.canonical.catalog,
    policy: runtime.canonical.policy,
    ...(runtime.canonical.presentation !== undefined
      ? { presentation: runtime.canonical.presentation }
      : {}),
    ...(runtime.canonical.difficulty !== undefined
      ? { difficulty: runtime.canonical.difficulty }
      : {}),
    ...(runtime.canonical.playConfig !== undefined
      ? { playConfig: toPublicGamePlayConfig(runtime.canonical.playConfig) }
      : {}),
    supportsReplay: runtime.canonical.supportsReplay,
    publishedAt: runtime.identity.createdAt,
    stats,
    mediaUrl,
    ...(runtime.canonical.creatorManifest?.game.localizations !== undefined
      ? {
          localizations: Object.fromEntries(
            Object.entries(runtime.canonical.creatorManifest.game.localizations).map(
              ([locale, localized]) => [locale, { ...localized }],
            ),
          ) as NonNullable<OwoggManifestGame["localizations"]>,
        }
      : {}),
  };
}

/** Resolve the public media projection without leaking a storage key.
 *
 * Canonical TAXONOMY thumbnail paths came from the removed Git game packages and are descriptive
 * migration metadata, not a runtime asset authority. Only a D1 asset row backed by B2 may produce
 * a public media URL; otherwise callers render their neutral no-image fallback. */
export function publicGameMediaUrl(asset: GameAsset | null, mediaEndpoint: string): string | null {
  if (asset?.kind === "LOGO") {
    // The public endpoint deliberately hides the B2 object key, so the asset row's update time is
    // the safe cache revision. Re-registering the same slug now produces a different URL and makes
    // browsers retry a logo that previously returned 404 instead of pinning the text fallback.
    const separator = mediaEndpoint.includes("?") ? "&" : "?";
    return `${mediaEndpoint}${separator}v=${encodeURIComponent(asset.updatedAt)}`;
  }
  return null;
}
