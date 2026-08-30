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

  let config = null;
  let selection = null;
  let targets = [];
  let events = [];
  let startedAt = 0;
  let timer = null;

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
        button.textContent = option.label;
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
    target.style.width = `${item.radius * 200}%`;
    target.style.height = `${item.radius * 200}%`;
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
    target.classList.add("hidden");
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    finished.classList.remove("hidden");
    summary.textContent = `${tMs} ms`;
    resultDetail.textContent = `표적당 평균 ${Math.round(tMs / events.length)} ms`;
    progress.textContent = `${events.length} / ${targets.length}`;
    elapsed.textContent = `${tMs} ms`;
    status.textContent = "플레이 기록을 안전하게 확인하고 있습니다.";
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

  async function runCountdown() {
    countdown.classList.remove("hidden");
    for (const value of ["3", "2", "1", "GO!"]) {
      countdown.textContent = value;
      await new Promise((resolve) => window.setTimeout(resolve, value === "GO!" ? 450 : 650));
    }
    countdown.classList.add("hidden");
  }

  async function begin() {
    const allowed = selectedConfig();
    if (!config || !allowed) return;
    start.disabled = true;
    difficultyOptions.querySelectorAll("button").forEach((button) => {
      button.disabled = true;
    });
    variantOptions.querySelectorAll("button").forEach((button) => {
      button.disabled = true;
    });
    status.textContent = "선택한 설정으로 플레이를 준비하고 있습니다.";
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
      startedAt = performance.now();
      api.start();
      status.textContent = "표적을 순서대로 클릭하세요.";
      timer = window.setInterval(() => {
        elapsed.textContent = `${elapsedMs()} ms`;
      }, 33);
      showTarget(0);
    } catch {
      status.textContent = "게임을 시작하지 못했습니다. 페이지를 새로고침해 다시 시도해 주세요.";
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
      status.textContent = "게임 준비 정보를 불러오지 못했습니다.";
      return;
    }
    selection = {
      difficultyId: config.defaultDifficultyId,
      variantId: config.defaultVariantId,
    };
    renderConfig();
    status.textContent =
      config.difficulties.length > 1 || config.variants.length > 1
        ? "게임 안에서 설정을 선택하고 시작하세요."
        : "준비가 끝났습니다.";
  }

  start.addEventListener("click", () => void begin());
  retry.addEventListener("click", () => window.location.reload());
  void initialize();
})();
