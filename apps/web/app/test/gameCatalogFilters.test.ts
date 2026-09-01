import test from "node:test";
import assert from "node:assert/strict";
import type { PublicGameCard } from "../features/catalog/publicGameAdapter";
import {
  groupGamesByGenre,
  matchesGamePlayMode,
  matchesGameSearch,
  normalizeCatalogValue,
} from "../features/catalog/gameCatalogFilters";
import { resolveGameGenre, type GameGenreLabels } from "../features/catalog/gameGenres";

const GENRE_LABELS: GameGenreLabels = {
  skillTest: "스킬 테스트",
  board: "보드게임",
  action: "액션",
  adventure: "어드벤처",
  arcade: "아케이드",
  casual: "캐주얼",
  puzzle: "퍼즐",
  strategy: "전략",
  party: "파티",
  sports: "스포츠",
  racing: "레이싱",
  rhythm: "리듬",
  simulation: "시뮬레이션",
  rolePlaying: "RPG",
  shooter: "슈팅",
  fighting: "격투",
  platformer: "플랫포머",
  educational: "교육",
  other: "기타",
};

const resolveGenre = (genre: string | undefined) => resolveGameGenre(genre, GENRE_LABELS, "기타");

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
    resolveGenre,
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.label, "퍼즐");
  assert.deepEqual(
    groups[0]?.games.map((item) => item.slug),
    ["one", "two"],
  );
});

test("legacy detailed official genres become one localized skill-test group", () => {
  const groups = groupGamesByGenre(
    ["typing", "reaction", "brain", "skill", "board"].map((genre, index) =>
      game({ slug: `game-${index}`, genre }),
    ),
    resolveGenre,
  );

  assert.equal(groups.length, 2);
  assert.equal(groups.find((group) => group.key === "skill-test")?.label, "스킬 테스트");
  assert.equal(groups.find((group) => group.key === "skill-test")?.games.length, 4);
  assert.equal(groups.find((group) => group.key === "board")?.label, "보드게임");
});

test("catalog search includes title, descriptions, genre, and free-form tags", () => {
  const card = game({ tags: ["card-board"], description: "Team strategy" });
  assert.equal(matchesGameSearch(card, "CARD-BOARD"), true);
  assert.equal(matchesGameSearch(card, "strategy"), true);
  assert.equal(
    matchesGameSearch(card, "보드게임", {
      title: "퍼즐 게임",
      shortDescription: "짧은 설명",
      genre: "보드게임",
    }),
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
