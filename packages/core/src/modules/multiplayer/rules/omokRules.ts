import type { MultiplayerActionResultCode } from "../domain/multiplayerMatch.js";

/**
 * OWOGG-owned M1 Simple Omok ruleset.
 *
 * Revision 1 is deliberately freestyle Omok: a 15 x 15 board, black moves first, five or more
 * contiguous stones win, and Renju forbidden-move rules are not applied. These semantics are
 * immutable for this ruleset revision; a policy change requires a new ruleset revision.
 */
export const OMOK_RULESET_KEY = "official:omok" as const;
export const OMOK_RULESET_REVISION = 1 as const;
export const OMOK_STATE_SCHEMA_VERSION = 1 as const;
export const OMOK_BOARD_SIZE = 15 as const;
export const OMOK_WIN_LENGTH = 5 as const;
export const OMOK_RESOLVED_CONFIG_JSON = '{"boardSize":15,"winLength":5}' as const;

const EMPTY_CELL = "." as const;
const BLACK_CELL = "B" as const;
const WHITE_CELL = "W" as const;
const BOARD_CELL_PATTERN = /^[.BW]+$/;
const BOARD_CELL_COUNT = OMOK_BOARD_SIZE * OMOK_BOARD_SIZE;

export type OmokSeatIndex = 0 | 1;
export type OmokStone = "BLACK" | "WHITE";
export type OmokMatchStatus = "ACTIVE" | "WON" | "DRAW";

export interface OmokCoordinate {
  readonly x: number;
  readonly y: number;
}

export interface OmokMove extends OmokCoordinate {
  readonly seatIndex: OmokSeatIndex;
}

export type OmokAction = OmokCoordinate;

export interface OmokStateV1 {
  readonly stateSchemaVersion: typeof OMOK_STATE_SCHEMA_VERSION;
  readonly rulesetKey: typeof OMOK_RULESET_KEY;
  readonly rulesetRevision: typeof OMOK_RULESET_REVISION;
  readonly boardSize: typeof OMOK_BOARD_SIZE;
  readonly winLength: typeof OMOK_WIN_LENGTH;
  readonly revision: number;
  /** Row-major board encoded as exactly 225 '.', 'B', or 'W' characters. */
  readonly board: string;
  readonly status: OmokMatchStatus;
  readonly nextSeatIndex: OmokSeatIndex | null;
  readonly winnerSeatIndex: OmokSeatIndex | null;
  readonly lastMove: OmokMove | null;
  /** One deterministic complete contiguous line through the terminal move. */
  readonly winningLine: readonly OmokCoordinate[] | null;
}

export interface OmokPlayerViewV1 extends OmokStateV1 {
  readonly yourSeatIndex: OmokSeatIndex;
  readonly yourStone: OmokStone;
}

export type OmokActionRejectionCode = Extract<
  MultiplayerActionResultCode,
  "MATCH_NOT_ACTIVE" | "NOT_PARTICIPANT" | "NOT_YOUR_TURN" | "ACTION_INVALID" | "ACTION_CONFLICT"
>;

export type OmokActionTransition =
  | {
      readonly ok: true;
      readonly state: OmokStateV1;
      readonly terminal: OmokTerminalResult | null;
    }
  | {
      readonly ok: false;
      readonly code: OmokActionRejectionCode;
      readonly currentRevision: number;
    };

export type OmokTerminalResult =
  | {
      readonly kind: "WIN";
      readonly revision: number;
      readonly winnerSeatIndex: OmokSeatIndex;
      readonly loserSeatIndex: OmokSeatIndex;
      readonly winningLine: readonly OmokCoordinate[];
    }
  | {
      readonly kind: "DRAW";
      readonly revision: number;
      readonly winnerSeatIndex: null;
      readonly winningLine: null;
    };

type EncodedCell = typeof EMPTY_CELL | typeof BLACK_CELL | typeof WHITE_CELL;

const WIN_DIRECTIONS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
] as const;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(source: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(source);
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
}

function isCoordinate(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value < OMOK_BOARD_SIZE
  );
}

function isSeatIndex(value: unknown): value is OmokSeatIndex {
  return value === 0 || value === 1;
}

function stoneForSeat(seatIndex: OmokSeatIndex): OmokStone {
  return seatIndex === 0 ? "BLACK" : "WHITE";
}

