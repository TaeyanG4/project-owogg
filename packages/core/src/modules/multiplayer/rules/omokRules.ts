import type { MultiplayerActionResultCode } from "../domain/multiplayerMatch.js";

/**
 * OWOGG-owned M1 Simple Omok ruleset.
 *
 * Revision 1 remains the immutable legacy freestyle ruleset so already-pinned matches can finish.
 * Revision 2 applies the Renju forbidden-move core: black wins with exactly five and cannot play
 * an overline, double-four, or forbidden double-three; white wins with five or more. OWOGG keeps
 * the existing free opening/host stone choice rather than claiming the tournament opening protocol.
 */
export const OMOK_RULESET_KEY = "official:omok" as const;
export const OMOK_LEGACY_RULESET_REVISION = 1 as const;
export const OMOK_RULESET_REVISION = 2 as const;
export const OMOK_SUPPORTED_RULESET_REVISIONS = [
  OMOK_LEGACY_RULESET_REVISION,
  OMOK_RULESET_REVISION,
] as const;
export const OMOK_STATE_SCHEMA_VERSION = 1 as const;
export const OMOK_BOARD_SIZE = 15 as const;
export const OMOK_WIN_LENGTH = 5 as const;
export const OMOK_LEGACY_RESOLVED_CONFIG_JSON = '{"boardSize":15,"winLength":5}' as const;
export const OMOK_RESOLVED_CONFIG_JSON =
  '{"boardSize":15,"winLength":5,"ruleVariant":"renju-forbidden-v1"}' as const;

const EMPTY_CELL = "." as const;
const BLACK_CELL = "B" as const;
const WHITE_CELL = "W" as const;
const BOARD_CELL_PATTERN = /^[.BW]+$/;
const BOARD_CELL_COUNT = OMOK_BOARD_SIZE * OMOK_BOARD_SIZE;

export type OmokSeatIndex = 0 | 1;
export type OmokStone = "BLACK" | "WHITE";
export type OmokMatchStatus = "ACTIVE" | "WON" | "DRAW";
export type OmokRulesetRevision = (typeof OMOK_SUPPORTED_RULESET_REVISIONS)[number];

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
  readonly rulesetRevision: OmokRulesetRevision;
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

export function isSupportedOmokRulesetRevision(value: unknown): value is OmokRulesetRevision {
  return (OMOK_SUPPORTED_RULESET_REVISIONS as readonly unknown[]).includes(value);
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
  rulesetRevision: OmokRulesetRevision,
): readonly OmokCoordinate[] | null {
  if (cell === EMPTY_CELL || boardCell(board, x, y) !== cell) return null;
  for (const [dx, dy] of WIN_DIRECTIONS) {
    const line = collectLine(board, x, y, cell, dx, dy);
    const wins =
      rulesetRevision === OMOK_LEGACY_RULESET_REVISION || cell === WHITE_CELL
        ? line.length >= OMOK_WIN_LENGTH
        : line.length === OMOK_WIN_LENGTH;
    if (wins) return line;
  }
  return null;
}

function boardHasWinner(
  board: string,
  cell: EncodedCell,
  rulesetRevision: OmokRulesetRevision,
): boolean {
  for (let y = 0; y < OMOK_BOARD_SIZE; y += 1) {
    for (let x = 0; x < OMOK_BOARD_SIZE; x += 1) {
      if (boardCell(board, x, y) === cell && findWinningLine(board, x, y, cell, rulesetRevision)) {
        return true;
      }
    }
  }
  return false;
}

type RenjuForbiddenReason = "OVERLINE" | "DOUBLE_FOUR" | "DOUBLE_THREE" | "ANALYSIS_LIMIT";

type RenjuBlackMoveAnalysis =
  | { readonly kind: "LEGAL" }
  | { readonly kind: "WIN"; readonly winningLine: readonly OmokCoordinate[] }
  | { readonly kind: "FORBIDDEN"; readonly reason: RenjuForbiddenReason };

interface RenjuAnalysisContext {
  readonly memo: Map<string, RenjuBlackMoveAnalysis>;
  nodes: number;
}

// A legal-action request must have bounded CPU even for a deliberately pathological board. Normal
// positions visit only a handful of nodes; exhausting this defensive budget fails closed.
const RENJU_ANALYSIS_NODE_LIMIT = 4_096;

function coordinateIndex(coordinate: OmokCoordinate): number {
  return boardIndex(coordinate.x, coordinate.y);
}

function coordinateSetKey(coordinates: readonly OmokCoordinate[]): string {
  return coordinates
    .map(coordinateIndex)
    .sort((left, right) => left - right)
    .join(",");
}

function lineContains(line: readonly OmokCoordinate[], coordinate: OmokCoordinate): boolean {
  return line.some((candidate) => candidate.x === coordinate.x && candidate.y === coordinate.y);
}

