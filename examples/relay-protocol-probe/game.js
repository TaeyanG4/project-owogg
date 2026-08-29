(() => {
  "use strict";

  const relay = window.OWOGG?.multiplayer;
  const status = document.querySelector("#status");
  const identity = document.querySelector("#identity");
  const counter = document.querySelector("#counter");
  const roster = document.querySelector("#roster");
  const log = document.querySelector("#log");
  const increment = document.querySelector("#increment");
  const direct = document.querySelector("#direct");
  const snapshot = document.querySelector("#snapshot");
  const leave = document.querySelector("#leave");

  let counterValue = 0;
  let revision = 0;
  let closed = false;

  function appendLog(message) {
    const row = document.createElement("li");
    row.textContent = message;
    log.prepend(row);
    while (log.children.length > 24) log.lastElementChild?.remove();
  }

  function setCounter(value, nextRevision) {
    if (!Number.isSafeInteger(value) || !Number.isSafeInteger(nextRevision)) return;
    if (value < 0 || value > 1_000_000 || nextRevision < revision) return;
    counterValue = value;
    revision = nextRevision;
    counter.textContent = String(counterValue);
  }

  function renderBootstrap() {
    const bootstrap = relay?.bootstrap;
    if (!bootstrap) return null;
    identity.textContent = `seat ${bootstrap.self.seatIndex} · ${bootstrap.self.role} · generation ${bootstrap.generation}`;
    roster.replaceChildren(
      ...bootstrap.roster.map((participant) => {
        const row = document.createElement("li");
        row.textContent = `seat ${participant.seatIndex} · ${participant.role} · ${participant.participantId}`;
        return row;
      }),
    );
    snapshot.disabled = bootstrap.self.role !== "HOST" || !bootstrap.capabilities.hostSnapshot;
    direct.disabled = !bootstrap.capabilities.directMessages;
    return bootstrap;
  }

  function publishHostState(reason) {
    const bootstrap = renderBootstrap();
    if (!bootstrap || bootstrap.self.role !== "HOST" || closed) return;
    revision += 1;
    const state = {
      protocol: "relay-probe/v1",
      type: "probe-state",
      revision,
      counter: counterValue,
      reason,
    };
    relay.snapshot(state);
    relay.broadcast(state);
    setCounter(counterValue, revision);
    appendLog(`host state r${revision}: ${counterValue} (${reason})`);
  }

  function isProbePayload(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  if (!relay) {
    status.textContent = "OWOGG Relay runtime에서만 실행할 수 있습니다.";
    for (const button of document.querySelectorAll("button")) button.disabled = true;
    return;
  }

  relay.subscribe((message) => {
    const bootstrap = renderBootstrap();
    if (!bootstrap) return;

    if (message.type === "MULTI_CONNECTED") {
      status.textContent = `Relay 연결됨 · ${bootstrap.roster.length}명`;
      appendLog(`connected: generation ${bootstrap.generation}`);
      return;
    }
    if (message.type === "RELAY_SYNC") {
      const payload = message.snapshot?.payload;
      if (
        isProbePayload(payload) &&
        payload.protocol === "relay-probe/v1" &&
        payload.type === "probe-state"
      ) {
        setCounter(payload.counter, payload.revision);
        appendLog(`snapshot restored: r${payload.revision}`);
      } else if (bootstrap.self.role === "HOST") {
        publishHostState("initial-sync");
      }
      return;
    }
    if (message.type === "RELAY_MESSAGE") {
      const payload = message.payload;
      if (!isProbePayload(payload) || payload.protocol !== "relay-probe/v1") return;
      if (payload.type === "probe-intent" && bootstrap.self.role === "HOST") {
        if (payload.action === "increment") {
          counterValue = Math.min(counterValue + 1, 1_000_000);
          publishHostState(`intent-from-seat-${message.sender.seatIndex}`);
        }
      } else if (payload.type === "probe-state" && message.sender.role === "HOST") {
        setCounter(payload.counter, payload.revision);
        appendLog(`state from host: r${payload.revision}`);
      } else if (payload.type === "probe-ping") {
        appendLog(`direct ping from seat ${message.sender.seatIndex}`);
      }
      return;
    }
    if (message.type === "RELAY_REJECTED") {
      appendLog(`rejected: ${message.code}`);
      return;
    }
    if (message.type === "RELAY_CLOSED") {
      closed = true;
      status.textContent = `Relay 종료: ${message.code}`;
      appendLog(`closed: ${message.code}`);
      for (const button of document.querySelectorAll("button")) button.disabled = true;
    }
  });

  increment.addEventListener("click", () => {
    relay.broadcast({
      protocol: "relay-probe/v1",
      type: "probe-intent",
      action: "increment",
    });
  });

  direct.addEventListener("click", () => {
    const bootstrap = renderBootstrap();
    const target = bootstrap?.roster.find(
      (participant) => participant.participantId !== bootstrap.self.participantId,
    );
    if (!target) return;
    relay.direct(target.participantId, {
      protocol: "relay-probe/v1",
      type: "probe-ping",
      sentAt: Date.now(),
    });
  });

  snapshot.addEventListener("click", () => publishHostState("manual-snapshot"));
  leave.addEventListener("click", () => {
    closed = true;
    relay.leave();
    status.textContent = "방을 나가는 중…";
  });

  if (!relay.ready()) status.textContent = "Relay ready 요청을 보낼 수 없습니다.";
})();
