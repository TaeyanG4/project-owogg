import assert from "node:assert/strict";
import test from "node:test";
import type { MultiplayerLobbyChangedMessage, MultiplayerRoomPlayer } from "@owogg/contracts";
import {
  applyMultiplayerLobbyChange,
  multiplayerLobbyCanStart,
  multiplayerLobbyReconnectDelay,
  multiplayerLobbyRosterSounds,
  multiplayerLobbySlotCount,
} from "../features/game/runtime/MultiplayerRoomLobby";

function player(seatIndex: number, status: "JOINED" | "READY" = "READY"): MultiplayerRoomPlayer {
  return {
    participantId: `participant_lobby_${String(seatIndex).padStart(4, "0")}`,
    role: seatIndex === 0 ? "HOST" : "PLAYER",
    seatIndex,
    status,
    nickname: `Player ${seatIndex + 1}`,
    avatarUrl: null,
  };
}

test("host readiness is implicit while every ordinary player must be ready", () => {
  assert.equal(multiplayerLobbyCanStart([player(0)], 2), false);
  assert.equal(multiplayerLobbyCanStart([player(0), player(1, "JOINED")], 2), false);
  assert.equal(multiplayerLobbyCanStart([player(0), player(1)], 2), true);
  assert.equal(multiplayerLobbyCanStart([player(0, "JOINED"), player(1)], 2), true);
  assert.equal(multiplayerLobbyCanStart([player(0), player(1), player(2)], 4), false);
});

test("the shared lobby renders profile-sized slots and is future-safe up to sixteen", () => {
  assert.equal(multiplayerLobbySlotCount(2, 0), 2);
  assert.equal(multiplayerLobbySlotCount(4, 3), 4);
  assert.equal(multiplayerLobbySlotCount(8, 8), 8);
  assert.equal(multiplayerLobbySlotCount(16, 12), 16);
  assert.equal(multiplayerLobbySlotCount(20, 20), 16);
});

test("the lobby gives only a previously healthy realtime channel a finite reconnect budget", () => {
  assert.equal(multiplayerLobbyReconnectDelay(false, 0), null);
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((attempt) => multiplayerLobbyReconnectDelay(true, attempt)),
    [1_000, 3_000, 10_000, 30_000, null],
  );
  assert.equal(multiplayerLobbyReconnectDelay(true, -1), null);
});

test("lobby sounds announce only other players entering and leaving after the initial roster", () => {
  const self = player(0);
  const opponent = player(1);
  assert.deepEqual(multiplayerLobbyRosterSounds(null, [self], self.participantId), []);
  assert.deepEqual(
    multiplayerLobbyRosterSounds(
      new Set([self.participantId]),
      [self, opponent],
      self.participantId,
    ),
    ["JOIN"],
  );
  assert.deepEqual(
    multiplayerLobbyRosterSounds(
      new Set([self.participantId, opponent.participantId]),
      [self],
      self.participantId,
    ),
    ["LEAVE"],
  );
  assert.deepEqual(multiplayerLobbyRosterSounds(new Set(), [self], self.participantId), []);
});

test("ready-state lobby deltas repaint immediately while gaps require roster reconciliation", () => {
  const players = [player(0), player(1, "JOINED")];
  const target = players[1];
  assert.ok(target);
  const message: MultiplayerLobbyChangedMessage = {
    type: "LOBBY_CHANGED",
    v: 1,
    instanceId: "instance_lobby_test_01",
    generation: 1,
    sequence: 1,
    change: {
      kind: "PARTICIPANT_READY",
      participantId: target.participantId,
      status: "READY",
    },
  };
  assert.equal(applyMultiplayerLobbyChange(players, message, false)?.[1]?.status, "READY");
  assert.equal(applyMultiplayerLobbyChange(players, message, true), null);
  assert.equal(
    applyMultiplayerLobbyChange(players, { ...message, change: { kind: "INVALIDATE" } }, false),
    null,
  );
});
