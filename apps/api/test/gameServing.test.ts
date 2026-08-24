import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8, unzipSync } from "fflate";
import { app } from "../src/index.js";

// Public game delivery: /play/:slug (mutable live-version resolver) and
// /games/:gameId/:versionId/* (immutable published assets). These drive the real Hono app with
// real zip bytes and `fetch` stubbed only at the storage boundary — the same pattern
// oauth.test.ts uses for Discord/Google — so the B2 adapter, SigV4 signing, MIME resolution,
// CSP/cache headers and 404 semantics are all exercised together rather than mocked away.
const B2_ENV = {
  B2_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
  B2_REGION: "us-west-004",
  B2_BUCKET_NAME: "owogg-game-bundles",
  B2_KEY_ID: "someKeyId",
  B2_APPLICATION_KEY: "someApplicationKey",
};

interface FakeGame {
  id: number;
  slug: string;
  publisher_type?: "OWOGG" | "USER";
  publisher_user_id?: number | null;
  visibility: "PRIVATE" | "PUBLIC";
  live_version_id: number | null;
  deleted_at?: string | null;
}
interface FakeVersion {
  id: number;
  game_id: number;
  object_key: string;
  publish_status?: "UPLOADED" | "PUBLISHING" | "READY" | "FAILED";
}

function createDb(options: { game?: FakeGame; version?: FakeVersion; disabledSlugs?: string[] }) {
  const { game, version } = options;
  function statement(query: string) {
    let values: unknown[] = [];
    return {
      bind(...bound: unknown[]) {
        values = bound;
        return this;
      },
      async first<T>() {
        const wantsGameBySlug = query.includes("FROM games WHERE slug");
        const wantsGameById = query.includes("FROM games WHERE id");
        if (wantsGameBySlug || wantsGameById) {
          const matches = wantsGameBySlug ? game?.slug === values[0] : game?.id === values[0];
          if (!game || !matches) return null;
          return {
            id: game.id,
            slug: game.slug,
            publisher_type: game.publisher_type ?? "USER",
            publisher_user_id:
              game.publisher_type === "OWOGG" ? null : (game.publisher_user_id ?? 1),
            visibility: game.visibility,
            live_version_id: game.live_version_id,
            deleted_at: game.deleted_at ?? null,
            created_at: "2026-08-21T00:00:00.000Z",
            updated_at: "2026-08-21T00:00:00.000Z",
          } as T;
        }
        if (query.includes("FROM game_versions WHERE id")) {
          if (!version || version.id !== values[0]) return null;
          return {
            id: version.id,
            game_id: version.game_id,
            object_key: version.object_key,
            content_hash: "fakehash",
            bundle_bytes: 123,
            publish_status: version.publish_status ?? "READY",
            publish_error: null,
            published_at: "2026-08-21T00:00:00.000Z",
            manifest_key: `games/${version.game_id}/${version.id}/.owogg-manifest.json`,
            published_size_bytes: 456,
            file_count: 2,
            uploaded_at: "2026-08-21T00:00:00.000Z",
          } as T;
        }
        return null;
      },
      async all<T>() {
        if (query.includes("FROM game_settings WHERE enabled = 0")) {
          return {
            results: (options.disabledSlugs ?? []).map((game_id) => ({ game_id })) as T[],
          };
        }
        return { results: [] } as { results: T[] };
      },
      async run() {
        return { success: true, meta: { changes: 0 } };
      },
    };
  }

  return {
    db: {
      prepare(query: string) {
        return statement(query);
      },
      async batch(statements: Array<ReturnType<typeof statement>>) {
        return statements.map(() => ({ success: true, meta: { changes: 0 } }));
      },
    },
  };
}

const LIVE_GAME: FakeGame = { id: 1, slug: "live-game", visibility: "PUBLIC", live_version_id: 17 };
const LIVE_VERSION: FakeVersion = { id: 17, game_id: 1, object_key: "uploads/1/abc.zip" };

const BUNDLE = {
  "index.html": strToU8("<h1>hi</h1>"),
  "Build/game.wasm": strToU8("\0asm fake"),
  "assets/logo.png": strToU8("PNG-ish"),
};

/**
 * Stands in for object storage. Serves published objects out of `stored`, and answers a GET for the
 * source archive key with real zip bytes — so a test can delete a published object and watch the
 * archive fallback take over, exactly as it would in production.
 */
