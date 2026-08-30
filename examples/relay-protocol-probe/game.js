(() => {
  "use strict";

  const relay = window.OWOGG?.multiplayer;
  const loadProtocol = window.RelayProbeLoadProtocol;
  const status = document.querySelector("#status");
  const identity = document.querySelector("#identity");
  const counter = document.querySelector("#counter");
  const roster = document.querySelector("#roster");
  const log = document.querySelector("#log");
  const increment = document.querySelector("#increment");
  const direct = document.querySelector("#direct");
  const snapshot = document.querySelector("#snapshot");
  const leave = document.querySelector("#leave");
  const loadStatus = document.querySelector("#load-status");
  const loadRate = document.querySelector("#load-rate");
  const loadDuration = document.querySelector("#load-duration");
  const loadPayload = document.querySelector("#load-payload");
  const loadStart = document.querySelector("#load-start");
  const loadStop = document.querySelector("#load-stop");
  const idleStart = document.querySelector("#idle-start");
  const loadResults = document.querySelector("#load-results");
  const idleResults = document.querySelector("#idle-results");

  const START_DELAY_MS = 3_000;
  const REPORT_COOLDOWN_MS = 1_500;
  const REPORT_TIMEOUT_MS = 10_000;
  const READY_TIMEOUT_MS = 10_000;
  const MANUAL_STOP_QUIET_MS = 1_050;
  let counterValue = 0;
  let revision = 0;
  let closed = false;
  let loadRun = null;
  let idleRun = null;

  function appendLog(message) {
    const row = document.createElement("li");
    row.textContent = message;
    log.prepend(row);
    while (log.children.length > 36) log.lastElementChild?.remove();
  }

  function setCounter(value, nextRevision) {
    if (!Number.isSafeInteger(value) || !Number.isSafeInteger(nextRevision)) return;
    if (value < 0 || value > 1_000_000 || nextRevision < revision) return;
    counterValue = value;
    revision = nextRevision;
    counter.textContent = String(counterValue);
  }

  function loadIsBusy() {
    return Boolean(loadRun && !["complete", "stopped"].includes(loadRun.phase));
  }

  function idleIsBusy() {
    return Boolean(idleRun && !["complete", "stopped"].includes(idleRun.phase));
  }

  function renderControls(bootstrap = relay?.bootstrap) {
    const host = bootstrap?.self.role === "HOST";
    const busy = loadIsBusy() || idleIsBusy();
    const disabled = closed || !bootstrap;
    increment.disabled = disabled || busy;
    direct.disabled = disabled || busy || !bootstrap?.capabilities.directMessages;
    snapshot.disabled = disabled || busy || !host || !bootstrap?.capabilities.hostSnapshot;
    leave.disabled = disabled;
    for (const select of [loadRate, loadDuration, loadPayload]) {
      select.disabled = disabled || !host || busy;
    }
    loadStart.disabled = disabled || !host || busy;
    idleStart.disabled = disabled || !host || busy;
    loadStop.disabled =
      disabled ||
      !host ||
      !loadRun ||
      !["planning", "scheduled", "running"].includes(loadRun.phase);
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
    renderControls(bootstrap);
    return bootstrap;
  }

  function publishHostState(reason) {
    const bootstrap = renderBootstrap();
    if (!bootstrap || bootstrap.self.role !== "HOST" || closed || loadIsBusy() || idleIsBusy()) {
      return;
    }
    revision += 1;
    const state = {
      protocol: "relay-probe/v1",
      type: "probe-state",
      revision,
      counter: counterValue,
      reason,
    };
    const snapshotPosted = relay.snapshot(state);
    const broadcastPosted = relay.broadcast(state);
    setCounter(counterValue, revision);
    appendLog(
      `host state r${revision}: ${counterValue} (${reason}, snapshot=${snapshotPosted}, broadcast=${broadcastPosted})`,
    );
  }

  function isProbePayload(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function createRunId(prefix) {
    const random =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
    return `${prefix}-${random}`;
  }

  function expectedSeats() {
    return [...(relay?.bootstrap?.roster ?? [])]
      .map((participant) => participant.seatIndex)
      .sort((left, right) => left - right);
  }

  function hostParticipantId() {
    return relay?.bootstrap?.roster.find((participant) => participant.role === "HOST")
      ?.participantId;
  }

  function isExpectedSeat(run, seatIndex) {
    return run.expectedSeats.includes(seatIndex);
  }

  function allExpectedSeatsReported(run) {
    return run.expectedSeats.every((seatIndex) => run.reports.has(seatIndex));
  }

  function clearLoadTimers(run) {
    for (const key of [
      "readyTimer",
      "scheduleTimer",
      "reportTimer",
      "reportDeadlineTimer",
      "manualStopTimer",
    ]) {
      if (run[key] !== null) {
        window.clearTimeout(run[key]);
        run[key] = null;
      }
    }
  }

  function newLoadRun(plan) {
    const seats = expectedSeats();
    return {
      plan,
      expectedSeats: seats,
      expectedPerSeat: loadProtocol.expectedSamples(plan.rateHz, plan.durationMs),
      readySeats: new Set(),
      readySent: false,
      phase: "planning",
      startAt: 0,
      endAt: 0,
      nextSampleIndex: 0,
      attemptedSamples: 0,
      postedSamples: 0,
      postFailures: 0,
      schedulerSkipped: 0,
      rejected: 0,
      receivedBySeat: new Map(seats.map((seatIndex) => [seatIndex, new Set()])),
      duplicateSamples: 0,
      serverSeqGaps: 0,
      lastSampleServerSeq: null,
      selfLatencies: [],
      reports: new Map(),
      readyTimer: null,
      scheduleTimer: null,
      reportTimer: null,
      reportDeadlineTimer: null,
      manualStopTimer: null,
    };
  }

  function renderLoadReports() {
    const run = loadRun;
    if (!run || run.reports.size === 0) {
      loadResults.innerHTML = '<tr><td colspan="8">아직 실행 결과가 없습니다.</td></tr>';
      return;
    }
    const totalExpected = run.expectedPerSeat * run.expectedSeats.length;
    loadResults.replaceChildren(
      ...[...run.reports.entries()]
        .sort(([left], [right]) => left - right)
        .map(([seatIndex, report]) => {
          const row = document.createElement("tr");
          const values = [
            String(seatIndex),
            `${report.postedSamples}/${report.expectedSamples}`,
            `${report.receivedTotal}/${totalExpected}`,
            String(report.rejected),
            String(report.duplicateSamples),
            String(report.serverSeqGaps),
            `${report.selfLatency.p95}ms`,
            `${report.selfLatency.p99}ms`,
          ];
          row.replaceChildren(
            ...values.map((value) => {
              const cell = document.createElement("td");
              cell.textContent = value;
              return cell;
            }),
          );
          return row;
        }),
    );
  }

  function loadReportPayload(run) {
    return {
      protocol: loadProtocol.LOAD_PROTOCOL,
      type: "load-report",
      runId: run.plan.runId,
      expectedSamples: run.expectedPerSeat,
      attemptedSamples: run.attemptedSamples,
      postedSamples: run.postedSamples,
      postFailures: run.postFailures,
      schedulerSkipped: run.schedulerSkipped,
      rejected: run.rejected,
      receivedTotal: [...run.receivedBySeat.values()].reduce(
        (total, samples) => total + samples.size,
        0,
      ),
      duplicateSamples: run.duplicateSamples,
      serverSeqGaps: run.serverSeqGaps,
      receivedBySeat: [...run.receivedBySeat.entries()]
        .sort(([left], [right]) => left - right)
        .map(([seatIndex, samples]) => ({ seatIndex, uniqueSamples: samples.size })),
      selfLatency: loadProtocol.summarizeLatencies(run.selfLatencies),
    };
  }

  function completeLoadReportsIfReady(run) {
    const bootstrap = renderBootstrap();
    if (loadRun !== run || bootstrap?.self.role !== "HOST" || !allExpectedSeatsReported(run)) {
      return;
    }
    if (run.reportDeadlineTimer !== null) {
      window.clearTimeout(run.reportDeadlineTimer);
      run.reportDeadlineTimer = null;
    }
    run.phase = "complete";
    loadStatus.textContent = `완료 · ${run.reports.size}/${run.expectedSeats.length}개 실제 계정 보고 수집`;
    appendLog(`load complete: ${run.plan.runId}`);
    renderControls(bootstrap);
  }

  function sendLoadReport(run) {
    if (loadRun !== run || !["cooldown", "reporting"].includes(run.phase)) return;
    const bootstrap = renderBootstrap();
    if (!bootstrap) return;
    const report = loadReportPayload(run);
    run.reports.set(bootstrap.self.seatIndex, report);
    renderLoadReports();
    if (bootstrap.self.role === "HOST") {
      run.phase = "reporting";
      loadStatus.textContent = `결과 수집 중 · ${run.reports.size}/${run.expectedSeats.length}`;
      if (run.reportDeadlineTimer === null) {
        run.reportDeadlineTimer = window.setTimeout(() => {
          if (loadRun !== run || run.phase !== "reporting") return;
          run.phase = "complete";
          const missing = run.expectedSeats.filter((seatIndex) => !run.reports.has(seatIndex));
          loadStatus.textContent = `결과 수집 종료 · 누락 좌석: ${missing.join(", ") || "없음"}`;
          renderControls();
        }, REPORT_TIMEOUT_MS);
      }
      completeLoadReportsIfReady(run);
      return;
    }
    const hostId = hostParticipantId();
    const posted = Boolean(hostId && relay.direct(hostId, report));
    run.phase = "complete";
    loadStatus.textContent = posted
      ? "로컬 결과를 Host에게 전송했습니다."
      : "로컬 결과 전송에 실패했습니다.";
    renderControls(bootstrap);
  }

  function finishLoad(run, reason) {
    if (loadRun !== run || ["cooldown", "reporting", "complete", "stopped"].includes(run.phase)) {
      return;
    }
    if (run.scheduleTimer !== null) {
      window.clearTimeout(run.scheduleTimer);
      run.scheduleTimer = null;
    }
    if (reason !== "host-stop" && run.nextSampleIndex < run.expectedPerSeat) {
      run.schedulerSkipped += run.expectedPerSeat - run.nextSampleIndex;
      run.nextSampleIndex = run.expectedPerSeat;
    }
    run.phase = "cooldown";
    loadStatus.textContent =
      reason === "host-stop"
        ? "Host 중지 · 마지막 broadcast 수신 대기 중…"
        : "부하 종료 · 마지막 broadcast 수신 대기 중…";
    appendLog(
      `load ${reason}: posted=${run.postedSamples}, skipped=${run.schedulerSkipped}, failures=${run.postFailures}`,
    );
    run.reportTimer = window.setTimeout(() => sendLoadReport(run), REPORT_COOLDOWN_MS);
    renderControls();
  }

  function scheduleLoadTick(run) {
    if (loadRun !== run || !["scheduled", "running"].includes(run.phase)) return;
    const now = Date.now();
    if (now < run.startAt) {
      run.scheduleTimer = window.setTimeout(
        () => scheduleLoadTick(run),
        Math.max(1, run.startAt - now),
      );
      return;
    }
    run.phase = "running";
    if (now >= run.endAt || run.nextSampleIndex >= run.expectedPerSeat) {
      const delay = Math.max(0, run.endAt - now);
      run.scheduleTimer = window.setTimeout(() => finishLoad(run, "duration"), delay);
      return;
    }
    const intervalMs = 1_000 / run.plan.rateHz;
    const dueIndex = Math.min(
      run.expectedPerSeat,
      Math.max(0, Math.floor((now - run.startAt) / intervalMs)),
    );
    if (dueIndex > run.nextSampleIndex) {
      run.schedulerSkipped += dueIndex - run.nextSampleIndex;
      run.nextSampleIndex = dueIndex;
    }
    if (run.nextSampleIndex >= run.expectedPerSeat) {
      run.scheduleTimer = window.setTimeout(
        () => finishLoad(run, "duration"),
        Math.max(0, run.endAt - Date.now()),
      );
      return;
    }
    const sample = loadProtocol.buildLoadSample(
      run.plan.runId,
      run.nextSampleIndex + 1,
      Date.now(),
      run.plan.payloadBytes,
    );
    run.attemptedSamples += 1;
    if (sample && relay.broadcast(sample)) run.postedSamples += 1;
    else run.postFailures += 1;
    run.nextSampleIndex += 1;
    const nextAt = run.startAt + run.nextSampleIndex * intervalMs;
    run.scheduleTimer = window.setTimeout(
      () => scheduleLoadTick(run),
      Math.max(1, nextAt - Date.now()),
    );
  }

  function armLoadStart(run, startAt, startServerSeq = null) {
    if (loadRun !== run || !Number.isSafeInteger(startAt) || startAt <= Date.now() - 5_000) {
      return;
    }
    if (Number.isSafeInteger(startServerSeq)) run.lastSampleServerSeq = startServerSeq;
    if (run.startAt === startAt && ["scheduled", "running"].includes(run.phase)) return;
    run.phase = "scheduled";
    run.startAt = startAt;
    run.endAt = startAt + run.plan.durationMs;
    run.nextSampleIndex = 0;
    loadStatus.textContent = `동기 시작 대기 · ${Math.max(0, startAt - Date.now())}ms 후`;
    run.scheduleTimer = window.setTimeout(
      () => scheduleLoadTick(run),
      Math.max(1, startAt - Date.now()),
    );
    appendLog(
      `load armed: ${run.plan.rateHz}Hz, ${run.plan.durationMs / 1_000}s, ${run.plan.payloadBytes}B`,
    );
    renderControls();
  }

  function launchLoadIfReady(run) {
    const bootstrap = renderBootstrap();
    if (
      loadRun !== run ||
      run.phase !== "planning" ||
      bootstrap?.self.role !== "HOST" ||
      !run.expectedSeats.every((seatIndex) => run.readySeats.has(seatIndex))
    ) {
      return;
    }
    if (run.readyTimer !== null) {
      window.clearTimeout(run.readyTimer);
      run.readyTimer = null;
    }
    const startMessage = {
      protocol: loadProtocol.LOAD_PROTOCOL,
      type: "load-start",
      runId: run.plan.runId,
      startAt: Date.now() + START_DELAY_MS,
    };
    if (!relay.broadcast(startMessage)) {
      run.phase = "stopped";
      loadStatus.textContent = "동기 시작 메시지 전송에 실패했습니다.";
      renderControls(bootstrap);
      return;
    }
    armLoadStart(run, startMessage.startAt);
  }

  function acceptLoadPlan(plan) {
    const bootstrap = renderBootstrap();
    if (!bootstrap || idleIsBusy()) return;
    if (loadIsBusy() && loadRun?.plan.runId !== plan.runId) {
      appendLog(`ignored overlapping load plan: ${plan.runId}`);
      return;
    }
    if (!loadRun || loadRun.plan.runId !== plan.runId) {
      loadRun = newLoadRun(plan);
      renderLoadReports();
    }
    const run = loadRun;
    if (bootstrap.self.role === "HOST") {
      run.readySeats.add(bootstrap.self.seatIndex);
      if (run.readyTimer === null) {
        run.readyTimer = window.setTimeout(() => {
          if (loadRun !== run || run.phase !== "planning") return;
          const missing = run.expectedSeats.filter((seatIndex) => !run.readySeats.has(seatIndex));
          run.phase = "stopped";
          loadStatus.textContent = `준비 응답 시간 초과 · 누락 좌석: ${missing.join(", ")}`;
          renderControls();
        }, READY_TIMEOUT_MS);
      }
      launchLoadIfReady(run);
    } else if (!run.readySent) {
      const hostId = hostParticipantId();
      run.readySent = Boolean(
        hostId &&
        relay.direct(hostId, {
          protocol: loadProtocol.LOAD_PROTOCOL,
          type: "load-ready",
          runId: plan.runId,
        }),
      );
      loadStatus.textContent = run.readySent
        ? "Host에게 부하 준비 완료를 알렸습니다."
        : "Host 준비 응답 전송에 실패했습니다.";
    }
    renderControls(bootstrap);
  }

  function recordLoadSample(run, message, sample) {
    if (
      loadRun !== run ||
      !["scheduled", "running", "cooldown"].includes(run.phase) ||
      !isExpectedSeat(run, message.sender.seatIndex)
    ) {
      return;
    }
    if (run.lastSampleServerSeq !== null && message.serverSeq > run.lastSampleServerSeq + 1) {
      run.serverSeqGaps += message.serverSeq - run.lastSampleServerSeq - 1;
    }
    run.lastSampleServerSeq = message.serverSeq;
    const samples = run.receivedBySeat.get(message.sender.seatIndex);
    if (!samples) return;
    if (samples.has(sample.sampleSeq)) run.duplicateSamples += 1;
    else samples.add(sample.sampleSeq);
    if (message.sender.participantId === relay.bootstrap.self.participantId) {
      run.selfLatencies.push(Math.max(0, Date.now() - sample.sentAt));
    }
  }

  function stopLoadFromHost() {
    const bootstrap = renderBootstrap();
    const run = loadRun;
    if (
      !run ||
      bootstrap?.self.role !== "HOST" ||
      !["planning", "scheduled", "running"].includes(run.phase)
    ) {
      return;
    }
    finishLoad(run, "host-stop");
    loadStatus.textContent = "Host 로컬 전송 중지 · rate window가 비면 전체 중지를 알립니다…";
    run.manualStopTimer = window.setTimeout(() => {
      if (loadRun !== run || closed) return;
      const posted = relay.broadcast({
        protocol: loadProtocol.LOAD_PROTOCOL,
        type: "load-stop",
        runId: run.plan.runId,
        reason: "host-stop",
      });
      appendLog(`load stop broadcast: ${posted}`);
    }, MANUAL_STOP_QUIET_MS);
  }

  function startLoadFromHost() {
    const bootstrap = renderBootstrap();
    if (bootstrap?.self.role !== "HOST" || loadIsBusy() || idleIsBusy() || closed) {
      return;
    }
    const plan = loadProtocol.parseLoadMessage({
      protocol: loadProtocol.LOAD_PROTOCOL,
      type: "load-plan",
      runId: createRunId("load"),
      rateHz: Number(loadRate.value),
      durationMs: Number(loadDuration.value),
      payloadBytes: Number(loadPayload.value),
    });
    if (!plan) {
      loadStatus.textContent = "선택한 부하 조건이 유효하지 않습니다.";
      return;
    }
    loadRun = newLoadRun(plan);
    renderLoadReports();
    acceptLoadPlan(plan);
    if (!relay.broadcast(plan)) {
      clearLoadTimers(loadRun);
      loadRun.phase = "stopped";
      loadStatus.textContent = "부하 계획 전송에 실패했습니다.";
      renderControls(bootstrap);
      return;
    }
    loadStatus.textContent = `실제 계정 준비 응답 대기 · 1/${loadRun.expectedSeats.length}`;
    appendLog(`load plan: ${plan.runId}`);
  }

  function clearIdleTimers(run) {
    for (const key of ["readyTimer", "startTimer", "wakeTimer", "reportDeadlineTimer"]) {
      if (run[key] !== null) {
        window.clearTimeout(run[key]);
        run[key] = null;
      }
    }
  }

  function newIdleRun(runId) {
    return {
      runId,
      expectedSeats: expectedSeats(),
      readySeats: new Set(),
      readySent: false,
      phase: "planning",
      startAt: 0,
      startServerSeq: null,
      reports: new Map(),
      readyTimer: null,
      startTimer: null,
      wakeTimer: null,
      reportDeadlineTimer: null,
    };
  }

  function renderIdleReports() {
    const run = idleRun;
    if (!run || run.reports.size === 0) {
      idleResults.innerHTML = "<li>idle/wake 결과가 없습니다.</li>";
      return;
    }
    idleResults.replaceChildren(
      ...[...run.reports.entries()]
        .sort(([left], [right]) => left - right)
        .map(([seatIndex, report]) => {
          const row = document.createElement("li");
          const delta = report.wakeServerSeq - report.startServerSeq;
          row.textContent = `seat ${seatIndex} · idle ${report.observedIdleMs}ms · serverSeq ${report.startServerSeq}→${report.wakeServerSeq} (Δ${delta})`;
          return row;
        }),
    );
  }

  function completeIdleReportsIfReady(run) {
    const bootstrap = renderBootstrap();
    if (idleRun !== run || bootstrap?.self.role !== "HOST" || !allExpectedSeatsReported(run)) {
      return;
    }
    if (run.reportDeadlineTimer !== null) {
      window.clearTimeout(run.reportDeadlineTimer);
      run.reportDeadlineTimer = null;
    }
    run.phase = "complete";
    loadStatus.textContent = `idle/wake 완료 · ${run.reports.size}/${run.expectedSeats.length}개 실제 계정 보고 수집`;
    appendLog(`idle complete: ${run.runId}`);
    renderControls(bootstrap);
  }

  function sendIdleReport(run, wakeServerSeq) {
    if (idleRun !== run) return;
    const bootstrap = renderBootstrap();
    if (!bootstrap) return;
    const report = {
      protocol: loadProtocol.LOAD_PROTOCOL,
      type: "idle-report",
      runId: run.runId,
      observedIdleMs: Math.max(0, Date.now() - run.startAt),
      startServerSeq: run.startServerSeq ?? 0,
      wakeServerSeq,
    };
    run.reports.set(bootstrap.self.seatIndex, report);
    renderIdleReports();
    if (bootstrap.self.role === "HOST") {
      run.phase = "reporting";
      loadStatus.textContent = `idle 결과 수집 중 · ${run.reports.size}/${run.expectedSeats.length}`;
      run.reportDeadlineTimer = window.setTimeout(() => {
        if (idleRun !== run || run.phase !== "reporting") return;
        run.phase = "complete";
        const missing = run.expectedSeats.filter((seatIndex) => !run.reports.has(seatIndex));
        loadStatus.textContent = `idle 결과 수집 종료 · 누락 좌석: ${missing.join(", ") || "없음"}`;
        renderControls();
      }, REPORT_TIMEOUT_MS);
      completeIdleReportsIfReady(run);
      return;
    }
    const hostId = hostParticipantId();
    const posted = Boolean(hostId && relay.direct(hostId, report));
    run.phase = "complete";
    loadStatus.textContent = posted
      ? "idle/wake 결과를 Host에게 전송했습니다."
      : "idle/wake 결과 전송에 실패했습니다.";
    renderControls(bootstrap);
  }

  function receiveIdleWake(run, message, wake) {
    if (
      idleRun !== run ||
      !["scheduled", "idle", "waking"].includes(run.phase) ||
      wake.startedAt !== run.startAt
    ) {
      return;
    }
    if (run.startTimer !== null) window.clearTimeout(run.startTimer);
    if (run.wakeTimer !== null) window.clearTimeout(run.wakeTimer);
    run.startTimer = null;
    run.wakeTimer = null;
    sendIdleReport(run, message.serverSeq);
  }

  function sendIdleWake(run) {
    if (idleRun !== run || run.phase !== "idle" || closed) return;
    run.phase = "waking";
    const wakeSentAt = Date.now();
    const posted = relay.broadcast({
      protocol: loadProtocol.LOAD_PROTOCOL,
      type: "idle-wake",
      runId: run.runId,
      startedAt: run.startAt,
      wakeSentAt,
    });
    if (!posted) {
      run.phase = "stopped";
      loadStatus.textContent = "idle wake 전송에 실패했습니다.";
      renderControls();
    }
  }

  function armIdleStart(run, startAt, startServerSeq = null) {
    if (idleRun !== run || !Number.isSafeInteger(startAt) || startAt <= Date.now() - 5_000) {
      return;
    }
    if (Number.isSafeInteger(startServerSeq)) run.startServerSeq = startServerSeq;
    if (run.startAt === startAt && ["scheduled", "idle"].includes(run.phase)) return;
    run.phase = "scheduled";
    run.startAt = startAt;
    loadStatus.textContent = `idle 동기 시작 대기 · ${Math.max(0, startAt - Date.now())}ms 후`;
    run.startTimer = window.setTimeout(
      () => {
        if (idleRun !== run || run.phase !== "scheduled") return;
        run.phase = "idle";
        loadStatus.textContent = "60초 무메시지 구간 진행 중…";
        if (relay.bootstrap.self.role === "HOST") {
          run.wakeTimer = window.setTimeout(() => sendIdleWake(run), loadProtocol.IDLE_DURATION_MS);
        }
        renderControls();
      },
      Math.max(1, startAt - Date.now()),
    );
    appendLog(`idle armed: ${run.runId}`);
    renderControls();
  }

  function launchIdleIfReady(run) {
    const bootstrap = renderBootstrap();
    if (
      idleRun !== run ||
      run.phase !== "planning" ||
      bootstrap?.self.role !== "HOST" ||
      !run.expectedSeats.every((seatIndex) => run.readySeats.has(seatIndex))
    ) {
      return;
    }
    if (run.readyTimer !== null) {
      window.clearTimeout(run.readyTimer);
      run.readyTimer = null;
    }
    const startMessage = {
      protocol: loadProtocol.LOAD_PROTOCOL,
      type: "idle-start",
      runId: run.runId,
      startAt: Date.now() + START_DELAY_MS,
      durationMs: loadProtocol.IDLE_DURATION_MS,
    };
    if (!relay.broadcast(startMessage)) {
      run.phase = "stopped";
      loadStatus.textContent = "idle 시작 메시지 전송에 실패했습니다.";
      renderControls(bootstrap);
      return;
    }
    armIdleStart(run, startMessage.startAt);
  }

  function acceptIdlePlan(plan) {
    const bootstrap = renderBootstrap();
    if (!bootstrap || loadIsBusy()) return;
    if (idleIsBusy() && idleRun?.runId !== plan.runId) {
      appendLog(`ignored overlapping idle plan: ${plan.runId}`);
      return;
    }
    if (!idleRun || idleRun.runId !== plan.runId) {
      idleRun = newIdleRun(plan.runId);
      renderIdleReports();
    }
    const run = idleRun;
    if (bootstrap.self.role === "HOST") {
      run.readySeats.add(bootstrap.self.seatIndex);
      if (run.readyTimer === null) {
        run.readyTimer = window.setTimeout(() => {
          if (idleRun !== run || run.phase !== "planning") return;
          const missing = run.expectedSeats.filter((seatIndex) => !run.readySeats.has(seatIndex));
          run.phase = "stopped";
          loadStatus.textContent = `idle 준비 응답 시간 초과 · 누락 좌석: ${missing.join(", ")}`;
          renderControls();
        }, READY_TIMEOUT_MS);
      }
      launchIdleIfReady(run);
    } else if (!run.readySent) {
      const hostId = hostParticipantId();
      run.readySent = Boolean(
        hostId &&
        relay.direct(hostId, {
          protocol: loadProtocol.LOAD_PROTOCOL,
          type: "idle-ready",
          runId: plan.runId,
        }),
      );
      loadStatus.textContent = run.readySent
        ? "Host에게 idle 준비 완료를 알렸습니다."
        : "Host idle 준비 응답 전송에 실패했습니다.";
    }
    renderControls(bootstrap);
  }

  function startIdleFromHost() {
    const bootstrap = renderBootstrap();
    if (bootstrap?.self.role !== "HOST" || loadIsBusy() || idleIsBusy() || closed) {
      return;
    }
    const plan = loadProtocol.parseLoadMessage({
      protocol: loadProtocol.LOAD_PROTOCOL,
      type: "idle-plan",
      runId: createRunId("idle"),
    });
    if (!plan) {
      loadStatus.textContent = "idle 계획을 만들 수 없습니다.";
      return;
    }
    idleRun = newIdleRun(plan.runId);
    renderIdleReports();
    acceptIdlePlan(plan);
    if (!relay.broadcast(plan)) {
      clearIdleTimers(idleRun);
      idleRun.phase = "stopped";
      loadStatus.textContent = "idle 계획 전송에 실패했습니다.";
      renderControls(bootstrap);
      return;
    }
    loadStatus.textContent = `실제 계정 idle 준비 응답 대기 · 1/${idleRun.expectedSeats.length}`;
    appendLog(`idle plan: ${plan.runId}`);
  }

  function handleLoadProtocolMessage(message, payload) {
    const bootstrap = renderBootstrap();
    if (!bootstrap) return;
    const fromHost = message.sender.role === "HOST";
    if (payload.type === "load-plan" && fromHost && message.delivery === "broadcast") {
      acceptLoadPlan(payload);
      return;
    }
    if (
      payload.type === "load-ready" &&
      bootstrap.self.role === "HOST" &&
      message.delivery === "direct" &&
      loadRun?.plan.runId === payload.runId &&
      isExpectedSeat(loadRun, message.sender.seatIndex)
    ) {
      loadRun.readySeats.add(message.sender.seatIndex);
      loadStatus.textContent = `실제 계정 준비 응답 대기 · ${loadRun.readySeats.size}/${loadRun.expectedSeats.length}`;
      launchLoadIfReady(loadRun);
      return;
    }
    if (
      payload.type === "load-start" &&
      fromHost &&
      message.delivery === "broadcast" &&
      loadRun?.plan.runId === payload.runId
    ) {
      armLoadStart(loadRun, payload.startAt, message.serverSeq);
      return;
    }
    if (
      payload.type === "load-sample" &&
      message.delivery === "broadcast" &&
      loadRun?.plan.runId === payload.runId
    ) {
      recordLoadSample(loadRun, message, payload);
      return;
    }
    if (
      payload.type === "load-stop" &&
      fromHost &&
      message.delivery === "broadcast" &&
      loadRun?.plan.runId === payload.runId
    ) {
      finishLoad(loadRun, payload.reason);
      return;
    }
    if (
      payload.type === "load-report" &&
      bootstrap.self.role === "HOST" &&
      message.delivery === "direct" &&
      loadRun?.plan.runId === payload.runId &&
      isExpectedSeat(loadRun, message.sender.seatIndex)
    ) {
      loadRun.reports.set(message.sender.seatIndex, payload);
      renderLoadReports();
      loadStatus.textContent = `결과 수집 중 · ${loadRun.reports.size}/${loadRun.expectedSeats.length}`;
      completeLoadReportsIfReady(loadRun);
      return;
    }
    if (payload.type === "idle-plan" && fromHost && message.delivery === "broadcast") {
      acceptIdlePlan(payload);
      return;
    }
    if (
      payload.type === "idle-ready" &&
      bootstrap.self.role === "HOST" &&
      message.delivery === "direct" &&
      idleRun?.runId === payload.runId &&
      isExpectedSeat(idleRun, message.sender.seatIndex)
    ) {
      idleRun.readySeats.add(message.sender.seatIndex);
      loadStatus.textContent = `실제 계정 idle 준비 응답 대기 · ${idleRun.readySeats.size}/${idleRun.expectedSeats.length}`;
      launchIdleIfReady(idleRun);
      return;
    }
    if (
      payload.type === "idle-start" &&
      fromHost &&
      message.delivery === "broadcast" &&
      idleRun?.runId === payload.runId
    ) {
      armIdleStart(idleRun, payload.startAt, message.serverSeq);
      return;
    }
    if (
      payload.type === "idle-wake" &&
      fromHost &&
      message.delivery === "broadcast" &&
      idleRun?.runId === payload.runId
    ) {
      receiveIdleWake(idleRun, message, payload);
      return;
    }
    if (
      payload.type === "idle-report" &&
      bootstrap.self.role === "HOST" &&
      message.delivery === "direct" &&
      idleRun?.runId === payload.runId &&
      isExpectedSeat(idleRun, message.sender.seatIndex)
    ) {
      idleRun.reports.set(message.sender.seatIndex, payload);
      renderIdleReports();
      loadStatus.textContent = `idle 결과 수집 중 · ${idleRun.reports.size}/${idleRun.expectedSeats.length}`;
      completeIdleReportsIfReady(idleRun);
    }
  }

  if (!relay || !loadProtocol) {
    status.textContent = !relay
      ? "OWOGG Relay runtime에서만 실행할 수 있습니다."
      : "부하 프로토콜 모듈을 불러오지 못했습니다.";
    for (const control of document.querySelectorAll("button, select")) control.disabled = true;
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
    if (message.type === "MULTI_DISCONNECTED") {
      status.textContent = `Relay 연결 끊김: ${message.code}`;
      appendLog(`disconnected: ${message.code}`);
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
      const loadMessage = loadProtocol.parseLoadMessage(message.payload);
      if (loadMessage) {
        handleLoadProtocolMessage(message, loadMessage);
        return;
      }
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
      if (loadRun && !["complete", "stopped"].includes(loadRun.phase)) {
        loadRun.rejected += 1;
      }
      appendLog(`rejected: ${message.code}`);
      return;
    }
    if (message.type === "RELAY_CLOSED") {
      closed = true;
      if (loadRun) clearLoadTimers(loadRun);
      if (idleRun) clearIdleTimers(idleRun);
      status.textContent = `Relay 종료: ${message.code}`;
      appendLog(`closed: ${message.code}`);
      for (const control of document.querySelectorAll("button, select")) control.disabled = true;
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
  loadStart.addEventListener("click", startLoadFromHost);
  loadStop.addEventListener("click", stopLoadFromHost);
  idleStart.addEventListener("click", startIdleFromHost);
  leave.addEventListener("click", () => {
    closed = true;
    if (loadRun) clearLoadTimers(loadRun);
    if (idleRun) clearIdleTimers(idleRun);
    relay.leave();
    status.textContent = "방을 나가는 중…";
    renderControls();
  });

  renderBootstrap();
  if (!relay.ready()) status.textContent = "Relay ready 요청을 보낼 수 없습니다.";
})();
