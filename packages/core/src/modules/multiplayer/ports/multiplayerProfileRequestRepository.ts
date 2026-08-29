import type { MultiplayerRuntimeProfileRequestV1 } from "../domain/multiplayerProfileRequest.js";

export const MULTIPLAYER_PROFILE_REQUEST_STATUSES = [
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
  "WITHDRAWN",
] as const;

export type MultiplayerProfileRequestStatus = (typeof MULTIPLAYER_PROFILE_REQUEST_STATUSES)[number];

export interface MultiplayerProfileRequestRecord {
  readonly id: number;
  readonly gameId: number;
  readonly gameVersionId: number;
  /** Immutable SHA-256 identity of the exact uploaded ZIP/version under review. */
  readonly contentHash: string;
  readonly requestSchemaVersion: 1;
  readonly requestHash: string;
  readonly requestJson: string;
  readonly request: MultiplayerRuntimeProfileRequestV1;
  readonly requestedByUserId: number | null;
  readonly status: MultiplayerProfileRequestStatus;
  readonly reviewedByAdminId: number | null;
  readonly reviewedAt: string | null;
  readonly decisionReasonCode: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SubmitMultiplayerProfileRequestInput {
  readonly gameId: number;
  readonly gameVersionId: number;
  readonly contentHash: string;
  /** Null is required for an OWOGG-owned game; USER games require their current owner id. */
  readonly requestedByUserId: number | null;
  readonly request: MultiplayerRuntimeProfileRequestV1;
  readonly nowIso: string;
}

export type SubmitMultiplayerProfileRequestResult =
  | {
      readonly status: "CREATED" | "REPLAYED";
      readonly record: MultiplayerProfileRequestRecord;
    }
  | {
      readonly status: "REJECTED";
      readonly code: "GAME_VERSION_NOT_FOUND" | "REQUESTER_NOT_OWNER" | "REQUEST_CONFLICT";
    };

export interface ReviewMultiplayerProfileRequestInput {
  readonly requestId: number;
  readonly decision: "APPROVED" | "REJECTED";
  readonly reviewedByAdminId: number;
  /** Required for REJECTED and forbidden for APPROVED. This is a stable machine code, not prose. */
  readonly decisionReasonCode: string | null;
  readonly nowIso: string;
}

export type ReviewMultiplayerProfileRequestResult =
  | {
      readonly status: "UPDATED" | "REPLAYED" | "CONFLICT";
      readonly record: MultiplayerProfileRequestRecord;
    }
  | { readonly status: "NOT_FOUND" };

export type WithdrawMultiplayerProfileRequestResult =
  | {
      readonly status: "UPDATED" | "REPLAYED" | "CONFLICT";
      readonly record: MultiplayerProfileRequestRecord;
    }
  | { readonly status: "NOT_FOUND_OR_NOT_OWNER" };

/**
 * Exact-version review boundary for the untrusted owogg.json multiplayer request. A stored request
 * is immutable; a rejected or withdrawn version must be replaced by a newly uploaded game version.
 */
export interface MultiplayerProfileRequestRepository {
  submit(
    input: SubmitMultiplayerProfileRequestInput,
  ): Promise<SubmitMultiplayerProfileRequestResult>;
  findById(requestId: number): Promise<MultiplayerProfileRequestRecord | null>;
  findByExactVersion(gameVersionId: number): Promise<MultiplayerProfileRequestRecord | null>;
  listPending(limit: number): Promise<readonly MultiplayerProfileRequestRecord[]>;
  review(
    input: ReviewMultiplayerProfileRequestInput,
  ): Promise<ReviewMultiplayerProfileRequestResult>;
  withdraw(
    requestId: number,
    requestedByUserId: number,
    nowIso: string,
  ): Promise<WithdrawMultiplayerProfileRequestResult>;
}
