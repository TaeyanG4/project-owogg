import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  findAdminNavigationItem,
  getVisibleAdminNavigation,
  isAdminNavigationItemActive,
} from "../components/admin/adminNavigation";

const flattenIds = (groups: ReturnType<typeof getVisibleAdminNavigation>) =>
  groups.flatMap((group) => group.items.map((item) => item.id));

test("admin navigation shows the full workspace to an elevated ADMIN", () => {
  const ids = flattenIds(
    getVisibleAdminNavigation({ elevated: true, role: "ADMIN", permissions: [] }),
  );
  assert.ok(ids.includes("dashboard"));
  assert.ok(ids.includes("games"));
  assert.ok(ids.includes("accounts"));
  assert.equal(
    ids.some((id) => id.endsWith("-center")),
    false,
  );
});

test("admin navigation filters sections by effective permissions", () => {
  const ids = flattenIds(
    getVisibleAdminNavigation({
      elevated: true,
      role: "MODERATOR",
      permissions: ["admin.center.access", "users.view", "sandbox_games.review"],
    }),
  );
  assert.deepEqual(ids, ["dashboard", "games", "users", "security"]);
  assert.equal(ids.includes("accounts"), false);
  assert.equal(ids.includes("monitoring"), false);
});

test("non-elevated visitors only see the dashboard entry", () => {
  const ids = flattenIds(
    getVisibleAdminNavigation({ elevated: false, role: null, permissions: [] }),
  );
  assert.deepEqual(ids, ["dashboard"]);
});

test("admin navigation search matches labels and descriptions", () => {
  const ids = flattenIds(
    getVisibleAdminNavigation({ elevated: true, role: "ADMIN", permissions: [] }, "세션"),
  );
  assert.deepEqual(ids, ["accounts"]);
});

test("legacy sandbox route resolves to the unified games navigation entry", () => {
  const item = findAdminNavigationItem("/admin/sandbox-games");
  assert.equal(item?.id, "games");
  assert.equal(item ? isAdminNavigationItemActive(item, "/admin/sandbox-games/42") : false, true);
});

test("admin routes keep the service sidebar and use a separate mobile admin drawer", () => {
  const layout = readFileSync(
    fileURLToPath(new URL("../components/layout/Layout.tsx", import.meta.url)),
    "utf8",
  );
  const workspace = readFileSync(
    fileURLToPath(new URL("../components/admin/AdminWorkspace.tsx", import.meta.url)),
    "utf8",
  );

  const serviceSidebarIndex = layout.indexOf("<Sidebar");
  const adminConditionalIndex = layout.indexOf("{isAdminWorkspace ? (");
  assert.ok(serviceSidebarIndex > -1 && serviceSidebarIndex < adminConditionalIndex);
  assert.match(layout, /isMobileAdminSidebarOpen/);
  assert.match(workspace, /aria-label="관리자 메뉴 열기"/);
});
