(() => {
  "use strict";

  const SIZE = 15;
  const CELL_COUNT = SIZE * SIZE;
  const MAX_ROUND = 9999;
  const PROTOCOL = "owogg-omok/v2";
  const DIRECTIONS = Object.freeze([
    Object.freeze([1, 0]),
    Object.freeze([0, 1]),
    Object.freeze([1, 1]),
    Object.freeze([1, -1]),
  ]);
  const FOUL_REASONS = Object.freeze({
    OCCUPIED: "이미 돌이 놓인 자리입니다.",
    NOT_TURN: "현재 차례의 돌만 놓을 수 있습니다.",
    OVERLINE: "흑은 여섯 개 이상을 잇는 장목을 둘 수 없습니다.",
    DOUBLE_FOUR: "흑은 두 개 이상의 4를 동시에 만드는 44를 둘 수 없습니다.",
    DOUBLE_THREE: "흑은 두 개 이상의 열린 3을 동시에 만드는 33을 둘 수 없습니다.",
    FINISHED: "이미 끝난 대국입니다.",
    INVALID: "착수할 수 없는 자리입니다.",
  });

  function emptyBoard() {
    return Array.from({ length: CELL_COUNT }, () => 0);
  }

  function createState(round = 1, revision = 1) {
    return {
      protocol: PROTOCOL,
      type: "state",
      revision,
      round,
      board: emptyBoard(),
      turn: 1,
      winner: 0,
      moves: 0,
      lastMove: -1,
      rematchVotes: [false, false],
    };
  }

  function isIntegerBetween(value, min, max) {
    return Number.isSafeInteger(value) && value >= min && value <= max;
  }

  function parseState(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const keys = Object.keys(value).sort();
    if (
      keys.join("|") !==
      "board|lastMove|moves|protocol|rematchVotes|revision|round|turn|type|winner"
    )
      return null;
    if (value.protocol !== PROTOCOL || value.type !== "state") return null;
    if (
      !isIntegerBetween(value.revision, 1, 1_000_000) ||
      !isIntegerBetween(value.round, 1, MAX_ROUND) ||
      !isIntegerBetween(value.moves, 0, CELL_COUNT) ||
      !isIntegerBetween(value.lastMove, -1, CELL_COUNT - 1)
    )
      return null;
    if (![0, 1, 2].includes(value.turn) || ![0, 1, 2, 3].includes(value.winner)) return null;
    if (
      !Array.isArray(value.board) ||
      value.board.length !== CELL_COUNT ||
      value.board.some((cell) => ![0, 1, 2].includes(cell)) ||
      !Array.isArray(value.rematchVotes) ||
      value.rematchVotes.length !== 2 ||
      value.rematchVotes.some((vote) => typeof vote !== "boolean")
    )
      return null;
    const blackCount = value.board.filter((cell) => cell === 1).length;
    const whiteCount = value.board.filter((cell) => cell === 2).length;
    if (blackCount + whiteCount !== value.moves) return null;
    if (blackCount !== whiteCount && blackCount !== whiteCount + 1) return null;
    if (value.moves === 0 ? value.lastMove !== -1 : value.board[value.lastMove] === 0) return null;
    if (value.winner === 0) {
      if (value.turn !== (blackCount === whiteCount ? 1 : 2)) return null;
      if (value.rematchVotes.some(Boolean)) return null;
    } else {
      if (value.turn !== 0) return null;
      if (value.winner === 1 && blackCount !== whiteCount + 1) return null;
      if (value.winner === 2 && blackCount !== whiteCount) return null;
      if (value.winner === 3 && value.moves !== CELL_COUNT) return null;
    }
    return {
      protocol: PROTOCOL,
      type: "state",
      revision: value.revision,
      round: value.round,
      board: [...value.board],
      turn: value.turn,
      winner: value.winner,
      moves: value.moves,
      lastMove: value.lastMove,
      rematchVotes: [...value.rematchVotes],
    };
  }

  function position(row, column) {
    if (row < 0 || row >= SIZE || column < 0 || column >= SIZE) return -1;
    return row * SIZE + column;
  }

  function lineRun(board, index, rowStep, columnStep, color) {
    const originRow = Math.floor(index / SIZE);
    const originColumn = index % SIZE;
    const indices = [index];
    for (const direction of [-1, 1]) {
      const side = [];
      let row = originRow + rowStep * direction;
      let column = originColumn + columnStep * direction;
      let next = position(row, column);
      while (next >= 0 && board[next] === color) {
        side.push(next);
        row += rowStep * direction;
        column += columnStep * direction;
        next = position(row, column);
      }
      if (direction < 0) indices.unshift(...side.reverse());
      else indices.push(...side);
    }
    return indices;
  }

  function lineLengths(board, index, color) {
    return DIRECTIONS.map(
      ([rowStep, columnStep]) => lineRun(board, index, rowStep, columnStep, color).length,
    );
  }

  function hasOverline(board, index) {
    return lineLengths(board, index, 1).some((length) => length > 5);
  }

  function hasExactFive(board, index, color) {
    return lineLengths(board, index, color).some((length) => length === 5);
  }

  function isWhiteWin(board, index) {
    return lineLengths(board, index, 2).some((length) => length >= 5);
  }

  /** Returns distinct four-stone groups created through `anchor`. An open four has two legal
   * completion points but still counts as one four for the 44 rule. */
  function collectFourGroups(board, anchor) {
    const groups = new Map();
    const anchorRow = Math.floor(anchor / SIZE);
    const anchorColumn = anchor % SIZE;
    for (const [rowStep, columnStep] of DIRECTIONS) {
      for (let offset = -4; offset <= 4; offset += 1) {
        const completion = position(
          anchorRow + rowStep * offset,
          anchorColumn + columnStep * offset,
        );
        if (completion < 0 || board[completion] !== 0) continue;
        const simulated = [...board];
        simulated[completion] = 1;
        if (hasOverline(simulated, completion)) continue;
        const run = lineRun(simulated, completion, rowStep, columnStep, 1);
        if (run.length !== 5 || !run.includes(anchor)) continue;
        const stones = run.filter((index) => index !== completion).sort((a, b) => a - b);
        if (stones.length !== 4) continue;
        const key = stones.join(",");
        const existing = groups.get(key) ?? { stones, completions: new Set() };
        existing.completions.add(completion);
        groups.set(key, existing);
      }
    }
    return groups;
  }

  function createsDoubleFour(board, anchor) {
    return collectFourGroups(board, anchor).size >= 2;
  }

  /** Collects the possible extensions for each apparent three. An extension must make a straight
   * four without simultaneously making five, overline, or double-four. RIF 9.3 additionally says
   * the extension itself must not be a forbidden double-three; that recursive legality check is
   * applied by `createsForbiddenDoubleThree` below. */
  function collectOpenThreeCandidates(board, anchor) {
    const candidates = new Map();
    const anchorRow = Math.floor(anchor / SIZE);
    const anchorColumn = anchor % SIZE;
    for (const [rowStep, columnStep] of DIRECTIONS) {
      for (let offset = -4; offset <= 4; offset += 1) {
        const extension = position(
          anchorRow + rowStep * offset,
          anchorColumn + columnStep * offset,
        );
        if (extension < 0 || board[extension] !== 0) continue;
        const simulated = [...board];
        simulated[extension] = 1;
        if (
          hasOverline(simulated, extension) ||
          hasExactFive(simulated, extension, 1) ||
          createsDoubleFour(simulated, extension)
        )
          continue;
        for (const group of collectFourGroups(simulated, extension).values()) {
          if (
            group.completions.size < 2 ||
            !group.stones.includes(anchor) ||
            !group.stones.includes(extension)
          )
            continue;
          const base = group.stones.filter((index) => index !== extension).sort((a, b) => a - b);
          if (base.length !== 3) continue;
          const key = base.join(",");
          const extensions = candidates.get(key) ?? new Set();
          extensions.add(extension);
          candidates.set(key, extensions);
        }
      }
    }
    return candidates;
  }

  /** RIF 9.3 allows a geometric double-three when at most one apparent three has a legal route to
   * a straight four. Determining that route is recursive because the extension can itself make an
   * allowed or forbidden double-three. Every recursion adds one stone, so the search is finite;
   * memoization keeps overlapping local branches cheap. */
  function createsForbiddenDoubleThree(board, anchor, memo = new Map()) {
    const memoKey = `${anchor}:${board.join("")}`;
    if (memo.has(memoKey)) return memo.get(memoKey);

    const candidates = collectOpenThreeCandidates(board, anchor);
    if (candidates.size < 2) {
      memo.set(memoKey, false);
      return false;
    }

    let legalThreeCount = 0;
    for (const extensions of candidates.values()) {
      let hasLegalExtension = false;
      for (const extension of extensions) {
        const simulated = [...board];
        simulated[extension] = 1;
        if (!createsForbiddenDoubleThree(simulated, extension, memo)) {
          hasLegalExtension = true;
          break;
        }
      }
      if (!hasLegalExtension) continue;
      legalThreeCount += 1;
      if (legalThreeCount >= 2) {
        memo.set(memoKey, true);
        return true;
      }
    }

    memo.set(memoKey, false);
    return false;
  }

  function inspectMove(state, index, color) {
    const current = parseState(state);
    if (!current || !isIntegerBetween(index, 0, CELL_COUNT - 1) || ![1, 2].includes(color)) {
      return { legal: false, reason: "INVALID" };
    }
    if (current.winner !== 0) return { legal: false, reason: "FINISHED" };
    if (current.turn !== color) return { legal: false, reason: "NOT_TURN" };
    if (current.board[index] !== 0) return { legal: false, reason: "OCCUPIED" };
    const board = [...current.board];
    board[index] = color;
    if (color === 2) return { legal: true, winner: isWhiteWin(board, index) ? 2 : 0 };
    if (hasOverline(board, index)) return { legal: false, reason: "OVERLINE" };
    if (hasExactFive(board, index, 1)) return { legal: true, winner: 1 };
    if (createsDoubleFour(board, index)) return { legal: false, reason: "DOUBLE_FOUR" };
    if (createsForbiddenDoubleThree(board, index)) {
      return { legal: false, reason: "DOUBLE_THREE" };
    }
    return { legal: true, winner: 0 };
  }

  function applyMove(state, index, color) {
    const current = parseState(state);
    const inspection = inspectMove(current, index, color);
    if (!current || !inspection.legal) return null;
    const board = [...current.board];
    board[index] = color;
    const moves = current.moves + 1;
    const winner = inspection.winner || (moves === CELL_COUNT ? 3 : 0);
    return {
      ...current,
      revision: current.revision + 1,
      board,
      turn: winner === 0 ? (color === 1 ? 2 : 1) : 0,
      winner,
      moves,
      lastMove: index,
      rematchVotes: [false, false],
    };
  }

  function requestRematch(state, color) {
    const current = parseState(state);
    if (!current || current.winner === 0 || ![1, 2].includes(color)) return null;
    const votes = [...current.rematchVotes];
    votes[color - 1] = true;
    if (votes.every(Boolean)) {
      return createState(current.round >= MAX_ROUND ? 1 : current.round + 1, current.revision + 1);
    }
    return { ...current, revision: current.revision + 1, rematchVotes: votes };
  }

  window.OwoggOmokRules = Object.freeze({
    SIZE,
    MAX_ROUND,
    PROTOCOL,
    FOUL_REASONS,
    createState,
    parseState,
    inspectMove,
    applyMove,
    requestRematch,
  });
})();
