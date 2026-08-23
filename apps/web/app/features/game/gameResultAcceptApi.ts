import {
  GameResultAcceptResponseSchema,
  type GameResultAcceptRequest,
  type GameResultAcceptResponse,
} from "@owogg/contracts";
import { apiFetch } from "../../lib/api/client";

export function acceptGameResult(
  slug: string,
  input: GameResultAcceptRequest,
): Promise<GameResultAcceptResponse> {
  return apiFetch(`/api/games/${encodeURIComponent(slug)}/result`, GameResultAcceptResponseSchema, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
