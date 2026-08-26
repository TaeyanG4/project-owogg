import test from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/app.js";
import { AuthMeResponseSchema, PersonalBestResponseSchema } from "@owogg/contracts";

test("GET / returns 200 OK with service info", async () => {
  const res = await app.request("http://localhost/");
  assert.equal(res.status, 200);
  const data = (await res.json()) as { status: string; service: string };
  assert.equal(data.status, "ok");
  assert.equal(data.service, "owogg-hono-api");
});

test("GET /api/health returns 200 OK with status ok", async () => {
  const res = await app.request("http://localhost/api/health");
  assert.equal(res.status, 200);
  const data = (await res.json()) as { status: string };
  assert.equal(data.status, "ok");
});

test("GET /api/auth/me returns 401 unauthenticated and matches AuthMeResponseSchema", async () => {
  const res = await app.request("http://localhost/api/auth/me");
  assert.equal(res.status, 401);
  const json = await res.json();
  const parsed = AuthMeResponseSchema.safeParse(json);
  assert.ok(parsed.success, "Response matches AuthMeResponseSchema");
  assert.equal(parsed.data.authenticated, false);
});

test("GET /api/auth/providers exposes Google readiness only when code exchange is configured", async () => {
  const missingSecret = await app.request("http://localhost/api/auth/providers", undefined, {
    GOOGLE_CLIENT_ID: "staging-client.apps.googleusercontent.com",
    FRONTEND_URL: "https://stg.owogg.com",
  } as any);
  assert.equal(missingSecret.status, 200);
  const missingJson = (await missingSecret.json()) as {
    google: { configured: boolean; clientId?: string };
    discord: { configured: boolean };
  };
  assert.deepEqual(missingJson.google, { configured: false });

  const ready = await app.request("http://localhost/api/auth/providers", undefined, {
    GOOGLE_CLIENT_ID: "staging-client.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "server-only-secret",
    FRONTEND_URL: "https://stg.owogg.com",
  } as any);
  assert.equal(ready.status, 200);
  const readyJson = (await ready.json()) as {
    google: { configured: boolean; clientId?: string };
    discord: { configured: boolean };
  };
  assert.deepEqual(readyJson.google, {
    configured: true,
    clientId: "staging-client.apps.googleusercontent.com",
  });
  assert.equal(typeof readyJson.discord.configured, "boolean");
  assert.doesNotMatch(JSON.stringify(readyJson), /server-only-secret/);
});

test("POST /api/auth/google/code requires the preflight-forcing request header", async () => {
  const res = await app.request(
    "http://localhost/api/auth/google/code",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
      body: JSON.stringify({ code: "one-time-code" }),
    },
    {
      GOOGLE_CLIENT_ID: "client-id",
      GOOGLE_CLIENT_SECRET: "server-only-secret",
      FRONTEND_URL: "http://localhost:5173",
    } as any,
  );
  assert.equal(res.status, 403);
});

test("POST /api/auth/google/code fails closed when the server secret is missing", async () => {
  const res = await app.request(
    "http://localhost/api/auth/google/code",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:5173",
        "X-Requested-With": "XmlHttpRequest",
      },
      body: JSON.stringify({ code: "one-time-code" }),
    },
    { GOOGLE_CLIENT_ID: "client-id", FRONTEND_URL: "http://localhost:5173" } as any,
  );
  assert.equal(res.status, 503);
});

test("POST /api/auth/google/code validates the one-time code before any exchange", async () => {
  const res = await app.request(
    "http://localhost/api/auth/google/code",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:5173",
        "X-Requested-With": "XmlHttpRequest",
      },
      body: JSON.stringify({ code: "" }),
    },
    {
      GOOGLE_CLIENT_ID: "client-id",
      GOOGLE_CLIENT_SECRET: "server-only-secret",
      FRONTEND_URL: "http://localhost:5173",
    } as any,
  );
  assert.equal(res.status, 400);
});

test("POST /api/scores rejects foreign origin with 403 Forbidden", async () => {
  const res = await app.request("http://localhost/api/scores", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://malicious-hacker-site.com",
    },
    body: JSON.stringify({ game_id: "reaction-time", score: 250 }),
  });
  assert.equal(res.status, 403);
  const data = (await res.json()) as { error: string };
  assert.match(data.error, /Forbidden/i);
});

