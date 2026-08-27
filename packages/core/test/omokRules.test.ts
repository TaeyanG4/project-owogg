import assert from "node:assert/strict";
import test from "node:test";
import {
  OMOK_BOARD_SIZE,
  OMOK_LEGACY_RULESET_REVISION,
  OMOK_RULESET_REVISION,
  applyOmokAction,
  createInitialOmokState,
  getOmokTerminalResult,
  parseOmokAction,
  parseOmokStateV1,
  projectOmokState,
  type OmokAction,
  type OmokStateV1,
} from "../src/modules/multiplayer/rules/omokRules.js";

function accept(state: OmokStateV1, seatIndex: number, action: OmokAction): OmokStateV1 {
  const transition = applyOmokAction(state, seatIndex, action, state.revision);
  assert.equal(transition.ok, true);
  if (!transition.ok) throw new Error(`Unexpected rejection: ${transition.code}`);
  return transition.state;
}

function playAlternating(
  blackMoves: readonly OmokAction[],
  whiteMoves: readonly OmokAction[],
  rulesetRevision = OMOK_RULESET_REVISION,
): OmokStateV1 {
  let state = createInitialOmokState(rulesetRevision);
  for (let index = 0; index < blackMoves.length; index += 1) {
    const blackMove = blackMoves[index];
    assert.ok(blackMove);
    state = accept(state, 0, blackMove);
    const whiteMove = whiteMoves[index];
    if (whiteMove) state = accept(state, 1, whiteMove);
  }
  return state;
}

const SAFE_WHITE_FILLERS = [
  { x: 0, y: 14 },
  { x: 2, y: 14 },
  { x: 4, y: 14 },
  { x: 6, y: 14 },
  { x: 8, y: 14 },
  { x: 10, y: 14 },
  { x: 12, y: 14 },
] as const;

test("creates the fixed 15x15 server-owned initial state and player projections", () => {
  const state = createInitialOmokState();
  assert.equal(state.board.length, 225);
  assert.match(state.board, /^\.{225}$/);
  assert.deepEqual(state, {
    stateSchemaVersion: 1,
    rulesetKey: "official:omok",
    rulesetRevision: 2,
    boardSize: 15,
    winLength: 5,
    revision: 0,
    board: ".".repeat(225),
    status: "ACTIVE",
    nextSeatIndex: 0,
    winnerSeatIndex: null,
    lastMove: null,
    winningLine: null,
  });
  assert.equal(projectOmokState(state, 0).yourStone, "BLACK");
  assert.equal(projectOmokState(state, 1).yourStone, "WHITE");
  assert.equal(getOmokTerminalResult(state), null);
});

test("strictly parses only bounded x/y actions and ignores no client-declared result", () => {
  assert.deepEqual(parseOmokAction({ x: 7, y: 8 }), { x: 7, y: 8 });
  for (const invalid of [
    null,
    [],
    { x: 7 },
    { x: 7, y: 8, winner: "BLACK" },
    { x: -1, y: 0 },
    { x: 15, y: 0 },
    { x: 0.5, y: 0 },
    { x: "0", y: 0 },
  ]) {
    assert.equal(parseOmokAction(invalid), null);
  }
});

test("alternates turns, increments one revision per accepted move, and leaves prior state immutable", () => {
  const initial = createInitialOmokState();
  const first = accept(initial, 0, { x: 7, y: 7 });
  assert.equal(initial.board[7 * OMOK_BOARD_SIZE + 7], ".");
  assert.equal(first.board[7 * OMOK_BOARD_SIZE + 7], "B");
  assert.equal(first.revision, 1);
  assert.equal(first.nextSeatIndex, 1);

  const second = accept(first, 1, { x: 8, y: 7 });
  assert.equal(second.board[7 * OMOK_BOARD_SIZE + 8], "W");
  assert.equal(second.revision, 2);
  assert.equal(second.nextSeatIndex, 0);
});

test("rejects stale, non-participant, out-of-turn, invalid, and occupied actions without mutation", () => {
  const state = accept(createInitialOmokState(), 0, { x: 7, y: 7 });
  assert.deepEqual(applyOmokAction(state, 1, { x: 8, y: 8 }, 0), {
    ok: false,
    code: "ACTION_CONFLICT",
    currentRevision: 1,
  });
  assert.deepEqual(applyOmokAction(state, 3, { x: 8, y: 8 }, 1), {
    ok: false,
    code: "NOT_PARTICIPANT",
    currentRevision: 1,
  });
  assert.deepEqual(applyOmokAction(state, 0, { x: 8, y: 8 }, 1), {
    ok: false,
    code: "NOT_YOUR_TURN",
    currentRevision: 1,
  });
  assert.deepEqual(applyOmokAction(state, 1, { x: 15, y: 8 }, 1), {
    ok: false,
    code: "ACTION_INVALID",
    currentRevision: 1,
  });
  assert.deepEqual(applyOmokAction(state, 1, { x: 7, y: 7 }, 1), {
    ok: false,
    code: "ACTION_INVALID",
    currentRevision: 1,
  });
  assert.equal(state.revision, 1);
});

