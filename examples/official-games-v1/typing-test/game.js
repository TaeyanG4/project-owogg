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

  let config = null;
  let challenge = null;
  let startedAt = 0;
  let timer = null;
  let completed = false;
  let typingStarted = false;

  function labelFor(entries, id) {
    return entries.find((entry) => entry.id === id)?.label ?? id;
  }

  function configLabel(item) {
    if (!config) return { title: "기본", detail: "" };
    const parts = [];
    if (config.variants.length > 1) parts.push(labelFor(config.variants, item.variantId));
    if (config.difficulties.length > 1)
      parts.push(labelFor(config.difficulties, item.difficultyId));
    return {
      title: parts.join(" · ") || "바로 시작",
      detail:
        config.variants.length > 1 && config.difficulties.length > 1
          ? `${labelFor(config.variants, item.variantId)} / ${labelFor(config.difficulties, item.difficultyId)}`
          : "선택한 설정으로 시작합니다.",
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
    inputNote.textContent = `${live.typed} / ${expected.length}자`;
  }

  function updateClock() {
    elapsed.textContent = `${(elapsedMs() / 1000).toFixed(1)}초`;
    renderPassage();
  }

  function complete() {
    if (!challenge || completed || input.value !== challenge.text) return;
    completed = true;
    const completedAtMs = elapsedMs();
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    input.disabled = true;
    const facts = rules.calculateFacts(challenge.text, completedAtMs);
    play.classList.add("hidden");
    finished.classList.remove("hidden");
    summary.textContent = `${facts.wpm} WPM`;
    resultDetail.textContent = `${facts.cpm} CPM · 정확도 100% · ${(completedAtMs / 1000).toFixed(1)}초`;
    status.textContent = "플레이 기록을 안전하게 확인하고 있습니다.";
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
      startedAt = performance.now();
      api.start();
      timer = window.setInterval(updateClock, 100);
      status.textContent = "문장을 똑같이 입력하세요.";
    }
    renderPassage();
    if (input.value === challenge.text) complete();
  }

  async function begin(allowed) {
    modeOptions.querySelectorAll("button").forEach((button) => {
      button.disabled = true;
    });
    setupNote.textContent = "선택한 모드로 플레이를 준비하고 있습니다.";
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
      elapsed.textContent = "0.0초";
      setup.classList.add("hidden");
      finished.classList.add("hidden");
      play.classList.remove("hidden");
      renderPassage();
      status.textContent = "키보드를 눌러 테스트를 시작하세요.";
      input.focus();
    } catch {
      setupNote.textContent = "게임을 시작하지 못했습니다. 페이지를 새로고침해 주세요.";
      status.textContent = "게임을 시작하지 못했습니다.";
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
    setupNote.textContent = hasChoice
      ? "게임 안에서 언어와 지문 길이를 선택하세요."
      : "바로 플레이를 준비하고 있습니다.";
    status.textContent = hasChoice
      ? "게임 안에서 모드를 선택하고 시작하세요."
      : "게임 플레이를 준비하고 있습니다.";
    if (!hasChoice) void begin(config.allowedConfigs[0]);
  }

  async function initialize() {
    if (!api?.whenReady) return;
    await api.whenReady();
    config = api.playConfig;
    if (!config) {
      setupNote.textContent = "게임 준비 정보를 불러오지 못했습니다.";
      status.textContent = "게임 준비 정보를 불러오지 못했습니다.";
      return;
    }
    renderModes();
  }

  input.addEventListener("input", handleInput);
  input.addEventListener("paste", (event) => event.preventDefault());
  passageCard.addEventListener("click", () => input.focus());
  retry.addEventListener("click", () => window.location.reload());
  void initialize();
})();
