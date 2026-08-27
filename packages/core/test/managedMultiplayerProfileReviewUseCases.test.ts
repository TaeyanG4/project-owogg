import assert from "node:assert/strict";
import test from "node:test";
import {
  ManagedMultiplayerProfileReviewUseCases,
  parseManagedMultiplayerProfileRequestV1,
  type CreateApprovedMultiplayerProfileInput,
  type CreateApprovedMultiplayerProfileResult,
  type MultiplayerProfileRecord,
  type MultiplayerProfileRepository,
  type MultiplayerProfileRequestRecord,
  type MultiplayerProfileRequestRepository,
  type ReviewMultiplayerProfileRequestInput,
  type ReviewMultiplayerProfileRequestResult,
  type SubmitMultiplayerProfileRequestInput,
  type SubmitMultiplayerProfileRequestResult,
  type SetMultiplayerProfileEnabledInput,
  type SetMultiplayerProfileEnabledResult,
  type WithdrawMultiplayerProfileRequestResult,
} from "../src/index.js";

const NOW = new Date("2026-08-27T00:00:00.000Z");

function managedTurnGridRequest() {
  return parseManagedMultiplayerProfileRequestV1({
    requestVersion: 1,
    kind: "managed-template",
    template: { id: "turn-grid", version: 1 },
    players: { min: 2, max: 2 },
    requirements: {
      simulation: "turn",
      lifecycle: "match",
      persistence: "match",
      latency: "relaxed",
      reconnect: "resume",
      hiddenInformation: false,
      simultaneousResponse: false,
      joinInProgress: false,
      spectators: false,
    },
    config: { boardWidth: 15, boardHeight: 15, winLength: 5 },
    client: { protocolVersion: 1 },
  });
}

