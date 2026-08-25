import { MultiplayerJoinTicketResponseSchema, type MultiplayerBootstrap } from "@owogg/contracts";
import { apiFetch } from "../../../lib/api/client.js";
import { API_URL } from "../../../lib/api/config.js";
import type { MultiplayerBridgeSocketLike } from "./multiplayerBridgeHost.js";

const INSTANCE_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const SOCKET_PATH_PATTERN = /^\/api\/multiplayer\/instances\/[A-Za-z0-9_-]{8,128}\/socket$/;
const APPLICATION_PROTOCOL = "owogg.multiplayer.v1";

export type MultiplayerTransportErrorCode =
  | "INVALID_INPUT"
  | "INVALID_API_ORIGIN"
  | "CONTRACT_MISMATCH"
  | "STALE_GENERATION"
  | "TICKET_EXPIRED"
  | "SOCKET_OPEN_FAILED";

export class MultiplayerTransportError extends Error {
  readonly code: MultiplayerTransportErrorCode;

  constructor(code: MultiplayerTransportErrorCode) {
    super(code);
    this.name = "MultiplayerTransportError";
    this.code = code;
  }
}

export interface MultiplayerBrowserSocketLike extends MultiplayerBridgeSocketLike {
  readonly protocol: string;
}

export interface MultiplayerParentTransport {
  readonly socket: MultiplayerBrowserSocketLike;
  readonly bootstrap: MultiplayerBootstrap;
  readonly connectionGeneration: number;
  readonly expiresAt: string;
  /** Releases the one-shot selected-protocol guard after an early parent-side abort. */
  releaseProtocolGuard(): void;
}

export interface OpenMultiplayerParentTransportInput {
  readonly instanceId: string;
  readonly expectedConnectionGeneration: number;
}

export interface MultiplayerTransportDependencies {
  readonly apiUrl?: string;
  readonly now?: () => number;
  readonly requestTicket?: (
    instanceId: string,
    expectedConnectionGeneration: number,
  ) => Promise<unknown>;
  readonly createSocket?: (
    url: string,
    protocols: readonly [string, string],
  ) => MultiplayerBrowserSocketLike;
}

/** Builds a credential-free socket URL anchored to the configured API origin. */
export function multiplayerSocketUrl(apiUrl: string, socketPath: string): string {
  let api: URL;
  try {
    api = new URL(apiUrl);
  } catch {
    throw new MultiplayerTransportError("INVALID_API_ORIGIN");
  }
  if (
    (api.protocol !== "http:" && api.protocol !== "https:") ||
    api.username !== "" ||
    api.password !== "" ||
    api.pathname !== "/" ||
    api.search !== "" ||
    api.hash !== ""
  ) {
    throw new MultiplayerTransportError("INVALID_API_ORIGIN");
  }
  if (!SOCKET_PATH_PATTERN.test(socketPath)) {
    throw new MultiplayerTransportError("CONTRACT_MISMATCH");
  }

  const socket = new URL(socketPath, api.origin);
  socket.protocol = api.protocol === "https:" ? "wss:" : "ws:";
  socket.search = "";
  socket.hash = "";
  return socket.toString();
}

async function requestTicketFromApi(
  instanceId: string,
  expectedConnectionGeneration: number,
): Promise<unknown> {
  return apiFetch(
    `/api/multiplayer/instances/${encodeURIComponent(instanceId)}/ticket`,
    MultiplayerJoinTicketResponseSchema,
    {
      method: "POST",
      body: JSON.stringify({ expectedConnectionGeneration }),
    },
  );
}

function createBrowserSocket(
  url: string,
  protocols: readonly [string, string],
): MultiplayerBrowserSocketLike {
  return new WebSocket(url, [...protocols]);
}

/**
 * Parent-only ticket exchange and WebSocket construction. The bearer appears only in the
 * constructor's subprotocol list, never in the URL or returned transport contract.
 */
export async function openMultiplayerParentTransport(
  input: OpenMultiplayerParentTransportInput,
  dependencies: MultiplayerTransportDependencies = {},
): Promise<MultiplayerParentTransport> {
  if (
    !INSTANCE_ID_PATTERN.test(input.instanceId) ||
    !Number.isSafeInteger(input.expectedConnectionGeneration) ||
    input.expectedConnectionGeneration < 0
  ) {
    throw new MultiplayerTransportError("INVALID_INPUT");
  }

  const requestTicket = dependencies.requestTicket ?? requestTicketFromApi;
  const raw = await requestTicket(input.instanceId, input.expectedConnectionGeneration);
  const parsed = MultiplayerJoinTicketResponseSchema.safeParse(raw);
  if (!parsed.success) throw new MultiplayerTransportError("CONTRACT_MISMATCH");
  const admission = parsed.data;
  if (admission.connectionGeneration !== input.expectedConnectionGeneration + 1) {
    throw new MultiplayerTransportError("STALE_GENERATION");
  }
  if (Date.parse(admission.expiresAt) <= (dependencies.now ?? Date.now)()) {
    throw new MultiplayerTransportError("TICKET_EXPIRED");
  }

  const url = multiplayerSocketUrl(dependencies.apiUrl ?? API_URL, admission.socketPath);
  let socket: MultiplayerBrowserSocketLike;
  try {
    socket = (dependencies.createSocket ?? createBrowserSocket)(url, admission.protocols);
  } catch {
    // A browser exception can include the rejected subprotocol. Do not retain it as `cause` or
    // echo it into diagnostics because the second offered protocol is the bearer ticket.
    throw new MultiplayerTransportError("SOCKET_OPEN_FAILED");
  }

  let guardActive = true;
  const onOpen = () => {
    if (!guardActive) return;
    guardActive = false;
    socket.removeEventListener("open", onOpen);
    if (socket.protocol !== APPLICATION_PROTOCOL) {
      try {
        socket.close(1002, "invalid multiplayer protocol");
      } catch {
        // Listener removal already prevents repeated handling. The browser will close the failed
        // protocol negotiation independently if close() itself is no longer accepted.
      }
    }
  };
  socket.addEventListener("open", onOpen);

  return {
    socket,
    bootstrap: admission.bootstrap,
    connectionGeneration: admission.connectionGeneration,
    expiresAt: admission.expiresAt,
    releaseProtocolGuard() {
      if (!guardActive) return;
      guardActive = false;
      socket.removeEventListener("open", onOpen);
    },
  };
}
