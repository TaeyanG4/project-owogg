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

  let config = null;
  let selection = null;
  let waits = [];
  let events = [];
  let startedAt = 0;
  let cueAtMs = 0;
  let phase = "booting";
  let timer = null;

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

  function renderAverage() {
    if (events.length === 0) {
      average.textContent = "";
      return;
    }
    const value = Math.round(
      events.reduce((total, item) => total + item.clickedAtMs - item.cueAtMs, 0) / events.length,
    );
    average.textContent = `평균 ${value} ms`;
    results.replaceChildren(
      ...events.map((item, index) => {
        const chip = document.createElement("span");
        chip.textContent = `R${index + 1} · ${item.clickedAtMs - item.cueAtMs}ms`;
        return chip;
      }),
    );
  }

  function armRound() {
    const index = events.length;
    phase = "waiting";
    pad.disabled = false;
    pad.className = "reaction-pad waiting";
    padTitle.textContent = "기다리세요...";
    padNote.textContent = "초록색이 되면 클릭하세요.";
    round.textContent = `라운드 ${index + 1} / ${waits.length}`;
    timer = window.setTimeout(() => {
      timer = null;
      phase = "go";
      cueAtMs = elapsedMs();
      pad.className = "reaction-pad go";
      padTitle.textContent = "지금 클릭!";
      padNote.textContent = "";
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
    padNote.textContent = `${events.length}라운드 평균`;
    status.textContent = "플레이 기록을 안전하게 확인하고 있습니다.";
    retry.classList.remove("hidden");
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
      padTitle.textContent = "너무 빨랐어요!";
      padNote.textContent = "다시 도전해 주세요.";
      retry.classList.remove("hidden");
      status.textContent = "신호가 나타나기 전에 눌렀습니다.";
      return;
    }
    if (phase !== "go") return;
    phase = "cooldown";
    pad.disabled = true;
    const clickedAtMs = elapsedMs();
    events.push({ seq: events.length + 1, cueAtMs, clickedAtMs });
    renderAverage();
    if (events.length >= waits.length) {
      finish();
      return;
    }
    pad.className = "reaction-pad result";
    padTitle.textContent = `${clickedAtMs - cueAtMs}ms`;
    padNote.textContent = "다음 라운드를 준비합니다.";
    timer = window.setTimeout(armRound, rules.BREAK_MS);
  }

  async function begin() {
    const allowed = allowedSelection();
    if (!allowed || phase !== "idle") return;
    phase = "authorizing";
    pad.disabled = true;
    padTitle.textContent = "플레이 준비 중";
    padNote.textContent = "잠시만 기다려 주세요.";
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
      status.textContent = "초록색 신호에 반응하세요.";
      renderAverage();
      armRound();
    } catch {
      phase = "idle";
      pad.disabled = false;
      pad.className = "reaction-pad idle";
      padTitle.textContent = "클릭하여 다시 시도";
      padNote.textContent = "게임을 시작하지 못했습니다.";
      status.textContent = "게임을 시작하지 못했습니다. 페이지를 새로고침해 다시 시도해 주세요.";
    }
  }

  async function initialize() {
    if (!api?.whenReady) return;
    await api.whenReady();
    config = api.playConfig;
    if (!config) {
      padTitle.textContent = "게임 준비 실패";
      padNote.textContent = "페이지를 새로고침해 주세요.";
      status.textContent = "게임 준비 정보를 불러오지 못했습니다.";
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
    padTitle.textContent = "클릭하여 시작";
    padNote.textContent = "5라운드 진행";
    status.textContent =
      config.difficulties.length > 1 || config.variants.length > 1
        ? "게임 안에서 설정을 선택하고 시작하세요."
        : "바로 눌러 테스트를 시작하세요.";
  }

  pad.addEventListener("click", react);
  window.addEventListener("keydown", (event) => {
    if (event.code === "Space" || event.code === "Enter") {
      event.preventDefault();
      react();
    }
  });
  retry.addEventListener("click", () => window.location.reload());
  void initialize();
})();
