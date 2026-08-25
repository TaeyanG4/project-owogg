import test from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/app.js";

test("GET /api/discord/guilds/search returns 200 and search results structure", async () => {
  const mockEnv = {
    DB: {
      prepare() {
        return {
          bind() {
            return this;
          },
          async first() {
            return { total: 0 };
          },
          async all() {
            return { results: [] };
          },
          async run() {
            return { success: true };
          },
        };
      },
      async batch() {
        return [];
      },
    },
  };

  const res = await app.request("/api/discord/guilds/search?q=test", {}, mockEnv as any);
  assert.equal(res.status, 200);

  const json = (await res.json()) as any;
  assert.equal(Array.isArray(json.guilds), true);
  assert.equal(typeof json.total, "number");
});

test("GET /api/discord/guilds/ranking returns 200 and global activity structure", async () => {
  const mockEnv = {
    DB: {
      prepare() {
        return {
          bind() {
            return this;
          },
          async first() {
            return { total: 0 };
          },
          async all() {
            return { results: [] };
          },
        };
      },
    },
  };

  const res = await app.request("/api/discord/guilds/ranking?period=weekly", {}, mockEnv as any);
  assert.equal(res.status, 200);

  const json = (await res.json()) as any;
  assert.equal(Array.isArray(json.guilds), true);
  assert.equal(json.period, "weekly");
});

test("GET /api/discord/guilds/candidates requires authentication", async () => {
  const mockEnv = { DB: {} };
  const res = await app.request("/api/discord/guilds/candidates?token=123", {}, mockEnv as any);
  assert.equal(res.status, 401);
});

test("POST /api/discord/guilds/register requires authentication", async () => {
  const mockEnv = { DB: {} };
  const res = await app.request(
    "/api/discord/guilds/register",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "abc", guildId: "123" }),
    },
    mockEnv as any,
  );
  assert.equal(res.status, 401);
});

test("GET /api/auth/discord/register-server redirects unauthenticated users to login/status", async () => {
  const mockEnv = {
    FRONTEND_URL: "https://owogg.com",
    DB: {
      prepare() {
        return {
          bind() {
            return this;
          },
          async first() {
            return null;
          },
        };
      },
    },
  };
  const res = await app.request("/api/auth/discord/register-server", {}, mockEnv as any);
  assert.equal(res.status, 302);
});

test("Optional Discord configuration failure does not break core app health", async () => {
  const mockEnv = {
    COMMIT_SHA: "test-sha",
  };
  const res = await app.request("/api/health", {}, mockEnv as any);
  assert.equal(res.status, 200);
  const json = (await res.json()) as any;
  assert.equal(json.status, "ok");
  assert.equal(json.commit, "test-sha");
});
