import assert from "node:assert/strict";
import test from "node:test";
import {
  MultiplayerProfileValidationError,
  parseApprovedMultiplayerProfileV1,
  type ApprovedMultiplayerProfileV1,
} from "../src/modules/multiplayer/domain/multiplayerProfile.js";

const validProfile: ApprovedMultiplayerProfileV1 = {
  profileVersion: 1,
  gameId: 1,
  gameVersionId: 2,
  sourceRequestHash: null,
  profileRevision: 1,
  protocolVersion: 1,
  resolvedClass: "M1",
  simulationModel: "turn",
  runtimeBackend: "durable-object",
  rulesetKey: "official:omok",
  rulesetRevision: 1,
  resolvedConfigJson: '{"boardSize":15,"winLength":5}',
  lifecycle: "match",
  persistence: "match",
  latencyProfile: "relaxed",
  reconnectPolicy: "resume",
  minPlayers: 2,
  maxPlayers: 2,
  allowedVisibility: ["PRIVATE", "UNLISTED"],
  allowedJoinPolicies: ["INVITE_ONLY"],
  maxActionBytes: 1024,
  maxStateBytes: 8192,
  actionRateLimit: 5,
  rewardPolicyId: null,
  enabled: false,
};

test("parses an exact version-scoped trusted profile", () => {
  assert.deepEqual(parseApprovedMultiplayerProfileV1(validProfile), validProfile);
});

test("rejects creator-controlled backend/reward extensions and unknown keys", () => {
  assert.throws(
    () =>
      parseApprovedMultiplayerProfileV1({
        ...validProfile,
        externalWebSocketUrl: "wss://example.invalid",
      }),
    MultiplayerProfileValidationError,
  );
  assert.throws(
    () => parseApprovedMultiplayerProfileV1({ ...validProfile, runtimeBackend: "creator" }),
    /runtimeBackend must be one of durable-object/,
  );
});

test("enforces class/simulation/latency consistency and V1 limits", () => {
  assert.throws(
    () =>
      parseApprovedMultiplayerProfileV1({
        ...validProfile,
        resolvedClass: "M1",
        simulationModel: "realtime",
      }),
    /M1 profiles cannot use realtime simulation/,
  );
  assert.throws(
    () => parseApprovedMultiplayerProfileV1({ ...validProfile, maxPlayers: 9 }),
    /maxPlayers must be an integer between 2 and 8/,
  );
  assert.throws(
    () => parseApprovedMultiplayerProfileV1({ ...validProfile, maxActionBytes: 4097 }),
    /maxActionBytes must be an integer between 1 and 4096/,
  );
});

test("requires immutable identifiers and bounded object configuration", () => {
  assert.throws(
    () => parseApprovedMultiplayerProfileV1({ ...validProfile, sourceRequestHash: "latest" }),
    /sourceRequestHash must be null or a lowercase SHA-256/,
  );
  assert.throws(
    () => parseApprovedMultiplayerProfileV1({ ...validProfile, rulesetKey: "" }),
    /rulesetKey must be a stable lowercase identifier/,
  );
  assert.throws(
    () => parseApprovedMultiplayerProfileV1({ ...validProfile, rulesetKey: null }),
    /rulesetKey must be a stable lowercase identifier/,
  );
  assert.throws(
    () => parseApprovedMultiplayerProfileV1({ ...validProfile, resolvedConfigJson: "[]" }),
    /resolvedConfigJson must contain a JSON object/,
  );
});