function createStorageStub(options: { stored?: Record<string, Uint8Array>; archive?: Uint8Array }) {
  const stored = new Map(Object.entries(options.stored ?? {}));
  const originalFetch = globalThis.fetch;
  const requestedKeys: string[] = [];

  globalThis.fetch = (async (input: URL | RequestInfo | string) => {
    // aws4fetch signs and then calls fetch with a Request, whose toString() is "[object Request]" —
    // so the URL has to be read off `.url` rather than stringified.
    const href =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    const url = new URL(href);
    // Everything after /<bucket>/ is the object key.
    const key = decodeURIComponent(url.pathname.split("/").slice(2).join("/"));
    requestedKeys.push(key);

    if (key.startsWith("uploads/") && options.archive) {
      return new Response(options.archive, { status: 200 });
    }
    const found = stored.get(key);
    if (!found) return new Response("not found", { status: 404 });
    return new Response(found, { status: 200 });
  }) as unknown as typeof fetch;

  return {
    requestedKeys,
    remove(key: string) {
      stored.delete(key);
    },
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

/** Published objects as the publish pipeline would have written them for game 1 / version 17. */
function canonicalDocument(slug: string): Uint8Array {
  return strToU8(
    JSON.stringify({
      schemaVersion: 1,
      slug,
      title: "Test Game",
      shortDescription: "Test game short",
      description: "Test game description",
      policy: { score: null, leaderboard: false, xpPerCompletion: 0, requiresAuth: false },
      supportsReplay: false,
      catalog: { type: "GENRE_MODE", genre: "puzzle", mode: "single" },
      updatedAt: "2026-08-21T00:00:00.000Z",
    }),
  );
}

function publishedObjects(
  game: FakeGame = LIVE_GAME,
  version: FakeVersion = LIVE_VERSION,
): Record<string, Uint8Array> {
  return {
    [`game-definitions/${game.slug}/definition.json`]: canonicalDocument(game.slug),
    [`games/${game.id}/${version.id}/.owogg-manifest.json`]: strToU8(
      JSON.stringify({
        gameId: game.id,
        versionId: version.id,
        contentHash: "fakehash",
        entry: "index.html",
        fileCount: 3,
        totalSize: 20,
        publishedAt: "2026-08-21T00:00:00.000Z",
        files: [],
      }),
    ),
    [`games/${game.id}/${version.id}/index.html`]: BUNDLE["index.html"],
    [`games/${game.id}/${version.id}/Build/game.wasm`]: BUNDLE["Build/game.wasm"],
    [`games/${game.id}/${version.id}/assets/logo.png`]: BUNDLE["assets/logo.png"],
  };
}

async function withStorage<T>(
  options: { stored?: Record<string, Uint8Array>; archive?: Uint8Array },
  run: (stub: ReturnType<typeof createStorageStub>) => Promise<T>,
): Promise<T> {
  const stub = createStorageStub(options);
  try {
    return await run(stub);
  } finally {
    stub.restore();
  }
}

// ── /play/:slug — live version resolution ────────────────────────────────────

test("GET /play/:slug redirects to the live version's immutable versioned entry point", async () => {
  const { db } = createDb({ game: LIVE_GAME, version: LIVE_VERSION });
  const res = await withStorage({ stored: publishedObjects() }, () =>
    app.request("/play/live-game", {}, { DB: db, ...B2_ENV } as any),
  );

  assert.equal(res.status, 302);
  assert.equal(res.headers.get("Location"), "/games/1/17/index.html");
});

test("the /play/:slug redirect is only briefly cacheable, so a rollback can't stay pinned", async () => {
  const { db } = createDb({ game: LIVE_GAME, version: LIVE_VERSION });
  const res = await withStorage({ stored: publishedObjects() }, () =>
    app.request("/play/live-game", {}, { DB: db, ...B2_ENV } as any),
  );

  const cacheControl = res.headers.get("Cache-Control") ?? "";
  assert.equal(cacheControl, "public, max-age=60");
  assert.ok(!cacheControl.includes("immutable"));
});

test("GET /play/:slug returns 404 for an unknown slug", async () => {
  const { db } = createDb({});
  const res = await app.request("/play/no-such-game", {}, { DB: db, ...B2_ENV } as any);
  assert.equal(res.status, 404);
});

test("GET /play/:slug returns 404 for a PRIVATE game, indistinguishable from one that doesn't exist", async () => {
  const { db } = createDb({
    game: { id: 1, slug: "secret-game", visibility: "PRIVATE", live_version_id: null },
  });
  const res = await app.request("/play/secret-game", {}, { DB: db, ...B2_ENV } as any);
  assert.equal(res.status, 404);

  const unknown = await app.request("/play/no-such-game", {}, { DB: db, ...B2_ENV } as any);
  assert.equal(unknown.status, res.status);
  assert.equal(await unknown.text(), await res.text());
});

test("GET /play/:slug returns 404 for a PUBLIC game with no live version", async () => {
  const { db } = createDb({
    game: { id: 1, slug: "live-game", visibility: "PUBLIC", live_version_id: null },
  });
  const res = await app.request("/play/live-game", {}, { DB: db, ...B2_ENV } as any);
  assert.equal(res.status, 404);
});

test("GET /play resolves an OWOGG game through the same generic numeric path as USER", async () => {
  const official: FakeGame = {
    id: 9,
    slug: "reaction-time",
    publisher_type: "OWOGG",
    publisher_user_id: null,
    visibility: "PUBLIC",
    live_version_id: 5,
  };
  const officialVersion: FakeVersion = {
    id: 5,
    game_id: 9,
    object_key: "uploads/9/hash.zip",
  };
  const { db } = createDb({ game: official, version: officialVersion });
  const res = await withStorage({ stored: publishedObjects(official, officialVersion) }, () =>
    app.request("/play/reaction-time", {}, { DB: db, ...B2_ENV } as any),
  );

  assert.equal(res.status, 302);
  assert.equal(res.headers.get("Location"), "/games/9/5/index.html");
});

// ── /games/:gameId/:versionId/* — immutable published assets ─────────────────

test("GET /games/:gameId/:versionId/index.html serves the published entry document with a CSP", async () => {
  const { db } = createDb({ game: LIVE_GAME, version: LIVE_VERSION });
  const res = await withStorage({ stored: publishedObjects() }, () =>
    app.request("/games/1/17/index.html", {}, {
      DB: db,
      ...B2_ENV,
      FRONTEND_URL: "https://www.owogg.com",
    } as any),
  );

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "text/html; charset=utf-8");
  assert.equal(res.headers.get("X-Owogg-Bundle-Source"), "published");
  const html = await res.text();
  assert.match(html, /<script src="\/games\/bridge\/v1\.js" data-owogg-bridge="v1"><\/script>/);
  assert.match(html, /<h1>hi<\/h1>/);

  const csp = res.headers.get("Content-Security-Policy") ?? "";
  assert.match(csp, /connect-src 'self' blob:/);
  assert.match(csp, /frame-ancestors https:\/\/www\.owogg\.com/);
});

test("the CSP's frame-ancestors comes from FRONTEND_URL, with no hardcoded host", async () => {
  const { db } = createDb({ game: LIVE_GAME, version: LIVE_VERSION });
  const res = await withStorage({ stored: publishedObjects() }, () =>
    app.request("/games/1/17/index.html", {}, {
      DB: db,
      ...B2_ENV,
      FRONTEND_URL: "https://staging.example.test",
    } as any),
  );

  const csp = res.headers.get("Content-Security-Policy") ?? "";
  assert.match(csp, /frame-ancestors https:\/\/staging\.example\.test/);
  assert.ok(!csp.includes("owogg.com"), "must not fall back to a hardcoded production host");
});

/**
 * The CSP is the in-document half of the sandbox (the iframe `sandbox` attribute is the other —
 * see apps/web/app/test/gameFrameSecurity.test.ts). The tests above cover the two directives that
 * were most obviously load-bearing; this one pins the whole set, because every directive here is
 * doing a specific job and a partial policy would still look "present" to a reviewer:
 * `connect-src 'self' blob:` lets an engine load its own WASM/data but no remote origin,
 * `base-uri`/`form-action 'none'` close the two ways a document can redirect where its own
 * requests go without ever issuing a fetch, and `frame-ancestors` stops a third-party page from
 * embedding a game as bait.
 */
test("the served CSP carries every directive the sandbox depends on, not just connect-src", async () => {
  const { db } = createDb({ game: LIVE_GAME, version: LIVE_VERSION });
  const res = await withStorage({ stored: publishedObjects() }, () =>
    app.request("/games/1/17/index.html", {}, {
      DB: db,
      ...B2_ENV,
      FRONTEND_URL: "https://www.owogg.com",
    } as any),
  );

  const csp = res.headers.get("Content-Security-Policy") ?? "";
  for (const directive of [
    "default-src 'self'",
    "connect-src 'self' blob:",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors https://www.owogg.com",
  ]) {
    assert.ok(csp.includes(directive), `missing directive: ${directive}`);
  }
});

test("the CSP permits same-origin engine assets but no remote connect origin", async () => {
  const { db } = createDb({ game: LIVE_GAME, version: LIVE_VERSION });
  const res = await withStorage({ stored: publishedObjects() }, () =>
    app.request("/games/1/17/index.html", {}, { DB: db, ...B2_ENV } as any),
  );

  const csp = res.headers.get("Content-Security-Policy") ?? "";
  const connectSrc = csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("connect-src"));

  assert.equal(connectSrc, "connect-src 'self' blob:");
});

