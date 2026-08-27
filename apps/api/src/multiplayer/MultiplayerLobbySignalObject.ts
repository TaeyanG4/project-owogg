import { DurableObject } from "cloudflare:workers";
import {
  MULTIPLAYER_HEARTBEAT_REQUEST,
  MULTIPLAYER_HEARTBEAT_RESPONSE,
  MULTIPLAYER_LOBBY_SIGNAL_PROTOCOL,
  MultiplayerLobbySignalChangeSchema,
} from "@owogg/contracts";
import {
  MULTIPLAYER_INTERNAL_LOBBY_SIGNAL_CLAIMS_HEADER,
  MULTIPLAYER_INTERNAL_LOBBY_SIGNAL_CONNECT_PATH,
  MULTIPLAYER_INTERNAL_LOBBY_SIGNAL_NOTIFY_PATH,
  MULTIPLAYER_INTERNAL_PROTOCOL_HEADER,
  decodeVerifiedMultiplayerLobbySignalClaims,
} from "./internalProtocol.js";

const POLICY_CLOSE_CODE = 1008;
const ROOM_CLOSED_CLOSE_CODE = 4003;
const MEMBERSHIP_ENDED_CLOSE_CODE = 4004;
const MAX_SOCKETS_PER_PARTICIPANT = 2;
const MAX_SOCKETS_PER_ROOM = 32;

interface LobbySignalAttachment {
  readonly instanceId: string;
  readonly participantId: string;
  readonly generation: number;
}

type MultiplayerLobbySignalEnv = Record<string, unknown>;

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isOpaqueId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(value);
}

function parseAttachment(value: unknown): LobbySignalAttachment | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (
    Object.keys(source).length !== 3 ||
    !isOpaqueId(source.instanceId) ||
    !isOpaqueId(source.participantId) ||
    !isPositiveInteger(source.generation)
  ) {
    return null;
  }
  return {
    instanceId: source.instanceId,
    participantId: source.participantId,
    generation: source.generation,
  };
}

function generationTag(generation: number): string {
  return `lobby-signal:g:${generation}`;
}

function participantTag(participantId: string): string {
  return `lobby-signal:p:${participantId}`;
}

/**
 * Hibernatable notification fan-out for a waiting room. D1 remains authoritative: this object has
 * no application state, storage reads/writes, alarms, timers, or game rules. A missed signal is
 * repaired by the authenticated roster endpoint after reconnect.
 */
export class MultiplayerLobbySignalObject extends DurableObject<MultiplayerLobbySignalEnv> {
  constructor(ctx: DurableObjectState, env: MultiplayerLobbySignalEnv) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(
        MULTIPLAYER_HEARTBEAT_REQUEST,
        MULTIPLAYER_HEARTBEAT_RESPONSE,
      ),
    );
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (
      request.method === "POST" &&
      url.pathname === MULTIPLAYER_INTERNAL_LOBBY_SIGNAL_NOTIFY_PATH &&
      request.headers.get(MULTIPLAYER_INTERNAL_PROTOCOL_HEADER) ===
        MULTIPLAYER_LOBBY_SIGNAL_PROTOCOL
    ) {
      return this.notify(request);
    }
    if (
      request.method !== "GET" ||
      url.pathname !== MULTIPLAYER_INTERNAL_LOBBY_SIGNAL_CONNECT_PATH ||
      request.headers.get("Upgrade")?.toLowerCase() !== "websocket" ||
      request.headers.get(MULTIPLAYER_INTERNAL_PROTOCOL_HEADER) !==
        MULTIPLAYER_LOBBY_SIGNAL_PROTOCOL
    ) {
      return new Response(null, { status: 404 });
    }

    const claims = decodeVerifiedMultiplayerLobbySignalClaims(
      request.headers.get(MULTIPLAYER_INTERNAL_LOBBY_SIGNAL_CLAIMS_HEADER),
    );
    if (!claims) return new Response(null, { status: 401 });
    if (
      this.ctx.getWebSockets().length >= MAX_SOCKETS_PER_ROOM ||
      this.ctx.getWebSockets(participantTag(claims.participantId)).length >=
        MAX_SOCKETS_PER_PARTICIPANT
    ) {
      return new Response(null, { status: 429 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const attachment: LobbySignalAttachment = claims;
    this.ctx.acceptWebSocket(server, [
      generationTag(claims.generation),
      participantTag(claims.participantId),
    ]);
    server.serializeAttachment(attachment);
    server.send(
      JSON.stringify({
        type: "LOBBY_SIGNAL_CONNECTED",
        v: 1,
        instanceId: claims.instanceId,
        generation: claims.generation,
      }),
    );
    return new Response(null, { status: 101, webSocket: client });
  }

  override webSocketMessage(socket: WebSocket): void {
    // The only accepted client frame is handled by setWebSocketAutoResponse without waking this
    // object. Any frame that reaches user code is outside the signal-only protocol.
    socket.close(POLICY_CLOSE_CODE, "unsupported lobby signal message");
  }

  override webSocketClose(): void {}

  override webSocketError(): void {}

  private async notify(request: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response(null, { status: 400 });
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return new Response(null, { status: 400 });
    }
    const source = body as Record<string, unknown>;
    if (
      Object.keys(source).length !== 5 ||
      !isOpaqueId(source.instanceId) ||
      !isPositiveInteger(source.generation) ||
      (source.revokeParticipantId !== null && !isOpaqueId(source.revokeParticipantId)) ||
      typeof source.closeRoom !== "boolean"
    ) {
      return new Response(null, { status: 400 });
    }
    const change = MultiplayerLobbySignalChangeSchema.safeParse(source.change);
    if (!change.success) return new Response(null, { status: 400 });

    const message = JSON.stringify({
      type: "LOBBY_SIGNAL_CHANGED",
      v: 1,
      instanceId: source.instanceId,
      generation: source.generation,
      change: change.data,
    });
    for (const socket of this.ctx.getWebSockets(generationTag(source.generation))) {
      const attachment = parseAttachment(socket.deserializeAttachment());
      if (
        attachment?.instanceId === source.instanceId &&
        attachment.generation === source.generation &&
        socket.readyState === WebSocket.OPEN
      ) {
        try {
          socket.send(message);
        } catch {
          socket.close(1011, "lobby signal delivery failed");
        }
      }
    }
    const socketsToClose = source.closeRoom
      ? this.ctx.getWebSockets(generationTag(source.generation))
      : source.revokeParticipantId === null
        ? []
        : this.ctx.getWebSockets(participantTag(source.revokeParticipantId));
    for (const socket of socketsToClose) {
      const attachment = parseAttachment(socket.deserializeAttachment());
      if (
        attachment?.instanceId === source.instanceId &&
        attachment.generation === source.generation &&
        socket.readyState === WebSocket.OPEN
      ) {
        socket.close(
          source.closeRoom ? ROOM_CLOSED_CLOSE_CODE : MEMBERSHIP_ENDED_CLOSE_CODE,
          source.closeRoom ? "lobby ended" : "lobby membership ended",
        );
      }
    }
    return new Response(null, { status: 204 });
  }
}
