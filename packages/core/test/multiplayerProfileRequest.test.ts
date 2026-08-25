import assert from "node:assert/strict";
import test from "node:test";
import {
  hashManagedMultiplayerProfileRequestV1,
  MultiplayerProfileRequestValidationError,
  parseManagedMultiplayerProfileRequestV1,
  resolveManagedMultiplayerProfileRequestV1,
  serializeManagedMultiplayerProfileRequestV1,
} from "../src/modules/multiplayer/domain/multiplayerProfileRequest.js";

function turnGridRequest(): Record<string, unknown> {
  return {
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
  };
}

test("parses the planned owogg.json v2 managed turn-grid request and resolves server policy", () => {
  const request = parseManagedMultiplayerProfileRequestV1(turnGridRequest());
  assert.equal(request.requestSchemaVersion, 1);
  assert.deepEqual(request.template, { id: "turn-grid", version: 1 });
  assert.equal(request.capability.authority, "server");
  assert.deepEqual(resolveManagedMultiplayerProfileRequestV1(request), {
    status: "SUPPORTED_V1",
    request,
    resolvedClass: "M1",
    runtimeBackend: "durable-object",
    checkpointPolicy: "accepted-action",
    activeRestartPolicy: "restore-checkpoint",
  });
});

test("rejects creator attempts to declare internal authority, reward, endpoint, or server code", () => {
  for (const forbidden of [
    { runtimeBackend: "durable-object" },
    { rewardPolicy: { xp: 9999 } },
    { websocketUrl: "wss://example.invalid" },
    { serverCode: "while(true){}" },
  ]) {
    assert.throws(
      () => parseManagedMultiplayerProfileRequestV1({ ...turnGridRequest(), ...forbidden }),
      MultiplayerProfileRequestValidationError,
    );
  }
  assert.throws(
    () =>
      parseManagedMultiplayerProfileRequestV1({
        ...turnGridRequest(),
        template: { id: "custom-server", version: 1 },
      }),
    MultiplayerProfileRequestValidationError,
  );
});

test("enforces exact template config, capability compatibility, and pinned versions", () => {
  assert.throws(
    () =>
      parseManagedMultiplayerProfileRequestV1({
        ...turnGridRequest(),
        config: { boardWidth: 10, boardHeight: 10, winLength: 11 },
      }),
    /winLength cannot exceed/,
  );
  assert.throws(
    () =>
      parseManagedMultiplayerProfileRequestV1({
        ...turnGridRequest(),
        template: { id: "turn-grid", version: "latest" },
      }),
    /version must be exactly 1/,
  );
  const original = turnGridRequest();
  assert.throws(
    () =>
      parseManagedMultiplayerProfileRequestV1({
        ...original,
        requirements: {
          ...(original.requirements as Record<string, unknown>),
          simulation: "realtime",
          latency: "interactive",
        },
      }),
    /turn-grid requirements do not match/,
  );
});

test("maps realtime-paddle to M2 without allowing the manifest to select a backend", () => {
  const request = parseManagedMultiplayerProfileRequestV1({
    kind: "managed-template",
    template: { id: "realtime-paddle", version: 1 },
    players: { min: 2, max: 2 },
    requirements: {
      simulation: "realtime",
      lifecycle: "continuous",
      persistence: "match",
      latency: "interactive",
      reconnect: "resume",
      hiddenInformation: false,
      simultaneousResponse: true,
      joinInProgress: false,
      spectators: false,
    },
    config: { fieldWidth: 1280, fieldHeight: 720, targetScore: 7 },
    client: { protocolVersion: 1 },
  });
  const resolution = resolveManagedMultiplayerProfileRequestV1(request);
  assert.equal(resolution.status, "SUPPORTED_V1");
  assert.equal(resolution.status === "SUPPORTED_V1" ? resolution.resolvedClass : null, "M2");
  assert.equal(
    resolution.status === "SUPPORTED_V1" ? resolution.activeRestartPolicy : null,
    "abort-infra",
  );
});

test("canonicalizes and hashes equivalent owogg.json requests independently of input key order", async () => {
  const normal = parseManagedMultiplayerProfileRequestV1(turnGridRequest());
  const reordered = parseManagedMultiplayerProfileRequestV1({
    client: { protocolVersion: 1 },
    config: { winLength: 5, boardHeight: 15, boardWidth: 15 },
    requirements: {
      spectators: false,
      joinInProgress: false,
      simultaneousResponse: false,
      hiddenInformation: false,
      reconnect: "resume",
      latency: "relaxed",
      persistence: "match",
      lifecycle: "match",
      simulation: "turn",
    },
    players: { max: 2, min: 2 },
    template: { version: 1, id: "turn-grid" },
    kind: "managed-template",
  });

  const canonical = serializeManagedMultiplayerProfileRequestV1(normal);
  assert.equal(serializeManagedMultiplayerProfileRequestV1(reordered), canonical);
  assert.deepEqual(parseManagedMultiplayerProfileRequestV1(JSON.parse(canonical)), normal);
  const hash = await hashManagedMultiplayerProfileRequestV1(normal);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(await hashManagedMultiplayerProfileRequestV1(reordered), hash);
});
