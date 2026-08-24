import { test, expect, devices } from "@playwright/test";

/**
 * The mobile-support and orientation advisories GameHost shows in a mobile-like environment (see
 * presentationAdvisory.ts's resolveMobileAdvisory/resolveOrientationAdvisory and GameHost.tsx's
 * useIsMobileLikeEnvironment). "Mobile-like" here is Playwright's own device emulation
 * (`devices["Pixel 5"]`), which — verified locally against this exact `channel: "chrome"` setup —
 * correctly makes `matchMedia("(pointer: coarse)")` true, the one platform heuristic this reads.
 * A plain narrow-viewport desktop context (like presentation.spec.ts's own 390px-wide test) does
 * NOT trip this heuristic — narrow viewport and mobile-like are deliberately different concepts
 * here (see presentationAdvisory.ts's own doc comment on why `inputMethods` isn't used either).
 *
 * Never asserts anything about the synthetic fixture's own content/gameplay — only whether the
 * advisory banner is present, and that PLAY always stays reachable regardless.
 */

// A per-file `test.use({ ...devices["Pixel 5"] })` would force every test below (including the
// desktop-context describe block) onto the same worker/browser-type fixture — device presets
// bundle a `defaultBrowserType`, which Playwright only allows setting per-file or per-project, not
// per-describe-block. Creating the mobile-emulated context explicitly per test (like the
// orientation tests below already do) sidesteps that restriction entirely.
test.describe("Mobile support advisory (mobile-like context)", () => {
  test("support: supported shows no advisory", async ({ browser }) => {
    const context = await browser.newContext({ ...devices["Pixel 5"] });
    const page = await context.newPage();
    // e2e-responsive declares mobile.support: "supported" — see prepareLocalGameOrigin.ts.
    await page.goto("/games/e2e-responsive");
    await expect(page.getByTestId("mobile-advisory-experimental")).toHaveCount(0);
    await expect(page.getByTestId("mobile-advisory-unsupported")).toHaveCount(0);
    // PLAY stays reachable either way — this PR never blocks it.
    await expect(page.getByRole("button", { name: "PLAY", exact: true })).toBeVisible();
    await context.close();
  });

  test("support: experimental shows the experimental notice, and PLAY stays reachable", async ({
    browser,
  }) => {
    const context = await browser.newContext({ ...devices["Pixel 5"] });
    const page = await context.newPage();
    // e2e-mobile-experimental declares mobile.support: "experimental".
    await page.goto("/games/e2e-mobile-experimental");
    await expect(page.getByTestId("mobile-advisory-experimental")).toHaveCount(1);
    await expect(page.getByTestId("mobile-advisory-unsupported")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "PLAY", exact: true })).toBeVisible();
    await context.close();
  });

  test("support: unsupported shows the unsupported warning, but PLAY is still reachable — a preference, never a hard block", async ({
    browser,
  }) => {
    const context = await browser.newContext({ ...devices["Pixel 5"] });
    const page = await context.newPage();
    // e2e-fixed declares mobile.support: "unsupported".
    await page.goto("/games/e2e-fixed");
    await expect(page.getByTestId("mobile-advisory-unsupported")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "PLAY", exact: true })).toBeVisible();
    // Confirms it's genuinely not blocked: PLAY still actually mounts the iframe.
    await page.getByRole("button", { name: "PLAY", exact: true }).click();
    await expect(page.locator("iframe")).toHaveCount(1);
    await context.close();
  });
});

test.describe("Mobile support advisory (desktop context)", () => {
  test("no mobile warning on desktop, regardless of the game's own mobile.support value", async ({
    page,
  }) => {
    // Default Playwright project here is desktop (channel: "chrome", devices["Desktop Chrome"] —
    // see playwright.config.ts) — e2e-fixed's mobile.support: "unsupported" must not surface here.
    await page.goto("/games/e2e-fixed");
    await expect(page.getByTestId("mobile-advisory-unsupported")).toHaveCount(0);
    await expect(page.getByTestId("orientation-advisory")).toHaveCount(0);
  });
});

test.describe("Orientation advisory (mobile-like context)", () => {
  test("a preferred orientation that mismatches the actual (portrait) device orientation shows a hint", async ({
    browser,
  }) => {
    // e2e-fixed declares mobile.orientation: "landscape" — Pixel 5's default is portrait.
    const context = await browser.newContext({ ...devices["Pixel 5"] });
    const page = await context.newPage();
    await page.goto("/games/e2e-fixed");
    await expect(page.getByTestId("orientation-advisory")).toHaveCount(1);
    await context.close();
  });

  test("a preferred orientation that matches the actual (landscape) device orientation shows no hint", async ({
    browser,
  }) => {
    const context = await browser.newContext({ ...devices["Pixel 5 landscape"] });
    const page = await context.newPage();
    await page.goto("/games/e2e-fixed");
    await expect(page.getByTestId("orientation-advisory")).toHaveCount(0);
    await context.close();
  });
});
