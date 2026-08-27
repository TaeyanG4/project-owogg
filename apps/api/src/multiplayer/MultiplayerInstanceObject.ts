import { DurableObject } from "cloudflare:workers";
import {
  MULTIPLAYER_BRIDGE_PROTOCOL_VERSION,
  MULTIPLAYER_PLAYER_CONNECTION_CHANGED_EVENT,
  MULTIPLAYER_REMATCH_CHANGED_EVENT,
  parseGameToHostMultiplayerMessage,
  type MultiActionMessage,
  type MultiInputMessage,
  type MultiplayerActionRejectionCode,
} from "@owogg/game-sdk/bridge";
import {
  MULTIPLAYER_WEBSOCKET_PROTOCOL,
  MULTIPLAYER_REMATCH_WINDOW_MS,
  OMOK_ACTION_LEDGER_SCHEMA_VERSION,
  OMOK_RULESET_KEY,
  applyOmokAction,
  createInitialOmokState,
  encodeOmokActionLedgerResponse,
  getOmokTerminalResult,
  isSupportedOmokRulesetRevision,
  isSupportedMultiplayerRuntimeProfile,
  parseOmokAction,
  parseOmokActionLedgerResponse,
  parseOmokStateV1,
  projectOmokState,
  type MultiplayerJoinTicketClaims,
  type MultiplayerMatchRecord,
  type OmokActionLedgerResponseV1,
  type OmokRulesetRevision,
  type OmokStateV1,
  type OmokTerminalResult,
} from "@owogg/core";
import type { D1Database } from "@cloudflare/workers-types";
import {
  MULTIPLAYER_HEARTBEAT_REQUEST,
  MULTIPLAYER_HEARTBEAT_RESPONSE,
  MULTIPLAYER_LOBBY_WEBSOCKET_PROTOCOL,
} from "@owogg/contracts";
import { createContainer, type AppContainer } from "../container.js";
import {
  MULTIPLAYER_INTERNAL_CLAIMS_HEADER,
  MULTIPLAYER_INTERNAL_CONNECT_PATH,
  MULTIPLAYER_INTERNAL_LEAVE_PATH,
  MULTIPLAYER_INTERNAL_LOBBY_CLAIMS_HEADER,
  MULTIPLAYER_INTERNAL_LOBBY_CONNECT_PATH,
  MULTIPLAYER_INTERNAL_LOBBY_NOTIFY_PATH,
  MULTIPLAYER_INTERNAL_PROTOCOL_HEADER,
  MULTIPLAYER_INTERNAL_REMATCH_NOTIFY_PATH,
  decodeVerifiedMultiplayerClaims,
  decodeVerifiedMultiplayerLobbyClaims,
} from "./internalProtocol.js";

const STATE_SCHEMA_VERSION = 2;
const REPLACED_CONNECTION_CLOSE_CODE = 4001;
const STALE_CONNECTION_CLOSE_CODE = 4002;
const POLICY_CLOSE_CODE = 1008;
const RUNTIME_UNAVAILABLE_CLOSE_CODE = 1013;
const ACTION_RATE_WINDOW_MS = 1_000;
const FINALIZATION_RETRY_BASE_MS = 2_000;
const FINALIZATION_RETRY_MAX_MS = 60_000;
const RECONNECT_GRACE_MS = 30_000;
const RECONNECT_GRACE_SECONDS = RECONNECT_GRACE_MS / 1_000;
const textEncoder = new TextEncoder();

interface MultiplayerDurableObjectEnv {
  readonly DB: D1Database;
}

interface ConnectionAttachment {
  readonly participantId: string;
  readonly generation: number;
  readonly connectionGeneration: number;
}

interface ParticipantAuthority {
  readonly participantId: string;
  readonly userId: number;
  readonly role: "HOST" | "PLAYER";
  readonly seatIndex: 0 | 1;
  readonly generation: number;
}

type RuntimeLifecycle = "ACTIVE" | "TERMINAL_PENDING" | "COMMITTED" | "ABORTED";

interface RuntimeMatch {
  readonly matchId: string;
  readonly generation: number;
  readonly state: OmokStateV1;
  readonly serverSeq: number;
  readonly lifecycle: RuntimeLifecycle;
  readonly maxActionBytes: number;
  readonly maxStateBytes: number;
  readonly actionRateLimit: number;
  readonly terminalResultJson: string | null;
  readonly finalizationAttempts: number;
}

type OmokRuntimeConfiguration =
  | { readonly status: "PENDING"; readonly blackParticipantId: null }
  | { readonly status: "LOCKED"; readonly blackParticipantId: string };

type CanonicalTerminalResult =
  | (Extract<OmokTerminalResult, { readonly kind: "WIN" }> & {
      readonly winnerParticipantId: string;
      readonly loserParticipantId: string;
      readonly reason: null;
    })
  | (Extract<OmokTerminalResult, { readonly kind: "DRAW" }> & {
      readonly winnerParticipantId: null;
      readonly loserParticipantId: null;
      readonly reason: null;
    })
  | {
      readonly kind: "FORFEIT";
      readonly revision: number;
      readonly winnerSeatIndex: 0 | 1;
      readonly loserSeatIndex: 0 | 1;
      readonly winnerParticipantId: string;
      readonly loserParticipantId: string;
      readonly winningLine: null;
      readonly reason: "LEFT" | "DISCONNECTED";
    };

type PlayerConnectionStatus = "CONNECTED" | "RECONNECTING" | "LEFT" | "TIMED_OUT";

type AdmissionResult =
  | { readonly ok: true; readonly previousConnectionGeneration: number | null }
  | { readonly ok: false; readonly code: "CONTEXT_MISMATCH" | "REPLAYED" | "STALE" };

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseAttachment(value: unknown): ConnectionAttachment | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const keys = Object.keys(source);
  if (
    keys.length !== 3 ||
    !keys.every((key) => ["participantId", "generation", "connectionGeneration"].includes(key)) ||
    typeof source.participantId !== "string" ||
    !/^[A-Za-z0-9_-]{8,128}$/.test(source.participantId) ||
    !isPositiveInteger(source.generation) ||
    !isPositiveInteger(source.connectionGeneration)
  ) {
    return null;
  }
  return {
    participantId: source.participantId,
    generation: source.generation,
    connectionGeneration: source.connectionGeneration,
  };
}

function participantTag(participantId: string): string {
  return `participant:${participantId}`;
}

function lobbyGenerationTag(generation: number): string {
  return `lobby:generation:${generation}`;
}

function lobbyParticipantTag(participantId: string): string {
  return `lobby:participant:${participantId}`;
}

