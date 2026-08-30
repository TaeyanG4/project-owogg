(() => {
  "use strict";

  const rules = window.OwoggAimRules;
  const api = window.OWOGG;
  const status = document.querySelector("#status");
  const setup = document.querySelector("#setup");
  const play = document.querySelector("#play");
  const finished = document.querySelector("#finished");
  const difficulty = document.querySelector("#difficulty");
  const variant = document.querySelector("#variant");
  const start = document.querySelector("#start");
  const arena = document.querySelector("#arena");
  const target = document.querySelector("#target");
  const progress = document.querySelector("#progress");
  const elapsed = document.querySelector("#elapsed");
  const summary = document.querySelector("#summary");

  let targets = [];
  let events = [];
  let startedAt = 0;
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

  function showTarget(index) {
    const item = targets[index];
    if (!item) return;
    target.style.left = `${item.x * 100}%`;
    target.style.top = `${item.y * 100}%`;
    target.style.width = `${item.radius * 200}%`;
    target.style.height = `${item.radius * 200}%`;
    target.classList.remove("hidden");
    target.disabled = true;
    progress.textContent = `${index} / ${targets.length}`;
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
    target.classList.add("hidden");
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    play.classList.add("hidden");
    finished.classList.remove("hidden");
    progress.textContent = `${events.length} / ${targets.length}`;
    elapsed.textContent = `${tMs} ms`;
    summary.textContent = `로컬 측정 ${tMs} ms · 표적 ${events.length}개`;
    status.textContent = "evidence를 제출했습니다. 서버 검증 결과를 확인하세요.";
    api.complete({ evidence: { version: 1, completedAtMs: tMs, events: [...events] } });
  }

  target.addEventListener("pointerdown", (event) => {
    if (target.disabled) return;
    event.preventDefault();
    const rect = arena.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const previous = events.at(-1)?.tMs ?? -1;
    const tMs = Math.max(previous + 1, elapsedMs());
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    events.push({ seq: events.length + 1, tMs, x, y });
    if (events.length === targets.length) finish(tMs);
    else showTarget(events.length);
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
      targets = rules.createTargets({
        challengeSeed: context.challengeSeed,
        difficultyId: context.playConfig.difficultyId,
        variantId: context.playConfig.variantId,
      });
      if (targets.length === 0) throw new Error("config");
      events = [];
      setup.classList.add("hidden");
      finished.classList.add("hidden");
      play.classList.remove("hidden");
      startedAt = performance.now();
      api.start();
      status.textContent = "표적을 순서대로 클릭하세요.";
      timer = window.setInterval(() => {
        elapsed.textContent = `${elapsedMs()} ms`;
      }, 33);
      showTarget(0);
    } catch {
      status.textContent = "서버가 시작을 승인하지 않았습니다. 플랫폼에서 게임을 다시 여세요.";
    }
  }

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
