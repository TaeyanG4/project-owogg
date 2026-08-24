import { test, expect } from "@playwright/test";

/**
 * The first real-browser verification of GameHost's responsive/fixed Presentation viewport math
 * (packages: presentationLayoutResolver.ts, GameHost.tsx's useElementSize/useViewportHeight —
 * unit-tested there with plain numbers; this file is the part that can't be, whether the actual
 * DOM/CSS this resolves into behaves the way that math predicts). Both synthetic fixtures (see
 * e2e/prepareLocalGameOrigin.ts) load the exact same static document — only the GamePresentation
 * each is registered with differs — so nothing here can be about a particular game's content.
 *
 * Invariant-focused rather than pixel-exact throughout, per this PR's own scope: the platform
 * layout this depends on (header height, card padding, ...) is real UI that can legitimately
 * shift, and a test pinned to one exact pixel value would then fail for reasons that have nothing
 * to do with Presentation itself.
 */

test.describe("GamePresentation viewport — responsive", () => {
  // Narrower than the fixture's own preferredWidth (800) and minWidth (600) — see
  // e2e/prepareLocalGameOrigin.ts's RESPONSIVE_PRESENTATION. The whole point of this test.
  test.use({ viewport: { width: 390, height: 844 } });

  test("a game's own preferred/min never forces the platform's actual (narrower) viewport to overflow", async ({
    page,
  }) => {
    await page.goto("/games/e2e-responsive");
    await page.getByRole("button", { name: "PLAY", exact: true }).click();

    const iframe = page.locator("iframe");
    await expect(iframe).toHaveCount(1);

    const box = await iframe.boundingBox();
    expect(box).not.toBeNull();
    // Game preference ∩ Platform constraints ∩ Actual device viewport → Host decides: the
    // fixture asked for preferredWidth 800 / minWidth 600, but the actual viewport here is only
    // 390 wide — the platform's measurement must win, not the game's request.
    expect(box!.width).toBeLessThanOrEqual(390);
    expect(box!.height).toBeLessThanOrEqual(844);

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);
  });
});

test.describe("GamePresentation viewport — fixed", () => {
  // Smaller than the fixture's 1280x720 design resolution in both dimensions — see
  // e2e/prepareLocalGameOrigin.ts's FIXED_PRESENTATION.
  test.use({ viewport: { width: 640, height: 480 } });

  test("logical iframe viewport stays 1280x720 regardless of the smaller available box; the displayed surface shrinks with aspect ratio preserved, never upscaled", async ({
    page,
  }) => {
    await page.goto("/games/e2e-fixed");
    await page.getByRole("button", { name: "PLAY", exact: true }).click();

    const iframeHandle = await page.locator("iframe").elementHandle();
    expect(iframeHandle).not.toBeNull();
    const frame = await iframeHandle!.contentFrame();
    expect(frame).not.toBeNull();

    // The framed document's OWN logical viewport must stay exactly the design resolution
    // regardless of how small the DISPLAYED surface below ends up: transform: scale() shrinks
    // only how the iframe paints, never its own layout box (see GameFrame.tsx's own iframeStyle
    // doc comment) — this is the one property that can only be verified in a real browser, not by
    // presentationLayoutResolver.test.ts's plain-number math.
    const innerSize = await frame!.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));
    expect(innerSize.width).toBe(1280);
    expect(innerSize.height).toBe(720);

    const box = await page.locator("iframe").boundingBox();
    expect(box).not.toBeNull();

    // Never upscaled beyond the design resolution (scale <= 1).
    expect(box!.width).toBeLessThanOrEqual(1280);
    expect(box!.height).toBeLessThanOrEqual(720);

    // Aspect ratio preserved (16:9) — a small tolerance for sub-pixel rounding.
    expect(Math.abs(box!.width / box!.height - 16 / 9)).toBeLessThan(0.02);

    // No horizontal page overflow even though the design resolution (1280) is far wider than the
    // available viewport (640).
    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);
  });
});
