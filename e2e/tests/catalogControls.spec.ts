import { expect, test } from "@playwright/test";

test.describe("home catalog controls", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("owogg_locale", "ko-KR");
      window.localStorage.removeItem("owogg_game_card_descriptions");
    });
  });

  test("keeps sort, density, and description controls in the upper toolbar", async ({ page }) => {
    await page.goto("/");

    const toolbar = page.getByTestId("game-catalog-toolbar");
    const sortTrigger = page.getByTestId("game-sort-trigger").first();
    const hideDescriptions = toolbar.getByRole("button", { name: "설명 숨기기" });
    const gridSwitcher = toolbar.getByTestId("grid-column-switcher");

    await expect(toolbar).toBeVisible();
    await expect(sortTrigger).toContainText("인기 순");
    await expect(hideDescriptions).toBeVisible();
    await expect(page.getByTestId("game-category-filters")).toHaveCount(0);

    const sortBox = await sortTrigger.boundingBox();
    const descriptionBox = await hideDescriptions.boundingBox();
    const gridBox = await gridSwitcher.boundingBox();
    expect(sortBox).not.toBeNull();
    expect(descriptionBox).not.toBeNull();
    expect(gridBox).not.toBeNull();
    expect(sortBox!.x).toBeLessThan(descriptionBox!.x);
    expect(sortBox!.height).toBe(descriptionBox!.height);
    expect(sortBox!.height).toBe(gridBox!.height);
    expect(sortBox!.height).toBe(36);

    await hideDescriptions.click();
    await expect(toolbar.getByRole("button", { name: "설명 보기" })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.localStorage.getItem("owogg_game_card_descriptions")))
      .toBe("false");
  });

  test("uses the styled listbox with the renamed sort options", async ({ page }) => {
    await page.goto("/");

    const sortTrigger = page.getByTestId("game-sort-trigger").first();
    await sortTrigger.click();

    const listbox = page.getByRole("listbox", { name: "게임 정렬" });
    await expect(listbox).toBeVisible();
    const sortLayer = await page
      .getByTestId("game-sort-root")
      .evaluate((element) => Number.parseInt(getComputedStyle(element).zIndex, 10));
    const headerLayer = await page
      .locator("header")
      .evaluate((element) => Number.parseInt(getComputedStyle(element).zIndex, 10));
    expect(sortLayer).toBeGreaterThan(headerLayer);
    await expect(listbox.getByRole("option")).toHaveText([
      "인기 순",
      "출시 순",
      "조회수 순",
      "북마크 순",
    ]);
    await expect(page.locator('select[aria-label="게임 정렬"]')).toHaveCount(0);

    await listbox.getByRole("option", { name: "출시 순" }).click();
    await expect(sortTrigger).toContainText("출시 순");
    await expect(sortTrigger).toHaveAttribute("aria-expanded", "false");
  });

  test("keeps multiplayer badges outside the bookmark action area", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    const card = page.locator('a[href="/games/e2e-multi-card"]:visible').locator("..");
    const favoriteButton = card.getByTestId("game-favorite-button");
    const badges = card.getByTestId("game-mode-badges").locator("span");
    await expect(card).toBeVisible();
    await expect(badges).toHaveCount(2);

    const favoriteBox = await favoriteButton.boundingBox();
    expect(favoriteBox).not.toBeNull();
    for (const badge of await badges.all()) {
      const badgeBox = await badge.boundingBox();
      expect(badgeBox).not.toBeNull();
      expect(badgeBox!.x + badgeBox!.width).toBeLessThanOrEqual(favoriteBox!.x - 4);
    }
  });
});