// ── CORS on public bundle assets (2026-08-18 sandbox-iframe CORS bug) ────────
//
// A sandboxed game iframe (no allow-same-origin — see GameFrame.tsx) sends `Origin: null`
// on its own same-document requests, including <script type="module"> fetches, which are always
// CORS-checked by the browser (unlike a classic script). These routes are public, cookie-free
// bytes — CORS was never a confidentiality boundary here — so fileResponse answers with a plain
// wildcard, deliberately never paired with Access-Control-Allow-Credentials. This is a separate,
// narrower policy from the API's credentialed app.use("/api/*", cors(...)) in index.ts — see
// cors.test.ts for the assertion that that middleware no longer reaches these routes at all.

test("a published asset response carries a wildcard Access-Control-Allow-Origin, matching an Origin: null module-script fetch", async () => {
  const { db } = createDb({ game: LIVE_GAME, version: LIVE_VERSION });
  const res = await withStorage({ stored: publishedObjects() }, () =>
    app.request("/games/1/17/Build/game.wasm", { headers: { Origin: "null" } }, {
      DB: db,
      ...B2_ENV,
    } as any),
  );

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
});

test("a published asset response never carries Access-Control-Allow-Credentials alongside the wildcard", async () => {
  const { db } = createDb({ game: LIVE_GAME, version: LIVE_VERSION });
  const res = await withStorage({ stored: publishedObjects() }, () =>
    app.request("/games/1/17/index.html", {}, { DB: db, ...B2_ENV } as any),
  );

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal(res.headers.get("Access-Control-Allow-Credentials"), null);
});

test("a non-HTML asset carries no CSP — the policy belongs to the document, not the bytes", async () => {
  const { db } = createDb({ game: LIVE_GAME, version: LIVE_VERSION });
  const res = await withStorage({ stored: publishedObjects() }, () =>
    app.request("/games/1/17/Build/game.wasm", {}, { DB: db, ...B2_ENV } as any),
  );

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Security-Policy"), null);
});

