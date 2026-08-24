import { purgeEdgeCacheUrls } from "../middleware/edgeCache.js";

/** Public game reads whose response changes when an administrator publishes, disables, updates,
 * or deletes a game. Cache keys intentionally use the API request's own origin so the same code
 * works in isolated Staging and Production without a hard-coded hostname. */
export function publicGameReadCacheUrls(
  requestUrl: string,
  slugs: readonly string[] = [],
): string[] {
  const urls = [new URL("/api/games", requestUrl), new URL("/api/games/availability", requestUrl)];

  for (const slug of slugs) {
    const encodedSlug = encodeURIComponent(slug);
    urls.push(new URL(`/api/games/${encodedSlug}`, requestUrl));
    // The current logo URL is revisioned, but evicting the unversioned compatibility key also
    // prevents an older catalog response from keeping a stale logo response alive in this colo.
    urls.push(new URL(`/api/games/${encodedSlug}/media/logo`, requestUrl));
  }

  return urls.map((url) => url.toString());
}

export async function purgePublicGameReadCache(requestUrl: string, slugs: readonly string[] = []) {
  await purgeEdgeCacheUrls(publicGameReadCacheUrls(requestUrl, slugs));
}
