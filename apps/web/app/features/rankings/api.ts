import {
  PublicRankingResponseSchema,
  type PublicRankingResponse,
  type RankingMetric,
  type RankingPeriod,
  type RankingScope,
  type StreamerPlatform,
} from "@owogg/contracts";
import { apiFetch } from "../../lib/api";

export async function fetchPublicRankingApi(input: {
  scope: RankingScope;
  metric: RankingMetric;
  period: RankingPeriod;
  gameId?: string;
  difficulty?: string;
  platform?: StreamerPlatform;
  limit?: number;
}): Promise<PublicRankingResponse> {
  const params = new URLSearchParams({
    scope: input.scope,
    metric: input.metric,
    period: input.period,
    limit: String(input.limit ?? 50),
  });
  if (input.gameId) params.set("gameId", input.gameId);
  if (input.difficulty) params.set("difficulty", input.difficulty);
  if (input.platform) params.set("platform", input.platform);
  return apiFetch(`/api/rankings?${params.toString()}`, PublicRankingResponseSchema);
}
