import type { StreamerPlatformType } from "./repositories.js";

export type PublicRankingScope = "general" | "streamer";

export interface PublicRankingPlatformAccount {
  platform: StreamerPlatformType;
  channelName: string;
  channelUrl: string;
  avatarUrl: string | null;
}

export interface PublicRankingRow {
  rank: number;
  userId: number;
  nickname: string;
  avatarUrl: string | null;
  country: string | null;
  value: number;
  achievedAt: string;
  gameId?: string | undefined;
  variantId?: string | undefined;
  streamerId?: number | undefined;
  platformAccounts: PublicRankingPlatformAccount[];
}

export interface PublicRankingRepository {
  getScoreRanking(input: {
    scope: PublicRankingScope;
    gameId: string;
    difficulty: string;
    rulesetRevision: number;
    direction: "asc" | "desc";
    startAt: string;
    endAt: string;
    platform?: StreamerPlatformType | undefined;
    limit: number;
  }): Promise<PublicRankingRow[]>;

  getXpRanking(input: {
    scope: PublicRankingScope;
    startAt: string;
    endAt: string;
    platform?: StreamerPlatformType | undefined;
    limit: number;
  }): Promise<PublicRankingRow[]>;

  getStreakRanking(input: {
    scope: PublicRankingScope;
    activeDates: readonly [string, string];
    platform?: StreamerPlatformType | undefined;
    limit: number;
  }): Promise<PublicRankingRow[]>;
}
