import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { hashSessionToken } from "@owogg/db";
import { app } from "../src/app.js";
import { createSqliteD1 } from "../../../packages/db/test/helpers/sqliteD1.js";

const SESSION_TOKEN = "profile-presentation-session";
const COOKIE = `owogg_session=${SESSION_TOKEN}`;

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

async function seedSession(raw: import("node:sqlite").DatabaseSync) {
  raw.prepare("INSERT INTO users (id, nickname) VALUES (7, 'Profile owner')").run();
  raw
    .prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, 7, ?, ?)")
    .run(
      await hashSessionToken(SESSION_TOKEN),
      "2026-09-01T00:00:00.000Z",
      "2099-01-01T00:00:00.000Z",
    );
}

test("PATCH /api/profile/presentation saves an owner-selected preset and CommonMark biography", async () => {
  const { db, raw } = createMigratedD1();
  await seedSession(raw);

  const res = await app.request(
    "/api/profile/presentation",
    {
      method: "PATCH",
      headers: {
        Cookie: COOKIE,
        Origin: "http://localhost:3000",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        banner: "MINT",
        bioMarkdown: "## 안녕하세요\n\n**게임**과 방송을 좋아합니다.",
      }),
    },
    { DB: db, FRONTEND_URL: "http://localhost:3000" } as any,
  );

  assert.equal(res.status, 200);
  const json = (await res.json()) as Record<string, unknown>;
  assert.equal(json.success, true);
  assert.equal(json.banner, "MINT");
  assert.equal(json.bioMarkdown, "## 안녕하세요\n\n**게임**과 방송을 좋아합니다.");
  assert.deepEqual(
    {
      ...raw.prepare("SELECT profile_banner, profile_bio_markdown FROM users WHERE id = 7").get(),
    },
    {
      profile_banner: "MINT",
      profile_bio_markdown: "## 안녕하세요\n\n**게임**과 방송을 좋아합니다.",
    },
  );
});

test("PATCH /api/profile/presentation rejects unsupported or oversized values", async () => {
  const { db, raw } = createMigratedD1();
  await seedSession(raw);
  const env = { DB: db, FRONTEND_URL: "http://localhost:3000" } as any;
  const headers = {
    Cookie: COOKIE,
    Origin: "http://localhost:3000",
    "Content-Type": "application/json",
  };

  const invalidBanner = await app.request(
    "/api/profile/presentation",
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({ banner: "CUSTOM", bioMarkdown: "not saved" }),
    },
    env,
  );
  assert.equal(invalidBanner.status, 400);

  const oversizedBio = await app.request(
    "/api/profile/presentation",
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({ banner: "AURORA", bioMarkdown: "x".repeat(2001) }),
    },
    env,
  );
  assert.equal(oversizedBio.status, 400);
  assert.deepEqual(
    {
      ...raw.prepare("SELECT profile_banner, profile_bio_markdown FROM users WHERE id = 7").get(),
    },
    { profile_banner: "AURORA", profile_bio_markdown: "" },
  );
});
