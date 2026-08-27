import {
  MultiplayerProfileRequestValidationError,
  assertManagedMultiplayerProfileMatchesRequestV1,
  buildApprovedManagedMultiplayerProfileV1,
  resolveManagedMultiplayerProfileRequestV1,
} from "../domain/multiplayerProfileRequest.js";
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
  | "REQUEST_NOT_SUPPORTED"
  | "VERSION_NOT_ELIGIBLE"
  | "PROFILE_CONFLICT";

export type ManagedMultiplayerProfileActivationFailureCode =
  "PROFILE_NOT_FOUND" | "PROFILE_NOT_MANAGED" | "REQUEST_NOT_APPROVED" | "PROFILE_CONFLICT";

export type ManagedMultiplayerProfileReviewResult =
  | {
      readonly ok: true;
      readonly request: MultiplayerProfileRequestRecord;
      /** Approval creates a disabled profile; rejection deliberately has no profile. */
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

function matchesApprovedRequest(
  profile: MultiplayerProfileRecord,
  request: MultiplayerProfileRequestRecord,
): boolean {
  if (
    profile.sourceRequestId !== request.id ||
    profile.profile.sourceRequestHash !== request.requestHash
  ) {
    return false;
  }
  try {
    assertManagedMultiplayerProfileMatchesRequestV1(request.request, profile.profile);
    return true;
  } catch (error) {
    if (error instanceof MultiplayerProfileRequestValidationError) return false;
    throw error;
  }
}

/**
 * Audited server boundary that turns one immutable exact-version Creator request into one disabled
 * trusted profile. It never enables gameplay, grants rewards, or accepts a Creator-selected class,
 * backend, ruleset, access policy, or resource limit.
 */
export class ManagedMultiplayerProfileReviewUseCases {
  private readonly now: () => Date;

  constructor(private readonly dependencies: ManagedMultiplayerProfileReviewDependencies) {
    this.now = dependencies.now ?? (() => new Date());
  }

  listPending(limit = 50): Promise<readonly MultiplayerProfileRequestRecord[]> {
    return this.dependencies.requests.listPending(limit);
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
    let request = await this.dependencies.requests.findById(input.requestId);
    if (!request) return { ok: false, code: "REQUEST_NOT_FOUND", request: null };

    const resolution = resolveManagedMultiplayerProfileRequestV1(request.request);
    if (resolution.status !== "SUPPORTED_V1") {
      return { ok: false, code: "REQUEST_NOT_SUPPORTED", request };
    }

    if (request.status === "PENDING_REVIEW") {
      const reviewed = await this.dependencies.requests.review({
        requestId: request.id,
        decision: "APPROVED",
        reviewedByAdminId: input.reviewedByAdminId,
        decisionReasonCode: null,
        nowIso: this.now().toISOString(),
      });
      if (reviewed.status === "NOT_FOUND") {
        return { ok: false, code: "REQUEST_NOT_FOUND", request: null };
      }
      if (reviewed.status === "CONFLICT" && reviewed.record.status !== "APPROVED") {
        return { ok: false, code: "REQUEST_NOT_PENDING", request: reviewed.record };
      }
      request = reviewed.record;
    } else if (request.status !== "APPROVED") {
      return { ok: false, code: "REQUEST_NOT_PENDING", request };
    }

    // A request review and profile insert cross repository ports, so retries are an intentional
    // part of the contract. If moderation or storage blocked the first insert, replaying approval
    // safely heals the already-APPROVED request without changing its immutable source.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const latest = await this.dependencies.profiles.findLatestForExactVersion(
        request.gameId,
        request.gameVersionId,
      );
      if (latest && matchesApprovedRequest(latest, request)) {
        return { ok: true, request, profile: latest };
      }

      const profile = buildApprovedManagedMultiplayerProfileV1({
        gameId: request.gameId,
        gameVersionId: request.gameVersionId,
        requestHash: request.requestHash,
        profileRevision: (latest?.profile.profileRevision ?? 0) + 1,
        request: request.request,
      });
      const created = await this.dependencies.profiles.createApprovedRevision({
        sourceRequestId: request.id,
        profile,
        createdByAdminId: input.reviewedByAdminId,
        nowIso: this.now().toISOString(),
      });
      if (created.status !== "REJECTED") {
        return { ok: true, request, profile: created.record };
      }
      if (created.code === "REVISION_CONFLICT") continue;
      if (created.code === "GAME_VERSION_NOT_FOUND" || created.code === "SOURCE_REQUEST_INVALID") {
        return { ok: false, code: "VERSION_NOT_ELIGIBLE", request };
      }
      return { ok: false, code: "PROFILE_CONFLICT", request };
    }
    return { ok: false, code: "PROFILE_CONFLICT", request };
  }

  async setProfileEnabled(input: {
    readonly profileId: number;
    readonly enabled: boolean;
    readonly changedByAdminId: number;
    readonly reasonCode: string | null;
  }): Promise<ManagedMultiplayerProfileActivationResult> {
    const profile = await this.dependencies.profiles.findById(input.profileId);
    if (!profile) return { ok: false, code: "PROFILE_NOT_FOUND" };
    if (profile.sourceRequestId === null) {
      return { ok: false, code: "PROFILE_NOT_MANAGED" };
    }
    const request = await this.dependencies.requests.findById(profile.sourceRequestId);
    if (!request || request.status !== "APPROVED") {
      return { ok: false, code: "REQUEST_NOT_APPROVED" };
    }
    if (!matchesApprovedRequest(profile, request)) {
      return { ok: false, code: "PROFILE_CONFLICT" };
    }
    const changed = await this.dependencies.profiles.setEnabled({
      profileId: profile.id,
      enabled: input.enabled,
      changedByAdminId: input.changedByAdminId,
      reasonCode: input.reasonCode,
      nowIso: this.now().toISOString(),
    });
    if (changed.status === "NOT_FOUND") return { ok: false, code: "PROFILE_NOT_FOUND" };
    if (changed.status === "CONFLICT") return { ok: false, code: "PROFILE_CONFLICT" };
    return { ok: true, request, profile: changed.record };
  }
}
