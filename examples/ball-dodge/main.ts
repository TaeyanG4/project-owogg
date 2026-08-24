/** 공 피하기 — dependency-free `window.OWOGG` Game Creator Manifest v1 integration example. */

export {};

declare global {
  interface Window {
    OWOGG?: {
      start(): void;
      complete(result: {
        outcome?: "failure";
        score?: number;
        metrics?: Record<string, number>;
      }): void;
    };
  }
}

const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const timerEl = document.getElementById("timer")!;
const overlayEl = document.getElementById("overlay")!;
const gameOverEl = document.getElementById("gameOver")!;
const finalTimeEl = document.getElementById("finalTime")!;
const startButton = document.getElementById("startButton")!;
const restartButton = document.getElementById("restartButton")!;

const PLAYER_RADIUS = 12;
const PLAYER_SPEED = 300; // px/sec
const BALL_MIN_RADIUS = 7;
const BALL_MAX_RADIUS = 16;
const BASE_BALL_SPEED = 90; // px/sec at t=0
const BALL_SPEED_GROWTH_PER_SEC = 6; // px/sec, per second survived
const MAX_BALL_SPEED = 420;
const BASE_SPAWN_INTERVAL_MS = 850;
const MIN_SPAWN_INTERVAL_MS = 180;
const SPAWN_INTERVAL_DECAY_PER_SEC = 18; // ms faster per second survived

interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  hue: number;
}

let width = 0;
let height = 0;
let dpr = 1;

const player = { x: 0, y: 0 };
const keys = { up: false, down: false, left: false, right: false };
let pointerTarget: { x: number; y: number } | null = null;

let balls: Ball[] = [];
let running = false;
let startTime = 0;
let lastFrameTime = 0;
let elapsedSec = 0;
let msSinceLastSpawn = 0;
let rafId: number | null = null;
let ballsSpawnedThisRound = 0;

function resize(): void {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = canvas.clientWidth;
  height = canvas.clientHeight;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  player.x = Math.min(player.x || width / 2, Math.max(width - PLAYER_RADIUS, PLAYER_RADIUS));
  player.y = Math.min(player.y || height / 2, Math.max(height - PLAYER_RADIUS, PLAYER_RADIUS));
}

window.addEventListener("resize", resize);

function resetState(): void {
  balls = [];
  ballsSpawnedThisRound = 0;
  player.x = width / 2;
  player.y = height / 2;
  elapsedSec = 0;
  msSinceLastSpawn = 0;
  startTime = performance.now();
  lastFrameTime = startTime;
  timerEl.textContent = "0.0초";
}

function spawnBall(): void {
  const edge = Math.floor(Math.random() * 4); // 0 top, 1 right, 2 bottom, 3 left
  const radius = BALL_MIN_RADIUS + Math.random() * (BALL_MAX_RADIUS - BALL_MIN_RADIUS);
  let x: number;
  let y: number;
  if (edge === 0) {
    x = Math.random() * width;
    y = -radius;
  } else if (edge === 1) {
    x = width + radius;
    y = Math.random() * height;
  } else if (edge === 2) {
    x = Math.random() * width;
    y = height + radius;
  } else {
    x = -radius;
    y = Math.random() * height;
  }

  // Aim broadly toward the arena's interior (a random point near the center), not necessarily
  // straight at the player — keeps it dodgeable rather than a guaranteed hit.
  const targetX = width * (0.25 + Math.random() * 0.5);
  const targetY = height * (0.25 + Math.random() * 0.5);
  const dx = targetX - x;
  const dy = targetY - y;
  const dist = Math.hypot(dx, dy) || 1;
  const speed = Math.min(MAX_BALL_SPEED, BASE_BALL_SPEED + BALL_SPEED_GROWTH_PER_SEC * elapsedSec);

  balls.push({
    x,
    y,
    vx: (dx / dist) * speed,
    vy: (dy / dist) * speed,
    radius,
    hue: Math.floor(Math.random() * 360),
  });
  ballsSpawnedThisRound += 1;
}

function currentSpawnIntervalMs(): number {
  return Math.max(
    MIN_SPAWN_INTERVAL_MS,
    BASE_SPAWN_INTERVAL_MS - SPAWN_INTERVAL_DECAY_PER_SEC * elapsedSec,
  );
}

