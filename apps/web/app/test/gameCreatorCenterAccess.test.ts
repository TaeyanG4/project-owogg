import test from "node:test";
import assert from "node:assert/strict";
import {
  gameCreatorCenterEntry,
  requiresGameCreatorAccess,
  resolveGameCreatorCenterTool,
} from "../features/gameCreatorCenterAccess";

test("external introductions are a regular signed-in player tool", () => {
  const tool = resolveGameCreatorCenterTool("external");
  assert.equal(tool, "EXTERNAL");
  assert.equal(requiresGameCreatorAccess(tool), false);
});

test("OwOGG uploads remain inside the Game Creator entitlement", () => {
  const tool = resolveGameCreatorCenterTool(null);
  assert.equal(tool, "OWOGG");
  assert.equal(requiresGameCreatorAccess(tool), true);
});

test("unknown tool query values fail closed to the entitled OwOGG surface", () => {
  const tool = resolveGameCreatorCenterTool("unexpected");
  assert.equal(tool, "OWOGG");
  assert.equal(requiresGameCreatorAccess(tool), true);
});

test("a player without Game Creator access lands on external introductions", () => {
  assert.deepEqual(
    gameCreatorCenterEntry({ hasAccess: false, canApply: false, applicationStatus: null }),
    { to: "/game-creator?tool=external", label: "타 플랫폼 게임 소개" },
  );
});

test("a Game Creator lands on the OwOGG upload center", () => {
  assert.deepEqual(
    gameCreatorCenterEntry({ hasAccess: true, canApply: false, applicationStatus: null }),
    { to: "/game-creator", label: "게임 크리에이터 센터" },
  );
});
