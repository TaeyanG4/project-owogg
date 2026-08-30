import test from "node:test";
import assert from "node:assert/strict";
import type { GamePresentation } from "@owogg/game-sdk";
import { resolvePresentationLayout } from "../features/game/presentationLayoutResolver";

/** Synthetic fixtures keep the sizing contract independent of any one game's implementation. */
function responsive(
  overrides: Partial<Extract<GamePresentation["viewport"], { mode: "responsive" }>> = {},
): GamePresentation {
  return {
    viewport: { mode: "responsive", ...overrides },
    fullscreen: { supported: false },
    mobile: { support: "unsupported" },
  };
}

function fixed(preferredWidth: number, preferredHeight: number): GamePresentation {
  return {
    viewport: { mode: "fixed", preferredWidth, preferredHeight },
    fullscreen: { supported: false },
    mobile: { support: "unsupported" },
  };
}

test("presentation undefined resolves to legacy — GameHost keeps its current static layout", () => {
  const layout = resolvePresentationLayout(undefined, { width: 1024, height: 768 });
  assert.deepEqual(layout, { kind: "legacy" });
});

test("responsive with a preferred size that fits: preferred size wins", () => {
  const layout = resolvePresentationLayout(
    responsive({ preferredWidth: 800, preferredHeight: 600 }),
    {
      width: 1200,
      height: 900,
    },
  );
  assert.deepEqual(layout, { kind: "responsive", displayWidth: 800, displayHeight: 600 });
});

test("responsive paired dimensions keep their 16:9 ratio inside a taller host box", () => {
  const layout = resolvePresentationLayout(
    responsive({ preferredWidth: 1600, preferredHeight: 900 }),
    { width: 1200, height: 820 },
  );
  assert.deepEqual(layout, { kind: "responsive", displayWidth: 1200, displayHeight: 675 });
});

test("responsive paired dimensions use height as the binding constraint without distortion", () => {
  const layout = resolvePresentationLayout(
    responsive({ preferredWidth: 1600, preferredHeight: 900 }),
    { width: 1600, height: 600 },
  );
  assert.equal(layout.kind, "responsive");
  if (layout.kind !== "responsive") return;
  assert.equal(layout.displayHeight, 600);
  assert.ok(Math.abs(layout.displayWidth / layout.displayHeight - 16 / 9) < Number.EPSILON * 2);
});

test("a game's minWidth never overrides a smaller actual viewport — no overflow", () => {
  // The exact scenario called out by name: minWidth 800 on a 390px-wide device must never force
  // 800 — the actual available width always wins.
  const layout = resolvePresentationLayout(responsive({ minWidth: 800 }), {
    width: 390,
    height: 800,
  });
  assert.equal(layout.kind, "responsive");
  assert.equal((layout as { displayWidth: number }).displayWidth, 390);
});

test("responsive with a maxWidth caps the result even when available space is larger", () => {
  const layout = resolvePresentationLayout(responsive({ maxWidth: 1000 }), {
    width: 1400,
    height: 900,
  });
  assert.equal(layout.kind, "responsive");
  assert.equal((layout as { displayWidth: number }).displayWidth, 1000);
});

test("fixed 1280x720 in a 640x480 available box: logical stays 1280x720, display shrinks to 640x360, scale 0.5", () => {
  const layout = resolvePresentationLayout(fixed(1280, 720), { width: 640, height: 480 });
  assert.deepEqual(layout, {
    kind: "fixed",
    logicalWidth: 1280,
    logicalHeight: 720,
    displayWidth: 640,
    displayHeight: 360,
    scale: 0.5,
  });
});

test("fixed 640x360 in a much larger available box: no unnecessary upscale, scale caps at 1", () => {
  const layout = resolvePresentationLayout(fixed(640, 360), { width: 1920, height: 1080 });
  assert.deepEqual(layout, {
    kind: "fixed",
    logicalWidth: 640,
    logicalHeight: 360,
    displayWidth: 640,
    displayHeight: 360,
    scale: 1,
  });
});

test("fixed mode always preserves the design aspect ratio, whatever the available box's own ratio is", () => {
  // A tall, narrow available box against a 4:3 design resolution — width is the binding
  // constraint, and the resulting display box must keep exactly the same 4:3 ratio as the logical
  // one, not the available box's ratio.
  const layout = resolvePresentationLayout(fixed(800, 600), { width: 300, height: 1000 });
  assert.equal(layout.kind, "fixed");
  const { displayWidth, displayHeight, logicalWidth, logicalHeight } = layout as {
    displayWidth: number;
    displayHeight: number;
    logicalWidth: number;
    logicalHeight: number;
  };
  assert.equal(displayWidth / displayHeight, logicalWidth / logicalHeight);
  assert.equal(displayWidth, 300);
  assert.equal(displayHeight, 225);
});

test("fixed display size never exceeds the available box in either dimension", () => {
  const layout = resolvePresentationLayout(fixed(1000, 1000), { width: 200, height: 900 });
  assert.equal(layout.kind, "fixed");
  const { displayWidth, displayHeight } = layout as { displayWidth: number; displayHeight: number };
  assert.ok(displayWidth <= 200);
  assert.ok(displayHeight <= 900);
});

// ── fail-safe: no measurement yet, or an invalid one, never collapses the iframe to 0px ───────

test("a presentation-bearing game with no measurement yet (available === null) falls back to legacy, not a 0x0 layout", () => {
  const layout = resolvePresentationLayout(responsive({ preferredWidth: 800 }), null);
  assert.deepEqual(layout, { kind: "legacy" });
});

test("a zero or negative available width or height also falls back to legacy — a transient/invalid reading, not a real 0px viewport", () => {
  assert.deepEqual(resolvePresentationLayout(responsive(), { width: 0, height: 800 }), {
    kind: "legacy",
  });
  assert.deepEqual(resolvePresentationLayout(responsive(), { width: 800, height: 0 }), {
    kind: "legacy",
  });
  assert.deepEqual(resolvePresentationLayout(fixed(1280, 720), { width: -1, height: 480 }), {
    kind: "legacy",
  });
});
