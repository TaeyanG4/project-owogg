import { z } from "zod";
import { apiFetch } from "../../lib/api/client";
import { API_URL } from "../../lib/api/config";
import {
  StreamerRankEntrySchema,
  StreamerPlatformSchema,
  StreamerProfileDtoSchema,
  StreamerProvidersResponseSchema,
  StreamerDisconnectResponseSchema,
  type StreamerPlatform,
  type StreamerDisconnectResponse,
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

/** OAuth navigation must go directly to the API Worker. A relative `/api/...` link is resolved
 * against the Web Worker (`stg.owogg.com` in Staging), where this route does not exist and all
 * providers fail with the same 404 before their OAuth configuration is ever reached. */
export function streamerVerificationUrl(
  platform: StreamerPlatform,
  apiUrl: string = API_URL,
): string {
  return `${apiUrl.replace(/\/+$/, "")}/api/streamers/verify/${platform.toLowerCase()}`;
}

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

export async function disconnectStreamerPlatformApi(
  platform: StreamerPlatform,
): Promise<StreamerDisconnectResponse> {
  return apiFetch(
    `/api/streamers/connections/${encodeURIComponent(platform.toLowerCase())}`,
    StreamerDisconnectResponseSchema,
    { method: "DELETE" },
  );
}
