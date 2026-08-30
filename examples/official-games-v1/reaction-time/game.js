(() => {
  "use strict";

  const rules = window.OwoggReactionRules;
  const api = window.OWOGG;
  const status = document.querySelector("#status");
  const setup = document.querySelector("#setup");
  const play = document.querySelector("#play");
  const finished = document.querySelector("#finished");
  const difficulty = document.querySelector("#difficulty");
  const variant = document.querySelector("#variant");
  const start = document.querySelector("#start");
  const round = document.querySelector("#round");
  const average = document.querySelector("#average");
  const pad = document.querySelector("#reaction-pad");
  const padTitle = document.querySelector("#pad-title");
  const padNote = document.querySelector("#pad-note");
  const summary = document.querySelector("#summary");

  let waits = [];
  let events = [];
  let startedAt = 0;
  let cueAtMs = 0;
  let phase = "idle";
  let timer = null;

  function setOptions(select, options, selected) {
    select.replaceChildren(
      ...options.map((option) => {
        const item = document.createElement("option");
        item.value = option.id;
        item.textContent = option.label;
        item.selected = option.id === selected;
        return item;
      }),
    );
  }
  function selectedConfig(config) {
    return config.allowedConfigs.find(
      (item) => item.difficultyId === difficulty.value && item.variantId === variant.value,
    );
  }
  function updateStart(config) {
    start.disabled = !selectedConfig(config);
  }
  function elapsedMs() {
    return Math.max(0, Math.round(performance.now() - startedAt));
  }
  function renderAverage() {
    if (events.length === 0) {
      average.textContent = "-";
      return;
    }
    average.textContent = `${Math.round(events.reduce((total, item) => total + item.clickedAtMs - item.cueAtMs, 0) / events.length)} ms`;
  }

  function armRound() {
    const index = events.length;
    phase = "waiting";
    pad.disabled = true;
    pad.className = "reaction-pad waiting";
    padTitle.textContent = "기다리세요";
    padNote.textContent = "초록색이 되면 누르세요.";
    round.textContent = `${index + 1} / ${waits.length}`;
    timer = window.setTimeout(() => {
      timer = null;
      phase = "go";
      cueAtMs = elapsedMs();
      pad.disabled = false;
      pad.className = "reaction-pad go";
      padTitle.textContent = "지금!";
      padNote.textContent = "클릭하거나 Space 키를 누르세요.";
    }, waits[index]);
  }

  function react() {
    if (phase !== "go") return;
    phase = "cooldown";
    pad.disabled = true;
    const clickedAtMs = elapsedMs();
    events.push({ seq: events.length + 1, cueAtMs, clickedAtMs });
    renderAverage();
    if (events.length < waits.length) {
      pad.className = "reaction-pad waiting";
      padTitle.textContent = `${clickedAtMs - cueAtMs} ms`;
      padNote.textContent = "다음 라운드를 준비합니다.";
      timer = window.setTimeout(armRound, rules.BREAK_MS);
      return;
    }
    const completedAtMs = clickedAtMs;
    play.classList.add("hidden");
    finished.classList.remove("hidden");
    const localAverage = Math.round(
      events.reduce((total, item) => total + item.clickedAtMs - item.cueAtMs, 0) / events.length,
    );
    summary.textContent = `로컬 측정 평균 ${localAverage} ms · ${events.length}라운드`;
    status.textContent = "evidence를 제출했습니다. 서버 검증 결과를 확인하세요.";
    api.complete({ evidence: { version: 1, completedAtMs, rounds: [...events] } });
  }

  async function begin() {
    const config = api?.playConfig;
    const allowed = config ? selectedConfig(config) : null;
    if (!api || !config || !allowed) return;
    start.disabled = true;
    difficulty.disabled = true;
    variant.disabled = true;
    status.textContent = "선택한 설정을 서버에 승인 요청하는 중입니다.";
    try {
      const context = await api.requestStart({
        difficultyId: allowed.difficultyId,
        variantId: allowed.variantId,
      });
      if (context.rulesetRevision !== rules.RULESET_REVISION) throw new Error("revision");
      waits = rules.createWaits({
        challengeSeed: context.challengeSeed,
        difficultyId: context.playConfig.difficultyId,
        variantId: context.playConfig.variantId,
      });
      if (waits.length === 0) throw new Error("config");
      events = [];
      setup.classList.add("hidden");
      finished.classList.add("hidden");
      play.classList.remove("hidden");
      startedAt = performance.now();
      phase = "waiting";
      round.textContent = `1 / ${waits.length}`;
      renderAverage();
      api.start();
      status.textContent = "신호가 초록색으로 바뀌는 순간 반응하세요.";
      armRound();
    } catch {
      status.textContent = "서버가 시작을 승인하지 않았습니다. 플랫폼에서 게임을 다시 여세요.";
    }
  }

  pad.addEventListener("click", react);
  window.addEventListener("keydown", (event) => {
    if ((event.code === "Space" || event.code === "Enter") && phase === "go") {
      event.preventDefault();
      react();
    }
  });
  start.addEventListener("click", () => void begin());

  const config = api?.playConfig;
  if (!api || !config) {
    status.textContent = "OWOGG의 서버 검증 실행 환경에서만 시작할 수 있습니다.";
    start.disabled = true;
  } else {
    setOptions(difficulty, config.difficulties, config.defaultDifficultyId);
    setOptions(variant, config.variants, config.defaultVariantId);
    difficulty.addEventListener("change", () => updateStart(config));
    variant.addEventListener("change", () => updateStart(config));
    updateStart(config);
    status.textContent = "난이도와 모드를 고른 뒤 시작하세요.";
  }
})();