test("GET a published .wasm asset serves application/wasm with an hour-long, non-immutable browser cache", async () => {
  // NOT the edge's own year-long retention (gameAssetEdgeCache's edgeTtlSeconds, never sent to a
  // client — see gameServing.ts's VERSIONED_ASSET_BROWSER_MAX_AGE_SECONDS doc comment): a
  // year-long, `immutable` response is what a *browser* pins locally, and CORS/CSP living in that
  // same response means a policy fix can't reach an already-downloaded browser until the pin
  // expires. One hour bounds that to something a real incident response can wait out.
  const { db } = createDb({ game: LIVE_GAME, version: LIVE_VERSION });
  const res = await withStorage({ stored: publishedObjects() }, () =>
    app.request("/games/1/17/Build/game.wasm", {}, { DB: db, ...B2_ENV } as any),
  );

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "application/wasm");
  assert.equal(res.headers.get("Cache-Control"), "public, max-age=3600");
  // A non-document response carries no CSP — the policy only applies to the game's own document.
  assert.equal(res.headers.get("Content-Security-Policy"), null);
});

test("the entry document is deliberately NOT immutable-cached, so headers stay changeable", async () => {
  const { db } = createDb({ game: LIVE_GAME, version: LIVE_VERSION });
  const res = await withStorage({ stored: publishedObjects() }, () =>
    app.request("/games/1/17/index.html", {}, { DB: db, ...B2_ENV } as any),
  );

  const cacheControl = res.headers.get("Cache-Control") ?? "";
  assert.ok(!cacheControl.includes("immutable"), cacheControl);
});

test("serving a published asset reads exactly one object and never the source archive", async () => {
  const { db } = createDb({ game: LIVE_GAME, version: LIVE_VERSION });
  const stub = createStorageStub({ stored: publishedObjects() });
  try {
    const res = await app.request("/games/1/17/assets/logo.png", {}, { DB: db, ...B2_ENV } as any);
    assert.equal(res.status, 200);
    assert.deepEqual(stub.requestedKeys, ["games/1/17/assets/logo.png"]);
  } finally {
    stub.restore();
  }
});

test("a missing generic published object fails closed without a source-archive fallback", async () => {
  const { db } = createDb({ game: LIVE_GAME, version: LIVE_VERSION });
  const archive = zipSync(BUNDLE);
  const stored = publishedObjects();
  delete stored["games/1/17/index.html"];

  const res = await withStorage({ stored, archive }, () =>
    app.request("/games/1/17/index.html", {}, { DB: db, ...B2_ENV } as any),
  );

  assert.equal(res.status, 404);
});

test("a version that is not READY is denied even when partial published objects exist", async () => {
  const { db } = createDb({
    game: LIVE_GAME,
    version: { ...LIVE_VERSION, publish_status: "PUBLISHING" },
  });
  // Publish-time objects exist (a half-finished publish wrote them) but must be ignored.
  const stub = createStorageStub({ stored: publishedObjects() });
  try {
    const res = await app.request("/games/1/17/index.html", {}, { DB: db, ...B2_ENV } as any);
    assert.equal(res.status, 404);
    assert.ok(
      !stub.requestedKeys.some((k) => k.startsWith("games/")),
      "a PUBLISHING version's published objects must not be trusted",
    );
  } finally {
    stub.restore();
  }
});

test("GET a published asset of a PRIVATE game returns 404", async () => {
  const { db } = createDb({
    game: { ...LIVE_GAME, visibility: "PRIVATE", live_version_id: null },
    version: LIVE_VERSION,
  });
  const res = await withStorage({ stored: publishedObjects() }, () =>
    app.request("/games/1/17/index.html", {}, { DB: db, ...B2_ENV } as any),
  );
  assert.equal(res.status, 404);
});

test("the exact generic asset path serves OWOGG publisher bytes from the numeric layout", async () => {
  const official: FakeGame = {
    id: 9,
    slug: "reaction-time",
    publisher_type: "OWOGG",
    publisher_user_id: null,
    visibility: "PUBLIC",
    live_version_id: 5,
  };
  const officialVersion: FakeVersion = {
    id: 5,
    game_id: 9,
    object_key: "uploads/9/hash.zip",
  };
  const { db } = createDb({ game: official, version: officialVersion });
  const res = await withStorage({ stored: publishedObjects(official, officialVersion) }, () =>
    app.request("/games/9/5/index.html", {}, { DB: db, ...B2_ENV } as any),
  );

  assert.equal(res.status, 200);
  assert.match(await res.text(), /data-owogg-bridge="v1"/);
});

test("the injected browser API script is served on the game origin without DB or B2 access", async () => {
  const res = await app.request("/games/bridge/v1.js", {}, { ...B2_ENV } as any);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("Content-Type") ?? "", /application\/javascript/);
  const source = await res.text();
  assert.match(source, /window\.OWOGG/);
  assert.match(source, /GAME_COMPLETE/);
});

