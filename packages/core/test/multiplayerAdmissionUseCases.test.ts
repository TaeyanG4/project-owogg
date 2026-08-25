import assert from "node:assert/strict";
import test from "node:test";
import {
  MultiplayerAdmissionUseCases,
  createMultiplayerTicketKeyring,
  verifyMultiplayerJoinTicket,
  type GameVersionLeaseRecord,
  type MultiplayerInstanceRecord,
  type MultiplayerInstanceRepository,
  type MultiplayerParticipantRecord,
  type MultiplayerProfileRecord,
  type MultiplayerProfileRepository,
} from "../src/index.js";

const NOW = new Date("2026-08-26T00:00:00.000Z");
const keyring = createMultiplayerTicketKeyring({
  kid: "test_key",
  secret: "test-multiplayer-ticket-secret-32-bytes-minimum",
});

const instance: MultiplayerInstanceRecord = {
  id: "instance_12345678",
  publicCode: "publiccode_123456",
  createdByUserId: 7,
  createIdempotencyHash: "a".repeat(64),
  gameId: 11,
  gameVersionId: 12,
  profileId: 13,
  profileRevision: 2,
  visibility: "PRIVATE",
  joinPolicy: "INVITE_ONLY",
  lifecycle: "match",
  status: "ACTIVE",
  generation: 3,
  participantCount: 2,
  maxPlayers: 2,
  expiresAt: "2026-08-26T01:00:00.000Z",
  closedAt: null,
  abortCode: null,
  createdAt: "2026-08-25T23:00:00.000Z",
  updatedAt: "2026-08-25T23:30:00.000Z",
};

const participant: MultiplayerParticipantRecord = {
  id: "participant_12345678",
  instanceId: instance.id,
  userId: 7,
  role: "HOST",
  seatIndex: 0,
  status: "READY",
  connectionGeneration: 4,
  joinedAt: "2026-08-25T23:00:00.000Z",
  readyAt: "2026-08-25T23:10:00.000Z",
  leftAt: null,
  updatedAt: "2026-08-25T23:30:00.000Z",
};

const lease: GameVersionLeaseRecord = {
  id: 9,
  gameVersionId: instance.gameVersionId,
  instanceId: instance.id,
  generation: instance.generation,
  status: "ACTIVE",
  acquiredAt: "2026-08-25T23:00:00.000Z",
  expiresAt: "2026-08-26T01:05:00.000Z",
  endedAt: null,
  endReasonCode: null,
  updatedAt: "2026-08-25T23:00:00.000Z",
};

const profile: MultiplayerProfileRecord = {
  id: instance.profileId,
  sourceRequestId: null,
  profile: {
    profileVersion: 1,
    gameId: instance.gameId,
    gameVersionId: instance.gameVersionId,
    sourceRequestHash: null,
    profileRevision: instance.profileRevision,
    protocolVersion: 1,
    resolvedClass: "M1",
    simulationModel: "turn",
    runtimeBackend: "durable-object",
    rulesetKey: "official:omok:v1",
    rulesetRevision: 1,
    resolvedConfigJson: '{"boardWidth":15,"boardHeight":15,"winLength":5}',
    lifecycle: "match",
    persistence: "match",
    latencyProfile: "relaxed",
    reconnectPolicy: "resume",
    minPlayers: 2,
    maxPlayers: 2,
    allowedVisibility: ["PRIVATE"],
    allowedJoinPolicies: ["INVITE_ONLY"],
    maxActionBytes: 4096,
    maxStateBytes: 16384,
    actionRateLimit: 10,
    rewardPolicyId: null,
    // Existing participants may reconnect while an operator drains new admission.
    enabled: false,
  },
  createdByAdminId: 1,
  approvedAt: "2026-08-25T22:00:00.000Z",
  disabledAt: "2026-08-25T23:45:00.000Z",
  disabledReasonCode: "DRAIN",
  disabledByAdminId: 1,
  updatedAt: "2026-08-25T23:45:00.000Z",
};

