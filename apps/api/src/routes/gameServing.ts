import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import {
  BUNDLE_ENTRY_PATH,
  normalizeBundleEntryPath,
  publishedObjectKey,
  publishedVersionPrefix,
  resolveBundleContentType,
} from "@owogg/core";
import { OWOGG_BROWSER_API_SOURCE } from "@owogg/game-sdk/bridge";
import { createContainer } from "../container.js";
import { readB2Config } from "./devGames.js";
import { isLocalhost } from "./auth.js";
import type { ApiEnv } from "./auth.js";

/** What decides a served asset's browser-facing Cache-Control — computed fresh on every request
 * (see gameAssetEdgeCache below), never read off a cached entry. */
interface AssetCachePolicy {
  maxAgeSeconds: number;
  immutable: boolean;
}

interface ServableBundleFile {
  bytes: ArrayBuffer;
  contentType: string;
  contentEncoding?: string | undefined;
}

const DEFAULT_FRONTEND_URL = "https://owogg.com";

/** Same narrow local shape as middleware/edgeCache.ts's `CloudflareCacheStorage.default` — see
 * that file's comment on why this isn't a shared type (DOM's `CacheStorage` has no `.default` and
 * shadows @cloudflare/workers-types' version in this package's mixed lib set). */
interface CloudflareCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

/** One year, the conventional ceiling for `max-age`. EDGE retention only (gameAssetEdgeCache's
 * `edgeTtlSeconds` on the versioned path) — safe there because a gameId+versionId+path triple's
 * BYTES genuinely never change, a new build gets a new version id. Not used for the browser-facing
 * Cache-Control a client actually receives; see VERSIONED_ASSET_BROWSER_MAX_AGE_SECONDS for why
 * those two needed to stop being the same number. */
const IMMUTABLE_MAX_AGE_SECONDS = 31536000;

/** Browser-facing ceiling for a non-HTML versioned asset (Build/game.wasm, textures, ...). Deliberately
 * NOT the same value as the edge's own year-long retention above, and deliberately not paired with
 * `immutable` either: this is what actually sits in a *browser's* cache, and a header fix (CORS/CSP)
 * shipped after a browser already downloaded and pinned a response for a year would not reach that
 * browser until the pin expired — no amount of edge-side freshness (gameAssetEdgeCache already
 * recomputes CORS/CSP on every edge request) fixes a header a client is holding onto locally. One
 * hour bounds that window to something a real incident response can wait out, while still being a
 * meaningful win over re-validating on every request. */
const VERSIONED_ASSET_BROWSER_MAX_AGE_SECONDS = 3600;

/** How long `/play/:slug` — which resolves to whatever is *currently* live — may be cached.
 * Bounds how long a live-version switch or rollback takes to become visible. */
const LIVE_RESOLVER_MAX_AGE_SECONDS = 60;

/**
 * Public game delivery. Two routers with deliberately different cache semantics:
 *
 *   /play/:slug                          → mutable: resolves either publisher's generic current
 *                                          live version and redirects to its numeric entry point.
 *   /games/:gameId/:versionId/*          → immutable bytes: one exact generic live version's
 *                                          files, straight from object storage through Cloudflare's
 *                                          cache. D1-identified for OWOGG and USER alike.
 * Both are meant to live on their own hostname (`GAME_ORIGIN`, e.g. play.owogg.com) rather
 * than the main site's, which is what makes the iframe a real origin boundary. Neither the
 * hostname nor the frontend's is hardcoded: this file only ever reads FRONTEND_URL, for the CSP
 * that names who may frame a game.
 *
 * What this code does *not* do, and must never start doing: run game code. A response here is
 * bytes — HTML, JS, WASM, textures, audio. Every frame, physics step, and AI decision happens in
 * the player's own browser on the player's own CPU/GPU, so serving a thousand concurrent players
 * costs a thousand cached file reads rather than a thousand game processes. See
 * docs/GAME_CREATION_GUIDE.md §3.
 */
