import assert from "node:assert/strict";
import test from "node:test";
import {
  MULTIPLAYER_CLIENT_MAX_PAYLOAD_BYTES,
  MULTIPLAYER_RELAY_MAX_SNAPSHOT_BYTES,
  parseGameToHostRelayMessage,
  parseHostToGameMultiplayerMessage,
} from "../src/bridge/multiplayerProtocol.js";

const BOOTSTRAP = {
  type: "MULTI_INIT",
  v: 1,
  gameVersionId: 9,
  contentHash: "a".repeat(64),
  profileRevision: 2,
  generation: 3,
  runtime: { kind: "relay", protocolVersion: 1, resultTrust: "UNVERIFIED" },
  self: { participantId: "participant_123", seatIndex: 0, role: "HOST" },
  roster: [
    { participantId: "participant_123", seatIndex: 0, role: "HOST" },
    { participantId: "participant_456", seatIndex: 1, role: "PLAYER" },
  ],
  capabilities: {
    reconnect: "resume",
    broadcast: true,
    directMessages: true,
    hostSnapshot: true,
  },
} as const;

test("Relay parser accepts exact lifecycle, broadcast, direct, and snapshot intents", () => {
  const messages = [
    { type: "MULTI_READY", v: 1, generation: 3 },
    { type: "MULTI_LEAVE", v: 1, generation: 3 },
    {
      type: "RELAY_SEND",
      v: 1,
      generation: 3,
      clientSeq: 1,
      delivery: "broadcast",
      payload: { input: "jump" },
    },
    {
      type: "RELAY_SEND",
      v: 1,
      generation: 3,
      clientSeq: 2,
      delivery: "direct",
      targetParticipantId: "participant_456",
      payload: { privateMove: 4 },
    },
    {
      type: "RELAY_SNAPSHOT_SET",
      v: 1,
      generation: 3,
      clientSeq: 3,
      payload: { world: [1, 2, 3] },
    },
  ] as const;
  for (const message of messages) {
    assert.deepEqual(parseGameToHostRelayMessage(message), message);
  }
});

test("Relay parser rejects spoofing, old rule intents, invalid sequence, and oversized data", () => {
  assert.equal(
    parseGameToHostRelayMessage({
      type: "RELAY_SEND",
      v: 1,
      generation: 1,
      clientSeq: 1,
      delivery: "broadcast",
      sender: { participantId: "spoofed_participant", seatIndex: 7, role: "HOST" },
      payload: {},
    }),
    null,
  );
  assert.equal(
    parseGameToHostRelayMessage({
      type: "RELAY_SEND",
      v: 1,
      generation: 1,
      clientSeq: 0,
      delivery: "broadcast",
      payload: {},
    }),
    null,
  );
  assert.equal(
    parseGameToHostRelayMessage({
      type: "MULTI_ACTION",
      v: 1,
      generation: 1,
      clientSeq: 1,
      payload: {},
    }),
    null,
  );
  assert.equal(
    parseGameToHostRelayMessage({
      type: "RELAY_SEND",
      v: 1,
      generation: 1,
      clientSeq: 1,
      delivery: "broadcast",
      payload: { value: "가".repeat(MULTIPLAYER_CLIENT_MAX_PAYLOAD_BYTES / 2) },
    }),
    null,
  );
  assert.equal(
    parseGameToHostRelayMessage({
      type: "RELAY_SNAPSHOT_SET",
      v: 1,
      generation: 1,
      clientSeq: 1,
      payload: { value: "가".repeat(MULTIPLAYER_RELAY_MAX_SNAPSHOT_BYTES / 2) },
    }),
    null,
  );
});

test("bootstrap accepts only one credential-free Relay runtime and a seat-ordered roster", () => {
  assert.deepEqual(parseHostToGameMultiplayerMessage(BOOTSTRAP), BOOTSTRAP);
  assert.equal(
    parseHostToGameMultiplayerMessage({ ...BOOTSTRAP, ticket: "must-not-enter-iframe" }),
    null,
  );
  assert.equal(
    parseHostToGameMultiplayerMessage({
      ...BOOTSTRAP,
      runtime: { kind: "rules", protocolVersion: 1, resultTrust: "UNVERIFIED" },
    }),
    null,
  );
  assert.equal(
    parseHostToGameMultiplayerMessage({
      ...BOOTSTRAP,
      capabilities: { ...BOOTSTRAP.capabilities, broadcast: false },
    }),
    null,
  );
  assert.equal(
    parseHostToGameMultiplayerMessage({
      ...BOOTSTRAP,
      roster: [BOOTSTRAP.roster[1], BOOTSTRAP.roster[0]],
    }),
    null,
  );
});

test("host parser accepts Relay metadata, sync, rejection, close, and transport notices", () => {
  const sender = { participantId: "participant_123", seatIndex: 0, role: "HOST" } as const;
  const messages = [
    { type: "MULTI_CONNECTED", v: 1, generation: 3, connectionGeneration: 2 },
    { type: "MULTI_DISCONNECTED", v: 1, generation: 3, code: "NETWORK_LOST" },
    {
      type: "RELAY_MESSAGE",
      v: 1,
      generation: 3,
      serverSeq: 7,
      sender,
      delivery: "direct",
      targetParticipantId: "participant_456",
      payload: { move: 4 },
    },
    {
      type: "RELAY_SYNC",
      v: 1,
      generation: 3,
      serverSeq: 8,
      snapshot: { revision: 2, hash: "b".repeat(64), payload: { board: [1, 2] } },
    },
    { type: "RELAY_REJECTED", v: 1, generation: 3, clientSeq: 4, code: "HOST_REQUIRED" },
    { type: "RELAY_CLOSED", v: 1, generation: 3, code: "ROOM_EXPIRED" },
  ] as const;
  for (const message of messages) {
    assert.deepEqual(parseHostToGameMultiplayerMessage(message), message);
  }
});

test("host parser rejects spoofed metadata, unsafe snapshots, and removed rule events", () => {
  assert.equal(
    parseHostToGameMultiplayerMessage({
      type: "RELAY_MESSAGE",
      v: 1,
      generation: 3,
      serverSeq: 1,
      sender: { participantId: "bad", seatIndex: 0, role: "HOST" },
      delivery: "broadcast",
      payload: {},
    }),
    null,
  );
  assert.equal(
    parseHostToGameMultiplayerMessage({
      type: "RELAY_SYNC",
      v: 1,
      generation: 3,
      serverSeq: 8,
      snapshot: { revision: 2, hash: "not-a-hash", payload: {} },
    }),
    null,
  );
  assert.equal(
    parseHostToGameMultiplayerMessage({
      type: "MULTI_STATE",
      v: 1,
      generation: 3,
      serverSeq: 1,
      revision: 1,
      payload: {},
    }),
    null,
  );
});
