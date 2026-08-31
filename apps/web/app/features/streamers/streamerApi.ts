import { z } from "zod";
import { apiFetch } from "../../lib/api/client";
import {
  StreamerRankEntrySchema,
  StreamerPlatformSchema,
  StreamerProfileDtoSchema,
  StreamerProvidersResponseSchema,
} from "@owogg/contracts";

export const StreamerRankingsResponseSchema = z.object({
  entries: z.array(StreamerRankEntrySchema),
  total: z.number(),
  mode: z.string(),
  gameId: z.string().optional(),
  platform: StreamerPlatformSchema.optional(),
  limit: z.number(),
  offset: z.number(),
});

export { StreamerProvidersResponseSchema };

export async function fetchStreamerRankingsApi(
  mode: "score" | "xp" = "score",
  gameId?: string,
  platform?: string,
  limit = 20,
  offset = 0,
) {
  const params = new URLSearchParams();
  params.set("mode", mode);
  if (gameId && gameId !== "all") params.set("gameId", gameId);
  if (platform && platform !== "ALL") params.set("platform", platform);
  params.set("limit", String(limit));
  params.set("offset", String(offset));

  return apiFetch(`/api/streamers/rankings?${params.toString()}`, StreamerRankingsResponseSchema);
}

export async function fetchStreamerProvidersApi() {
  return apiFetch("/api/streamers/providers", StreamerProvidersResponseSchema);
}

export async function fetchMyStreamerProfileApi() {
  return apiFetch("/api/streamers/me", z.object({ profile: StreamerProfileDtoSchema.nullable() }));
}
