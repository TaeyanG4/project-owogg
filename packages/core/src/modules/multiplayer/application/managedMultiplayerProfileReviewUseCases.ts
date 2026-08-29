import { resolveMultiplayerRuntimeProfileRequestV1 } from "../domain/multiplayerProfileRequest.js";
import type { ApprovedRelayMultiplayerProfileV1 } from "../domain/multiplayerProfile.js";
import type {
  MultiplayerProfileRecord,
  MultiplayerProfileRepository,
} from "../ports/multiplayerProfileRepository.js";
import type {
  MultiplayerProfileRequestRecord,
  MultiplayerProfileRequestRepository,
} from "../ports/multiplayerProfileRequestRepository.js";

export type ManagedMultiplayerProfileReviewFailureCode =
  | "REQUEST_NOT_FOUND"
  | "REQUEST_NOT_PENDING"
  | "MULTIPLAYER_RUNTIME_NOT_AVAILABLE"
  | "MULTIPLAYER_CAPABILITY_NOT_AVAILABLE"
  | "PROFILE_CREATE_FAILED";

export type ManagedMultiplayerProfileActivationFailureCode =
  "PROFILE_NOT_FOUND" | "PROFILE_NOT_MANAGED" | "PROFILE_ACTIVATION_CONFLICT";

export type ManagedMultiplayerProfileReviewResult =
  | {
      readonly ok: true;
      readonly request: MultiplayerProfileRequestRecord;
      readonly profile: MultiplayerProfileRecord | null;
    }
  | {
      readonly ok: false;
      readonly code: ManagedMultiplayerProfileReviewFailureCode;
      readonly request: MultiplayerProfileRequestRecord | null;
    };

export type ManagedMultiplayerProfileActivationResult =
  | {
      readonly ok: true;
      readonly request: MultiplayerProfileRequestRecord;
      readonly profile: MultiplayerProfileRecord;
    }
  | {
      readonly ok: false;
      readonly code: ManagedMultiplayerProfileActivationFailureCode;
    };

interface ManagedMultiplayerProfileReviewDependencies {
  readonly requests: MultiplayerProfileRequestRepository;
  readonly profiles: MultiplayerProfileRepository;
  readonly now?: () => Date;
}

/**
 * Exact-version Relay review boundary. Approval creates one disabled immutable profile revision;
 * activation is a separate admin CAS so review never makes a runtime immediately public.
 */
export class ManagedMultiplayerProfileReviewUseCases {
  private readonly now: () => Date;

  constructor(private readonly dependencies: ManagedMultiplayerProfileReviewDependencies) {
    this.now = dependencies.now ?? (() => new Date());
  }

  listPending(limit = 50): Promise<readonly MultiplayerProfileRequestRecord[]> {
    return this.dependencies.requests.listPending(limit);
  }

  listManagedProfiles(limit = 50): Promise<readonly MultiplayerProfileRecord[]> {
    return this.dependencies.profiles.listManaged(limit);
  }

  get(requestId: number): Promise<MultiplayerProfileRequestRecord | null> {
    return this.dependencies.requests.findById(requestId);
  }

  async reject(input: {
    readonly requestId: number;
    readonly reviewedByAdminId: number;
    readonly reasonCode: string;
  }): Promise<ManagedMultiplayerProfileReviewResult> {
    const reviewed = await this.dependencies.requests.review({
      requestId: input.requestId,
      decision: "REJECTED",
      reviewedByAdminId: input.reviewedByAdminId,
      decisionReasonCode: input.reasonCode,
      nowIso: this.now().toISOString(),
    });
    if (reviewed.status === "NOT_FOUND") {
      return { ok: false, code: "REQUEST_NOT_FOUND", request: null };
    }
    if (reviewed.status === "CONFLICT") {
      return { ok: false, code: "REQUEST_NOT_PENDING", request: reviewed.record };
    }
    return { ok: true, request: reviewed.record, profile: null };
  }