test("non-live, wrong-owner, and kill-switch-disabled exact versions are denied", async () => {
  const nonLiveDb = createDb({
    game: { ...LIVE_GAME, live_version_id: 18 },
    version: LIVE_VERSION,
  }).db;
  const wrongOwnerDb = createDb({
    game: LIVE_GAME,
    version: { ...LIVE_VERSION, game_id: 2 },
  }).db;
  const disabledDb = createDb({
    game: LIVE_GAME,
    version: LIVE_VERSION,
    disabledSlugs: [LIVE_GAME.slug],
  }).db;

  for (const db of [nonLiveDb, wrongOwnerDb, disabledDb]) {
    const res = await withStorage({ stored: publishedObjects() }, () =>
      app.request("/games/1/17/index.html", {}, { DB: db, ...B2_ENV } as any),
    );
    assert.equal(res.status, 404);
  }
});

test("GET a published asset of a generic version that is not READY returns 404", async () => {
  const { db } = createDb({
    game: LIVE_GAME,
    version: { ...LIVE_VERSION, publish_status: "UPLOADED" },
  });
  const res = await withStorage({ stored: publishedObjects() }, () =>
    app.request("/games/1/17/index.html", {}, { DB: db, ...B2_ENV } as any),
  );
  assert.equal(res.status, 404);
});

test("GET a file that isn't in the bundle returns 404", async () => {
  const { db } = createDb({ game: LIVE_GAME, version: LIVE_VERSION });
  const res = await withStorage({ stored: publishedObjects(), archive: zipSync(BUNDLE) }, () =>
    app.request("/games/1/17/does-not-exist.js", {}, { DB: db, ...B2_ENV } as any),
  );
  assert.equal(res.status, 404);
});

test("a traversal attempt in the asset path is rejected before any storage read", async () => {
  const { db } = createDb({ game: LIVE_GAME, version: LIVE_VERSION });
  const stub = createStorageStub({ stored: publishedObjects() });
  try {
    const res = await app.request("/games/1/17/..%2F..%2F18%2Findex.html", {}, {
      DB: db,
      ...B2_ENV,
    } as any);
    assert.equal(res.status, 404);
    assert.deepEqual(stub.requestedKeys, []);
  } finally {
    stub.restore();
  }
});

test("a non-numeric gameId/versionId is rejected without touching storage", async () => {
  const { db } = createDb({ game: LIVE_GAME, version: LIVE_VERSION });
  const stub = createStorageStub({ stored: publishedObjects() });
  try {
    const res = await app.request("/games/abc/xyz/index.html", {}, { DB: db, ...B2_ENV } as any);
    assert.equal(res.status, 404);
    assert.deepEqual(stub.requestedKeys, []);
  } finally {
    stub.restore();
  }
});

test("published-asset serving fails safe to 404 when B2 is not configured", async () => {
  const { db } = createDb({ game: LIVE_GAME, version: LIVE_VERSION });
  const res = await app.request("/games/1/17/index.html", {}, { DB: db } as any); // no B2_* vars
  assert.equal(res.status, 404);
});

test("/play/:slug resolves from D1 without paying a canonical B2 read", async () => {
  const { db } = createDb({ game: LIVE_GAME, version: LIVE_VERSION });
  // The host already resolved the strict public canonical before exposing PLAY. This redirect only
  // maps a validated D1 live version to immutable bytes; the byte route still fails closed below
  // when object storage itself is unavailable.
  const res = await app.request("/play/live-game", {}, { DB: db } as any);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("Location"), "/games/1/17/index.html");
});

test("removed slug-relative and official asset routes stay unavailable", async () => {
  const { db } = createDb({ game: LIVE_GAME, version: LIVE_VERSION });
  const stub = createStorageStub({ stored: publishedObjects() });
  try {
    const slugRelative = await app.request("/play/live-game/Build/game.wasm", {}, {
      DB: db,
      ...B2_ENV,
    } as any);
    const official = await app.request("/official-games/reaction-time/legacy-hash/index.html", {}, {
      DB: db,
      ...B2_ENV,
    } as any);

    assert.equal(slugRelative.status, 404);
    assert.equal(official.status, 404);
    assert.deepEqual(stub.requestedKeys, []);
  } finally {
    stub.restore();
  }
});

// ── the source archive really is a normal zip the publisher can read ────────

test("a zip built the way the guide describes round-trips through fflate with its paths intact", () => {
  const archive = zipSync({ "MyGame/index.html": strToU8("<h1>wrapped</h1>") });
  const entries = unzipSync(archive);
  assert.deepEqual(Object.keys(entries), ["MyGame/index.html"]);
});

// ── availability gate vs. the byte cache (2026-08-17 beta hardening) ─────────
//
// caches.default is absent in the plain-Node test runner (see middleware/edgeCache.ts's own
// comment), so these tests polyfill a minimal in-memory version of it — the only way to actually
// exercise "does a cache HIT skip the DB check" rather than just asserting on code structure. A
// fake ExecutionContext is supplied too: Hono's `c.executionCtx` getter throws when unbound, which
// both edgeCache and the availability gate treat as "skip caching this write" — without a real
// executionCtx, nothing would ever be written to the fake cache and the test would prove nothing.

class FakeCache {
  store = new Map<string, Response>();
  async match(request: Request) {
    return this.store.get(request.url)?.clone();
  }
  async put(request: Request, response: Response) {
    this.store.set(request.url, response.clone());
  }
}

