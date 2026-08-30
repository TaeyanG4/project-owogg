(() => {
  "use strict";

  const rules = window.OwoggOmokRules;
  const api = window.OWOGG;
  const relay = api?.multiplayer;
  const statusTitle = document.querySelector("#status-title");
  const statusDetail = document.querySelector("#status-detail");
  const launcher = document.querySelector("#launcher");
  const launcherTitle = document.querySelector("#launcher-title");
  const modeOptions = document.querySelector("#mode-options");
  const game = document.querySelector("#game");
  const gameName = document.querySelector("#game-name");
  const boardCells = document.querySelector("#board-cells");
  const board = document.querySelector("#board");
  const boardGrid = document.querySelector("#board-grid");
  const reset = document.querySelector("#reset");
  const rematch = document.querySelector("#rematch");
  const languageToggle = document.querySelector("#language-toggle");
  const soundToggle = document.querySelector("#sound-toggle");
  const modeLabel = document.querySelector("#mode-label");
  const blackLabel = document.querySelector("#black-label");
  const whiteLabel = document.querySelector("#white-label");
  const stoneBadge = document.querySelector("#stone-badge");
  const badgeStone = document.querySelector("#badge-stone");
  const stoneLabel = document.querySelector("#stone-label");
  const revisionLabel = document.querySelector("#revision-label");
  const ruleLabel = document.querySelector("#rule-label");
  const turns = document.querySelector(".turns");
  const boardWrap = document.querySelector(".board-wrap");

  const TEXT = Object.freeze({
    ko: Object.freeze({
      name: "오목",
      soundOn: "소리 켬",
      soundOff: "소리 끔",
      ready: "게임을 준비하는 중입니다",
      wait: "잠시만 기다려 주세요.",
      launcherTitle: "어떻게 플레이할까요?",
      chooseMode: "플레이 방식을 선택하세요",
      chooseModeDetail: "로컬 대전과 온라인 대전 중 원하는 방식을 고르세요.",
      localTitle: "한 기기에서",
      localDetail: "두 사람이 같은 화면에서 번갈아 착수합니다.",
      onlineTitle: "온라인에서",
      onlineDetail: "방을 만들거나 초대 코드로 참가합니다.",
      playTitle: "플레이",
      playDetail: "게임을 바로 시작합니다.",
      localMode: "LOCAL MULTI",
      onlineMode: "ONLINE RELAY",
      reset: "새 대국",
      rematch: "재대결 요청",
      rematchSent: "재대결 대기 중",
      black: "흑 · 선공",
      white: "백",
      currentTurn: "현재 차례",
      gameOver: "대전 종료",
      localBlack: "이번에 둘 돌 · 흑",
      localWhite: "이번에 둘 돌 · 백",
      myBlack: "내 돌 · 흑",
      myWhite: "내 돌 · 백",
      myBlackTurn: "내 돌 · 흑 · 지금 내 차례",
      myWhiteTurn: "내 돌 · 백 · 지금 내 차례",
      myBlackWait: "내 돌 · 흑 · 상대 차례",
      myWhiteWait: "내 돌 · 백 · 상대 차례",
      checkingStone: "돌 확인 중",
      blackTurn: "흑 차례입니다",
      whiteTurn: "백 차례입니다",
      blackWin: "흑이 승리했습니다",
      whiteWin: "백이 승리했습니다",
      draw: "무승부입니다",
      localTurn: "두 사람이 같은 기기에서 번갈아 착수하세요.",
      localFinished: "새 대국 버튼으로 같은 화면에서 다시 시작할 수 있습니다.",
      connecting: "Relay에 연결하는 중입니다",
      connectingDetail: "잠시 후 대전 상태를 불러옵니다.",
      yourTurn: "내 차례입니다. 빈 교차점을 선택하세요.",
      opponentTurn: "상대의 착수를 기다리고 있습니다.",
      onlineFinished: "재대결을 요청해 새 대국을 시작할 수 있습니다.",
      opponentRematch: "상대가 재대결을 요청했습니다.",
      waitingRematch: "상대의 재대결 응답을 기다리고 있습니다.",
      newRound: "새 대국이 시작됐습니다.",
      openingRoom: "온라인 방 선택 화면을 여는 중입니다",
      openingRoomDetail: "방을 만들거나 받은 코드로 참가하세요.",
      modeFailed: "이 플레이 방식을 시작할 수 없습니다",
      retryInside: "게임 안에서 다시 시도해 주세요.",
      modeMissing: "플레이 방식을 불러오지 못했습니다",
      disconnected: "연결이 끊겼습니다",
      reconnect: "OWOGG 연결 패널에서 재연결할 수 있습니다.",
      requestFailed: "요청을 처리하지 못했습니다",
      relayClosed: "온라인 대전이 종료됐습니다",
      readyFailed: "Relay 준비 요청을 보내지 못했습니다",
      localRevision: (moves, round) => `로컬 ${round}국 · ${moves}수`,
      onlineRevision: (moves, round) => `Relay ${round}국 · ${moves}수`,
      pendingMode: "플레이 방식 대기 중",
      rule: "자유 오프닝 · 렌주 금수 · 흑 장목·33·44 · 백은 5목 이상",
      rowColumn: (row, column) => `${row}행 ${column}열`,
      blackStone: " 흑돌",
      whiteStone: " 백돌",
      empty: " 빈 자리",
      foul: "금수에는 착수할 수 없습니다",
      stoneGuide: "돌 색 안내",
      boardRegion: "15 곱하기 15 오목판",
      boardLabel: "오목판",
    }),
    en: Object.freeze({
      name: "Omok",
      soundOn: "Sound on",
      soundOff: "Sound off",
      ready: "Preparing the game",
      wait: "Please wait a moment.",
      launcherTitle: "How would you like to play?",
      chooseMode: "Choose a play mode",
      chooseModeDetail: "Play together on one device or open an online room.",
      localTitle: "On one device",
      localDetail: "Two players take turns on the same screen.",
      onlineTitle: "Play online",
      onlineDetail: "Create a room or join with an invitation code.",
      playTitle: "Play",
      playDetail: "Start the game now.",
      localMode: "LOCAL MULTI",
      onlineMode: "ONLINE RELAY",
      reset: "New game",
      rematch: "Request rematch",
      rematchSent: "Waiting for rematch",
      black: "Black · first",
      white: "White",
      currentTurn: "Current turn",
      gameOver: "Game over",
      localBlack: "Stone to place · black",
      localWhite: "Stone to place · white",
      myBlack: "My stone · black",
      myWhite: "My stone · white",
      myBlackTurn: "My stone · black · your turn",
      myWhiteTurn: "My stone · white · your turn",
      myBlackWait: "My stone · black · opponent's turn",
      myWhiteWait: "My stone · white · opponent's turn",
      checkingStone: "Checking stone",
      blackTurn: "Black to move",
      whiteTurn: "White to move",
      blackWin: "Black wins",
      whiteWin: "White wins",
      draw: "Draw",
      localTurn: "Take turns on this device.",
      localFinished: "Use New game to play again on this screen.",
      connecting: "Connecting to Relay",
      connectingDetail: "Loading the match state.",
      yourTurn: "Your turn. Select an empty intersection.",
      opponentTurn: "Waiting for the opponent's move.",
      onlineFinished: "Request a rematch to start a new game.",
      opponentRematch: "Your opponent requested a rematch.",
      waitingRematch: "Waiting for the opponent's rematch response.",
      newRound: "A new game has started.",
      openingRoom: "Opening the online room screen",
      openingRoomDetail: "Create a room or join with a code.",
      modeFailed: "This play mode could not start",
      retryInside: "Try again from inside the game.",
      modeMissing: "Play modes could not be loaded",
      disconnected: "Connection lost",
      reconnect: "Reconnect from the OWOGG connection panel.",
      requestFailed: "The request could not be processed",
      relayClosed: "The online match has ended",
      readyFailed: "Relay could not be readied",
      localRevision: (moves, round) => `Local game ${round} · move ${moves}`,
      onlineRevision: (moves, round) => `Relay game ${round} · move ${moves}`,
      pendingMode: "Waiting for a play mode",
      rule: "Free opening · Renju fouls · black: overline/3×3/4×4 · white: 5+",
      rowColumn: (row, column) => `Row ${row}, column ${column}`,
      blackStone: " black stone",
      whiteStone: " white stone",
      empty: " empty",
      foul: "That forbidden move is not allowed",
      stoneGuide: "Stone color guide",
      boardRegion: "15 by 15 Omok board",
      boardLabel: "Omok board",
    }),
  });

  let locale = navigator.language.toLowerCase().startsWith("ko") ? "ko" : "en";
  let mode = "launcher";
  let state = rules.createState();
  let closed = false;
  let connected = false;
  let soundEnabled = true;
  let audioContext = null;

  function text() {
    return TEXT[locale];
  }

  function ensureAudio() {
    if (!soundEnabled) return null;
    audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === "suspended") void audioContext.resume();
    return audioContext;
  }

  function tone(frequency, duration = 0.08, volume = 0.035, type = "sine", delay = 0) {
    const context = ensureAudio();
    if (!context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const startsAt = context.currentTime + delay;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, startsAt);
    gain.gain.setValueAtTime(volume, startsAt);
    gain.gain.exponentialRampToValueAtTime(0.0001, startsAt + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(startsAt);
    oscillator.stop(startsAt + duration);
  }

  function playMoveSound(color) {
    tone(color === 1 ? 185 : 235, 0.075, 0.05, "sine");
    tone(color === 1 ? 110 : 145, 0.11, 0.025, "triangle", 0.025);
  }

  function playWinnerSound() {
    tone(392, 0.1, 0.04, "triangle");
    tone(523, 0.12, 0.04, "triangle", 0.09);
    tone(784, 0.18, 0.04, "triangle", 0.19);
  }

  function setStatus(title, detail) {
    statusTitle.textContent = title;
    statusDetail.textContent = detail;
  }

  function bootstrap() {
    return relay?.bootstrap ?? null;
  }

  function colorForSeat(seatIndex) {
    return seatIndex === 0 ? 1 : seatIndex === 1 ? 2 : 0;
  }

  function hostParticipantId() {
    return bootstrap()?.roster.find((participant) => participant.role === "HOST")?.participantId;
  }

  function selfColor() {
    return colorForSeat(bootstrap()?.self.seatIndex);
  }

  function resultText() {
    const copy = text();
    if (state.winner === 1) return copy.blackWin;
    if (state.winner === 2) return copy.whiteWin;
    if (state.winner === 3) return copy.draw;
    return state.turn === 1 ? copy.blackTurn : copy.whiteTurn;
  }

  function foulText(reason) {
    if (locale === "ko") return rules.FOUL_REASONS[reason] ?? rules.FOUL_REASONS.INVALID;
    const english = {
      OCCUPIED: "A stone is already on that intersection.",
      NOT_TURN: "Only the current player's stone may be placed.",
      OVERLINE: "Black may not make an overline of six or more stones.",
      DOUBLE_FOUR: "Black may not create two or more fours at once.",
      DOUBLE_THREE: "Black may not create two or more open threes at once.",
      FINISHED: "This game has already ended.",
      INVALID: "That move is not available.",
    };
    return english[reason] ?? english.INVALID;
  }

  function renderBadge() {
    const copy = text();
    if (mode === "launcher") {
      stoneBadge.classList.add("hidden");
      return;
    }
    stoneBadge.classList.remove("hidden");
    badgeStone.className = "stone";
    if (mode === "local") {
      badgeStone.classList.add(state.turn === 2 ? "white" : "black");
      stoneLabel.textContent =
        state.winner === 0 ? (state.turn === 1 ? copy.localBlack : copy.localWhite) : copy.gameOver;
      return;
    }
    const color = selfColor();
    badgeStone.classList.add(color === 2 ? "white" : color === 1 ? "black" : "neutral");
    if (color === 1) {
      stoneLabel.textContent =
        state.winner === 0
          ? state.turn === color
            ? copy.myBlackTurn
            : copy.myBlackWait
          : copy.myBlack;
    } else if (color === 2) {
      stoneLabel.textContent =
        state.winner === 0
          ? state.turn === color
            ? copy.myWhiteTurn
            : copy.myWhiteWait
          : copy.myWhite;
    } else {
      stoneLabel.textContent = copy.checkingStone;
    }
  }

  function renderStatus() {
    const copy = text();
    if (state.winner !== 0) {
      if (mode === "online") {
        const color = selfColor();
        const ownVote = color > 0 && state.rematchVotes[color - 1];
        const opponentVote = color > 0 && state.rematchVotes[color === 1 ? 1 : 0];
        setStatus(
          opponentVote && !ownVote ? copy.opponentRematch : resultText(),
          ownVote ? copy.waitingRematch : copy.onlineFinished,
        );
      } else {
        setStatus(resultText(), copy.localFinished);
      }
      return;
    }
    if (mode === "local") {
      setStatus(resultText(), copy.localTurn);
      return;
    }
    if (mode === "online") {
      const current = bootstrap();
      if (!current || !connected) {
        setStatus(copy.connecting, copy.connectingDetail);
        return;
      }
      setStatus(resultText(), selfColor() === state.turn ? copy.yourTurn : copy.opponentTurn);
    }
  }

  function renderBoard() {
    const online = mode === "online";
    const color = online ? selfColor() : 0;
    board.dataset.turn = state.turn === 2 ? "white" : "black";
    [...boardCells.children].forEach((cell, index) => {
      const value = state.board[index];
      cell.disabled =
        closed ||
        state.winner !== 0 ||
        value !== 0 ||
        (online && (color === 0 || color !== state.turn));
      cell.replaceChildren();
      const row = Math.floor(index / rules.SIZE) + 1;
      const column = (index % rules.SIZE) + 1;
      const copy = text();
      cell.setAttribute(
        "aria-label",
        `${copy.rowColumn(row, column)}${value === 1 ? copy.blackStone : value === 2 ? copy.whiteStone : copy.empty}`,
      );
      if (value === 0) return;
      const piece = document.createElement("span");
      piece.className = `piece ${value === 1 ? "black" : "white"}${index === state.lastMove ? " last" : ""}`;
      cell.appendChild(piece);
    });
  }

  function renderControls() {
    const copy = text();
    reset.textContent = copy.reset;
    reset.classList.toggle("hidden", mode !== "local");
    const showRematch = mode === "online" && state.winner !== 0;
    rematch.classList.toggle("hidden", !showRematch);
    const color = selfColor();
    const ownVote = color > 0 && state.rematchVotes[color - 1];
    rematch.disabled = Boolean(ownVote) || closed;
    rematch.textContent = ownVote ? copy.rematchSent : copy.rematch;
  }

  function render() {
    const copy = text();
    renderBadge();
    renderStatus();
    renderControls();
    blackLabel.classList.toggle("active", state.winner === 0 && state.turn === 1);
    whiteLabel.classList.toggle("active", state.winner === 0 && state.turn === 2);
    blackLabel.replaceChildren();
    whiteLabel.replaceChildren();
    const blackStone = document.createElement("i");
    blackStone.className = "stone black";
    const whiteStone = document.createElement("i");
    whiteStone.className = "stone white";
    blackLabel.append(blackStone, copy.black);
    whiteLabel.append(whiteStone, copy.white);
    revisionLabel.textContent =
      mode === "online"
        ? copy.onlineRevision(state.moves, state.round)
        : mode === "local"
          ? copy.localRevision(state.moves, state.round)
          : copy.pendingMode;
    renderBoard();
  }

  function adoptState(next, { silent = false } = {}) {
    const previous = state;
    state = next;
    if (!silent) {
      if (state.round !== previous.round) {
        tone(440, 0.1, 0.035, "triangle");
        tone(660, 0.13, 0.035, "triangle", 0.09);
      } else if (state.moves > previous.moves && state.lastMove >= 0) {
        playMoveSound(state.board[state.lastMove]);
      }
      if (previous.winner === 0 && state.winner !== 0) playWinnerSound();
    }
    render();
  }

  function openGame(nextMode) {
    mode = nextMode;
    launcher.classList.add("hidden");
    game.classList.remove("hidden");
    modeLabel.textContent = nextMode === "online" ? text().onlineMode : text().localMode;
    render();
  }

  function publishHostState() {
    const current = bootstrap();
    if (!current || current.self.role !== "HOST" || closed) return;
    relay.snapshot(state);
    relay.broadcast(state);
    render();
  }

  function rejectMove(reason, participantId) {
    tone(130, 0.18, 0.045, "sawtooth");
    if (participantId) {
      relay.direct(participantId, { protocol: rules.PROTOCOL, type: "move-rejected", reason });
    } else {
      setStatus(text().foul, foulText(reason));
    }
  }

  function acceptOnlineMove(index, senderSeatIndex, senderParticipantId) {
    const current = bootstrap();
    if (!current || current.self.role !== "HOST") return;
    const color = colorForSeat(senderSeatIndex);
    const inspection = rules.inspectMove(state, index, color);
    if (!inspection.legal) {
      rejectMove(inspection.reason, senderParticipantId);
      return;
    }
    const next = rules.applyMove(state, index, color);
    if (!next) return;
    adoptState(next);
    publishHostState();
  }

  function playAt(index) {
    ensureAudio();
    if (mode === "local") {
      const inspection = rules.inspectMove(state, index, state.turn);
      if (!inspection.legal) {
        rejectMove(inspection.reason);
        return;
      }
      const next = rules.applyMove(state, index, state.turn);
      if (next) adoptState(next);
      return;
    }
    const current = bootstrap();
    if (!current) return;
    const color = colorForSeat(current.self.seatIndex);
    const inspection = rules.inspectMove(state, index, color);
    if (!inspection.legal) {
      rejectMove(inspection.reason);
      return;
    }
    if (current.self.role === "HOST") {
      acceptOnlineMove(index, current.self.seatIndex);
      return;
    }
    const hostId = hostParticipantId();
    if (hostId) relay.direct(hostId, { protocol: rules.PROTOCOL, type: "move-intent", index });
  }

  function createBoard() {
    const namespace = "http://www.w3.org/2000/svg";
    const gridNodes = [];
    for (let offset = 0; offset <= 140; offset += 10) {
      const horizontal = document.createElementNS(namespace, "line");
      horizontal.setAttribute("x1", "0");
      horizontal.setAttribute("y1", String(offset));
      horizontal.setAttribute("x2", "140");
      horizontal.setAttribute("y2", String(offset));
      const vertical = document.createElementNS(namespace, "line");
      vertical.setAttribute("x1", String(offset));
      vertical.setAttribute("y1", "0");
      vertical.setAttribute("x2", String(offset));
      vertical.setAttribute("y2", "140");
      gridNodes.push(horizontal, vertical);
    }
    for (const [x, y] of [
      [30, 30],
      [110, 30],
      [70, 70],
      [30, 110],
      [110, 110],
    ]) {
      const star = document.createElementNS(namespace, "circle");
      star.setAttribute("cx", String(x));
      star.setAttribute("cy", String(y));
      star.setAttribute("r", "2.2");
      gridNodes.push(star);
    }
    boardGrid.replaceChildren(...gridNodes);
    boardCells.replaceChildren(
      ...Array.from({ length: rules.SIZE * rules.SIZE }, (_, index) => {
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "cell";
        cell.setAttribute("role", "gridcell");
        cell.addEventListener("click", () => playAt(index));
        return cell;
      }),
    );
  }

  function modeCopy(playMode) {
    const copy = text();
    if (playMode === "local-multi") return { title: copy.localTitle, detail: copy.localDetail };
    if (playMode === "online-multi") {
      return { title: copy.onlineTitle, detail: copy.onlineDetail };
    }
    return { title: copy.playTitle, detail: copy.playDetail };
  }

  async function selectMode(playMode) {
    ensureAudio();
    modeOptions.querySelectorAll("button").forEach((button) => {
      button.disabled = true;
    });
    try {
      if (api.playModes.length > 1) await api.selectPlayMode(playMode);
      if (playMode === "local-multi") {
        state = rules.createState();
        api.start();
        openGame("local");
      } else {
        setStatus(text().openingRoom, text().openingRoomDetail);
      }
    } catch {
      setStatus(text().modeFailed, text().retryInside);
      modeOptions.querySelectorAll("button").forEach((button) => {
        button.disabled = false;
      });
    }
  }

  function renderLauncher() {
    const modes = api.playModes;
    if (modes.length === 0) {
      setStatus(text().modeMissing, text().retryInside);
      return;
    }
    if (modes.length === 1) {
      void selectMode(modes[0]);
      return;
    }
    modeOptions.replaceChildren(
      ...modes.map((playMode) => {
        const copy = modeCopy(playMode);
        const button = document.createElement("button");
        button.type = "button";
        const title = document.createElement("strong");
        const detail = document.createElement("span");
        title.textContent = copy.title;
        detail.textContent = copy.detail;
        button.append(title, detail);
        button.addEventListener("click", () => void selectMode(playMode));
        return button;
      }),
    );
    launcher.classList.remove("hidden");
    setStatus(text().chooseMode, text().chooseModeDetail);
  }

  function acceptRematch(color) {
    const next = rules.requestRematch(state, color);
    if (!next) return;
    adoptState(next);
    publishHostState();
  }

  function requestOnlineRematch() {
    ensureAudio();
    const current = bootstrap();
    if (!current || state.winner === 0) return;
    if (current.self.role === "HOST") {
      acceptRematch(colorForSeat(current.self.seatIndex));
      return;
    }
    const hostId = hostParticipantId();
    if (hostId) relay.direct(hostId, { protocol: rules.PROTOCOL, type: "rematch-intent" });
  }

  function connectRelay() {
    openGame("online");
    relay.subscribe((message) => {
      const current = bootstrap();
      if (!current) return;
      if (message.type === "MULTI_CONNECTED") {
        connected = true;
        closed = false;
        render();
        return;
      }
      if (message.type === "MULTI_DISCONNECTED") {
        connected = false;
        setStatus(text().disconnected, text().reconnect);
        return;
      }
      if (message.type === "RELAY_SYNC") {
        const restored = rules.parseState(message.snapshot?.payload);
        if (restored) {
          adoptState(restored, { silent: true });
          if (current.self.role === "HOST") relay.broadcast(state);
        } else if (current.self.role === "HOST") {
          state = rules.createState();
          publishHostState();
        }
        return;
      }
      if (message.type === "RELAY_MESSAGE") {
        const payload = message.payload;
        if (
          !payload ||
          typeof payload !== "object" ||
          Array.isArray(payload) ||
          payload.protocol !== rules.PROTOCOL
        )
          return;
        if (payload.type === "state" && message.sender.role === "HOST") {
          const received = rules.parseState(payload);
          if (received && received.revision >= state.revision) adoptState(received);
        } else if (
          payload.type === "move-intent" &&
          current.self.role === "HOST" &&
          message.delivery === "direct" &&
          Number.isSafeInteger(payload.index)
        ) {
          acceptOnlineMove(payload.index, message.sender.seatIndex, message.sender.participantId);
        } else if (
          payload.type === "rematch-intent" &&
          current.self.role === "HOST" &&
          message.delivery === "direct"
        ) {
          acceptRematch(colorForSeat(message.sender.seatIndex));
        } else if (
          payload.type === "move-rejected" &&
          message.sender.role === "HOST" &&
          message.delivery === "direct" &&
          typeof payload.reason === "string"
        ) {
          rejectMove(payload.reason);
        }
        return;
      }
      if (message.type === "RELAY_REJECTED") {
        setStatus(text().requestFailed, `Relay: ${message.code}`);
        return;
      }
      if (message.type === "RELAY_CLOSED") {
        closed = true;
        setStatus(text().relayClosed, `Relay: ${message.code}`);
        renderBoard();
      }
    });
    if (!relay.ready()) setStatus(text().readyFailed, text().retryInside);
  }

  function renderLocale() {
    const copy = text();
    document.documentElement.lang = locale;
    document.title = copy.name;
    gameName.textContent = copy.name;
    launcherTitle.textContent = copy.launcherTitle;
    languageToggle.textContent = locale === "ko" ? "English" : "한국어";
    soundToggle.textContent = soundEnabled ? copy.soundOn : copy.soundOff;
    soundToggle.setAttribute("aria-pressed", String(soundEnabled));
    ruleLabel.textContent = copy.rule;
    revisionLabel.textContent = copy.pendingMode;
    turns.setAttribute("aria-label", copy.stoneGuide);
    boardWrap.setAttribute("aria-label", copy.boardRegion);
    boardCells.setAttribute("aria-label", copy.boardLabel);
    if (mode === "launcher" && api?.playModes?.length > 1) renderLauncher();
    else {
      modeLabel.textContent = mode === "online" ? copy.onlineMode : copy.localMode;
      render();
    }
  }

  async function initialize() {
    createBoard();
    setStatus(text().ready, text().wait);
    renderLocale();
    if (!api?.whenReady) return;
    await api.whenReady();
    if (relay?.bootstrap) connectRelay();
    else renderLauncher();
  }

  reset.addEventListener("click", () => {
    if (mode !== "local") return;
    ensureAudio();
    const round = state.round >= rules.MAX_ROUND ? 1 : state.round + 1;
    adoptState(rules.createState(round, state.revision + 1));
  });
  rematch.addEventListener("click", requestOnlineRematch);
  soundToggle.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    renderLocale();
    if (soundEnabled) tone(620, 0.08, 0.03, "triangle");
  });
  languageToggle.addEventListener("click", () => {
    locale = locale === "ko" ? "en" : "ko";
    renderLocale();
  });
  void initialize();
})();
