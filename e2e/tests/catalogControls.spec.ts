import { expect, test } from "@playwright/test";

test.describe("home catalog controls", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("owogg_locale", "ko-KR"));
  });

  test("places sort at the left and category filters at the upper right", async ({ page }) => {
    await page.goto("/");

    const toolbar = page.getByTestId("game-catalog-toolbar");
    const sortTrigger = page.getByTestId("game-sort-trigger").first();
    const categoryFilters = toolbar.getByTestId("game-category-filters");

    await expect(toolbar).toBeVisible();
    await expect(sortTrigger).toContainText("인기 순");
    await expect(categoryFilters.getByRole("button", { name: "전체" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    const sortBox = await sortTrigger.boundingBox();
    const categoryBox = await categoryFilters.boundingBox();
    expect(sortBox).not.toBeNull();
    expect(categoryBox).not.toBeNull();
    expect(sortBox!.x).toBeLessThan(categoryBox!.x);
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
