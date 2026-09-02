import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  normalizeRankingPeriodForScope,
  rankingPeriodOptions,
} from "../features/rankings/periods.js";

const labels = { daily: "일간", weekly: "주간", monthly: "월간", all: "전체" };

test("all-time is offered only in Streamer ranking period controls", () => {
  assert.deepEqual(
    rankingPeriodOptions("general", labels).map((option) => option.id),
    ["daily", "weekly", "monthly"],
  );
  assert.deepEqual(
    rankingPeriodOptions("streamer", labels).map((option) => option.id),
    ["daily", "weekly", "monthly", "all"],
  );
});

test("switching from all-time Streamer ranking to General fails closed to daily", () => {
  assert.equal(normalizeRankingPeriodForScope("general", "all"), "daily");
  assert.equal(normalizeRankingPeriodForScope("streamer", "all"), "all");
  assert.equal(normalizeRankingPeriodForScope("general", "monthly"), "monthly");
});

test("the per-game leaderboard requests the selected scope through the shared scope tabs", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../routes/gameRanking.tsx", import.meta.url)),
    "utf8",
  );
  assert.match(source, /<RankingScopeTabs/);
  assert.match(source, /fetchPublicRankingApi\(\{\s*scope,/);
  assert.match(source, /scope === "streamer"[\s\S]*dict\.ranking\.platformHeader/);
});
