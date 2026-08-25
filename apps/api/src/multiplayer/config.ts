import { createMultiplayerTicketKeyring, type MultiplayerTicketKeyring } from "@owogg/core";
import type { ApiEnv } from "../routes/auth.js";

export interface MultiplayerRuntimeConfig {
  readonly socketOrigin: string;
  readonly frontendOrigin: string;
  readonly keyring: MultiplayerTicketKeyring;
}

export function isMultiplayerFeatureEnabled(value: string | undefined): boolean {
  return value === "true";
}

function parseConfiguredOrigin(value: string | undefined): string | null {
  if (!value || value !== value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Read all security-critical runtime values as one fail-closed unit. */
export function readMultiplayerRuntimeConfig(
  env: ApiEnv["Bindings"],
): MultiplayerRuntimeConfig | null {
  const socketOrigin = parseConfiguredOrigin(env.MULTIPLAYER_SOCKET_ORIGIN);
  const frontendOrigin = parseConfiguredOrigin(env.FRONTEND_URL);
  const activeKid = env.MULTIPLAYER_TICKET_KEY_ID;
  const activeSecret = env.MULTIPLAYER_TICKET_SECRET;
  if (!socketOrigin || !frontendOrigin || !activeKid || !activeSecret) return null;

  const previousKid = env.MULTIPLAYER_TICKET_PREVIOUS_KEY_ID;
  const previousSecret = env.MULTIPLAYER_TICKET_PREVIOUS_SECRET;
  if (Boolean(previousKid) !== Boolean(previousSecret)) return null;

  try {
    return {
      socketOrigin,
      frontendOrigin,
      keyring: createMultiplayerTicketKeyring(
        { kid: activeKid, secret: activeSecret },
        previousKid && previousSecret ? [{ kid: previousKid, secret: previousSecret }] : [],
      ),
    };
  } catch {
    return null;
  }
}

export function isTrustedMultiplayerSocketRequest(
  request: Request,
  config: Pick<MultiplayerRuntimeConfig, "socketOrigin" | "frontendOrigin">,
): boolean {
  let requestUrl: URL;
  try {
    requestUrl = new URL(request.url);
  } catch {
    return false;
  }
  if (requestUrl.origin !== config.socketOrigin) return false;

  const host = request.headers.get("Host");
  if (host && host.toLowerCase() !== new URL(config.socketOrigin).host.toLowerCase()) return false;

  const origin = request.headers.get("Origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === config.frontendOrigin && origin === new URL(origin).origin;
  } catch {
    return false;
  }
}
