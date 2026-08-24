import { GameSessionResponseSchema } from "@owogg/contracts";
import { apiFetch } from "../../lib/api/client";

/**
 * POST /api/games/:slug/session — issues a short-lived, HMAC-signed Game Session token for a
 * PUBLIC, live Game Creator game (packages/core/src/domain/gameSession.ts). Requires the caller to
 * already be authenticated — the existing owogg_session cookie, sent automatically by apiFetch's
 * credentials: "include", same as every other authenticated client call in this app.
 *
 * This is deliberately just the fetch — the provider-neutral Web GameHost can call this and
 * hold the resulting token in its own state, but nothing does yet, and nothing here decides what
 * to do with it: connecting a held token to GAME_COMPLETE/score submission is a later PR's scope.
 * The token itself must never reach the sandboxed game iframe — see GameHost.tsx and
 * IframeRuntime for why nothing crosses that boundary except the five Game Bridge messages.
 */
export function fetchGameSession(slug: string, difficulty?: string) {
  return apiFetch(`/api/games/${encodeURIComponent(slug)}/session`, GameSessionResponseSchema, {
    method: "POST",
    ...(difficulty ? { body: JSON.stringify({ difficulty }) } : {}),
  });
}
