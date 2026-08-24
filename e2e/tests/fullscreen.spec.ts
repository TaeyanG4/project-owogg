import { test, expect } from "@playwright/test";

/**
 * GameHost's fullscreen control — always discoverable in the action row, with activation gated on
 * presentation.fullscreen.supported (see presentationAdvisory.ts's shouldShowFullscreenControl
 * and GameHost.tsx's useFullscreen). e2e-responsive declares `fullscreen.supported: false`;
 * e2e-fixed declares `{ supported: true, recommended: true }` (see
 * e2e/prepareLocalGameOrigin.ts) — the two cases this file exercises.
 *
 * Verified locally (see this PR's own notes) that `channel: "chrome"` headless DOES support a
 * real `requestFullscreen()`/`document.fullscreenElement` round-trip when triggered from an
 * actual Playwright `.click()` (a real user-gesture-equivalent) — so this is a genuine capability
 * test, not a mock. What's NOT reliable in headless Chrome is a simulated Escape keypress
 * reaching the browser's own native fullscreen-exit handling (there is no real window chrome to
 * intercept it) — so "exit" here is verified the same way a real user would via this UI: clicking
 * the same toggle button again, which is exactly what GameHost's toggleFullscreen does
 * (document.exitFullscreen()), not a simulated ESC.
 */

test.describe("Fullscreen control", () => {
  test("visible but disabled when presentation.fullscreen.supported is false", async ({ page }) => {
    await page.goto("/games/e2e-responsive");
    const toggle = page.getByTestId("fullscreen-toggle");
    await expect(toggle).toHaveCount(1);
    await expect(toggle).toBeDisabled();
  });

  test("shown when presentation.fullscreen.supported is true, and toggles real document.fullscreenElement on click", async ({
    page,
  }) => {
    await page.goto("/games/e2e-fixed");
    // GameFrame lazy-mounts the iframe only once PLAY is pressed — needed here so the "wraps the
    // iframe" check below has an actual iframe in the DOM to find.
    await page.getByRole("button", { name: "PLAY", exact: true }).click();

    const toggle = page.getByTestId("fullscreen-toggle");
    await expect(toggle).toHaveCount(1);

    // Not fullscreen yet.
    expect(await page.evaluate(() => document.fullscreenElement !== null)).toBe(false);

    await toggle.click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);

    // The fullscreen target is Host-owned chrome that CONTAINS the iframe, never the iframe
    // element itself — see GameHost.tsx's own doc comment on why gameSurfaceRef has to wrap the
    // header (where this button lives) too, not just the innermost game-surface card.
    const fullscreenTargetWrapsIframe = await page.evaluate(() => {
      const el = document.fullscreenElement;
      return el !== null && el.tagName !== "IFRAME" && el.querySelector("iframe") !== null;
    });
    expect(fullscreenTargetWrapsIframe).toBe(true);

    // Exit: click the same toggle again (now showing the "exit" state) — see this file's own doc
    // comment on why this, not a simulated Escape key, is what's verified here.
    await toggle.click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(false);
  });
});