function hasBlackOverlineThrough(board: string, x: number, y: number): boolean {
  return WIN_DIRECTIONS.some(
    ([dx, dy]) => collectLine(board, x, y, BLACK_CELL, dx, dy).length > OMOK_WIN_LENGTH,
  );
}

/**
 * Count distinct fours created through one black move. A straight four has two winning endpoints,
 * so five-cell windows are deduplicated by their four occupied intersections. Broken fours and
 * two independent fours in the same direction remain distinct.
 */
function collectBlackFourStructureKeys(board: string, anchor: OmokCoordinate): ReadonlySet<string> {
  const structures = new Set<string>();
  for (const [dx, dy] of WIN_DIRECTIONS) {
    for (let startOffset = -(OMOK_WIN_LENGTH - 1); startOffset <= 0; startOffset += 1) {
      const segment: OmokCoordinate[] = [];
      for (let offset = 0; offset < OMOK_WIN_LENGTH; offset += 1) {
        const x = anchor.x + (startOffset + offset) * dx;
        const y = anchor.y + (startOffset + offset) * dy;
        if (!isCoordinate(x) || !isCoordinate(y)) {
          segment.length = 0;
          break;
        }
        segment.push({ x, y });
      }
      if (segment.length !== OMOK_WIN_LENGTH) continue;

      const black = segment.filter(
        (coordinate) => boardCell(board, coordinate.x, coordinate.y) === BLACK_CELL,
      );
      const empty = segment.filter(
        (coordinate) => boardCell(board, coordinate.x, coordinate.y) === EMPTY_CELL,
      );
      if (
        black.length !== OMOK_WIN_LENGTH - 1 ||
        empty.length !== 1 ||
        !lineContains(black, anchor)
      ) {
        continue;
      }

      const completion = empty[0];
      if (!completion) continue;
      const completedBoard = replaceBoardCell(board, completion.x, completion.y, BLACK_CELL);
      const completedLine = collectLine(
        completedBoard,
        completion.x,
        completion.y,
        BLACK_CELL,
        dx,
        dy,
      );
      if (completedLine.length === OMOK_WIN_LENGTH) {
        structures.add(coordinateSetKey(black));
      }
    }
  }
  return structures;
}

function isStraightBlackFourThrough(
  board: string,
  anchor: OmokCoordinate,
  extension: OmokCoordinate,
  dx: number,
  dy: number,
): readonly OmokCoordinate[] | null {
  const line = collectLine(board, anchor.x, anchor.y, BLACK_CELL, dx, dy);
  if (
    line.length !== OMOK_WIN_LENGTH - 1 ||
    !lineContains(line, extension) ||
    !lineContains(line, anchor)
  ) {
    return null;
  }

  const first = line[0];
  const last = line[line.length - 1];
  if (!first || !last) return null;
  const before = { x: first.x - dx, y: first.y - dy };
  const after = { x: last.x + dx, y: last.y + dy };
  if (
    !isCoordinate(before.x) ||
    !isCoordinate(before.y) ||
    !isCoordinate(after.x) ||
    !isCoordinate(after.y) ||
    boardCell(board, before.x, before.y) !== EMPTY_CELL ||
    boardCell(board, after.x, after.y) !== EMPTY_CELL
  ) {
    return null;
  }

  for (const completion of [before, after]) {
    const completedBoard = replaceBoardCell(board, completion.x, completion.y, BLACK_CELL);
    if (
      collectLine(completedBoard, completion.x, completion.y, BLACK_CELL, dx, dy).length !==
      OMOK_WIN_LENGTH
    ) {
      return null;
    }
  }
  return line;
}

function collectRealBlackThreeStructureKeys(
  board: string,
  anchor: OmokCoordinate,
  context: RenjuAnalysisContext,
): ReadonlySet<string> {
  const structures = new Set<string>();
  for (const [dx, dy] of WIN_DIRECTIONS) {
    for (let offset = -(OMOK_WIN_LENGTH - 1); offset < OMOK_WIN_LENGTH; offset += 1) {
      if (offset === 0) continue;
      const extension = { x: anchor.x + offset * dx, y: anchor.y + offset * dy };
      if (
        !isCoordinate(extension.x) ||
        !isCoordinate(extension.y) ||
        boardCell(board, extension.x, extension.y) !== EMPTY_CELL
      ) {
        continue;
      }

      const extendedBoard = replaceBoardCell(board, extension.x, extension.y, BLACK_CELL);
      const straightFour = isStraightBlackFourThrough(extendedBoard, anchor, extension, dx, dy);
      if (!straightFour) continue;

      // The hypothetical extension itself must be a legal, non-winning black move. This recursive
      // legality check excludes fake threes whose only continuation is an overline, double-four,
      // or another forbidden double-three, matching the RIF double-three exception.
      const extensionAnalysis = analyzeRenjuBlackMove(board, extension, context);
      if (extensionAnalysis.kind !== "LEGAL") continue;

      const originalThree = straightFour.filter(
        (coordinate) => coordinate.x !== extension.x || coordinate.y !== extension.y,
      );
      if (originalThree.length === 3 && lineContains(originalThree, anchor)) {
        structures.add(coordinateSetKey(originalThree));
      }
    }
  }
  return structures;
}

