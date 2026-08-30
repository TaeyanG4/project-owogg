(() => {
  "use strict";

  const rules = window.OwoggOmokRules;
  const api = window.OWOGG;
  const relay = api?.multiplayer;
  const statusTitle = document.querySelector("#status-title");
  const statusDetail = document.querySelector("#status-detail");
  const launcher = document.querySelector("#launcher");
  const modeOptions = document.querySelector("#mode-options");
  const game = document.querySelector("#game");
  const board = document.querySelector("#board");
  const reset = document.querySelector("#reset");
  const leave = document.querySelector("#leave");
  const modeLabel = document.querySelector("#mode-label");
  const blackLabel = document.querySelector("#black-label");
  const whiteLabel = document.querySelector("#white-label");
  const stoneBadge = document.querySelector("#stone-badge");
  const badgeStone = document.querySelector("#badge-stone");
  const stoneLabel = document.querySelector("#stone-label");
  const revisionLabel = document.querySelector("#revision-label");

  let mode = "launcher";
  let state = rules.createState();
  let closed = false;
  let connected = false;

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

  function resultText() {
    if (state.winner === 1) return "흑이 승리했습니다";
    if (state.winner === 2) return "백이 승리했습니다";
    if (state.winner === 3) return "무승부입니다";
    return state.turn === 1 ? "흑 차례입니다" : "백 차례입니다";
  }

  function renderBadge() {
    if (mode === "launcher") {
      stoneBadge.classList.add("hidden");
      return;
    }
    stoneBadge.classList.remove("hidden");
    badgeStone.className = "stone";
    if (mode === "local") {
      badgeStone.classList.add(state.turn === 2 ? "white" : "black");
      stoneLabel.textContent = state.winner === 0 ? "현재 차례" : "대전 종료";
      return;
    }
    const selfColor = colorForSeat(bootstrap()?.self.seatIndex);
    badgeStone.classList.add(selfColor === 2 ? "white" : selfColor === 1 ? "black" : "neutral");
    stoneLabel.textContent =
      selfColor === 1 ? "내 돌 · 흑" : selfColor === 2 ? "내 돌 · 백" : "돌 확인 중";
  }

  function renderStatus() {
    if (state.winner !== 0) {
      setStatus(
        resultText(),
        mode === "online"
          ? "온라인 대전이 종료됐습니다."
          : "다시 두기로 새 판을 시작할 수 있습니다.",
      );
      return;
    }
    if (mode === "local") {
      setStatus(resultText(), "두 사람이 같은 기기에서 번갈아 착수하세요.");
      return;
    }
    if (mode === "online") {
      const current = bootstrap();
      if (!current || !connected) {
        setStatus("Relay에 연결하는 중입니다", "잠시 후 대전 상태를 불러옵니다.");
        return;
      }
      const selfColor = colorForSeat(current.self.seatIndex);
      setStatus(
        resultText(),
        selfColor === state.turn
          ? "내 차례입니다. 빈 교차점을 선택하세요."
          : "상대의 착수를 기다리고 있습니다.",
      );
    }
  }

  function renderBoard() {
    const online = mode === "online";
    const selfColor = online ? colorForSeat(bootstrap()?.self.seatIndex) : 0;
    [...board.children].forEach((cell, index) => {
      const value = state.board[index];
      cell.disabled =
        closed ||
        state.winner !== 0 ||
        value !== 0 ||
        (online && (selfColor === 0 || selfColor !== state.turn));
      cell.replaceChildren();
      const row = Math.floor(index / rules.SIZE) + 1;
      const column = (index % rules.SIZE) + 1;
      cell.setAttribute(
        "aria-label",
        `${row}행 ${column}열${value === 1 ? " 흑돌" : value === 2 ? " 백돌" : " 빈 자리"}`,
      );
      if (value === 0) return;
      const piece = document.createElement("span");
      piece.className = `piece ${value === 1 ? "black" : "white"}`;
      cell.appendChild(piece);
    });
  }

  function render() {
    renderBadge();
    renderStatus();
    blackLabel.classList.toggle("active", state.winner === 0 && state.turn === 1);
    whiteLabel.classList.toggle("active", state.winner === 0 && state.turn === 2);
    revisionLabel.textContent =
      mode === "online"
        ? `Relay 상태 · ${Math.max(0, state.revision - 1)}수`
        : mode === "local"
          ? `로컬 상태 · ${state.moves}수`
          : "플레이 방식 대기 중";
    renderBoard();
  }

  function openGame(nextMode) {
    mode = nextMode;
    launcher.classList.add("hidden");
    game.classList.remove("hidden");
    modeLabel.textContent = nextMode === "online" ? "ONLINE RELAY" : "LOCAL MULTI";
    reset.classList.toggle("hidden", nextMode === "online");
    leave.classList.toggle("hidden", nextMode !== "online");
    render();
  }

  function publishHostState() {
    const current = bootstrap();
    if (!current || current.self.role !== "HOST" || closed) return;
    relay.snapshot(state);
    relay.broadcast(state);
    render();
  }

  function acceptOnlineMove(index, senderSeatIndex) {
    const current = bootstrap();
    if (!current || current.self.role !== "HOST") return;
    const color = colorForSeat(senderSeatIndex);
    const next = rules.applyMove(state, index, color);
    if (!next) return;
    state = next;
    publishHostState();
  }

  function playAt(index) {
    if (mode === "local") {
      const next = rules.applyMove(state, index, state.turn);
      if (next) {
        state = next;
        render();
      }
      return;
    }
    const current = bootstrap();
    if (!current) return;
    if (current.self.role === "HOST") {
      acceptOnlineMove(index, current.self.seatIndex);
      return;
    }
    const hostId = hostParticipantId();
    if (hostId) relay.direct(hostId, { protocol: rules.PROTOCOL, type: "move-intent", index });
  }

  function createBoard() {
    board.replaceChildren(
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
    if (playMode === "local-multi") {
      return { title: "한 기기에서", detail: "두 사람이 같은 화면에서 번갈아 착수합니다." };
    }
    if (playMode === "online-multi") {
      return { title: "온라인에서", detail: "방을 만들거나 초대 코드로 참가합니다." };
    }
    return { title: "플레이", detail: "게임을 바로 시작합니다." };
  }

  async function selectMode(playMode) {
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
        setStatus("온라인 방 선택 화면을 여는 중입니다", "방을 만들거나 받은 코드로 참가하세요.");
      }
    } catch {
      setStatus("이 플레이 방식을 시작할 수 없습니다", "페이지를 새로고침해 다시 시도해 주세요.");
      modeOptions.querySelectorAll("button").forEach((button) => {
        button.disabled = false;
      });
    }
  }

  function renderLauncher() {
    const modes = api.playModes;
    if (modes.length === 0) {
      setStatus("플레이 방식을 불러오지 못했습니다", "페이지를 새로고침해 주세요.");
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
    setStatus("플레이 방식을 선택하세요", "로컬 대전과 온라인 대전 중 원하는 방식을 고르세요.");
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
        setStatus("연결이 끊겼습니다", "OWOGG 연결 패널에서 재연결할 수 있습니다.");
        return;
      }
      if (message.type === "RELAY_SYNC") {
        const restored = rules.parseState(message.snapshot?.payload);
        if (restored) {
          state = restored;
          render();
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
          if (received && received.revision >= state.revision) {
            state = received;
            render();
          }
        } else if (
          payload.type === "move-intent" &&
          current.self.role === "HOST" &&
          message.delivery === "direct" &&
          Number.isSafeInteger(payload.index)
        ) {
          acceptOnlineMove(payload.index, message.sender.seatIndex);
        }
        return;
      }
      if (message.type === "RELAY_REJECTED") {
        setStatus("요청을 처리하지 못했습니다", `Relay 응답: ${message.code}`);
        return;
      }
      if (message.type === "RELAY_CLOSED") {
        closed = true;
        setStatus("온라인 대전이 종료됐습니다", `Relay 응답: ${message.code}`);
        renderBoard();
      }
    });
    if (!relay.ready())
      setStatus("Relay 준비 요청을 보내지 못했습니다", "페이지를 새로고침해 주세요.");
  }

  async function initialize() {
    createBoard();
    render();
    if (!api?.whenReady) return;
    await api.whenReady();
    if (relay?.bootstrap) connectRelay();
    else renderLauncher();
  }

  reset.addEventListener("click", () => {
    if (mode === "local") {
      state = rules.createState();
      render();
    }
  });
  leave.addEventListener("click", () => {
    closed = true;
    relay?.leave();
    setStatus("방을 나가는 중입니다", "잠시만 기다려 주세요.");
    renderBoard();
  });
  void initialize();
})();