export const gameServingRouter = new Hono<ApiEnv>();
export const publishedGameAssetsRouter = new Hono<ApiEnv>();
const BROWSER_API_PATH = "/bridge/v1.js";
const BROWSER_API_TAG = '<script src="/games/bridge/v1.js" data-owogg-bridge="v1"></script>';

/**
 * Origin boundary enforcement (2026-08-17 beta hardening) — registered first on both routers, so
 * it runs before any cache lookup or DB read. This Worker also answers `api.owogg.com`, and
 * game code must never be reachable there: the whole point of a separate GAME_ORIGIN host (e.g.
 * `play.owogg.com`) is that the browser treats every game as cross-origin from the real site,
 * which only holds if the game is actually *served from* that other host.
 *
 * `GAME_ORIGIN` unset means "no game-hosting domain connected yet" — fails CLOSED for everything
 * except localhost (local dev / `wrangler dev` has no reason to set it). This is deliberate: it
 * is not acceptable for game code to be reachable through the production API host just because
 * the dedicated domain hasn't been wired up, so shipping this Worker with GAME_ORIGIN unset must
 * mean "sandbox game serving is off," not "sandbox game serving falls back to api.owogg.com."
 */
function isAllowedGameOriginHost(c: Context<ApiEnv>): boolean {
  const configured = c.env?.GAME_ORIGIN;
  if (configured) {
    try {
      return new URL(c.req.url).hostname === new URL(configured).hostname;
    } catch {
      return false; // a malformed GAME_ORIGIN must fail closed, not silently allow every host
    }
  }
  return isLocalhost(c.req.url);
}

const gameOriginHostGuard: MiddlewareHandler<ApiEnv> = async (c, next) => {
  if (!isAllowedGameOriginHost(c)) return notFound(c);
  await next();
};

gameServingRouter.use("*", gameOriginHostGuard);
publishedGameAssetsRouter.use("*", gameOriginHostGuard);

publishedGameAssetsRouter.get(BROWSER_API_PATH, (c) =>
  c.body(OWOGG_BROWSER_API_SOURCE, 200, {
    "Content-Type": "application/javascript; charset=utf-8",
    "Cache-Control": "public, max-age=300",
    "Access-Control-Allow-Origin": "*",
  }),
);

// See middleware/edgeCache.ts's safety note: caching is sound on both routers because responses
// depend only on the URL — no cookies are read, and nothing varies per viewer.
//
// The actual asset-serving route below (/:slug/:rest) uses gameAssetEdgeCache — see that
// function's doc comment for why a served game asset needs different handling on a cache HIT.
// The mutable /play/:slug redirect needs its own narrow 302 cache: the shared edgeCache defaults
// to 200-only, so the old registration never cached the resolver despite comments saying it did.
const liveResolverEdgeCache: MiddlewareHandler<ApiEnv> = async (c, next) => {
  if (c.req.method !== "GET" || typeof caches === "undefined") {
    await next();
    return;
  }

  const cache = (caches as unknown as { default: CloudflareCache }).default;
  const key = new Request(c.req.url, { method: "GET" });
  const cached = await cache.match(key);
  if (cached?.status === 302) {
    const headers = new Headers(cached.headers);
    headers.set("Cache-Control", `public, max-age=${LIVE_RESOLVER_MAX_AGE_SECONDS}`);
    headers.set("X-Cache", "HIT");
    return new Response(cached.body, { status: 302, headers });
  }

  await next();
  if (!c.res || c.res.status !== 302) return;

  const body = await c.res.clone().arrayBuffer();
  const headers = new Headers(c.res.headers);
  headers.set(
    "Cache-Control",
    `public, max-age=${LIVE_RESOLVER_MAX_AGE_SECONDS}, s-maxage=${LIVE_RESOLVER_MAX_AGE_SECONDS}`,
  );
  const stored = new Response(body, { status: 302, headers });
  try {
    c.executionCtx.waitUntil(cache.put(key, stored));
  } catch {
    // Plain-Node tests have no execution context. The fresh redirect remains valid.
  }
  c.res.headers.set("X-Cache", "MISS");
};

gameServingRouter.use("/:slug", liveResolverEdgeCache);