const fakeExecutionCtx = {
  waitUntil: (promise: Promise<unknown>) => void promise,
  passThroughOnException: () => {},
};

function withFakeCaches<T>(run: () => Promise<T>): Promise<T> {
  const original = (globalThis as { caches?: unknown }).caches;
  (globalThis as { caches?: unknown }).caches = { default: new FakeCache() };
  return run().finally(() => {
    (globalThis as { caches?: unknown }).caches = original;
  });
}

test("the live resolver caches its 302 so a second game start does not repeat D1 reads", async () => {
  let dbReads = 0;
  const { db: rawDb } = createDb({ game: LIVE_GAME, version: LIVE_VERSION });
  const db = {
    ...rawDb,
    prepare(query: string) {
      if (
        query.includes("FROM games") ||
        query.includes("FROM game_versions") ||
        query.includes("FROM game_settings")
      ) {
        dbReads += 1;
      }
      return rawDb.prepare(query);
    },
  };

  await withFakeCaches(async () => {
    const first = await app.request(
      "/play/live-game",
      {},
      { DB: db } as any,
      fakeExecutionCtx as any,
    );
    const readsAfterFirst = dbReads;
    assert.equal(first.status, 302);
    assert.equal(first.headers.get("X-Cache"), "MISS");
    assert.ok(readsAfterFirst > 0);

    const second = await app.request(
      "/play/live-game",
      {},
      { DB: db } as any,
      fakeExecutionCtx as any,
    );
    assert.equal(second.status, 302);
    assert.equal(second.headers.get("Location"), "/games/1/17/index.html");
    assert.equal(second.headers.get("X-Cache"), "HIT");
    assert.equal(dbReads, readsAfterFirst);
  });
});

test("a PUBLIC→PRIVATE takedown is enforced even though the byte cache would otherwise still have the answer", async () => {
  // A mutable copy — flipped mid-test to simulate an admin's takedown between two requests to the
  // exact same URL.
  const game: typeof LIVE_GAME = { ...LIVE_GAME };
  const { db } = createDb({ game, version: LIVE_VERSION });

  await withFakeCaches(async () => {
    const first = await withStorage({ stored: publishedObjects() }, () =>
      app.request(
        "/games/1/17/index.html",
        {},
        { DB: db, ...B2_ENV } as any,
        fakeExecutionCtx as any,
      ),
    );
    assert.equal(first.status, 200, "sanity check: the game is genuinely PUBLIC at this point");

    // Admin takedown.
    game.visibility = "PRIVATE";

    // Simulates the availability gate's own short-TTL cache entry having expired (its whole
    // reason for existing is that this happens within ~60s) — the byte-cache entry from the first
    // request is deliberately left in place, since real immutable asset bytes are NOT expected to
    // be evicted on this timescale. If the gate weren't consulted first, the still-warm byte cache
    // would serve this 200 forever regardless of the takedown.
    const cache = (
      (globalThis as { caches?: { default: FakeCache } }).caches as {
        default: FakeCache;
      }
    ).default;
    for (const url of [...cache.store.keys()]) {
      if (url.includes("runtime-game-availability")) cache.store.delete(url);
    }

    const second = await withStorage({ stored: publishedObjects() }, () =>
      app.request(
        "/games/1/17/index.html",
        {},
        { DB: db, ...B2_ENV } as any,
        fakeExecutionCtx as any,
      ),
    );
    assert.equal(
      second.status,
      404,
      "the takedown must be enforced, not shadowed by the byte cache",
    );
  });
});

test("within the availability window, a second request to the same URL is served from cache without a fresh DB read", async () => {
  const game: typeof LIVE_GAME = { ...LIVE_GAME };
  let dbReads = 0;
  const { db: rawDb } = createDb({ game, version: LIVE_VERSION });
  const db = {
    ...rawDb,
    prepare(query: string) {
      if (query.includes("FROM games") || query.includes("FROM game_versions")) {
        dbReads++;
      }
      return rawDb.prepare(query);
    },
  };

  await withFakeCaches(async () => {
    await withStorage({ stored: publishedObjects() }, () =>
      app.request(
        "/games/1/17/index.html",
        {},
        { DB: db, ...B2_ENV } as any,
        fakeExecutionCtx as any,
      ),
    );
    const readsAfterFirst = dbReads;
    assert.ok(readsAfterFirst > 0);

    const second = await withStorage({ stored: publishedObjects() }, () =>
      app.request(
        "/games/1/17/index.html",
        {},
        { DB: db, ...B2_ENV } as any,
        fakeExecutionCtx as any,
      ),
    );
    assert.equal(second.status, 200);
    assert.equal(dbReads, readsAfterFirst, "a cached availability/byte HIT must not re-touch D1");
  });
});

// ── byte cache vs. serving policy headers (2026-08-18 policy-header staleness fix) ───────────
//
// The byte cache (this section) and the policy headers (CORS/CSP/browser Cache-Control) it used
// to carry along for the ride are now two separate concerns — see gameServing.ts's
// gameAssetEdgeCache doc comment. These tests pin that split down directly, not just via "the
// current headers happen to be right" (every other test in this file already implicitly checks
// that on whichever code path it exercises) but by proving a *stale* cached entry specifically
// cannot leak its own headers into a live response.