function cellForSeat(seatIndex: OmokSeatIndex): EncodedCell {
  return seatIndex === 0 ? BLACK_CELL : WHITE_CELL;
}

function boardIndex(x: number, y: number): number {
  return y * OMOK_BOARD_SIZE + x;
}

function boardCell(board: string, x: number, y: number): EncodedCell {
  return board[boardIndex(x, y)] as EncodedCell;
}

function replaceBoardCell(board: string, x: number, y: number, cell: EncodedCell): string {
  const index = boardIndex(x, y);
  return `${board.slice(0, index)}${cell}${board.slice(index + 1)}`;
}

function collectLine(
  board: string,
  x: number,
  y: number,
  cell: EncodedCell,
  dx: number,
  dy: number,
): readonly OmokCoordinate[] {
  let startX = x;
  let startY = y;
  while (
    isCoordinate(startX - dx) &&
    isCoordinate(startY - dy) &&
    boardCell(board, startX - dx, startY - dy) === cell
  ) {
    startX -= dx;
    startY -= dy;
  }

  const line: OmokCoordinate[] = [];
  let currentX = startX;
  let currentY = startY;
  while (
    isCoordinate(currentX) &&
    isCoordinate(currentY) &&
    boardCell(board, currentX, currentY) === cell
  ) {
    line.push({ x: currentX, y: currentY });
    currentX += dx;
    currentY += dy;
  }
  return line;
}

function findWinningLine(
  board: string,
  x: number,
  y: number,
  cell: EncodedCell,
): readonly OmokCoordinate[] | null {
  if (cell === EMPTY_CELL || boardCell(board, x, y) !== cell) return null;
  for (const [dx, dy] of WIN_DIRECTIONS) {
    const line = collectLine(board, x, y, cell, dx, dy);
    if (line.length >= OMOK_WIN_LENGTH) return line;
  }
  return null;
}

function boardHasWinner(board: string, cell: EncodedCell): boolean {
  for (let y = 0; y < OMOK_BOARD_SIZE; y += 1) {
    for (let x = 0; x < OMOK_BOARD_SIZE; x += 1) {
      if (boardCell(board, x, y) === cell && findWinningLine(board, x, y, cell)) return true;
    }
  }
  return false;
}

function sameCoordinates(
  left: readonly OmokCoordinate[],
  right: readonly OmokCoordinate[],
): boolean {
  return (
    left.length === right.length &&
    left.every((coordinate, index) => {
      const candidate = right[index];
      return candidate?.x === coordinate.x && candidate.y === coordinate.y;
    })
  );
}

function parseMove(value: unknown): OmokMove | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["x", "y", "seatIndex"])) return null;
  if (!isCoordinate(value.x) || !isCoordinate(value.y) || !isSeatIndex(value.seatIndex)) {
    return null;
  }
  return { x: value.x, y: value.y, seatIndex: value.seatIndex };
}

function parseWinningLine(value: unknown): readonly OmokCoordinate[] | null {
  if (!Array.isArray(value) || value.length < OMOK_WIN_LENGTH || value.length > OMOK_BOARD_SIZE) {
    return null;
  }
  const line: OmokCoordinate[] = [];
  for (const candidate of value) {
    if (!isPlainRecord(candidate) || !hasExactKeys(candidate, ["x", "y"])) return null;
    if (!isCoordinate(candidate.x) || !isCoordinate(candidate.y)) return null;
    line.push({ x: candidate.x, y: candidate.y });
  }
  return line;
}

/** Validate the immutable server-owned config stored in an approved profile snapshot. */
export function isOmokResolvedConfigJson(value: string): boolean {
  try {
    const parsed: unknown = JSON.parse(value);
    return (
      isPlainRecord(parsed) &&
      hasExactKeys(parsed, ["boardSize", "winLength"]) &&
      parsed.boardSize === OMOK_BOARD_SIZE &&
      parsed.winLength === OMOK_WIN_LENGTH
    );
  } catch {
    return false;
  }
}

export function createInitialOmokState(): OmokStateV1 {
  return {
    stateSchemaVersion: OMOK_STATE_SCHEMA_VERSION,
    rulesetKey: OMOK_RULESET_KEY,
    rulesetRevision: OMOK_RULESET_REVISION,
    boardSize: OMOK_BOARD_SIZE,
    winLength: OMOK_WIN_LENGTH,
    revision: 0,
    board: EMPTY_CELL.repeat(BOARD_CELL_COUNT),
    status: "ACTIVE",
    nextSeatIndex: 0,
    winnerSeatIndex: null,
    lastMove: null,
    winningLine: null,
  };
}

