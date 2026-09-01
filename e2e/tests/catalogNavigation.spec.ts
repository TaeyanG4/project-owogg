import { expect, test } from "@playwright/test";

test.describe("game catalog navigation", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("owogg_locale", "ko-KR");
    });
  });

  test("desktop catalog rail expands as an overlay and routes to dynamic genre groups", async ({
    page,
  }) => {
    await page.goto("/games");

    const sidebar = page.locator("aside").first();
    const sidebarPanel = sidebar.locator(":scope > div > div");
    const main = page.locator("main");
    await expect(main).toBeVisible();
    const initialMainBox = await main.boundingBox();
    expect(initialMainBox).not.toBeNull();
    await expect(sidebar).toHaveCSS("width", "64px");

    await sidebar.hover();
    await expect(sidebarPanel).toHaveCSS("width", "224px");
    await expect(sidebar).toHaveCSS("width", "64px");
    const expandedMainBox = await main.boundingBox();
    expect(expandedMainBox?.x).toBe(initialMainBox?.x);

    await sidebar.getByRole("link", { name: "장르별 게임" }).click();
    await expect(page).toHaveURL(/\/games\?view=genres$/);
    await expect(
      page
        .getByTestId("genre-groups")
        .getByRole("heading", { level: 2, name: "platform-e2e", exact: true }),
    ).toBeVisible();
    await expect(
      page.locator('aside a[aria-current="page"]', { hasText: "장르별 게임" }),
    ).toHaveCount(1);

    await expect(
      page.locator('aside [aria-disabled="true"]', { hasText: "타 플랫폼 게임" }),
    ).toBeVisible();
  });

  test("gameplay keeps a manual persisted sidebar width", async ({ page }) => {
    await page.goto("/games/e2e-responsive");

    const sidebar = page.locator("aside").first();
    await expect(sidebar).toHaveCSS("width", "64px");
    await page.getByRole("button", { name: "사이드바 펼치기" }).click();
    await expect(sidebar).toHaveCSS("width", "224px");
    await expect
      .poll(() =>
        page.evaluate(() => window.localStorage.getItem("owogg_gameplay_sidebar_expanded")),
      )
      .toBe("true");

    await page.reload();
    await expect(sidebar).toHaveCSS("width", "224px");
    await page.getByRole("button", { name: "사이드바 접기" }).click();
    await expect(sidebar).toHaveCSS("width", "64px");
  });

  test("mobile header keeps Discord and authentication on one row without overflow", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    const header = page.locator("header");
    await expect(header.getByRole("link", { name: "Discord" })).toBeVisible();
    await expect(header.getByRole("button", { name: "로그인" })).toBeVisible();
    await expect(header.locator("a[href='/'] > span")).toBeHidden();
    await expect
      .poll(() =>
        header.evaluate((element) => element.scrollWidth <= document.documentElement.clientWidth),
      )
      .toBe(true);
  });
});