  async approve(input: {
    readonly requestId: number;
    readonly reviewedByAdminId: number;
  }): Promise<ManagedMultiplayerProfileReviewResult> {
    const request = await this.dependencies.requests.findById(input.requestId);
    if (!request) return { ok: false, code: "REQUEST_NOT_FOUND", request: null };
    if (request.status !== "PENDING_REVIEW" && request.status !== "APPROVED") {
      return { ok: false, code: "REQUEST_NOT_PENDING", request };
    }

    const resolution = resolveMultiplayerRuntimeProfileRequestV1(request.request);
    if (resolution.status === "RUNTIME_NOT_AVAILABLE") {
      return { ok: false, code: "MULTIPLAYER_RUNTIME_NOT_AVAILABLE", request };
    }
    if (resolution.status === "CAPABILITY_NOT_AVAILABLE") {
      return { ok: false, code: "MULTIPLAYER_CAPABILITY_NOT_AVAILABLE", request };
    }

    const nowIso = this.now().toISOString();
    let approvedRequest = request;
    if (request.status === "PENDING_REVIEW") {
      const reviewed = await this.dependencies.requests.review({
        requestId: request.id,
        decision: "APPROVED",
        reviewedByAdminId: input.reviewedByAdminId,
        decisionReasonCode: null,
        nowIso,
      });
      if (reviewed.status === "NOT_FOUND") {
        return { ok: false, code: "REQUEST_NOT_FOUND", request: null };
      }
      if (reviewed.status === "CONFLICT" || reviewed.record.status !== "APPROVED") {
        return { ok: false, code: "REQUEST_NOT_PENDING", request: reviewed.record };
      }
      approvedRequest = reviewed.record;
    }

    const latest = await this.dependencies.profiles.findLatestForExactVersion(
      approvedRequest.gameId,
      approvedRequest.gameVersionId,
    );
    if (latest?.sourceRequestId === approvedRequest.id) {
      return { ok: true, request: approvedRequest, profile: latest };
    }
    const policy = resolution.policy;
    const profile: ApprovedRelayMultiplayerProfileV1 = {
      profileVersion: 1,
      gameId: approvedRequest.gameId,
      gameVersionId: approvedRequest.gameVersionId,
      contentHash: approvedRequest.contentHash,
      sourceRequestHash: approvedRequest.requestHash,
      profileRevision: (latest?.profile.profileRevision ?? 0) + 1,
      transportKind: policy.transportKind,
      runtimeKind: policy.runtimeKind,
      protocolVersion: policy.protocolVersion,
      lifecycle: "match",
      reconnectPolicy: policy.reconnectPolicy,
      directMessages: policy.directMessages,
      hostSnapshot: policy.hostSnapshot,
      minPlayers: policy.minPlayers,
      maxPlayers: policy.maxPlayers,
      allowedVisibility: policy.allowedVisibility,
      allowedJoinPolicies: policy.allowedJoinPolicies,
      hostDeparturePolicy: policy.hostDeparturePolicy,
      resultTrust: policy.resultTrust,
      maxMessageBytes: policy.maxMessageBytes,
      maxSnapshotBytes: policy.maxSnapshotBytes,
      messagesPerSecond: policy.messagesPerSecond,
      roomBytesPerSecond: policy.roomBytesPerSecond,
      roomTtlSeconds: policy.roomTtlSeconds,
      enabled: false,
    };
    const created = await this.dependencies.profiles.createApprovedRevision({
      sourceRequestId: approvedRequest.id,
      profile,
      createdByAdminId: input.reviewedByAdminId,
      nowIso,
    });
    return created.status === "REJECTED"
      ? { ok: false, code: "PROFILE_CREATE_FAILED", request: approvedRequest }
      : { ok: true, request: approvedRequest, profile: created.record };
  }

  async setProfileEnabled(input: {
    readonly profileId: number;
    readonly enabled: boolean;
    readonly changedByAdminId: number;
    readonly reasonCode: string | null;
  }): Promise<ManagedMultiplayerProfileActivationResult> {
    const profile = await this.dependencies.profiles.findById(input.profileId);
    if (!profile) return { ok: false, code: "PROFILE_NOT_FOUND" };
    if (profile.sourceRequestId === null) return { ok: false, code: "PROFILE_NOT_MANAGED" };
    const request = await this.dependencies.requests.findById(profile.sourceRequestId);
    if (!request || request.status !== "APPROVED") {
      return { ok: false, code: "PROFILE_NOT_MANAGED" };
    }
    const changed = await this.dependencies.profiles.setEnabled({
      profileId: input.profileId,
      enabled: input.enabled,
      changedByAdminId: input.changedByAdminId,
      reasonCode: input.reasonCode,
      nowIso: this.now().toISOString(),
    });
    if (changed.status === "NOT_FOUND") return { ok: false, code: "PROFILE_NOT_FOUND" };
    if (changed.status === "CONFLICT") {
      return { ok: false, code: "PROFILE_ACTIVATION_CONFLICT" };
    }
    return { ok: true, request, profile: changed.record };
  }
}
