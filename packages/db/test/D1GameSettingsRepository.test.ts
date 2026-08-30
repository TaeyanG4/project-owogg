import assert from "node:assert/strict";
import test from "node:test";
import { D1GameSettingsRepository } from "../src/d1/D1GameSettingsRepository.js";
import { createSqliteD1 } from "./helpers/sqliteD1.js";

const SCHEMA = `
CREATE TABLE game_settings (
  game_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  disabled_reason TEXT,
  updated_by_admin_id INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  catalog_role TEXT NOT NULL DEFAULT 'GAME'
    CHECK (catalog_role IN ('GAME', 'INTERNAL_TOOL'))
);
`;

test("catalog role is independent from the emergency safety switch", async () => {
  const { db } = createSqliteD1(SCHEMA);
  const repository = new D1GameSettingsRepository(db);

  await repository.setEnabled("generic-fixture", false, "maintenance", 3);
  const internal = await repository.setCatalogRole("generic-fixture", "INTERNAL_TOOL", 9);
  assert.equal(internal.enabled, false);
  assert.equal(internal.disabledReason, "maintenance");
  assert.equal(internal.catalogRole, "INTERNAL_TOOL");
  assert.deepEqual(await repository.getDisabledGameIds(), ["generic-fixture"]);
  assert.deepEqual(await repository.getPublicCatalogExcludedGameIds(), ["generic-fixture"]);

  const enabled = await repository.setEnabled("generic-fixture", true, null, 10);
  assert.equal(enabled.catalogRole, "INTERNAL_TOOL");
  assert.deepEqual(await repository.getDisabledGameIds(), []);
  assert.deepEqual(await repository.getPublicCatalogExcludedGameIds(), ["generic-fixture"]);
});