/** Strict parser for state rehydrated from Durable Object SQLite. */
export function parseOmokStateV1(value: unknown): OmokStateV1 | null {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, [
      "stateSchemaVersion",
      "rulesetKey",
      "rulesetRevision",
      "boardSize",
      "winLength",
      "revision",
      "board",
      "status",
      "nextSeatIndex",
      "winnerSeatIndex",
      "lastMove",
      "winningLine",
    ]) ||
    value.stateSchemaVersion !== OMOK_STATE_SCHEMA_VERSION ||
    value.rulesetKey !== OMOK_RULESET_KEY ||
    value.rulesetRevision !== OMOK_RULESET_REVISION ||
    value.boardSize !== OMOK_BOARD_SIZE ||
    value.winLength !== OMOK_WIN_LENGTH ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0 ||
    (value.revision as number) > BOARD_CELL_COUNT ||
    typeof value.board !== "string" ||
    value.board.length !== BOARD_CELL_COUNT ||
    !BOARD_CELL_PATTERN.test(value.board) ||
    (value.status !== "ACTIVE" && value.status !== "WON" && value.status !== "DRAW")
  ) {
    return null;
  }

  const revision = value.revision as number;
  const board = value.board;
  let blackCount = 0;
  let whiteCount = 0;
  for (const cell of board) {
    if (cell === BLACK_CELL) blackCount += 1;
    if (cell === WHITE_CELL) whiteCount += 1;
  }
  if (
    blackCount + whiteCount !== revision ||
    blackCount < whiteCount ||
    blackCount > whiteCount + 1
  ) {
    return null;
  }

  const lastMove = value.lastMove === null ? null : parseMove(value.lastMove);
  if ((revision === 0) !== (lastMove === null)) return null;
  if (lastMove) {
    const expectedLastSeat: OmokSeatIndex = revision % 2 === 1 ? 0 : 1;
    if (
      lastMove.seatIndex !== expectedLastSeat ||
      boardCell(board, lastMove.x, lastMove.y) !== cellForSeat(lastMove.seatIndex)
    ) {
      return null;
    }
  }

  const blackWon = boardHasWinner(board, BLACK_CELL);
  const whiteWon = boardHasWinner(board, WHITE_CELL);
  if (blackWon && whiteWon) return null;

  if (value.status === "ACTIVE") {
    const expectedNextSeat: OmokSeatIndex = blackCount === whiteCount ? 0 : 1;
    if (
      revision === BOARD_CELL_COUNT ||
      blackWon ||
      whiteWon ||
      value.nextSeatIndex !== expectedNextSeat ||
      value.winnerSeatIndex !== null ||
      value.winningLine !== null
    ) {
      return null;
    }
  } else if (value.status === "DRAW") {
    if (
      revision !== BOARD_CELL_COUNT ||
      blackWon ||
      whiteWon ||
      value.nextSeatIndex !== null ||
      value.winnerSeatIndex !== null ||
      value.winningLine !== null
    ) {
      return null;
    }
  } else {
    if (
      !lastMove ||
      !isSeatIndex(value.winnerSeatIndex) ||
      value.winnerSeatIndex !== lastMove.seatIndex ||
      value.nextSeatIndex !== null
    ) {
      return null;
    }
    const parsedLine = parseWinningLine(value.winningLine);
    const expectedLine = findWinningLine(
      board,
      lastMove.x,
      lastMove.y,
      cellForSeat(lastMove.seatIndex),
    );
    if (!parsedLine || !expectedLine || !sameCoordinates(parsedLine, expectedLine)) return null;
    if (lastMove.seatIndex === 0 ? !blackWon || whiteWon : !whiteWon || blackWon) return null;
  }

  return {
    stateSchemaVersion: OMOK_STATE_SCHEMA_VERSION,
    rulesetKey: OMOK_RULESET_KEY,
    rulesetRevision: OMOK_RULESET_REVISION,
    boardSize: OMOK_BOARD_SIZE,
    winLength: OMOK_WIN_LENGTH,
    revision,
    board,
    status: value.status,
    nextSeatIndex: isSeatIndex(value.nextSeatIndex) ? value.nextSeatIndex : null,
    winnerSeatIndex: isSeatIndex(value.winnerSeatIndex) ? value.winnerSeatIndex : null,
    lastMove,
    winningLine: value.winningLine === null ? null : parseWinningLine(value.winningLine),
  };
}

