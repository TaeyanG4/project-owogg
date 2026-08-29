import type { NormalizedGameCreatorResult } from "../domain/gameCreatorResult.js";

export interface PersistedVerifiedGameResult {
  readonly resultId: number;
  readonly scoreId: number | null;
  readonly normalized: NormalizedGameCreatorResult;
  readonly competitiveScore: number;
  readonly difficultyId: string;
  readonly variantId: string;
  readonly rulesetRevision: number;
  readonly verifierId: string;
}

/**
 * Atomic gs2 write boundary. Implementations must consume the attempt, insert the result, project
 * the competitive score, and finalize the matching first-evidence claim in one transaction.
 */
export interface GameVerifiedResultPersistenceRepository {
  acceptVerifiedResult(input: {
    readonly attemptId: string;
    readonly userId: number;
    readonly gameId: number;
    readonly versionId: number;
    readonly evidenceHash: string;
    readonly slug: string;
    readonly nickname: string;
    readonly avatarUrl: string | null;
    readonly difficultyId: string;
    readonly variantId: string;
    readonly rulesetRevision: number;
    readonly verifierId: string;
    readonly normalized: NormalizedGameCreatorResult;
    readonly competitiveScore: number;
    readonly leaderboardEnabled: boolean;
    readonly nowIso: string;
  }): Promise<{
    readonly accepted: boolean;
    readonly resultId: number | null;
    readonly scoreId: number | null;
  }>;

  findVerifiedResult(input: {
    readonly resultId: number;
    readonly userId: number;
    readonly gameId: number;
    readonly versionId: number;
  }): Promise<PersistedVerifiedGameResult | null>;
}
