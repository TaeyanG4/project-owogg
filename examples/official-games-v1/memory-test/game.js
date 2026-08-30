(() => {
  "use strict";

  const rules = window.OwoggMemoryRules;
  const api = window.OWOGG;
  const status = document.querySelector("#status");
  const configPanel = document.querySelector("#config-panel");
  const difficultyGroup = document.querySelector("#difficulty-group");
  const difficultyOptions = document.querySelector("#difficulty-options");
  const variantGroup = document.querySelector("#variant-group");
  const variantOptions = document.querySelector("#variant-options");
  const setup = document.querySelector("#setup");
  const play = document.querySelector("#play");
  const finished = document.querySelector("#finished");
  const start = document.querySelector("#start");
  const retry = document.querySelector("#retry");
  const levelEl = document.querySelector("#level");
  const hubLevel = document.querySelector("#hub-level");
  const bestEl = document.querySelector("#best");
  const progress = document.querySelector("#progress");
  const turnStatus = document.querySelector("#turn-status");
  const pads = [...document.querySelectorAll(".pad")];
  const finishTitle = document.querySelector("#finish-title");
  const summary = document.querySelector("#summary");
  const grade = document.querySelector("#grade");

  const toneFrequencies = [261.63, 329.63, 392, 523.25];
  let config = null;
  let selection = null;
  let challenge = null;
  let variantId = "standard";
  let level = 1;
  let bestLevel = 0;
  let rounds = [];
  let currentRound = null;
  let expected = [];
  let startedAt = 0;
  let accepting = false;
  let completed = false;

  function playTone(index, duration = 0.25) {
    try {
      const AudioContextType = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextType) return;
      const context = new AudioContextType();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = toneFrequencies[index] ?? 150;
      gain.gain.setValueAtTime(0.16, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + duration);
    } catch {
      // Audio is decorative; autoplay or device restrictions must not block the game.
    }
  }

  function allowedSelection() {
    if (!config || !selection) return null;
    return config.allowedConfigs.find(
      (item) =>
        item.difficultyId === selection.difficultyId && item.variantId === selection.variantId,
    );
  }

  function chooseAxis(axis, id) {
    if (!config || !selection) return;
    const otherAxis = axis === "difficultyId" ? "variantId" : "difficultyId";
    const candidate =
      config.allowedConfigs.find(
        (item) => item[axis] === id && item[otherAxis] === selection[otherAxis],
      ) ?? config.allowedConfigs.find((item) => item[axis] === id);
    if (!candidate) return;
    selection = { difficultyId: candidate.difficultyId, variantId: candidate.variantId };
    renderConfig();
  }

  function renderAxis(container, entries, axis) {
    container.replaceChildren(
      ...entries.map((entry) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = entry.label;
        button.classList.toggle("selected", selection?.[axis] === entry.id);
        button.addEventListener("click", () => chooseAxis(axis, entry.id));
        return button;
      }),
    );
  }

  function renderConfig() {
    if (!config) return;
    const showDifficulty = config.difficulties.length > 1;
    const showVariant = config.variants.length > 1;
    configPanel.classList.toggle("hidden", !showDifficulty && !showVariant);
    difficultyGroup.classList.toggle("hidden", !showDifficulty);
    variantGroup.classList.toggle("hidden", !showVariant);
    renderAxis(difficultyOptions, config.difficulties, "difficultyId");
    renderAxis(variantOptions, config.variants, "variantId");
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

  function updateLevel() {
    levelEl.textContent = String(level);
    hubLevel.textContent = String(level).padStart(2, "0");
    bestEl.textContent = String(bestLevel);
  }

  async function showLevel() {
    if (!challenge || completed) return;
    accepting = false;
    setPadsEnabled(false);
    updateLevel();
    const shown = challenge.sequence.slice(0, level + challenge.extra);
    expected = rules.expectedForLevel(challenge, level, variantId);
    progress.textContent = `0 / ${expected.length}`;
    turnStatus.textContent =
      variantId === "reverse" ? "패턴을 본 뒤 거꾸로 입력하세요." : "패턴을 기억하세요.";
    currentRound = { level, shownAtMs: elapsedMs(), inputs: [] };
    await delay(450);
    for (const color of shown) {
      const pad = pads[color];
      if (!pad || completed) return;
      pad.classList.add("active");
      playTone(color, 0.3);
      await delay(challenge.flashMs);
      pad.classList.remove("active");
      await delay(challenge.gapMs);
    }
    if (completed) return;
    accepting = true;
    setPadsEnabled(true);
    turnStatus.textContent = variantId === "reverse" ? "거꾸로 입력하세요." : "순서대로 누르세요.";
  }

  function gradeFor(value) {
    if (value >= 12) return "S";
    if (value >= 9) return "A";
    if (value >= 6) return "B";
    if (value >= 3) return "C";
    return "F";
  }

  function finish(success) {
    if (completed || !currentRound || !challenge) return;
    completed = true;
    accepting = false;
    setPadsEnabled(false);
    if (!rounds.includes(currentRound)) rounds.push(currentRound);
    const completedAtMs = currentRound.inputs.at(-1)?.tMs ?? elapsedMs();
    const completedLevels = success ? challenge.maxLevel : Math.max(0, level - 1);
    bestLevel = Math.max(bestLevel, completedLevels);
    updateLevel();
    play.classList.add("hidden");
    finished.classList.remove("hidden");
    finishTitle.textContent = success ? "모든 레벨 완료" : "게임 종료";
    summary.textContent = `Level ${completedLevels}`;
    grade.textContent = `달성 등급 · ${gradeFor(completedLevels)}`;
    status.textContent = "플레이 기록을 안전하게 확인하고 있습니다.";
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
    const pad = pads[color];
    pad?.classList.add("active");
    playTone(color);
    window.setTimeout(() => pad?.classList.remove("active"), 180);
    currentRound.inputs.push({ color, tMs: measuredAt });
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
    bestLevel = Math.max(bestLevel, level);
    if (level === challenge.maxLevel) {
      finish(true);
      return;
    }
    level += 1;
    turnStatus.textContent = "정답입니다. 다음 레벨을 준비합니다.";
    window.setTimeout(() => void showLevel(), 650);
  }

  async function begin() {
    const allowed = allowedSelection();
    if (!allowed) return;
    start.disabled = true;
    status.textContent = "플레이를 준비하고 있습니다.";
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
      configPanel.classList.add("hidden");
      setup.classList.add("hidden");
      finished.classList.add("hidden");
      play.classList.remove("hidden");
      startedAt = performance.now();
      api.start();
      status.textContent = "표시된 색상 순서를 기억하세요.";
      await showLevel();
    } catch {
      start.disabled = false;
      status.textContent = "게임을 시작하지 못했습니다. 페이지를 새로고침해 다시 시도해 주세요.";
    }
  }

  async function initialize() {
    setPadsEnabled(false);
    if (!api?.whenReady) return;
    await api.whenReady();
    config = api.playConfig;
    if (!config) {
      status.textContent = "게임 준비 정보를 불러오지 못했습니다.";
      return;
    }
    selection = {
      difficultyId: config.defaultDifficultyId,
      variantId: config.defaultVariantId,
    };
    renderConfig();
    start.disabled = !allowedSelection();
    status.textContent =
      config.difficulties.length > 1 || config.variants.length > 1
        ? "게임 안에서 설정을 선택하고 시작하세요."
        : "바로 게임을 시작할 수 있습니다.";
  }

  pads.forEach((pad) =>
    pad.addEventListener("click", () => chooseColor(Number(pad.dataset.color))),
  );
  window.addEventListener("keydown", (event) => {
    if (/^[1-4]$/.test(event.key)) chooseColor(Number(event.key) - 1);
  });
  start.addEventListener("click", () => void begin());
  retry.addEventListener("click", () => window.location.reload());
  void initialize();
})();
