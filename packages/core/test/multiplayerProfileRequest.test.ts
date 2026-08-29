import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveMultiplayerRelayProfilePolicyV1,
  hashMultiplayerRuntimeProfileRequestV1,
  MultiplayerProfileRequestValidationError,
  parseMultiplayerRuntimeProfileRequestV1,
  resolveMultiplayerRuntimeProfileRequestV1,
  serializeMultiplayerRuntimeProfileRequestV1,
} from "../src/modules/multiplayer/domain/multiplayerProfileRequest.js";

function relayRequest(): Record<string, unknown> {
  return {
    version: 1,
    transport: { kind: "websocket", protocolVersion: 1 },
    runtime: { kind: "relay" },
    players: { min: 2, max: 8 },
    features: {
      reconnect: "resume",
      directMessages: true,
      hostSnapshot: true,
      joinInProgress: false,
      spectators: false,
    },
  };
}

test("parses a generic websocket Relay request and derives only server-owned limits", () => {
  const request = parseMultiplayerRuntimeProfileRequestV1(relayRequest());
  assert.equal(request.requestSchemaVersion, 1);
  assert.deepEqual(request.runtime, { kind: "relay" });
  assert.deepEqual(request.players, { min: 2, max: 8 });

  const policy = deriveMultiplayerRelayProfilePolicyV1(request);
  assert.deepEqual(policy, {
    transportKind: "websocket",
    runtimeKind: "relay",
    protocolVersion: 1,
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
  });

  const resolution = resolveMultiplayerRuntimeProfileRequestV1(request);
  assert.equal(resolution.status, "SUPPORTED_V1");
  assert.equal(resolution.status === "SUPPORTED_V1" ? resolution.resultTrust : null, "UNVERIFIED");
});

test("parses future runtime choices but fails them closed before review", () => {
  for (const runtimeKind of ["worker", "container"] as const) {
    const request = parseMultiplayerRuntimeProfileRequestV1({
      ...relayRequest(),
      runtime: { kind: runtimeKind },
    });
    assert.deepEqual(resolveMultiplayerRuntimeProfileRequestV1(request), {
      status: "RUNTIME_NOT_AVAILABLE",
      request,
      runtimeKind,
      reason: "MULTIPLAYER_RUNTIME_NOT_AVAILABLE",
    });
  }
});

test("fails unsupported Relay lifecycle capabilities closed", () => {
  const source = relayRequest();
  const request = parseMultiplayerRuntimeProfileRequestV1({
    ...source,
    features: {
      ...(source.features as Record<string, unknown>),
      joinInProgress: true,
      spectators: true,
    },
  });
  assert.deepEqual(resolveMultiplayerRuntimeProfileRequestV1(request), {
    status: "CAPABILITY_NOT_AVAILABLE",
    request,
    runtimeKind: "relay",
    unsupportedCapabilities: ["joinInProgress", "spectators"],
    reason: "MULTIPLAYER_CAPABILITY_NOT_AVAILABLE",
  });
});

test("pins request and transport protocol v1 and the initial 2-8 player boundary", () => {
  const source = relayRequest();
  const { version: _version, ...withoutVersion } = source;
  assert.throws(
    () => parseMultiplayerRuntimeProfileRequestV1(withoutVersion),
    /multiplayer.version must be 1/,
  );
  assert.throws(
    () => parseMultiplayerRuntimeProfileRequestV1({ ...source, version: 2 }),
    /multiplayer.version must be 1/,
  );
  assert.throws(
    () =>
      parseMultiplayerRuntimeProfileRequestV1({
        ...source,
        transport: { kind: "websocket", protocolVersion: 2 },
      }),
    /protocolVersion must be 1/,
  );
  assert.throws(
    () => parseMultiplayerRuntimeProfileRequestV1({ ...source, players: { min: 2, max: 9 } }),
    /between 2 and 8/,
  );
  assert.throws(
    () => parseMultiplayerRuntimeProfileRequestV1({ ...source, players: { min: 5, max: 4 } }),
    /min cannot exceed max/,
  );
});

test("rejects game-specific rules, rewards, endpoints, and executable server code", () => {
  for (const forbidden of [
    { template: { id: "turn-grid", version: 1 } },
    { serverRules: "creator-defined" },
    { config: { boardWidth: 15 } },
    { rewardPolicy: { xp: 9999 } },
    { websocketUrl: "wss://example.invalid" },
    { serverCode: "while(true){}" },
  ]) {
    assert.throws(
      () => parseMultiplayerRuntimeProfileRequestV1({ ...relayRequest(), ...forbidden }),
      MultiplayerProfileRequestValidationError,
    );
  }
});

test("canonicalizes and hashes equivalent requests independently of key order", async () => {
  const normal = parseMultiplayerRuntimeProfileRequestV1(relayRequest());
  const reordered = parseMultiplayerRuntimeProfileRequestV1({
    features: {
      spectators: false,
      joinInProgress: false,
      hostSnapshot: true,
      directMessages: true,
      reconnect: "resume",
    },
    players: { max: 8, min: 2 },
    runtime: { kind: "relay" },
    transport: { protocolVersion: 1, kind: "websocket" },
    version: 1,
  });

  const canonical = serializeMultiplayerRuntimeProfileRequestV1(normal);
  assert.equal(serializeMultiplayerRuntimeProfileRequestV1(reordered), canonical);
  assert.deepEqual(parseMultiplayerRuntimeProfileRequestV1(JSON.parse(canonical)), normal);
  const hash = await hashMultiplayerRuntimeProfileRequestV1(normal);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(await hashMultiplayerRuntimeProfileRequestV1(reordered), hash);
});
