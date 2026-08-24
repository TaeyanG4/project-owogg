import assert from "node:assert/strict";
import test from "node:test";
import { sortPublicGameCards } from "../features/catalog/gameSort.js";
import type { PublicGameCard } from "../features/catalog/publicGameAdapter.js";

function game(
  slug: string,
  publishedAt: string,
  playerCount: number,
  bookmarkCount: number,
): PublicGameCard {
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
    publishedAt,
    playerCount,
    bookmarkCount,
    popularityScore: playerCount + bookmarkCount * 3,
  };
}

const games = [
  game("most-played", "2026-08-01T00:00:00.000Z", 100, 1),
  game("most-bookmarked", "2026-08-02T00:00:00.000Z", 5, 40),
  game("newest", "2026-08-03T00:00:00.000Z", 1, 0),
];

test("catalog sorting supports newest, players, bookmarks and weighted popularity", () => {
  assert.deepEqual(
    sortPublicGameCards(games, "newest").map((item) => item.slug),
    ["newest", "most-bookmarked", "most-played"],
  );
  assert.equal(sortPublicGameCards(games, "players")[0]?.slug, "most-played");
  assert.equal(sortPublicGameCards(games, "bookmarks")[0]?.slug, "most-bookmarked");
  assert.equal(sortPublicGameCards(games, "popular")[0]?.slug, "most-bookmarked");
  assert.deepEqual(
    games.map((item) => item.slug),
    ["most-played", "most-bookmarked", "newest"],
  );
});