function requestRecord(
  status: MultiplayerProfileRequestRecord["status"] = "PENDING_REVIEW",
): MultiplayerProfileRequestRecord {
  const request = managedTurnGridRequest();
  return {
    id: 1,
    gameId: 10,
    gameVersionId: 20,
    requestSchemaVersion: 1,
    requestHash: "a".repeat(64),
    requestJson: "{}",
    request,
    requestedByUserId: 30,
    status,
    reviewedByAdminId: status === "APPROVED" || status === "REJECTED" ? 40 : null,
    reviewedAt: status === "APPROVED" || status === "REJECTED" ? NOW.toISOString() : null,
    decisionReasonCode: status === "REJECTED" ? "UNSUPPORTED_TEMPLATE" : null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
}

class FakeRequests implements MultiplayerProfileRequestRepository {
  constructor(public record: MultiplayerProfileRequestRecord | null = requestRecord()) {}

  async submit(
    _input: SubmitMultiplayerProfileRequestInput,
  ): Promise<SubmitMultiplayerProfileRequestResult> {
    throw new Error("not used");
  }

  async findById(requestId: number): Promise<MultiplayerProfileRequestRecord | null> {
    return this.record?.id === requestId ? this.record : null;
  }

  async findByExactVersion(gameVersionId: number): Promise<MultiplayerProfileRequestRecord | null> {
    return this.record?.gameVersionId === gameVersionId ? this.record : null;
  }

  async listPending(): Promise<readonly MultiplayerProfileRequestRecord[]> {
    return this.record?.status === "PENDING_REVIEW" ? [this.record] : [];
  }

  async review(
    input: ReviewMultiplayerProfileRequestInput,
  ): Promise<ReviewMultiplayerProfileRequestResult> {
    if (!this.record || this.record.id !== input.requestId) return { status: "NOT_FOUND" };
    if (this.record.status !== "PENDING_REVIEW") {
      return { status: "CONFLICT", record: this.record };
    }
    this.record = {
      ...this.record,
      status: input.decision,
      reviewedByAdminId: input.reviewedByAdminId,
      reviewedAt: input.nowIso,
      decisionReasonCode: input.decisionReasonCode,
      updatedAt: input.nowIso,
    };
    return { status: "UPDATED", record: this.record };
  }

  async withdraw(): Promise<WithdrawMultiplayerProfileRequestResult> {
    throw new Error("not used");
  }
}

class FakeProfiles implements MultiplayerProfileRepository {
  records: MultiplayerProfileRecord[] = [];
  rejectNext:
    Extract<CreateApprovedMultiplayerProfileResult, { status: "REJECTED" }>["code"] | null = null;

  async createApprovedRevision(
    input: CreateApprovedMultiplayerProfileInput,
  ): Promise<CreateApprovedMultiplayerProfileResult> {
    if (this.rejectNext) {
      const code = this.rejectNext;
      this.rejectNext = null;
      return { status: "REJECTED", code };
    }
    const existing = this.records.find(
      (candidate) =>
        candidate.profile.gameVersionId === input.profile.gameVersionId &&
        candidate.profile.profileRevision === input.profile.profileRevision,
    );
    if (existing) return { status: "REPLAYED", record: existing };
    const record: MultiplayerProfileRecord = {
      id: this.records.length + 1,
      sourceRequestId: input.sourceRequestId,
      profile: input.profile,
      createdByAdminId: input.createdByAdminId,
      approvedAt: input.nowIso,
      disabledAt: null,
      disabledReasonCode: null,
      disabledByAdminId: null,
      updatedAt: input.nowIso,
    };
    this.records.push(record);
    return { status: "CREATED", record };
  }

  async setEnabled(
    input: SetMultiplayerProfileEnabledInput,
  ): Promise<SetMultiplayerProfileEnabledResult> {
    const index = this.records.findIndex((record) => record.id === input.profileId);
    if (index < 0) return { status: "NOT_FOUND" };
    const current = this.records[index]!;
    if (current.profile.enabled === input.enabled) {
      return { status: "REPLAYED", record: current };
    }
    const record: MultiplayerProfileRecord = {
      ...current,
      profile: { ...current.profile, enabled: input.enabled },
      disabledAt: input.enabled ? null : input.nowIso,
      disabledReasonCode: input.enabled ? null : input.reasonCode,
      disabledByAdminId: input.enabled ? null : input.changedByAdminId,
      updatedAt: input.nowIso,
    };
    this.records[index] = record;
    return { status: "UPDATED", record };
  }

  async findById(profileId: number): Promise<MultiplayerProfileRecord | null> {
    return this.records.find((record) => record.id === profileId) ?? null;
  }

  async findLatestForExactVersion(
    gameId: number,
    gameVersionId: number,
  ): Promise<MultiplayerProfileRecord | null> {
    return (
      this.records
        .filter(
          (record) =>
            record.profile.gameId === gameId && record.profile.gameVersionId === gameVersionId,
        )
        .sort((left, right) => right.profile.profileRevision - left.profile.profileRevision)[0] ??
      null
    );
  }

  async findEnabledForExactVersion(): Promise<MultiplayerProfileRecord | null> {
    return null;
  }
}

test("approval resolves a Creator request into one disabled server-owned profile", async () => {
  const requests = new FakeRequests();
  const profiles = new FakeProfiles();
  const useCases = new ManagedMultiplayerProfileReviewUseCases({
    requests,
    profiles,
    now: () => NOW,
  });

  const approved = await useCases.approve({ requestId: 1, reviewedByAdminId: 40 });
  assert.ok(approved.ok);
  assert.equal(approved.request.status, "APPROVED");
  assert.equal(approved.profile?.profile.resolvedClass, "M1");
  assert.equal(approved.profile?.profile.runtimeBackend, "durable-object");
  assert.equal(approved.profile?.profile.rulesetKey, "managed:turn-grid:v1");
  assert.equal(approved.profile?.profile.enabled, false);
  assert.equal(approved.profile?.profile.rewardPolicyId, null);
  assert.deepEqual(approved.profile?.profile.allowedVisibility, ["PRIVATE"]);
  assert.deepEqual(approved.profile?.profile.allowedJoinPolicies, ["OPEN"]);

  const replayed = await useCases.approve({ requestId: 1, reviewedByAdminId: 41 });
  assert.ok(replayed.ok);
  assert.equal(replayed.profile?.id, approved.profile?.id);
  assert.equal(profiles.records.length, 1);

  const activated = await useCases.setProfileEnabled({
    profileId: approved.profile!.id,
    enabled: true,
    changedByAdminId: 40,
    reasonCode: null,
  });
  assert.ok(activated.ok);
  assert.equal(activated.profile.profile.enabled, true);
  const disabled = await useCases.setProfileEnabled({
    profileId: approved.profile!.id,
    enabled: false,
    changedByAdminId: 40,
    reasonCode: "STAGING_TEST_COMPLETE",
  });
  assert.ok(disabled.ok);
  assert.equal(disabled.profile.profile.enabled, false);
  assert.equal(disabled.profile.disabledReasonCode, "STAGING_TEST_COMPLETE");
});

test("approval can heal after exact-version moderation temporarily blocks profile creation", async () => {
  const requests = new FakeRequests();
  const profiles = new FakeProfiles();
  profiles.rejectNext = "SOURCE_REQUEST_INVALID";
  const useCases = new ManagedMultiplayerProfileReviewUseCases({
    requests,
    profiles,
    now: () => NOW,
  });

  const blocked = await useCases.approve({ requestId: 1, reviewedByAdminId: 40 });
  assert.deepEqual(blocked, {
    ok: false,
    code: "VERSION_NOT_ELIGIBLE",
    request: requests.record,
  });
  assert.equal(requests.record?.status, "APPROVED");

  const healed = await useCases.approve({ requestId: 1, reviewedByAdminId: 40 });
  assert.ok(healed.ok);
  assert.equal(healed.profile?.profile.enabled, false);
});

test("rejection is final and never creates a trusted profile", async () => {
  const requests = new FakeRequests();
  const profiles = new FakeProfiles();
  const useCases = new ManagedMultiplayerProfileReviewUseCases({
    requests,
    profiles,
    now: () => NOW,
  });

  const rejected = await useCases.reject({
    requestId: 1,
    reviewedByAdminId: 40,
    reasonCode: "UNSUPPORTED_TEMPLATE",
  });
  assert.ok(rejected.ok);
  assert.equal(rejected.request.status, "REJECTED");
  assert.equal(rejected.profile, null);
  assert.equal(profiles.records.length, 0);

  const cannotApprove = await useCases.approve({ requestId: 1, reviewedByAdminId: 40 });
  assert.equal(cannotApprove.ok, false);
  assert.equal(cannotApprove.ok ? null : cannotApprove.code, "REQUEST_NOT_PENDING");
});
