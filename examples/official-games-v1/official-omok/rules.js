(() => {
  "use strict";

  const SIZE = 15;
  const CELL_COUNT = SIZE * SIZE;
  const PROTOCOL = "owogg-omok/v1";

  function emptyBoard() {
    return Array.from({ length: CELL_COUNT }, () => 0);
  }

  function createState() {
    return {
      protocol: PROTOCOL,
      type: "state",
      revision: 1,
      board: emptyBoard(),
      turn: 1,
      winner: 0,
      moves: 0,
    };
  }

  function isIntegerBetween(value, min, max) {
    return Number.isSafeInteger(value) && value >= min && value <= max;
  }

  function parseState(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const keys = Object.keys(value).sort();
    if (keys.join("|") !== "board|moves|protocol|revision|turn|type|winner") return null;
    if (value.protocol !== PROTOCOL || value.type !== "state") return null;
    if (!isIntegerBetween(value.revision, 1, 1000) || !isIntegerBetween(value.moves, 0, CELL_COUNT))
      return null;
    if (![0, 1, 2].includes(value.turn) || ![0, 1, 2, 3].includes(value.winner)) return null;
    if (
      !Array.isArray(value.board) ||
      value.board.length !== CELL_COUNT ||
      value.board.some((cell) => ![0, 1, 2].includes(cell))
    )
      return null;
    if (value.board.filter((cell) => cell !== 0).length !== value.moves) return null;
    if (value.winner === 0 && value.turn === 0) return null;
    if (value.winner !== 0 && value.turn !== 0) return null;
    return {
      protocol: PROTOCOL,
      type: "state",
      revision: value.revision,
      board: [...value.board],
      turn: value.turn,
      winner: value.winner,
      moves: value.moves,
    };
  }

  function countLine(board, row, column, rowStep, columnStep, color) {
    let count = 1;
    for (const direction of [-1, 1]) {
      let nextRow = row + rowStep * direction;
      let nextColumn = column + columnStep * direction;
      while (
        nextRow >= 0 &&
        nextRow < SIZE &&
        nextColumn >= 0 &&
        nextColumn < SIZE &&
        board[nextRow * SIZE + nextColumn] === color
      ) {
        count += 1;
        nextRow += rowStep * direction;
        nextColumn += columnStep * direction;
      }
    }
    return count;
  }

  function isWinningMove(board, index, color) {
    const row = Math.floor(index / SIZE);
    const column = index % SIZE;
    return [
      [1, 0],
      [0, 1],
      [1, 1],
      [1, -1],
    ].some(([rowStep, columnStep]) => {
      const count = countLine(board, row, column, rowStep, columnStep, color);
      return color === 1 ? count === 5 : count >= 5;
    });
  }

  function applyMove(state, index, color) {
    const current = parseState(state);
    if (
      !current ||
      current.winner !== 0 ||
      current.turn !== color ||
      !isIntegerBetween(index, 0, CELL_COUNT - 1) ||
      current.board[index] !== 0
    )
      return null;
    const board = [...current.board];
    board[index] = color;
    const moves = current.moves + 1;
    const winner = isWinningMove(board, index, color) ? color : moves === CELL_COUNT ? 3 : 0;
    return {
      protocol: PROTOCOL,
      type: "state",
      revision: current.revision + 1,
      board,
      turn: winner === 0 ? (color === 1 ? 2 : 1) : 0,
      winner,
      moves,
    };
  }

  window.OwoggOmokRules = Object.freeze({ SIZE, PROTOCOL, createState, parseState, applyMove });
})();