function updatePlayer(dtSec: number): void {
  if (pointerTarget) {
    player.x = pointerTarget.x;
    player.y = pointerTarget.y;
  } else {
    let dx = 0;
    let dy = 0;
    if (keys.up) dy -= 1;
    if (keys.down) dy += 1;
    if (keys.left) dx -= 1;
    if (keys.right) dx += 1;
    if (dx !== 0 || dy !== 0) {
      const len = Math.hypot(dx, dy);
      player.x += (dx / len) * PLAYER_SPEED * dtSec;
      player.y += (dy / len) * PLAYER_SPEED * dtSec;
    }
  }
  player.x = Math.max(PLAYER_RADIUS, Math.min(width - PLAYER_RADIUS, player.x));
  player.y = Math.max(PLAYER_RADIUS, Math.min(height - PLAYER_RADIUS, player.y));
}

function updateBalls(dtSec: number): void {
  for (const b of balls) {
    b.x += b.vx * dtSec;
    b.y += b.vy * dtSec;
  }
  // Drop balls once they're well off-screen so the array doesn't grow unbounded.
  const margin = 80;
  balls = balls.filter(
    (b) => b.x > -margin && b.x < width + margin && b.y > -margin && b.y < height + margin,
  );
}

function checkCollision(): boolean {
  for (const b of balls) {
    const dist = Math.hypot(b.x - player.x, b.y - player.y);
    if (dist < b.radius + PLAYER_RADIUS) return true;
  }
  return false;
}

function draw(): void {
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = "#11151f";
  ctx.fillRect(0, 0, width, height);

  for (const b of balls) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
    ctx.fillStyle = `hsl(${b.hue}, 80%, 60%)`;
    ctx.fill();
  }

  ctx.beginPath();
  ctx.arc(player.x, player.y, PLAYER_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = "#4ade80";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#166534";
  ctx.stroke();
}

function loop(now: number): void {
  if (!running) return;
  const dtSec = Math.min(0.05, (now - lastFrameTime) / 1000);
  lastFrameTime = now;
  elapsedSec = (now - startTime) / 1000;
  timerEl.textContent = elapsedSec.toFixed(1) + "초";

  msSinceLastSpawn += dtSec * 1000;
  const interval = currentSpawnIntervalMs();
  while (msSinceLastSpawn >= interval) {
    msSinceLastSpawn -= interval;
    spawnBall();
  }

  updatePlayer(dtSec);
  updateBalls(dtSec);
  draw();

  if (checkCollision()) {
    endGame();
    return;
  }

  rafId = requestAnimationFrame(loop);
}

function startGame(): void {
  overlayEl.classList.add("hidden");
  gameOverEl.classList.add("hidden");
  resize();
  resetState();
  running = true;
  window.OWOGG?.start();
  rafId = requestAnimationFrame(loop);
}

function endGame(): void {
  running = false;
  if (rafId !== null) cancelAnimationFrame(rafId);
  finalTimeEl.textContent = "생존 시간: " + elapsedSec.toFixed(1) + "초";
  gameOverEl.classList.remove("hidden");

  const survivedSeconds = Math.round(elapsedSec * 10) / 10;
  window.OWOGG?.complete({
    outcome: "failure",
    score: survivedSeconds,
    metrics: { ballsSpawned: ballsSpawnedThisRound },
  });
}

// Keyboard input (WASD + arrow keys).
window.addEventListener("keydown", (e) => {
  switch (e.key) {
    case "w":
    case "W":
    case "ArrowUp":
      keys.up = true;
      break;
    case "s":
    case "S":
    case "ArrowDown":
      keys.down = true;
      break;
    case "a":
    case "A":
    case "ArrowLeft":
      keys.left = true;
      break;
    case "d":
    case "D":
    case "ArrowRight":
      keys.right = true;
      break;
    default:
      return;
  }
  e.preventDefault();
});

window.addEventListener("keyup", (e) => {
  switch (e.key) {
    case "w":
    case "W":
    case "ArrowUp":
      keys.up = false;
      break;
    case "s":
    case "S":
    case "ArrowDown":
      keys.down = false;
      break;
    case "a":
    case "A":
    case "ArrowLeft":
      keys.left = false;
      break;
    case "d":
    case "D":
    case "ArrowRight":
      keys.right = false;
      break;
    default:
      return;
  }
});

// Pointer/touch: drag to move (nice-to-have per spec, not the primary control scheme).
function pointerPosFromEvent(e: PointerEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

canvas.addEventListener("pointerdown", (e) => {
  pointerTarget = pointerPosFromEvent(e);
});
canvas.addEventListener("pointermove", (e) => {
  if (pointerTarget) pointerTarget = pointerPosFromEvent(e);
});
window.addEventListener("pointerup", () => {
  pointerTarget = null;
});
window.addEventListener("pointercancel", () => {
  pointerTarget = null;
});

startButton.addEventListener("click", startGame);
restartButton.addEventListener("click", startGame);

resize();
draw();
