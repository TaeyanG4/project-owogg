import {
  AIM_RULESET_REVISION,
  AIM_TIMING,
  createAimTargets,
  type AimDifficultyId,
  type AimTarget,
  type AimVariantId,
} from "./rules.js";

export {};

interface PublicOption {
  readonly id: string;
  readonly label: string;
}

interface PublicPlayConfig {
  readonly defaultDifficultyId: string;
  readonly defaultVariantId: string;
  readonly difficulties: readonly PublicOption[];
  readonly variants: readonly PublicOption[];
  readonly allowedConfigs: readonly {
    readonly difficultyId: string;
    readonly variantId: string;
    readonly rewardFactor: number;
  }[];
}

interface StartContext {
  readonly ranked: boolean;
  readonly playConfig: { readonly difficultyId: string; readonly variantId: string };
  readonly rulesetRevision: number;
  readonly challengeSeed: string;
  readonly rewardFactor: number;
}

interface AimEvidenceEvent {
  readonly seq: number;
  readonly tMs: number;
  readonly x: number;
  readonly y: number;
}

declare global {
  interface Window {
    OWOGG?: {
      readonly playConfig: PublicPlayConfig | null;
      whenReady(): Promise<void>;
      requestStart(config: {
        readonly difficultyId: string;
        readonly variantId: string;
      }): Promise<StartContext>;
      start(): void;
      complete(result: {
        readonly evidence: {
          readonly version: 1;
          readonly completedAtMs: number;
          readonly events: readonly AimEvidenceEvent[];
        };
      }): void;
    };
  }
}

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id}`);
  return found as T;
}

const statusEl = element<HTMLParagraphElement>("status");
const setupEl = element<HTMLElement>("setup");
const playEl = element<HTMLElement>("play");
const finishedEl = element<HTMLElement>("finished");
const difficultyEl = element<HTMLSelectElement>("difficulty");
const variantEl = element<HTMLSelectElement>("variant");
const difficultyGroupEl = element<HTMLElement>("difficultyGroup");
const variantGroupEl = element<HTMLElement>("variantGroup");
const startEl = element<HTMLButtonElement>("start");
const arenaEl = element<HTMLDivElement>("arena");
const targetEl = element<HTMLButtonElement>("target");
const progressEl = element<HTMLSpanElement>("progress");
const elapsedEl = element<HTMLSpanElement>("elapsed");
const localTimeEl = element<HTMLParagraphElement>("localTime");

let targets: readonly AimTarget[] = [];
let events: AimEvidenceEvent[] = [];
let roundStartedAt = 0;
let timerId: number | null = null;

function setOptions(select: HTMLSelectElement, options: readonly PublicOption[], selected: string) {
  select.replaceChildren(
    ...options.map((option) => {
      const element = document.createElement("option");
      element.value = option.id;
      element.textContent = option.label;
      element.selected = option.id === selected;
      return element;
    }),
  );
}

function selectedConfig(playConfig: PublicPlayConfig) {
  return playConfig.allowedConfigs.find(
    (candidate) =>
      candidate.difficultyId === difficultyEl.value && candidate.variantId === variantEl.value,
  );
}

function updateStartAvailability(playConfig: PublicPlayConfig): void {
  startEl.disabled = selectedConfig(playConfig) === undefined;
}

function elapsedMs(): number {
  return Math.max(0, Math.round(performance.now() - roundStartedAt));
}

function showTarget(index: number): void {
  const target = targets[index];
  if (!target) return;
  targetEl.style.left = `${target.x * 100}%`;
  targetEl.style.top = `${target.y * 100}%`;
  targetEl.style.width = `${target.radius * 200}%`;
  targetEl.style.height = `${target.radius * 200}%`;
  targetEl.disabled = true;
  targetEl.classList.remove("hidden");
  progressEl.textContent = `${index} / ${targets.length}`;

  const unlockAt =
    index === 0
      ? AIM_TIMING.minFirstHitMs
      : (events.at(-1)?.tMs ?? 0) + AIM_TIMING.minHitIntervalMs;
  window.setTimeout(
    () => {
      if (events.length === index) targetEl.disabled = false;
    },
    Math.max(0, unlockAt - elapsedMs()),
  );
}

function startTimer(): void {
  if (timerId !== null) window.clearInterval(timerId);
  timerId = window.setInterval(() => {
    elapsedEl.textContent = `${elapsedMs()} ms`;
  }, 33);
}

targetEl.addEventListener("pointerdown", (event) => {
  if (targetEl.disabled) return;
  const rect = arenaEl.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const previousTime = events.at(-1)?.tMs ?? -1;
  const tMs = Math.max(previousTime + 1, elapsedMs());
  const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
  events.push({ seq: events.length + 1, tMs, x, y });

  if (events.length < targets.length) {
    showTarget(events.length);
    return;
  }

  targetEl.classList.add("hidden");
  if (timerId !== null) window.clearInterval(timerId);
  timerId = null;
  progressEl.textContent = `${events.length} / ${targets.length}`;
  elapsedEl.textContent = `${tMs} ms`;
  playEl.classList.add("hidden");
  finishedEl.classList.remove("hidden");
  localTimeEl.textContent = `로컬 측정 완료 시간: ${tMs} ms`;
  statusEl.textContent = "플레이 증거를 제출했습니다. 서버 검증 결과를 확인하세요.";
  window.OWOGG?.complete({
    evidence: { version: 1, completedAtMs: tMs, events: [...events] },
  });
});

async function begin(): Promise<void> {
  const api = window.OWOGG;
  const playConfig = api?.playConfig;
  const allowed = playConfig ? selectedConfig(playConfig) : undefined;
  if (!api || !playConfig || !allowed) return;

  startEl.disabled = true;
  difficultyEl.disabled = true;
  variantEl.disabled = true;
  statusEl.textContent = "OWOGG 서버에 선택한 설정 승인을 요청하는 중입니다.";
  try {
    const context = await api.requestStart({
      difficultyId: allowed.difficultyId,
      variantId: allowed.variantId,
    });
    if (
      context.rulesetRevision !== AIM_RULESET_REVISION ||
      context.playConfig.difficultyId !== allowed.difficultyId ||
      context.playConfig.variantId !== allowed.variantId
    ) {
      throw new Error("SERVER_CONTEXT_MISMATCH");
    }

    targets = createAimTargets({
      challengeSeed: context.challengeSeed,
      difficultyId: context.playConfig.difficultyId as AimDifficultyId,
      variantId: context.playConfig.variantId as AimVariantId,
    });
    events = [];
    setupEl.classList.add("hidden");
    finishedEl.classList.add("hidden");
    playEl.classList.remove("hidden");
    roundStartedAt = performance.now();
    statusEl.textContent = "표적을 순서대로 클릭하세요.";
    api.start();
    startTimer();
    showTarget(0);
  } catch {
    statusEl.textContent = "서버가 시작을 승인하지 않았습니다. 플랫폼에서 게임을 다시 여세요.";
  }
}

startEl.addEventListener("click", () => void begin());

async function initialize(): Promise<void> {
  const api = window.OWOGG;
  if (!api?.whenReady) return;
  await api.whenReady();
  const playConfig = api.playConfig;
  if (!playConfig) {
    statusEl.textContent = "게임 준비 정보를 불러오지 못했습니다.";
    return;
  }
  setOptions(difficultyEl, playConfig.difficulties, playConfig.defaultDifficultyId);
  setOptions(variantEl, playConfig.variants, playConfig.defaultVariantId);
  difficultyGroupEl.classList.toggle("hidden", playConfig.difficulties.length <= 1);
  variantGroupEl.classList.toggle("hidden", playConfig.variants.length <= 1);
  difficultyEl.addEventListener("change", () => updateStartAvailability(playConfig));
  variantEl.addEventListener("change", () => updateStartAvailability(playConfig));
  updateStartAvailability(playConfig);
  statusEl.textContent =
    playConfig.difficulties.length > 1 || playConfig.variants.length > 1
      ? "게임 안에서 설정을 고른 뒤 시작하세요."
      : "바로 게임을 시작할 수 있습니다.";
}

void initialize();
