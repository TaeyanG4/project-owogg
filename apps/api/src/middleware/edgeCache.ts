import type { MiddlewareHandler } from "hono";
import type { ApiEnv } from "../routes/auth.js";

/**
 * `caches.default` is a Cloudflare extension to the standard CacheStorage. The shared
 * tsconfig.base.json includes the "DOM" lib (apps/web needs it), and DOM's `CacheStorage` — which
 * has no `default` — shadows @cloudflare/workers-types' version here. Rather than fork the
 * shared compiler config for one property, narrow it at the single point of use.
 */
interface CloudflareCacheStorage {
  default: {
    match(request: Request): Promise<Response | undefined>;
    put(request: Request, response: Response): Promise<void>;
    delete(request: Request): Promise<boolean>;
  };
}

export interface EdgeCacheOptions {
  ttlSeconds: number;
  /**
   * Browser-facing TTL. The Cache API entry still uses `ttlSeconds`, so setting this to zero keeps
   * the D1-saving edge cache while forcing browsers to ask the Worker again. This is important for
   * mutable catalog surfaces: an admin mutation can evict the edge entry, but it cannot otherwise
   * reach into every already-open browser's HTTP cache.
   */
  browserTtlSeconds?: number;
}

function browserCacheControl(options: EdgeCacheOptions): string {
  const browserTtlSeconds = options.browserTtlSeconds ?? options.ttlSeconds;
  return browserTtlSeconds <= 0
    ? "no-store"
    : `public, max-age=${browserTtlSeconds}, s-maxage=${options.ttlSeconds}`;
}

/**
 * Cloudflare Cache API edge caching for PUBLIC, NON-USER-VARYING GET endpoints.
 *
 * Why this exists: D1 processes queries strictly one at a time (see docs/DATABASE.md §4), so
 * read throughput is bounded by per-query latency, not by how many Workers isolates are running.
 * Under a traffic spike the leaderboard/catalog reads — which are byte-identical for every
 * visitor — would otherwise each consume a slot in that single serialized queue. Serving them
 * from the colo's edge cache takes them to *zero* D1 queries on a hit, which is the difference
 * between "D1 is the bottleneck" and "D1 only sees writes and cache misses".
 *
 * ⚠️ SAFETY — READ BEFORE APPLYING TO A NEW ROUTE ⚠️
 * `caches.default` keys entries on the request URL only. Request headers — including `Cookie` —
 * are NOT part of the cache key. Applying this to any endpoint whose response varies per user
 * would serve one user's data to everyone else hitting the same URL. Only apply it where the
 * response depends solely on the URL:
 *
 *   ✅ safe:   /api/scores/:gameId (public leaderboard), /api/games/availability,
 *              /api/progression/leaderboard, public guild pages
 *   ❌ unsafe: anything reading `owogg_session` (e.g. /api/scores/user/me, /api/auth/me,
 *              /api/personalization/*), anything admin-gated, anything returning
 *              visibility-filtered data (e.g. /api/profile/public/:id — favorites/recent-plays
 *              are gated on the *viewer*, so the same URL legitimately returns different bodies)
 *
 * Staleness is bounded by `ttlSeconds` by default: a leaderboard that lags a few seconds behind
 * the newest submission is acceptable. Rare, high-impact control-plane writes such as game
 * takedowns may additionally call `purgeEdgeCacheUrls`; ordinary hot-path writes must not add that
 * write amplification.
 */
export function edgeCache(options: EdgeCacheOptions): MiddlewareHandler<ApiEnv> {
  const { ttlSeconds } = options;

  return async (c, next) => {
    // Only GET is cacheable, and only when the Cache API is actually present (it is absent in
    // the plain-Node test runner, where every request must fall through to the live handler).
    if (c.req.method !== "GET" || typeof caches === "undefined") {
      await next();
      return;
    }

    const cache = (caches as unknown as CloudflareCacheStorage).default;
    const cacheKey = new Request(c.req.url, { method: "GET" });

    const cached = await cache.match(cacheKey);
    if (cached) {
      const hitHeaders = new Headers(cached.headers);
      hitHeaders.set("Cache-Control", browserCacheControl(options));
      const hit = new Response(cached.body, {
        status: cached.status,
        statusText: cached.statusText,
        headers: hitHeaders,
      });
      hit.headers.set("X-Cache", "HIT");
      return hit;
    }

    await next();

    // Only cache a clean success. A 4xx/5xx must never be pinned at the edge for the whole TTL.
    if (!c.res || c.res.status !== 200) return;

    const body = await c.res.clone().arrayBuffer();
    const storedHeaders = new Headers(c.res.headers);
    // Defense in depth: a Set-Cookie here would mean the response is user-specific after all
    // (and the Cache API rejects such responses outright). Drop it rather than poison the entry.
    storedHeaders.delete("Set-Cookie");
    storedHeaders.set("Cache-Control", `public, max-age=${ttlSeconds}, s-maxage=${ttlSeconds}`);

    const toStore = new Response(body, { status: 200, headers: storedHeaders });

    // Fill the cache without delaying the response. Hono's `executionCtx` getter *throws* when
    // no ExecutionContext is bound (it does not return undefined), which is the case in the
    // plain-Node test runner — so this is a try/catch rather than an optional chain. A failure
    // to populate the cache is never worth failing the request over: worst case is a miss.
    try {
      c.executionCtx.waitUntil(cache.put(cacheKey, toStore.clone()));
    } catch {
      // No ExecutionContext (tests) — skip caching, still return the fresh response below.
    }

    const responseHeaders = new Headers(c.res.headers);
    responseHeaders.delete("Set-Cookie");
    responseHeaders.set("Cache-Control", browserCacheControl(options));
    responseHeaders.set("X-Cache", "MISS");
    c.res = new Response(body, { status: 200, headers: responseHeaders });
  };
}

/** Best-effort active invalidation for rare control-plane writes. Cache API entries are local to
 * a Cloudflare data center, so the short edge TTL remains the global safety bound; deleting the
 * exact public keys here removes the stale response immediately for the colo handling the admin
 * mutation and pairs with browser `no-store` on mutable catalog reads. */
export async function purgeEdgeCacheUrls(urls: readonly string[]): Promise<void> {
  if (typeof caches === "undefined" || urls.length === 0) return;
  const cache = (caches as unknown as CloudflareCacheStorage).default;
  await Promise.allSettled(
    [...new Set(urls)].map((url) => cache.delete(new Request(url, { method: "GET" }))),
  );
}
