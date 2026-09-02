import type { RankingPeriod, RankingScope } from "@owogg/contracts";

export interface RankingPeriodLabels {
  daily: string;
  weekly: string;
  monthly: string;
  all: string;
}

export function rankingPeriodOptions(
  scope: RankingScope,
  labels: RankingPeriodLabels,
): Array<{ id: RankingPeriod; label: string }> {
  const options: Array<{ id: RankingPeriod; label: string }> = [
    { id: "daily", label: labels.daily },
    { id: "weekly", label: labels.weekly },
    { id: "monthly", label: labels.monthly },
  ];
  if (scope === "streamer") options.push({ id: "all", label: labels.all });
  return options;
}

export function normalizeRankingPeriodForScope(
  scope: RankingScope,
  period: RankingPeriod,
): RankingPeriod {
  return scope === "general" && period === "all" ? "daily" : period;
}
