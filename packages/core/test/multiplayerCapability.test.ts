import assert from "node:assert/strict";
import test from "node:test";
import {
  MULTIPLAYER_CLASSES,
  MultiplayerCapabilityValidationError,
  parseMultiplayerCapabilityRequestV1,
  resolveMultiplayerClassV1,
  resolveMultiplayerRuntimeV1,
} from "../src/modules/multiplayer/domain/multiplayerCapability.js";

function capability(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    players: { min: 2, max: 2 },
    simulation: "turn",
    authority: "server",
    lifecycle: "match",
    persistence: "match",
    latency: "relaxed",
    reconnect: "resume",
    capabilities: {
      hiddenInformation: false,
      simultaneousResponse: false,
      joinInProgress: false,
      spectators: false,
    },
    ...overrides,
  };
}

test("keeps M0-M6 as provider-neutral capability classes", () => {
  assert.deepEqual(MULTIPLAYER_CLASSES, ["M0", "M1", "M2", "M3", "M4", "M5", "M6"]);
});

test("resolves turn-based and interactive event capabilities without binding a vendor", () => {
  const turn = parseMultiplayerCapabilityRequestV1(capability());
  assert.deepEqual(resolveMultiplayerClassV1(turn), {
    status: "SUPPORTED_V1",
    resolvedClass: "M1",
  });

  const reaction = parseMultiplayerCapabilityRequestV1(
    capability({ simulation: "event", latency: "interactive", reconnect: "none" }),
  );
  assert.deepEqual(resolveMultiplayerClassV1(reaction), {
    status: "SUPPORTED_V1",
    resolvedClass: "M2",
  });
  assert.deepEqual(resolveMultiplayerRuntimeV1(turn), {
    status: "SUPPORTED_V1",
    resolvedClass: "M1",
    runtimeBackend: "durable-object",
    checkpointPolicy: "accepted-action",
    activeRestartPolicy: "restore-checkpoint",
  });
  assert.deepEqual(resolveMultiplayerRuntimeV1(reaction), {
    status: "SUPPORTED_V1",
    resolvedClass: "M2",
    runtimeBackend: "durable-object",
    checkpointPolicy: "phase-boundary",
    activeRestartPolicy: "abort-infra",
  });
});

test("defers rollback and persistent-world requests to explicit future gates", () => {
  const rollback = parseMultiplayerCapabilityRequestV1(
    capability({ simulation: "rollback", latency: "critical" }),
  );
  assert.equal(resolveMultiplayerClassV1(rollback).status, "DEFERRED");
  assert.equal(
    resolveMultiplayerClassV1(rollback).status === "DEFERRED"
      ? resolveMultiplayerClassV1(rollback).requiredClass
      : null,
    "M3",
  );

  const world = parseMultiplayerCapabilityRequestV1(
    capability({ lifecycle: "persistent", persistence: "world" }),
  );
  assert.deepEqual(resolveMultiplayerClassV1(world), {
    status: "DEFERRED",
    requiredClass: "M5",
    reason: "persistent world capabilities are gated after M1/M2 production measurements",
  });
});

test("does not infer M4 from player count and enforces the V1 load gate", () => {
  const request = parseMultiplayerCapabilityRequestV1(capability({ players: { min: 2, max: 9 } }));
  const resolution = resolveMultiplayerClassV1(request);
  assert.equal(resolution.status, "UNSUPPORTED_V1");
  assert.match(resolution.reason, /capped at 8 participants/);
});

test("rejects unknown keys and inconsistent capability combinations", () => {
  assert.throws(
    () => parseMultiplayerCapabilityRequestV1(capability({ backendClass: "cloudflare-do" })),
    MultiplayerCapabilityValidationError,
  );
  assert.throws(
    () =>
      parseMultiplayerCapabilityRequestV1(
        capability({ simulation: "rollback", latency: "interactive" }),
      ),
    /rollback simulation requires critical latency/,
  );
  assert.throws(
    () =>
      parseMultiplayerCapabilityRequestV1(
        capability({ lifecycle: "persistent", persistence: "match" }),
      ),
    /persistent lifecycle requires world persistence/,
  );
});
