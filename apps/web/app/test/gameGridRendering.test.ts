import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GameGrid } from "../components/ui/GameGrid";

const emptyGridProps = {
  games: [],
  mobileColumns: 2,
  desktopColumns: 4,
} as const;

test("GameGrid distinguishes a pending catalog read from a confirmed empty result", () => {
  const loading = renderToStaticMarkup(
    createElement(GameGrid, {
      ...emptyGridProps,
      loading: true,
      loadingMessage: "Loading catalog",
      emptyMessage: "No matching games",
    }),
  );
  assert.match(loading, /Loading catalog/);
  assert.doesNotMatch(loading, /No matching games/);

  const empty = renderToStaticMarkup(
    createElement(GameGrid, {
      ...emptyGridProps,
      loading: false,
      loadingMessage: "Loading catalog",
      emptyMessage: "No matching games",
    }),
  );
  assert.match(empty, /No matching games/);
  assert.doesNotMatch(empty, /Loading catalog/);
});
