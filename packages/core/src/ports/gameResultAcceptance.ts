import type { NormalizedCreatorResult } from "../domain/creatorResult.js";

export interface GameResultAcceptanceRepository {
  acceptResult(input: {
    attemptId: string;
    userId: number;
    gameId: number;
    versionId: number;
    slug: string;
    nickname: string;
    avatarUrl: string | null;
    difficulty: string;
    result: NormalizedCreatorResult;
    leaderboardEnabled: boolean;
    nowIso: string;
  }): Promise<{ accepted: boolean; resultId: number | null; scoreId: number | null }>;
}
