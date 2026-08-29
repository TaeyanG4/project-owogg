import assert from "node:assert/strict";
import test from "node:test";
import {
  ManagedMultiplayerProfileReviewUseCases,
  parseMultiplayerRuntimeProfileRequestV1,
  type CreateApprovedMultiplayerProfileInput,
  type CreateApprovedMultiplayerProfileResult,
  type MultiplayerProfileRecord,
  type MultiplayerProfileRepository,
  type MultiplayerProfileRequestRecord,
  type MultiplayerProfileRequestRepository,
  type ReviewMultiplayerProfileRequestInput,
  type ReviewMultiplayerProfileRequestResult,
  type SetMultiplayerProfileEnabledInput,
  type SetMultiplayerProfileEnabledResult,
  type SubmitMultiplayerProfileRequestInput,
  type SubmitMultiplayerProfileRequestResult,
  type WithdrawMultiplayerProfileRequestResult,
} from "../src/index.js";

const NOW = new Date("2026-08-29T00:00:00.000Z");

function relayRequest(runtimeKind: "relay" | "worker" | "container" = "relay") {
  return parseMultiplayerRuntimeProfileRequestV1({
    version: 1,
    transport: { kind: "websocket", protocolVersion: 1 },
    runtime: { kind: runtimeKind },
    players: { min: 2, max: 8 },
    features: {
      reconnect: "resume",
      directMessages: true,
      hostSnapshot: true,
      joinInProgress: false,
      spectators: false,
    },
  });
}

