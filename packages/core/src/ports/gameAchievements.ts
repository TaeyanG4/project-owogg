import type { OwoggAchievementAggregate, OwoggAchievementSource } from "@owogg/game-sdk/contracts";

export interface GameAchievementRepository {
  aggregate(input: {
    userId: number;
    gameId: number;
    source: Exclude<OwoggAchievementSource, "outcome">;
    key?: string | undefined;
    aggregate: OwoggAchievementAggregate;
  }): Promise<number | null>;
  unlock(input: {
    userId: number;
    gameId: number;
    achievementId: string;
    resultId: number;
    unlockedAt: string;
  }): Promise<boolean>;
}