/**
 * Gate registered BEFORE the byte cache below — order matters. `caches.default` returns a HIT
 * without ever calling `next()`, so if the availability check lived *after* edgeCache in this
 * chain (or inside the route handler), a game an admin just made PRIVATE would keep being served
 * out of the byte cache until its year-long entry naturally expired: a takedown that silently
 * didn't take effect. Registering this middleware first means every request re-checks
 * availability — cheaply, via its own short-lived cache entry, not a fresh D1 read each time —
 * before the (genuinely immutable) byte cache is ever consulted.
 *
 * This is a separate `caches.default` entry from the byte cache, keyed on a synthetic URL that
 * only encodes gameId+versionId (not the file path), so one lookup covers every asset request for
 * that version rather than one per file.
 */
function availabilityCacheKey(gameId: number, versionId: number): Request {
  return new Request(
    `https://owogg-internal.invalid/runtime-game-availability/${gameId}/${versionId}`,
  );
}

const publishedAssetAvailabilityGate: MiddlewareHandler<ApiEnv> = async (c, next) => {
  const gameId = Number(c.req.param("gameId"));
  const versionId = Number(c.req.param("versionId"));
  if (!Number.isInteger(gameId) || !Number.isInteger(versionId) || !c.env?.DB) {
    return notFound(c);
  }

  if (typeof caches === "undefined") {
    // Plain-Node test runner — no Cache API available, so just check the DB directly every time.
    const { runtimeGameAvailability } = createContainer(c.env.DB, readB2Config(c.env));
    try {
      if (!(await runtimeGameAvailability.isVersionServable(gameId, versionId))) {
        return notFound(c);
      }
    } catch {
      return notFound(c);
    }
    await next();
    return;
  }

  const cache = (caches as unknown as { default: CloudflareCache }).default;
  const key = availabilityCacheKey(gameId, versionId);

  const cached = await cache.match(key);
  if (cached) {
    if (cached.status === 404) return notFound(c);
    await next();
    return;
  }

  const { runtimeGameAvailability } = createContainer(c.env.DB, readB2Config(c.env));
  let servable = false;
  try {
    servable = await runtimeGameAvailability.isVersionServable(gameId, versionId);
  } catch {
    servable = false;
  }
  const toStore = new Response(null, {
    status: servable ? 200 : 404,
    headers: { "Cache-Control": `public, max-age=${LIVE_RESOLVER_MAX_AGE_SECONDS}` },
  });
  try {
    c.executionCtx.waitUntil(cache.put(key, toStore));
  } catch {
    // No ExecutionContext — skip caching this fact, still enforce it below.
  }

  if (!servable) return notFound(c);
  await next();
};

publishedGameAssetsRouter.use("/:gameId/:versionId/:rest{.+}", publishedAssetAvailabilityGate);
publishedGameAssetsRouter.use(
  "/:gameId/:versionId/:rest{.+}",
  gameAssetEdgeCache({
    edgeTtlSeconds: IMMUTABLE_MAX_AGE_SECONDS,
    policyFor: versionedAssetCachePolicy,
  }),
);

/** Content-Security-Policy for a game's own document. This is the in-document half of the sandbox;
 * the other half is the `sandbox` attribute on the parent page's iframe, which a response header
 * cannot set (see apps/web/app/features/game/GameFrame.tsx).
 *
 * `connect-src 'self' blob:` permits engine loaders to fetch their own WASM/data files while still
 * preventing an uploaded game from phoning home or reaching OwOGG's separate API origin.
 * `frame-ancestors` means only the real site can frame it. */