function repositories(overrides?: {
  instance?: MultiplayerInstanceRecord | null;
  participant?: MultiplayerParticipantRecord | null;
  lease?: GameVersionLeaseRecord | null;
  profile?: MultiplayerProfileRecord | null;
  advanceSucceeds?: boolean;
}): {
  instances: MultiplayerInstanceRepository;
  profiles: MultiplayerProfileRepository;
  advances: Array<number>;
} {
  const advances: number[] = [];
  const selectedInstance = overrides && "instance" in overrides ? overrides.instance : instance;
  const selectedParticipant =
    overrides && "participant" in overrides ? overrides.participant : participant;
  const selectedLease = overrides && "lease" in overrides ? overrides.lease : lease;
  const selectedProfile = overrides && "profile" in overrides ? overrides.profile : profile;
  return {
    advances,
    instances: {
      async findById() {
        return selectedInstance ?? null;
      },
      async findParticipant() {
        return selectedParticipant ?? null;
      },
      async findLease() {
        return selectedLease ?? null;
      },
      async advanceConnectionGeneration(input) {
        advances.push(input.expectedConnectionGeneration);
        if (overrides?.advanceSucceeds === false || !selectedParticipant) return null;
        return {
          ...selectedParticipant,
          connectionGeneration: selectedParticipant.connectionGeneration + 1,
          updatedAt: input.nowIso,
        };
      },
    } as MultiplayerInstanceRepository,
    profiles: {
      async findById() {
        return selectedProfile ?? null;
      },
    } as MultiplayerProfileRepository,
  };
}

test("admission issues a 30-second ticket after atomically advancing connection generation", async () => {
  const repos = repositories();
  const useCases = new MultiplayerAdmissionUseCases({
    instances: repos.instances,
    profiles: repos.profiles,
    now: () => NOW,
    createJti: () => "ticket_nonce_123456789",
  });
  const result = await useCases.issueJoinTicket({
    userId: 7,
    instanceId: instance.id,
    expectedConnectionGeneration: 4,
    keyring,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(repos.advances, [4]);
  if (!result.ok) return;
  assert.equal(result.connectionGeneration, 5);
  assert.equal(result.expiresAt, "2026-08-26T00:00:30.000Z");
  assert.deepEqual(result.bootstrap, {
    type: "MULTI_INIT",
    v: 1,
    participantId: participant.id,
    gameVersionId: instance.gameVersionId,
    profileRevision: instance.profileRevision,
    rulesetKey: "official:omok:v1",
    rulesetRevision: 1,
    generation: instance.generation,
  });
  const verified = await verifyMultiplayerJoinTicket(
    result.ticket,
    keyring,
    { instanceId: instance.id, userId: 7, connectionGeneration: 5 },
    Math.floor(NOW.getTime() / 1000),
  );
  assert.equal(verified.ok, true);
});

test("admission allows an existing participant to reconnect while profile is disabled", async () => {
  const repos = repositories();
  const result = await new MultiplayerAdmissionUseCases({
    instances: repos.instances,
    profiles: repos.profiles,
    now: () => NOW,
    createJti: () => "ticket_nonce_123456789",
  }).issueJoinTicket({
    userId: 7,
    instanceId: instance.id,
    expectedConnectionGeneration: 4,
    keyring,
  });
  assert.equal(result.ok, true);
});

test("admission fails before advancing for missing participant, stale generation, and bad lease", async () => {
  for (const [overrides, code] of [
    [{ participant: null }, "NOT_PARTICIPANT"],
    [{ participant: { ...participant, connectionGeneration: 5 } }, "STALE_GENERATION"],
    [{ lease: { ...lease, status: "RELEASED" as const } }, "VERSION_MISMATCH"],
  ] as const) {
    const repos = repositories(overrides);
    const result = await new MultiplayerAdmissionUseCases({
      instances: repos.instances,
      profiles: repos.profiles,
      now: () => NOW,
    }).issueJoinTicket({
      userId: 7,
      instanceId: instance.id,
      expectedConnectionGeneration: 4,
      keyring,
    });
    assert.deepEqual(result, { ok: false, code });
    assert.deepEqual(repos.advances, []);
  }
});

test("admission returns a typed conflict when the connection-generation CAS loses", async () => {
  const repos = repositories({ advanceSucceeds: false });
  const result = await new MultiplayerAdmissionUseCases({
    instances: repos.instances,
    profiles: repos.profiles,
    now: () => NOW,
  }).issueJoinTicket({
    userId: 7,
    instanceId: instance.id,
    expectedConnectionGeneration: 4,
    keyring,
  });
  assert.deepEqual(result, { ok: false, code: "STALE_GENERATION" });
  assert.deepEqual(repos.advances, [4]);
});

test("admission bounds ticket expiry by the instance/lease authority", async () => {
  const repos = repositories({
    instance: { ...instance, expiresAt: "2026-08-26T00:00:07.900Z" },
  });
  const result = await new MultiplayerAdmissionUseCases({
    instances: repos.instances,
    profiles: repos.profiles,
    now: () => NOW,
    createJti: () => "ticket_nonce_123456789",
  }).issueJoinTicket({
    userId: 7,
    instanceId: instance.id,
    expectedConnectionGeneration: 4,
    keyring,
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.expiresAt, "2026-08-26T00:00:07.000Z");
});
