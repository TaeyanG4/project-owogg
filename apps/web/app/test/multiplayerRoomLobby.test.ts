import assert from "node:assert/strict";
import test from "node:test";
import type { MultiplayerRoomPlayer } from "@owogg/contracts";
import {
  multiplayerLobbyCanStart,
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
