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

test("desktop pages reserve the expanded rail while gameplay keeps a persisted manual control", () => {
  const layout = readFileSync(
    fileURLToPath(new URL("../components/layout/Layout.tsx", import.meta.url)),
    "utf8",
  );
  const sidebar = readFileSync(
    fileURLToPath(new URL("../components/layout/Sidebar.tsx", import.meta.url)),
    "utf8",
  );
  const styles = readFileSync(fileURLToPath(new URL("../app.css", import.meta.url)), "utf8");

  assert.match(layout, /isGamePlayPage=\{isGamePlayWorkspace\}/);
  assert.match(layout, /<div className="flex min-w-0 flex-1 flex-col">/);
  assert.match(layout, /isAdminWorkspace \? \(/);
  assert.match(layout, /!isGamePlayWorkspace && <Footer \/>/);
  assert.match(sidebar, /onMouseEnter=\{openAutoSidebar\}/);
  assert.match(sidebar, /expanded \? "w-56" : "w-16"/);
  assert.match(sidebar, /fixed bottom-0 left-0 top-16/);
  assert.match(sidebar, /flex h-full min-h-0 flex-col overflow-hidden p-2/);
  assert.match(sidebar, /flex shrink-0 flex-col gap-1\.5/);
  assert.match(sidebar, /data-sidebar-secondary-scroll/);
  assert.match(sidebar, /min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain/);
  assert.match(sidebar, /data-expanded=\{expanded\}/);
  assert.doesNotMatch(sidebar, /reserveExpandedWidth/);
  assert.match(sidebar, /GAMEPLAY_EXPANDED_KEY/);
  assert.match(sidebar, /aria-expanded=\{expanded\}/);
  assert.match(sidebar, /games\?view=genres/);
  assert.match(sidebar, /games\?playMode=single/);
  assert.match(sidebar, /games\?playMode=multi/);
  assert.doesNotMatch(sidebar, /dict\.sidebar\.moreHeading/);
  assert.doesNotMatch(sidebar, /dict\.sidebar\.favorites/);
  assert.match(sidebar, /dict\.sidebar\.discordServers/);
  assert.doesNotMatch(sidebar, /SUPPORTED_LOCALES\.map/);
  assert.equal(styles.match(/overflow-x: clip;/g)?.length, 2);
  assert.doesNotMatch(styles, /overflow-x: hidden;/);
});
