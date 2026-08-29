import type { MultiplayerInstanceStatus } from "./multiplayerLifecycle.js";
import type { MultiplayerJoinPolicy, MultiplayerVisibility } from "./multiplayerProfile.js";

export const MULTIPLAYER_PARTICIPANT_ROLES = ["HOST", "PLAYER"] as const;
export const MULTIPLAYER_PARTICIPANT_STATUSES = ["JOINED", "READY", "LEFT", "KICKED"] as const;
export const GAME_VERSION_LEASE_STATUSES = ["ACTIVE", "RELEASED", "EXPIRED", "KILLED"] as const;
export const MULTIPLAYER_ABORT_CODES = [
  "INSUFFICIENT_PLAYERS",
  "PARTICIPANT_LEFT",
  "RULE_VIOLATION",
  "INFRA_FAILURE",
  "ADMIN_KILLED",
  "VERSION_UNAVAILABLE",
] as const;

export type MultiplayerParticipantRole = (typeof MULTIPLAYER_PARTICIPANT_ROLES)[number];
export type MultiplayerParticipantStatus = (typeof MULTIPLAYER_PARTICIPANT_STATUSES)[number];
export type GameVersionLeaseStatus = (typeof GAME_VERSION_LEASE_STATUSES)[number];
export type MultiplayerAbortCode = (typeof MULTIPLAYER_ABORT_CODES)[number];

export interface MultiplayerInstanceRecord {
  readonly id: string;
  readonly publicCode: string;
  readonly createdByUserId: number;
  readonly createIdempotencyHash: string;
  readonly gameId: number;
  readonly gameVersionId: number;
  readonly contentHash: string;
  readonly profileId: number;
  readonly profileRevision: number;
  readonly visibility: MultiplayerVisibility;
  readonly joinPolicy: MultiplayerJoinPolicy;
  readonly lifecycle: "match" | "continuous";
  readonly status: MultiplayerInstanceStatus;
  readonly generation: number;
  readonly participantCount: number;
  readonly maxPlayers: number;
  readonly expiresAt: string;
  readonly closedAt: string | null;
  readonly abortCode: MultiplayerAbortCode | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MultiplayerParticipantRecord {
  readonly id: string;
  readonly instanceId: string;
  readonly userId: number;
  readonly role: MultiplayerParticipantRole;
  readonly seatIndex: number;
  readonly status: MultiplayerParticipantStatus;
  readonly connectionGeneration: number;
  readonly joinedAt: string;
  readonly readyAt: string | null;
  readonly leftAt: string | null;
  readonly updatedAt: string;
}

export interface MultiplayerInviteRecord {
  readonly id: number;
  readonly instanceId: string;
  readonly generation: number;
  readonly tokenHash: string;
  readonly createdByUserId: number;
  readonly maxUses: number;
  readonly usedCount: number;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GameVersionLeaseRecord {
  readonly id: number;
  readonly gameVersionId: number;
  readonly instanceId: string;
  readonly generation: number;
  readonly status: GameVersionLeaseStatus;
  readonly acquiredAt: string;
  readonly expiresAt: string;
  readonly endedAt: string | null;
  readonly endReasonCode: string | null;
  readonly updatedAt: string;
}
