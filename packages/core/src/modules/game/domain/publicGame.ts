import type { GameAsset } from "./gameAsset.js";
import type { RuntimeGame } from "./runtimeGame.js";

/** Provider-neutral public projection. Publisher authority is reduced to a safe discriminant;
 * user ids, review state, storage keys, and live numeric ids never cross this boundary. */
export interface PublicGame {
  readonly publisherType: "OWOGG" | "USER";
  readonly publisherName: string;
  readonly slug: string;
  readonly title: string;
  readonly shortDescription: string;
  readonly description: string;
  readonly catalog: RuntimeGame["canonical"]["catalog"];
  readonly policy: RuntimeGame["canonical"]["policy"];
  readonly presentation?: RuntimeGame["canonical"]["presentation"];
  readonly difficulty?: RuntimeGame["canonical"]["difficulty"];
  readonly supportsReplay: boolean;
  /** Public URL/path only; the D1 object key is intentionally never exposed. */
  readonly mediaUrl: string | null;
}

export function toPublicGame(
  runtime: RuntimeGame,
  mediaUrl: string | null,
  publisherName = runtime.canonical.publisher.official ? "OWOGG" : "USER",
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
    catalog: runtime.canonical.catalog,
    policy: runtime.canonical.policy,
    ...(runtime.canonical.presentation !== undefined
      ? { presentation: runtime.canonical.presentation }
      : {}),
    ...(runtime.canonical.difficulty !== undefined
      ? { difficulty: runtime.canonical.difficulty }
      : {}),
    supportsReplay: runtime.canonical.supportsReplay,
    mediaUrl,
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