function requestRecord(
  status: MultiplayerProfileRequestRecord["status"] = "PENDING_REVIEW",
  runtimeKind: "relay" | "worker" | "container" = "relay",
): MultiplayerProfileRequestRecord {
  return {
    id: 1,
    gameId: 10,
    gameVersionId: 20,
    contentHash: "b".repeat(64),
    requestSchemaVersion: 1,
    requestHash: "a".repeat(64),
    requestJson: "{}",
    request: relayRequest(runtimeKind),
    requestedByUserId: 30,
    status,
    reviewedByAdminId: status === "APPROVED" || status === "REJECTED" ? 40 : null,
    reviewedAt: status === "APPROVED" || status === "REJECTED" ? NOW.toISOString() : null,
    decisionReasonCode: status === "REJECTED" ? "RUNTIME_REJECTED" : null,
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

class NoProfileWrites implements MultiplayerProfileRepository {
  createCalls = 0;
  record: MultiplayerProfileRecord | null = null;

  async createApprovedRevision(
    input: CreateApprovedMultiplayerProfileInput,
  ): Promise<CreateApprovedMultiplayerProfileResult> {
    this.createCalls += 1;
    this.record = {
      id: 50,
      sourceRequestId: input.sourceRequestId,
      profile: input.profile,
      createdByAdminId: input.createdByAdminId,
      approvedAt: input.nowIso,
      disabledAt: null,
      disabledReasonCode: null,
      disabledByAdminId: null,
      updatedAt: input.nowIso,
    };
    return { status: "CREATED", record: this.record };
  }

  async setEnabled(
    input: SetMultiplayerProfileEnabledInput,
  ): Promise<SetMultiplayerProfileEnabledResult> {
    if (!this.record || this.record.id !== input.profileId) return { status: "NOT_FOUND" };
    this.record = {
      ...this.record,
      profile: { ...this.record.profile, enabled: input.enabled },
      disabledAt: input.enabled ? null : input.nowIso,
      disabledReasonCode: input.reasonCode,
      disabledByAdminId: input.enabled ? null : input.changedByAdminId,
      updatedAt: input.nowIso,
    };
    return { status: "UPDATED", record: this.record };
  }

  async findById(_profileId: number): Promise<MultiplayerProfileRecord | null> {
    return this.record?.id === _profileId ? this.record : null;
  }

  async listManaged(): Promise<readonly MultiplayerProfileRecord[]> {
    return this.record ? [this.record] : [];
  }

  async findLatestForExactVersion(
    _gameId: number,
    _gameVersionId: number,
  ): Promise<MultiplayerProfileRecord | null> {
    return this.record;
  }

  async findEnabledForExactVersion(
    _gameId: number,
    _gameVersionId: number,
  ): Promise<MultiplayerProfileRecord | null> {
    return this.record?.profile.enabled ? this.record : null;
  }
}

test("Relay approval creates one disabled exact-version generic profile", async () => {
  const requests = new FakeRequests();
  const profiles = new NoProfileWrites();
  const useCases = new ManagedMultiplayerProfileReviewUseCases({
    requests,
    profiles,
    now: () => NOW,
  });

  const result = await useCases.approve({ requestId: 1, reviewedByAdminId: 40 });
  assert.equal(result.ok, true);
  assert.equal(requests.record?.status, "APPROVED");
  assert.equal(profiles.createCalls, 1);
  if (!result.ok || !result.profile) return;
  assert.equal(result.profile.profile.contentHash, "b".repeat(64));
  assert.equal("rulesetKey" in result.profile.profile, false);
  assert.equal(result.profile.profile.enabled, false);
});

test("approved profiles remain discoverable for a later independent activation", async () => {
  const requests = new FakeRequests();
  const profiles = new NoProfileWrites();
  const useCases = new ManagedMultiplayerProfileReviewUseCases({
    requests,
    profiles,
    now: () => NOW,
  });

  const approved = await useCases.approve({ requestId: 1, reviewedByAdminId: 40 });
  assert.equal(approved.ok, true);
  assert.deepEqual(await useCases.listManagedProfiles(), approved.ok ? [approved.profile] : []);
});

test("future worker and container requests are never approved by the Relay control plane", async () => {
  for (const runtimeKind of ["worker", "container"] as const) {
    const requests = new FakeRequests(requestRecord("PENDING_REVIEW", runtimeKind));
    const profiles = new NoProfileWrites();
    const useCases = new ManagedMultiplayerProfileReviewUseCases({ requests, profiles });

    const result = await useCases.approve({ requestId: 1, reviewedByAdminId: 40 });
    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.code, "MULTIPLAYER_RUNTIME_NOT_AVAILABLE");
    assert.equal(requests.record?.status, "PENDING_REVIEW");
    assert.equal(profiles.createCalls, 0);
  }
});

test("rejection is final and never creates a runtime profile", async () => {
  const requests = new FakeRequests();
  const profiles = new NoProfileWrites();
  const useCases = new ManagedMultiplayerProfileReviewUseCases({
    requests,
    profiles,
    now: () => NOW,
  });

  const rejected = await useCases.reject({
    requestId: 1,
    reviewedByAdminId: 40,
    reasonCode: "RUNTIME_REJECTED",
  });
  assert.ok(rejected.ok);
  assert.equal(rejected.request.status, "REJECTED");
  assert.equal(rejected.profile, null);
  assert.equal(profiles.createCalls, 0);

  const cannotApprove = await useCases.approve({ requestId: 1, reviewedByAdminId: 40 });
  assert.equal(cannotApprove.ok, false);
  assert.equal(cannotApprove.ok ? null : cannotApprove.code, "REQUEST_NOT_PENDING");
});

test("managed activation cannot revive a missing historical profile", async () => {
  const useCases = new ManagedMultiplayerProfileReviewUseCases({
    requests: new FakeRequests(),
    profiles: new NoProfileWrites(),
  });
  assert.deepEqual(
    await useCases.setProfileEnabled({
      profileId: 999,
      enabled: true,
      changedByAdminId: 40,
      reasonCode: null,
    }),
    { ok: false, code: "PROFILE_NOT_FOUND" },
  );
});

test("managed activation enables only the profile connected to its approved request", async () => {
  const requests = new FakeRequests();
  const profiles = new NoProfileWrites();
  const useCases = new ManagedMultiplayerProfileReviewUseCases({
    requests,
    profiles,
    now: () => NOW,
  });
  const approved = await useCases.approve({ requestId: 1, reviewedByAdminId: 40 });
  assert.equal(approved.ok, true);
  const activated = await useCases.setProfileEnabled({
    profileId: 50,
    enabled: true,
    changedByAdminId: 40,
    reasonCode: null,
  });
  assert.equal(activated.ok, true);
  if (activated.ok) assert.equal(activated.profile.profile.enabled, true);
});
