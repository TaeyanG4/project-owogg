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
    await expect(main.locator('input[type="search"]')).toHaveCount(0);
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
    const genreSidebar = page.getByTestId("genre-filter-sidebar");
    await expect(
      genreSidebar.getByRole("searchbox", { name: "장르 또는 게임 검색..." }),
    ).toBeVisible();
    await expect(genreSidebar.getByRole("button", { name: /전체 장르\s+5/ })).toBeVisible();
    await expect(genreSidebar.getByRole("button", { name: /스킬 테스트\s+4/ })).toBeVisible();
    await expect(genreSidebar.getByRole("button", { name: /보드게임\s+1/ })).toBeVisible();
    await expect(
      page
        .getByTestId("genre-groups")
        .getByRole("heading", { level: 2, name: "스킬 테스트", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByTestId("genre-groups").getByRole("heading", {
        level: 2,
        name: "보드게임",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByTestId("game-count-label")).toHaveText(
      "5개의 가벼운 미니게임이 준비되어 있습니다.",
    );

    await genreSidebar.getByRole("button", { name: /보드게임\s+1/ }).click();
    await expect(page).toHaveURL(/view=genres.*genre=board/);
    await expect(
      page.getByTestId("genre-groups").getByRole("heading", {
        level: 2,
        name: "보드게임",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByTestId("genre-groups").getByRole("heading", { name: "스킬 테스트" }),
    ).toHaveCount(0);
    await expect(page.getByTestId("game-count-label")).toHaveText(
      "1개의 가벼운 미니게임이 준비되어 있습니다.",
    );

    await genreSidebar.getByRole("button", { name: /전체 장르\s+5/ }).click();
    const genreSearch = genreSidebar.getByRole("searchbox", {
      name: "장르 또는 게임 검색...",
    });
    await genreSearch.fill("보드게임");
    await expect(
      page.getByTestId("genre-groups").getByRole("heading", { name: "보드게임" }),
    ).toBeVisible();
    await expect(page.getByTestId("game-count-label")).toHaveText(
      "1개의 가벼운 미니게임이 준비되어 있습니다.",
    );

    await genreSearch.fill("skill fixture");
    await expect(page.getByRole("link", { name: /Platform E2E skill fixture/ })).toBeVisible();
    await expect(page.getByTestId("game-count-label")).toHaveText(
      "1개의 가벼운 미니게임이 준비되어 있습니다.",
    );
    await expect(
      page.locator('aside a[aria-current="page"]', { hasText: "장르별 게임" }),
    ).toHaveCount(1);

    await expect(
      page.locator('aside [aria-disabled="true"]', { hasText: "타 플랫폼 게임" }),
    ).toBeVisible();
  });

  test("localizes known genre names while preserving dynamic groups", async ({ page }) => {
    await page.goto("/games?view=genres");
    await page.getByRole("button", { name: "언어" }).click();
    await page.getByRole("option", { name: "English" }).click();

    const genreSidebar = page.getByTestId("genre-filter-sidebar");
    await expect(genreSidebar.getByRole("button", { name: /Skill Tests\s+4/ })).toBeVisible();
    await expect(genreSidebar.getByRole("button", { name: /Board Games\s+1/ })).toBeVisible();
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
