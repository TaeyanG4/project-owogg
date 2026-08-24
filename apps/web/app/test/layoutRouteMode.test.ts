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

test("gameplay keeps the desktop rail and exposes an explicit hover-revealed expand control", () => {
  const layout = readFileSync(
    fileURLToPath(new URL("../components/layout/Layout.tsx", import.meta.url)),
    "utf8",
  );
  const sidebar = readFileSync(
    fileURLToPath(new URL("../components/layout/Sidebar.tsx", import.meta.url)),
    "utf8",
  );

  assert.doesNotMatch(layout, /overlayOnly/);
  assert.match(sidebar, /aria-expanded=\{isDesktopExpanded\}/);
  assert.match(sidebar, /group-hover\/sidebar:opacity-100/);
  assert.match(sidebar, /dict\.sidebar\.moreHeading/);
  assert.match(sidebar, /dict\.sidebar\.favorites/);
  assert.match(sidebar, /dict\.sidebar\.discordServers/);
  assert.match(sidebar, /SUPPORTED_LOCALES\.map/);
});
