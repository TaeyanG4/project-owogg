import test from "node:test";
import assert from "node:assert/strict";
import type { PublicGameCard } from "../features/catalog/publicGameAdapter";
import {
  groupGamesByGenre,
  matchesGamePlayMode,
  matchesGameSearch,
  normalizeCatalogValue,
} from "../features/catalog/gameCatalogFilters";

function game(overrides: Partial<PublicGameCard> = {}): PublicGameCard {
  return {
    slug: "sample",
    title: "Sample",
    shortDescription: "Short description",
    description: "Long description",
    modes: ["single"],
    thumbnail: "",
    categories: [],
    tags: [],
    publisherType: "OWOGG",
    publisherName: "OWOGG",
    catalogType: "GENRE_MODE",
    publishedAt: "2026-09-01T00:00:00.000Z",
    playerCount: 0,
    bookmarkCount: 0,
    popularityScore: 0,
    genre: "Puzzle",
    ...overrides,
  };
}

test("catalog normalization groups Unicode width, whitespace, and case variants", () => {
  assert.equal(normalizeCatalogValue("  ＰＵＺＺＬＥ   Game "), "puzzle game");
  const groups = groupGamesByGenre(
    [game({ slug: "one", genre: "Puzzle" }), game({ slug: "two", genre: "  PUZZLE " })],
    "Other",
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.label, "Puzzle");
  assert.deepEqual(
    groups[0]?.games.map((item) => item.slug),
    ["one", "two"],
  );
});

test("catalog search includes title, descriptions, genre, and free-form tags", () => {
  const card = game({ tags: ["card-board"], description: "Team strategy" });
  assert.equal(matchesGameSearch(card, "CARD-BOARD"), true);
  assert.equal(matchesGameSearch(card, "strategy"), true);
  assert.equal(
    matchesGameSearch(card, "퍼즐", { title: "퍼즐 게임", shortDescription: "짧은 설명" }),
    true,
  );
  assert.equal(matchesGameSearch(card, "racing"), false);
});

test("single and multiplayer filters use exact declared play modes", () => {
  const hybrid = game({ modes: ["single", "online-multi"] });
  assert.equal(matchesGamePlayMode(hybrid, "single"), true);
  assert.equal(matchesGamePlayMode(hybrid, "multi"), true);
  assert.equal(matchesGamePlayMode(game({ modes: ["single"] }), "multi"), false);
});
