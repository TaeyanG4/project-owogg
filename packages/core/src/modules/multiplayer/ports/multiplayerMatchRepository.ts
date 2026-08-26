import type {
  MultiplayerActionResultCode,
  MultiplayerMatchActionRecord,
  MultiplayerMatchOutcome,
  MultiplayerMatchPlayerRecord,
  MultiplayerMatchRecord,
  MultiplayerRewardOutboxRecord,
} from "../domain/multiplayerMatch.js";

export interface CreatePendingMultiplayerMatchInput {
  readonly matchId: string;
  readonly instanceId: string;
  readonly expectedGeneration: number;
  readonly nowIso: string;
}

export type CreatePendingMultiplayerMatchResult =
  | {
      readonly status: "CREATED" | "REPLAYED";
      readonly match: MultiplayerMatchRecord;
      readonly players: readonly MultiplayerMatchPlayerRecord[];
    }
  | {
      readonly status: "REJECTED";
      readonly code:
        | "INSTANCE_NOT_FOUND"
        | "STALE_GENERATION"
        | "INSTANCE_NOT_STARTING"
        | "PLAYERS_NOT_READY"
        | "IDENTIFIER_CONFLICT"
        | "INTERNAL_RETRYABLE";
    };

export interface RecordMultiplayerActionInput {
  readonly matchId: string;
  readonly userId: number;
  readonly participantId: string;
  readonly clientSeq: number;
  readonly serverSeq: number;
  readonly clientActionId: string;
  readonly payloadHash: string;
  readonly expectedRevision: number;
  readonly resultRevision: number;
  readonly resultCode: MultiplayerActionResultCode;
  readonly responseJson: string;
  readonly nowIso: string;
}

export type RecordMultiplayerActionResult =
  | {
      readonly status: "RECORDED" | "REPLAYED";
      readonly action: MultiplayerMatchActionRecord;
    }
  | {
      readonly status: "REJECTED";
      readonly code:
        | "INVALID_INPUT"
        | "MATCH_NOT_ACTIVE"
        | "NOT_PARTICIPANT"
        | "ACTION_CONFLICT"
        | "ACTION_ID_REUSED"
        | "INTERNAL_RETRYABLE";
      readonly currentRevision: number | null;
    };

export interface FinalizeMultiplayerPlayerInput {
  readonly userId: number;
  readonly participantId: string;
  readonly outcome: Exclude<MultiplayerMatchOutcome, "ABORTED">;
  readonly placement: number | null;
  readonly resultJson: string;
  readonly rewardEligible: boolean;
  readonly reward: {
    readonly sourceId: string;
    readonly rewardPolicyId: string;
    readonly payloadJson: string;
  } | null;
}

export interface FinalizeMultiplayerMatchInput {
  readonly matchId: string;
  readonly expectedStateRevision: number;
  readonly terminalResultJson: string;
  readonly terminalResultHash: string;
  readonly players: readonly FinalizeMultiplayerPlayerInput[];
  readonly nowIso: string;
}

export type FinalizeMultiplayerMatchResult =
  | {
      readonly status: "COMMITTED" | "REPLAYED";
      readonly match: MultiplayerMatchRecord;
      readonly players: readonly MultiplayerMatchPlayerRecord[];
      readonly rewards: readonly MultiplayerRewardOutboxRecord[];
    }
  | {
      readonly status: "REJECTED";
      readonly code:
        | "INVALID_INPUT"
        | "MATCH_NOT_FOUND"
        | "MATCH_NOT_ACTIVE"
        | "STALE_REVISION"
        | "TERMINAL_CONFLICT"
        | "PLAYER_SET_MISMATCH"
        | "RESULT_CONFLICT"
        | "REWARD_CONFLICT"
        | "INTERNAL_RETRYABLE";
    };

export interface ClaimMultiplayerRewardInput {
  readonly lockTokenHash: string;
  readonly nowIso: string;
}

export interface MultiplayerMatchRepository {
  createPendingWithPlayers(
    input: CreatePendingMultiplayerMatchInput,
  ): Promise<CreatePendingMultiplayerMatchResult>;
  findMatch(matchId: string): Promise<MultiplayerMatchRecord | null>;
  findMatchByInstanceGeneration(
    instanceId: string,
    generation: number,
  ): Promise<MultiplayerMatchRecord | null>;
  listPlayers(matchId: string): Promise<readonly MultiplayerMatchPlayerRecord[]>;
  listActionsAfterRevision(
    matchId: string,
    afterRevision: number,
    limit: number,
  ): Promise<readonly MultiplayerMatchActionRecord[]>;
  /**
   * Returns the highest durable server sequence, including rejected actions whose result
   * revision did not advance. Runtime recovery must not infer this from accepted revisions.
   */
  findLatestAction(matchId: string): Promise<MultiplayerMatchActionRecord | null>;
  recordAction(input: RecordMultiplayerActionInput): Promise<RecordMultiplayerActionResult>;
  finalize(input: FinalizeMultiplayerMatchInput): Promise<FinalizeMultiplayerMatchResult>;
  claimNextReward(
    input: ClaimMultiplayerRewardInput,
  ): Promise<MultiplayerRewardOutboxRecord | null>;
  markRewardApplied(rewardId: number, lockTokenHash: string, nowIso: string): Promise<boolean>;
  markRewardRetryable(
    rewardId: number,
    lockTokenHash: string,
    errorCode: string,
    nextAvailableAt: string,
    nowIso: string,
  ): Promise<boolean>;
  markRewardDeadLetter(
    rewardId: number,
    lockTokenHash: string,
    errorCode: string,
    nowIso: string,
  ): Promise<boolean>;
  requeueStaleRewards(staleBeforeIso: string, nowIso: string): Promise<number>;
}
