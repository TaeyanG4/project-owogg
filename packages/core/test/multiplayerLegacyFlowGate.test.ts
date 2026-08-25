import assert from "node:assert/strict";
import test from "node:test";
import {
  MultiplayerLegacyFlowGate,
  type MultiplayerProfileRecord,
  type MultiplayerProfileRepository,
} from "../src/index.js";

function gateWith(
  find: (gameId: number, gameVersionId: number) => Promise<MultiplayerProfileRecord | null>,
) {
  return new MultiplayerLegacyFlowGate({
    findEnabledForExactVersion: find,
  } as unknown as MultiplayerProfileRepository);
}

function record(gameId: number, gameVersionId: number, enabled = true): MultiplayerProfileRecord {
  return {
    profile: { gameId, gameVersionId, enabled },
  } as MultiplayerProfileRecord;
}

test("only the absence of an enabled exact-version profile permits legacy gameplay", async () => {
  let context: readonly [number, number] | null = null;
  const gate = gateWith(async (gameId, gameVersionId) => {
    context = [gameId, gameVersionId];
    return null;
  });

  assert.deepEqual(await gate.evaluate(4, 9), { allowed: true });
  assert.deepEqual(context, [4, 9]);
  assert.deepEqual(await gateWith(async () => record(4, 9)).evaluate(4, 9), {
    allowed: false,
    error: "MULTIPLAYER_MANAGED",
  });
});

test("repository errors and inconsistent records both fail closed", async () => {
  assert.deepEqual(
    await gateWith(async () => {
      throw new Error("D1 unavailable");
    }).evaluate(4, 9),
    { allowed: false, error: "MULTIPLAYER_AUTHORITY_UNAVAILABLE" },
  );
  assert.deepEqual(await gateWith(async () => record(4, 10)).evaluate(4, 9), {
    allowed: false,
    error: "MULTIPLAYER_AUTHORITY_UNAVAILABLE",
  });
  assert.deepEqual(await gateWith(async () => record(4, 9, false)).evaluate(4, 9), {
    allowed: false,
    error: "MULTIPLAYER_AUTHORITY_UNAVAILABLE",
  });
});
