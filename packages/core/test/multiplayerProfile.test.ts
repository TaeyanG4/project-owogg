import assert from "node:assert/strict";
import test from "node:test";
import {
  MultiplayerProfileValidationError,
  parseApprovedMultiplayerProfileV1,
  type ApprovedRelayMultiplayerProfileV1,
} from "../src/modules/multiplayer/domain/multiplayerProfile.js";

const validProfile: ApprovedRelayMultiplayerProfileV1 = {
  profileVersion: 1,
  gameId: 1,
  gameVersionId: 2,
  contentHash: "b".repeat(64),
  sourceRequestHash: "a".repeat(64),
  profileRevision: 1,
  transportKind: "websocket",
  runtimeKind: "relay",
  protocolVersion: 1,
  lifecycle: "match",
  reconnectPolicy: "resume",
  directMessages: true,
  hostSnapshot: true,
  minPlayers: 2,
  maxPlayers: 8,
  allowedVisibility: ["PRIVATE"],
  allowedJoinPolicies: ["OPEN"],
  hostDeparturePolicy: "close",
  resultTrust: "UNVERIFIED",
  maxMessageBytes: 4096,
  maxSnapshotBytes: 16384,
  messagesPerSecond: 20,
  roomBytesPerSecond: 262144,
  roomTtlSeconds: 7200,
  enabled: false,
};

test("parses an exact content-hash-pinned Relay profile", () => {
  assert.deepEqual(parseApprovedMultiplayerProfileV1(validProfile), validProfile);
});

test("rejects game-specific authority and unknown profile keys", () => {
  assert.throws(
    () => parseApprovedMultiplayerProfileV1({ ...validProfile, serverRules: "creator-defined" }),
    MultiplayerProfileValidationError,
  );
  assert.throws(
    () => parseApprovedMultiplayerProfileV1({ ...validProfile, runtimeKind: "worker" }),
    /runtimeKind must be relay/,
  );
});

test("requires exact request and bundle hashes with bounded Relay policy", () => {
  assert.throws(
    () => parseApprovedMultiplayerProfileV1({ ...validProfile, contentHash: "latest" }),
    /contentHash must be a lowercase SHA-256/,
  );
  assert.throws(
    () => parseApprovedMultiplayerProfileV1({ ...validProfile, sourceRequestHash: "latest" }),
    /sourceRequestHash must be a lowercase SHA-256/,
  );
  assert.throws(
    () => parseApprovedMultiplayerProfileV1({ ...validProfile, maxPlayers: 9 }),
    /maxPlayers must be an integer between 2 and 8/,
  );
  assert.throws(
    () => parseApprovedMultiplayerProfileV1({ ...validProfile, maxMessageBytes: 4097 }),
    /maxMessageBytes must be an integer between 1 and 4096/,
  );
});

test("snapshot bytes and access policy cannot contradict the approved Relay capability", () => {
  assert.throws(
    () => parseApprovedMultiplayerProfileV1({ ...validProfile, hostSnapshot: false }),
    /maxSnapshotBytes must match hostSnapshot/,
  );
  assert.throws(
    () => parseApprovedMultiplayerProfileV1({ ...validProfile, allowedVisibility: ["PUBLIC"] }),
    /allowedVisibility must be \[PRIVATE\]/,
  );
});
