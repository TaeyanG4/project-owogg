import test from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/app.js";

// Regression coverage for the 2026-08-18 production bug: the app-level cors() middleware's
// allowMethods list was missing "PATCH", so every PATCH route in the API (admin sandbox-game
// visibility/metadata, admin account role/permission edits, Discord guild settings, profile
// nickname/country) failed the browser's CORS preflight and surfaced as an opaque "Failed to
// fetch" — never reaching the server at all, so no server-side test using app.request() directly
// against a PATCH route (bypassing the browser's preflight enforcement entirely) could have caught
// it. This test instead sends the actual OPTIONS preflight request a browser sends before a
// cross-origin PATCH, and asserts the response's Access-Control-Allow-Methods header — the only
// place this class of bug is actually observable.
test("CORS preflight (OPTIONS) advertises PATCH in Access-Control-Allow-Methods", async () => {
  const res = await app.request(
    "/api/admin/sandbox-games/1/visibility",
    {
      method: "OPTIONS",
      headers: {
        Origin: "https://owogg.com",
        "Access-Control-Request-Method": "PATCH",
        "Access-Control-Request-Headers": "Content-Type",
      },
    },
    { FRONTEND_URL: "https://owogg.com" } as any,
  );
  assert.equal(res.status, 204);
  const allowed = res.headers.get("Access-Control-Allow-Methods") ?? "";
  assert.ok(
    allowed.includes("PATCH"),
    `expected PATCH in Access-Control-Allow-Methods, got "${allowed}"`,
  );
});

test("CORS preflight still advertises the other standard methods (no regression on the fix)", async () => {
  const res = await app.request(
    "/api/admin/sandbox-games/1",
    {
      method: "OPTIONS",
      headers: {
        Origin: "https://owogg.com",
        "Access-Control-Request-Method": "DELETE",
      },
    },
    { FRONTEND_URL: "https://owogg.com" } as any,
  );
  const allowed = res.headers.get("Access-Control-Allow-Methods") ?? "";
  for (const method of ["GET", "POST", "PUT", "DELETE", "OPTIONS"]) {
    assert.ok(allowed.includes(method), `expected ${method} in Access-Control-Allow-Methods`);
  }
});

test("Google popup code preflight allows X-Requested-With", async () => {
  const res = await app.request(
    "/api/auth/google/code",
    {
      method: "OPTIONS",
      headers: {
        Origin: "https://stg.owogg.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type, X-Requested-With",
      },
    },
    { FRONTEND_URL: "https://stg.owogg.com" } as any,
  );
  assert.equal(res.status, 204);
  const allowed = res.headers.get("Access-Control-Allow-Headers") ?? "";
  assert.match(allowed, /X-Requested-With/i);
});

test("Staging CORS never echoes the Production origin as trusted", async () => {
  const res = await app.request(
    "/api/profile",
    {
      method: "OPTIONS",
      headers: {
        Origin: "https://owogg.com",
        "Access-Control-Request-Method": "PATCH",
      },
    },
    { FRONTEND_URL: "https://stg.owogg.com" } as any,
  );
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "https://stg.owogg.com");
});

test("Production origin cannot perform a state-changing request against Staging API", async () => {
  const res = await app.request(
    "/api/auth/logout",
    { method: "POST", headers: { Origin: "https://owogg.com" } },
    { FRONTEND_URL: "https://stg.owogg.com" } as any,
  );
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: "Forbidden: Origin verification failed" });
});

// ── credentialed API CORS must not reach game-asset routes (2026-08-18 CORS/asset bug) ──────
//
// A sandboxed game iframe (no allow-same-origin — see GameFrame.tsx) sends `Origin: null`
// on its own same-document requests, including `<script type="module">` fetches, which are always
// CORS-checked. When the app-level cors() middleware (credentials: true) applied globally, it
// answered those requests too — echoing back a specific allowed origin, never "*" once
// `credentials: true` is set — and the browser rejected the mismatch against the actual "null"
// origin. The fix scopes that credentialed policy to /api/* only; /play/* and /games/*
// (gameServing.ts) get their own separate, wildcard-but-uncredentialed CORS header instead (see
// gameServing.test.ts). These tests pin the API-side half of that split: the credentialed
// middleware must be genuinely gone from game-asset paths, not just coincidentally permissive.

test("an OPTIONS preflight to a /games/* asset path is not handled by the credentialed CORS middleware", async () => {
  // No Access-Control-Request-* handling at all is expected here — game-asset routes only ever
  // define GET handlers, and simple GETs are never preflighted by a real browser in the first
  // place. If cors() were still global, this OPTIONS request would get an automatic 204 with CORS
  // headers; scoped to /api/*, it falls through to the app's normal 404 instead.
  const res = await app.request("/games/1/17/main.js", {
    method: "OPTIONS",
    headers: {
      Origin: "null",
      "Access-Control-Request-Method": "GET",
    },
  });
  assert.equal(res.status, 404);
  assert.equal(res.headers.get("Access-Control-Allow-Methods"), null);
});

test("an OPTIONS preflight to /play/* is not handled by the credentialed CORS middleware either", async () => {
  const res = await app.request("/play/some-game", {
    method: "OPTIONS",
    headers: { Origin: "null", "Access-Control-Request-Method": "GET" },
  });
  assert.equal(res.status, 404);
  assert.equal(res.headers.get("Access-Control-Allow-Methods"), null);
});

test("a GET to a /games/* asset path never carries Access-Control-Allow-Credentials, even with a real Origin", async () => {
  // Regardless of what fileResponse's own wildcard ACAO does (see gameServing.test.ts) — the
  // credentialed API middleware specifically must not be the thing answering this request. This
  // 404s (no DB bound) but the header assertion holds regardless of status: the point is which
  // middleware touched the response, not whether the asset resolved.
  const res = await app.request("/games/1/17/index.html", {
    headers: { Origin: "https://owogg.com" },
  });
  assert.equal(res.headers.get("Access-Control-Allow-Credentials"), null);
});
