import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isGamePlayPath } from "../components/layout/Layout";

test("only a concrete live game route enables the gameplay shell", () => {
  assert.equal(isGamePlayPath("/games/reaction-time"), true);
  assert.equal(isGamePlayPath("/games/reaction-time/"), true);
  assert.equal(isGamePlayPath("/games"), false);
  assert.equal(isGamePlayPath("/games/reaction-time/ranking"), false);
  assert.equal(isGamePlayPath("/ranking"), false);
});

test("catalog auto-expands the desktop rail while gameplay keeps a persisted manual control", () => {
  const layout = readFileSync(
    fileURLToPath(new URL("../components/layout/Layout.tsx", import.meta.url)),
    "utf8",
  );
  const sidebar = readFileSync(
    fileURLToPath(new URL("../components/layout/Sidebar.tsx", import.meta.url)),
    "utf8",
  );

  assert.match(layout, /isGamePlayPage=\{isGamePlayWorkspace\}/);
  assert.match(sidebar, /onMouseEnter=\{openAutoSidebar\}/);
  assert.match(sidebar, /expanded && \(isGamePlayPage \|\| reserveExpandedWidth\)/);
  assert.match(sidebar, /GAMEPLAY_EXPANDED_KEY/);
  assert.match(sidebar, /aria-expanded=\{expanded\}/);
  assert.match(sidebar, /games\?view=genres/);
  assert.match(sidebar, /games\?playMode=single/);
  assert.match(sidebar, /games\?playMode=multi/);
  assert.doesNotMatch(sidebar, /dict\.sidebar\.moreHeading/);
  assert.doesNotMatch(sidebar, /dict\.sidebar\.favorites/);
  assert.match(sidebar, /dict\.sidebar\.discordServers/);
  assert.doesNotMatch(sidebar, /SUPPORTED_LOCALES\.map/);
});
