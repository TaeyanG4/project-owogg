import test from "node:test";
import assert from "node:assert/strict";
import {
  projectGameCreatorStatus,
  type GameCreatorStatusSource,
} from "../src/modules/game/domain/gameCreatorStatus.js";

function row(overrides: Partial<GameCreatorStatusSource> = {}): GameCreatorStatusSource {
  return {
    liveVersionId: null,
    visibility: "PRIVATE",
    deletedAt: null,
    ...overrides,
  };
}

test("liveVersionId null -> draft, regardless of visibility", () => {
  assert.equal(
    projectGameCreatorStatus(row({ liveVersionId: null, visibility: "PRIVATE" })),
    "draft",
  );
  assert.equal(
    projectGameCreatorStatus(row({ liveVersionId: null, visibility: "PUBLIC" })),
    "draft",
  );
});

test("liveVersionId set + visibility PRIVATE -> hidden", () => {
  assert.equal(
    projectGameCreatorStatus(row({ liveVersionId: 4, visibility: "PRIVATE" })),
    "hidden",
  );
});

test("liveVersionId set + visibility PUBLIC -> published", () => {
  assert.equal(
    projectGameCreatorStatus(row({ liveVersionId: 4, visibility: "PUBLIC" })),
    "published",
  );
});

test("never produces 'beta' — Creator status is a strict draft|hidden|published subset", () => {
  for (const liveVersionId of [null, 1]) {
    for (const visibility of ["PRIVATE", "PUBLIC"] as const) {
      const status = projectGameCreatorStatus(row({ liveVersionId, visibility }));
      assert.notEqual(status, "beta");
      assert.ok(["draft", "hidden", "published"].includes(status));
    }
  }
});

test("fail closed: a soft-deleted row throws rather than silently projecting a status", () => {
  assert.throws(
    () => projectGameCreatorStatus(row({ deletedAt: "2026-01-01T00:00:00.000Z" })),
    /soft-deleted row/,
  );
});
