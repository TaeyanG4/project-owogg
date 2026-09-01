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

    await expect(toolbar).toBeVisible();
    await expect(sortTrigger).toContainText("인기 순");
    await expect(hideDescriptions).toBeVisible();
    await expect(page.getByTestId("game-category-filters")).toHaveCount(0);

    const sortBox = await sortTrigger.boundingBox();
    const descriptionBox = await hideDescriptions.boundingBox();
    expect(sortBox).not.toBeNull();
    expect(descriptionBox).not.toBeNull();
    expect(sortBox!.x).toBeLessThan(descriptionBox!.x);

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
});
