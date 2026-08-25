import test from "node:test";
import assert from "node:assert/strict";
import { D1ProgressionRepository } from "../src/d1/D1ProgressionRepository.js";
import type { D1Database } from "../src/d1/D1UserRepository.js";

interface XpEventRow {
  id: number;
  user_id: number;
  amount: number;
  reason: string;
  source_type: string;
  source_id: string;
  game_id: string | null;
  created_at: string;
}

interface UserProgressRow {
  user_id: number;
  total_xp: number;
  eligible_completions: number;
  updated_at: string;
}

/**
 * Minimal in-memory D1 double that mirrors the exact SQL D1ProgressionRepository issues,
 * including UNIQUE constraint semantics (via meta.changes) and D1's `date('now')` UTC
 * date comparison, so the repository's real idempotency/cap logic runs unmodified.
 */
function createMockD1(): {
  db: D1Database;
  xpEvents: XpEventRow[];
  userProgress: Map<number, UserProgressRow>;
} {
  const xpEvents: XpEventRow[] = [];
  const userProgress = new Map<number, UserProgressRow>();
  const users = new Map<number, { id: number; nickname: string; avatar_url: string | null }>([
    [1, { id: 1, nickname: "Alice", avatar_url: null }],
    [2, { id: 2, nickname: "Bob", avatar_url: null }],
  ]);
  let nextEventId = 1;
  let lastChanges = 0;

  const db: D1Database = {
    prepare(query: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          bound = args;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          if (query.includes("FROM xp_events") && query.includes("source_type = ? AND source_id")) {
            const [sourceType, sourceId] = bound as [string, string];
            const found = xpEvents.find(
              (event) => event.source_type === sourceType && event.source_id === sourceId,
            );
            return found ? ({ id: found.id, amount: found.amount } as unknown as T) : null;
          }
          if (query.startsWith("SELECT user_id, total_xp, eligible_completions")) {
            const [userId] = bound as [number];
            const row = userProgress.get(userId);
            return (row ?? null) as unknown as T;
          }
          if (query.includes("COUNT(*) as ahead")) {
            const [totalXp] = bound as [number];
            const ahead = Array.from(userProgress.values()).filter(
              (progress) => progress.total_xp > totalXp,
            ).length;
            return { ahead } as unknown as T;
          }
          return null;
        },
        async all<T = unknown>(): Promise<{ results: T[] }> {
          if (query.includes("JOIN users")) {
            const [limit] = bound as [number];
            const rows = Array.from(userProgress.values())
              .sort((left, right) => right.total_xp - left.total_xp || left.user_id - right.user_id)
              .slice(0, limit)
              .map((progress) => ({
                user_id: progress.user_id,
                nickname: users.get(progress.user_id)?.nickname ?? "Unknown",
                avatar_url: users.get(progress.user_id)?.avatar_url ?? null,
                total_xp: progress.total_xp,
              }));
            return { results: rows as unknown as T[] };
          }
          return { results: [] };
        },
        async run(): Promise<{ success: boolean; meta?: { changes?: number } }> {
          if (query.startsWith("INSERT INTO xp_events")) {
            const [
              userId,
              capUserId,
              capGameId,
              startOfDay,
              startOfNextDay,
              dailyCap,
              xpPerCompletion,
              sourceType,
              sourceId,
              gameId,
              createdAt,
            ] = bound as [
              number,
              number,
              string,
              string,
              string,
              number,
              number,
              string,
              string,
              string,
              string,
            ];
            const conflict = xpEvents.some(
              (event) => event.source_type === sourceType && event.source_id === sourceId,
            );
            if (conflict) {
              lastChanges = 0;
              return { success: true, meta: { changes: 0 } };
            }
            const awardedToday = xpEvents.filter(
              (event) =>
                event.user_id === capUserId &&
                event.game_id === capGameId &&
                event.amount > 0 &&
                event.created_at >= startOfDay &&
                event.created_at < startOfNextDay,
            ).length;
            xpEvents.push({
              id: nextEventId++,
              user_id: userId,
              amount: awardedToday < dailyCap ? xpPerCompletion : 0,
              reason: "GAME_COMPLETION",
              source_type: sourceType,
              source_id: sourceId,
              game_id: gameId,
              created_at: createdAt,
            });
            lastChanges = 1;
            return { success: true, meta: { changes: 1 } };
          }

          if (query.startsWith("INSERT INTO user_progress")) {
            const previousStatementChanged = lastChanges;
            const [userId, updatedAt, sourceType, sourceId] = bound as [
              number,
              string,
              string,
              string,
            ];
            if (previousStatementChanged !== 1) {
              lastChanges = 0;
              return { success: true, meta: { changes: 0 } };
            }
            const event = xpEvents.find(
              (candidate) =>
                candidate.source_type === sourceType && candidate.source_id === sourceId,
            );
            if (!event) throw new Error("mock xp event missing");
            const existing = userProgress.get(userId);
            userProgress.set(userId, {
              user_id: userId,
              total_xp: (existing?.total_xp ?? 0) + event.amount,
              eligible_completions: (existing?.eligible_completions ?? 0) + 1,
              updated_at: updatedAt,
            });
            lastChanges = 1;
            return { success: true, meta: { changes: 1 } };
          }

          lastChanges = 0;
          return { success: true, meta: { changes: 0 } };
        },
      };
      return stmt as unknown as ReturnType<D1Database["prepare"]>;
    },
    async batch(statements) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  };

  return { db, xpEvents, userProgress };
}
test("recordGameCompletion awards XP and records the completion on first attempt", async () => {
  const { db } = createMockD1();
  const repo = new D1ProgressionRepository(db);

  const outcome = await repo.recordGameCompletion({
    userId: 1,
    gameId: "reaction-time",
    sourceType: "score",
    sourceId: "1",
    xpPerCompletion: 10,
    dailyCapPerGame: 10,
  });

  assert.equal(outcome.duplicate, false);
  assert.equal(outcome.xpAwarded, 10);
  assert.equal(outcome.totalXp, 10);
  assert.equal(outcome.eligibleCompletions, 1);
});