function analyzeRenjuBlackMove(
  board: string,
  move: OmokCoordinate,
  context: RenjuAnalysisContext,
): RenjuBlackMoveAnalysis {
  const cacheKey = `${board}:${move.x},${move.y}`;
  const cached = context.memo.get(cacheKey);
  if (cached) return cached;
  if (context.nodes >= RENJU_ANALYSIS_NODE_LIMIT) {
    return { kind: "FORBIDDEN", reason: "ANALYSIS_LIMIT" };
  }
  context.nodes += 1;

  const nextBoard = replaceBoardCell(board, move.x, move.y, BLACK_CELL);
  const exactFive = findWinningLine(nextBoard, move.x, move.y, BLACK_CELL, OMOK_RULESET_REVISION);
  let result: RenjuBlackMoveAnalysis;
  // RIF rule 9.2 gives an exact five priority over a simultaneously formed forbidden pattern.
  if (exactFive) {
    result = { kind: "WIN", winningLine: exactFive };
  } else if (hasBlackOverlineThrough(nextBoard, move.x, move.y)) {
    result = { kind: "FORBIDDEN", reason: "OVERLINE" };
  } else if (collectBlackFourStructureKeys(nextBoard, move).size > 1) {
    result = { kind: "FORBIDDEN", reason: "DOUBLE_FOUR" };
  } else if (collectRealBlackThreeStructureKeys(nextBoard, move, context).size > 1) {
    result = { kind: "FORBIDDEN", reason: "DOUBLE_THREE" };
  } else {
    result = { kind: "LEGAL" };
  }
  context.memo.set(cacheKey, result);
  return result;
}

function analyzeCurrentRenjuBlackMove(board: string, move: OmokCoordinate): RenjuBlackMoveAnalysis {
  return analyzeRenjuBlackMove(board, move, { memo: new Map(), nodes: 0 });
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
export function isOmokResolvedConfigJson(
  value: string,
  rulesetRevision: OmokRulesetRevision = OMOK_RULESET_REVISION,
): boolean {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isPlainRecord(parsed)) return false;
    if (rulesetRevision === OMOK_LEGACY_RULESET_REVISION) {
      return (
        hasExactKeys(parsed, ["boardSize", "winLength"]) &&
        parsed.boardSize === OMOK_BOARD_SIZE &&
        parsed.winLength === OMOK_WIN_LENGTH
      );
    }
    return (
      hasExactKeys(parsed, ["boardSize", "winLength", "ruleVariant"]) &&
      parsed.boardSize === OMOK_BOARD_SIZE &&
      parsed.winLength === OMOK_WIN_LENGTH &&
      parsed.ruleVariant === "renju-forbidden-v1"
    );
  } catch {
    return false;
  }
}

export function createInitialOmokState(
  rulesetRevision: OmokRulesetRevision = OMOK_RULESET_REVISION,
): OmokStateV1 {
  return {
    stateSchemaVersion: OMOK_STATE_SCHEMA_VERSION,
    rulesetKey: OMOK_RULESET_KEY,
    rulesetRevision,
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
    !isSupportedOmokRulesetRevision(value.rulesetRevision) ||
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

  const rulesetRevision = value.rulesetRevision;
  const blackWon = boardHasWinner(board, BLACK_CELL, rulesetRevision);
  const whiteWon = boardHasWinner(board, WHITE_CELL, rulesetRevision);
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
      rulesetRevision,
    );
    if (!parsedLine || !expectedLine || !sameCoordinates(parsedLine, expectedLine)) return null;
    if (lastMove.seatIndex === 0 ? !blackWon || whiteWon : !whiteWon || blackWon) return null;
  }

  return {
    stateSchemaVersion: OMOK_STATE_SCHEMA_VERSION,
    rulesetKey: OMOK_RULESET_KEY,
    rulesetRevision,
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
  const renjuAnalysis =
    state.rulesetRevision === OMOK_RULESET_REVISION && actorSeatIndex === 0
      ? analyzeCurrentRenjuBlackMove(state.board, action)
      : null;
  if (renjuAnalysis?.kind === "FORBIDDEN") {
    return { ok: false, code: "ACTION_INVALID", currentRevision: state.revision };
  }
  const board = replaceBoardCell(state.board, action.x, action.y, cell);
  const revision = state.revision + 1;
  const lastMove: OmokMove = { ...action, seatIndex: actorSeatIndex };
  const winningLine =
    renjuAnalysis?.kind === "WIN"
      ? renjuAnalysis.winningLine
      : findWinningLine(board, action.x, action.y, cell, state.rulesetRevision);

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
