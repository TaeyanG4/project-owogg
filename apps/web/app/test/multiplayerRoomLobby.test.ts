import assert from "node:assert/strict";
import test from "node:test";
import type {
  MultiplayerLobbySignalChange,
  MultiplayerRoomPlayer,
  MultiplayerRoomResponse,
} from "@owogg/contracts";
import {
  applyMultiplayerLobbySignalChange,
  multiplayerLobbyCanStart,
  multiplayerLobbyRosterSounds,
  multiplayerLobbySelfPlayer,
  multiplayerLobbySlotCount,
} from "../features/game/runtime/MultiplayerRoomLobby";
import { multiplayerLobbySignalReconnectDelay } from "../features/game/runtime/multiplayerLobbySignal";

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

test("the event-driven signal channel backs off without a roster polling fallback", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 99].map(multiplayerLobbySignalReconnectDelay),
    [5_000, 15_000, 30_000, 60_000, 300_000, 900_000, 900_000],
  );
});

test("lobby join and leave deltas update the roster without a follow-up D1 read", () => {
  const host = player(0);
  const opponent = player(1);
  const joined: MultiplayerLobbySignalChange = {
    kind: "PARTICIPANT_JOINED",
    player: opponent,
    changedAt: "2026-08-28T12:00:00.000Z",
  };
  assert.deepEqual(applyMultiplayerLobbySignalChange([host], joined), [host, opponent]);

  const unready: MultiplayerLobbySignalChange = {
    kind: "PARTICIPANT_READY",
    participantId: opponent.participantId,
    status: "JOINED",
    changedAt: "2026-08-28T12:00:01.000Z",
  };
  assert.deepEqual(applyMultiplayerLobbySignalChange([host, opponent], unready), [
    host,
    { ...opponent, status: "JOINED" },
  ]);

  const left: MultiplayerLobbySignalChange = {
    kind: "PARTICIPANT_LEFT",
    participantId: opponent.participantId,
    changedAt: "2026-08-28T12:00:02.000Z",
  };
  assert.deepEqual(applyMultiplayerLobbySignalChange([host, opponent], left), [host]);
  assert.equal(applyMultiplayerLobbySignalChange([host], unready), null);
  assert.equal(applyMultiplayerLobbySignalChange([host], { kind: "INVALIDATE" }), null);
  assert.equal(
    applyMultiplayerLobbySignalChange([host], {
      kind: "ROOM_CLOSED",
      status: "ABORTED",
      changedAt: "2026-08-28T12:00:03.000Z",
    }),
    null,
  );
});

test("the authenticated participant is visible before the first roster recovery read", () => {
  const room: MultiplayerRoomResponse = {
    replayed: false,
    instance: {
      id: "instance_lobby_seed_0001",
      publicCode: "ROOMSEED0001",
      gameId: 1,
      gameVersionId: 1,
      profileRevision: 1,
      visibility: "PRIVATE",
      joinPolicy: "OPEN",
      status: "LOBBY",
      generation: 1,
      participantCount: 1,
      maxPlayers: 2,
      expiresAt: "2026-08-28T13:00:00.000Z",
    },
    participant: {
      id: "participant_lobby_seed_0001",
      role: "HOST",
      seatIndex: 0,
      status: "JOINED",
      connectionGeneration: 0,
    },
  };
  assert.deepEqual(
    multiplayerLobbySelfPlayer(room, { nickname: "Host", avatarUrl: "https://example.com/a.png" }),
    {
      participantId: "participant_lobby_seed_0001",
      role: "HOST",
      seatIndex: 0,
      status: "JOINED",
      nickname: "Host",
      avatarUrl: "https://example.com/a.png",
    },
  );
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
