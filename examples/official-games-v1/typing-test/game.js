(() => {
  "use strict";

  const rules = window.OwoggTypingRules;
  const api = window.OWOGG;
  const status = document.querySelector("#status");
  const setup = document.querySelector("#setup");
  const play = document.querySelector("#play");
  const finished = document.querySelector("#finished");
  const difficulty = document.querySelector("#difficulty");
  const variant = document.querySelector("#variant");
  const start = document.querySelector("#start");
  const passage = document.querySelector("#passage");
  const input = document.querySelector("#typing-input");
  const progress = document.querySelector("#progress");
  const accuracy = document.querySelector("#accuracy");
  const elapsed = document.querySelector("#elapsed");
  const submit = document.querySelector("#submit");
  const summary = document.querySelector("#summary");

  let challenge = null;
  let startedAt = 0;
  let timer = null;
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
    return Math.max(1, Math.round(performance.now() - startedAt));
  }

  function renderInput() {
    if (!challenge) return;
    const expected = Array.from(challenge.text);
    const typed = Array.from(input.value);
    let matches = 0;
    for (let index = 0; index < Math.min(expected.length, typed.length); index += 1)
      if (expected[index] === typed[index]) matches += 1;
    const denominator = Math.max(expected.length, typed.length, 1);
    progress.textContent = `${typed.length} / ${expected.length}`;
    accuracy.textContent = `${Math.round((matches / denominator) * 100)}%`;
    submit.disabled = completed || input.value !== challenge.text;
  }

  function complete() {
    if (!challenge || completed || input.value !== challenge.text) return;
    completed = true;
    const completedAtMs = elapsedMs();
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    input.disabled = true;
    submit.disabled = true;
    play.classList.add("hidden");
    finished.classList.remove("hidden");
    const facts = rules.calculateFacts(challenge.text, completedAtMs);
    summary.textContent = `로컬 측정 ${facts.wpm} WPM · ${facts.cpm} CPM · ${(completedAtMs / 1000).toFixed(1)}초`;
    status.textContent = "evidence를 제출했습니다. 서버 검증 결과를 확인하세요.";
    api.complete({
      evidence: {
        version: 1,
        passageId: challenge.passageId,
        typedText: input.value,
        completedAtMs,
      },
    });
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
      challenge = rules.createChallenge({
        challengeSeed: context.challengeSeed,
        difficultyId: context.playConfig.difficultyId,
        variantId: context.playConfig.variantId,
      });
      if (!challenge) throw new Error("config");
      completed = false;
      input.value = "";
      passage.textContent = challenge.text;
      setup.classList.add("hidden");
      finished.classList.add("hidden");
      play.classList.remove("hidden");
      startedAt = performance.now();
      api.start();
      status.textContent = "문장을 똑같이 입력하세요.";
      renderInput();
      input.focus();
      timer = window.setInterval(() => {
        elapsed.textContent = `${(elapsedMs() / 1000).toFixed(1)}s`;
      }, 100);
    } catch {
      status.textContent = "서버가 시작을 승인하지 않았습니다. 플랫폼에서 게임을 다시 여세요.";
    }
  }

  input.addEventListener("input", renderInput);
  submit.addEventListener("click", complete);
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
    status.textContent = "난이도와 언어를 고른 뒤 시작하세요.";
  }
})();
