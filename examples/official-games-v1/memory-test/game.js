(() => {
  "use strict";

  const rules = window.OwoggMemoryRules;
  const api = window.OWOGG;
  const status = document.querySelector("#status");
  const setup = document.querySelector("#setup");
  const play = document.querySelector("#play");
  const finished = document.querySelector("#finished");
  const difficulty = document.querySelector("#difficulty");
  const variant = document.querySelector("#variant");
  const start = document.querySelector("#start");
  const levelEl = document.querySelector("#level");
  const progress = document.querySelector("#progress");
  const pads = [...document.querySelectorAll(".pad")];
  const finishTitle = document.querySelector("#finish-title");
  const summary = document.querySelector("#summary");

  let challenge = null;
  let variantId = "standard";
  let level = 1;
  let rounds = [];
  let currentRound = null;
  let expected = [];
  let startedAt = 0;
  let accepting = false;
  let completed = false;

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
  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }
  function setPadsEnabled(enabled) {
    pads.forEach((pad) => {
      pad.disabled = !enabled;
    });
  }

  async function showLevel() {
    if (!challenge || completed) return;
    accepting = false;
    setPadsEnabled(false);
    levelEl.textContent = String(level);
    const shown = challenge.sequence.slice(0, level + challenge.extra);
    expected = rules.expectedForLevel(challenge, level, variantId);
    progress.textContent = `0 / ${expected.length}`;
    status.textContent =
      variantId === "reverse" ? "순서를 본 뒤 거꾸로 입력하세요." : "색상 순서를 기억하세요.";
    currentRound = { level, shownAtMs: elapsedMs(), inputs: [] };
    for (const color of shown) {
      const pad = pads[color];
      pad.classList.add("active");
      await delay(challenge.flashMs);
      pad.classList.remove("active");
      await delay(challenge.gapMs);
    }
    if (completed) return;
    accepting = true;
    setPadsEnabled(true);
    status.textContent =
      variantId === "reverse" ? "지금 거꾸로 입력하세요." : "지금 같은 순서로 입력하세요.";
  }

  function finish(success) {
    if (completed || !currentRound) return;
    completed = true;
    accepting = false;
    setPadsEnabled(false);
    if (!rounds.includes(currentRound)) rounds.push(currentRound);
    const completedAtMs = currentRound.inputs.at(-1)?.tMs ?? elapsedMs();
    const completedLevels = success ? challenge.maxLevel : Math.max(0, level - 1);
    play.classList.add("hidden");
    finished.classList.remove("hidden");
    finishTitle.textContent = success ? "모든 레벨 완료" : "도전 종료";
    summary.textContent = `${completedLevels}레벨 완료 · 입력 ${rounds.reduce((total, item) => total + item.inputs.length, 0)}회`;
    status.textContent = "evidence를 제출했습니다. 서버 검증 결과를 확인하세요.";
    api.complete({
      evidence: {
        version: 1,
        completedAtMs,
        rounds: rounds.map((item) => ({
          level: item.level,
          shownAtMs: item.shownAtMs,
          inputs: item.inputs.map((input) => ({ ...input })),
        })),
      },
    });
  }

  function chooseColor(color) {
    if (!accepting || !currentRound || completed) return;
    const previousTime = currentRound.inputs.at(-1)?.tMs;
    const measuredAt = elapsedMs();
    if (previousTime !== undefined && measuredAt - previousTime < rules.MIN_INPUT_INTERVAL_MS)
      return;
    const tMs = measuredAt;
    currentRound.inputs.push({ color, tMs });
    const index = currentRound.inputs.length - 1;
    progress.textContent = `${currentRound.inputs.length} / ${expected.length}`;
    if (expected[index] !== color) {
      finish(false);
      return;
    }
    if (currentRound.inputs.length < expected.length) return;
    accepting = false;
    setPadsEnabled(false);
    rounds.push(currentRound);
    if (level === challenge.maxLevel) {
      finish(true);
      return;
    }
    level += 1;
    status.textContent = "정답입니다. 다음 레벨을 준비합니다.";
    window.setTimeout(() => void showLevel(), 650);
  }

  pads.forEach((pad) =>
    pad.addEventListener("click", () => chooseColor(Number(pad.dataset.color))),
  );
  window.addEventListener("keydown", (event) => {
    if (/^[1-4]$/.test(event.key)) chooseColor(Number(event.key) - 1);
  });

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
      variantId = context.playConfig.variantId;
      challenge = rules.createChallenge({
        challengeSeed: context.challengeSeed,
        difficultyId: context.playConfig.difficultyId,
        variantId,
      });
      if (!challenge) throw new Error("config");
      level = 1;
      rounds = [];
      currentRound = null;
      completed = false;
      setup.classList.add("hidden");
      finished.classList.add("hidden");
      play.classList.remove("hidden");
      startedAt = performance.now();
      api.start();
      await showLevel();
    } catch {
      status.textContent = "서버가 시작을 승인하지 않았습니다. 플랫폼에서 게임을 다시 여세요.";
    }
  }

  start.addEventListener("click", () => void begin());
  setPadsEnabled(false);
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