test("POST /api/scores returns 401 Unauthorized without valid session cookie", async () => {
  const res = await app.request("http://localhost/api/scores", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:5173",
    },
    body: JSON.stringify({ game_id: "reaction-time", score: 250 }),
  });
  assert.equal(res.status, 401);
  const data = (await res.json()) as { error: string };
  assert.equal(data.error, "Unauthorized");
});

test("POST /api/auth/logout succeeds", async () => {
  const res = await app.request("http://localhost/api/auth/logout", {
    method: "POST",
  });
  assert.equal(res.status, 200);
  const data = (await res.json()) as { success: boolean };
  assert.equal(data.success, true);
});

test("GET /api/scores/user/me matches PersonalBestResponseSchema without session", async () => {
  const res = await app.request("http://localhost/api/scores/user/me");
  assert.equal(res.status, 200);
  const json = await res.json();
  const parsed = PersonalBestResponseSchema.safeParse(json);
  assert.ok(parsed.success, "Response matches PersonalBestResponseSchema");
  assert.equal(parsed.data.authenticated, false);
  assert.deepEqual(parsed.data.bests, {});
});

test("GET /api/scores/:gameId fails closed without generic D1 runtime state", async () => {
  const res = await app.request("http://localhost/api/scores/reaction-time");
  // Generic leaderboard resolution requires the D1 identity/version projection; without a DB
  // binding it fails closed instead of falling back to the static registry.
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal((json as { error: { code: string } }).error.code, "INVALID_GAME_ID");
});

test("GET /api/personalization returns 401 unauthenticated without session cookie", async () => {
  const res = await app.request("http://localhost/api/personalization");
  assert.equal(res.status, 401);
  const data = (await res.json()) as { error: string };
  assert.equal(data.error, "Unauthenticated");
});

test("GET /api/auth/accounts requires authentication", async () => {
  const res = await app.request("http://localhost/api/auth/accounts");
  assert.equal(res.status, 401);
  const data = (await res.json()) as { error: { code: string; message: string } };
  assert.equal(data.error.code, "UNAUTHORIZED");
});

test("POST /api/auth/link/google requires authentication", async () => {
  const res = await app.request("http://localhost/api/auth/link/google", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
    body: JSON.stringify({ credential: "fake-credential" }),
  });
  assert.equal(res.status, 401);
  const data = (await res.json()) as { error: { code: string } };
  assert.equal(data.error.code, "UNAUTHORIZED");
});

test("DELETE /api/auth/link/:provider requires authentication", async () => {
  const res = await app.request("http://localhost/api/auth/link/google", {
    method: "DELETE",
    Origin: "http://localhost:5173",
  });
  assert.equal(res.status, 401);
  const data = (await res.json()) as { error: { code: string } };
  assert.equal(data.error.code, "UNAUTHORIZED");
});

test("DELETE /api/auth/link/:provider rejects unknown providers when authenticated-less (401 first)", async () => {
  const res = await app.request("http://localhost/api/auth/link/unknown", {
    method: "DELETE",
    Origin: "http://localhost:5173",
  });
  assert.equal(res.status, 401);
});

test("GET /api/auth/merge/preview requires authentication", async () => {
  const res = await app.request("http://localhost/api/auth/merge/preview?challenge=abc");
  assert.equal(res.status, 401);
  const data = (await res.json()) as { error: { code: string } };
  assert.equal(data.error.code, "UNAUTHORIZED");
});

test("POST /api/auth/merge/challenge requires authentication", async () => {
  const res = await app.request("http://localhost/api/auth/merge/challenge", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
    body: JSON.stringify({ conflictUserId: 2, provider: "discord" }),
  });
  assert.equal(res.status, 401);
});

test("POST /api/auth/merge/confirm requires authentication", async () => {
  const res = await app.request("http://localhost/api/auth/merge/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
    body: JSON.stringify({ challengeId: "abc", keepUserId: 1 }),
  });
  assert.equal(res.status, 401);
});

test("public query endpoints reject invalid values instead of silently defaulting", async () => {
  const progression = await app.request("/api/progression/leaderboard?limit=not-a-number");
  assert.equal(progression.status, 400);

  const streamers = await app.request("/api/streamers/rankings?gameId=not-a-real-game");
  assert.equal(streamers.status, 400);

  const guilds = await app.request("/api/discord/guilds/ranking?period=monthly");
  assert.equal(guilds.status, 400);

  const scores = await app.request("/api/scores/not-a-real-game");
  assert.equal(scores.status, 400);
});
