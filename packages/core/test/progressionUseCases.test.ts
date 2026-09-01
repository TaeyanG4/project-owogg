import test from "node:test";
import assert from "node:assert/strict";
import { ProgressionUseCases } from "../src/application/progressionUseCases.js";
import type {
  ProgressionRepository,
  RecordCompletionOutcome,
  UserProgress,
  XpLeaderboardEntry,
} from "../src/ports/repositories.js";

/** In-memory fake that mirrors the real D1 repository's idempotency + daily-cap semantics. */
class FakeProgressionRepository implements ProgressionRepository {
  private seenSources = new Set<string>();
  private progress = new Map<number, UserProgress>();
  private eventsToday = new Map<string, number>(); // key: `${userId}:${gameId}` -> count

  async recordGameCompletion(input: {
    userId: number;
    gameId: string;
    sourceType: string;
    sourceId: string;
    xpPerCompletion: number;
    dailyCapPerGame: number;
  }): Promise<RecordCompletionOutcome> {
    const sourceKey = `${input.sourceType}:${input.sourceId}`;
    const current = this.progress.get(input.userId) ?? {
      user_id: input.userId,
      total_xp: 0,
      eligible_completions: 0,
      updated_at: new Date().toISOString(),
    };

    if (this.seenSources.has(sourceKey)) {
      return {
        duplicate: true,
        xpAwarded: 0,
        totalXp: current.total_xp,
        eligibleCompletions: current.eligible_completions,
      };
    }
    this.seenSources.add(sourceKey);

    const dayKey = `${input.userId}:${input.gameId}`;
    const todayCount = this.eventsToday.get(dayKey) ?? 0;
    const underCap = todayCount < input.dailyCapPerGame;
    const xpAwarded = underCap ? input.xpPerCompletion : 0;
    if (underCap) this.eventsToday.set(dayKey, todayCount + 1);

    const updated: UserProgress = {
      user_id: input.userId,
      total_xp: current.total_xp + xpAwarded,
      eligible_completions: current.eligible_completions + 1,
      updated_at: new Date().toISOString(),
    };
    this.progress.set(input.userId, updated);

    return {
      duplicate: false,
      xpAwarded,
      totalXp: updated.total_xp,
      eligibleCompletions: updated.eligible_completions,
    };
  }

  async getUserProgress(userId: number): Promise<UserProgress | null> {
    return this.progress.get(userId) ?? null;
  }

  async getXpLeaderboard(limit: number): Promise<XpLeaderboardEntry[]> {
    return Array.from(this.progress.values())
      .sort((a, b) => b.total_xp - a.total_xp)
      .slice(0, limit)
      .map((p) => ({
        userId: p.user_id,
        nickname: `user-${p.user_id}`,
        avatarUrl: null,
        totalXp: p.total_xp,
      }));
  }

  async getGlobalXpRank(userId: number): Promise<number | null> {
    const target = this.progress.get(userId);
    if (!target) return null;
    const ahead = Array.from(this.progress.values()).filter(
      (p) => p.total_xp > target.total_xp,
    ).length;
    return ahead + 1;
  }

  async getDailyCompletionCounts(): Promise<[]> {
    return [];
  }
}

test("recordAcceptedGameCompletion awards XP for an accepted authenticated completion", async () => {
  const repo = new FakeProgressionRepository();
  const useCases = new ProgressionUseCases(repo);

  const result = await useCases.recordAcceptedGameCompletion({
    userId: 1,
    gameId: "reaction-time",
    sourceId: "score-1",
  });

  assert.equal(result.duplicate, false);
  assert.equal(result.xpAwarded, 10);
  assert.equal(result.capped, false);
  assert.equal(result.progress.totalXp, 10);
  assert.equal(result.progress.level, 1);
});

test("replaying the same source event never duplicates XP", async () => {
  const repo = new FakeProgressionRepository();
  const useCases = new ProgressionUseCases(repo);

  await useCases.recordAcceptedGameCompletion({
    userId: 1,
    gameId: "reaction-time",
    sourceId: "score-1",
  });
  const replay = await useCases.recordAcceptedGameCompletion({
    userId: 1,
    gameId: "reaction-time",
    sourceId: "score-1",
  });

  assert.equal(replay.duplicate, true);
  assert.equal(replay.xpAwarded, 0);

  const { summary } = await useCases.getProgressionSummary(1);
  assert.equal(summary.totalXp, 10); // still only one award
});

test("daily per-game XP cap stops granting XP after 10 accepted completions, per game", async () => {
  const repo = new FakeProgressionRepository();
  const useCases = new ProgressionUseCases(repo);

  let lastResult;
  for (let i = 0; i < 12; i++) {
    lastResult = await useCases.recordAcceptedGameCompletion({
      userId: 1,
      gameId: "reaction-time",
      sourceId: `score-${i}`,
    });
  }

  const { summary, eligibleCompletions } = await useCases.getProgressionSummary(1);
  assert.equal(summary.totalXp, 100); // 10 completions x 10 XP, capped
  assert.equal(eligibleCompletions, 12); // completion counting is uncapped
  assert.equal(lastResult?.capped, true);
  assert.equal(lastResult?.xpAwarded, 0);
});

test("daily cap is independent per game — a second game keeps earning XP", async () => {
  const repo = new FakeProgressionRepository();
  const useCases = new ProgressionUseCases(repo);

  for (let i = 0; i < 10; i++) {
    await useCases.recordAcceptedGameCompletion({
      userId: 1,
      gameId: "reaction-time",
      sourceId: `rt-${i}`,
    });
  }
  // reaction-time is now capped; memory-test should still earn XP independently.
  const memoryResult = await useCases.recordAcceptedGameCompletion({
    userId: 1,
    gameId: "memory-test",
    sourceId: "mt-1",
  });

  assert.equal(memoryResult.xpAwarded, 10);
  const { summary } = await useCases.getProgressionSummary(1);
  assert.equal(summary.totalXp, 110);
});

test("global XP leaderboard sorts by total XP descending", async () => {
  const repo = new FakeProgressionRepository();
  const useCases = new ProgressionUseCases(repo);

  await useCases.recordAcceptedGameCompletion({
    userId: 1,
    gameId: "reaction-time",
    sourceId: "a",
  });
  await useCases.recordAcceptedGameCompletion({
    userId: 2,
    gameId: "reaction-time",
    sourceId: "b",
  });
  await useCases.recordAcceptedGameCompletion({ userId: 2, gameId: "memory-test", sourceId: "c" });

  const leaderboard = await useCases.getGlobalXpLeaderboard(10);
  assert.equal(leaderboard[0]?.userId, 2);
  assert.equal(leaderboard[0]?.totalXp, 20);
  assert.equal(leaderboard[1]?.userId, 1);

  const rank1 = await useCases.getGlobalXpRank(1);
  const rank2 = await useCases.getGlobalXpRank(2);
  assert.equal(rank2, 1);
  assert.equal(rank1, 2);
});

test("a user with no progress yet has no global rank", async () => {
  const repo = new FakeProgressionRepository();
  const useCases = new ProgressionUseCases(repo);
  const rank = await useCases.getGlobalXpRank(999);
  assert.equal(rank, null);
});
