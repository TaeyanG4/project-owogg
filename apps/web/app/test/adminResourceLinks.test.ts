import assert from "node:assert/strict";
import test from "node:test";
import { ADMIN_RESOURCE_LINKS, resolveAdminDataTargets } from "../features/adminResourceLinks";

test("admin resource links provide unique HTTPS destinations for D1, B2 and operations", () => {
  const ids = ADMIN_RESOURCE_LINKS.map((link) => link.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids.slice(0, 2), ["d1", "b2"]);
  assert.ok(ids.includes("workers"));
  assert.ok(ids.includes("actions"));
  assert.ok(ADMIN_RESOURCE_LINKS.every((link) => link.href.startsWith("https://")));
});

test("admin resource targets keep Staging and Production data names distinct", () => {
  const staging = resolveAdminDataTargets("stg.owogg.com");
  const production = resolveAdminDataTargets("www.owogg.com");

  assert.deepEqual(staging, {
    environment: "staging",
    environmentLabel: "Staging",
    d1Database: "owogg-d1-staging",
    b2Bucket: "owogg-game-bundles-staging",
  });
  assert.deepEqual(production, {
    environment: "production",
    environmentLabel: "Production",
    d1Database: "owogg-d1",
    b2Bucket: "owogg-game-bundles",
  });
});

test("admin resource targets fail visibly to a manual choice outside deployed hosts", () => {
  const local = resolveAdminDataTargets("localhost");
  assert.equal(local.environment, "local");
  assert.match(local.environmentLabel, /대상 확인 필요/);
  assert.match(local.d1Database, /staging/);
  assert.match(local.b2Bucket, /staging/);
});
