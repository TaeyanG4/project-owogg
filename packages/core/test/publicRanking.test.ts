import test from "node:test";
import assert from "node:assert/strict";
import {
  previousServiceDateString,
  resolvePublicRankingPeriod,
  serviceDateString,
} from "../src/domain/publicRanking.js";

const NOW = new Date("2026-08-31T08:45:00.000Z"); // Monday 17:45 KST

test("daily ranking uses KST midnight boundaries", () => {
  assert.deepEqual(resolvePublicRankingPeriod("daily", NOW), {
    startAt: "2026-08-30T15:00:00.000Z",
    endAt: "2026-08-31T15:00:00.000Z",
  });
});

test("weekly ranking starts Monday and monthly ranking starts on day one in KST", () => {
  assert.deepEqual(resolvePublicRankingPeriod("weekly", NOW), {
    startAt: "2026-08-30T15:00:00.000Z",
    endAt: "2026-09-06T15:00:00.000Z",
  });
  assert.deepEqual(resolvePublicRankingPeriod("monthly", NOW), {
    startAt: "2026-07-31T15:00:00.000Z",
    endAt: "2026-08-31T15:00:00.000Z",
  });
});

test("service attendance dates use KST across the UTC date boundary", () => {
  const nearMidnight = new Date("2026-08-31T16:30:00.000Z");
  assert.equal(serviceDateString(nearMidnight), "2026-09-01");
  assert.equal(previousServiceDateString("2026-09-01"), "2026-08-31");
  assert.equal(previousServiceDateString("2026-03-01"), "2026-02-28");
});
