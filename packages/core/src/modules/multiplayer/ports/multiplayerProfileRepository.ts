import type { ApprovedMultiplayerProfileV1 } from "../domain/multiplayerProfile.js";

export interface MultiplayerProfileRecord {
  readonly id: number;
  readonly sourceRequestId: number | null;
  readonly profile: ApprovedMultiplayerProfileV1;
  readonly createdByAdminId: number | null;
  readonly approvedAt: string;
  readonly disabledAt: string | null;
  readonly disabledReasonCode: string | null;
  readonly disabledByAdminId: number | null;
  readonly updatedAt: string;
}

export interface CreateApprovedMultiplayerProfileInput {
  readonly sourceRequestId: number | null;
  /** New immutable revisions must start disabled and pass a separate enable CAS. */
  readonly profile: ApprovedMultiplayerProfileV1;
  readonly createdByAdminId: number;
  readonly nowIso: string;
}

export type CreateApprovedMultiplayerProfileResult =
  | {
      readonly status: "CREATED" | "REPLAYED";
      readonly record: MultiplayerProfileRecord;
    }
  | {
      readonly status: "REJECTED";
      readonly code:
        | "GAME_VERSION_NOT_FOUND"
        | "PROFILE_MUST_START_DISABLED"
        | "SOURCE_REQUEST_INVALID"
        | "MANAGED_PROFILE_MISMATCH"
        | "REVISION_CONFLICT";
    };

export interface SetMultiplayerProfileEnabledInput {
  readonly profileId: number;
  readonly enabled: boolean;
  readonly changedByAdminId: number;
  /** Required when disabling and forbidden when enabling. */
  readonly reasonCode: string | null;
  readonly nowIso: string;
}

export type SetMultiplayerProfileEnabledResult =
  | {
      readonly status: "UPDATED" | "REPLAYED" | "CONFLICT";
      readonly record: MultiplayerProfileRecord;
    }
  | { readonly status: "NOT_FOUND" };

/**
 * Trusted read boundary for server-approved exact-version profiles.
 *
 * Implementations fail closed on missing or malformed storage. A manifest mode or capability
 * request must never be used as a fallback profile.
 */
export interface MultiplayerProfileRepository {
  createApprovedRevision(
    input: CreateApprovedMultiplayerProfileInput,
  ): Promise<CreateApprovedMultiplayerProfileResult>;
  setEnabled(input: SetMultiplayerProfileEnabledInput): Promise<SetMultiplayerProfileEnabledResult>;
  findById(profileId: number): Promise<MultiplayerProfileRecord | null>;
  findEnabledForExactVersion(
    gameId: number,
    gameVersionId: number,
  ): Promise<MultiplayerProfileRecord | null>;
}
