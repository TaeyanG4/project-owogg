(() => {
  "use strict";

  const rules = window.OwoggAimRules;
  const api = window.OWOGG;
  const status = document.querySelector("#status");
  const setup = document.querySelector("#setup");
  const countdown = document.querySelector("#countdown");
  const finished = document.querySelector("#finished");
  const difficultyGroup = document.querySelector("#difficulty-group");
  const difficultyOptions = document.querySelector("#difficulty-options");
  const variantGroup = document.querySelector("#variant-group");
  const variantOptions = document.querySelector("#variant-options");
  const start = document.querySelector("#start");
  const retry = document.querySelector("#retry");
  const arena = document.querySelector("#arena");
  const target = document.querySelector("#target");
  const progress = document.querySelector("#progress");
  const elapsed = document.querySelector("#elapsed");
  const summary = document.querySelector("#summary");
  const resultDetail = document.querySelector("#result-detail");
  const soundToggle = document.querySelector("#sound-toggle");
  const languageToggle = document.querySelector("#language-toggle");

  const TEXT = Object.freeze({
    ko: Object.freeze({
      name: "에임 테스트",
      description: "나타나는 표적을 최대한 빠르고 정확하게 클릭하세요.",
      difficulty: "난이도",
      mode: "모드",
      start: "테스트 시작",
      complete: "테스트 완료",
      retry: "다시 도전",
      soundOn: "소리 켬",
      soundOff: "소리 끔",
      preparing: "게임을 준비하는 중입니다.",
      choose: "게임 안에서 설정을 선택하고 시작하세요.",
      ready: "준비가 끝났습니다.",
      authorizing: "선택한 설정으로 플레이를 준비하고 있습니다.",
      playing: "표적을 순서대로 클릭하세요.",
      checking: "플레이 기록을 안전하게 확인하고 있습니다.",
      failed: "게임을 시작하지 못했습니다. 게임 안의 다시 도전 버튼으로 시도해 주세요.",
      missing: "게임 준비 정보를 불러오지 못했습니다.",
      target: "표적",
      arena: "에임 테스트 표적 영역",
      average: (value) => `표적당 평균 ${value} ms`,
      labels: Object.freeze({ normal: "보통", hard: "어려움", standard: "표준" }),
    }),
    en: Object.freeze({
      name: "Aim Test",
      description: "Click each target as quickly and accurately as you can.",
      difficulty: "Difficulty",
      mode: "Mode",
      start: "Start test",
      complete: "Test complete",
      retry: "Try again",
      soundOn: "Sound on",
      soundOff: "Sound off",
      preparing: "Preparing the game.",
      choose: "Choose your settings inside the game and start.",
      ready: "Ready to play.",
      authorizing: "Preparing the selected settings.",
      playing: "Click the targets in order.",
      checking: "Verifying your play record.",
      failed: "The game could not start. Try again from inside the game.",
      missing: "Game setup information could not be loaded.",
      target: "Target",
      arena: "Aim Test target area",
      average: (value) => `Average ${value} ms per target`,
      labels: Object.freeze({ normal: "Normal", hard: "Hard", standard: "Standard" }),
    }),
  });

  let config = null;
  let selection = null;
  let targets = [];
  let events = [];
  let startedAt = 0;
  let timer = null;
  let soundEnabled = true;
  let audioContext = null;
  let locale = navigator.language.toLowerCase().startsWith("ko") ? "ko" : "en";
  let phase = "booting";
  let finalTime = 0;

  function text() {
    return TEXT[locale];
  }

  function ensureAudio() {
    if (!soundEnabled) return null;
    audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === "suspended") void audioContext.resume();
    return audioContext;
  }

  function tone(frequency, duration = 0.06, volume = 0.035, type = "sine", delay = 0) {
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

  function selectedConfig() {
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
      ...entries.map((option) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = text().labels[option.id] ?? option.label;
        button.classList.toggle("selected", option.id === selection?.[axis]);
        button.addEventListener("click", () => chooseAxis(axis, option.id));
        return button;
      }),
    );
  }

  function renderConfig() {
    if (!config) return;
    difficultyGroup.classList.toggle("hidden", config.difficulties.length <= 1);
    variantGroup.classList.toggle("hidden", config.variants.length <= 1);
    renderAxis(difficultyOptions, config.difficulties, "difficultyId");
    renderAxis(variantOptions, config.variants, "variantId");
    start.disabled = !selectedConfig();
  }

  function elapsedMs() {
    return Math.max(0, Math.round(performance.now() - startedAt));
  }

  function showTarget(index) {
    const item = targets[index];
    if (!item) return;
    target.style.left = `${item.x * 100}%`;
    target.style.top = `${item.y * 100}%`;
    const rect = arena.getBoundingClientRect();
    const diameter = Math.max(26, Math.round(item.radius * 2 * Math.min(rect.width, rect.height)));
    target.style.width = `${diameter}px`;
    target.style.height = `${diameter}px`;
    target.classList.remove("hidden");
    target.disabled = true;
    progress.textContent = `${index + 1} / ${targets.length}`;
    const unlockAt =
      index === 0
        ? rules.TIMING.minFirstHitMs
        : (events.at(-1)?.tMs ?? 0) + rules.TIMING.minHitIntervalMs;
    window.setTimeout(
      () => {
        if (events.length === index) target.disabled = false;
      },
      Math.max(0, unlockAt - elapsedMs()),
    );
  }

  function finish(tMs) {
    phase = "finished";
    finalTime = tMs;
    target.classList.add("hidden");
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    finished.classList.remove("hidden");
    summary.textContent = `${tMs} ms`;
    resultDetail.textContent = text().average(Math.round(tMs / events.length));
    progress.textContent = `${events.length} / ${targets.length}`;
    elapsed.textContent = `${tMs} ms`;
    status.textContent = text().checking;
    tone(523, 0.11, 0.045, "triangle");
    tone(784, 0.16, 0.04, "triangle", 0.09);
    api.complete({ evidence: { version: 1, completedAtMs: tMs, events: [...events] } });
  }

  target.addEventListener("pointerdown", (event) => {
    if (target.disabled) return;
    event.preventDefault();
    const rect = arena.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const previous = events.at(-1)?.tMs ?? -1;
    const tMs = Math.max(previous + 1, elapsedMs());
    const item = targets[events.length];
    if (!item) return;
    // Pointer activation proves the rendered target was hit; submit the server-generated center
    // so a physically circular target remains verifier-equivalent on every arena aspect ratio.
    events.push({ seq: events.length + 1, tMs, x: item.x, y: item.y });
    tone(420 + events.length * 7, 0.045, 0.028, "square");
    if (events.length === targets.length) finish(tMs);
    else showTarget(events.length);
  });

  async function runCountdown() {
    countdown.classList.remove("hidden");
    for (const value of ["3", "2", "1", "GO!"]) {
      countdown.textContent = value;
      tone(value === "GO!" ? 740 : 330, value === "GO!" ? 0.12 : 0.06, 0.03, "triangle");
      await new Promise((resolve) => window.setTimeout(resolve, value === "GO!" ? 450 : 650));
    }
    countdown.classList.add("hidden");
  }

  async function begin() {
    const allowed = selectedConfig();
    if (!config || !allowed) return;
    start.disabled = true;
    ensureAudio();
    difficultyOptions.querySelectorAll("button").forEach((button) => {
      button.disabled = true;
    });
    variantOptions.querySelectorAll("button").forEach((button) => {
      button.disabled = true;
    });
    phase = "authorizing";
    status.textContent = text().authorizing;
    try {
      const context = await api.requestStart({
        difficultyId: allowed.difficultyId,
        variantId: allowed.variantId,
      });
      if (context.rulesetRevision !== rules.RULESET_REVISION) throw new Error("revision");
      targets = rules.createTargets({
        challengeSeed: context.challengeSeed,
        difficultyId: context.playConfig.difficultyId,
        variantId: context.playConfig.variantId,
      });
      if (targets.length === 0) throw new Error("config");
      events = [];
      setup.classList.add("hidden");
      finished.classList.add("hidden");
      await runCountdown();
      phase = "playing";
      startedAt = performance.now();
      api.start();
      status.textContent = text().playing;
      timer = window.setInterval(() => {
        elapsed.textContent = `${elapsedMs()} ms`;
      }, 33);
      showTarget(0);
    } catch {
      phase = "error";
      status.textContent = text().failed;
      start.disabled = false;
      difficultyOptions.querySelectorAll("button").forEach((button) => {
        button.disabled = false;
      });
      variantOptions.querySelectorAll("button").forEach((button) => {
        button.disabled = false;
      });
    }
  }

  async function initialize() {
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
    phase = "ready";
    status.textContent =
      config.difficulties.length > 1 || config.variants.length > 1 ? text().choose : text().ready;
  }

  function renderLocale() {
    const copy = text();
    document.documentElement.lang = locale;
    document.title = copy.name;
    setup.querySelector("h1").textContent = copy.name;
    setup.querySelector("p").textContent = copy.description;
    difficultyGroup.querySelector(":scope > span").textContent = copy.difficulty;
    variantGroup.querySelector(":scope > span").textContent = copy.mode;
    start.textContent = copy.start;
    finished.querySelector(".completion-kicker").textContent = copy.complete;
    retry.textContent = copy.retry;
    target.setAttribute("aria-label", copy.target);
    arena.setAttribute("aria-label", copy.arena);
    difficultyGroup.setAttribute("aria-label", copy.difficulty);
    variantGroup.setAttribute("aria-label", copy.mode);
    if (["booting", "ready", "authorizing", "error", "missing"].includes(phase)) {
      progress.textContent = copy.name;
    }
    languageToggle.textContent = locale === "ko" ? "English" : "한국어";
    renderSoundState();
    if (config) renderConfig();
    if (phase === "booting") status.textContent = copy.preparing;
    else if (phase === "ready") {
      status.textContent =
        config && (config.difficulties.length > 1 || config.variants.length > 1)
          ? copy.choose
          : copy.ready;
    } else if (phase === "authorizing") status.textContent = copy.authorizing;
    else if (phase === "playing") status.textContent = copy.playing;
    else if (phase === "finished") {
      status.textContent = copy.checking;
      resultDetail.textContent = copy.average(Math.round(finalTime / Math.max(1, events.length)));
    } else if (phase === "error") status.textContent = copy.failed;
    else if (phase === "missing") status.textContent = copy.missing;
  }

  start.addEventListener("click", () => void begin());
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
  window.addEventListener("resize", () => {
    if (events.length < targets.length && !target.classList.contains("hidden")) {
      showTarget(events.length);
    }
  });
  renderLocale();
  void initialize();
})();