test("finds a horizontal black win and refuses post-terminal moves", () => {
  const state = playAlternating(
    [0, 1, 2, 3, 4].map((x) => ({ x, y: 0 })),
    SAFE_WHITE_FILLERS.slice(0, 4),
  );
  assert.equal(state.status, "WON");
  assert.equal(state.winnerSeatIndex, 0);
  assert.deepEqual(
    state.winningLine,
    [0, 1, 2, 3, 4].map((x) => ({ x, y: 0 })),
  );
  assert.deepEqual(getOmokTerminalResult(state), {
    kind: "WIN",
    revision: 9,
    winnerSeatIndex: 0,
    loserSeatIndex: 1,
    winningLine: [0, 1, 2, 3, 4].map((x) => ({ x, y: 0 })),
  });
  assert.deepEqual(applyOmokAction(state, 1, { x: 10, y: 10 }, state.revision), {
    ok: false,
    code: "MATCH_NOT_ACTIVE",
    currentRevision: 9,
  });
});

test("finds a vertical white win", () => {
  const blackFillers = [
    { x: 0, y: 14 },
    { x: 2, y: 14 },
    { x: 4, y: 14 },
    { x: 6, y: 14 },
    { x: 8, y: 14 },
  ] as const;
  const whiteMoves = [0, 1, 2, 3, 4].map((y) => ({ x: 7, y }));
  let state = createInitialOmokState();
  for (let index = 0; index < whiteMoves.length; index += 1) {
    const blackMove = blackFillers[index];
    const whiteMove = whiteMoves[index];
    assert.ok(blackMove && whiteMove);
    state = accept(state, 0, blackMove);
    state = accept(state, 1, whiteMove);
  }
  assert.equal(state.status, "WON");
  assert.equal(state.winnerSeatIndex, 1);
  assert.deepEqual(state.winningLine, whiteMoves);
});

test("finds both diagonal directions deterministically", () => {
  const downRight = playAlternating(
    [0, 1, 2, 3, 4].map((offset) => ({ x: offset, y: offset })),
    SAFE_WHITE_FILLERS.slice(0, 4),
  );
  assert.equal(downRight.status, "WON");
  assert.deepEqual(
    downRight.winningLine,
    [0, 1, 2, 3, 4].map((offset) => ({ x: offset, y: offset })),
  );

  const upRight = playAlternating(
    [0, 1, 2, 3, 4].map((offset) => ({ x: offset, y: 4 - offset })),
    SAFE_WHITE_FILLERS.slice(0, 4),
  );
  assert.equal(upRight.status, "WON");
  assert.deepEqual(upRight.winningLine, [
    { x: 0, y: 4 },
    { x: 1, y: 3 },
    { x: 2, y: 2 },
    { x: 3, y: 1 },
    { x: 4, y: 0 },
  ]);
});

test("revision 1 legacy freestyle policy still counts an overline as a win", () => {
  const state = playAlternating(
    [0, 1, 2, 4, 5, 3].map((x) => ({ x, y: 0 })),
    SAFE_WHITE_FILLERS.slice(0, 5),
    OMOK_LEGACY_RULESET_REVISION,
  );
  assert.equal(state.status, "WON");
  assert.equal(state.winnerSeatIndex, 0);
  assert.deepEqual(
    state.winningLine,
    [0, 1, 2, 3, 4, 5].map((x) => ({ x, y: 0 })),
  );
});

test("revision 2 rejects a black overline without mutating the authoritative state", () => {
  const before = playAlternating(
    [0, 1, 2, 4, 5].map((x) => ({ x, y: 0 })),
    SAFE_WHITE_FILLERS.slice(0, 5),
  );
  const transition = applyOmokAction(before, 0, { x: 3, y: 0 }, before.revision);
  assert.deepEqual(transition, {
    ok: false,
    code: "ACTION_INVALID",
    currentRevision: before.revision,
  });
  assert.equal(before.board[3], ".");
  assert.equal(before.status, "ACTIVE");
});

