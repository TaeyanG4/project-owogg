import type { MultiplayerAbortCode } from "./multiplayerInstance.js";
import type { MultiplayerMatchStatus } from "./multiplayerLifecycle.js";

export const MULTIPLAYER_PLAYER_RESULT_STATUSES = ["PENDING", "COMMITTED", "ABORTED"] as const;
export const MULTIPLAYER_MATCH_OUTCOMES = ["WIN", "LOSS", "DRAW", "COMPLETED", "ABORTED"] as const;
export const MULTIPLAYER_ACTION_RESULT_CODES = [
  "ACCEPTED",
  "MATCH_NOT_ACTIVE",
  "NOT_PARTICIPANT",
  "NOT_YOUR_TURN",
  "ACTION_INVALID",
  "ACTION_CONFLICT",
  "STALE_GENERATION",
  "RATE_LIMITED",
] as const;
export const MULTIPLAYER_REWARD_OUTBOX_STATUSES = [
  "PENDING",
  "PROCESSING",
  "RETRYABLE",
  "APPLIED",
  "DEAD_LETTER",
] as const;

export type MultiplayerPlayerResultStatus = (typeof MULTIPLAYER_PLAYER_RESULT_STATUSES)[number];
export type MultiplayerMatchOutcome = (typeof MULTIPLAYER_MATCH_OUTCOMES)[number];
export type MultiplayerActionResultCode = (typeof MULTIPLAYER_ACTION_RESULT_CODES)[number];
export type MultiplayerRewardOutboxStatus = (typeof MULTIPLAYER_REWARD_OUTBOX_STATUSES)[number];

export interface MultiplayerMatchRecord {
  readonly id: string;
  readonly instanceId: string;
  readonly generation: number;
  readonly gameId: number;
  readonly gameVersionId: number;
  readonly profileId: number;
  readonly profileRevision: number;
  readonly status: MultiplayerMatchStatus;
  readonly stateRevision: number;
  readonly terminalResultJson: string | null;
  readonly terminalResultHash: string | null;
  readonly abortCode: MultiplayerAbortCode | null;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finalizingAt: string | null;
  readonly committedAt: string | null;
  readonly abortedAt: string | null;
  readonly updatedAt: string;
}

export interface MultiplayerMatchPlayerRecord {
  readonly matchId: string;
  readonly userId: number;
  readonly participantId: string;
  readonly resultStatus: MultiplayerPlayerResultStatus;
  readonly outcome: MultiplayerMatchOutcome | null;
  readonly placement: number | null;
  readonly resultJson: string | null;
  readonly rewardEligible: boolean;
  readonly committedAt: string | null;
  readonly abortedAt: string | null;
  readonly createdAt: string;
}

export interface MultiplayerMatchActionRecord {
  readonly id: number;
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
  readonly createdAt: string;
}

export interface MultiplayerRewardOutboxRecord {
  readonly id: number;
  readonly sourceId: string;
  readonly matchId: string;
  readonly userId: number;
  readonly gameId: number;
  readonly rewardPolicyId: string;
  readonly rewardPayloadJson: string;
  readonly status: MultiplayerRewardOutboxStatus;
  readonly attemptCount: number;
  readonly availableAt: string;
  readonly lockTokenHash: string | null;
  readonly lockedAt: string | null;
  readonly appliedAt: string | null;
  readonly lastErrorCode: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}