function contentSecurityPolicy(frontendUrl: string): string {
  return [
    "default-src 'self'",
    // Engines self-host their loaders but do use inline bootstrap and WASM compilation.
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "connect-src 'self' blob:",
    `frame-ancestors ${frontendUrl}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

function isHtmlPath(path: string): boolean {
  return path.endsWith(".html") || path.endsWith(".htm");
}

/** The versioned /:gameId/:versionId/:rest path's BYTES are genuinely immutable per file (a new
 * build gets a new version id), but neither file type gets a year-long, `immutable` browser
 * Cache-Control — that value is what a *client* pins locally, and CORS/CSP living in the same
 * response as the bytes means a policy fix can't reach an already-downloaded browser until
 * whatever's pinned there expires, no matter how fresh the edge itself stays (see
 * VERSIONED_ASSET_BROWSER_MAX_AGE_SECONDS). The entry document additionally gets the same short
 * LIVE_RESOLVER_MAX_AGE_SECONDS as the mutable resolver path (not just "shorter than a year") —
 * it's the one file a player is likely to hold across sessions, so it gets the tightest bound of
 * any asset on this route. Everything else (Build/game.wasm, textures, ...) gets the full hour:
 * still a real, meaningful cache win, just no longer long enough to make a client-held policy
 * header a year-long liability. */
function versionedAssetCachePolicy(path: string): AssetCachePolicy {
  return isHtmlPath(path)
    ? { maxAgeSeconds: LIVE_RESOLVER_MAX_AGE_SECONDS, immutable: false }
    : { maxAgeSeconds: VERSIONED_ASSET_BROWSER_MAX_AGE_SECONDS, immutable: false };
}

/** The full header set for a served asset: content-describing headers the caller already has in
 * hand (Content-Type/Content-Encoding/bundle source) plus the policy headers that must always be
 * computed fresh — CORS, CSP (HTML only), and the browser-facing Cache-Control derived from
 * `policy`. Used identically whether the bytes came from a live resolve (fileResponse, below) or
 * the edge byte cache (gameAssetEdgeCache's HIT path), so the two can never drift apart. */
function assetResponseHeaders(
  path: string,
  content: { contentType: string; contentEncoding?: string | undefined; bundleSource: string },
  policy: AssetCachePolicy,
  frontendUrl: string,
): Headers {
  const headers = new Headers({
    "Content-Type": content.contentType,
    "Cache-Control": policy.immutable
      ? `public, max-age=${policy.maxAgeSeconds}, immutable${isHtmlPath(path) ? ", no-transform" : ""}`
      : `public, max-age=${policy.maxAgeSeconds}${isHtmlPath(path) ? ", no-transform" : ""}`,
    // Public, unauthenticated bundle bytes — this router never reads a cookie or session, so CORS
    // was never a confidentiality boundary here, only ever an accidental obstacle. A sandboxed
    // iframe (no allow-same-origin) sends Origin: null on its own <script type="module"> fetches,
    // and a `<script type="module">` is always CORS-checked (unlike a classic script) — wildcard
    // ACAO with NO Access-Control-Allow-Credentials lets that succeed without weakening anything:
    // the real security boundary on this content is the CSP below plus the iframe's sandbox flags
    // (see GameFrame.tsx), never same-origin policy on already-public files. Deliberately
    // NOT paired with Allow-Credentials — browsers reject that combination outright, and even if
    // they didn't, nothing on this path should ever be served with credentials attached.
    "Access-Control-Allow-Origin": "*",
  });
  if (content.contentEncoding) headers.set("Content-Encoding", content.contentEncoding);
  if (isHtmlPath(path)) {
    // Cloudflare Web Analytics' automatic setup rewrites proxied HTML by injecting its external
    // beacon. A game document intentionally rejects every remote script, so prevent that edge
    // transform instead of weakening the uploaded-game sandbox CSP to admit analytics code.
    headers.set("Content-Security-Policy", contentSecurityPolicy(frontendUrl));
  }
  // Generic serving always reads fully published bundle objects; keep the header as lightweight
  // operational provenance for cache diagnostics.
  headers.set("X-Owogg-Bundle-Source", content.bundleSource);
  return headers;
}

/** Response's BodyInit type doesn't reliably line up with Uint8Array across this package's mixed
 * DOM + @cloudflare/workers-types lib set (same class of issue as middleware/edgeCache.ts's
 * CacheStorage note), so responses are built from plain ArrayBuffers. */
function fileResponse(
  file: ServableBundleFile,
  path: string,
  policy: AssetCachePolicy,
  frontendUrl: string,
): Response {
  const headers = assetResponseHeaders(
    path,
    {
      contentType: file.contentType,
      ...(file.contentEncoding ? { contentEncoding: file.contentEncoding } : {}),
      bundleSource: "published",
    },
    policy,
    frontendUrl,
  );
  return new Response(injectOwoggBrowserApi(file.bytes, path), { status: 200, headers });
}

function injectOwoggBrowserApi(bytes: ArrayBuffer, path: string): ArrayBuffer {
  if (path !== BUNDLE_ENTRY_PATH) return bytes;
  const html = new TextDecoder().decode(bytes);
  if (html.includes('data-owogg-bridge="v1"')) return bytes;
  const lower = html.toLowerCase();
  const headClose = lower.indexOf("</head>");
  const bodyClose = lower.indexOf("</body>");
  const insertion = headClose >= 0 ? headClose : bodyClose >= 0 ? bodyClose : 0;
  return new TextEncoder().encode(
    `${html.slice(0, insertion)}${BROWSER_API_TAG}${html.slice(insertion)}`,
  ).buffer;
}

/**
 * Body-only edge cache for a served game asset. Deliberately separate from the shared
 * middleware/edgeCache.ts (untouched here — many unrelated routes depend on its existing
 * behavior) and from that middleware's habit of replaying every cached response header verbatim
 * on a HIT, which is exactly what let a stale CORS/CSP header keep being served at the edge for
 * up to a year after a policy change shipped (2026-08-18 production bug — see PR history).
 *
 * `edgeTtlSeconds` governs only how long the stored BODY entry lives at the edge — Cloudflare's
 * Cache API takes this from the stored response's own `s-maxage`, there is no separate TTL
 * parameter for `cache.put()` — and that value is NEVER sent to a real browser. Every actual
 * response this middleware returns, hit or miss, has its CORS/CSP/Cache-Control rebuilt fresh via
 * `assetResponseHeaders`, driven only by `path` (parsed straight from the request) and
 * `c.env.FRONTEND_URL` — neither needs the DB/storage read a real miss pays for. That is what
 * lets a policy header change take effect at the edge on the very next request, instead of
 * waiting out however long is left on a body-cache entry that predates the change.
 *
 * Only a clean 200 from the handler is ever stored (same guard as edgeCache.ts): a 404/5xx must
 * never be pinned at the edge.
 */
function gameAssetEdgeCache(options: {
  edgeTtlSeconds: number;
  policyFor: (path: string) => AssetCachePolicy;
}): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    if (c.req.method !== "GET" || typeof caches === "undefined") {
      await next();
      return;
    }

    const rawRest = c.req.param("rest");
    const path =
      rawRest === undefined ? null : normalizeBundleEntryPath(decodeURIComponent(rawRest));
    if (path === null) {
      // Can't determine a policy for a path that doesn't even normalize — let the route handler's
      // own validation reject it the same way it always has, uncached.
      await next();
      return;
    }

    const frontendUrl = c.env?.FRONTEND_URL || DEFAULT_FRONTEND_URL;
    const cache = (caches as unknown as { default: CloudflareCache }).default;
    const cacheKey = new Request(c.req.url, { method: "GET" });

    const cached = await cache.match(cacheKey);
    if (cached) {
      const headers = assetResponseHeaders(
        path,
        {
          contentType: cached.headers.get("Content-Type") ?? "application/octet-stream",
          ...(cached.headers.get("Content-Encoding")
            ? { contentEncoding: cached.headers.get("Content-Encoding") as string }
            : {}),
          bundleSource: cached.headers.get("X-Owogg-Bundle-Source") ?? "published",
        },
        options.policyFor(path),
        frontendUrl,
      );
      headers.set("X-Cache", "HIT");
      return new Response(injectOwoggBrowserApi(await cached.clone().arrayBuffer(), path), {
        status: 200,
        headers,
      });
    }

    await next();
    if (!c.res || c.res.status !== 200) return;

    // Store ONLY the content-describing headers alongside the body — never CORS/CSP/Cache-Control
    // — so a stale entry can never replay a policy header even if this function's own hit-path
    // logic is ever bypassed some other way.
    const body = await c.res.clone().arrayBuffer();
    const storeHeaders = new Headers();
    for (const name of ["Content-Type", "Content-Encoding", "X-Owogg-Bundle-Source"]) {
      const value = c.res.headers.get(name);
      if (value) storeHeaders.set(name, value);
    }
    // Governs only the edge's own retention (see doc comment above) — never a header a real
    // browser sees; the response returned to this request carries its own Cache-Control already,
    // set by fileResponse via the route handler that just ran.
    storeHeaders.set("Cache-Control", `public, s-maxage=${options.edgeTtlSeconds}`);
    const toStore = new Response(body, { status: 200, headers: storeHeaders });

    try {
      c.executionCtx.waitUntil(cache.put(cacheKey, toStore));
    } catch {
      // No ExecutionContext (tests) — skip caching, still return the fresh response below.
    }

    c.res.headers.set("X-Cache", "MISS");
  };
}

/** Every failure mode answers exactly the same way, so an anonymous probe can't tell an unknown
 * slug from an unreleased game from a storage outage. */
function notFound(c: Context<ApiEnv>): Response {
  return c.text("Not Found", 404);
}

// ── /play/:slug — live version resolver ──────────────────────────────────────

/**
 * Redirects to the live version's entry point rather than serving it here, because the browser's
 * base URL is what resolves a game's relative asset references. Serving index.html at
 * `/play/my-game` would make the engine request `/play/Build/game.wasm`; redirecting to
 * `/games/1/17/index.html` makes it request `/games/1/17/Build/game.wasm` — the immutable,
 * CDN-cacheable path. The Location is relative so this works unchanged whatever hostname
 * GAME_ORIGIN points at.
 */
gameServingRouter.get("/:slug", async (c) => {
  if (!c.env?.DB) return notFound(c);
  const { gameIdentityRepo, runtimeGameAvailability } = createContainer(
    c.env.DB,
    readB2Config(c.env),
  );
  try {
    const identity = await gameIdentityRepo.findBySlug(c.req.param("slug"));
    if (!identity || identity.liveVersionId === null) return notFound(c);
    if (!(await runtimeGameAvailability.isIdentityServable(identity))) {
      return notFound(c);
    }

    const target = `/${publishedVersionPrefix(identity.id, identity.liveVersionId)}${BUNDLE_ENTRY_PATH}`;
    // Explicit and short. Without a header, a 302 is subject to heuristic browser caching, which
    // could pin a player to a version an admin has already rolled back.
    c.header("Cache-Control", `public, max-age=${LIVE_RESOLVER_MAX_AGE_SECONDS}`);
    return c.redirect(target, 302);
  } catch {
    return notFound(c);
  }
});

// ── /games/:gameId/:versionId/* — immutable published assets ─────────────────

/**
 * The path a running game actually fetches from for both publishers. Nothing is decompressed or
 * recovered from a source archive here: READY is established only after manifest-last publishing,
 * and a request is one generic object read that Cloudflare can cache by exact numeric version.
 */
publishedGameAssetsRouter.get("/:gameId/:versionId/:rest{.+}", async (c) => {
  if (!c.env?.DB) return notFound(c);

  const gameId = Number(c.req.param("gameId"));
  const versionId = Number(c.req.param("versionId"));
  if (!Number.isInteger(gameId) || !Number.isInteger(versionId)) return notFound(c);

  const path = normalizeBundleEntryPath(decodeURIComponent(c.req.param("rest")));
  if (path === null) return notFound(c);

  const { gameBundleStorageRepo } = createContainer(c.env.DB, readB2Config(c.env));
  let bytes: ArrayBuffer | null;
  try {
    bytes = await gameBundleStorageRepo.getObject(publishedObjectKey(gameId, versionId, path));
  } catch {
    return notFound(c);
  }
  if (!bytes) return notFound(c);
  const { contentType, contentEncoding } = resolveBundleContentType(path);
  const file: ServableBundleFile = { bytes, contentType, contentEncoding };

  return fileResponse(
    file,
    path,
    versionedAssetCachePolicy(path),
    c.env.FRONTEND_URL || DEFAULT_FRONTEND_URL,
  );
});