test("recordGameCompletion is idempotent for the same source event", async () => {
  const { db } = createMockD1();
  const repo = new D1ProgressionRepository(db);

  await repo.recordGameCompletion({
    userId: 1,
    gameId: "reaction-time",
    sourceType: "score",
    sourceId: "1",
    xpPerCompletion: 10,
    dailyCapPerGame: 10,
  });
  const replay = await repo.recordGameCompletion({
    userId: 1,
    gameId: "reaction-time",
    sourceType: "score",
    sourceId: "1",
    xpPerCompletion: 10,
    dailyCapPerGame: 10,
  });

  assert.equal(replay.duplicate, true);
  assert.equal(replay.xpAwarded, 0);
  assert.equal(replay.totalXp, 10); // unchanged
});

test("recordGameCompletion enforces the daily per-game cap but keeps counting completions", async () => {
  const { db } = createMockD1();
  const repo = new D1ProgressionRepository(db);

  let last;
  for (let i = 0; i < 12; i++) {
    last = await repo.recordGameCompletion({
      userId: 1,
      gameId: "reaction-time",
      sourceType: "score",
      sourceId: String(i),
      xpPerCompletion: 10,
      dailyCapPerGame: 10,
    });
  }

  assert.equal(last?.xpAwarded, 0);
  assert.equal(last?.totalXp, 100);
  assert.equal(last?.eligibleCompletions, 12);
});

test("getXpLeaderboard sorts by total XP descending", async () => {
  const { db } = createMockD1();
  const repo = new D1ProgressionRepository(db);

  await repo.recordGameCompletion({
    userId: 1,
    gameId: "reaction-time",
    sourceType: "score",
    sourceId: "u1-1",
    xpPerCompletion: 10,
    dailyCapPerGame: 10,
  });
  await repo.recordGameCompletion({
    userId: 2,
    gameId: "reaction-time",
    sourceType: "score",
    sourceId: "u2-1",
    xpPerCompletion: 10,
    dailyCapPerGame: 10,
  });
  await repo.recordGameCompletion({
    userId: 2,
    gameId: "memory-test",
    sourceType: "score",
    sourceId: "u2-2",
    xpPerCompletion: 10,
    dailyCapPerGame: 10,
  });

  const leaderboard = await repo.getXpLeaderboard(10);
  assert.equal(leaderboard[0]?.userId, 2);
  assert.equal(leaderboard[0]?.totalXp, 20);
  assert.equal(leaderboard[0]?.nickname, "Bob");
  assert.equal(leaderboard[1]?.userId, 1);
});

test("getGlobalXpRank reflects standings and getUserProgress returns null before any XP", async () => {
  const { db } = createMockD1();
  const repo = new D1ProgressionRepository(db);

  assert.equal(await repo.getUserProgress(1), null);
  assert.equal(await repo.getGlobalXpRank(1), null);

  await repo.recordGameCompletion({
    userId: 1,
    gameId: "reaction-time",
    sourceType: "score",
    sourceId: "a",
    xpPerCompletion: 10,
    dailyCapPerGame: 10,
  });
  await repo.recordGameCompletion({
    userId: 2,
    gameId: "reaction-time",
    sourceType: "score",
    sourceId: "b",
    xpPerCompletion: 10,
    dailyCapPerGame: 10,
  });
  await repo.recordGameCompletion({
    userId: 2,
    gameId: "memory-test",
    sourceType: "score",
    sourceId: "c",
    xpPerCompletion: 10,
    dailyCapPerGame: 10,
  });

  assert.equal(await repo.getGlobalXpRank(2), 1);
  assert.equal(await repo.getGlobalXpRank(1), 2);
});
