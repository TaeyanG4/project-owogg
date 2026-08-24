import type { NormalizedGameCreatorResult } from "../domain/gameCreatorResult.js";

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
    result: NormalizedGameCreatorResult;
    leaderboardEnabled: boolean;
    nowIso: string;
  }): Promise<{ accepted: boolean; resultId: number | null; scoreId: number | null }>;
}
