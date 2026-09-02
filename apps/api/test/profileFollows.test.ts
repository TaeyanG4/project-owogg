import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { hashSessionToken } from "@owogg/db";
import { app } from "../src/app.js";
import { createSqliteD1 } from "../../../packages/db/test/helpers/sqliteD1.js";

const SESSION_TOKEN = "profile-follow-session";
const AUTH_HEADERS = {
  Cookie: `owogg_session=${SESSION_TOKEN}`,
  Origin: "http://localhost:3000",
};

function createMigratedD1() {
  const result = createSqliteD1("PRAGMA foreign_keys = ON;");
  const migrationUrl = new URL("../../../packages/db/migrations/", import.meta.url);
  for (const filename of fs
    .readdirSync(migrationUrl)
    .filter((value) => value.endsWith(".sql"))
    .sort()) {
    result.raw.exec(fs.readFileSync(new URL(filename, migrationUrl), "utf8"));
  }
  return result;
}

async function seed(raw: import("node:sqlite").DatabaseSync) {
  raw.prepare("INSERT INTO users (id, nickname) VALUES (1, 'Viewer')").run();
  raw.prepare("INSERT INTO users (id, nickname) VALUES (2, 'Target')").run();
  raw.prepare("INSERT INTO users (id, nickname) VALUES (3, 'Another')").run();
  raw
    .prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, 1, ?, ?)")
    .run(
      await hashSessionToken(SESSION_TOKEN),
      "2026-09-01T00:00:00.000Z",
      "2099-01-01T00:00:00.000Z",
    );
}

test("profile follows are directional, idempotent, paginated, and cannot target self", async () => {
  const { db, raw } = createMigratedD1();
  await seed(raw);
  const env = { DB: db, FRONTEND_URL: "http://localhost:3000" } as any;

  const unauthenticated = await app.request(
    "/api/profile/follows/2",
    { method: "PUT", headers: { Origin: "http://localhost:3000" } },
    env,
  );
  assert.equal(unauthenticated.status, 401);

  const first = await app.request(
    "/api/profile/follows/2",
    { method: "PUT", headers: AUTH_HEADERS },
    env,
  );
  assert.equal(first.status, 200);
  assert.deepEqual(((await first.json()) as any).followStats, {
    followerCount: 1,
    followingCount: 0,
    viewerIsFollowing: true,
  });

  const duplicate = await app.request(
    "/api/profile/follows/2",
    { method: "PUT", headers: AUTH_HEADERS },
    env,
  );
  assert.equal(duplicate.status, 200);
  assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM user_follows").get()?.count, 1);

  const self = await app.request(
    "/api/profile/follows/1",
    { method: "PUT", headers: AUTH_HEADERS },
    env,
  );
  assert.equal(self.status, 400);
  assert.throws(() =>
    raw
      .prepare(
        "INSERT INTO user_follows (follower_user_id, followed_user_id, created_at) VALUES (1, 1, ?)",
      )
      .run("2026-09-02T00:00:00.000Z"),
  );

  const firstFollowCreatedAt = String(
    raw
      .prepare(
        "SELECT created_at FROM user_follows WHERE follower_user_id = 1 AND followed_user_id = 2",
      )
      .get()?.created_at,
  );
  const laterFollowCreatedAt = new Date(Date.parse(firstFollowCreatedAt) + 1_000).toISOString();

  raw
    .prepare(
      "INSERT INTO user_follows (follower_user_id, followed_user_id, created_at) VALUES (3, 2, ?)",
    )
    .run(laterFollowCreatedAt);

  const followers = await app.request(
    "/api/profile/public/2/followers?page=1&pageSize=10",
    {},
    env,
  );
  assert.equal(followers.status, 200);
  const followerJson = (await followers.json()) as any;
  assert.equal(followerJson.total, 2);
  assert.deepEqual(
    followerJson.items.map((item: { userId: number }) => item.userId),
    [3, 1],
  );

  const following = await app.request(
    "/api/profile/public/1/following?page=1&pageSize=10",
    {},
    env,
  );
  assert.equal(following.status, 200);
  assert.deepEqual(
    ((await following.json()) as any).items.map((item: any) => item.userId),
    [2],
  );

  const invalidPageSize = await app.request(
    "/api/profile/public/2/followers?page=1&pageSize=15",
    {},
    env,
  );
  assert.equal(invalidPageSize.status, 400);

  const removed = await app.request(
    "/api/profile/follows/2",
    { method: "DELETE", headers: AUTH_HEADERS },
    env,
  );
  assert.equal(removed.status, 200);
  assert.deepEqual(((await removed.json()) as any).followStats, {
    followerCount: 1,
    followingCount: 0,
    viewerIsFollowing: false,
  });

  const duplicateRemoval = await app.request(
    "/api/profile/follows/2",
    { method: "DELETE", headers: AUTH_HEADERS },
    env,
  );
  assert.equal(duplicateRemoval.status, 200);
  assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM user_follows").get()?.count, 1);
});
