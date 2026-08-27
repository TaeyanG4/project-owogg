"use strict";

/**
 * OWOGG official M1 reference client. This file renders server projections and submits intents;
 * it never decides turns, legal moves, winners, rewards, or persistence and never opens a network
 * connection. The platform-injected window.OWOGG.multiplayer bridge owns that boundary.
 */
(function () {
  const BOARD_SIZE = 15;
  const BOARD_CELLS = BOARD_SIZE * BOARD_SIZE;
  const boardElement = document.getElementById("board");
  const boardGrid = document.getElementById("boardGrid");
  const statusTitle = document.getElementById("statusTitle");
  const statusDetail = document.getElementById("statusDetail");
  const revisionLabel = document.getElementById("revisionLabel");
  const stoneBadge = document.getElementById("stoneBadge");
  const stoneLabel = document.getElementById("stoneLabel");
  const soundToggle = document.getElementById("soundToggle");
  const soundLabel = document.getElementById("soundLabel");
  const stoneSelector = document.getElementById("stoneSelector");
  const stoneSelectorDetail = document.getElementById("stoneSelectorDetail");
  const stoneChoiceActions = document.getElementById("stoneChoiceActions");
  const stoneChoiceButtons = Array.from(document.querySelectorAll("[data-stone]"));
  const bridge = window.OWOGG && window.OWOGG.multiplayer;
  const cells = [];

  let view = null;
  let pendingActionId = null;
  let connectionState = "CONNECTING";
  let soundEnabled = true;
  let selectionPending = false;
  let audioContext = null;

  function nearestDevicePixelCenter(value, limit) {
    return Math.min(limit - 0.5, Math.max(0.5, Math.round(value - 0.5) + 0.5));
  }

  function renderBoardGrid() {
    if (!boardGrid) return;
    const bounds = boardGrid.getBoundingClientRect();
    const devicePixelRatio = Math.max(1, window.devicePixelRatio || 1);
    const pixelWidth = Math.max(1, Math.round(bounds.width * devicePixelRatio));
    const pixelHeight = Math.max(1, Math.round(bounds.height * devicePixelRatio));
    if (boardGrid.width !== pixelWidth) boardGrid.width = pixelWidth;
    if (boardGrid.height !== pixelHeight) boardGrid.height = pixelHeight;
    const context = boardGrid.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, pixelWidth, pixelHeight);
    context.strokeStyle = "rgba(72, 40, 14, 0.72)";
    context.lineWidth = 1;
    context.lineCap = "butt";
    context.beginPath();
    const firstX = nearestDevicePixelCenter((0.5 / BOARD_SIZE) * pixelWidth, pixelWidth);
    const lastX = nearestDevicePixelCenter(
      ((BOARD_SIZE - 0.5) / BOARD_SIZE) * pixelWidth,
      pixelWidth,
    );
    const firstY = nearestDevicePixelCenter((0.5 / BOARD_SIZE) * pixelHeight, pixelHeight);
    const lastY = nearestDevicePixelCenter(
      ((BOARD_SIZE - 0.5) / BOARD_SIZE) * pixelHeight,
      pixelHeight,
    );
    for (let index = 0; index < BOARD_SIZE; index += 1) {
      const x = nearestDevicePixelCenter(((index + 0.5) / BOARD_SIZE) * pixelWidth, pixelWidth);
      const y = nearestDevicePixelCenter(((index + 0.5) / BOARD_SIZE) * pixelHeight, pixelHeight);
      context.moveTo(x, firstY);
      context.lineTo(x, lastY);
      context.moveTo(firstX, y);
      context.lineTo(lastX, y);
    }
    context.stroke();
  }

  function getAudioContext() {
    if (!soundEnabled) return null;
    if (!audioContext) {
      const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextConstructor) return null;
      audioContext = new AudioContextConstructor();
    }
    if (audioContext.state === "suspended") void audioContext.resume();
    return audioContext;
  }

  function tone(frequency, startOffset, duration, volume, type) {
    const context = getAudioContext();
    if (!context || context.state === "closed") return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const startsAt = context.currentTime + startOffset;
    oscillator.type = type || "sine";
    oscillator.frequency.setValueAtTime(frequency, startsAt);
    gain.gain.setValueAtTime(0.0001, startsAt);
    gain.gain.exponentialRampToValueAtTime(volume, startsAt + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, startsAt + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startsAt);
    oscillator.stop(startsAt + duration + 0.02);
  }

  function playMoveSound(stone) {
    tone(stone === "BLACK" ? 190 : 260, 0, 0.075, 0.1, "triangle");
    tone(stone === "BLACK" ? 125 : 175, 0.025, 0.095, 0.055, "sine");
  }

  function playTerminalSound(won, draw) {
    if (draw) {
      tone(240, 0, 0.12, 0.07, "sine");
      tone(240, 0.15, 0.12, 0.06, "sine");
      return;
    }
    const notes = won ? [392, 494, 659] : [330, 247, 196];
    notes.forEach(function (frequency, index) {
      tone(frequency, index * 0.11, 0.16, 0.075, "sine");
    });
  }

  function renderSoundToggle() {
    soundToggle.setAttribute("aria-pressed", soundEnabled ? "true" : "false");
    soundToggle.setAttribute("aria-label", soundEnabled ? "게임 소리 끄기" : "게임 소리 켜기");
    soundLabel.textContent = soundEnabled ? "소리 켬" : "소리 끔";
  }

  function setStatus(title, detail) {
    statusTitle.textContent = title;
    statusDetail.textContent = detail;
  }

  function validCoordinate(value) {
    return (
      value &&
      Number.isInteger(value.x) &&
      Number.isInteger(value.y) &&
      value.x >= 0 &&
      value.x < BOARD_SIZE &&
      value.y >= 0 &&
      value.y < BOARD_SIZE
    );
  }

  function parseView(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    if (
      value.stateSchemaVersion !== 1 ||
      value.rulesetKey !== "official:omok" ||
      value.rulesetRevision !== 1 ||
      value.boardSize !== BOARD_SIZE ||
      value.winLength !== 5 ||
      !Number.isInteger(value.revision) ||
      value.revision < 0 ||
      typeof value.board !== "string" ||
      value.board.length !== BOARD_CELLS ||
      !/^[.BW]+$/.test(value.board) ||
      (value.status !== "ACTIVE" && value.status !== "WON" && value.status !== "DRAW") ||
      (value.yourSeatIndex !== 0 && value.yourSeatIndex !== 1) ||
      (value.yourStone !== "BLACK" && value.yourStone !== "WHITE") ||
      (value.nextSeatIndex !== null && value.nextSeatIndex !== 0 && value.nextSeatIndex !== 1) ||
      (value.winnerSeatIndex !== null && value.winnerSeatIndex !== 0 && value.winnerSeatIndex !== 1)
    ) {
      return null;
    }
    if (
      !value.stoneSelection ||
      typeof value.stoneSelection !== "object" ||
      Array.isArray(value.stoneSelection) ||
      (value.stoneSelection.status !== "PENDING" && value.stoneSelection.status !== "LOCKED") ||
      typeof value.stoneSelection.canSelect !== "boolean" ||
      (value.stoneSelection.status === "LOCKED" && value.stoneSelection.canSelect)
    ) {
      return null;
    }
    if (value.lastMove !== null && !validCoordinate(value.lastMove)) return null;
    if (
      value.winningLine !== null &&
      (!Array.isArray(value.winningLine) || !value.winningLine.every(validCoordinate))
    ) {
      return null;
    }
    return value;
  }

  function isWinningCoordinate(x, y) {
    return Boolean(
      view &&
      Array.isArray(view.winningLine) &&
      view.winningLine.some(function (coordinate) {
        return coordinate.x === x && coordinate.y === y;
      }),
    );
  }

  function isStarCoordinate(x, y) {
    return (
      (x === 3 && y === 3) ||
      (x === 11 && y === 3) ||
      (x === 7 && y === 7) ||
      (x === 3 && y === 11) ||
      (x === 11 && y === 11)
    );
  }

  function renderStoneBadge() {
    const marker = stoneBadge.querySelector(".stone");
    marker.className = "stone";
    if (!view || view.stoneSelection.status === "PENDING") {
      marker.classList.add("stone-neutral");
      stoneLabel.textContent = view ? "돌 선택 대기" : "좌석 확인 중";
      return;
    }
    if (view.yourStone === "BLACK") {
      marker.classList.add("stone-black");
      stoneLabel.textContent = "내 돌 · 흑";
    } else {
      marker.classList.add("stone-white");
      stoneLabel.textContent = "내 돌 · 백";
    }
  }

  function renderStoneSelector() {
    const selecting = view && view.stoneSelection.status === "PENDING";
    stoneSelector.hidden = !selecting;
    if (!selecting) return;
    const canSelect = view.stoneSelection.canSelect;
    stoneChoiceActions.hidden = !canSelect;
    stoneSelectorDetail.textContent = canSelect
      ? selectionPending
        ? "선택을 서버에서 확인하고 있습니다."
        : "사용할 돌을 선택하세요. 서버가 좌석과 첫 수를 확정합니다."
      : "방장이 흑돌과 백돌을 선택하고 있습니다.";
    stoneChoiceButtons.forEach(function (button) {
      button.disabled = selectionPending;
    });
  }

  function renderStatus() {
    if (!view) {
      if (connectionState === "CONNECTED") {
        setStatus("상대와 준비를 맞추는 중입니다", "공식 상태가 도착하면 판이 열립니다.");
      }
      return;
    }
    if (view.stoneSelection.status === "PENDING") {
      setStatus(
        view.stoneSelection.canSelect ? "사용할 돌을 선택하세요" : "방장의 돌 선택을 기다립니다",
        "선택 결과는 서버가 두 플레이어에게 동시에 적용합니다.",
      );
      return;
    }
    if (view.status === "WON") {
      const won = view.winnerSeatIndex === view.yourSeatIndex;
      setStatus(won ? "승리했습니다" : "상대가 승리했습니다", "공식 결과 확정을 기다립니다.");
      return;
    }
    if (view.status === "DRAW") {
      setStatus("무승부입니다", "공식 결과 확정을 기다립니다.");
      return;
    }
    if (pendingActionId) {
      setStatus("착수를 확인 중입니다", "서버 판정이 올 때까지 잠시 기다려 주세요.");
      return;
    }
    if (view.nextSeatIndex === view.yourSeatIndex) {
      setStatus("내 차례입니다", "빈 교차점을 선택해 돌을 놓으세요.");
    } else {
      setStatus("상대 차례입니다", "상대의 착수를 기다리고 있습니다.");
    }
  }

  function renderBoard() {
    const canMove = Boolean(
      view &&
      view.stoneSelection.status === "LOCKED" &&
      view.status === "ACTIVE" &&
      view.nextSeatIndex === view.yourSeatIndex &&
      pendingActionId === null,
    );
    for (let index = 0; index < cells.length; index += 1) {
      const cell = cells[index];
      const x = index % BOARD_SIZE;
      const y = Math.floor(index / BOARD_SIZE);
      const value = view ? view.board[index] : ".";
      cell.disabled = !canMove || value !== ".";
      cell.replaceChildren();
      cell.setAttribute(
        "aria-label",
        value === "."
          ? `${y + 1}행 ${x + 1}열 빈 자리`
          : `${y + 1}행 ${x + 1}열 ${value === "B" ? "흑돌" : "백돌"}`,
      );
      if (isStarCoordinate(x, y)) {
        const star = document.createElement("span");
        star.className = "star-point";
        star.setAttribute("aria-hidden", "true");
        cell.appendChild(star);
      }
      if (value === ".") continue;
      const piece = document.createElement("span");
      piece.className = `piece ${value === "B" ? "black" : "white"}`;
      if (view && view.lastMove && view.lastMove.x === x && view.lastMove.y === y) {
        piece.classList.add("last");
      }
      if (isWinningCoordinate(x, y)) piece.classList.add("winner");
      cell.appendChild(piece);
    }
  }

  function render() {
    renderStoneSelector();
    renderStoneBadge();
    renderStatus();
    renderBoard();
    revisionLabel.textContent = view ? `공식 상태 · ${view.revision}수` : "공식 상태 대기 중";
  }

  function rejectionMessage(code) {
    if (code === "NOT_YOUR_TURN") return "아직 내 차례가 아닙니다.";
    if (code === "ACTION_INVALID") return "그 자리에는 둘 수 없습니다.";
    if (code === "ACTION_CONFLICT") return "동시에 상태가 바뀌어 판을 다시 맞췄습니다.";
    if (code === "RATE_LIMITED") return "착수가 너무 빠릅니다. 잠시 후 다시 시도하세요.";
    if (code === "MATCH_NOT_ACTIVE") return "현재 진행 중인 경기가 아닙니다.";
    return "착수가 승인되지 않았습니다.";
  }

  function handleMessage(message) {
    if (message.type === "MULTI_CONNECTED") {
      connectionState = "CONNECTED";
      renderStatus();
      return;
    }
    if (message.type === "MULTI_SYNC" || message.type === "MULTI_STATE") {
      const nextView = parseView(message.payload);
      if (!nextView || nextView.revision !== message.revision) return;
      const previousView = view;
      view = nextView;
      pendingActionId = null;
      selectionPending = false;
      render();
      if (previousView && nextView.revision > previousView.revision) {
        if (previousView.status === "ACTIVE" && nextView.status !== "ACTIVE") {
          playTerminalSound(
            nextView.winnerSeatIndex === nextView.yourSeatIndex,
            nextView.status === "DRAW",
          );
        } else if (nextView.lastMove) {
          const latestStone =
            nextView.board[nextView.lastMove.y * BOARD_SIZE + nextView.lastMove.x];
          playMoveSound(latestStone === "B" ? "BLACK" : "WHITE");
        }
      }
      return;
    }
    if (message.type === "MULTI_ACTION_REJECTED") {
      if (pendingActionId === message.clientActionId) pendingActionId = null;
      setStatus("착수가 거절되었습니다", rejectionMessage(message.code));
      renderBoard();
      return;
    }
    if (message.type === "MULTI_TERMINAL_PENDING") {
      setStatus("경기가 끝났습니다", "공식 결과를 안전하게 저장하는 중입니다.");
      return;
    }
    if (message.type === "MULTI_TERMINAL_COMMITTED") {
      setStatus("공식 결과가 확정되었습니다", "결과는 게임 화면 밖 OWOGG 패널에 표시됩니다.");
      return;
    }
    if (message.type === "MULTI_DISCONNECTED") {
      connectionState = "DISCONNECTED";
      setStatus("연결이 끊어졌습니다", "OWOGG 연결 패널에서 재연결할 수 있습니다.");
      return;
    }
    if (message.type === "MULTI_ABORTED") {
      setStatus("경기가 중단되었습니다", "공식 결과와 보상은 생성되지 않습니다.");
      return;
    }
    if (message.type === "MULTI_PLAYER_JOINED") {
      setStatus("상대가 참가했습니다", "두 플레이어의 준비를 확인하고 있습니다.");
    }
  }

  function tryMove(x, y) {
    getAudioContext();
    if (
      !bridge ||
      !view ||
      view.stoneSelection.status !== "LOCKED" ||
      view.status !== "ACTIVE" ||
      view.nextSeatIndex !== view.yourSeatIndex ||
      pendingActionId !== null ||
      view.board[y * BOARD_SIZE + x] !== "."
    ) {
      return;
    }
    const actionId = bridge.action({
      expectedRevision: view.revision,
      payload: { x: x, y: y },
    });
    if (!actionId) {
      setStatus("착수를 보내지 못했습니다", "연결 상태를 확인한 뒤 다시 시도하세요.");
      return;
    }
    pendingActionId = actionId;
    render();
  }

  function selectStone(stone) {
    getAudioContext();
    if (
      !bridge ||
      !view ||
      view.stoneSelection.status !== "PENDING" ||
      !view.stoneSelection.canSelect ||
      selectionPending ||
      (stone !== "BLACK" && stone !== "WHITE")
    ) {
      return;
    }
    if (!bridge.input({ kind: "OMOK_SELECT_STONE", stone: stone })) {
      setStatus("돌 선택을 보내지 못했습니다", "연결 상태를 확인한 뒤 다시 선택하세요.");
      return;
    }
    selectionPending = true;
    render();
  }

  soundToggle.addEventListener("click", function () {
    soundEnabled = !soundEnabled;
    if (soundEnabled) {
      getAudioContext();
      tone(440, 0, 0.08, 0.05, "sine");
    }
    renderSoundToggle();
  });

  stoneChoiceButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      selectStone(button.getAttribute("data-stone"));
    });
  });

  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "intersection";
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("aria-rowindex", String(y + 1));
      cell.setAttribute("aria-colindex", String(x + 1));
      cell.addEventListener("click", function () {
        tryMove(x, y);
      });
      boardElement.appendChild(cell);
      cells.push(cell);
    }
  }

  if (boardGrid && typeof ResizeObserver === "function") {
    const gridResizeObserver = new ResizeObserver(renderBoardGrid);
    gridResizeObserver.observe(boardGrid);
  } else {
    window.addEventListener("resize", renderBoardGrid);
  }
  renderBoardGrid();

  if (!bridge) {
    setStatus("멀티플레이 브리지를 찾을 수 없습니다", "OWOGG 게임 페이지에서 다시 실행해 주세요.");
    render();
    return;
  }

  bridge.subscribe(handleMessage);
  if (!bridge.ready()) {
    setStatus("준비 신호를 보내지 못했습니다", "게임 페이지를 새로고침해 주세요.");
  }
  renderSoundToggle();
  render();
})();
