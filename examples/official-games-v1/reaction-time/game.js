(() => {
  "use strict";

  const rules = window.OwoggReactionRules;
  const api = window.OWOGG;
  const status = document.querySelector("#status");
  const configPanel = document.querySelector("#config-panel");
  const difficultyGroup = document.querySelector("#difficulty-group");
  const difficultyOptions = document.querySelector("#difficulty-options");
  const variantGroup = document.querySelector("#variant-group");
  const variantOptions = document.querySelector("#variant-options");
  const round = document.querySelector("#round");
  const average = document.querySelector("#average");
  const pad = document.querySelector("#reaction-pad");
  const padTitle = document.querySelector("#pad-title");
  const padNote = document.querySelector("#pad-note");
  const results = document.querySelector("#results");
  const retry = document.querySelector("#retry");
  const soundToggle = document.querySelector("#sound-toggle");
  const languageToggle = document.querySelector("#language-toggle");

  const TEXT = Object.freeze({
    ko: Object.freeze({
      name: "반응속도 테스트",
      soundOn: "소리 켬",
      soundOff: "소리 끔",
      difficulty: "난이도",
      mode: "모드",
      gameSettings: "게임 설정",
      roundResults: "라운드별 기록",
      preparing: "게임을 준비하는 중입니다",
      waitMoment: "잠시만 기다려 주세요.",
      clickStart: "클릭하여 시작",
      rounds: "5라운드 진행",
      choose: "게임 안에서 설정을 선택하고 시작하세요.",
      ready: "바로 눌러 테스트를 시작하세요.",
      waiting: "기다리세요...",
      waitGreen: "초록색이 되면 클릭하세요.",
      go: "지금 클릭!",
      early: "너무 빨랐어요!",
      tryAgain: "다시 도전해 주세요.",
      earlyStatus: "신호가 나타나기 전에 눌렀습니다.",
      next: "다음 라운드를 준비합니다.",
      checking: "플레이 기록을 안전하게 확인하고 있습니다.",
      average: (value) => `평균 ${value} ms`,
      round: (now, total) => `라운드 ${now} / ${total}`,
      roundChip: (now, value) => `R${now} · ${value}ms`,
      finished: (count) => `${count}라운드 평균`,
      authorizing: "플레이 준비 중",
      selected: "선택한 설정으로 플레이를 준비하고 있습니다.",
      playing: "초록색 신호에 반응하세요.",
      retry: "다시 도전하기",
      failedTitle: "클릭하여 다시 시도",
      failedNote: "게임을 시작하지 못했습니다.",
      failed: "게임을 시작하지 못했습니다. 게임 안에서 다시 시도해 주세요.",
      missingTitle: "게임 준비 실패",
      missing: "게임 준비 정보를 불러오지 못했습니다.",
      labels: Object.freeze({ normal: "보통", hard: "어려움", standard: "기본", focus: "집중" }),
    }),
    en: Object.freeze({
      name: "Reaction Time Test",
      soundOn: "Sound on",
      soundOff: "Sound off",
      difficulty: "Difficulty",
      mode: "Mode",
      gameSettings: "Game settings",
      roundResults: "Round results",
      preparing: "Preparing the game",
      waitMoment: "Please wait a moment.",
      clickStart: "Click to start",
      rounds: "5 rounds",
      choose: "Choose your settings inside the game and start.",
      ready: "Press the pad to begin.",
      waiting: "Wait...",
      waitGreen: "Click when the pad turns green.",
      go: "Click now!",
      early: "Too early!",
      tryAgain: "Please try again.",
      earlyStatus: "You pressed before the signal appeared.",
      next: "Preparing the next round.",
      checking: "Verifying your play record.",
      average: (value) => `Average ${value} ms`,
      round: (now, total) => `Round ${now} / ${total}`,
      roundChip: (now, value) => `R${now} · ${value}ms`,
      finished: (count) => `${count}-round average`,
      authorizing: "Preparing play",
      selected: "Preparing the selected settings.",
      playing: "React to the green signal.",
      retry: "Try again",
      failedTitle: "Click to retry",
      failedNote: "The game could not start.",
      failed: "The game could not start. Try again from inside the game.",
      missingTitle: "Setup failed",
      missing: "Game setup information could not be loaded.",
      labels: Object.freeze({
        normal: "Normal",
        hard: "Hard",
        standard: "Standard",
        focus: "Focus",
      }),
    }),
  });

  let config = null;
  let selection = null;
  let waits = [];
  let events = [];
  let startedAt = 0;
  let cueAtMs = 0;
  let phase = "booting";
  let timer = null;
  let soundEnabled = true;
  let audioContext = null;
  let locale = navigator.language.toLowerCase().startsWith("ko") ? "ko" : "en";
  let startFailed = false;

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
    selection = { difficultyId: candidate.difficultyId, variantId: candidate.variantId };
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

  function renderAverage() {
    if (events.length === 0) {
      average.textContent = "";
      return;
    }
    const value = Math.round(
      events.reduce((total, item) => total + item.clickedAtMs - item.cueAtMs, 0) / events.length,
    );
    average.textContent = text().average(value);
    results.replaceChildren(
      ...events.map((item, index) => {
        const chip = document.createElement("span");
        chip.textContent = text().roundChip(index + 1, item.clickedAtMs - item.cueAtMs);
        return chip;
      }),
    );
  }

  function armRound() {
    const index = events.length;
    phase = "waiting";
    pad.disabled = false;
    pad.className = "reaction-pad waiting";
    padTitle.textContent = text().waiting;
    padNote.textContent = text().waitGreen;
    round.textContent = text().round(index + 1, waits.length);
    timer = window.setTimeout(() => {
      timer = null;
      phase = "go";
      cueAtMs = elapsedMs();
      pad.className = "reaction-pad go";
      padTitle.textContent = text().go;
      padNote.textContent = "";
      tone(760, 0.13, 0.05, "square");
    }, waits[index]);
  }

  function finish() {
    phase = "finished";
    const completedAtMs = events.at(-1)?.clickedAtMs ?? elapsedMs();
    const localAverage = Math.round(
      events.reduce((total, item) => total + item.clickedAtMs - item.cueAtMs, 0) / events.length,
    );
    pad.className = "reaction-pad finished";
    padTitle.textContent = `${localAverage}ms`;
    padNote.textContent = text().finished(events.length);
    status.textContent = text().checking;
    retry.classList.remove("hidden");
    tone(523, 0.1, 0.04, "triangle");
    tone(784, 0.16, 0.04, "triangle", 0.1);
    api.complete({ evidence: { version: 1, completedAtMs, rounds: [...events] } });
  }

  function react() {
    if (phase === "idle") {
      void begin();
      return;
    }
    if (phase === "waiting") {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      phase = "too-early";
      pad.className = "reaction-pad too-early";
      padTitle.textContent = text().early;
      padNote.textContent = text().tryAgain;
      retry.classList.remove("hidden");
      status.textContent = text().earlyStatus;
      tone(145, 0.22, 0.05, "sawtooth");
      return;
    }
    if (phase !== "go") return;
    phase = "cooldown";
    pad.disabled = true;
    const clickedAtMs = elapsedMs();
    events.push({ seq: events.length + 1, cueAtMs, clickedAtMs });
    tone(480, 0.055, 0.03, "triangle");
    renderAverage();
    if (events.length >= waits.length) {
      finish();
      return;
    }
    pad.className = "reaction-pad result";
    padTitle.textContent = `${clickedAtMs - cueAtMs}ms`;
    padNote.textContent = text().next;
    timer = window.setTimeout(armRound, rules.BREAK_MS);
  }

  async function begin() {
    const allowed = allowedSelection();
    if (!allowed || phase !== "idle") return;
    phase = "authorizing";
    startFailed = false;
    ensureAudio();
    pad.disabled = true;
    padTitle.textContent = text().authorizing;
    padNote.textContent = text().waitMoment;
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
      configPanel.classList.add("hidden");
      results.replaceChildren();
      retry.classList.add("hidden");
      startedAt = performance.now();
      api.start();
      status.textContent = text().playing;
      renderAverage();
      armRound();
    } catch {
      phase = "idle";
      startFailed = true;
      pad.disabled = false;
      pad.className = "reaction-pad idle";
      padTitle.textContent = text().failedTitle;
      padNote.textContent = text().failedNote;
      status.textContent = text().failed;
    }
  }

  async function initialize() {
    if (!api?.whenReady) return;
    await api.whenReady();
    config = api.playConfig;
    if (!config) {
      phase = "missing";
      padTitle.textContent = text().missingTitle;
      padNote.textContent = text().tryAgain;
      status.textContent = text().missing;
      return;
    }
    selection = {
      difficultyId: config.defaultDifficultyId,
      variantId: config.defaultVariantId,
    };
    renderConfig();
    phase = "idle";
    pad.disabled = false;
    pad.className = "reaction-pad idle";
    padTitle.textContent = text().clickStart;
    padNote.textContent = text().rounds;
    status.textContent =
      config.difficulties.length > 1 || config.variants.length > 1 ? text().choose : text().ready;
  }

  function renderLocale() {
    const copy = text();
    document.documentElement.lang = locale;
    document.title = copy.name;
    languageToggle.textContent = locale === "ko" ? "English" : "한국어";
    configPanel.setAttribute("aria-label", copy.gameSettings);
    difficultyGroup.setAttribute("aria-label", copy.difficulty);
    variantGroup.setAttribute("aria-label", copy.mode);
    results.setAttribute("aria-label", copy.roundResults);
    retry.textContent = copy.retry;
    difficultyGroup.querySelector(":scope > span").textContent = copy.difficulty;
    variantGroup.querySelector(":scope > span").textContent = copy.mode;
    renderSoundState();
    if (config) renderConfig();
    renderAverage();
    if (phase === "booting") {
      round.textContent = copy.name;
      padTitle.textContent = copy.preparing;
      padNote.textContent = copy.waitMoment;
      status.textContent = copy.preparing;
    } else if (phase === "idle") {
      round.textContent = copy.name;
      padTitle.textContent = startFailed ? copy.failedTitle : copy.clickStart;
      padNote.textContent = startFailed ? copy.failedNote : copy.rounds;
      status.textContent = startFailed
        ? copy.failed
        : config && (config.difficulties.length > 1 || config.variants.length > 1)
          ? copy.choose
          : copy.ready;
    } else if (phase === "authorizing") {
      padTitle.textContent = copy.authorizing;
      padNote.textContent = copy.waitMoment;
      status.textContent = copy.selected;
    } else if (phase === "waiting") {
      round.textContent = copy.round(events.length + 1, waits.length);
      padTitle.textContent = copy.waiting;
      padNote.textContent = copy.waitGreen;
      status.textContent = copy.playing;
    } else if (phase === "go") {
      round.textContent = copy.round(events.length + 1, waits.length);
      padTitle.textContent = copy.go;
      padNote.textContent = "";
      status.textContent = copy.playing;
    } else if (phase === "too-early") {
      padTitle.textContent = copy.early;
      padNote.textContent = copy.tryAgain;
      status.textContent = copy.earlyStatus;
    } else if (phase === "cooldown") {
      const latest = events.at(-1);
      if (latest) padTitle.textContent = `${latest.clickedAtMs - latest.cueAtMs}ms`;
      padNote.textContent = copy.next;
      status.textContent = copy.playing;
    } else if (phase === "finished") {
      padNote.textContent = copy.finished(events.length);
      status.textContent = copy.checking;
    } else if (phase === "missing") {
      padTitle.textContent = copy.missingTitle;
      padNote.textContent = copy.tryAgain;
      status.textContent = copy.missing;
    }
  }

  pad.addEventListener("click", react);
  window.addEventListener("keydown", (event) => {
    if ((event.code === "Space" || event.code === "Enter") && event.target !== soundToggle) {
      event.preventDefault();
      react();
    }
  });
  soundToggle.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    renderSoundState();
    if (soundEnabled) tone(620, 0.08, 0.03, "triangle");
  });
  languageToggle.addEventListener("click", () => {
    locale = locale === "ko" ? "en" : "ko";
    renderLocale();
  });
  retry.addEventListener("click", () => api.restart());
  renderLocale();
  void initialize();
})();
