/** Hall-of-Fame selectors come from the server-projected policy, not a slug allowlist or a
 * game-specific exception. A score contract alone is not permission to publish rankings, and a
 * leaderboard flag without a score shape cannot format or order records safely. */
export function filterLeaderboardGames<
  T extends {
    readonly policy: {
      readonly leaderboard: boolean;
      readonly score: unknown | null;
    };
  },
>(games: readonly T[]): T[] {
  return games.filter((game) => game.policy.leaderboard && game.policy.score !== null);
}
