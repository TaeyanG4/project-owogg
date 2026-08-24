import test from "node:test";
import assert from "node:assert/strict";
import type { PublicGame } from "@owogg/contracts";
import { publicGameToCard } from "../features/catalog/publicGameAdapter";

function baseGame(overrides: Partial<PublicGame> = {}): PublicGame {
  return {
    publisherType: "OWOGG",
    publisherName: "OWOGG",
    slug: "reaction-time",
    title: "반응속도 테스트",
    shortDescription: "빠르게 눌러보세요",
    description: "반응속도를 측정합니다.",
    catalog: {
      type: "TAXONOMY",
      categories: ["skill"],
      tags: ["fast"],
      modes: ["single"],
      inputMethods: ["mouse"],
      minPlayers: 1,
      maxPlayers: 1,
      thumbnail: "/reaction.svg",
    },
    policy: {
      score: { unit: "ms", direction: "asc", min: 0, max: 10_000 },
      leaderboard: true,
      xpPerCompletion: 1,
      requiresAuth: false,
    },
    supportsReplay: false,
    publishedAt: "2026-08-01T00:00:00.000Z",
    stats: { playerCount: 12, bookmarkCount: 4, popularityScore: 24 },
    mediaUrl: null,
    ...overrides,
  } as PublicGame;
}

test("TAXONOMY public games preserve canonical catalog metadata in the card view model", () => {
  const card = publicGameToCard(baseGame());
  assert.deepEqual(card.categories, ["skill"]);
  assert.deepEqual(card.tags, ["fast"]);
  assert.deepEqual(card.modes, ["single"]);
  assert.equal(card.thumbnail, "");
  assert.equal(card.catalogType, "TAXONOMY");
  assert.equal(card.publishedAt, "2026-08-01T00:00:00.000Z");
  assert.equal(card.playerCount, 12);
  assert.equal(card.bookmarkCount, 4);
  assert.equal(card.popularityScore, 24);
});

test("GENRE_MODE USER games do not receive invented taxonomy metadata", () => {
  const card = publicGameToCard(
    baseGame({
      publisherType: "USER",
      publisherName: "Taeyang",
      slug: "ball-dodge",
      title: "공 피하기",
      catalog: { type: "GENRE_MODE", genre: "arcade", mode: "multi" },
    }),
  );
  assert.equal(card.publisherType, "USER");
  assert.equal(card.genre, "arcade");
  assert.deepEqual(card.categories, []);
  assert.deepEqual(card.tags, []);
  assert.deepEqual(card.modes, ["multi"]);
  assert.equal(card.thumbnail, "");
});
