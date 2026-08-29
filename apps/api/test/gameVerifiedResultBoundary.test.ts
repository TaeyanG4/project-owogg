import assert from "node:assert/strict";
import test from "node:test";
import { MAX_GAME_EVIDENCE_DEPTH } from "@owogg/core";
import { app } from "../src/app.js";

const AUTH_HEADERS = {
  Cookie: "owogg_session=valid_session",
  "Content-Type": "application/json",
};
const ENV = {
  GAME_SESSION_SECRET: "verified-result-boundary-secret",
};

function createAuthOnlyDb() {
  return {
    prepare(query: string) {
      return {
        bind() {
          return this;
        },
        async first<T>() {
          if (!query.includes("JOIN users u ON s.user_id = u.id")) {
            throw new Error(`unexpected first query: ${query}`);
          }
          const now = new Date();
          return {
            session_id: "valid_session",
            user_id: 7,
            expires_at: new Date(now.getTime() + 86_400_000).toISOString(),
            session_created_at: now.toISOString(),
            nickname: "player",
            email: "player@example.com",
            avatar_url: null,
            avatar_provider: null,
            user_created_at: now.toISOString(),
            updated_at: now.toISOString(),
            last_active_date: now.toISOString().slice(0, 10),
            current_streak: 1,
            longest_streak: 1,
            score_submission_blocked: 0,
          } as T;
        },
        async all<T>() {
          if (!query.includes("SELECT provider FROM oauth_accounts")) {
            throw new Error(`unexpected all query: ${query}`);
          }
          return { results: [] as T[] };
        },
        async run() {
          throw new Error(`unexpected write query: ${query}`);
        },
      };
    },
  };
}

async function submit(body: unknown): Promise<Response> {
  return app.request(
    "/api/games/reaction-time/result",
    { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify(body) },
    { DB: createAuthOnlyDb(), ...ENV } as never,
  );
}

test("well-formed gs2 evidence reaches runtime authority now that atomic persistence is wired", async () => {
  const response = await submit({
    token: "gs2.payload.signature",
    evidence: { frames: [{ at: 10 }] },
  });
  assert.equal(response.status, 404);
  assert.equal(
    ((await response.json()) as { error: { code: string } }).error.code,
    "GAME_NOT_AVAILABLE",
  );
});

test("gs2 result rejects client-authored score facts at the HTTP boundary", async () => {
  const response = await submit({
    token: "gs2.payload.signature",
    evidence: {},
    score: 999_999,
  });
  assert.equal(response.status, 400);
  assert.equal(
    ((await response.json()) as { error: { code: string } }).error.code,
    "INVALID_PAYLOAD",
  );
});

test("result route independently rejects excessive evidence depth", async () => {
  let evidence: unknown = true;
  for (let index = 0; index <= MAX_GAME_EVIDENCE_DEPTH; index += 1) evidence = [evidence];
  const response = await submit({ token: "gs2.payload.signature", evidence });
  assert.equal(response.status, 400);
  assert.equal(
    ((await response.json()) as { error: { code: string } }).error.code,
    "EVIDENCE_TOO_DEEP",
  );
});

test("result route rejects request bodies above 64 KiB before schema parsing", async () => {
  const response = await submit({
    token: "gs2.payload.signature",
    evidence: "x".repeat(65 * 1024),
  });
  assert.equal(response.status, 413);
  assert.equal(
    ((await response.json()) as { error: { code: string } }).error.code,
    "REQUEST_TOO_LARGE",
  );
});
