import test from "node:test";
import assert from "node:assert/strict";
import { selectRecommendedGameCards } from "../features/game/gameRecommendations";
import type { PublicGameCard } from "../features/catalog/publicGameAdapter";

function game(slug: string, overrides: Partial<PublicGameCard> = {}): PublicGameCard {
  return {
    slug,
    title: slug,
    shortDescription: slug,
    description: slug,
    modes: ["single"],
    thumbnail: "",
    categories: [],
    tags: [],
    publisherType: "OWOGG",
    publisherName: "OWOGG",
    catalogType: "GENRE_MODE",
    genre: "arcade",
    publishedAt: "2026-01-01T00:00:00.000Z",
    playerCount: 0,
    bookmarkCount: 0,
    popularityScore: 0,
    ...overrides,
  };
}

test("recommendations prioritize similarity, then popularity, and exclude the current game", () => {
  const current = game("current", { categories: ["reaction"], tags: ["speed"] });
  const recommendations = selectRecommendedGameCards(
    [
      current,
      game("popular-unrelated", { genre: "puzzle", popularityScore: 999 }),
      game("same-genre-low", { popularityScore: 1 }),
      game("same-genre-high", { popularityScore: 10 }),
      game("same-category", {
        genre: "puzzle",
        categories: ["reaction"],
        tags: ["speed"],
      }),
    ],
    current,
    3,
  );

  assert.deepEqual(
    recommendations.map(({ slug }) => slug),
    ["same-category", "same-genre-high", "same-genre-low"],
  );
});

test("recommendations respect zero and positive limits", () => {
  const current = game("current");
  assert.deepEqual(selectRecommendedGameCards([current, game("other")], current, 0), []);
  assert.deepEqual(
    selectRecommendedGameCards([current, game("other")], current, 1).map(({ slug }) => slug),
    ["other"],
  );
});
