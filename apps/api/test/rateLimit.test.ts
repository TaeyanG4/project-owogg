import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { rateLimit } from "../src/middleware/rateLimit.js";

function appWithLimiter(limiter?: unknown) {
  const app = new Hono();
  app.post("/submit", rateLimit({ name: "test" }), (c) => c.json({ ok: true }));
  return (headers: Record<string, string> = {}) =>
    app.request("/submit", { method: "POST", headers }, { RATE_LIMITER: limiter } as never);
}

test("requests pass through when no RATE_LIMITER binding is configured", async () => {
  const request = appWithLimiter(undefined);
  const res = await request();
  assert.equal(res.status, 200, "an unconfigured environment must stay usable, not closed");
});

test("a request is rejected with 429 once the limiter reports failure", async () => {
  const request = appWithLimiter({ limit: async () => ({ success: false }) });
  const res = await request();

  assert.equal(res.status, 429);
  assert.equal(res.headers.get("Retry-After"), "60");
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "RATE_LIMITED");
});

test("a route can expose its bound retry window to queued clients", async () => {
  const app = new Hono();
  app.post("/upload", rateLimit({ name: "upload", retryAfterSeconds: 90 }), (c) =>
    c.json({ ok: true }),
  );
  const res = await app.request("/upload", { method: "POST" }, {
    RATE_LIMITER: { limit: async () => ({ success: false }) },
  } as never);

  assert.equal(res.status, 429);
  assert.equal(res.headers.get("Retry-After"), "90");
  const body = (await res.json()) as { error: { retryAfterSeconds: number } };
  assert.equal(body.error.retryAfterSeconds, 90);
});

test("a request is allowed when the limiter reports success", async () => {
  const request = appWithLimiter({ limit: async () => ({ success: true }) });
  assert.equal((await request()).status, 200);
});

test("the limiter failing open keeps writes available during a limiter outage", async () => {
  const request = appWithLimiter({
    limit: async () => {
      throw new Error("rate limiter unavailable");
    },
  });
  const res = await request();
  assert.equal(res.status, 200, "a limiter outage must degrade capacity protection, not writes");
});

test("the key is derived from the session cookie, not the client IP, when authenticated", async () => {
  const keys: string[] = [];
  const request = appWithLimiter({
    limit: async ({ key }: { key: string }) => {
      keys.push(key);
      return { success: true };
    },
  });

  // Same account arriving from two different IPs must share one bucket, so rotating IPs does
  // not multiply an abuser's allowance.
  await request({ Cookie: "owogg_session=abcdef0123456789rest", "CF-Connecting-IP": "1.1.1.1" });
  await request({ Cookie: "owogg_session=abcdef0123456789rest", "CF-Connecting-IP": "2.2.2.2" });

  assert.equal(keys[0], keys[1], "one account must not get a fresh quota per IP");
  assert.ok(keys[0]?.startsWith("test:s:"), "authenticated callers key on the session");
});

test("the raw session token is never used in full as the rate limit key", async () => {
  const keys: string[] = [];
  const rawToken = "0123456789abcdef_SECRET_TAIL_MUST_NOT_APPEAR";
  const request = appWithLimiter({
    limit: async ({ key }: { key: string }) => {
      keys.push(key);
      return { success: true };
    },
  });

  await request({ Cookie: `owogg_session=${rawToken}` });

  assert.ok(keys[0]);
  assert.ok(
    !keys[0].includes("SECRET_TAIL_MUST_NOT_APPEAR"),
    "rate limit keys can surface in logs/metrics — the full bearer token must never be one",
  );
});

test("unauthenticated callers fall back to keying on client IP", async () => {
  const keys: string[] = [];
  const request = appWithLimiter({
    limit: async ({ key }: { key: string }) => {
      keys.push(key);
      return { success: true };
    },
  });

  await request({ "CF-Connecting-IP": "203.0.113.7" });

  assert.equal(keys[0], "test:ip:203.0.113.7");
});

// ── selectable binding (game-upload uses its own, stricter limiter) ──────────

function appWithNamedBinding(
  bindingName: string,
  limiter?: unknown,
  otherEnv: Record<string, unknown> = {},
) {
  const app = new Hono();
  app.post("/upload", rateLimit({ name: "game-upload", binding: bindingName }), (c) =>
    c.json({ ok: true }),
  );
  return (headers: Record<string, string> = {}) =>
    app.request("/upload", { method: "POST", headers }, {
      [bindingName]: limiter,
      ...otherEnv,
    } as never);
}

test("rateLimit checks the binding named by `binding`, not the default RATE_LIMITER", async () => {
  const app = new Hono();
  app.post(
    "/upload",
    rateLimit({ name: "game-upload", binding: "GAME_UPLOAD_RATE_LIMITER" }),
    (c) => c.json({ ok: true }),
  );

  // A RATE_LIMITER binding present but GAME_UPLOAD_RATE_LIMITER absent must NOT protect this
  // route — the whole point of a separate binding is that score-submit's limit doesn't leak in.
  const res = await app.request("/upload", { method: "POST" }, {
    RATE_LIMITER: { limit: async () => ({ success: false }) },
  } as never);
  assert.equal(res.status, 200, "an unrelated binding must not be consulted");
});

test("a distinctly-bound limiter rejecting a request 429s the same way as the default binding", async () => {
  const request = appWithNamedBinding("GAME_UPLOAD_RATE_LIMITER", {
    limit: async () => ({ success: false }),
  });
  const res = await request();
  assert.equal(res.status, 429);
});

test("the game-upload limiter key is prefixed distinctly from score-submit's", async () => {
  const keys: string[] = [];
  const request = appWithNamedBinding("GAME_UPLOAD_RATE_LIMITER", {
    limit: async ({ key }: { key: string }) => {
      keys.push(key);
      return { success: true };
    },
  });
  await request({ "CF-Connecting-IP": "203.0.113.7" });
  assert.equal(keys[0], "game-upload:ip:203.0.113.7");
});
