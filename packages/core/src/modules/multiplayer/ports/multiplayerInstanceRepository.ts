import type {
  GameVersionLeaseRecord,
  MultiplayerAbortCode,
  MultiplayerInviteRecord,
  MultiplayerInstanceRecord,
  MultiplayerParticipantRecord,
  MultiplayerParticipantStatus,
} from "../domain/multiplayerInstance.js";
import type { MultiplayerInstanceStatus } from "../domain/multiplayerLifecycle.js";
import type { MultiplayerJoinPolicy, MultiplayerVisibility } from "../domain/multiplayerProfile.js";
import type { MultiplayerErrorCode } from "../domain/multiplayerErrors.js";

export interface CreateMultiplayerInstanceInput {
  readonly instanceId: string;
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
  readonly maxPlayers: number;
  readonly instanceExpiresAt: string;
  readonly hostParticipantId: string;
  readonly leaseExpiresAt: string;
  readonly nowIso: string;
}

export type CreateMultiplayerInstanceResult =
  | {
      readonly status: "CREATED" | "REPLAYED";
      readonly instance: MultiplayerInstanceRecord;
      readonly host: MultiplayerParticipantRecord;
      readonly lease: GameVersionLeaseRecord;
    }
  | { readonly status: "IDEMPOTENCY_CONFLICT" | "IDENTIFIER_CONFLICT" };

export interface TransitionMultiplayerInstanceInput {
  readonly instanceId: string;
  readonly expectedStatus: MultiplayerInstanceStatus;
  readonly expectedGeneration: number;
  readonly nextStatus: MultiplayerInstanceStatus;
  readonly nextGeneration: number;
  readonly closedAt: string | null;
  readonly abortCode: MultiplayerAbortCode | null;
  readonly nowIso: string;
}

export type JoinMultiplayerInstanceErrorCode = Extract<
  MultiplayerErrorCode,
  | "INSTANCE_NOT_FOUND"
  | "INSTANCE_NOT_JOINABLE"
  | "PROFILE_DISABLED"
  | "INSTANCE_FULL"
  | "INVITE_INVALID"
  | "INVITE_EXHAUSTED"
  | "ALREADY_JOINED"
  | "STALE_GENERATION"
  | "INTERNAL_RETRYABLE"
>;

export interface JoinMultiplayerInstanceInput {
  readonly participantId: string;
  readonly instanceId: string;
  readonly userId: number;
  readonly expectedGeneration: number;
  readonly inviteTokenHash: string | null;
  readonly nowIso: string;
}

export type JoinMultiplayerInstanceResult =
  | {
      readonly status: "JOINED" | "REPLAYED";
      readonly participant: MultiplayerParticipantRecord;
    }
  | {
      readonly status: "REJECTED";
      readonly code: JoinMultiplayerInstanceErrorCode;
    };

export interface CreateMultiplayerInviteInput {
  readonly instanceId: string;
  readonly expectedGeneration: number;
  readonly tokenHash: string;
  readonly createdByUserId: number;
  readonly maxUses: number;
  readonly expiresAt: string;
  readonly nowIso: string;
}

export type CreateMultiplayerInviteResult =
  | {
      readonly status: "CREATED" | "REPLAYED";
      readonly invite: MultiplayerInviteRecord;
    }
  | {
      readonly status: "REJECTED";
      readonly code: Extract<
        MultiplayerErrorCode,
        | "INVALID_REQUEST"
        | "INSTANCE_NOT_FOUND"
        | "INSTANCE_NOT_JOINABLE"
        | "PROFILE_DISABLED"
        | "NOT_PARTICIPANT"
        | "STALE_GENERATION"
        | "INTERNAL_RETRYABLE"
      >;
    };

export interface TransitionMultiplayerParticipantInput {
  readonly instanceId: string;
  readonly expectedInstanceGeneration: number;
  /** Optional instance-state CAS used when a participant transition is valid in one phase only. */
  readonly expectedInstanceStatus?: MultiplayerInstanceStatus;
  readonly userId: number;
  readonly expectedStatus: MultiplayerParticipantStatus;
  readonly nextStatus: MultiplayerParticipantStatus;
  readonly readyAt: string | null;
  readonly leftAt: string | null;
  readonly nowIso: string;
}

export interface AdvanceMultiplayerConnectionInput {
  readonly instanceId: string;
  readonly expectedInstanceGeneration: number;
  readonly userId: number;
  readonly expectedConnectionGeneration: number;
  readonly nowIso: string;
}

export interface MultiplayerInstanceAdminActionRecord {
  readonly operationId: string;
  readonly instanceId: string;
  readonly expectedGeneration: number;
  readonly previousStatus: MultiplayerInstanceStatus;
  readonly adminAccountId: number | null;
  readonly action: "ADMIN_KILL";
  readonly reasonCode: string;
  readonly createdAt: string;
}

export interface AdminKillMultiplayerInstanceInput {
  readonly operationId: string;
  readonly instanceId: string;
  readonly expectedGeneration: number;
  readonly adminAccountId: number;
  readonly reasonCode: string;
  readonly nowIso: string;
}

export type AdminKillMultiplayerInstanceResult =
  | {
      readonly status: "KILLED" | "REPLAYED";
      readonly instance: MultiplayerInstanceRecord;
      readonly action: MultiplayerInstanceAdminActionRecord;
    }
  | {
      readonly status: "CONFLICT";
      readonly instance: MultiplayerInstanceRecord | null;
    }
  | { readonly status: "NOT_FOUND" };

export interface MultiplayerInstanceRepository {
  createWithHostAndLease(
    input: CreateMultiplayerInstanceInput,
  ): Promise<CreateMultiplayerInstanceResult>;
  findById(instanceId: string): Promise<MultiplayerInstanceRecord | null>;
  findByPublicCode(publicCode: string): Promise<MultiplayerInstanceRecord | null>;
  findParticipant(instanceId: string, userId: number): Promise<MultiplayerParticipantRecord | null>;
  listParticipants(instanceId: string): Promise<readonly MultiplayerParticipantRecord[]>;
  join(input: JoinMultiplayerInstanceInput): Promise<JoinMultiplayerInstanceResult>;
  createInvite(input: CreateMultiplayerInviteInput): Promise<CreateMultiplayerInviteResult>;
  findInviteByTokenHash(tokenHash: string): Promise<MultiplayerInviteRecord | null>;
  revokeInvite(inviteId: number, createdByUserId: number, nowIso: string): Promise<boolean>;
  transitionParticipant(
    input: TransitionMultiplayerParticipantInput,
  ): Promise<MultiplayerParticipantRecord | null>;
  advanceConnectionGeneration(
    input: AdvanceMultiplayerConnectionInput,
  ): Promise<MultiplayerParticipantRecord | null>;
  findLease(instanceId: string): Promise<GameVersionLeaseRecord | null>;
  /** Exact bundle-serving lease lookup. Only an unexpired ACTIVE lease authorizes a non-live
   * immutable version path; game visibility and kill switches are checked separately. */
  hasActiveVersionLease(gameVersionId: number, nowIso: string): Promise<boolean>;
  adminKill(input: AdminKillMultiplayerInstanceInput): Promise<AdminKillMultiplayerInstanceResult>;
  /** Idempotently expires due live instances; terminal cleanup releases all attached authority. */
  expireDueInstances(nowIso: string, limit: number): Promise<readonly string[]>;
  transition(input: TransitionMultiplayerInstanceInput): Promise<boolean>;
}
