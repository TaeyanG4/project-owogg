import {
  GameSessionResponseSchema,
  PlayConfigGameSessionResponseSchema,
  type PlayConfigGameSessionRequest,
} from "@owogg/contracts";
import { apiFetch } from "../../lib/api/client";

/**
 * POST /api/games/:slug/session — issues a short-lived, HMAC-signed Game Session token for a
 * PUBLIC, live Game Creator game (packages/core/src/domain/gameSession.ts). Requires the caller to
 * already be authenticated — the existing owogg_session cookie, sent automatically by apiFetch's
 * credentials: "include", same as every other authenticated client call in this app.
 *
 * This is deliberately just the legacy fetch. The provider-neutral Web GameHost holds the token
 * in parent state and submits it through the existing result flow. The token itself must never
 * reach the sandboxed game iframe; Bridge messages contain only public runtime context.
 */
export function fetchGameSession(slug: string, difficulty?: string) {
  return apiFetch(`/api/games/${encodeURIComponent(slug)}/session`, GameSessionResponseSchema, {
    method: "POST",
    ...(difficulty ? { body: JSON.stringify({ difficulty }) } : {}),
  });
}

/**
 * Requests the verifier-backed gs2 branch from the same endpoint. The response parser requires
 * both a gs2 token and exact public startContext; neither an accidental gs1 fallback nor a partial
 * response can authorize the iframe.
 */
export function fetchPlayConfigGameSession(slug: string, request: PlayConfigGameSessionRequest) {
  return apiFetch(
    `/api/games/${encodeURIComponent(slug)}/session`,
    PlayConfigGameSessionResponseSchema,
    {
      method: "POST",
      body: JSON.stringify(request),
    },
  );
}
