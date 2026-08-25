import assert from "node:assert/strict";
import test from "node:test";
import {
  MULTIPLAYER_CLIENT_MAX_PAYLOAD_BYTES,
  parseGameToHostMultiplayerMessage,
  parseHostToGameMultiplayerMessage,
} from "../src/bridge/multiplayerProtocol.js";

test("accepts exact game intent messages", () => {
  assert.deepEqual(
    parseGameToHostMultiplayerMessage({
      type: "MULTI_ACTION",
      v: 1,
      generation: 2,
      clientSeq: 3,
      clientActionId: "action_1234567890",
      expectedRevision: 4,
      payload: { type: "PLACE", row: 4, column: 7 },
    }),
    {
      type: "MULTI_ACTION",
      v: 1,
      generation: 2,
      clientSeq: 3,
      clientActionId: "action_1234567890",
      expectedRevision: 4,
      payload: { type: "PLACE", row: 4, column: 7 },
    },
  );

  assert.deepEqual(
    parseGameToHostMultiplayerMessage({
      type: "MULTI_INPUT",
      v: 1,
      generation: 2,
      clientSeq: 9,
      payload: { direction: -1 },
    }),
    {
      type: "MULTI_INPUT",
      v: 1,
      generation: 2,
      clientSeq: 9,
      payload: { direction: -1 },
    },
  );
});

test("rejects credential smuggling, legacy completion, malformed sequence, and unknown types", () => {
  assert.equal(
    parseGameToHostMultiplayerMessage({
      type: "MULTI_READY",
      v: 1,
      generation: 1,
      ticket: "secret",
    }),
    null,
  );
  assert.equal(parseGameToHostMultiplayerMessage({ type: "GAME_COMPLETE" }), null);
  assert.equal(
    parseGameToHostMultiplayerMessage({
      type: "MULTI_INPUT",
      v: 1,
      generation: 1,
      clientSeq: -1,
      payload: {},
    }),
    null,
  );
  assert.equal(parseGameToHostMultiplayerMessage({ type: "MULTI_RPC", v: 1, generation: 1 }), null);
});

test("accepts safe host init/state/terminal messages without credentials", () => {
  assert.deepEqual(
    parseHostToGameMultiplayerMessage({
      type: "MULTI_INIT",
      v: 1,
      participantId: "participant_123",
      gameVersionId: 9,
      profileRevision: 2,
      rulesetKey: "official:omok",
      rulesetRevision: 1,
      generation: 3,
    }),
    {
      type: "MULTI_INIT",
      v: 1,
      participantId: "participant_123",
      gameVersionId: 9,
      profileRevision: 2,
      rulesetKey: "official:omok",
      rulesetRevision: 1,
      generation: 3,
    },
  );

  assert.deepEqual(
    parseHostToGameMultiplayerMessage({
      type: "MULTI_STATE",
      v: 1,
      generation: 3,
      serverSeq: 10,
      revision: 5,
      payload: { board: [[0]] },
    }),
    {
      type: "MULTI_STATE",
      v: 1,
      generation: 3,
      serverSeq: 10,
      revision: 5,
      payload: { board: [[0]] },
    },
  );

  assert.deepEqual(
    parseHostToGameMultiplayerMessage({
      type: "MULTI_TERMINAL_COMMITTED",
      v: 1,
      generation: 3,
      serverSeq: 11,
      result: { outcome: "win" },
    }),
    {
      type: "MULTI_TERMINAL_COMMITTED",
      v: 1,
      generation: 3,
      serverSeq: 11,
      result: { outcome: "win" },
    },
  );
});

test("host parser rejects token/API fields and non-JSON-safe projections", () => {
  assert.equal(
    parseHostToGameMultiplayerMessage({
      type: "MULTI_INIT",
      v: 1,
      participantId: "participant_123",
      gameVersionId: 9,
      profileRevision: 2,
      rulesetKey: "official:omok",
      rulesetRevision: 1,
      generation: 3,
      apiUrl: "https://api.example.invalid",
    }),
    null,
  );
  assert.equal(
    parseHostToGameMultiplayerMessage({
      type: "MULTI_STATE",
      v: 1,
      generation: 1,
      serverSeq: 1,
      revision: 1,
      payload: { hidden: new Map() },
    }),
    null,
  );
});

test("uses typed action, disconnect, and abort errors", () => {
  assert.deepEqual(
    parseHostToGameMultiplayerMessage({
      type: "MULTI_ACTION_REJECTED",
      v: 1,
      generation: 3,
      serverSeq: 12,
      clientActionId: "action_1234567890",
      code: "ACTION_CONFLICT",
      currentRevision: 6,
    }),
    {
      type: "MULTI_ACTION_REJECTED",
      v: 1,
      generation: 3,
      serverSeq: 12,
      clientActionId: "action_1234567890",
      code: "ACTION_CONFLICT",
      currentRevision: 6,
    },
  );
  assert.deepEqual(
    parseHostToGameMultiplayerMessage({
      type: "MULTI_DISCONNECTED",
      v: 1,
      generation: 3,
      code: "NETWORK_LOST",
    }),
    {
      type: "MULTI_DISCONNECTED",
      v: 1,
      generation: 3,
      code: "NETWORK_LOST",
    },
  );
  assert.deepEqual(
    parseHostToGameMultiplayerMessage({
      type: "MULTI_ABORTED",
      v: 1,
      generation: 3,
      code: "INFRA_FAILURE",
    }),
    {
      type: "MULTI_ABORTED",
      v: 1,
      generation: 3,
      code: "INFRA_FAILURE",
    },
  );

  assert.equal(
    parseHostToGameMultiplayerMessage({
      type: "MULTI_DISCONNECTED",
      v: 1,
      generation: 3,
      code: "secret=do-not-leak",
    }),
    null,
  );
});

test("client parser enforces the 4 KiB UTF-8 cap", () => {
  const oversizedKorean = {
    type: "MULTI_ACTION",
    v: 1,
    generation: 1,
    clientSeq: 1,
    clientActionId: "action_1234567890",
    expectedRevision: 0,
    payload: { value: "가".repeat(MULTIPLAYER_CLIENT_MAX_PAYLOAD_BYTES / 2) },
  };
  assert.equal(parseGameToHostMultiplayerMessage(oversizedKorean), null);
});