export function parseOmokAction(value: unknown): OmokAction | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["x", "y"])) return null;
  if (!isCoordinate(value.x) || !isCoordinate(value.y)) return null;
  return { x: value.x, y: value.y };
}

export function getOmokTerminalResult(state: OmokStateV1): OmokTerminalResult | null {
  if (state.status === "ACTIVE") return null;
  if (state.status === "DRAW") {
    return {
      kind: "DRAW",
      revision: state.revision,
      winnerSeatIndex: null,
      winningLine: null,
    };
  }
  if (state.winnerSeatIndex === null || state.winningLine === null) return null;
  return {
    kind: "WIN",
    revision: state.revision,
    winnerSeatIndex: state.winnerSeatIndex,
    loserSeatIndex: state.winnerSeatIndex === 0 ? 1 : 0,
    winningLine: state.winningLine,
  };
}

export function applyOmokAction(
  state: OmokStateV1,
  actorSeatIndex: number,
  action: OmokAction,
  expectedRevision: number,
): OmokActionTransition {
  if (expectedRevision !== state.revision) {
    return { ok: false, code: "ACTION_CONFLICT", currentRevision: state.revision };
  }
  if (state.status !== "ACTIVE") {
    return { ok: false, code: "MATCH_NOT_ACTIVE", currentRevision: state.revision };
  }
  if (!isSeatIndex(actorSeatIndex)) {
    return { ok: false, code: "NOT_PARTICIPANT", currentRevision: state.revision };
  }
  if (state.nextSeatIndex !== actorSeatIndex) {
    return { ok: false, code: "NOT_YOUR_TURN", currentRevision: state.revision };
  }
  if (!isCoordinate(action.x) || !isCoordinate(action.y)) {
    return { ok: false, code: "ACTION_INVALID", currentRevision: state.revision };
  }
  if (boardCell(state.board, action.x, action.y) !== EMPTY_CELL) {
    return { ok: false, code: "ACTION_INVALID", currentRevision: state.revision };
  }

  const cell = cellForSeat(actorSeatIndex);
  const board = replaceBoardCell(state.board, action.x, action.y, cell);
  const revision = state.revision + 1;
  const lastMove: OmokMove = { ...action, seatIndex: actorSeatIndex };
  const winningLine = findWinningLine(board, action.x, action.y, cell);

  let nextState: OmokStateV1;
  if (winningLine) {
    nextState = {
      ...state,
      revision,
      board,
      status: "WON",
      nextSeatIndex: null,
      winnerSeatIndex: actorSeatIndex,
      lastMove,
      winningLine,
    };
  } else if (revision === BOARD_CELL_COUNT) {
    nextState = {
      ...state,
      revision,
      board,
      status: "DRAW",
      nextSeatIndex: null,
      winnerSeatIndex: null,
      lastMove,
      winningLine: null,
    };
  } else {
    nextState = {
      ...state,
      revision,
      board,
      status: "ACTIVE",
      nextSeatIndex: actorSeatIndex === 0 ? 1 : 0,
      winnerSeatIndex: null,
      lastMove,
      winningLine: null,
    };
  }

  return { ok: true, state: nextState, terminal: getOmokTerminalResult(nextState) };
}

export function projectOmokState(
  state: OmokStateV1,
  viewerSeatIndex: OmokSeatIndex,
): OmokPlayerViewV1 {
  return {
    ...state,
    yourSeatIndex: viewerSeatIndex,
    yourStone: stoneForSeat(viewerSeatIndex),
  };
}

/** Explicit allowlisted ruleset surface consumed by the M1 runtime driver. */
export const omokRules = {
  key: OMOK_RULESET_KEY,
  revision: OMOK_RULESET_REVISION,
  resolvedConfigJson: OMOK_RESOLVED_CONFIG_JSON,
  createInitialState: createInitialOmokState,
  parseState: parseOmokStateV1,
  parseAction: parseOmokAction,
  applyAction: applyOmokAction,
  project: projectOmokState,
  getTerminalResult: getOmokTerminalResult,
} as const;
