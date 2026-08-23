import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { app } from "../src/index.js";
import { SANDBOX_GAME_POLICY } from "@owogg/core";

/**
 * End-to-end publish: a real multipart upload of a real zip, through the real route, use case,
 * publisher, fflate reader and B2 adapter, with only the network boundary stubbed. This is what
 * proves the pipeline decompresses **once at publish time** and writes one object per file —
 * nothing here or downstream unzips on a player's request.
 */
const OWOGG_SESSION_RAW_TOKEN = "valid_session";

const B2_ENV = {
  B2_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
  B2_REGION: "us-west-004",
  B2_BUCKET_NAME: "owogg-game-bundles",
  B2_KEY_ID: "someKeyId",
  B2_APPLICATION_KEY: "someApplicationKey",
};

const GAME_ID = 1;
const NEW_VERSION_ID = 17;
const CREATOR_MANIFEST = strToU8(
  JSON.stringify({
    schemaVersion: 1,
    game: { slug: "my-game", title: "My Game", genre: "puzzle", mode: "single" },
    progression: { type: "none" },
    result: { score: null },
  }),
);

/**
 * Minimal D1 stub covering just the statements the upload path issues: session lookup, developer
 * check, game lookup, version insert + read-back, and the publish-state updates. The version row
 * lives in a mutable object so a test can assert what publishing wrote to it.
 */