test("a cache entry carrying stale/wrong policy headers is never replayed — CORS/CSP are rebuilt fresh on every HIT", async () => {
  const { db } = createDb({ game: LIVE_GAME, version: LIVE_VERSION });

  await withFakeCaches(async () => {
    const first = await withStorage({ stored: publishedObjects() }, () =>
      app.request(
        "/games/1/17/index.html",
        {},
        { DB: db, ...B2_ENV, FRONTEND_URL: "https://www.owogg.com" } as any,
        fakeExecutionCtx as any,
      ),
    );
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("Access-Control-Allow-Origin"), "*");

    // Overwrite the byte-cache entry to look exactly like what the OLD, pre-fix caching used to
    // store: the full original response headers, verbatim — including a deliberately WRONG CORS
    // origin and an outdated CSP. This is the shape a real edge entry written before this fix
    // shipped would still have, sitting there for however long is left on its own TTL.
    const cache = (
      (globalThis as { caches?: { default: FakeCache } }).caches as { default: FakeCache }
    ).default;
    const [key] = [...cache.store.keys()].filter((k) => k.includes("/games/1/17/index.html"));
    assert.ok(key, "expected the byte-cache entry to exist after the first request");
    const staleBody = await cache.store.get(key)!.clone().arrayBuffer();
    cache.store.set(
      key,
      new Response(staleBody, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Access-Control-Allow-Origin": "https://evil.example",
          "Content-Security-Policy": "default-src 'none'",
        },
      }),
    );

    const second = await withStorage({ stored: publishedObjects() }, () =>
      app.request(
        "/games/1/17/index.html",
        {},
        { DB: db, ...B2_ENV, FRONTEND_URL: "https://www.owogg.com" } as any,
        fakeExecutionCtx as any,
      ),
    );

    assert.equal(second.status, 200);
    assert.equal(
      second.headers.get("Access-Control-Allow-Origin"),
      "*",
      "must not replay the stale entry's wrong ACAO",
    );
    assert.equal(second.headers.get("Access-Control-Allow-Credentials"), null);
    const csp = second.headers.get("Content-Security-Policy") ?? "";
    assert.match(csp, /frame-ancestors https:\/\/www\.owogg\.com/);
    assert.ok(!csp.includes("default-src 'none'"), "must not replay the stale entry's CSP");
  });
});

test("a cache HIT reuses the cached body byte-for-byte, without touching storage again", async () => {
  const { db } = createDb({ game: LIVE_GAME, version: LIVE_VERSION });

  await withFakeCaches(async () => {
    const stub1 = createStorageStub({ stored: publishedObjects() });
    let first: Response;
    try {
      first = await app.request(
        "/games/1/17/Build/game.wasm",
        {},
        { DB: db, ...B2_ENV } as any,
        fakeExecutionCtx as any,
      );
    } finally {
      stub1.restore();
    }
    assert.equal(first.status, 200);
    const firstBody = new Uint8Array(await first.arrayBuffer());

    // Deliberately empty storage for the second request — if the HIT below turned out to still
    // need a storage read, it would 404 (no object) or fall through to a source-archive read that
    // also fails, not silently succeed with the right bytes anyway.
    const stub2 = createStorageStub({});
    let second: Response;
    try {
      second = await app.request(
        "/games/1/17/Build/game.wasm",
        {},
        { DB: db, ...B2_ENV } as any,
        fakeExecutionCtx as any,
      );
    } finally {
      stub2.restore();
    }

    assert.equal(second.status, 200, "a HIT must not need storage — this stub has nothing stored");
    assert.deepEqual(stub2.requestedKeys, [], "storage must not be touched again on a cache HIT");
    const secondBody = new Uint8Array(await second.arrayBuffer());
    assert.deepEqual(secondBody, firstBody);
  });
});

test("the edge holds a versioned non-HTML asset for a year, but every client response — hit or miss — stays capped at an hour", async () => {
  const { db } = createDb({ game: LIVE_GAME, version: LIVE_VERSION });

  await withFakeCaches(async () => {
    const first = await withStorage({ stored: publishedObjects() }, () =>
      app.request(
        "/games/1/17/Build/game.wasm",
        {},
        { DB: db, ...B2_ENV } as any,
        fakeExecutionCtx as any,
      ),
    );
    assert.equal(first.status, 200);
    assert.equal(
      first.headers.get("Cache-Control"),
      "public, max-age=3600",
      "the client-facing response on the very first (MISS) request",
    );

    // The edge's OWN internal retention is the much longer value — never sent to a client, only
    // ever the header on what cache.put() actually stored.
    const cache = (
      (globalThis as { caches?: { default: FakeCache } }).caches as { default: FakeCache }
    ).default;
    const [key] = [...cache.store.keys()].filter((k) => k.includes("/games/1/17/Build/game.wasm"));
    assert.ok(key, "expected the byte-cache entry to exist after the first request");
    const storedCacheControl = cache.store.get(key)!.headers.get("Cache-Control") ?? "";
    assert.match(storedCacheControl, /s-maxage=31536000/);
    assert.ok(
      !storedCacheControl.includes("max-age=3600"),
      "the stored entry's own retention must not be the short client-facing value",
    );

    const second = await withStorage({ stored: publishedObjects() }, () =>
      app.request(
        "/games/1/17/Build/game.wasm",
        {},
        { DB: db, ...B2_ENV } as any,
        fakeExecutionCtx as any,
      ),
    );
    assert.equal(second.status, 200);
    assert.equal(
      second.headers.get("Cache-Control"),
      "public, max-age=3600",
      "a cache HIT must return the same short client-facing Cache-Control as a MISS, not the edge's own long retention",
    );
  });
});

