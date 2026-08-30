import assert from "node:assert/strict";
import test from "node:test";
import { filterLeaderboardGames } from "../features/scores/leaderboardGames";

test("Hall of Fame exposes only games with both leaderboard permission and score policy", () => {
  const games = [
    { slug: "typing-test", policy: { leaderboard: true, score: { unit: "점" } } },
    { slug: "official-omok", policy: { leaderboard: false, score: null } },
    { slug: "score-only", policy: { leaderboard: false, score: { unit: "pts" } } },
    { slug: "flag-only", policy: { leaderboard: true, score: null } },
  ];

  assert.deepEqual(
    filterLeaderboardGames(games).map((game) => game.slug),
    ["typing-test"],
  );
});