test("revision 2 rejects black double-three and double-four moves", () => {
  const doubleThree = playAlternating(
    [
      { x: 6, y: 7 },
      { x: 7, y: 6 },
      { x: 8, y: 7 },
      { x: 7, y: 8 },
    ],
    SAFE_WHITE_FILLERS.slice(0, 4),
  );
  assert.deepEqual(applyOmokAction(doubleThree, 0, { x: 7, y: 7 }, doubleThree.revision), {
    ok: false,
    code: "ACTION_INVALID",
    currentRevision: doubleThree.revision,
  });

  const doubleFour = playAlternating(
    [
      { x: 5, y: 7 },
      { x: 7, y: 5 },
      { x: 6, y: 7 },
      { x: 7, y: 6 },
      { x: 8, y: 7 },
      { x: 7, y: 8 },
    ],
    SAFE_WHITE_FILLERS.slice(0, 6),
  );
  assert.deepEqual(applyOmokAction(doubleFour, 0, { x: 7, y: 7 }, doubleFour.revision), {
    ok: false,
    code: "ACTION_INVALID",
    currentRevision: doubleFour.revision,
  });
});

test("revision 2 allows white to complete an overline", () => {
  const blackFillers = [
    { x: 0, y: 14 },
    { x: 2, y: 13 },
    { x: 4, y: 14 },
    { x: 6, y: 13 },
    { x: 8, y: 14 },
    { x: 10, y: 13 },
  ] as const;
  const whiteMoves = [0, 1, 2, 4, 5, 3].map((x) => ({ x, y: 0 }));
  let state = createInitialOmokState();
  for (let index = 0; index < whiteMoves.length; index += 1) {
    const blackMove = blackFillers[index];
    const whiteMove = whiteMoves[index];
    assert.ok(blackMove && whiteMove);
    state = accept(state, 0, blackMove);
    state = accept(state, 1, whiteMove);
  }
  assert.equal(state.status, "WON");
  assert.equal(state.winnerSeatIndex, 1);
  assert.equal(state.winningLine?.length, 6);
});

test("commits a full-board draw without manufacturing a winner", () => {
  const blackMoves: OmokAction[] = [];
  const whiteMoves: OmokAction[] = [];
  for (let y = 0; y < OMOK_BOARD_SIZE; y += 1) {
    for (let x = 0; x < OMOK_BOARD_SIZE; x += 1) {
      // BBWW horizontal blocks invert every row. It has no five-cell line in any direction and
      // supplies the required 113 black / 112 white cells on an odd-sized board.
      if ((x + 2 * y) % 4 < 2) blackMoves.push({ x, y });
      else whiteMoves.push({ x, y });
    }
  }
  assert.equal(blackMoves.length, 113);
  assert.equal(whiteMoves.length, 112);

  let state = createInitialOmokState(OMOK_LEGACY_RULESET_REVISION);
  for (let index = 0; index < blackMoves.length; index += 1) {
    const blackMove = blackMoves[index];
    assert.ok(blackMove);
    state = accept(state, 0, blackMove);
    const whiteMove = whiteMoves[index];
    if (whiteMove) state = accept(state, 1, whiteMove);
  }

  assert.equal(state.revision, 225);
  assert.equal(state.status, "DRAW");
  assert.deepEqual(getOmokTerminalResult(state), {
    kind: "DRAW",
    revision: 225,
    winnerSeatIndex: null,
    winningLine: null,
  });
});

test("strictly rehydrates deterministic states and rejects corrupt or invented terminal data", () => {
  const terminal = playAlternating(
    [0, 1, 2, 3, 4].map((x) => ({ x, y: 0 })),
    SAFE_WHITE_FILLERS.slice(0, 4),
  );
  const serialized = JSON.stringify(terminal);
  assert.deepEqual(parseOmokStateV1(JSON.parse(serialized)), terminal);
  assert.equal(JSON.stringify(parseOmokStateV1(JSON.parse(serialized))), serialized);

  assert.equal(parseOmokStateV1({ ...terminal, clientWinner: 1 }), null);
  assert.equal(parseOmokStateV1({ ...terminal, revision: terminal.revision - 1 }), null);
  assert.equal(parseOmokStateV1({ ...terminal, winnerSeatIndex: 1 }), null);
  assert.equal(
    parseOmokStateV1({ ...terminal, winningLine: terminal.winningLine?.slice(1) ?? null }),
    null,
  );
  assert.equal(
    parseOmokStateV1({
      ...createInitialOmokState(),
      board: `X${".".repeat(224)}`,
    }),
    null,
  );
  assert.deepEqual(
    parseOmokStateV1(createInitialOmokState(OMOK_LEGACY_RULESET_REVISION)),
    createInitialOmokState(OMOK_LEGACY_RULESET_REVISION),
  );
});
