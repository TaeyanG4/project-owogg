import test from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/index.js";

test("GET /api/progression/me returns 401 Unauthenticated without a session", async () => {
  const res = await app.request("http://localhost/api/progression/me");
  assert.equal(res.status, 401);
});

test("GET /api/progression/achievements returns 401 Unauthenticated without a session", async () => {
  const res = await app.request("http://localhost/api/progression/achievements");
  assert.equal(res.status, 401);
});

test("GET /api/progression/leaderboard is public and responds even without a DB binding", async () => {
  const res = await app.request("http://localhost/api/progression/leaderboard");
  assert.equal(res.status, 200);
  const data = (await res.json()) as { entries: unknown[] };
  assert.ok(Array.isArray(data.entries));
});

test("POST /api/profile/nickname returns 401 Unauthenticated without a session", async () => {
  const res = await app.request("http://localhost/api/profile/nickname", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
    body: JSON.stringify({ nickname: "NewName" }),
  });
  assert.equal(res.status, 401);
});

test("POST /api/profile/country returns 401 Unauthenticated without a session", async () => {
  const res = await app.request("http://localhost/api/profile/country", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
    body: JSON.stringify({ country: "KR" }),
  });
  assert.equal(res.status, 401);
});

test("POST /api/profile/locale returns 401 Unauthenticated without a session", async () => {
  const res = await app.request("http://localhost/api/profile/locale", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
    body: JSON.stringify({ locale: "en-US" }),
  });
  assert.equal(res.status, 401);
});

test("PATCH /api/profile/avatar returns 401 Unauthenticated without a session", async () => {
  const res = await app.request("http://localhost/api/profile/avatar", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "google" }),
  });
  assert.equal(res.status, 401);
});

test("POST /api/scores response schema optionally carries progression side-effects", async () => {
  // Unauthenticated submission is still rejected before any progression logic runs.
  const res = await app.request("http://localhost/api/scores", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
    body: JSON.stringify({ game_id: "reaction-time", score: 250 }),
  });
  assert.equal(res.status, 401);
});