function integerValue(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function actionCodeForClient(code: string): MultiplayerActionRejectionCode {
  switch (code) {
    case "MATCH_NOT_ACTIVE":
    case "NOT_PARTICIPANT":
    case "NOT_YOUR_TURN":
    case "ACTION_INVALID":
    case "ACTION_CONFLICT":
    case "ACTION_ID_REUSED":
    case "STALE_GENERATION":
    case "RATE_LIMITED":
      return code;
    default:
      return "ACTION_CONFLICT";
  }
}

function abortCodeForClient(
  code: string | null,
):
  | "INSUFFICIENT_PLAYERS"
  | "PARTICIPANT_LEFT"
  | "RULE_VIOLATION"
  | "INFRA_FAILURE"
  | "ADMIN_KILLED"
  | "VERSION_UNAVAILABLE" {
  switch (code) {
    case "INSUFFICIENT_PLAYERS":
    case "PARTICIPANT_LEFT":
    case "RULE_VIOLATION":
    case "ADMIN_KILLED":
    case "VERSION_UNAVAILABLE":
      return code;
    default:
      return "INFRA_FAILURE";
  }
}

function stablePayloadJson(payload: unknown): string {
  const action = parseOmokAction(payload);
  return action ? JSON.stringify({ x: action.x, y: action.y }) : JSON.stringify(payload);
}

function isOpaqueId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(value);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", textEncoder.encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * One authoritative M1 runtime per D1-approved instance. Clients submit intents only. Accepted
 * actions reach the D1 action ledger before the DO checkpoint, allowing crash-safe replay.
 */
export class MultiplayerInstanceObject extends DurableObject<MultiplayerDurableObjectEnv> {
  private readonly container: AppContainer;
  private messageQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly state: DurableObjectState,
    env: MultiplayerDurableObjectEnv,
  ) {
    super(state, env);
    this.container = createContainer(env.DB);
    state.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(
        MULTIPLAYER_HEARTBEAT_REQUEST,
        MULTIPLAYER_HEARTBEAT_RESPONSE,
      ),
    );
    state.blockConcurrencyWhile(async () => {
      state.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS runtime_meta (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          instance_id TEXT NOT NULL,
          game_version_id INTEGER NOT NULL,
          profile_revision INTEGER NOT NULL,
          generation INTEGER NOT NULL,
          state_schema_version INTEGER NOT NULL,
          lifecycle_status TEXT NOT NULL CHECK (lifecycle_status IN ('INERT', 'ACTIVE', 'CLOSED')),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS consumed_ticket_nonces (
          jti TEXT PRIMARY KEY,
          participant_id TEXT NOT NULL,
          user_id INTEGER NOT NULL,
          generation INTEGER NOT NULL,
          connection_generation INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          consumed_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_consumed_ticket_nonces_expiry
          ON consumed_ticket_nonces(expires_at);
        CREATE TABLE IF NOT EXISTS participant_connections (
          participant_id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('HOST', 'PLAYER')),
          generation INTEGER NOT NULL,
          connection_generation INTEGER NOT NULL,
          connected_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL,
          disconnected_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS runtime_authority (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          profile_id INTEGER NOT NULL,
          ruleset_key TEXT NOT NULL,
          ruleset_revision INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS participant_authority (
          participant_id TEXT NOT NULL,
          generation INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('HOST', 'PLAYER')),
          seat_index INTEGER NOT NULL CHECK (seat_index IN (0, 1)),
          created_at INTEGER NOT NULL,
          PRIMARY KEY (participant_id, generation),
          UNIQUE (generation, user_id),
          UNIQUE (generation, seat_index)
        );
        CREATE TABLE IF NOT EXISTS runtime_match (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          match_id TEXT NOT NULL,
          generation INTEGER NOT NULL,
          state_json TEXT NOT NULL,
          revision INTEGER NOT NULL,
          server_seq INTEGER NOT NULL,
          lifecycle_status TEXT NOT NULL CHECK (
            lifecycle_status IN ('ACTIVE', 'TERMINAL_PENDING', 'COMMITTED', 'ABORTED')
          ),
          max_action_bytes INTEGER NOT NULL,
          max_state_bytes INTEGER NOT NULL,
          action_rate_limit INTEGER NOT NULL,
          terminal_result_json TEXT,
          finalization_attempts INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS runtime_game_config (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          generation INTEGER NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('LOCKED')),
          black_participant_id TEXT NOT NULL,
          selected_by_participant_id TEXT NOT NULL,
          selected_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS participant_rate_windows (
          participant_id TEXT NOT NULL,
          generation INTEGER NOT NULL,
          window_started_at INTEGER NOT NULL,
          action_count INTEGER NOT NULL,
          PRIMARY KEY (participant_id, generation)
        );
        CREATE TABLE IF NOT EXISTS rematch_window (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          generation INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS lobby_event_sequence (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          generation INTEGER NOT NULL,
          server_sequence INTEGER NOT NULL
        );
      `);
    });
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (
      request.method === "GET" &&
      url.pathname === MULTIPLAYER_INTERNAL_LOBBY_CONNECT_PATH &&
      request.headers.get(MULTIPLAYER_INTERNAL_PROTOCOL_HEADER) ===
        MULTIPLAYER_LOBBY_WEBSOCKET_PROTOCOL &&
      request.headers.get("Upgrade")?.toLowerCase() === "websocket"
    ) {
      const claims = decodeVerifiedMultiplayerLobbyClaims(
        request.headers.get(MULTIPLAYER_INTERNAL_LOBBY_CLAIMS_HEADER),
      );
      if (!claims) return new Response(null, { status: 401 });
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      // Lobby sockets deliberately have no gameplay attachment. Hibernation callbacks therefore
      // ignore their close/error events instead of starting an in-match reconnect grace period.
      this.state.acceptWebSocket(server, [
        lobbyGenerationTag(claims.generation),
        lobbyParticipantTag(claims.participantId),
      ]);
      return new Response(null, { status: 101, webSocket: client });
    }
    if (
      request.method === "POST" &&
      url.pathname === MULTIPLAYER_INTERNAL_LOBBY_NOTIFY_PATH &&
      request.headers.get(MULTIPLAYER_INTERNAL_PROTOCOL_HEADER) ===
        MULTIPLAYER_LOBBY_WEBSOCKET_PROTOCOL
    ) {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return new Response(null, { status: 400 });
      }
      if (
        typeof body !== "object" ||
        body === null ||
        Array.isArray(body) ||
        Object.keys(body).length !== 2 ||
        !("instanceId" in body) ||
        !("generation" in body) ||
        !isOpaqueId(body.instanceId) ||
        !isPositiveInteger(body.generation)
      ) {
        return new Response(null, { status: 400 });
      }
      const meta = this.state.storage.sql
        .exec<{ instance_id: string }>("SELECT instance_id FROM runtime_meta WHERE singleton = 1")
        .toArray()[0];
      if (meta && meta.instance_id !== body.instanceId) {
        return new Response(null, { status: 409 });
      }
      this.broadcastLobbyChanged(body.instanceId, body.generation);
      return new Response(null, { status: 204 });
    }
    if (
      request.method === "POST" &&
      url.pathname === MULTIPLAYER_INTERNAL_LEAVE_PATH &&
      request.headers.get(MULTIPLAYER_INTERNAL_PROTOCOL_HEADER) === MULTIPLAYER_WEBSOCKET_PROTOCOL
    ) {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return Response.json({ ok: false, code: "INVALID_REQUEST" }, { status: 400 });
      }
      if (
        typeof body !== "object" ||
        body === null ||
        Array.isArray(body) ||
        Object.keys(body).length !== 3 ||
        !("instanceId" in body) ||
        !("userId" in body) ||
        !("generation" in body) ||
        !isOpaqueId(body.instanceId) ||
        !isPositiveInteger(body.userId) ||
        !isPositiveInteger(body.generation)
      ) {
        return Response.json({ ok: false, code: "INVALID_REQUEST" }, { status: 400 });
      }
      const task = this.messageQueue.then(() =>
        this.leaveParticipant(
          body.userId as number,
          body.generation as number,
          body.instanceId as string,
        ),
      );
      this.messageQueue = task.then(
        () => undefined,
        () => undefined,
      );
      try {
        const result = await task;
        return Response.json(
          result.ok ? { ok: true, replayed: result.replayed } : { ok: false, code: result.code },
          { status: result.ok ? 200 : 409 },
        );
      } catch {
        return Response.json({ ok: false, code: "INTERNAL_RETRYABLE" }, { status: 503 });
      }
    }
    if (
      request.method === "POST" &&
      url.pathname === MULTIPLAYER_INTERNAL_REMATCH_NOTIFY_PATH &&
      request.headers.get(MULTIPLAYER_INTERNAL_PROTOCOL_HEADER) === MULTIPLAYER_WEBSOCKET_PROTOCOL
    ) {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return new Response(null, { status: 400 });
      }
      if (
        typeof body !== "object" ||
        body === null ||
        Array.isArray(body) ||
        Object.keys(body).length !== 1 ||
        !("generation" in body) ||
        !isPositiveInteger(body.generation)
      ) {
        return new Response(null, { status: 400 });
      }
      const runtime = this.readRuntimeMatch();
      if (!runtime || runtime.generation !== body.generation || runtime.lifecycle !== "COMMITTED") {
        return new Response(null, { status: 409 });
      }
      this.broadcastRematchChanged(runtime);
      return new Response(null, { status: 204 });
    }
    if (
      request.method !== "GET" ||
      url.pathname !== MULTIPLAYER_INTERNAL_CONNECT_PATH ||
      request.headers.get("Upgrade")?.toLowerCase() !== "websocket" ||
      request.headers.get(MULTIPLAYER_INTERNAL_PROTOCOL_HEADER) !== MULTIPLAYER_WEBSOCKET_PROTOCOL
    ) {
      return new Response(null, { status: 404 });
    }
    const claims = decodeVerifiedMultiplayerClaims(
      request.headers.get(MULTIPLAYER_INTERNAL_CLAIMS_HEADER),
    );
    const nowSeconds = Math.floor(Date.now() / 1_000);
    if (!claims || claims.exp <= nowSeconds) return new Response(null, { status: 401 });

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const admission = this.consumeAdmission(claims, nowSeconds);
    if (!admission.ok) {
      return new Response(null, { status: admission.code === "REPLAYED" ? 401 : 409 });
    }

    this.closeSupersededSockets(
      claims.participantId,
      claims.generation,
      claims.connectionGeneration,
    );
    const attachment: ConnectionAttachment = {
      participantId: claims.participantId,
      generation: claims.generation,
      connectionGeneration: claims.connectionGeneration,
    };
    this.state.acceptWebSocket(server, [participantTag(claims.participantId)]);
    server.serializeAttachment(attachment);
    server.send(
      JSON.stringify({
        type: "MULTI_CONNECTED",
        v: MULTIPLAYER_BRIDGE_PROTOCOL_VERSION,
        generation: claims.generation,
        connectionGeneration: claims.connectionGeneration,
      }),
    );
    try {
      await this.sendReconnectState(server, attachment);
      this.sendPresenceSnapshot(server, attachment);
      this.broadcastPlayerConnection(claims.participantId, "CONNECTED", null);
    } catch {
      await this.disconnectUnavailable(server, attachment);
    }
    this.ctx.waitUntil(this.scheduleNextAlarm(claims.exp * 1_000 + 1_000));
    return new Response(null, { status: 101, webSocket: client });
  }

  override webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    const task = this.messageQueue.then(() => this.handleWebSocketMessage(socket, message));
    this.messageQueue = task.catch(async () => {
      const attachment = this.readAttachment(socket);
      if (attachment) await this.disconnectUnavailable(socket, attachment);
    });
    this.ctx.waitUntil(this.messageQueue);
  }

  override async webSocketClose(socket: WebSocket): Promise<void> {
    const attachment = this.readAttachment(socket);
    if (!attachment) return;
    await this.beginReconnectGrace(attachment, Math.ceil(Date.now() / 1_000));
  }

  override async webSocketError(socket: WebSocket): Promise<void> {
    const attachment = this.readAttachment(socket);
    if (!attachment) return;
    await this.beginReconnectGrace(attachment, Math.ceil(Date.now() / 1_000));
  }

  override async alarm(): Promise<void> {
    const nowMs = Date.now();
    const nowSeconds = Math.floor(nowMs / 1_000);
    this.state.storage.sql.exec(
      "DELETE FROM consumed_ticket_nonces WHERE expires_at <= ?",
      nowSeconds,
    );
    this.state.storage.sql.exec(
      `DELETE FROM participant_connections
       WHERE disconnected_at IS NOT NULL AND disconnected_at <= ?`,
      nowSeconds - 24 * 60 * 60,
    );
    this.state.storage.sql.exec(
      "DELETE FROM participant_rate_windows WHERE window_started_at < ?",
      nowMs - 60_000,
    );
    try {
      await this.resolveExpiredDisconnects(nowSeconds);
    } catch {
      // A forfeit first becomes TERMINAL_PENDING before D1/B2 finalization. Re-arm explicitly so a
      // transient repository outage cannot outlive Cloudflare's finite automatic alarm retries.
      const pending = this.readRuntimeMatch();
      if (pending?.lifecycle === "TERMINAL_PENDING") {
        await this.scheduleFinalizationRetry(pending.finalizationAttempts + 1);
      } else {
        await this.scheduleNextAlarm(Date.now() + FINALIZATION_RETRY_BASE_MS);
      }
      return;
    }
    const runtime = this.readRuntimeMatch();
    if (runtime?.lifecycle === "TERMINAL_PENDING") {
      try {
        await this.commitTerminalResult(runtime);
      } catch {
        await this.scheduleFinalizationRetry(runtime.finalizationAttempts + 1);
      }
    }
    const rematchWindow = this.state.storage.sql
      .exec<{ generation: number; expires_at: number }>(
        "SELECT generation, expires_at FROM rematch_window WHERE singleton = 1",
      )
      .toArray()[0];
    if (
      rematchWindow &&
      isPositiveInteger(rematchWindow.generation) &&
      isNonNegativeInteger(rematchWindow.expires_at)
    ) {
      if (rematchWindow.expires_at <= nowMs) {
        await this.closeExpiredRematchWindow(rematchWindow.generation);
      } else {
        await this.scheduleNextAlarm(rematchWindow.expires_at);
      }
    }
    const nextNonce = this.state.storage.sql
      .exec<{ expires_at: number }>(
        "SELECT MIN(expires_at) AS expires_at FROM consumed_ticket_nonces",
      )
      .toArray()[0];
    const nextExpiry = integerValue(nextNonce?.expires_at);
    if (nextExpiry !== null) await this.scheduleNextAlarm(nextExpiry * 1_000 + 1_000);
    const nextDisconnect = this.state.storage.sql
      .exec<{ disconnected_at: number }>(
        `SELECT MIN(disconnected_at) AS disconnected_at
         FROM participant_connections
         WHERE generation = ? AND disconnected_at IS NOT NULL`,
        this.generation(),
      )
      .toArray()[0];
    const nextDisconnectedAt = integerValue(nextDisconnect?.disconnected_at);
    if (nextDisconnectedAt !== null) {
      await this.scheduleNextAlarm((nextDisconnectedAt + RECONNECT_GRACE_SECONDS) * 1_000 + 1);
    }
  }

  private async handleWebSocketMessage(
    socket: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    const attachment = this.readAttachment(socket);
    if (!attachment) {
      socket.close(POLICY_CLOSE_CODE, "invalid connection");
      return;
    }
    if (typeof message !== "string" || textEncoder.encode(message).byteLength > 4 * 1024) {
      socket.close(POLICY_CLOSE_CODE, "invalid message");
      return;
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(message);
    } catch {
      socket.close(POLICY_CLOSE_CODE, "invalid message");
      return;
    }
    const parsed = parseGameToHostMultiplayerMessage(decoded);
    if (!parsed || parsed.generation !== attachment.generation) {
      socket.close(STALE_CONNECTION_CLOSE_CODE, "stale generation");
      return;
    }
    const current = this.currentConnection(attachment.participantId);
    if (
      !current ||
      current.generation !== attachment.generation ||
      current.connectionGeneration !== attachment.connectionGeneration ||
      current.disconnectedAt !== null
    ) {
      socket.close(STALE_CONNECTION_CLOSE_CODE, "stale connection");
      return;
    }
    const authority = this.currentAuthority(attachment.participantId, attachment.generation);
    if (!authority) {
      socket.close(POLICY_CLOSE_CODE, "invalid authority");
      return;
    }

    const nowSeconds = Math.floor(Date.now() / 1_000);
    this.touchConnection(attachment, nowSeconds);
    switch (parsed.type) {
      case "MULTI_LEAVE":
        await this.handleLeave(authority, attachment, socket);
        return;
      case "MULTI_READY":
        await this.handleReady(authority, attachment, socket);
        return;
      case "MULTI_ACTION":
        await this.handleAction(authority, attachment, socket, parsed);
        return;
      case "MULTI_INPUT":
        await this.handleGameConfigurationInput(authority, attachment, socket, parsed);
        return;
    }
  }

  private async handleReady(
    authority: ParticipantAuthority,
    attachment: ConnectionAttachment,
    socket: WebSocket,
  ): Promise<void> {
    const result = await this.container.multiplayerRoomUseCases.readyParticipant({
      userId: authority.userId,
      instanceId: this.instanceId(),
      expectedGeneration: authority.generation,
    });
    if (!result.ok) {
      if (result.code === "STALE_GENERATION") {
        socket.close(STALE_CONNECTION_CLOSE_CODE, "stale generation");
      } else {
        await this.disconnectUnavailable(socket, attachment);
      }
      return;
    }
    if (result.state === "WAITING" || !result.match) return;
    const runtime = await this.ensureRuntimeMatch(result.match);
    await this.broadcastState(runtime, "MULTI_SYNC");
  }

  private async handleAction(
    authority: ParticipantAuthority,
    attachment: ConnectionAttachment,
    socket: WebSocket,
    message: MultiActionMessage,
  ): Promise<void> {
    const match = await this.container.multiplayerMatchRepo.findMatchByInstanceGeneration(
      this.instanceId(),
      attachment.generation,
    );
    if (!match || match.status !== "ACTIVE") {
      await this.sendActionRejection(socket, message.clientActionId, "MATCH_NOT_ACTIVE", 0);
      return;
    }
    let runtime = await this.ensureRuntimeMatch(match);
    if (runtime.lifecycle !== "ACTIVE") {
      await this.sendActionRejection(
        socket,
        message.clientActionId,
        "MATCH_NOT_ACTIVE",
        runtime.state.revision,
      );
      return;
    }
    if (!this.consumeActionRate(authority, runtime.actionRateLimit, Date.now())) {
      await this.sendActionRejection(
        socket,
        message.clientActionId,
        "RATE_LIMITED",
        runtime.state.revision,
      );
      return;
    }

    const payloadJson = stablePayloadJson(message.payload);
    if (textEncoder.encode(payloadJson).byteLength > runtime.maxActionBytes) {
      await this.recordAndSendRejectedAction(
        runtime,
        authority,
        socket,
        message,
        payloadJson,
        "ACTION_INVALID",
      );
      return;
    }
    const action = parseOmokAction(message.payload);
    const gameSeatIndex = this.gameSeatIndex(authority);
    const transition = action
      ? this.readOmokConfiguration(runtime.generation).status === "LOCKED"
        ? applyOmokAction(runtime.state, gameSeatIndex, action, message.expectedRevision)
        : {
            ok: false as const,
            code: "MATCH_NOT_ACTIVE" as const,
            currentRevision: runtime.state.revision,
          }
      : {
          ok: false as const,
          code: "ACTION_INVALID" as const,
          currentRevision: runtime.state.revision,
        };
    const nextServerSeq = runtime.serverSeq + 1;
    const ledgerResponse: OmokActionLedgerResponseV1 = transition.ok
      ? {
          schemaVersion: OMOK_ACTION_LEDGER_SCHEMA_VERSION,
          kind: "ACCEPTED",
          generation: runtime.generation,
          serverSeq: nextServerSeq,
          clientActionId: message.clientActionId,
          revision: transition.state.revision,
          state: transition.state,
        }
      : {
          schemaVersion: OMOK_ACTION_LEDGER_SCHEMA_VERSION,
          kind: "REJECTED",
          generation: runtime.generation,
          serverSeq: nextServerSeq,
          clientActionId: message.clientActionId,
          code: transition.code,
          currentRevision: transition.currentRevision,
        };
    const recorded = await this.container.multiplayerMatchRepo.recordAction({
      matchId: runtime.matchId,
      userId: authority.userId,
      participantId: authority.participantId,
      clientSeq: message.clientSeq,
      serverSeq: nextServerSeq,
      clientActionId: message.clientActionId,
      payloadHash: await this.hashActionPayload(payloadJson, runtime.state.rulesetRevision),
      expectedRevision: message.expectedRevision,
      resultRevision: transition.ok ? transition.state.revision : transition.currentRevision,
      resultCode: transition.ok ? "ACCEPTED" : transition.code,
      responseJson: encodeOmokActionLedgerResponse(ledgerResponse),
      nowIso: new Date().toISOString(),
    });

    if (recorded.status === "REJECTED") {
      if (recorded.code === "ACTION_CONFLICT") {
        const refreshedMatch = await this.container.multiplayerMatchRepo.findMatch(match.id);
        if (!refreshedMatch) throw new Error("match disappeared during action conflict");
        runtime = await this.recoverRuntimeMatch(refreshedMatch, runtime);
      }
      await this.sendActionRejection(
        socket,
        message.clientActionId,
        actionCodeForClient(recorded.code),
        recorded.currentRevision ?? runtime.state.revision,
      );
      if (recorded.code === "ACTION_CONFLICT") await this.sendState(socket, runtime, "MULTI_SYNC");
      return;
    }

    let stored: OmokActionLedgerResponseV1 | null = null;
    try {
      stored = parseOmokActionLedgerResponse(JSON.parse(recorded.action.responseJson));
    } catch {
      stored = null;
    }
    if (!stored || stored.generation !== runtime.generation) {
      throw new Error("invalid authoritative Omok action response");
    }
    if (recorded.status === "REPLAYED") {
      const refreshedMatch = await this.container.multiplayerMatchRepo.findMatch(match.id);
      if (!refreshedMatch) throw new Error("match disappeared during action replay");
      runtime = await this.recoverRuntimeMatch(refreshedMatch, runtime);
      if (stored.kind === "ACCEPTED") {
        await this.sendState(socket, runtime, "MULTI_SYNC");
      } else {
        await this.sendActionRejection(
          socket,
          stored.clientActionId,
          actionCodeForClient(stored.code),
          runtime.state.revision,
        );
      }
      if (runtime.state.status !== "ACTIVE" && runtime.lifecycle === "ACTIVE") {
        await this.beginTerminalCommit(runtime);
      }
      return;
    }

    if (stored.kind === "REJECTED") {
      runtime = this.persistRuntimeMatch({ ...runtime, serverSeq: stored.serverSeq });
      this.sendStoredActionRejection(socket, stored);
      if (stored.code === "ACTION_CONFLICT") await this.sendState(socket, runtime, "MULTI_SYNC");
      return;
    }
    runtime = this.persistRuntimeMatch({
      ...runtime,
      state: stored.state,
      serverSeq: stored.serverSeq,
    });
    this.broadcastProjectedState(runtime, "MULTI_STATE", stored.serverSeq);
    if (stored.state.status !== "ACTIVE") await this.beginTerminalCommit(runtime);
  }

  private async handleGameConfigurationInput(
    authority: ParticipantAuthority,
    attachment: ConnectionAttachment,
    socket: WebSocket,
    message: MultiInputMessage,
  ): Promise<void> {
    const payload = message.payload;
    const validPayload =
      typeof payload === "object" &&
      payload !== null &&
      !Array.isArray(payload) &&
      Object.keys(payload).length === 2 &&
      Object.keys(payload).every((key) => ["kind", "stone"].includes(key)) &&
      (payload as Record<string, unknown>).kind === "OMOK_SELECT_STONE" &&
      ((payload as Record<string, unknown>).stone === "BLACK" ||
        (payload as Record<string, unknown>).stone === "WHITE");
    if (!validPayload || authority.role !== "HOST") {
      socket.close(POLICY_CLOSE_CODE, "invalid game configuration");
      return;
    }
    const match = await this.container.multiplayerMatchRepo.findMatchByInstanceGeneration(
      this.instanceId(),
      attachment.generation,
    );
    if (!match || match.status !== "ACTIVE") return;
    const runtime = await this.ensureRuntimeMatch(match);
    if (
      runtime.lifecycle !== "ACTIVE" ||
      runtime.state.revision !== 0 ||
      this.readOmokConfiguration(runtime.generation).status === "LOCKED"
    ) {
      await this.sendState(socket, runtime, "MULTI_SYNC");
      return;
    }
    if (!this.consumeActionRate(authority, runtime.actionRateLimit, Date.now())) return;

    const participants = (
      await this.container.multiplayerInstanceRepo.listParticipants(this.instanceId())
    ).filter((participant) => participant.status === "JOINED" || participant.status === "READY");
    const opponent = participants.find((participant) => participant.id !== authority.participantId);
    if (!opponent || participants.length !== 2) {
      socket.close(POLICY_CLOSE_CODE, "invalid game configuration authority");
      return;
    }
    const stone = (payload as { readonly stone: "BLACK" | "WHITE" }).stone;
    const blackParticipantId = stone === "BLACK" ? authority.participantId : opponent.id;
    const written = this.state.storage.sql.exec(
      `INSERT OR IGNORE INTO runtime_game_config (
         singleton, generation, status, black_participant_id,
         selected_by_participant_id, selected_at
       ) VALUES (1, ?, 'LOCKED', ?, ?, ?)`,
      runtime.generation,
      blackParticipantId,
      authority.participantId,
      Date.now(),
    );
    if (written.rowsWritten !== 1) {
      await this.sendState(socket, runtime, "MULTI_SYNC");
      return;
    }
    await this.broadcastState(runtime, "MULTI_SYNC");
  }

  private async recordAndSendRejectedAction(
    runtime: RuntimeMatch,
    authority: ParticipantAuthority,
    socket: WebSocket,
    message: MultiActionMessage,
    payloadJson: string,
    code: "ACTION_INVALID",
  ): Promise<void> {
    const serverSeq = runtime.serverSeq + 1;
    const response: OmokActionLedgerResponseV1 = {
      schemaVersion: OMOK_ACTION_LEDGER_SCHEMA_VERSION,
      kind: "REJECTED",
      generation: runtime.generation,
      serverSeq,
      clientActionId: message.clientActionId,
      code,
      currentRevision: runtime.state.revision,
    };
    const recorded = await this.container.multiplayerMatchRepo.recordAction({
      matchId: runtime.matchId,
      userId: authority.userId,
      participantId: authority.participantId,
      clientSeq: message.clientSeq,
      serverSeq,
      clientActionId: message.clientActionId,
      payloadHash: await this.hashActionPayload(payloadJson, runtime.state.rulesetRevision),
      expectedRevision: message.expectedRevision,
      resultRevision: runtime.state.revision,
      resultCode: code,
      responseJson: encodeOmokActionLedgerResponse(response),
      nowIso: new Date().toISOString(),
    });
    if (recorded.status === "REJECTED") {
      await this.sendActionRejection(
        socket,
        message.clientActionId,
        actionCodeForClient(recorded.code),
        recorded.currentRevision ?? runtime.state.revision,
      );
      return;
    }
    const stored = parseOmokActionLedgerResponse(JSON.parse(recorded.action.responseJson));
    if (!stored) throw new Error("invalid rejected Omok ledger response");
    if (recorded.status === "RECORDED") {
      this.persistRuntimeMatch({ ...runtime, serverSeq: stored.serverSeq });
    }
    await this.sendActionRejection(
      socket,
      stored.clientActionId,
      stored.kind === "REJECTED" ? actionCodeForClient(stored.code) : "ACTION_CONFLICT",
      stored.kind === "REJECTED" ? stored.currentRevision : runtime.state.revision,
    );
  }

  private async handleLeave(
    authority: ParticipantAuthority,
    attachment: ConnectionAttachment,
    socket: WebSocket,
  ): Promise<void> {
    const result = await this.leaveParticipant(authority.userId, authority.generation);
    if (!result.ok) {
      await this.disconnectUnavailable(socket, attachment);
    }
  }

  private async leaveParticipant(userId: number, generation: number, requestedInstanceId?: string) {
    const instanceId = requestedInstanceId ?? this.instanceId();
    const participant = await this.container.multiplayerInstanceRepo.findParticipant(
      instanceId,
      userId,
    );
    const match = await this.container.multiplayerMatchRepo.findMatchByInstanceGeneration(
      instanceId,
      generation,
    );
    if (
      participant &&
      (participant.status === "JOINED" || participant.status === "READY") &&
      match?.status === "ACTIVE"
    ) {
      await this.ensureInternalControlContext(instanceId, generation);
      const runtime = await this.ensureRuntimeMatch(match);
      if (runtime.lifecycle === "ACTIVE") {
        this.broadcastPlayerConnection(participant.id, "LEFT", null);
        await this.beginForfeitCommit(runtime, participant.id, "LEFT");
        if (this.readRuntimeMatch()?.lifecycle !== "COMMITTED") {
          return { ok: false as const, code: "INTERNAL_RETRYABLE" as const };
        }
      } else if (runtime.lifecycle === "TERMINAL_PENDING") {
        await this.commitTerminalResult(runtime);
        if (this.readRuntimeMatch()?.lifecycle !== "COMMITTED") {
          return { ok: false as const, code: "INTERNAL_RETRYABLE" as const };
        }
      }
    }
    const result = await this.container.multiplayerRoomUseCases.leaveRoom({
      userId,
      instanceId,
      expectedGeneration: generation,
    });
    if (!result.ok) return result;
    if (result.instance.status === "ABORTED") {
      const runtime = this.readRuntimeMatch();
      if (runtime) this.persistRuntimeMatch({ ...runtime, lifecycle: "ABORTED" });
      this.broadcastAbort(abortCodeForClient(result.instance.abortCode));
      this.state.storage.sql.exec(
        "DELETE FROM participant_connections WHERE generation = ?",
        generation,
      );
      for (const connected of this.state.getWebSockets()) connected.close(1000, "match aborted");
      return result;
    }
    if (participant) {
      // Remove explicit leavers before closing their sockets. Otherwise webSocketClose would
      // misclassify a deliberate leave as a transient network loss and announce a grace window.
      this.state.storage.sql.exec(
        `DELETE FROM participant_connections
         WHERE participant_id = ? AND generation = ?`,
        participant.id,
        generation,
      );
      for (const connected of this.state.getWebSockets(participantTag(participant.id))) {
        connected.close(1000, "left");
      }
      for (const connected of this.state.getWebSockets(lobbyParticipantTag(participant.id))) {
        connected.close(1000, "left");
      }
    }
    return result;
  }

  private async sendReconnectState(
    socket: WebSocket,
    attachment: ConnectionAttachment,
  ): Promise<void> {
    const match = await this.container.multiplayerMatchRepo.findMatchByInstanceGeneration(
      this.instanceId(),
      attachment.generation,
    );
    if (!match) return;
    if (match.status === "ABORTED") {
      socket.send(
        JSON.stringify({
          type: "MULTI_ABORTED",
          v: MULTIPLAYER_BRIDGE_PROTOCOL_VERSION,
          generation: attachment.generation,
          code: abortCodeForClient(match.abortCode),
        }),
      );
      return;
    }
    if (match.status === "PENDING") return;
    let runtime = await this.ensureRuntimeMatch(match);
    await this.ensureExpectedParticipantConnections(runtime);
    runtime = await this.sendState(socket, runtime, "MULTI_SYNC");
    if (match.status === "COMMITTED" && runtime.terminalResultJson) {
      if (match.committedAt) {
        await this.ensureRematchWindow(match.generation, match.committedAt);
      }
      const terminalResult = JSON.parse(runtime.terminalResultJson) as unknown;
      runtime = this.reserveServerSequence(runtime);
      this.sendTerminalCommitted(socket, runtime, terminalResult);
    } else if (runtime.lifecycle === "TERMINAL_PENDING") {
      runtime = this.reserveServerSequence(runtime);
      this.sendTerminalPending(socket, runtime);
    }
  }

  private async ensureRuntimeMatch(match: MultiplayerMatchRecord): Promise<RuntimeMatch> {
    const current = this.readRuntimeMatch();
    if (current && (current.matchId !== match.id || current.generation !== match.generation)) {
      throw new Error("runtime match context mismatch");
    }
    return this.recoverRuntimeMatch(match, current);
  }

  private async recoverRuntimeMatch(
    match: MultiplayerMatchRecord,
    current: RuntimeMatch | null,
  ): Promise<RuntimeMatch> {
    const authority = this.readRuntimeAuthority();
    if (
      !authority ||
      authority.profileId !== match.profileId ||
      authority.rulesetKey !== OMOK_RULESET_KEY ||
      !isSupportedOmokRulesetRevision(authority.rulesetRevision) ||
      match.generation !== this.generation()
    ) {
      throw new Error("unsupported runtime authority");
    }
    const profileRecord = await this.container.multiplayerProfileRepo.findById(match.profileId);
    if (
      !profileRecord ||
      !isSupportedMultiplayerRuntimeProfile(profileRecord.profile) ||
      profileRecord.profile.gameVersionId !== match.gameVersionId ||
      profileRecord.profile.profileRevision !== match.profileRevision
    ) {
      throw new Error("unsupported multiplayer profile");
    }

    const rulesetRevision: OmokRulesetRevision = authority.rulesetRevision;
    let state = current?.state ?? createInitialOmokState(rulesetRevision);
    if (state.rulesetRevision !== rulesetRevision) {
      throw new Error("runtime state ruleset does not match pinned authority");
    }
    if (state.revision > match.stateRevision) throw new Error("DO state is ahead of D1 ledger");
    if (state.revision < match.stateRevision) {
      const actions = await this.container.multiplayerMatchRepo.listActionsAfterRevision(
        match.id,
        state.revision,
        500,
      );
      for (const action of actions) {
        if (action.resultCode !== "ACCEPTED") continue;
        let response: OmokActionLedgerResponseV1 | null = null;
        try {
          response = parseOmokActionLedgerResponse(JSON.parse(action.responseJson));
        } catch {
          response = null;
        }
        if (
          !response ||
          response.kind !== "ACCEPTED" ||
          response.generation !== match.generation ||
          response.revision !== state.revision + 1 ||
          response.serverSeq !== action.serverSeq
        ) {
          throw new Error("invalid Omok recovery action");
        }
        state = response.state;
      }
    }
    if (state.revision !== match.stateRevision) throw new Error("incomplete Omok action ledger");

    const latestAction = await this.container.multiplayerMatchRepo.findLatestAction(match.id);
    const terminalResultJson = match.terminalResultJson ?? current?.terminalResultJson ?? null;
    const lifecycle: RuntimeLifecycle =
      match.status === "COMMITTED"
        ? "COMMITTED"
        : match.status === "FINALIZING"
          ? "TERMINAL_PENDING"
          : match.status === "ABORTED"
            ? "ABORTED"
            : current?.lifecycle === "TERMINAL_PENDING"
              ? "TERMINAL_PENDING"
              : "ACTIVE";
    return this.persistRuntimeMatch({
      matchId: match.id,
      generation: match.generation,
      state,
      serverSeq: Math.max(current?.serverSeq ?? 0, latestAction?.serverSeq ?? 0),
      lifecycle,
      maxActionBytes: profileRecord.profile.maxActionBytes,
      maxStateBytes: profileRecord.profile.maxStateBytes,
      actionRateLimit: profileRecord.profile.actionRateLimit,
      terminalResultJson,
      finalizationAttempts: current?.finalizationAttempts ?? 0,
    });
  }

  private async beginTerminalCommit(runtime: RuntimeMatch): Promise<void> {
    const terminal = getOmokTerminalResult(runtime.state);
    if (!terminal) throw new Error("terminal Omok state has no result");
    const canonical = await this.canonicalizeOmokTerminalResult(terminal);
    let pending = this.persistRuntimeMatch({
      ...runtime,
      lifecycle: "TERMINAL_PENDING",
      terminalResultJson: JSON.stringify(canonical),
    });
    pending = this.reserveServerSequence(pending);
    this.broadcastTerminalPending(pending);
    await this.commitTerminalResult(pending);
  }

  private async commitTerminalResult(runtime: RuntimeMatch): Promise<void> {
    const terminal = await this.readCanonicalTerminalResult(runtime);
    if (!terminal || !runtime.terminalResultJson) throw new Error("terminal result unavailable");
    const canonicalTerminalJson = JSON.stringify(terminal);
    if (runtime.terminalResultJson !== canonicalTerminalJson) {
      runtime = this.persistRuntimeMatch({
        ...runtime,
        terminalResultJson: canonicalTerminalJson,
      });
    }
    const [players, participants] = await Promise.all([
      this.container.multiplayerMatchRepo.listPlayers(runtime.matchId),
      this.container.multiplayerInstanceRepo.listParticipants(this.instanceId()),
    ]);
    const participantsById = new Map(
      participants.map((participant) => [participant.id, participant]),
    );
    if (players.length !== 2) throw new Error("Omok requires exactly two match players");
    const finalPlayers = players.map((player) => {
      const participant = participantsById.get(player.participantId);
      if (!participant || (participant.seatIndex !== 0 && participant.seatIndex !== 1)) {
        throw new Error("invalid Omok player seat");
      }
      const outcome = this.playerOutcome(terminal, participant.id);
      const placement = outcome === "WIN" ? 1 : outcome === "LOSS" ? 2 : null;
      const gameSeatIndex = this.gameSeatIndexForParticipant(
        participant.id,
        participant.seatIndex,
        runtime.generation,
      );
      return {
        userId: player.userId,
        participantId: player.participantId,
        outcome,
        placement,
        resultJson: JSON.stringify({
          schemaVersion: 1,
          matchId: runtime.matchId,
          generation: runtime.generation,
          seatIndex: gameSeatIndex,
          outcome,
          placement,
          terminalRevision: terminal.revision,
        }),
        rewardEligible: false,
        reward: null,
      } as const;
    });
    const committed = await this.container.multiplayerMatchRepo.finalize({
      matchId: runtime.matchId,
      expectedStateRevision: runtime.state.revision,
      terminalResultJson: canonicalTerminalJson,
      terminalResultHash: await sha256Hex(canonicalTerminalJson),
      players: finalPlayers,
      nowIso: new Date().toISOString(),
    });
    if (committed.status === "REJECTED") {
      const attempts = runtime.finalizationAttempts + 1;
      this.persistRuntimeMatch({ ...runtime, finalizationAttempts: attempts });
      await this.scheduleFinalizationRetry(attempts);
      return;
    }
    await this.enterRematchWindow(runtime.generation);
    let completed = this.persistRuntimeMatch({
      ...runtime,
      lifecycle: "COMMITTED",
      terminalResultJson: committed.match.terminalResultJson,
    });
    completed = this.reserveServerSequence(completed);
    this.broadcastTerminalCommitted(completed, terminal);
    this.state.storage.sql.exec(
      "UPDATE runtime_meta SET lifecycle_status = 'CLOSED', updated_at = ? WHERE singleton = 1",
      Math.floor(Date.now() / 1_000),
    );
    if (committed.match.committedAt) {
      await this.ensureRematchWindow(runtime.generation, committed.match.committedAt);
    }
  }

  private async canonicalizeOmokTerminalResult(
    terminal: OmokTerminalResult,
  ): Promise<CanonicalTerminalResult> {
    if (terminal.kind === "DRAW") {
      return {
        ...terminal,
        winnerParticipantId: null,
        loserParticipantId: null,
        reason: null,
      };
    }
    const participants = await this.container.multiplayerInstanceRepo.listParticipants(
      this.instanceId(),
    );
    const generation = this.generation();
    const winner = participants.find(
      (participant) =>
        this.gameSeatIndexForParticipant(participant.id, participant.seatIndex, generation) ===
        terminal.winnerSeatIndex,
    );
    const loser = participants.find(
      (participant) =>
        this.gameSeatIndexForParticipant(participant.id, participant.seatIndex, generation) ===
        terminal.loserSeatIndex,
    );
    if (!winner || !loser) throw new Error("terminal participant mapping unavailable");
    return {
      ...terminal,
      winnerParticipantId: winner.id,
      loserParticipantId: loser.id,
      reason: null,
    };
  }

  private async readCanonicalTerminalResult(
    runtime: RuntimeMatch,
  ): Promise<CanonicalTerminalResult | null> {
    if (!runtime.terminalResultJson) return null;
    let value: unknown;
    try {
      value = JSON.parse(runtime.terminalResultJson);
    } catch {
      return null;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const source = value as Record<string, unknown>;
    if (source.kind === "FORFEIT") {
      if (
        source.revision !== runtime.state.revision ||
        (source.winnerSeatIndex !== 0 && source.winnerSeatIndex !== 1) ||
        (source.loserSeatIndex !== 0 && source.loserSeatIndex !== 1) ||
        source.winnerSeatIndex === source.loserSeatIndex ||
        !isOpaqueId(source.winnerParticipantId) ||
        !isOpaqueId(source.loserParticipantId) ||
        source.winnerParticipantId === source.loserParticipantId ||
        source.winningLine !== null ||
        (source.reason !== "LEFT" && source.reason !== "DISCONNECTED")
      ) {
        return null;
      }
      const participants = await this.container.multiplayerInstanceRepo.listParticipants(
        this.instanceId(),
      );
      const winner = participants.find(
        (participant) => participant.id === source.winnerParticipantId,
      );
      const loser = participants.find(
        (participant) => participant.id === source.loserParticipantId,
      );
      if (
        !winner ||
        !loser ||
        (winner.seatIndex !== 0 && winner.seatIndex !== 1) ||
        (loser.seatIndex !== 0 && loser.seatIndex !== 1) ||
        this.gameSeatIndexForParticipant(winner.id, winner.seatIndex, runtime.generation) !==
          source.winnerSeatIndex ||
        this.gameSeatIndexForParticipant(loser.id, loser.seatIndex, runtime.generation) !==
          source.loserSeatIndex
      ) {
        return null;
      }
      return {
        kind: "FORFEIT",
        revision: runtime.state.revision,
        winnerSeatIndex: source.winnerSeatIndex,
        loserSeatIndex: source.loserSeatIndex,
        winnerParticipantId: source.winnerParticipantId,
        loserParticipantId: source.loserParticipantId,
        winningLine: null,
        reason: source.reason,
      };
    }

    const authoritative = getOmokTerminalResult(runtime.state);
    if (!authoritative || source.kind !== authoritative.kind) return null;
    if (
      source.revision !== authoritative.revision ||
      source.winnerSeatIndex !== authoritative.winnerSeatIndex ||
      source.winningLine === undefined
    ) {
      return null;
    }
    if (authoritative.kind === "DRAW") {
      return this.canonicalizeOmokTerminalResult(authoritative);
    }
    if (source.loserSeatIndex !== authoritative.loserSeatIndex) return null;
    const canonical = await this.canonicalizeOmokTerminalResult(authoritative);
    if (canonical.kind !== "WIN") return null;
    if (
      source.winnerParticipantId !== undefined &&
      source.winnerParticipantId !== canonical.winnerParticipantId
    ) {
      return null;
    }
    if (
      source.loserParticipantId !== undefined &&
      source.loserParticipantId !== canonical.loserParticipantId
    ) {
      return null;
    }
    return canonical;
  }

  private async beginForfeitCommit(
    runtime: RuntimeMatch,
    loserParticipantId: string,
    reason: "LEFT" | "DISCONNECTED",
  ): Promise<void> {
    const participants = await this.container.multiplayerInstanceRepo.listParticipants(
      this.instanceId(),
    );
    const loser = participants.find((participant) => participant.id === loserParticipantId);
    const winner = participants.find(
      (participant) =>
        participant.id !== loserParticipantId &&
        (participant.status === "JOINED" || participant.status === "READY"),
    );
    if (
      !loser ||
      !winner ||
      (loser.seatIndex !== 0 && loser.seatIndex !== 1) ||
      (winner.seatIndex !== 0 && winner.seatIndex !== 1)
    ) {
      throw new Error("forfeit participant mapping unavailable");
    }
    const terminal: CanonicalTerminalResult = {
      kind: "FORFEIT",
      revision: runtime.state.revision,
      winnerSeatIndex: this.gameSeatIndexForParticipant(
        winner.id,
        winner.seatIndex,
        runtime.generation,
      ),
      loserSeatIndex: this.gameSeatIndexForParticipant(
        loser.id,
        loser.seatIndex,
        runtime.generation,
      ),
      winnerParticipantId: winner.id,
      loserParticipantId: loser.id,
      winningLine: null,
      reason,
    };
    let pending = this.persistRuntimeMatch({
      ...runtime,
      lifecycle: "TERMINAL_PENDING",
      terminalResultJson: JSON.stringify(terminal),
    });
    pending = this.reserveServerSequence(pending);
    this.broadcastTerminalPending(pending);
    await this.commitTerminalResult(pending);
  }

  private playerOutcome(
    terminal: CanonicalTerminalResult,
    participantId: string,
  ): "WIN" | "LOSS" | "DRAW" {
    if (terminal.kind === "DRAW") return "DRAW";
    return terminal.winnerParticipantId === participantId ? "WIN" : "LOSS";
  }

  private async enterRematchWindow(generation: number): Promise<void> {
    const instance = await this.container.multiplayerInstanceRepo.findById(this.instanceId());
    if (!instance || instance.generation !== generation) return;
    const nowIso = new Date().toISOString();
    if (instance.status === "ACTIVE") {
      await this.container.multiplayerInstanceRepo.transition({
        instanceId: instance.id,
        expectedStatus: "ACTIVE",
        expectedGeneration: generation,
        nextStatus: "CLOSING",
        nextGeneration: generation,
        closedAt: null,
        abortCode: null,
        nowIso,
      });
    }
  }

  private async ensureRematchWindow(generation: number, committedAtIso: string): Promise<void> {
    const committedAtMs = Date.parse(committedAtIso);
    if (!Number.isFinite(committedAtMs)) return;
    const expiresAt = committedAtMs + MULTIPLAYER_REMATCH_WINDOW_MS;
    this.state.storage.sql.exec(
      `INSERT INTO rematch_window (singleton, generation, expires_at)
       VALUES (1, ?, ?)
       ON CONFLICT(singleton) DO NOTHING`,
      generation,
      expiresAt,
    );
    if (expiresAt <= Date.now()) {
      await this.closeExpiredRematchWindow(generation);
    } else {
      await this.scheduleNextAlarm(expiresAt);
    }
  }

  private async closeExpiredRematchWindow(generation: number): Promise<void> {
    const instance = await this.container.multiplayerInstanceRepo.findById(this.instanceId());
    if (instance?.status === "CLOSING" && instance.generation === generation) {
      const nowIso = new Date().toISOString();
      await this.container.multiplayerInstanceRepo.transition({
        instanceId: instance.id,
        expectedStatus: "CLOSING",
        expectedGeneration: generation,
        nextStatus: "CLOSED",
        nextGeneration: generation,
        closedAt: nowIso,
        abortCode: null,
        nowIso,
      });
    }
    const runtime = this.readRuntimeMatch();
    if (runtime?.generation === generation && runtime.lifecycle === "COMMITTED") {
      this.broadcastRematchChanged(runtime);
    }
    this.state.storage.sql.exec(
      "DELETE FROM rematch_window WHERE singleton = 1 AND generation = ?",
      generation,
    );
  }

  /** Initializes the same trusted runtime identity that a verified socket ticket would establish.
   * This keeps the authenticated HTTP leave path authoritative even if a player exits before the
   * browser manages to open its first WebSocket. */
  private async ensureInternalControlContext(
    instanceId: string,
    generation: number,
  ): Promise<void> {
    const instance = await this.container.multiplayerInstanceRepo.findById(instanceId);
    if (!instance || instance.generation !== generation) {
      throw new Error("internal multiplayer context is stale");
    }
    const profileRecord = await this.container.multiplayerProfileRepo.findById(instance.profileId);
    if (
      !profileRecord ||
      !isSupportedMultiplayerRuntimeProfile(profileRecord.profile) ||
      profileRecord.profile.gameVersionId !== instance.gameVersionId ||
      profileRecord.profile.profileRevision !== instance.profileRevision
    ) {
      throw new Error("unsupported internal multiplayer context");
    }

    const nowSeconds = Math.floor(Date.now() / 1_000);
    const meta = this.state.storage.sql
      .exec<{
        instance_id: string;
        game_version_id: number;
        profile_revision: number;
        generation: number;
      }>(
        `SELECT instance_id, game_version_id, profile_revision, generation
         FROM runtime_meta WHERE singleton = 1`,
      )
      .toArray()[0];
    if (meta) {
      if (
        meta.instance_id !== instance.id ||
        meta.game_version_id !== instance.gameVersionId ||
        meta.profile_revision !== instance.profileRevision ||
        generation < meta.generation ||
        generation > meta.generation + 1
      ) {
        throw new Error("internal multiplayer context mismatch");
      }
      if (generation === meta.generation + 1) {
        this.state.storage.sql.exec(
          `UPDATE runtime_meta
           SET generation = ?, lifecycle_status = 'INERT', state_schema_version = ?, updated_at = ?
           WHERE singleton = 1 AND generation = ?`,
          generation,
          STATE_SCHEMA_VERSION,
          nowSeconds,
          meta.generation,
        );
        this.state.storage.sql.exec("DELETE FROM runtime_match");
        this.state.storage.sql.exec("DELETE FROM runtime_game_config");
        this.state.storage.sql.exec("DELETE FROM participant_rate_windows");
        this.state.storage.sql.exec("DELETE FROM rematch_window");
      }
    } else {
      this.state.storage.sql.exec(
        `INSERT INTO runtime_meta (
           singleton, instance_id, game_version_id, profile_revision, generation,
           state_schema_version, lifecycle_status, created_at, updated_at
         ) VALUES (1, ?, ?, ?, ?, ?, 'INERT', ?, ?)`,
        instance.id,
        instance.gameVersionId,
        instance.profileRevision,
        generation,
        STATE_SCHEMA_VERSION,
        nowSeconds,
        nowSeconds,
      );
    }

    const runtimeAuthority = this.readRuntimeAuthority();
    if (
      runtimeAuthority &&
      (runtimeAuthority.profileId !== instance.profileId ||
        runtimeAuthority.rulesetKey !== profileRecord.profile.rulesetKey ||
        runtimeAuthority.rulesetRevision !== profileRecord.profile.rulesetRevision)
    ) {
      throw new Error("internal multiplayer authority mismatch");
    }
    if (!runtimeAuthority) {
      this.state.storage.sql.exec(
        `INSERT INTO runtime_authority (
           singleton, profile_id, ruleset_key, ruleset_revision, created_at, updated_at
         ) VALUES (1, ?, ?, ?, ?, ?)`,
        instance.profileId,
        profileRecord.profile.rulesetKey,
        profileRecord.profile.rulesetRevision,
        nowSeconds,
        nowSeconds,
      );
    }

    const participants = (
      await this.container.multiplayerInstanceRepo.listParticipants(instance.id)
    ).filter((participant) => participant.status === "JOINED" || participant.status === "READY");
    for (const participant of participants) {
      if (participant.seatIndex !== 0 && participant.seatIndex !== 1) {
        throw new Error("invalid internal Omok participant seat");
      }
      this.state.storage.sql.exec(
        `INSERT OR IGNORE INTO participant_authority (
           participant_id, generation, user_id, role, seat_index, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
        participant.id,
        generation,
        participant.userId,
        participant.role,
        participant.seatIndex,
        nowSeconds,
      );
      const authority = this.currentAuthority(participant.id, generation);
      if (
        !authority ||
        authority.userId !== participant.userId ||
        authority.role !== participant.role ||
        authority.seatIndex !== participant.seatIndex
      ) {
        throw new Error("internal participant authority mismatch");
      }
    }
  }

  private consumeAdmission(
    claims: MultiplayerJoinTicketClaims,
    nowSeconds: number,
  ): AdmissionResult {
    this.state.storage.sql.exec(
      "DELETE FROM consumed_ticket_nonces WHERE expires_at <= ?",
      nowSeconds,
    );
    const meta = this.state.storage.sql
      .exec<{
        instance_id: string;
        game_version_id: number;
        profile_revision: number;
        generation: number;
      }>(
        `SELECT instance_id, game_version_id, profile_revision, generation
         FROM runtime_meta WHERE singleton = 1`,
      )
      .toArray()[0];
    if (meta) {
      if (
        meta.instance_id !== claims.instanceId ||
        meta.game_version_id !== claims.gameVersionId ||
        meta.profile_revision !== claims.profileRevision ||
        claims.generation < meta.generation ||
        claims.generation > meta.generation + 1
      ) {
        return { ok: false, code: "CONTEXT_MISMATCH" };
      }
      if (claims.generation === meta.generation + 1) {
        this.state.storage.sql.exec(
          `UPDATE runtime_meta
           SET generation = ?, lifecycle_status = 'INERT', state_schema_version = ?, updated_at = ?
           WHERE singleton = 1 AND generation = ?`,
          claims.generation,
          STATE_SCHEMA_VERSION,
          nowSeconds,
          meta.generation,
        );
        this.state.storage.sql.exec("DELETE FROM runtime_match");
        this.state.storage.sql.exec("DELETE FROM runtime_game_config");
        this.state.storage.sql.exec("DELETE FROM participant_rate_windows");
        this.state.storage.sql.exec("DELETE FROM rematch_window");
      }
    } else {
      this.state.storage.sql.exec(
        `INSERT INTO runtime_meta (
           singleton, instance_id, game_version_id, profile_revision, generation,
           state_schema_version, lifecycle_status, created_at, updated_at
         ) VALUES (1, ?, ?, ?, ?, ?, 'INERT', ?, ?)`,
        claims.instanceId,
        claims.gameVersionId,
        claims.profileRevision,
        claims.generation,
        STATE_SCHEMA_VERSION,
        nowSeconds,
        nowSeconds,
      );
    }

    const runtimeAuthority = this.readRuntimeAuthority();
    if (
      runtimeAuthority &&
      (runtimeAuthority.profileId !== claims.profileId ||
        runtimeAuthority.rulesetKey !== claims.rulesetKey ||
        runtimeAuthority.rulesetRevision !== claims.rulesetRevision)
    ) {
      return { ok: false, code: "CONTEXT_MISMATCH" };
    }
    if (!runtimeAuthority) {
      this.state.storage.sql.exec(
        `INSERT INTO runtime_authority (
           singleton, profile_id, ruleset_key, ruleset_revision, created_at, updated_at
         ) VALUES (1, ?, ?, ?, ?, ?)`,
        claims.profileId,
        claims.rulesetKey,
        claims.rulesetRevision,
        nowSeconds,
        nowSeconds,
      );
    }

    const participantAuthority = this.currentAuthority(claims.participantId, claims.generation);
    if (
      participantAuthority &&
      (participantAuthority.userId !== claims.userId ||
        participantAuthority.role !== claims.role ||
        participantAuthority.seatIndex !== claims.seatIndex)
    ) {
      return { ok: false, code: "CONTEXT_MISMATCH" };
    }
    if (!participantAuthority) {
      try {
        this.state.storage.sql.exec(
          `INSERT INTO participant_authority (
             participant_id, generation, user_id, role, seat_index, created_at
           ) VALUES (?, ?, ?, ?, ?, ?)`,
          claims.participantId,
          claims.generation,
          claims.userId,
          claims.role,
          claims.seatIndex,
          nowSeconds,
        );
      } catch {
        return { ok: false, code: "CONTEXT_MISMATCH" };
      }
    }

    const existingNonce = this.state.storage.sql
      .exec<{ present: number }>(
        "SELECT 1 AS present FROM consumed_ticket_nonces WHERE jti = ?",
        claims.jti,
      )
      .toArray()[0];
    if (existingNonce) return { ok: false, code: "REPLAYED" };
    const current = this.currentConnection(claims.participantId);
    if (
      current &&
      (current.generation > claims.generation ||
        (current.generation === claims.generation &&
          current.connectionGeneration >= claims.connectionGeneration))
    ) {
      return { ok: false, code: "STALE" };
    }

    const nonceInsert = this.state.storage.sql.exec(
      `INSERT OR IGNORE INTO consumed_ticket_nonces (
         jti, participant_id, user_id, generation, connection_generation, expires_at, consumed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      claims.jti,
      claims.participantId,
      claims.userId,
      claims.generation,
      claims.connectionGeneration,
      claims.exp,
      nowSeconds,
    );
    nonceInsert.toArray();
    if (nonceInsert.rowsWritten === 0) return { ok: false, code: "REPLAYED" };
    this.state.storage.sql.exec(
      `INSERT INTO participant_connections (
         participant_id, user_id, role, generation, connection_generation,
         connected_at, last_seen_at, disconnected_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(participant_id) DO UPDATE SET
         user_id = excluded.user_id,
         role = excluded.role,
         generation = excluded.generation,
         connection_generation = excluded.connection_generation,
         connected_at = excluded.connected_at,
         last_seen_at = excluded.last_seen_at,
         disconnected_at = NULL`,
      claims.participantId,
      claims.userId,
      claims.role,
      claims.generation,
      claims.connectionGeneration,
      nowSeconds,
      nowSeconds,
    );
    this.state.storage.sql.exec(
      `UPDATE runtime_meta
       SET lifecycle_status = 'ACTIVE', state_schema_version = ?, updated_at = ?
       WHERE singleton = 1`,
      STATE_SCHEMA_VERSION,
      nowSeconds,
    );
    return {
      ok: true,
      previousConnectionGeneration: current?.connectionGeneration ?? null,
    };
  }

  private readRuntimeAuthority(): {
    readonly profileId: number;
    readonly rulesetKey: string;
    readonly rulesetRevision: number;
  } | null {
    const row = this.state.storage.sql
      .exec<{ profile_id: number; ruleset_key: string; ruleset_revision: number }>(
        `SELECT profile_id, ruleset_key, ruleset_revision
         FROM runtime_authority WHERE singleton = 1`,
      )
      .toArray()[0];
    return row && isPositiveInteger(row.profile_id) && isPositiveInteger(row.ruleset_revision)
      ? {
          profileId: row.profile_id,
          rulesetKey: row.ruleset_key,
          rulesetRevision: row.ruleset_revision,
        }
      : null;
  }

  private currentAuthority(participantId: string, generation: number): ParticipantAuthority | null {
    const row = this.state.storage.sql
      .exec<{
        participant_id: string;
        user_id: number;
        role: "HOST" | "PLAYER";
        seat_index: number;
        generation: number;
      }>(
        `SELECT participant_id, user_id, role, seat_index, generation
         FROM participant_authority WHERE participant_id = ? AND generation = ?`,
        participantId,
        generation,
      )
      .toArray()[0];
    if (
      !row ||
      !isPositiveInteger(row.user_id) ||
      (row.role !== "HOST" && row.role !== "PLAYER") ||
      (row.seat_index !== 0 && row.seat_index !== 1) ||
      !isPositiveInteger(row.generation)
    ) {
      return null;
    }
    return {
      participantId: row.participant_id,
      userId: row.user_id,
      role: row.role,
      seatIndex: row.seat_index,
      generation: row.generation,
    };
  }

  private readOmokConfiguration(generation: number): OmokRuntimeConfiguration {
    const row = this.state.storage.sql
      .exec<{
        generation: number;
        status: string;
        black_participant_id: string;
      }>(
        `SELECT generation, status, black_participant_id
         FROM runtime_game_config WHERE singleton = 1`,
      )
      .toArray()[0];
    if (!row) return { status: "PENDING", blackParticipantId: null };
    if (
      row.generation !== generation ||
      row.status !== "LOCKED" ||
      !isOpaqueId(row.black_participant_id)
    ) {
      throw new Error("invalid persisted Omok configuration");
    }
    return { status: "LOCKED", blackParticipantId: row.black_participant_id };
  }

  private gameSeatIndex(authority: ParticipantAuthority): 0 | 1 {
    const configuration = this.readOmokConfiguration(authority.generation);
    if (configuration.status === "PENDING") return authority.seatIndex;
    return configuration.blackParticipantId === authority.participantId ? 0 : 1;
  }

  private gameSeatIndexForParticipant(
    participantId: string,
    fallbackSeatIndex: number,
    generation: number,
  ): 0 | 1 {
    const configuration = this.readOmokConfiguration(generation);
    if (configuration.status === "LOCKED") {
      return configuration.blackParticipantId === participantId ? 0 : 1;
    }
    if (fallbackSeatIndex !== 0 && fallbackSeatIndex !== 1) {
      throw new Error("invalid Omok participant seat");
    }
    return fallbackSeatIndex;
  }

  private projectRuntimeState(state: OmokStateV1, authority: ParticipantAuthority) {
    const configuration = this.readOmokConfiguration(authority.generation);
    const projected = projectOmokState(state, this.gameSeatIndex(authority));
    return {
      ...projected,
      stoneSelection: {
        status: configuration.status,
        canSelect: configuration.status === "PENDING" && authority.role === "HOST",
      },
    };
  }

  private readRuntimeMatch(): RuntimeMatch | null {
    const row = this.state.storage.sql
      .exec<{
        match_id: string;
        generation: number;
        state_json: string;
        revision: number;
        server_seq: number;
        lifecycle_status: RuntimeLifecycle;
        max_action_bytes: number;
        max_state_bytes: number;
        action_rate_limit: number;
        terminal_result_json: string | null;
        finalization_attempts: number;
      }>(
        `SELECT match_id, generation, state_json, revision, server_seq, lifecycle_status,
                max_action_bytes, max_state_bytes, action_rate_limit, terminal_result_json,
                finalization_attempts
         FROM runtime_match WHERE singleton = 1`,
      )
      .toArray()[0];
    if (!row) return null;
    let state: OmokStateV1 | null = null;
    try {
      state = parseOmokStateV1(JSON.parse(row.state_json));
    } catch {
      state = null;
    }
    if (
      !state ||
      state.revision !== row.revision ||
      !isPositiveInteger(row.generation) ||
      !isNonNegativeInteger(row.server_seq) ||
      !["ACTIVE", "TERMINAL_PENDING", "COMMITTED", "ABORTED"].includes(row.lifecycle_status) ||
      !isPositiveInteger(row.max_action_bytes) ||
      !isPositiveInteger(row.max_state_bytes) ||
      !isPositiveInteger(row.action_rate_limit) ||
      !isNonNegativeInteger(row.finalization_attempts)
    ) {
      throw new Error("invalid persisted multiplayer runtime state");
    }
    return {
      matchId: row.match_id,
      generation: row.generation,
      state,
      serverSeq: row.server_seq,
      lifecycle: row.lifecycle_status,
      maxActionBytes: row.max_action_bytes,
      maxStateBytes: row.max_state_bytes,
      actionRateLimit: row.action_rate_limit,
      terminalResultJson: row.terminal_result_json,
      finalizationAttempts: row.finalization_attempts,
    };
  }

  private persistRuntimeMatch(runtime: RuntimeMatch): RuntimeMatch {
    const current = this.readRuntimeMatch();
    if (current) {
      if (current.matchId !== runtime.matchId || current.generation !== runtime.generation) {
        throw new Error("runtime match persistence context mismatch");
      }
      if (
        current.maxActionBytes !== runtime.maxActionBytes ||
        current.maxStateBytes !== runtime.maxStateBytes ||
        current.actionRateLimit !== runtime.actionRateLimit
      ) {
        throw new Error("runtime profile limits changed inside a match");
      }
      if (current.state.revision > runtime.state.revision) return current;
      if (
        current.state.revision === runtime.state.revision &&
        JSON.stringify(current.state) !== JSON.stringify(runtime.state)
      ) {
        throw new Error("conflicting authoritative state at one revision");
      }
      const lifecycleRank: Record<RuntimeLifecycle, number> = {
        ACTIVE: 0,
        TERMINAL_PENDING: 1,
        COMMITTED: 2,
        ABORTED: 2,
      };
      if (
        lifecycleRank[current.lifecycle] > lifecycleRank[runtime.lifecycle] ||
        (current.lifecycle === "COMMITTED" && runtime.lifecycle === "ABORTED") ||
        (current.lifecycle === "ABORTED" && runtime.lifecycle === "COMMITTED")
      ) {
        runtime = { ...runtime, lifecycle: current.lifecycle };
      }
      runtime = {
        ...runtime,
        serverSeq: Math.max(current.serverSeq, runtime.serverSeq),
        terminalResultJson: current.terminalResultJson ?? runtime.terminalResultJson,
        finalizationAttempts: Math.max(current.finalizationAttempts, runtime.finalizationAttempts),
      };
    }
    const stateJson = JSON.stringify(runtime.state);
    if (textEncoder.encode(stateJson).byteLength > runtime.maxStateBytes) {
      throw new Error("authoritative state exceeds approved profile limit");
    }
    this.state.storage.sql.exec(
      `INSERT INTO runtime_match (
         singleton, match_id, generation, state_json, revision, server_seq,
         lifecycle_status, max_action_bytes, max_state_bytes, action_rate_limit,
         terminal_result_json, finalization_attempts, updated_at
       ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(singleton) DO UPDATE SET
         state_json = excluded.state_json,
         revision = excluded.revision,
         server_seq = excluded.server_seq,
         lifecycle_status = excluded.lifecycle_status,
         max_action_bytes = excluded.max_action_bytes,
         max_state_bytes = excluded.max_state_bytes,
         action_rate_limit = excluded.action_rate_limit,
         terminal_result_json = excluded.terminal_result_json,
         finalization_attempts = excluded.finalization_attempts,
         updated_at = excluded.updated_at
       WHERE runtime_match.match_id = excluded.match_id
         AND runtime_match.generation = excluded.generation`,
      runtime.matchId,
      runtime.generation,
      stateJson,
      runtime.state.revision,
      runtime.serverSeq,
      runtime.lifecycle,
      runtime.maxActionBytes,
      runtime.maxStateBytes,
      runtime.actionRateLimit,
      runtime.terminalResultJson,
      runtime.finalizationAttempts,
      Date.now(),
    );
    return runtime;
  }

  private reserveServerSequence(runtime: RuntimeMatch): RuntimeMatch {
    const current = this.readRuntimeMatch();
    const base =
      current &&
      current.matchId === runtime.matchId &&
      current.generation === runtime.generation &&
      current.state.revision >= runtime.state.revision
        ? current
        : runtime;
    return this.persistRuntimeMatch({ ...base, serverSeq: base.serverSeq + 1 });
  }

  private consumeActionRate(
    authority: ParticipantAuthority,
    limit: number,
    nowMs: number,
  ): boolean {
    const row = this.state.storage.sql
      .exec<{ window_started_at: number; action_count: number }>(
        `SELECT window_started_at, action_count FROM participant_rate_windows
         WHERE participant_id = ? AND generation = ?`,
        authority.participantId,
        authority.generation,
      )
      .toArray()[0];
    if (!row || nowMs - row.window_started_at >= ACTION_RATE_WINDOW_MS) {
      this.state.storage.sql.exec(
        `INSERT INTO participant_rate_windows (
           participant_id, generation, window_started_at, action_count
         ) VALUES (?, ?, ?, 1)
         ON CONFLICT(participant_id, generation) DO UPDATE SET
           window_started_at = excluded.window_started_at, action_count = 1`,
        authority.participantId,
        authority.generation,
        nowMs,
      );
      return true;
    }
    if (row.action_count >= limit) return false;
    this.state.storage.sql.exec(
      `UPDATE participant_rate_windows SET action_count = action_count + 1
       WHERE participant_id = ? AND generation = ? AND window_started_at = ?`,
      authority.participantId,
      authority.generation,
      row.window_started_at,
    );
    return true;
  }

  private async hashActionPayload(
    payloadJson: string,
    rulesetRevision: OmokRulesetRevision,
  ): Promise<string> {
    return sha256Hex(
      ["owogg.multiplayer.action.v1", OMOK_RULESET_KEY, String(rulesetRevision), payloadJson].join(
        "\u0000",
      ),
    );
  }

  private async broadcastState(
    runtime: RuntimeMatch,
    type: "MULTI_SYNC" | "MULTI_STATE",
  ): Promise<RuntimeMatch> {
    const sequenced = this.reserveServerSequence(runtime);
    this.broadcastProjectedState(sequenced, type, sequenced.serverSeq);
    return sequenced;
  }

  private broadcastProjectedState(
    runtime: RuntimeMatch,
    type: "MULTI_SYNC" | "MULTI_STATE",
    serverSeq: number,
  ): void {
    for (const socket of this.state.getWebSockets()) {
      const attachment = this.readAttachment(socket);
      if (!attachment || attachment.generation !== runtime.generation || socket.readyState !== 1) {
        continue;
      }
      const authority = this.currentAuthority(attachment.participantId, attachment.generation);
      if (!authority) continue;
      const message = JSON.stringify({
        type,
        v: MULTIPLAYER_BRIDGE_PROTOCOL_VERSION,
        generation: runtime.generation,
        serverSeq,
        revision: runtime.state.revision,
        payload: this.projectRuntimeState(runtime.state, authority),
      });
      if (textEncoder.encode(message).byteLength > runtime.maxStateBytes) {
        socket.close(RUNTIME_UNAVAILABLE_CLOSE_CODE, "state limit exceeded");
      } else {
        socket.send(message);
      }
    }
  }

  private async sendState(
    socket: WebSocket,
    runtime: RuntimeMatch,
    type: "MULTI_SYNC" | "MULTI_STATE",
  ): Promise<RuntimeMatch> {
    const attachment = this.readAttachment(socket);
    if (!attachment) return runtime;
    const authority = this.currentAuthority(attachment.participantId, attachment.generation);
    if (!authority) return runtime;
    const sequenced = this.reserveServerSequence(runtime);
    const message = JSON.stringify({
      type,
      v: MULTIPLAYER_BRIDGE_PROTOCOL_VERSION,
      generation: sequenced.generation,
      serverSeq: sequenced.serverSeq,
      revision: sequenced.state.revision,
      payload: this.projectRuntimeState(sequenced.state, authority),
    });
    if (textEncoder.encode(message).byteLength > sequenced.maxStateBytes) {
      socket.close(RUNTIME_UNAVAILABLE_CLOSE_CODE, "state limit exceeded");
      await this.beginReconnectGrace(attachment, Math.ceil(Date.now() / 1_000));
    } else {
      socket.send(message);
    }
    return sequenced;
  }

  private async sendActionRejection(
    socket: WebSocket,
    clientActionId: string,
    code: MultiplayerActionRejectionCode,
    currentRevision: number,
  ): Promise<void> {
    const runtime = this.readRuntimeMatch();
    const sequenced = runtime ? this.reserveServerSequence(runtime) : null;
    socket.send(
      JSON.stringify({
        type: "MULTI_ACTION_REJECTED",
        v: MULTIPLAYER_BRIDGE_PROTOCOL_VERSION,
        generation: sequenced?.generation ?? this.generation(),
        serverSeq: sequenced?.serverSeq ?? 0,
        clientActionId,
        code,
        currentRevision,
      }),
    );
  }

  private sendStoredActionRejection(
    socket: WebSocket,
    response: Extract<OmokActionLedgerResponseV1, { readonly kind: "REJECTED" }>,
  ): void {
    socket.send(
      JSON.stringify({
        type: "MULTI_ACTION_REJECTED",
        v: MULTIPLAYER_BRIDGE_PROTOCOL_VERSION,
        generation: response.generation,
        serverSeq: response.serverSeq,
        clientActionId: response.clientActionId,
        code: actionCodeForClient(response.code),
        currentRevision: response.currentRevision,
      }),
    );
  }

  private broadcastTerminalPending(runtime: RuntimeMatch): void {
    for (const socket of this.state.getWebSockets()) {
      if (this.readAttachment(socket)) this.sendTerminalPending(socket, runtime);
    }
  }

  private sendTerminalPending(socket: WebSocket, runtime: RuntimeMatch): void {
    if (socket.readyState !== 1) return;
    socket.send(
      JSON.stringify({
        type: "MULTI_TERMINAL_PENDING",
        v: MULTIPLAYER_BRIDGE_PROTOCOL_VERSION,
        generation: runtime.generation,
        serverSeq: runtime.serverSeq,
      }),
    );
  }

  private broadcastTerminalCommitted(runtime: RuntimeMatch, result: CanonicalTerminalResult): void {
    for (const socket of this.state.getWebSockets()) {
      if (this.readAttachment(socket)) this.sendTerminalCommitted(socket, runtime, result);
    }
  }

  private broadcastLobbyChanged(instanceId: string, generation: number): void {
    this.state.storage.sql.exec(
      `INSERT INTO lobby_event_sequence (singleton, generation, server_sequence)
       VALUES (1, ?, 1)
       ON CONFLICT(singleton) DO UPDATE SET
         generation = excluded.generation,
         server_sequence = CASE
           WHEN lobby_event_sequence.generation = excluded.generation
             THEN lobby_event_sequence.server_sequence + 1
           ELSE 1
         END`,
      generation,
    );
    const sequence = this.state.storage.sql
      .exec<{ server_sequence: number }>(
        "SELECT server_sequence FROM lobby_event_sequence WHERE singleton = 1",
      )
      .one().server_sequence;
    const message = JSON.stringify({
      type: "LOBBY_CHANGED",
      v: 1,
      instanceId,
      generation,
      sequence,
    });
    for (const socket of this.state.getWebSockets(lobbyGenerationTag(generation))) {
      if (socket.readyState === 1) socket.send(message);
    }
  }

  private broadcastRematchChanged(runtime: RuntimeMatch): void {
    const sequenced = this.reserveServerSequence(runtime);
    const message = JSON.stringify({
      type: "MULTI_EVENT",
      v: MULTIPLAYER_BRIDGE_PROTOCOL_VERSION,
      generation: sequenced.generation,
      serverSeq: sequenced.serverSeq,
      name: MULTIPLAYER_REMATCH_CHANGED_EVENT,
      payload: {},
    });
    for (const socket of this.state.getWebSockets()) {
      if (socket.readyState !== 1) continue;
      const attachment = this.readAttachment(socket);
      if (!attachment || attachment.generation !== sequenced.generation) continue;
      socket.send(message);
    }
  }

  private playerConnectionMessage(
    runtime: RuntimeMatch,
    participantId: string,
    status: PlayerConnectionStatus,
    reconnectDeadlineAt: string | null,
  ): string {
    return JSON.stringify({
      type: "MULTI_EVENT",
      v: MULTIPLAYER_BRIDGE_PROTOCOL_VERSION,
      generation: runtime.generation,
      serverSeq: runtime.serverSeq,
      name: MULTIPLAYER_PLAYER_CONNECTION_CHANGED_EVENT,
      payload: { participantId, status, reconnectDeadlineAt },
    });
  }

  private broadcastPlayerConnection(
    participantId: string,
    status: PlayerConnectionStatus,
    reconnectDeadlineAt: string | null,
  ): void {
    const current = this.readRuntimeMatch();
    if (!current || current.lifecycle !== "ACTIVE") return;
    const runtime = this.reserveServerSequence(current);
    const message = this.playerConnectionMessage(
      runtime,
      participantId,
      status,
      reconnectDeadlineAt,
    );
    for (const socket of this.state.getWebSockets()) {
      if (socket.readyState !== 1) continue;
      const attachment = this.readAttachment(socket);
      if (!attachment || attachment.generation !== runtime.generation) continue;
      socket.send(message);
    }
  }

  private sendPresenceSnapshot(socket: WebSocket, attachment: ConnectionAttachment): void {
    if (socket.readyState !== 1) return;
    const rows = this.state.storage.sql
      .exec<{
        participant_id: string;
        disconnected_at: number | null;
      }>(
        `SELECT participant_id, disconnected_at
         FROM participant_connections
         WHERE generation = ?
         ORDER BY participant_id`,
        attachment.generation,
      )
      .toArray();
    for (const row of rows) {
      const current = this.readRuntimeMatch();
      if (!current || current.lifecycle !== "ACTIVE") return;
      const runtime = this.reserveServerSequence(current);
      const disconnectedAt = integerValue(row.disconnected_at);
      const reconnectDeadlineAt =
        disconnectedAt === null
          ? null
          : new Date((disconnectedAt + RECONNECT_GRACE_SECONDS) * 1_000).toISOString();
      socket.send(
        this.playerConnectionMessage(
          runtime,
          row.participant_id,
          disconnectedAt === null ? "CONNECTED" : "RECONNECTING",
          reconnectDeadlineAt,
        ),
      );
    }
  }

  private async ensureExpectedParticipantConnections(runtime: RuntimeMatch): Promise<void> {
    if (runtime.lifecycle !== "ACTIVE") return;
    const participants = (
      await this.container.multiplayerInstanceRepo.listParticipants(this.instanceId())
    ).filter((participant) => participant.status === "JOINED" || participant.status === "READY");
    if (participants.length !== 2) {
      throw new Error("Omok runtime requires exactly two active participants");
    }

    const nowSeconds = Math.ceil(Date.now() / 1_000);
    for (const participant of participants) {
      if (participant.seatIndex !== 0 && participant.seatIndex !== 1) {
        throw new Error("invalid Omok participant seat");
      }
      this.state.storage.sql.exec(
        `INSERT OR IGNORE INTO participant_authority (
           participant_id, generation, user_id, role, seat_index, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
        participant.id,
        runtime.generation,
        participant.userId,
        participant.role,
        participant.seatIndex,
        nowSeconds,
      );
      const authority = this.currentAuthority(participant.id, runtime.generation);
      if (
        !authority ||
        authority.userId !== participant.userId ||
        authority.role !== participant.role ||
        authority.seatIndex !== participant.seatIndex
      ) {
        throw new Error("participant authority does not match the active room");
      }
      this.state.storage.sql.exec(
        `INSERT INTO participant_connections (
           participant_id, user_id, role, generation, connection_generation,
           connected_at, last_seen_at, disconnected_at
         ) VALUES (?, ?, ?, ?, 0, ?, ?, ?)
         ON CONFLICT(participant_id) DO UPDATE SET
           user_id = excluded.user_id,
           role = excluded.role,
           generation = excluded.generation,
           connection_generation = 0,
           connected_at = excluded.connected_at,
           last_seen_at = excluded.last_seen_at,
           disconnected_at = excluded.disconnected_at
         WHERE participant_connections.generation < excluded.generation`,
        participant.id,
        participant.userId,
        participant.role,
        runtime.generation,
        nowSeconds,
        nowSeconds,
        nowSeconds,
      );
    }
    const nextMissing = this.state.storage.sql
      .exec<{ disconnected_at: number }>(
        `SELECT MIN(disconnected_at) AS disconnected_at
         FROM participant_connections
         WHERE generation = ? AND disconnected_at IS NOT NULL`,
        runtime.generation,
      )
      .toArray()[0];
    const disconnectedAt = integerValue(nextMissing?.disconnected_at);
    if (disconnectedAt !== null) {
      await this.scheduleNextAlarm((disconnectedAt + RECONNECT_GRACE_SECONDS) * 1_000 + 1);
    }
  }

  private async resolveExpiredDisconnects(nowSeconds: number): Promise<void> {
    const runtime = this.readRuntimeMatch();
    if (!runtime || runtime.lifecycle !== "ACTIVE") return;
    const connections = this.state.storage.sql
      .exec<{ participant_id: string; disconnected_at: number | null }>(
        `SELECT participant_id, disconnected_at
         FROM participant_connections
         WHERE generation = ?
         ORDER BY participant_id`,
        runtime.generation,
      )
      .toArray();
    const expired = connections.filter((row) => {
      const disconnectedAt = integerValue(row.disconnected_at);
      return disconnectedAt !== null && disconnectedAt <= nowSeconds - RECONNECT_GRACE_SECONDS;
    });
    if (expired.length === 0) return;
    const firstExpired = expired[0];

    const connected = new Set(
      connections.filter((row) => row.disconnected_at === null).map((row) => row.participant_id),
    );
    for (const row of expired) {
      this.broadcastPlayerConnection(row.participant_id, "TIMED_OUT", null);
    }
    if (
      expired.length === 1 &&
      firstExpired &&
      [...connected].some((participantId) => participantId !== firstExpired.participant_id)
    ) {
      await this.beginForfeitCommit(runtime, firstExpired.participant_id, "DISCONNECTED");
    } else if (connected.size === 0) {
      if (connections.some((row) => !expired.includes(row))) {
        const nextDeadline = Math.min(
          ...connections.flatMap((row) => {
            const disconnectedAt = integerValue(row.disconnected_at);
            return disconnectedAt === null || disconnectedAt <= nowSeconds - RECONNECT_GRACE_SECONDS
              ? []
              : [(disconnectedAt + RECONNECT_GRACE_SECONDS) * 1_000 + 1];
          }),
        );
        if (Number.isFinite(nextDeadline)) await this.scheduleNextAlarm(nextDeadline);
        return;
      }

      const instance = await this.container.multiplayerInstanceRepo.findById(this.instanceId());
      if (instance?.status === "ACTIVE" && instance.generation === runtime.generation) {
        const nowIso = new Date(nowSeconds * 1_000).toISOString();
        const aborted = await this.container.multiplayerInstanceRepo.transition({
          instanceId: instance.id,
          expectedStatus: "ACTIVE",
          expectedGeneration: runtime.generation,
          nextStatus: "ABORTED",
          nextGeneration: runtime.generation,
          closedAt: nowIso,
          abortCode: "PARTICIPANT_LEFT",
          nowIso,
        });
        if (!aborted) {
          await this.scheduleNextAlarm(Date.now() + FINALIZATION_RETRY_BASE_MS);
          return;
        }
        this.persistRuntimeMatch({ ...runtime, lifecycle: "ABORTED" });
        this.broadcastAbort("PARTICIPANT_LEFT");
        for (const socket of this.state.getWebSockets()) {
          socket.close(1000, "all participants disconnected");
        }
      }
    }
    this.state.storage.sql.exec(
      `DELETE FROM participant_connections
       WHERE generation = ?
         AND disconnected_at IS NOT NULL
         AND disconnected_at <= ?`,
      runtime.generation,
      nowSeconds - RECONNECT_GRACE_SECONDS,
    );
  }

  private sendTerminalCommitted(socket: WebSocket, runtime: RuntimeMatch, result: unknown): void {
    if (socket.readyState !== 1) return;
    socket.send(
      JSON.stringify({
        type: "MULTI_TERMINAL_COMMITTED",
        v: MULTIPLAYER_BRIDGE_PROTOCOL_VERSION,
        generation: runtime.generation,
        serverSeq: runtime.serverSeq,
        result,
      }),
    );
  }

  private broadcastAbort(code: ReturnType<typeof abortCodeForClient>): void {
    for (const socket of this.state.getWebSockets()) {
      if (socket.readyState !== 1) continue;
      const attachment = this.readAttachment(socket);
      if (!attachment) continue;
      socket.send(
        JSON.stringify({
          type: "MULTI_ABORTED",
          v: MULTIPLAYER_BRIDGE_PROTOCOL_VERSION,
          generation: attachment.generation,
          code,
        }),
      );
    }
  }

  private currentConnection(participantId: string): {
    readonly generation: number;
    readonly connectionGeneration: number;
    readonly disconnectedAt: number | null;
  } | null {
    const row = this.state.storage.sql
      .exec<{
        generation: number;
        connection_generation: number;
        disconnected_at: number | null;
      }>(
        `SELECT generation, connection_generation, disconnected_at
         FROM participant_connections WHERE participant_id = ?`,
        participantId,
      )
      .toArray()[0];
    return row
      ? {
          generation: row.generation,
          connectionGeneration: row.connection_generation,
          disconnectedAt: integerValue(row.disconnected_at),
        }
      : null;
  }

  private closeSupersededSockets(
    participantId: string,
    generation: number,
    connectionGeneration: number,
  ): void {
    for (const socket of this.state.getWebSockets(participantTag(participantId))) {
      const attachment = this.readAttachment(socket);
      if (
        !attachment ||
        attachment.generation < generation ||
        (attachment.generation === generation &&
          attachment.connectionGeneration < connectionGeneration)
      ) {
        socket.close(REPLACED_CONNECTION_CLOSE_CODE, "replaced by newer connection");
      }
    }
  }

  private readAttachment(socket: WebSocket): ConnectionAttachment | null {
    try {
      return parseAttachment(socket.deserializeAttachment());
    } catch {
      return null;
    }
  }

  private touchConnection(attachment: ConnectionAttachment, nowSeconds: number): void {
    this.state.storage.sql.exec(
      `UPDATE participant_connections SET last_seen_at = ?
       WHERE participant_id = ? AND generation = ? AND connection_generation = ?
         AND disconnected_at IS NULL`,
      nowSeconds,
      attachment.participantId,
      attachment.generation,
      attachment.connectionGeneration,
    );
  }

  private markDisconnected(attachment: ConnectionAttachment, nowSeconds: number): boolean {
    const result = this.state.storage.sql.exec(
      `UPDATE participant_connections
       SET last_seen_at = ?, disconnected_at = ?
       WHERE participant_id = ? AND generation = ? AND connection_generation = ?
         AND disconnected_at IS NULL`,
      nowSeconds,
      nowSeconds,
      attachment.participantId,
      attachment.generation,
      attachment.connectionGeneration,
    );
    this.state.storage.sql.exec(
      `UPDATE runtime_meta
       SET lifecycle_status = 'INERT', updated_at = ?
       WHERE singleton = 1 AND lifecycle_status = 'ACTIVE'
         AND NOT EXISTS (
           SELECT 1 FROM participant_connections WHERE disconnected_at IS NULL
         )`,
      nowSeconds,
    );
    return result.rowsWritten === 1;
  }

  private async beginReconnectGrace(
    attachment: ConnectionAttachment,
    nowSeconds: number,
  ): Promise<boolean> {
    if (!this.markDisconnected(attachment, nowSeconds)) return false;
    const deadlineMs = (nowSeconds + RECONNECT_GRACE_SECONDS) * 1_000;
    this.broadcastPlayerConnection(
      attachment.participantId,
      "RECONNECTING",
      new Date(deadlineMs).toISOString(),
    );
    await this.scheduleNextAlarm(deadlineMs + 1);
    return true;
  }

  private async disconnectUnavailable(
    socket: WebSocket,
    attachment: ConnectionAttachment,
  ): Promise<void> {
    if (socket.readyState === 1) {
      socket.send(
        JSON.stringify({
          type: "MULTI_DISCONNECTED",
          v: MULTIPLAYER_BRIDGE_PROTOCOL_VERSION,
          generation: attachment.generation,
          code: "SERVER_UNAVAILABLE",
        }),
      );
      socket.close(RUNTIME_UNAVAILABLE_CLOSE_CODE, "runtime unavailable");
    }
    await this.beginReconnectGrace(attachment, Math.ceil(Date.now() / 1_000));
  }

  private instanceId(): string {
    const row = this.state.storage.sql
      .exec<{ instance_id: string }>("SELECT instance_id FROM runtime_meta WHERE singleton = 1")
      .toArray()[0];
    if (!row?.instance_id) throw new Error("missing multiplayer instance context");
    return row.instance_id;
  }

  private generation(): number {
    const row = this.state.storage.sql
      .exec<{ generation: number }>("SELECT generation FROM runtime_meta WHERE singleton = 1")
      .toArray()[0];
    if (!isPositiveInteger(row?.generation)) throw new Error("missing multiplayer generation");
    return row.generation;
  }

  private async scheduleFinalizationRetry(attempts: number): Promise<void> {
    const exponent = Math.min(5, Math.max(0, attempts - 1));
    const delay = Math.min(FINALIZATION_RETRY_MAX_MS, FINALIZATION_RETRY_BASE_MS * 2 ** exponent);
    await this.scheduleNextAlarm(Date.now() + delay);
  }

  private async scheduleNextAlarm(desiredMs: number): Promise<void> {
    const current = await this.state.storage.getAlarm();
    // One DO has one alarm. Outside alarm(), preserve the earliest stored deadline. While alarm()
    // is executing Cloudflare returns null (until a new alarm is set), so the next persisted event
    // naturally schedules itself from the handler.
    if (current === null || desiredMs < current) await this.state.storage.setAlarm(desiredMs);
  }
}
