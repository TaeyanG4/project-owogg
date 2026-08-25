import test from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/app.js";

test("GET /api/discord/link/preview without a token returns 400", async () => {
  const res = await app.request("http://localhost/api/discord/link/preview", undefined, {
    DB: {},
  });
  assert.equal(res.status, 400);
});

test("POST /api/discord/link/confirm returns 401 Unauthenticated without a session", async () => {
  const res = await app.request("http://localhost/api/discord/link/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
    body: JSON.stringify({ token: "some-token" }),
  });
  assert.equal(res.status, 401);
});
