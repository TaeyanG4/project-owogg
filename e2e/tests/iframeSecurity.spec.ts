import { test, expect } from "@playwright/test";
import { GAME_ORIGIN_URL } from "../config.js";

/**
 * The iframe security policy every game — real or, as here, the synthetic platform fixture (see
 * e2e/prepareLocalGameOrigin.ts) — is embedded under. Platform-level invariants, not anything
 * about a particular game: which slug this runs against doesn't matter, so it uses whichever
 * synthetic fixture happens to be simplest (e2e-responsive) rather than duplicating this across
 * both.
 *
 * Deliberately NOT covered here: the Game Bridge handshake, score submission, Presentation's own
 * viewport math (see presentation.spec.ts) — this file is the security boundary only.
 */

const SLUG = "e2e-responsive";

test.describe("Iframe security invariants (synthetic platform fixture)", () => {
  test("mounts exactly one iframe with the exact sandbox/allow/referrerPolicy policy at the generic /play/<slug> path", async ({
    page,
  }) => {
    await page.goto(`/games/${SLUG}`);

    const iframe = page.locator("iframe");
    await expect(iframe).toHaveCount(1);

    const sandbox = await iframe.getAttribute("sandbox");
    expect(sandbox).toBe("allow-scripts allow-pointer-lock");
    expect(sandbox).not.toContain("allow-same-origin");

    const allow = await iframe.getAttribute("allow");
    expect(allow).toBe("fullscreen");

    // React renders the `referrerPolicy` JSX prop as the standard, lowercase HTML attribute.
    const referrerPolicy = await iframe.getAttribute("referrerpolicy");
    expect(referrerPolicy).toBe("no-referrer");

    const src = await iframe.getAttribute("src");
    expect(src).toBe(`${GAME_ORIGIN_URL}/play/${SLUG}`);
  });
});
