import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { AdminGameCatalogRoleResponseSchema, AdminGameListResponseSchema } from "@owogg/contracts";
import { hashSessionToken } from "@owogg/db";
import { createSqliteD1 } from "../../../packages/db/test/helpers/sqliteD1.js";
import { app } from "../src/app.js";

const USER_SESSION_TOKEN = "catalog-role-user-session";
const ADMIN_SESSION_TOKEN = "catalog-role-admin-session";
const COOKIE = `owogg_session=${USER_SESSION_TOKEN}; owogg_admin_session=${ADMIN_SESSION_TOKEN}`;
const NOW = "2026-08-30T00:00:00.000Z";
const FUTURE = "2099-08-30T00:00:00.000Z";

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

async function seedAdmin(raw: ReturnType<typeof createMigratedD1>["raw"]) {
  const userSessionHash = await hashSessionToken(USER_SESSION_TOKEN);
  const adminSessionHash = await hashSessionToken(ADMIN_SESSION_TOKEN);
  raw.prepare("INSERT INTO users (id, nickname) VALUES (1, 'Tool Admin')").run();
  raw
    .prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, 1, ?, ?)")
    .run(userSessionHash, NOW, FUTURE);
  raw
    .prepare(
      `INSERT INTO admin_accounts (
         id, user_id, google_sub, username, password_hash, role, status,
         must_change_password, created_at, updated_at, password_changed_at
       ) VALUES (9, 1, 'tool-admin-sub', 'tool-admin', 'hash', 'ADMIN', 'ACTIVE', 0, ?, ?, ?)`,
    )
    .run(NOW, NOW, NOW);
  raw
    .prepare(
      `INSERT INTO admin_sessions (
         token_hash, user_id, session_token_hash, created_at, expires_at, revoked_at
       ) VALUES (?, 1, ?, ?, ?, NULL)`,
    )
    .run(adminSessionHash, userSessionHash, NOW, FUTURE);
}

test("admin can move an arbitrary official identity to the separate internal-tool list", async () => {
  const { db, raw } = createMigratedD1();
  await seedAdmin(raw);
  raw
    .prepare(
      `INSERT INTO games (
         id, slug, publisher_type, publisher_user_id, visibility, live_version_id,
         deleted_at, created_at, updated_at
       ) VALUES (21, 'generic-protocol-fixture', 'OWOGG', NULL, 'PRIVATE', NULL, NULL, ?, ?)`,
    )
    .run(NOW, NOW);
  const env = { DB: db, FRONTEND_URL: "http://localhost:5173" } as any;

  const movedResponse = await app.request(
    "http://localhost/api/admin/games/generic-protocol-fixture/catalog-role",
    {
      method: "POST",
      headers: {
        Cookie: COOKIE,
        Origin: "http://localhost:5173",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ catalogRole: "INTERNAL_TOOL" }),
    },
    env,
  );
  assert.equal(movedResponse.status, 200);
  assert.equal(movedResponse.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(AdminGameCatalogRoleResponseSchema.parse(await movedResponse.json()), {
    gameId: "generic-protocol-fixture",
    catalogRole: "INTERNAL_TOOL",
  });

  const gameResponse = await app.request(
    "http://localhost/api/admin/games?catalogRole=GAME",
    { headers: { Cookie: COOKIE } },
    env,
  );
  const gamePage = AdminGameListResponseSchema.parse(await gameResponse.json());
  assert.equal(gamePage.total, 0);

  const toolResponse = await app.request(
    "http://localhost/api/admin/games?catalogRole=INTERNAL_TOOL",
    { headers: { Cookie: COOKIE } },
    env,
  );
  assert.equal(toolResponse.headers.get("Cache-Control"), "no-store");
  const toolPage = AdminGameListResponseSchema.parse(await toolResponse.json());
  assert.equal(toolPage.total, 1);
  assert.equal(toolPage.games[0]?.gameId, "generic-protocol-fixture");
  assert.equal(toolPage.games[0]?.catalogRole, "INTERNAL_TOOL");
  assert.equal(toolPage.games[0]?.catalogState, "NO_LIVE_VERSION");
});
