(() => {
  "use strict";

  const rules = window.OwoggTypingRules;
  const api = window.OWOGG;
  const setup = document.querySelector("#setup");
  const setupNote = document.querySelector("#setup-note");
  const modeOptions = document.querySelector("#mode-options");
  const play = document.querySelector("#play");
  const finished = document.querySelector("#finished");
  const passage = document.querySelector("#passage");
  const passageSource = document.querySelector("#passage-source");
  const passageCard = document.querySelector("#passage-card");
  const input = document.querySelector("#typing-input");
  const inputNote = document.querySelector("#input-note");
  const elapsed = document.querySelector("#elapsed");
  const wpm = document.querySelector("#wpm");
  const cpm = document.querySelector("#cpm");
  const accuracy = document.querySelector("#accuracy");
  const summary = document.querySelector("#summary");
  const resultDetail = document.querySelector("#result-detail");
  const retry = document.querySelector("#retry");
  const status = document.querySelector("#status");
  const soundToggle = document.querySelector("#sound-toggle");
  const languageToggle = document.querySelector("#language-toggle");
  const elapsedLabel = document.querySelector("#elapsed-label");
  const wpmLabel = document.querySelector("#wpm-label");
  const cpmLabel = document.querySelector("#cpm-label");
  const accuracyLabel = document.querySelector("#accuracy-label");

  const TEXT = Object.freeze({
    ko: Object.freeze({
      name: "타자 속도 테스트",
      preparing: "게임을 준비하는 중입니다.",
      chooseLanguage: "게임 안에서 언어를 선택하세요. 모든 언어는 긴 지문으로 진행됩니다.",
      chooseStatus: "게임 안에서 언어를 선택하고 시작하세요.",
      authorizing: "선택한 언어로 플레이를 준비하고 있습니다.",
      ready: "키보드를 눌러 테스트를 시작하세요.",
      typing: "문장을 똑같이 입력하세요.",
      complete: "입력 완료",
      retry: "다시 도전하기",
      checking: "플레이 기록을 안전하게 확인하고 있습니다.",
      failed: "게임을 시작하지 못했습니다. 게임 안에서 다시 시도해 주세요.",
      missing: "게임 준비 정보를 불러오지 못했습니다.",
      detail: "긴 지문으로 타자 속도를 측정합니다.",
      elapsed: "경과 시간",
      wpm: "속도 (WPM)",
      cpm: "타수 (CPM)",
      accuracy: "정확도",
      soundOn: "소리 켬",
      soundOff: "소리 끔",
      playArea: "타자 테스트",
      inputLabel: "표시된 문장 입력",
      seconds: (value) => `${value}초`,
      count: (typed, total) => `${typed} / ${total}자`,
      result: (facts, seconds) => `${facts.cpm} CPM · 정확도 100% · ${seconds}초`,
    }),
    en: Object.freeze({
      name: "Typing Speed Test",
      preparing: "Preparing the game.",
      chooseLanguage: "Choose a language inside the game. Every option uses a long passage.",
      chooseStatus: "Choose a language inside the game to begin.",
      authorizing: "Preparing the selected language.",
      ready: "Press a key to start the test.",
      typing: "Type the passage exactly as shown.",
      complete: "Typing complete",
      retry: "Try again",
      checking: "Verifying your play record.",
      failed: "The game could not start. Try again from inside the game.",
      missing: "Game setup information could not be loaded.",
      detail: "Measure your speed with a long passage.",
      elapsed: "Elapsed time",
      wpm: "Speed (WPM)",
      cpm: "Characters (CPM)",
      accuracy: "Accuracy",
      soundOn: "Sound on",
      soundOff: "Sound off",
      playArea: "Typing test",
      inputLabel: "Type the displayed passage",
      seconds: (value) => `${value}s`,
      count: (typed, total) => `${typed} / ${total} chars`,
      result: (facts, seconds) => `${facts.cpm} CPM · 100% accuracy · ${seconds}s`,
    }),
  });

  let config = null;
  let challenge = null;
  let startedAt = 0;
  let timer = null;
  let completed = false;
  let typingStarted = false;
  let soundEnabled = true;
  let audioContext = null;
  let lastKeyToneAt = 0;
  let locale = navigator.language.toLowerCase().startsWith("ko") ? "ko" : "en";
  let phase = "booting";
  let finalFacts = null;
  let finalSeconds = "0.0";

  function text() {
    return TEXT[locale];
  }

  function ensureAudio() {
    if (!soundEnabled) return null;
    audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === "suspended") void audioContext.resume();
    return audioContext;
  }

  function tone(frequency, duration = 0.045, volume = 0.018, type = "triangle", delay = 0) {
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

  function labelFor(entries, id) {
    return entries.find((entry) => entry.id === id)?.label ?? id;
  }

  function configLabel(item) {
    if (!config) return { title: "기본", detail: "" };
    return {
      title: labelFor(config.variants, item.variantId),
      detail: text().detail,
    };
  }

  function elapsedMs() {
    return Math.max(1, Math.round(performance.now() - startedAt));
  }

  function calculateLiveStats() {
    if (!challenge) return { correct: 0, typed: 0, cpm: 0, wpm: 0, accuracy: 100 };
    const expected = Array.from(challenge.text);
    const typed = Array.from(input.value);
    let correct = 0;
    for (let index = 0; index < typed.length; index += 1) {
      if (typed[index] === expected[index]) correct += 1;
    }
    const duration = elapsedMs();
    const liveCpm = typingStarted ? Math.round((typed.length * 60_000) / duration) : 0;
    return {
      correct,
      typed: typed.length,
      cpm: liveCpm,
      wpm: typingStarted ? Math.round((correct * 12_000) / duration) : 0,
      accuracy: typed.length === 0 ? 100 : Math.round((correct / typed.length) * 100),
    };
  }

  function renderPassage() {
    if (!challenge) return;
    const expected = Array.from(challenge.text);
    const typed = Array.from(input.value);
    passage.replaceChildren(
      ...expected.map((expectedCharacter, index) => {
        const character = document.createElement("span");
        const actualCharacter = typed[index];
        character.textContent = expectedCharacter === " " ? "\u00a0" : expectedCharacter;
        if (actualCharacter !== undefined) {
          character.className = actualCharacter === expectedCharacter ? "correct" : "incorrect";
          if (actualCharacter !== expectedCharacter) {
            character.textContent = actualCharacter === " " ? "␣" : actualCharacter;
          }
        } else if (index === typed.length && !completed) {
          character.className = "current";
        }
        return character;
      }),
    );
    const live = calculateLiveStats();
    wpm.textContent = String(live.wpm);
    cpm.textContent = String(live.cpm);
    accuracy.textContent = `${live.accuracy}%`;
    inputNote.textContent = text().count(live.typed, expected.length);
  }

  function updateClock() {
    elapsed.textContent = text().seconds((elapsedMs() / 1000).toFixed(1));
    renderPassage();
  }

  function complete() {
    if (!challenge || completed || input.value !== challenge.text) return;
    completed = true;
    phase = "finished";
    const completedAtMs = elapsedMs();
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    input.disabled = true;
    const facts = rules.calculateFacts(challenge.text, completedAtMs);
    finalFacts = facts;
    finalSeconds = (completedAtMs / 1000).toFixed(1);
    play.classList.add("hidden");
    finished.classList.remove("hidden");
    summary.textContent = `${facts.wpm} WPM`;
    resultDetail.textContent = text().result(facts, finalSeconds);
    status.textContent = text().checking;
    tone(523, 0.1, 0.035, "triangle");
    tone(784, 0.17, 0.035, "triangle", 0.1);
    api.complete({
      evidence: {
        version: 1,
        passageId: challenge.passageId,
        typedText: input.value,
        completedAtMs,
      },
    });
  }

  function handleInput() {
    if (!challenge || completed) return;
    if (!typingStarted && input.value.length > 0) {
      typingStarted = true;
      phase = "typing";
      startedAt = performance.now();
      api.start();
      timer = window.setInterval(updateClock, 100);
      status.textContent = text().typing;
      tone(440, 0.07, 0.025);
    }
    const now = performance.now();
    if (input.value.length > 0 && now - lastKeyToneAt >= 45) {
      lastKeyToneAt = now;
      tone(270 + (input.value.length % 5) * 22, 0.025, 0.008, "square");
    }
    renderPassage();
    if (input.value === challenge.text) complete();
  }

  async function begin(allowed) {
    modeOptions.querySelectorAll("button").forEach((button) => {
      button.disabled = true;
    });
    phase = "authorizing";
    setupNote.textContent = text().authorizing;
    ensureAudio();
    try {
      const context = await api.requestStart({
        difficultyId: allowed.difficultyId,
        variantId: allowed.variantId,
      });
      if (context.rulesetRevision !== rules.RULESET_REVISION) throw new Error("revision");
      challenge = rules.createChallenge({
        challengeSeed: context.challengeSeed,
        difficultyId: context.playConfig.difficultyId,
        variantId: context.playConfig.variantId,
      });
      if (!challenge) throw new Error("config");
      completed = false;
      typingStarted = false;
      input.value = "";
      input.disabled = false;
      elapsed.textContent = text().seconds("0.0");
      setup.classList.add("hidden");
      finished.classList.add("hidden");
      play.classList.remove("hidden");
      passageSource.textContent = challenge.source;
      renderPassage();
      phase = "ready";
      status.textContent = text().ready;
      input.focus();
    } catch {
      phase = "error";
      setupNote.textContent = text().failed;
      status.textContent = text().failed;
      modeOptions.querySelectorAll("button").forEach((button) => {
        button.disabled = false;
      });
    }
  }

  function renderModes() {
    if (!config) return;
    const hasChoice = config.allowedConfigs.length > 1;
    modeOptions.classList.toggle("hidden", !hasChoice);
    modeOptions.replaceChildren(
      ...config.allowedConfigs.map((allowed) => {
        const labels = configLabel(allowed);
        const button = document.createElement("button");
        button.type = "button";
        const title = document.createElement("strong");
        const detail = document.createElement("span");
        title.textContent = labels.title;
        detail.textContent = labels.detail;
        button.append(title, detail);
        button.addEventListener("click", () => void begin(allowed));
        return button;
      }),
    );
    setupNote.textContent = hasChoice ? text().chooseLanguage : text().preparing;
    status.textContent = hasChoice ? text().chooseStatus : text().preparing;
    if (!hasChoice) void begin(config.allowedConfigs[0]);
  }

  async function initialize() {
    if (!api?.whenReady) return;
    await api.whenReady();
    config = api.playConfig;
    if (!config) {
      phase = "missing";
      setupNote.textContent = text().missing;
      status.textContent = text().missing;
      return;
    }
    phase = "selecting";
    renderModes();
  }

  function renderLocale() {
    const copy = text();
    document.documentElement.lang = locale;
    document.title = copy.name;
    setup.querySelector("h1").textContent = copy.name;
    elapsedLabel.textContent = copy.elapsed;
    wpmLabel.textContent = copy.wpm;
    cpmLabel.textContent = copy.cpm;
    accuracyLabel.textContent = copy.accuracy;
    finished.querySelector(":scope > span").textContent = copy.complete;
    retry.textContent = copy.retry;
    languageToggle.textContent = locale === "ko" ? "English" : "한국어";
    play.setAttribute("aria-label", copy.playArea);
    input.setAttribute("aria-label", copy.inputLabel);
    renderSoundState();
    if (phase === "booting") {
      setupNote.textContent = copy.preparing;
      status.textContent = copy.preparing;
    } else if (phase === "selecting") renderModes();
    else if (phase === "authorizing") {
      setupNote.textContent = copy.authorizing;
      status.textContent = copy.authorizing;
    } else if (phase === "ready") {
      elapsed.textContent = copy.seconds("0.0");
      status.textContent = copy.ready;
      renderPassage();
    } else if (phase === "typing") {
      status.textContent = copy.typing;
      updateClock();
    } else if (phase === "finished") {
      status.textContent = copy.checking;
      if (finalFacts) resultDetail.textContent = copy.result(finalFacts, finalSeconds);
    } else if (phase === "error") {
      setupNote.textContent = copy.failed;
      status.textContent = copy.failed;
    } else if (phase === "missing") {
      setupNote.textContent = copy.missing;
      status.textContent = copy.missing;
    }
  }

  input.addEventListener("input", handleInput);
  input.addEventListener("paste", (event) => event.preventDefault());
  passageCard.addEventListener("click", () => input.focus());
  soundToggle.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    renderSoundState();
    if (soundEnabled) tone(620, 0.08, 0.025);
  });
  languageToggle.addEventListener("click", () => {
    locale = locale === "ko" ? "en" : "ko";
    renderLocale();
  });
  retry.addEventListener("click", () => api.restart());
  renderLocale();
  void initialize();
})();
