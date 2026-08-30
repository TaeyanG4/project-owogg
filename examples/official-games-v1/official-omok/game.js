(() => {
  "use strict";

  const rules = window.OwoggOmokRules;
  const api = window.OWOGG;
  const relay = api?.multiplayer;
  const status = document.querySelector("#status");
  const launcher = document.querySelector("#launcher");
  const game = document.querySelector("#game");
  const board = document.querySelector("#board");
  const localMode = document.querySelector("#local-mode");
  const onlineMode = document.querySelector("#online-mode");
  const reset = document.querySelector("#reset");
  const leave = document.querySelector("#leave");
  const modeLabel = document.querySelector("#mode-label");
  const blackLabel = document.querySelector("#black-label");
  const whiteLabel = document.querySelector("#white-label");

  let mode = "launcher";
  let state = rules.createState();
  let closed = false;

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
    if (state.winner === 1) return "흑이 승리했습니다.";
    if (state.winner === 2) return "백이 승리했습니다.";
    if (state.winner === 3) return "빈자리가 없어 무승부입니다.";
    return state.turn === 1 ? "흑 차례입니다." : "백 차례입니다.";
  }

  function render() {
    const online = mode === "online";
    const selfColor = online ? colorForSeat(bootstrap()?.self.seatIndex) : 0;
    status.textContent =
      online && bootstrap()
        ? `${resultText()} · 내 돌: ${selfColor === 1 ? "흑" : "백"}`
        : resultText();
    blackLabel.classList.toggle("active", state.turn === 1);
    whiteLabel.classList.toggle("active", state.turn === 2);
    [...board.children].forEach((cell, index) => {
      cell.className = `cell${state.board[index] === 1 ? " black" : state.board[index] === 2 ? " white" : ""}`;
      cell.disabled =
        closed ||
        state.winner !== 0 ||
        state.board[index] !== 0 ||
        (online && selfColor !== state.turn);
      cell.setAttribute(
        "aria-label",
        `${Math.floor(index / rules.SIZE) + 1}행 ${(index % rules.SIZE) + 1}열${state.board[index] === 1 ? " 흑돌" : state.board[index] === 2 ? " 백돌" : " 빈칸"}`,
      );
    });
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

  async function selectMode(playMode) {
    localMode.disabled = true;
    onlineMode.disabled = true;
    try {
      if (api?.selectPlayMode) await api.selectPlayMode(playMode);
      if (playMode === "local-multi") {
        state = rules.createState();
        api?.start();
        openGame("local");
      } else {
        status.textContent = "온라인 방 선택 화면을 여는 중입니다…";
      }
    } catch {
      status.textContent = "이 플레이 방식을 시작할 수 없습니다. 게임을 다시 열어 주세요.";
      localMode.disabled = false;
      onlineMode.disabled = false;
    }
  }

  localMode.addEventListener("click", () => void selectMode("local-multi"));
  onlineMode.addEventListener("click", () => void selectMode("online-multi"));
  reset.addEventListener("click", () => {
    if (mode === "local") {
      state = rules.createState();
      render();
    }
  });
  leave.addEventListener("click", () => {
    closed = true;
    relay?.leave();
    status.textContent = "방을 나가는 중입니다…";
    render();
  });

  if (relay?.bootstrap) {
    openGame("online");
    relay.subscribe((message) => {
      const current = bootstrap();
      if (!current) return;
      if (message.type === "MULTI_CONNECTED") {
        closed = false;
        render();
        return;
      }
      if (message.type === "MULTI_DISCONNECTED") {
        status.textContent = `연결이 끊겼습니다: ${message.code}`;
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
        status.textContent = `요청이 거부됐습니다: ${message.code}`;
        return;
      }
      if (message.type === "RELAY_CLOSED") {
        closed = true;
        status.textContent = `대전이 종료됐습니다: ${message.code}`;
        render();
      }
    });
    if (!relay.ready()) status.textContent = "Relay 준비 요청을 보낼 수 없습니다.";
  } else {
    render();
  }
})();