function createDb() {
  const versionRow: Record<string, unknown> = {
    id: NEW_VERSION_ID,
    game_id: GAME_ID,
    object_key: "",
    content_hash: "",
    bundle_bytes: 0,
    status: "PENDING_REVIEW",
    reviewed_by_admin_id: null,
    reviewed_at: null,
    reject_reason: null,
    uploaded_at: new Date().toISOString(),
    publish_status: "UPLOADED",
    publish_error: null,
    published_at: null,
    manifest_key: null,
    published_size_bytes: null,
    file_count: null,
  };

  function statement(query: string) {
    let values: unknown[] = [];
    return {
      query,
      bind(...bound: unknown[]) {
        values = bound;
        return this;
      },
      async first<T>() {
        if (query.includes("JOIN users u ON s.user_id = u.id")) {
          return {
            session_id: "valid_session",
            user_id: 7,
            expires_at: new Date(Date.now() + 86400000).toISOString(),
            session_created_at: new Date().toISOString(),
            nickname: "dev",
            email: "dev@example.com",
            avatar_url: null,
            user_created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as T;
        }
        if (query.includes("FROM game_creator_access WHERE user_id")) {
          return {
            user_id: 7,
            granted_by_admin_id: 1,
            status: "ACTIVE",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as T;
        }
        if (query.includes("FROM admin_accounts WHERE user_id")) return null;
        if (
          query.includes("FROM sandbox_games WHERE id") ||
          (query.includes("FROM games g") && query.includes("g.id = ?"))
        ) {
          return {
            id: GAME_ID,
            slug: "my-game",
            developer_user_id: 7,
            title: "My Game",
            short_description: null,
            description: null,
            genre: "puzzle",
            xp_per_completion: 0,
            score_unit: null,
            score_direction: null,
            score_min: null,
            score_max: null,
            score_display_prefix: null,
            score_display_suffix: null,
            visibility: "PRIVATE",
            live_version_id: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as T;
        }
        // createVersion's INSERT ... RETURNING * is read via first(), not run() + a separate
        // SELECT (see D1SandboxGameRepository.createVersion's comment on why) — so the same
        // query text that populates versionRow's fields must also hand the row back here.
        if (query.includes("INSERT INTO sandbox_game_versions")) {
          versionRow.object_key = String(values[1]);
          versionRow.content_hash = String(values[2]);
          versionRow.bundle_bytes = Number(values[3]);
          return { ...versionRow } as T;
        }
        // Read-back for every findVersionById during publishing.
        if (query.includes("FROM sandbox_game_versions") || query.includes("FROM game_versions gv"))
          return { ...versionRow } as T;
        return null;
      },
      async all<T>() {
        return { results: [] } as { results: T[] };
      },
      async run() {
        if (
          (query.includes("UPDATE sandbox_game_versions") ||
            query.includes("UPDATE game_versions")) &&
          query.includes("publish_status")
        ) {
          versionRow.publish_status = values[0];
          versionRow.publish_error = values[1];
          versionRow.published_at = values[2];
          versionRow.manifest_key = values[3];
          versionRow.published_size_bytes = values[4];
          versionRow.file_count = values[5];
        }
        return { success: true, meta: { changes: 1 } };
      },
    };
  }

  return {
    db: {
      prepare(query: string) {
        return statement(query);
      },
      async batch(statements: Array<ReturnType<typeof statement>>) {
        return Promise.all(
          statements.map(async (prepared) => {
            if (/\bRETURNING\b/i.test(prepared.query)) {
              const row = await prepared.first<Record<string, unknown>>();
              return {
                success: true,
                results: row ? [row] : [],
                meta: { changes: row ? 1 : 0 },
              };
            }
            return prepared.run();
          }),
        );
      },
    },
    versionRow,
  };
}

/** Records every object write so a test can assert the exact published key layout. */
function createStorageStub(options: { failPutContaining?: string } = {}) {
  const originalFetch = globalThis.fetch;
  /** Successful writes only — the published key layout. */
  const puts: Array<{ key: string; contentType: string | null; contentEncoding: string | null }> =
    [];
  /** Every PUT attempt including retries, so the retry budget itself can be asserted. */
  const attemptedPuts: string[] = [];

  globalThis.fetch = (async (input: URL | RequestInfo | string) => {
    // aws4fetch signs and then calls fetch with a Request, whose toString() is "[object Request]" —
    // so the URL has to be read off `.url` rather than stringified.
    const request = input as Request;
    const href =
      typeof input === "string" ? input : input instanceof URL ? input.href : request.url;
    const url = new URL(href);
    const key = decodeURIComponent(url.pathname.split("/").slice(2).join("/"));
    const method = typeof input === "string" ? "GET" : (request.method ?? "GET");

    if (method === "PUT") {
      attemptedPuts.push(key);
      if (options.failPutContaining && key.includes(options.failPutContaining)) {
        return new Response("storage exploded", { status: 500 });
      }
      puts.push({
        key,
        contentType: request.headers?.get("Content-Type") ?? null,
        contentEncoding: request.headers?.get("Content-Encoding") ?? null,
      });
      return new Response("", { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;

  return {
    puts,
    attemptedPuts,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

function uploadRequest(archive: Uint8Array): FormData {
  const body = new FormData();
  body.append("bundle", new File([archive], "game.zip", { type: "application/zip" }));
  return body;
}

async function upload(db: unknown, archive: Uint8Array, extraEnv: Record<string, unknown> = {}) {
  return app.request(
    `/api/dev/games/${GAME_ID}/versions`,
    {
      method: "POST",
      headers: {
        Cookie: `owogg_session=${OWOGG_SESSION_RAW_TOKEN}`,
        Origin: "http://localhost:5173",
      },
      body: uploadRequest(archive),
    },
    {
      DB: db,
      ADMIN_USER_IDS: "1",
      FRONTEND_URL: "http://localhost:5173",
      ...B2_ENV,
      ...extraEnv,
    } as never,
  );
}

test("uploading a valid bundle stores the source archive once and publishes one object per file", async () => {
  const { db, versionRow } = createDb();
  const archive = zipSync({
    "index.html": strToU8("<h1>hi</h1>"),
    "Build/game.wasm": strToU8("\0asm"),
    "assets/logo.png": strToU8("PNG"),
    "owogg.json": CREATOR_MANIFEST,
  });
  const storage = createStorageStub();

  try {
    const res = await upload(db, archive);
    assert.equal(res.status, 201);

    const body = (await res.json()) as { publishStatus: string; fileCount: number };
    assert.equal(body.publishStatus, "READY");
    assert.equal(body.fileCount, 4);

    const keys = storage.puts.map((p) => p.key);
    // Exactly one source archive, content-addressed under the game's id (never the slug).
    const sourceKeys = keys.filter((k) => k.startsWith("uploads/"));
    assert.equal(sourceKeys.length, 1);
    assert.match(sourceKeys[0]!, new RegExp(`^uploads/${GAME_ID}/[0-9a-f]{64}\\.zip$`));

    // One object per file, plus the manifest, all under this version's immutable prefix.
    assert.ok(keys.includes(`games/${GAME_ID}/${NEW_VERSION_ID}/index.html`));
    assert.ok(keys.includes(`games/${GAME_ID}/${NEW_VERSION_ID}/Build/game.wasm`));
    assert.ok(keys.includes(`games/${GAME_ID}/${NEW_VERSION_ID}/assets/logo.png`));
    assert.ok(keys.includes(`games/${GAME_ID}/${NEW_VERSION_ID}/owogg.json`));
    assert.ok(keys.includes(`games/${GAME_ID}/${NEW_VERSION_ID}/.owogg-manifest.json`));
    assert.equal(keys.length, 6);

    // Content types are decided at publish time and stored with each object.
    const wasm = storage.puts.find((p) => p.key.endsWith("game.wasm"));
    assert.equal(wasm?.contentType, "application/wasm");

    assert.equal(versionRow.publish_status, "READY");
    assert.equal(versionRow.file_count, 4);
    assert.ok(versionRow.manifest_key);
  } finally {
    storage.restore();
  }
});

test("Unity's Brotli-suffixed files are published with the inner type plus a Content-Encoding", async () => {
  const { db } = createDb();
  const archive = zipSync({
    "index.html": strToU8("<h1>unity</h1>"),
    "Build/game.wasm.br": strToU8("brotli-ish"),
    "owogg.json": CREATOR_MANIFEST,
  });
  const storage = createStorageStub();

  try {
    const res = await upload(db, archive);
    assert.equal(res.status, 201);

    const br = storage.puts.find((p) => p.key.endsWith("game.wasm.br"));
    assert.equal(br?.contentType, "application/wasm");
    assert.equal(br?.contentEncoding, "br");
  } finally {
    storage.restore();
  }
});

test("a bundle with no index.html is rejected 422 and nothing is stored at all", async () => {
  const { db } = createDb();
  const archive = zipSync({ "readme.txt": strToU8("no game here") });
  const storage = createStorageStub();

  try {
    const res = await upload(db, archive);
    assert.equal(res.status, 422);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "BUNDLE_MISSING_ENTRY");
    assert.deepEqual(storage.puts, [], "validation runs before anything is written");
  } finally {
    storage.restore();
  }
});

test("a non-zip upload is rejected 422 as malformed rather than 500", async () => {
  const { db } = createDb();
  const storage = createStorageStub();

  try {
    const res = await upload(db, strToU8("this is definitely not a zip file"));
    assert.equal(res.status, 422);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "BUNDLE_MALFORMED");
    assert.deepEqual(storage.puts, []);
  } finally {
    storage.restore();
  }
});

test("a zip whose entries escape the bundle root is rejected 422 with nothing stored", async () => {
  const { db } = createDb();
  const archive = zipSync({
    "index.html": strToU8("<h1>hi</h1>"),
    "../../etc/passwd": strToU8("root:x:0:0"),
  });
  const storage = createStorageStub();

  try {
    const res = await upload(db, archive);
    assert.equal(res.status, 422);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "BUNDLE_INVALID_PATH");
    assert.deepEqual(storage.puts, []);
  } finally {
    storage.restore();
  }
});

test("a single wrapping folder is unwrapped, so index.html publishes at the version root", async () => {
  const { db } = createDb();
  const archive = zipSync({
    "MyGame/index.html": strToU8("<h1>wrapped</h1>"),
    "MyGame/Build/game.data": strToU8("data"),
    "MyGame/owogg.json": CREATOR_MANIFEST,
  });
  const storage = createStorageStub();

  try {
    const res = await upload(db, archive);
    assert.equal(res.status, 201);

    const keys = storage.puts.map((p) => p.key);
    assert.ok(keys.includes(`games/${GAME_ID}/${NEW_VERSION_ID}/index.html`));
    assert.ok(keys.includes(`games/${GAME_ID}/${NEW_VERSION_ID}/Build/game.data`));
    assert.ok(!keys.some((k) => k.includes("MyGame/")));
  } finally {
    storage.restore();
  }
});

test("a storage failure part-way through publishing leaves the version FAILED with no manifest", async () => {
  const { db, versionRow } = createDb();
  const archive = zipSync({
    "index.html": strToU8("<h1>hi</h1>"),
    "Build/game.wasm": strToU8("\0asm"),
    "owogg.json": CREATOR_MANIFEST,
  });
  const storage = createStorageStub({ failPutContaining: "game.wasm" });

  try {
    const res = await upload(db, archive);
    assert.equal(res.status, 500);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "PUBLISH_FAILED");

    assert.equal(versionRow.publish_status, "FAILED");
    assert.ok(versionRow.publish_error);
    assert.equal(versionRow.manifest_key, null, "no manifest may claim a partial publish");
    assert.ok(!storage.puts.some((p) => p.key.endsWith(".owogg-manifest.json")));
  } finally {
    storage.restore();
  }
});

test("a 5xx from storage is retried a bounded number of times, not aws4fetch's 10-deep default", async () => {
  const { db } = createDb();
  const archive = zipSync({
    "index.html": strToU8("<h1>hi</h1>"),
    "owogg.json": CREATOR_MANIFEST,
  });
  // Every PUT fails, so this counts the full retry budget for one object. aws4fetch's default
  // (retries: 10, doubling backoff) would both spam the provider and stall the request for tens of
  // seconds inside a single Worker invocation — see B2_RETRIES.
  const storage = createStorageStub({ failPutContaining: "uploads/" });

  try {
    const started = Date.now();
    const res = await upload(db, archive);
    const elapsedMs = Date.now() - started;

    assert.equal(res.status, 500);
    assert.equal(storage.attemptedPuts.length, 3, "1 initial attempt + 2 retries");
    assert.ok(
      elapsedMs < 5000,
      `retry backoff should stay well under a second, took ${elapsedMs}ms`,
    );
  } finally {
    storage.restore();
  }
});

test("a real zip declaring a decompressed size over the extracted cap is rejected with no storage write", async () => {
  const { db } = createDb();
  // All-zero bytes deflate to a tiny fraction of their size — exactly the shape a zip bomb takes:
  // a small compressed upload that declares (and, here, genuinely contains) a huge decompressed
  // size. This exercises the real fflate central-directory read end to end, not a fake.
  const huge = new Uint8Array(SANDBOX_GAME_POLICY.MAX_EXTRACTED_BUNDLE_BYTES + 1024 * 1024);
  const archive = zipSync({ "index.html": strToU8("<h1>hi</h1>"), "huge.data": huge });
  assert.ok(
    archive.byteLength < SANDBOX_GAME_POLICY.MAX_BUNDLE_BYTES,
    "the compressed archive must still fit comfortably under the upload cap for this to be a meaningful zip-bomb shape",
  );

  const storage = createStorageStub();
  try {
    const res = await upload(db, archive);
    assert.equal(res.status, 422);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "BUNDLE_EXTRACTED_TOO_LARGE");
    assert.deepEqual(storage.puts, [], "nothing should ever reach storage for a rejected bundle");
  } finally {
    storage.restore();
  }
});

test("the upload route enforces its own GAME_UPLOAD_RATE_LIMITER binding, separate from score-submit's", async () => {
  const { db } = createDb();
  const archive = zipSync({ "index.html": strToU8("<h1>hi</h1>") });
  const storage = createStorageStub();

  try {
    const res = await upload(db, archive, {
      GAME_UPLOAD_RATE_LIMITER: { limit: async () => ({ success: false }) },
    });
    assert.equal(res.status, 429);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "RATE_LIMITED");
    assert.deepEqual(storage.puts, [], "a rate-limited request must never reach storage");
  } finally {
    storage.restore();
  }
});

test("the upload route is unaffected by a RATE_LIMITER (score-submit's binding) rejection", async () => {
  const { db } = createDb();
  const archive = zipSync({
    "index.html": strToU8("<h1>hi</h1>"),
    "owogg.json": CREATOR_MANIFEST,
  });
  const storage = createStorageStub();

  try {
    const res = await upload(db, archive, {
      RATE_LIMITER: { limit: async () => ({ success: false }) },
    });
    assert.equal(res.status, 201, "score-submit's limiter must not gate uploads");
  } finally {
    storage.restore();
  }
});
