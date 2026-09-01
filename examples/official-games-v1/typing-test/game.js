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
  const previousLines = document.querySelector("#previous-lines");
  const nextLines = document.querySelector("#next-lines");
  const passageCard = document.querySelector("#passage-card");
  const input = document.querySelector("#typing-input");
  const inputNote = document.querySelector("#input-note");
  const elapsed = document.querySelector("#elapsed");
  const score = document.querySelector("#score");
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
  const scoreLabel = document.querySelector("#score-label");
  const wpmLabel = document.querySelector("#wpm-label");
  const cpmLabel = document.querySelector("#cpm-label");
  const accuracyLabel = document.querySelector("#accuracy-label");

  const TEXT = Object.freeze({
    ko: Object.freeze({
      name: "타자 속도 테스트",
      preparing: "게임을 준비하는 중입니다.",
      chooseLanguage: "언어를 선택하세요.",
      chooseStatus: "게임 안에서 언어를 선택하고 시작하세요.",
      authorizing: "선택한 언어로 플레이를 준비하고 있습니다.",
      ready: "90초 동안 한 줄씩 정확하게 입력하세요.",
      typing: "현재 줄을 완성하면 다음 줄로 자동 이동합니다.",
      complete: "입력 완료",
      retry: "다시 도전하기",
      checking: "플레이 기록을 안전하게 확인하고 있습니다.",
      failed: "게임을 시작하지 못했습니다. 게임 안에서 다시 시도해 주세요.",
      missing: "게임 준비 정보를 불러오지 못했습니다.",
      elapsed: "남은 시간",
      score: "종합 점수",
      wpm: "속도 (WPM)",
      cpm: "타수 (CPM)",
      accuracy: "정확도",
      soundOn: "소리 켬",
      soundOff: "소리 끔",
      playArea: "타자 테스트",
      inputLabel: "표시된 문장 입력",
      inputPlaceholder: "여기에 현재 줄을 입력하세요",
      allLinesComplete: "모든 줄을 입력했습니다. 90초가 끝날 때까지 기다려 주세요.",
      seconds: (value) => `${value}초`,
      count: (typed, total) => `${typed} / ${total}자`,
      scoreResult: (value) => `${value}점`,
      result: (facts) => `${facts.wpm} WPM · ${facts.cpm} CPM · 정확도 ${facts.accuracy}%`,
    }),
    en: Object.freeze({
      name: "Typing Speed Test",
      preparing: "Preparing the game.",
      chooseLanguage: "Choose a language.",
      chooseStatus: "Choose a language inside the game to begin.",
      authorizing: "Preparing the selected language.",
      ready: "Type one line at a time for 90 seconds.",
      typing: "Completing the current line advances to the next one.",
      complete: "Typing complete",
      retry: "Try again",
      checking: "Verifying your play record.",
      failed: "The game could not start. Try again from inside the game.",
      missing: "Game setup information could not be loaded.",
      elapsed: "Time left",
      score: "Overall score",
      wpm: "Speed (WPM)",
      cpm: "Characters (CPM)",
      accuracy: "Accuracy",
      soundOn: "Sound on",
      soundOff: "Sound off",
      playArea: "Typing test",
      inputLabel: "Type the displayed passage",
      inputPlaceholder: "Type the current line here",
      allLinesComplete: "All lines are complete. Please wait for the 90-second timer.",
      seconds: (value) => `${value}s`,
      count: (typed, total) => `${typed} / ${total} chars`,
      scoreResult: (value) => `${value} pts`,
      result: (facts) => `${facts.wpm} WPM · ${facts.cpm} CPM · ${facts.accuracy}% accuracy`,
    }),
  });

  let config = null;
  let challenge = null;
  let startedAt = 0;
  let timer = null;
  let finishTimer = null;
  let completed = false;
  let lineIndex = 0;
  let completedLines = [];
  let soundEnabled = true;
  let audioContext = null;
  let lastKeyToneAt = 0;
  let locale = navigator.language.toLowerCase().startsWith("ko") ? "ko" : "en";
  let phase = "booting";
  let finalFacts = null;

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
    if (!config) return "기본";
    return labelFor(config.variants, item.variantId);
  }

  function elapsedMs() {
    return Math.max(1, Math.round(performance.now() - startedAt));
  }

  function evidenceLines() {
    const lines = completedLines.map((typedText, index) => ({ index, typedText }));
    if (challenge && lineIndex < challenge.lines.length) {
      lines.push({ index: lineIndex, typedText: input.value });
    }
    return lines;
  }

  function calculateLiveStats() {
    if (!challenge) {
      return { score: 0, typedChars: 0, correctChars: 0, cpm: 0, wpm: 0, accuracy: 100 };
    }
    const duration = Math.min(rules.DURATION_MS, elapsedMs());
    const facts = rules.calculateFacts(
      challenge.lines.map((line) => line.text),
      evidenceLines(),
      duration,
    );
    return facts.typedChars === 0 ? { ...facts, accuracy: 100 } : facts;
  }

  function renderLineStack(container, lines) {
    container.replaceChildren(
      ...lines.map((line) => {
        const row = document.createElement("p");
        row.textContent = line.text;
        return row;
      }),
    );
  }

  function renderPassage() {
    if (!challenge) return;
    const currentLine = challenge.lines[lineIndex];
    if (!currentLine) return;
    const expected = Array.from(currentLine.text);
    const typed = Array.from(input.value);
    input.maxLength = currentLine.text.length;
    passageSource.textContent = currentLine.source;
    renderLineStack(previousLines, challenge.lines.slice(Math.max(0, lineIndex - 2), lineIndex));
    renderLineStack(nextLines, challenge.lines.slice(lineIndex + 1, lineIndex + 4));
    passage.replaceChildren(
      ...expected.map((expectedCharacter, index) => {
        const character = document.createElement("span");
        const actualCharacter = typed[index];
        character.textContent = expectedCharacter === " " ? "\u00a0" : expectedCharacter;
        if (actualCharacter !== undefined) {
          character.className = actualCharacter === expectedCharacter ? "correct" : "incorrect";
        } else if (index === typed.length && !completed) {
          character.className = "current";
        }
        return character;
      }),
    );
    const live = calculateLiveStats();
    score.textContent = String(live.score);
    wpm.textContent = String(live.wpm);
    cpm.textContent = String(live.cpm);
    accuracy.textContent = `${live.accuracy}%`;
    inputNote.textContent = `${text().count(typed.length, expected.length)} · ${lineIndex + 1} / ${challenge.lines.length}`;
  }

  function updateClock() {
    const remaining = Math.max(0, rules.DURATION_MS - elapsedMs());
    elapsed.textContent = text().seconds((remaining / 1000).toFixed(1));
    renderPassage();
  }

  function complete() {
    if (!challenge || completed) return;
    completed = true;
    phase = "finished";
    const completedAtMs = Math.min(
      rules.DURATION_MS + 1000,
      Math.max(rules.DURATION_MS, elapsedMs()),
    );
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    if (finishTimer !== null) window.clearTimeout(finishTimer);
    finishTimer = null;
    input.disabled = true;
    const lines = evidenceLines();
    const facts = rules.calculateFacts(
      challenge.lines.map((line) => line.text),
      lines,
      completedAtMs,
    );
    finalFacts = facts;
    play.classList.add("hidden");
    finished.classList.remove("hidden");
    summary.textContent = text().scoreResult(facts.score);
    resultDetail.textContent = text().result(facts);
    status.textContent = text().checking;
    tone(523, 0.1, 0.035, "triangle");
    tone(784, 0.17, 0.035, "triangle", 0.1);
    api.complete({
      evidence: {
        version: 2,
        passageId: challenge.passageId,
        lines,
        completedAtMs,
      },
    });
  }

  function handleInput() {
    if (!challenge || completed) return;
    const now = performance.now();
    if (input.value.length > 0 && now - lastKeyToneAt >= 45) {
      lastKeyToneAt = now;
      tone(270 + (input.value.length % 5) * 22, 0.025, 0.008, "square");
    }
    renderPassage();
    const currentLine = challenge.lines[lineIndex];
    if (currentLine && input.value === currentLine.text) {
      completedLines.push(currentLine.text);
      lineIndex += 1;
      input.value = "";
      tone(520, 0.045, 0.016, "triangle");
      if (lineIndex >= challenge.lines.length) {
        phase = "waiting-finish";
        input.disabled = true;
        passage.textContent = text().allLinesComplete;
        previousLines.replaceChildren();
        nextLines.replaceChildren();
        status.textContent = text().allLinesComplete;
        return;
      }
      renderPassage();
    }
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
      passageCard.dataset.variant = context.playConfig.variantId;
      passage.lang = context.playConfig.variantId;
      previousLines.lang = context.playConfig.variantId;
      nextLines.lang = context.playConfig.variantId;
      input.lang = context.playConfig.variantId;
      completed = false;
      lineIndex = 0;
      completedLines = [];
      input.value = "";
      input.disabled = false;
      elapsed.textContent = text().seconds((rules.DURATION_MS / 1000).toFixed(1));
      setup.classList.add("hidden");
      finished.classList.add("hidden");
      play.classList.remove("hidden");
      startedAt = performance.now();
      phase = "typing";
      api.start();
      timer = window.setInterval(updateClock, 100);
      finishTimer = window.setTimeout(complete, rules.DURATION_MS);
      tone(440, 0.07, 0.025);
      renderPassage();
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
        const button = document.createElement("button");
        button.type = "button";
        const title = document.createElement("strong");
        title.textContent = configLabel(allowed);
        button.append(title);
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
    scoreLabel.textContent = copy.score;
    wpmLabel.textContent = copy.wpm;
    cpmLabel.textContent = copy.cpm;
    accuracyLabel.textContent = copy.accuracy;
    finished.querySelector(":scope > span").textContent = copy.complete;
    retry.textContent = copy.retry;
    languageToggle.textContent = locale === "ko" ? "English" : "한국어";
    play.setAttribute("aria-label", copy.playArea);
    input.setAttribute("aria-label", copy.inputLabel);
    input.placeholder = copy.inputPlaceholder;
    renderSoundState();
    if (phase === "booting") {
      setupNote.textContent = copy.preparing;
      status.textContent = copy.preparing;
    } else if (phase === "selecting") renderModes();
    else if (phase === "authorizing") {
      setupNote.textContent = copy.authorizing;
      status.textContent = copy.authorizing;
    } else if (phase === "typing") {
      status.textContent = copy.typing;
      updateClock();
    } else if (phase === "waiting-finish") {
      passage.textContent = copy.allLinesComplete;
      status.textContent = copy.allLinesComplete;
      updateClock();
    } else if (phase === "finished") {
      status.textContent = copy.checking;
      if (finalFacts) {
        summary.textContent = copy.scoreResult(finalFacts.score);
        resultDetail.textContent = copy.result(finalFacts);
      }
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
