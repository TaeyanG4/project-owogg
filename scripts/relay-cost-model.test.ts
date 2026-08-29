import assert from "node:assert/strict";
import test from "node:test";
import { projectDenseRelayRoomCost, RELAY_COST_PRICING_AS_OF } from "./relay-cost-model.js";

test("Relay dense-room model exposes 2, 4, and 8 player fanout without charging outgoing messages", () => {
  const two = projectDenseRelayRoomCost({
    players: 2,
    messagesPerSecondPerPlayer: 1,
    durationSeconds: 600,
  });
  assert.equal(RELAY_COST_PRICING_AS_OF, "2026-08-25");
  assert.equal(two.incomingMessages, 1_200);
  assert.equal(two.outgoingDeliveries, 2_400);
  assert.equal(two.requestEquivalents, 62);
  assert.equal(two.explicitRowsWritten, 1_200);
  assert.equal(two.denseDurationGbSeconds, 76.8);

  const four = projectDenseRelayRoomCost({
    players: 4,
    messagesPerSecondPerPlayer: 5,
    durationSeconds: 600,
  });
  assert.equal(four.incomingMessages, 12_000);
  assert.equal(four.outgoingDeliveries, 48_000);
  assert.equal(four.requestEquivalents, 604);
  assert.equal(four.explicitRowsWritten, 12_000);

  const eight = projectDenseRelayRoomCost({
    players: 8,
    messagesPerSecondPerPlayer: 20,
    durationSeconds: 300,
  });
  assert.equal(eight.incomingMessages, 48_000);
  assert.equal(eight.outgoingDeliveries, 384_000);
  assert.equal(eight.requestEquivalents, 2_408);
  assert.equal(eight.explicitRowsWritten, 48_000);
  assert.equal(eight.denseDurationGbSeconds, 38.4);
  assert.ok(Math.abs(eight.marginalUsdBeyondIncluded.total - 0.0488412) < 1e-12);
});

test("Relay cost model rejects unsupported room sizes and invalid rates", () => {
  for (const players of [1, 9, 2.5]) {
    assert.throws(() =>
      projectDenseRelayRoomCost({ players, messagesPerSecondPerPlayer: 1, durationSeconds: 1 }),
    );
  }
  assert.throws(() =>
    projectDenseRelayRoomCost({
      players: 2,
      messagesPerSecondPerPlayer: Number.NaN,
      durationSeconds: 1,
    }),
  );
});