// ── production origin enforcement (2026-08-17 beta hardening) ────────────────
//
// api.owogg.com must never serve sandbox UGC — the whole point of a separate GAME_ORIGIN host is
// that the browser treats an uploaded game as cross-origin from the real site.

test("api.owogg.com is blocked from serving published assets when GAME_ORIGIN is unset", async () => {
  const { db } = createDb({ game: LIVE_GAME, version: LIVE_VERSION });
  const res = await withStorage({ stored: publishedObjects() }, () =>
    app.request("https://api.owogg.com/games/1/17/index.html", {}, { DB: db, ...B2_ENV } as any),
  );
  assert.equal(res.status, 404);
});

test("api.owogg.com is blocked even when GAME_ORIGIN is configured to a different host", async () => {
  const { db } = createDb({ game: LIVE_GAME, version: LIVE_VERSION });
  const res = await withStorage({ stored: publishedObjects() }, () =>
    app.request("https://api.owogg.com/games/1/17/index.html", {}, {
      DB: db,
      ...B2_ENV,
      GAME_ORIGIN: "https://play.owogg.com",
    } as any),
  );
  assert.equal(res.status, 404);
});

test("the configured GAME_ORIGIN host is allowed to serve published assets", async () => {
  const { db } = createDb({ game: LIVE_GAME, version: LIVE_VERSION });
  const res = await withStorage({ stored: publishedObjects() }, () =>
    app.request("https://play.owogg.com/games/1/17/index.html", {}, {
      DB: db,
      ...B2_ENV,
      GAME_ORIGIN: "https://play.owogg.com",
    } as any),
  );
  assert.equal(res.status, 200);
});

test("the configured GAME_ORIGIN host is allowed on the /play resolver too", async () => {
  const { db } = createDb({ game: LIVE_GAME, version: LIVE_VERSION });
  const res = await withStorage({ stored: publishedObjects() }, () =>
    app.request("https://play.owogg.com/play/live-game", {}, {
      DB: db,
      ...B2_ENV,
      GAME_ORIGIN: "https://play.owogg.com",
    } as any),
  );
  assert.equal(res.status, 302);
});

test("api.owogg.com is blocked on the /play resolver too, not just published assets", async () => {
  const { db } = createDb({ game: LIVE_GAME, version: LIVE_VERSION });
  const res = await app.request("https://api.owogg.com/play/live-game", {}, {
    DB: db,
    ...B2_ENV,
    GAME_ORIGIN: "https://play.owogg.com",
  } as any);
  assert.equal(res.status, 404);
});

test("a malformed GAME_ORIGIN fails closed rather than allowing every host through", async () => {
  const { db } = createDb({ game: LIVE_GAME, version: LIVE_VERSION });
  const res = await withStorage({ stored: publishedObjects() }, () =>
    app.request("https://play.owogg.com/games/1/17/index.html", {}, {
      DB: db,
      ...B2_ENV,
      GAME_ORIGIN: "not a valid url",
    } as any),
  );
  assert.equal(res.status, 404);
});

test("localhost is allowed through when GAME_ORIGIN is unset (local dev), on any port", async () => {
  const { db } = createDb({ game: LIVE_GAME, version: LIVE_VERSION });
  const res = await withStorage({ stored: publishedObjects() }, () =>
    app.request("http://localhost:8787/games/1/17/index.html", {}, { DB: db, ...B2_ENV } as any),
  );
  assert.equal(res.status, 200);
});

test("127.0.0.1 is allowed through when GAME_ORIGIN is unset (local dev)", async () => {
  const { db } = createDb({ game: LIVE_GAME, version: LIVE_VERSION });
  const res = await withStorage({ stored: publishedObjects() }, () =>
    app.request("http://127.0.0.1:8787/games/1/17/index.html", {}, { DB: db, ...B2_ENV } as any),
  );
  assert.equal(res.status, 200);
});

test("even localhost is blocked once GAME_ORIGIN is configured to a real host", async () => {
  const { db } = createDb({ game: LIVE_GAME, version: LIVE_VERSION });
  const res = await withStorage({ stored: publishedObjects() }, () =>
    app.request("http://localhost:8787/games/1/17/index.html", {}, {
      DB: db,
      ...B2_ENV,
      GAME_ORIGIN: "https://play.owogg.com",
    } as any),
  );
  assert.equal(res.status, 404);
});

test("the host guard runs before the DB is ever touched", async () => {
  let dbTouched = false;
  const { db: rawDb } = createDb({ game: LIVE_GAME, version: LIVE_VERSION });
  const db = {
    ...rawDb,
    prepare(query: string) {
      dbTouched = true;
      return rawDb.prepare(query);
    },
  };
  const res = await app.request("https://api.owogg.com/games/1/17/index.html", {}, {
    DB: db,
    ...B2_ENV,
  } as any);
  assert.equal(res.status, 404);
  assert.equal(dbTouched, false, "a disallowed host must be rejected before any D1 read");
});
