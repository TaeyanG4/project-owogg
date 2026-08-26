import assert from "node:assert/strict";
import test from "node:test";
import {
  OMOK_ACTION_LEDGER_SCHEMA_VERSION,
  createInitialOmokState,
  encodeOmokActionLedgerResponse,
  parseOmokActionLedgerResponse,
} from "../src/index.js";

test("Omok accepted ledger responses round-trip a strictly validated state checkpoint", () => {
  const state = createInitialOmokState();
  const accepted = {
    schemaVersion: OMOK_ACTION_LEDGER_SCHEMA_VERSION,
    kind: "ACCEPTED",
    generation: 1,
    serverSeq: 3,
    clientActionId: "ledger_action_000001",
    revision: state.revision,
    state,
  } as const;

  // Revision zero can only exist before an accepted action and is therefore rejected.
  assert.equal(parseOmokActionLedgerResponse(accepted), null);
  const advancedState = {
    ...state,
    revision: 1,
    board: `B${state.board.slice(1)}`,
    nextSeatIndex: 1 as const,
    lastMove: { x: 0, y: 0, seatIndex: 0 as const },
  };
  const encoded = encodeOmokActionLedgerResponse({
    ...accepted,
    revision: 1,
    state: advancedState,
  });
  assert.deepEqual(parseOmokActionLedgerResponse(JSON.parse(encoded)), JSON.parse(encoded));
});

test("Omok rejected ledger responses are exact and never carry an untrusted state", () => {
  const rejected = {
    schemaVersion: OMOK_ACTION_LEDGER_SCHEMA_VERSION,
    kind: "REJECTED",
    generation: 2,
    serverSeq: 9,
    clientActionId: "ledger_action_000002",
    code: "ACTION_CONFLICT",
    currentRevision: 4,
  } as const;
  assert.deepEqual(
    parseOmokActionLedgerResponse(JSON.parse(encodeOmokActionLedgerResponse(rejected))),
    rejected,
  );
  assert.equal(
    parseOmokActionLedgerResponse({ ...rejected, state: createInitialOmokState() }),
    null,
  );
  assert.equal(parseOmokActionLedgerResponse({ ...rejected, code: "ACCEPTED" }), null);
  assert.equal(parseOmokActionLedgerResponse({ ...rejected, extra: true }), null);
});
