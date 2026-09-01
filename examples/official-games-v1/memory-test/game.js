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
  const memoryConsole = document.querySelector(".memory-console");
  const pads = [...document.querySelectorAll(".pad")];
  const finishTitle = document.querySelector("#finish-title");
  const summary = document.querySelector("#summary");
  const grade = document.querySelector("#grade");
  const soundToggle = document.querySelector("#sound-toggle");
  const languageToggle = document.querySelector("#language-toggle");

  const TEXT = Object.freeze({
    ko: Object.freeze({
      name: "순서기억력 테스트",
      header: "순서기억력 테스트",
      title: "순서기억력 테스트",
      description: "깜빡이는 4색 패드의 패턴을 기억하고 같은 순서로 눌러보세요.",
      start: "게임 시작",
      retry: "다시 도전하기",
      soundOn: "소리 켬",
      soundOff: "소리 끔",
      difficulty: "난이도",
      mode: "모드",
      gameSettings: "게임 설정",
      memoryPad: "색상 기억 패드",
      colors: Object.freeze(["빨강", "초록", "파랑", "노랑"]),
      preparing: "게임을 준비하는 중입니다.",
      choose: "게임 안에서 설정을 선택하고 시작하세요.",
      ready: "바로 게임을 시작할 수 있습니다.",
      authorizing: "플레이를 준비하고 있습니다.",
      remember: "패턴을 기억하세요.",
      rememberReverse: "패턴을 본 뒤 거꾸로 입력하세요.",
      enter: "순서대로 누르세요.",
      enterReverse: "거꾸로 입력하세요.",
      correct: "정답입니다. 다음 레벨을 준비합니다.",
      checking: "플레이 기록을 안전하게 확인하고 있습니다.",
      failed: "게임을 시작하지 못했습니다. 게임 안에서 다시 시도해 주세요.",
      missing: "게임 준비 정보를 불러오지 못했습니다.",
      finished: "게임 종료",
      allFinished: "모든 레벨 완료",
      grade: (value) => `달성 등급 · ${value}`,
      labels: Object.freeze({
        normal: "보통",
        hard: "어려움",
        standard: "기본",
        reverse: "역순",
      }),
    }),
    en: Object.freeze({
      name: "Sequence Memory Test",
      header: "Sequence Memory Test",
      title: "Sequence Memory Test",
      description: "Remember the flashing four-color pattern and press the pads in the same order.",
      start: "Start game",
      retry: "Try again",
      soundOn: "Sound on",
      soundOff: "Sound off",
      difficulty: "Difficulty",
      mode: "Mode",
      gameSettings: "Game settings",
      memoryPad: "Color memory pad",
      colors: Object.freeze(["Red", "Green", "Blue", "Yellow"]),
      preparing: "Preparing the game.",
      choose: "Choose your settings inside the game and start.",
      ready: "Ready to start.",
      authorizing: "Preparing play.",
      remember: "Remember the pattern.",
      rememberReverse: "Watch the pattern, then enter it in reverse.",
      enter: "Press the pads in order.",
      enterReverse: "Enter the pattern in reverse.",
      correct: "Correct. Preparing the next level.",
      checking: "Verifying your play record.",
      failed: "The game could not start. Try again from inside the game.",
      missing: "Game setup information could not be loaded.",
      finished: "Game over",
      allFinished: "All levels complete",
      grade: (value) => `Grade · ${value}`,
      labels: Object.freeze({
        normal: "Normal",
        hard: "Hard",
        standard: "Standard",
        reverse: "Reverse",
      }),
    }),
  });

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
  let soundEnabled = true;
  let audioContext = null;
  let locale = navigator.language.toLowerCase().startsWith("ko") ? "ko" : "en";
  let phase = "booting";
  let finishedSuccessfully = false;
  let finalCompletedLevels = 0;

  function text() {
    return TEXT[locale];
  }

  function ensureAudio() {
    if (!soundEnabled) return null;
    audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === "suspended") void audioContext.resume();
    return audioContext;
  }

  function playTone(index, duration = 0.25) {
    try {
      const context = ensureAudio();
      if (!context) return;
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

  function renderSoundState() {
    soundToggle.setAttribute("aria-pressed", String(soundEnabled));
    soundToggle.textContent = soundEnabled ? text().soundOn : text().soundOff;
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
    selection = {
      difficultyId: candidate.difficultyId,
      variantId: candidate.variantId,
    };
    renderConfig();
  }

  function renderAxis(container, entries, axis) {
    container.replaceChildren(
      ...entries.map((entry) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = text().labels[entry.id] ?? entry.label;
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
    const visibleLevel = Math.min(rules.MAX_LEVEL, Math.max(0, level));
    const visibleBest = Math.min(rules.MAX_LEVEL, Math.max(0, bestLevel));
    levelEl.textContent = String(visibleLevel);
    hubLevel.textContent = String(visibleLevel).padStart(2, "0");
    bestEl.textContent = String(visibleBest);
  }

  async function showLevel() {
    if (!challenge || completed) return;
    accepting = false;
    setPadsEnabled(false);
    updateLevel();
    const shown = challenge.sequence.slice(0, level + challenge.extra);
    expected = rules.expectedForLevel(challenge, level, variantId);
    progress.textContent = `0 / ${expected.length}`;
    phase = "showing";
    turnStatus.textContent = variantId === "reverse" ? text().rememberReverse : text().remember;
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
    phase = "input";
    setPadsEnabled(true);
    turnStatus.textContent = variantId === "reverse" ? text().enterReverse : text().enter;
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
    phase = "finished";
    finishedSuccessfully = success;
    accepting = false;
    setPadsEnabled(false);
    if (!rounds.includes(currentRound)) rounds.push(currentRound);
    const completedAtMs = currentRound.inputs.at(-1)?.tMs ?? elapsedMs();
    const completedLevels = success ? challenge.maxLevel : Math.max(0, level - 1);
    finalCompletedLevels = completedLevels;
    bestLevel = Math.max(bestLevel, completedLevels);
    updateLevel();
    play.classList.add("hidden");
    finished.classList.remove("hidden");
    finishTitle.textContent = success ? text().allFinished : text().finished;
    summary.textContent = `Level ${completedLevels}`;
    grade.textContent = text().grade(gradeFor(completedLevels));
    status.textContent = text().checking;
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
    playTone(success ? 3 : 0, success ? 0.38 : 0.5);
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
    if (level > rules.MAX_LEVEL) {
      level = rules.MAX_LEVEL;
      finish(true);
      return;
    }
    phase = "correct";
    turnStatus.textContent = text().correct;
    window.setTimeout(() => void showLevel(), 650);
  }

  async function begin() {
    const allowed = allowedSelection();
    if (!allowed) return;
    start.disabled = true;
    phase = "authorizing";
    ensureAudio();
    status.textContent = text().authorizing;
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
      status.textContent = text().remember;
      await showLevel();
    } catch {
      phase = "error";
      start.disabled = false;
      status.textContent = text().failed;
    }
  }

  async function initialize() {
    setPadsEnabled(false);
    if (!api?.whenReady) return;
    await api.whenReady();
    config = api.playConfig;
    if (!config) {
      phase = "missing";
      status.textContent = text().missing;
      return;
    }
    selection = {
      difficultyId: config.defaultDifficultyId,
      variantId: config.defaultVariantId,
    };
    renderConfig();
    start.disabled = !allowedSelection();
    phase = "ready";
    status.textContent =
      config.difficulties.length > 1 || config.variants.length > 1 ? text().choose : text().ready;
  }

  function renderLocale() {
    const copy = text();
    document.documentElement.lang = locale;
    document.title = copy.name;
    document.querySelector(".title strong").textContent = copy.header;
    setup.querySelector("h1").textContent = copy.title;
    setup.querySelector("p").textContent = copy.description;
    start.textContent = copy.start;
    retry.textContent = copy.retry;
    difficultyGroup.querySelector(":scope > span").textContent = copy.difficulty;
    variantGroup.querySelector(":scope > span").textContent = copy.mode;
    languageToggle.textContent = locale === "ko" ? "English" : "한국어";
    configPanel.setAttribute("aria-label", copy.gameSettings);
    difficultyGroup.setAttribute("aria-label", copy.difficulty);
    variantGroup.setAttribute("aria-label", copy.mode);
    memoryConsole.setAttribute("aria-label", copy.memoryPad);
    pads.forEach((pad, index) => pad.setAttribute("aria-label", copy.colors[index]));
    renderSoundState();
    if (config) renderConfig();
    if (phase === "booting") status.textContent = copy.preparing;
    else if (phase === "ready") {
      status.textContent =
        config && (config.difficulties.length > 1 || config.variants.length > 1)
          ? copy.choose
          : copy.ready;
    } else if (phase === "authorizing") status.textContent = copy.authorizing;
    else if (phase === "showing") {
      turnStatus.textContent = variantId === "reverse" ? copy.rememberReverse : copy.remember;
      status.textContent = copy.remember;
    } else if (phase === "input") {
      turnStatus.textContent = variantId === "reverse" ? copy.enterReverse : copy.enter;
    } else if (phase === "correct") turnStatus.textContent = copy.correct;
    else if (phase === "finished") {
      finishTitle.textContent = finishedSuccessfully ? copy.allFinished : copy.finished;
      grade.textContent = copy.grade(gradeFor(finalCompletedLevels));
      status.textContent = copy.checking;
    } else if (phase === "error") status.textContent = copy.failed;
    else if (phase === "missing") status.textContent = copy.missing;
  }

  pads.forEach((pad) =>
    pad.addEventListener("click", () => chooseColor(Number(pad.dataset.color))),
  );
  window.addEventListener("keydown", (event) => {
    if (/^[1-4]$/.test(event.key)) chooseColor(Number(event.key) - 1);
  });
  start.addEventListener("click", () => void begin());
  soundToggle.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    renderSoundState();
    if (soundEnabled) playTone(1, 0.12);
  });
  languageToggle.addEventListener("click", () => {
    locale = locale === "ko" ? "en" : "ko";
    renderLocale();
  });
  retry.addEventListener("click", () => api.restart());
  renderLocale();
  void initialize();
})();
