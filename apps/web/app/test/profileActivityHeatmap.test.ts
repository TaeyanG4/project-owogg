import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PublicProfilePlayActivity } from "@owogg/contracts";
import {
  ProfileActivityHeatmap,
  activityLevel,
  buildActivityCalendar,
} from "../components/profile/ProfileActivityHeatmap.js";

const activity: PublicProfilePlayActivity = {
  periodStart: "2025-09-02",
  periodEnd: "2026-09-01",
  timeZone: "UTC",
  activeDays: 4,
  totalPlays: 17,
  todayPlays: 7,
  days: [
    { date: "2025-09-02", playCount: 1 },
    { date: "2026-01-01", playCount: 3 },
    { date: "2026-08-31", playCount: 6 },
    { date: "2026-09-01", playCount: 7 },
  ],
};

const labels = {
  activeDays: "출석일수",
  totalPlays: "총 플레이",
  today: "오늘",
  daysSuffix: "일",
  playsSuffix: "판",
  less: "적음",
  more: "많음",
  definition: "게임을 1판 이상 완료한 날을 출석으로 계산합니다.",
  utcHint: "UTC 기준",
};

test("calendar pads complete Sunday-starting weeks while preserving exactly 365 profile days", () => {
  const weeks = buildActivityCalendar(activity);
  const visibleDays = weeks.flatMap((week) => week.days).filter((day) => day.date !== null);

  assert.equal(weeks.length, 53);
  assert.equal(visibleDays.length, 365);
  assert.deepEqual(visibleDays[0], { date: "2025-09-02", playCount: 1 });
  assert.deepEqual(visibleDays.at(-1), { date: "2026-09-01", playCount: 7 });
});

test("activity levels use stable comparable play-count bands", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 6, 7, 100].map(activityLevel), [0, 1, 2, 2, 3, 3, 4, 4]);
});

test("heatmap renders summaries, every day, exact counts, and a non-color-only label", () => {
  const html = renderToStaticMarkup(
    createElement(ProfileActivityHeatmap, { activity, locale: "ko-KR", labels }),
  );

  assert.equal(html.match(/data-activity-date=/g)?.length, 365);
  assert.match(html, /data-activity-date="2026-09-01" data-play-count="7"/);
  assert.match(html, /2026년 9월 1일 · 7판/);
  assert.match(html, /aria-label="출석일수 4일, 총 플레이 17판"/);
  assert.match(html, /게임을 1판 이상 완료한 날을 출석으로 계산합니다/);
  assert.doesNotMatch(
    html,
    /rounded-2xl border border-border bg-surface-raised/,
    "play activity must not restore the old boxed summary container",
  );
});
