import {
  GameResultAcceptResponseSchema,
  type GameResultAcceptRequest,
  type GameResultAcceptResponse,
} from "@owogg/contracts";
import type { JsonSafeValue } from "@owogg/game-sdk/bridge";
import { apiFetch } from "../../lib/api/client";

export function acceptGameResult(
  slug: string,
  input:
    | GameResultAcceptRequest
    | { readonly token: string; readonly evidence: JsonSafeValue; readonly playToken?: string },
): Promise<GameResultAcceptResponse> {
  return apiFetch(`/api/games/${encodeURIComponent(slug)}/result`, GameResultAcceptResponseSchema, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
