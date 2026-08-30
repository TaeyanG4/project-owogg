import test from "node:test";
import assert from "node:assert/strict";
import { computePlatformHeight } from "../features/game/GameHost";

/**
 * The pure half of this PR's height-independence fix: `computePlatformHeight` is what turns an
 * independently-measured `window`/`visualViewport` height into the platform's own height
 * constraint for a presentation-active game — see GameHost.tsx's own doc comments (particularly
 * `useViewportHeight`'s) for why this can never be derived from a DOM measurement of anything
 * GameHost itself renders (that would be a feedback loop, not a platform constraint).
 */

test("targets roughly 82% of the actual viewport height", () => {
  assert.equal(computePlatformHeight(1000), 820);
});

test("caps at 900px even on a very tall viewport — same upper bound the legacy CSS uses", () => {
  assert.equal(computePlatformHeight(2000), 900);
});

test("has no floor: a small viewport is not forced up to any minimum, unlike the legacy CSS's min-h-[480px]", () => {
  // The exact case called out by name: a short viewport (e.g. a landscape phone) must get
  // whatever 82% actually is, not be pushed past the real viewport and overflow the page.
  assert.ok(Math.abs(computePlatformHeight(300) - 246) < Number.EPSILON * 256);
  assert.ok(computePlatformHeight(300) < 480, "must not be forced up to the legacy 480px floor");
});

test("stays monotonically increasing below the cap — a taller viewport never gets a smaller platform height", () => {
  assert.ok(computePlatformHeight(500) < computePlatformHeight(900));
});

test("manifest dimensions cannot extend the host page beyond the viewport target", () => {
  assert.equal(computePlatformHeight(900), 738);
  assert.equal(computePlatformHeight(500), 410);
});
