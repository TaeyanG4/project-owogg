import assert from "node:assert/strict";
import test from "node:test";
import { D1PlatformFeatureSettingsRepository } from "../src/d1/D1PlatformFeatureSettingsRepository.js";
import { createSqliteD1 } from "./helpers/sqliteD1.js";

const SCHEMA = `
CREATE TABLE platform_feature_settings (
  setting_key TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  updated_by_admin_id INTEGER,
  updated_at TEXT NOT NULL
);
`;

test("platform feature settings use safe defaults when no rows exist", async () => {
  const { db } = createSqliteD1(SCHEMA);
  const repository = new D1PlatformFeatureSettingsRepository(db);

  assert.deepEqual(await repository.get(), {
    multiplayerEnabled: true,
    externalPlatformGamesVisible: false,
  });
});

test("partial setting updates preserve the other value and record their actor", async () => {
  const { db, raw } = createSqliteD1(SCHEMA);
  const repository = new D1PlatformFeatureSettingsRepository(db);

  assert.deepEqual(
    await repository.set({
      multiplayerEnabled: false,
      adminId: 7,
      nowIso: "2026-09-01T00:00:00.000Z",
    }),
    { multiplayerEnabled: false, externalPlatformGamesVisible: false },
  );
  assert.deepEqual(
    await repository.set({
      externalPlatformGamesVisible: true,
      adminId: 9,
      nowIso: "2026-09-01T01:00:00.000Z",
    }),
    { multiplayerEnabled: false, externalPlatformGamesVisible: true },
  );

  const storedRows = raw
    .prepare(
      `SELECT setting_key, enabled, updated_by_admin_id, updated_at
       FROM platform_feature_settings
       ORDER BY setting_key`,
    )
    .all()
    .map((row) => ({ ...row }));
  assert.deepEqual(storedRows, [
    {
      setting_key: "EXTERNAL_PLATFORM_GAMES",
      enabled: 1,
      updated_by_admin_id: 9,
      updated_at: "2026-09-01T01:00:00.000Z",
    },
    {
      setting_key: "MULTIPLAYER",
      enabled: 0,
      updated_by_admin_id: 7,
      updated_at: "2026-09-01T00:00:00.000Z",
    },
  ]);
});
