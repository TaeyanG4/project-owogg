import { DurableObject } from "cloudflare:workers";
import {
  MULTIPLAYER_BRIDGE_PROTOCOL_VERSION,
  MULTIPLAYER_RELAY_MAX_CLIENT_ENVELOPE_BYTES,
  parseGameToHostRelayMessage,
  type MultiplayerRelayCloseCode,
} from "@owogg/game-sdk/bridge";
import { MULTIPLAYER_WEBSOCKET_PROTOCOL, type MultiplayerJoinTicketClaims } from "@owogg/core";
import type { D1Database } from "@cloudflare/workers-types";
import {
  MULTIPLAYER_HEARTBEAT_REQUEST,
  MULTIPLAYER_HEARTBEAT_RESPONSE,
  MultiplayerLatencyReportMessageSchema,
  type MultiplayerLatencySample,
} from "@owogg/contracts";
import { createContainer, type AppContainer } from "../container.js";
import {
  MULTIPLAYER_INTERNAL_CLAIMS_HEADER,
  MULTIPLAYER_INTERNAL_CONNECT_PATH,
  MULTIPLAYER_INTERNAL_LEAVE_PATH,
  MULTIPLAYER_INTERNAL_PROTOCOL_HEADER,
  decodeVerifiedMultiplayerClaims,
} from "./internalProtocol.js";
import {
  RelayRuntimeSession,
  consumeRelayConnectionEnvelope,
  createRelayConnectionAttachment,
  parseRelayConnectionAttachment,
  type RelayConnectionAttachment,
} from "./RelayRuntimeSession.js";

const STATE_SCHEMA_VERSION = 4;
const REPLACED_CONNECTION_CLOSE_CODE = 4001;
const STALE_CONNECTION_CLOSE_CODE = 4002;
const POLICY_CLOSE_CODE = 1008;
const RUNTIME_UNAVAILABLE_CLOSE_CODE = 1013;
const MAX_QUEUED_MESSAGES_PER_SOCKET = 16;
const MAX_QUEUED_MESSAGES_PER_OBJECT = 64;
const FINALIZATION_RETRY_BASE_MS = 2_000;
const RECONNECT_GRACE_MS = 30_000;
const RECONNECT_GRACE_SECONDS = RECONNECT_GRACE_MS / 1_000;
// Shared roster latency is operational telemetry, not gameplay data. Keep reports sparse enough
// that an otherwise idle multi-seat room can still hibernate between updates.
const LATENCY_REPORT_MIN_INTERVAL_MS = 30_000;
const textEncoder = new TextEncoder();

interface MultiplayerDurableObjectEnv {
  readonly DB: D1Database;
}

interface ParticipantAuthority {
  readonly participantId: string;
  readonly generation: number;
  readonly userId: number;
  readonly role: "HOST" | "PLAYER";
  readonly seatIndex: number;
}

type AdmissionResult =
  | { readonly ok: true; readonly previousConnectionGeneration: number | null }
  | { readonly ok: false; readonly code: "CONTEXT_MISMATCH" | "REPLAYED" | "STALE" };

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isOpaqueId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(value);
}

function integerValue(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function participantTag(participantId: string): string {
  return `participant:${participantId}`;
}

function isRelayCloseCode(value: unknown): value is MultiplayerRelayCloseCode {
  return (
    typeof value === "string" &&
    [
      "HOST_LEFT",
      "PARTICIPANT_LEFT",
      "ROOM_EXPIRED",
      "ADMIN_KILLED",
      "SERVER_UNAVAILABLE",
    ].includes(value)
  );
}

function relayAbortCode(
  code: MultiplayerRelayCloseCode,
): "PARTICIPANT_LEFT" | "INFRA_FAILURE" | "ADMIN_KILLED" | "VERSION_UNAVAILABLE" {
  if (code === "ROOM_EXPIRED") return "VERSION_UNAVAILABLE";
  if (code === "ADMIN_KILLED") return "ADMIN_KILLED";
  if (code === "SERVER_UNAVAILABLE") return "INFRA_FAILURE";
  return "PARTICIPANT_LEFT";
}

/**
 * Generic multiplayer data plane. The object authenticates room participants, applies bounded
 * Relay policy, stores only connection/snapshot/control state, and never evaluates game rules or
 * writes application actions/results.
 */
export class MultiplayerInstanceObject extends DurableObject<MultiplayerDurableObjectEnv> {
  private readonly container: AppContainer;
  private readonly relay: RelayRuntimeSession;
  private messageQueue: Promise<void> = Promise.resolve();
  private queuedMessageCount = 0;
  private readonly queuedMessagesBySocket = new WeakMap<WebSocket, number>();
  private readonly readyConnections = new Set<string>();

  constructor(
    private readonly state: DurableObjectState,
    env: MultiplayerDurableObjectEnv,
  ) {
    super(state, env);
    this.container = createContainer(env.DB);
    this.relay = new RelayRuntimeSession(state);
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
        CREATE TABLE IF NOT EXISTS participant_authority (
          participant_id TEXT NOT NULL,
          generation INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('HOST', 'PLAYER')),
          seat_index INTEGER NOT NULL CHECK (seat_index BETWEEN 0 AND 7),
          created_at INTEGER NOT NULL,
          PRIMARY KEY (participant_id, generation),
          UNIQUE (generation, user_id),
          UNIQUE (generation, seat_index)
        );
        CREATE TABLE IF NOT EXISTS relay_connection_readiness (
          participant_id TEXT NOT NULL,
          generation INTEGER NOT NULL,
          connection_generation INTEGER NOT NULL,
          ready_at INTEGER NOT NULL,
          PRIMARY KEY (participant_id, generation, connection_generation)
        );
        CREATE TABLE IF NOT EXISTS relay_close_pending (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          generation INTEGER NOT NULL,
          close_code TEXT NOT NULL CHECK (
            close_code IN (
              'HOST_LEFT', 'PARTICIPANT_LEFT', 'ROOM_EXPIRED', 'ADMIN_KILLED',
              'SERVER_UNAVAILABLE'
            )
          ),
          attempts INTEGER NOT NULL DEFAULT 0,
          requested_at INTEGER NOT NULL
        );
      `);
      this.relay.initializeStorage();
    });
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
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
      const task = this.messageQueue.then(async () => {
        await this.ensureInternalControlContext(
          body.instanceId as string,
          body.generation as number,
        );
        return this.leaveRelayParticipant(
          body.userId as number,
          body.generation as number,
          body.instanceId as string,
        );
      });
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
    const attachment = createRelayConnectionAttachment(claims);
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
      await this.prepareRelayGeneration(attachment.generation, Date.now());
      this.relay.sendReconnectSync(server, attachment);
      this.relay.sendLatencySync(this.currentLatencySamples(attachment.generation), server);
      const expiresAt = this.relay.nextExpiryAt();
      if (expiresAt !== null) await this.scheduleNextAlarm(expiresAt);
    } catch {
      await this.disconnectUnavailable(server, attachment);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  override webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    if (
      typeof message !== "string" ||
      message.length > MULTIPLAYER_RELAY_MAX_CLIENT_ENVELOPE_BYTES ||
      textEncoder.encode(message).byteLength > MULTIPLAYER_RELAY_MAX_CLIENT_ENVELOPE_BYTES
    ) {
      socket.close(POLICY_CLOSE_CODE, "invalid Relay message");
      return;
    }
    const socketQueued = this.queuedMessagesBySocket.get(socket) ?? 0;
    if (
      socketQueued >= MAX_QUEUED_MESSAGES_PER_SOCKET ||
      this.queuedMessageCount >= MAX_QUEUED_MESSAGES_PER_OBJECT
    ) {
      socket.close(RUNTIME_UNAVAILABLE_CLOSE_CODE, "message queue overloaded");
      return;
    }
    this.queuedMessagesBySocket.set(socket, socketQueued + 1);
    this.queuedMessageCount += 1;
    const task = this.messageQueue.then(async () => {
      const attachment = this.readAttachment(socket);
      if (!attachment) {
        socket.close(STALE_CONNECTION_CLOSE_CODE, "missing Relay connection context");
        return;
      }
      await this.handleRelayWebSocketMessage(socket, attachment, message);
    });
    this.messageQueue = task
      .catch(async () => {
        const attachment = this.readAttachment(socket);
        if (attachment) await this.disconnectUnavailable(socket, attachment);
      })
      .finally(() => {
        const pending = this.queuedMessagesBySocket.get(socket) ?? 1;
        if (pending <= 1) this.queuedMessagesBySocket.delete(socket);
        else this.queuedMessagesBySocket.set(socket, pending - 1);
        this.queuedMessageCount = Math.max(0, this.queuedMessageCount - 1);
      });
    this.ctx.waitUntil(this.messageQueue);
  }

  override async webSocketClose(socket: WebSocket): Promise<void> {
    await this.queueConnectionLoss(socket);
  }

  override async webSocketError(socket: WebSocket): Promise<void> {
    await this.queueConnectionLoss(socket);
  }

  override async alarm(): Promise<void> {
    const task = this.messageQueue.then(() => this.handleAlarm());
    this.messageQueue = task.then(
      () => undefined,
      () => undefined,
    );
    this.ctx.waitUntil(this.messageQueue);
    await task;
  }

  private async queueConnectionLoss(socket: WebSocket): Promise<void> {
    const attachment = this.readAttachment(socket);
    if (!attachment) return;
    this.readyConnections.delete(
      `${attachment.generation}:${attachment.participantId}:${attachment.connectionGeneration}`,
    );
    const task = this.messageQueue.then(() => this.handleRelayConnectionLoss(attachment));
    this.messageQueue = task.then(
      () => undefined,
      () => undefined,
    );
    this.ctx.waitUntil(this.messageQueue);
    await this.messageQueue;
  }

  private async handleAlarm(): Promise<void> {
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
    await this.handleRelayAlarm(nowMs, nowSeconds);
  }

  private async handleRelayWebSocketMessage(
    socket: WebSocket,
    attachment: RelayConnectionAttachment,
    rawMessage: string,
  ): Promise<void> {
    let decoded: unknown;
    try {
      decoded = JSON.parse(rawMessage);
    } catch {
      socket.close(POLICY_CLOSE_CODE, "invalid Relay message");
      return;
    }
    const latencyReport = MultiplayerLatencyReportMessageSchema.safeParse(decoded);
    const message = latencyReport.success ? null : parseGameToHostRelayMessage(decoded);
    if (!latencyReport.success && !message) {
      socket.close(POLICY_CLOSE_CODE, "invalid Relay message");
      return;
    }
    const messageGeneration = latencyReport.success
      ? latencyReport.data.generation
      : message?.generation;
    if (messageGeneration !== attachment.generation) {
      socket.close(STALE_CONNECTION_CLOSE_CODE, "stale Relay generation");
      return;
    }
    const current = this.currentConnection(attachment.participantId);
    if (
      !current ||
      current.generation !== attachment.generation ||
      current.connectionGeneration !== attachment.connectionGeneration ||
      current.disconnectedAt !== null
    ) {
      socket.close(STALE_CONNECTION_CLOSE_CODE, "stale Relay connection");
      return;
    }
    const authority = this.currentAuthority(attachment.participantId, attachment.generation);
    if (!authority) {
      socket.close(POLICY_CLOSE_CODE, "invalid Relay authority");
      return;
    }
    if (latencyReport.success) {
      this.handleLatencyReport(socket, attachment, latencyReport.data.rttMs, Date.now());
      return;
    }
    if (!message) return;
    if (message.type === "MULTI_READY") {
      await this.handleRelayReady(authority, attachment, socket);
      return;
    }
    if (message.type === "MULTI_LEAVE") {
      await this.handleRelayLeave(authority, socket);
      return;
    }
    const relayAuthority = this.relay.readAuthority();
    if (!relayAuthority) {
      socket.close(RUNTIME_UNAVAILABLE_CLOSE_CODE, "Relay authority unavailable");
      return;
    }
    const sequencedAttachment = consumeRelayConnectionEnvelope(
      socket,
      attachment,
      message.clientSeq,
      relayAuthority.policy.messagesPerSecond,
      Date.now(),
    );
    if (!sequencedAttachment) {
      socket.close(POLICY_CLOSE_CODE, "Relay sequence or rate exceeded");
      return;
    }
    const rawBytes = textEncoder.encode(rawMessage).byteLength;
    if (message.type === "RELAY_SEND") {
      await this.relay.handleSend(socket, sequencedAttachment, authority, message, rawBytes);
      return;
    }
    await this.relay.handleSnapshot(socket, sequencedAttachment, authority, message, rawBytes);
  }

  private handleLatencyReport(
    socket: WebSocket,
    attachment: RelayConnectionAttachment,
    rttMs: number,
    nowMs: number,
  ): void {
    if (
      attachment.latencyReportedAt > 0 &&
      nowMs - attachment.latencyReportedAt < LATENCY_REPORT_MIN_INTERVAL_MS
    ) {
      return;
    }
    const next: RelayConnectionAttachment = {
      ...attachment,
      latencyRttMs: rttMs,
      latencySampledAt: nowMs,
      latencyReportedAt: nowMs,
    };
    socket.serializeAttachment(next);
    this.relay.sendLatencySync(this.currentLatencySamples(attachment.generation));
  }

  private currentLatencySamples(generation: number): readonly MultiplayerLatencySample[] {
    const samples: MultiplayerLatencySample[] = [];
    for (const socket of this.state.getWebSockets()) {
      const attachment = this.readAttachment(socket);
      if (
        !attachment ||
        attachment.generation !== generation ||
        attachment.latencyRttMs === null ||
        attachment.latencySampledAt <= 0
      ) {
        continue;
      }
      const connection = this.currentConnection(attachment.participantId);
      const authority = this.currentAuthority(attachment.participantId, generation);
      if (
        !connection ||
        !authority ||
        connection.generation !== generation ||
        connection.connectionGeneration !== attachment.connectionGeneration ||
        connection.disconnectedAt !== null
      ) {
        continue;
      }
      samples.push({
        participantId: attachment.participantId,
        seatIndex: authority.seatIndex,
        rttMs: attachment.latencyRttMs,
        sampledAt: attachment.latencySampledAt,
      });
    }
    return samples.sort((left, right) => left.seatIndex - right.seatIndex);
  }

  private async prepareRelayGeneration(generation: number, nowMs: number): Promise<void> {
    const instance = await this.container.multiplayerInstanceRepo.findById(this.instanceId());
    if (!instance || instance.status !== "ACTIVE" || instance.generation !== generation) {
      throw new Error("Relay instance is not active");
    }
    const participants = (
      await this.container.multiplayerInstanceRepo.listParticipants(instance.id)
    ).filter((participant) => participant.status === "JOINED" || participant.status === "READY");
    if (
      participants.length < 2 ||
      participants.length > instance.maxPlayers ||
      participants.length > 8 ||
      participants.filter((participant) => participant.role === "HOST").length !== 1 ||
      new Set(participants.map((participant) => participant.id)).size !== participants.length ||
      new Set(participants.map((participant) => participant.userId)).size !== participants.length ||
      new Set(participants.map((participant) => participant.seatIndex)).size !==
        participants.length ||
      participants.some(
        (participant) => participant.seatIndex < 0 || participant.seatIndex >= instance.maxPlayers,
      )
    ) {
      throw new Error("invalid Relay participant roster");
    }

    const nowSeconds = Math.ceil(nowMs / 1_000);
    for (const participant of participants) {
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
        throw new Error("Relay participant authority does not match the active room");
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
        generation,
        nowSeconds,
        nowSeconds,
        nowSeconds,
      );
    }
    this.relay.prepare(generation, nowMs, nowMs + RECONNECT_GRACE_MS);
  }

  private async hasRelayStartupQuorum(generation: number): Promise<boolean> {
    const participants = (
      await this.container.multiplayerInstanceRepo.listParticipants(this.instanceId())
    ).filter((participant) => participant.status === "JOINED" || participant.status === "READY");
    if (participants.length < 2 || participants.length > 8) return false;
    return participants.every((participant) => {
      const row = this.state.storage.sql
        .exec<{
          connection_generation: number;
          disconnected_at: number | null;
          ready_at: number | null;
        }>(
          `SELECT connection.connection_generation, connection.disconnected_at, readiness.ready_at
           FROM participant_connections AS connection
           LEFT JOIN relay_connection_readiness AS readiness
             ON readiness.participant_id = connection.participant_id
            AND readiness.generation = connection.generation
            AND readiness.connection_generation = connection.connection_generation
           WHERE connection.participant_id = ? AND connection.generation = ?`,
          participant.id,
          generation,
        )
        .toArray()[0];
      return Boolean(
        row &&
        isPositiveInteger(row.connection_generation) &&
        row.disconnected_at === null &&
        isNonNegativeInteger(row.ready_at),
      );
    });
  }

  private async handleRelayReady(
    authority: ParticipantAuthority,
    attachment: RelayConnectionAttachment,
    socket: WebSocket,
  ): Promise<void> {
    const readyKey = `${attachment.generation}:${attachment.participantId}:${attachment.connectionGeneration}`;
    if (this.readyConnections.has(readyKey)) return;
    this.readyConnections.add(readyKey);
    const result = await this.container.multiplayerRoomUseCases.readyParticipant({
      userId: authority.userId,
      instanceId: this.instanceId(),
      expectedGeneration: authority.generation,
    });
    if (!result.ok) {
      this.readyConnections.delete(readyKey);
      socket.close(
        result.code === "STALE_GENERATION"
          ? STALE_CONNECTION_CLOSE_CODE
          : RUNTIME_UNAVAILABLE_CLOSE_CODE,
        result.code === "STALE_GENERATION" ? "stale generation" : "Relay room unavailable",
      );
      return;
    }
    if (result.state === "WAITING" || !result.match) {
      this.readyConnections.delete(readyKey);
      return;
    }
    this.state.storage.sql.exec(
      `INSERT OR REPLACE INTO relay_connection_readiness (
         participant_id, generation, connection_generation, ready_at
       ) VALUES (?, ?, ?, ?)`,
      attachment.participantId,
      attachment.generation,
      attachment.connectionGeneration,
      Date.now(),
    );
    await this.prepareRelayGeneration(attachment.generation, Date.now());
    if (!(await this.hasRelayStartupQuorum(attachment.generation))) return;
    const runtime = this.relay.activate(attachment.generation, Date.now());
    this.relay.broadcastSync(runtime);
    await this.scheduleNextAlarm(runtime.expiresAt);
  }

  private async handleRelayLeave(
    authority: ParticipantAuthority,
    socket: WebSocket,
  ): Promise<void> {
    const result = await this.leaveRelayParticipant(authority.userId, authority.generation);
    if (!result.ok) socket.close(RUNTIME_UNAVAILABLE_CLOSE_CODE, "Relay leave unavailable");
  }

  private async handleRelayConnectionLoss(attachment: RelayConnectionAttachment): Promise<void> {
    const connection = this.currentConnection(attachment.participantId);
    if (
      !connection ||
      connection.generation !== attachment.generation ||
      connection.connectionGeneration !== attachment.connectionGeneration ||
      connection.disconnectedAt !== null
    ) {
      return;
    }
    const authority = this.currentAuthority(attachment.participantId, attachment.generation);
    const relayAuthority = this.relay.readAuthority();
    if (!authority || !relayAuthority) return;
    let runtime = this.relay.readRuntime();
    if (!runtime) {
      await this.prepareRelayGeneration(attachment.generation, Date.now());
      runtime = this.relay.readRuntime();
    }
    if (
      !runtime ||
      runtime.generation !== attachment.generation ||
      runtime.lifecycle === "CLOSED"
    ) {
      return;
    }
    if (!this.markDisconnected(attachment, Math.ceil(Date.now() / 1_000))) return;
    if (
      runtime.lifecycle === "ACTIVE" &&
      (authority.role === "HOST" || relayAuthority.policy.reconnect === "none")
    ) {
      await this.closeRelayRoom(authority.role === "HOST" ? "HOST_LEFT" : "PARTICIPANT_LEFT");
      return;
    }
    const deadline =
      runtime.lifecycle === "INERT"
        ? this.relay.startupDeadlineAt(runtime.generation)
        : Date.now() + RECONNECT_GRACE_MS + 1;
    if (deadline !== null) await this.scheduleNextAlarm(deadline);
  }

  private async handleRelayAlarm(nowMs: number, nowSeconds: number): Promise<void> {
    if (!(await this.retryPendingRelayClose())) return;
    const runtime = this.relay.readRuntime();
    if (runtime?.lifecycle === "CLOSED") return;
    const startupDeadline =
      runtime?.lifecycle === "INERT" ? this.relay.startupDeadlineAt(runtime.generation) : null;
    if (startupDeadline !== null && startupDeadline <= nowMs) {
      await this.closeRelayRoom("PARTICIPANT_LEFT");
      return;
    }
    if (runtime?.lifecycle === "ACTIVE" && runtime.expiresAt <= nowMs) {
      await this.closeRelayRoom("ROOM_EXPIRED");
      return;
    }
    const generation = runtime?.generation ?? this.generation();
    const nextDisconnect = this.state.storage.sql
      .exec<{ disconnected_at: number | null }>(
        `SELECT MIN(disconnected_at) AS disconnected_at
         FROM participant_connections
         WHERE generation = ? AND disconnected_at IS NOT NULL`,
        generation,
      )
      .toArray()[0];
    const disconnectedAt = integerValue(nextDisconnect?.disconnected_at);
    if (disconnectedAt !== null) {
      const reconnectDeadlineMs = (disconnectedAt + RECONNECT_GRACE_SECONDS) * 1_000 + 1;
      if (reconnectDeadlineMs <= nowMs) {
        await this.closeRelayRoom("PARTICIPANT_LEFT");
        return;
      }
      await this.scheduleNextAlarm(reconnectDeadlineMs);
    }
    if (runtime?.lifecycle === "ACTIVE" && runtime.expiresAt > nowMs) {
      await this.scheduleNextAlarm(runtime.expiresAt);
    }
    if (startupDeadline !== null && startupDeadline > nowMs) {
      await this.scheduleNextAlarm(startupDeadline);
    }
    const nextNonce = this.state.storage.sql
      .exec<{ expires_at: number }>(
        "SELECT MIN(expires_at) AS expires_at FROM consumed_ticket_nonces WHERE expires_at > ?",
        nowSeconds,
      )
      .toArray()[0];
    const nextExpiry = integerValue(nextNonce?.expires_at);
    if (nextExpiry !== null) await this.scheduleNextAlarm(nextExpiry * 1_000 + 1_000);
  }

  private async closeRelayRoom(code: MultiplayerRelayCloseCode): Promise<void> {
    const pending = this.requestRelayClose(this.generation(), code);
    this.relay.close(pending.closeCode);
    await this.retryPendingRelayClose();
  }

  private requestRelayClose(
    generation: number,
    closeCode: MultiplayerRelayCloseCode,
  ): {
    readonly generation: number;
    readonly closeCode: MultiplayerRelayCloseCode;
    readonly attempts: number;
  } {
    this.state.storage.sql.exec(
      `INSERT OR IGNORE INTO relay_close_pending (
         singleton, generation, close_code, attempts, requested_at
       ) VALUES (1, ?, ?, 0, ?)`,
      generation,
      closeCode,
      Date.now(),
    );
    const pending = this.readPendingRelayClose();
    if (!pending || pending.generation !== generation) {
      throw new Error("conflicting Relay close request");
    }
    return pending;
  }

  private readPendingRelayClose(): {
    readonly generation: number;
    readonly closeCode: MultiplayerRelayCloseCode;
    readonly attempts: number;
  } | null {
    const row = this.state.storage.sql
      .exec<{ generation: number; close_code: string; attempts: number }>(
        "SELECT generation, close_code, attempts FROM relay_close_pending WHERE singleton = 1",
      )
      .toArray()[0];
    if (
      !row ||
      !isPositiveInteger(row.generation) ||
      !isRelayCloseCode(row.close_code) ||
      !isNonNegativeInteger(row.attempts)
    ) {
      return null;
    }
    return { generation: row.generation, closeCode: row.close_code, attempts: row.attempts };
  }

  private async retryPendingRelayClose(): Promise<boolean> {
    const pending = this.readPendingRelayClose();
    if (!pending) return true;
    try {
      const instance = await this.container.multiplayerInstanceRepo.findById(this.instanceId());
      if (
        instance?.generation === pending.generation &&
        ["CLOSED", "ABORTED", "EXPIRED"].includes(instance.status)
      ) {
        this.state.storage.sql.exec("DELETE FROM relay_close_pending WHERE singleton = 1");
        return true;
      }
      if (!instance || instance.status !== "ACTIVE" || instance.generation !== pending.generation) {
        throw new Error("Relay close target is no longer active");
      }
      const nowIso = new Date().toISOString();
      const transitioned = await this.container.multiplayerInstanceRepo.transition({
        instanceId: instance.id,
        expectedStatus: "ACTIVE",
        expectedGeneration: pending.generation,
        nextStatus: "ABORTED",
        nextGeneration: pending.generation,
        closedAt: nowIso,
        abortCode: relayAbortCode(pending.closeCode),
        nowIso,
      });
      if (!transitioned) throw new Error("Relay close compare-and-set failed");
      this.state.storage.sql.exec("DELETE FROM relay_close_pending WHERE singleton = 1");
      return true;
    } catch {
      try {
        const instance = await this.container.multiplayerInstanceRepo.findById(this.instanceId());
        if (
          instance?.generation === pending.generation &&
          ["CLOSED", "ABORTED", "EXPIRED"].includes(instance.status)
        ) {
          this.state.storage.sql.exec("DELETE FROM relay_close_pending WHERE singleton = 1");
          return true;
        }
      } catch {
        // The durable pending row remains authoritative when D1 cannot be read.
      }
      this.state.storage.sql.exec(
        "UPDATE relay_close_pending SET attempts = attempts + 1 WHERE singleton = 1",
      );
      await this.scheduleNextAlarm(Date.now() + FINALIZATION_RETRY_BASE_MS);
      return false;
    }
  }

  private async leaveRelayParticipant(
    userId: number,
    generation: number,
    requestedInstanceId?: string,
  ) {
    const instanceId = requestedInstanceId ?? this.instanceId();
    const participant = await this.container.multiplayerInstanceRepo.findParticipant(
      instanceId,
      userId,
    );
    const result = await this.container.multiplayerRoomUseCases.leaveRoom({
      userId,
      instanceId,
      expectedGeneration: generation,
    });
    if (!result.ok) return result;

    if (participant?.role === "HOST" || result.instance.status === "ABORTED") {
      this.relay.close(participant?.role === "HOST" ? "HOST_LEFT" : "PARTICIPANT_LEFT");
    }
    if (participant) {
      this.state.storage.sql.exec(
        `DELETE FROM participant_connections
         WHERE participant_id = ? AND generation = ?`,
        participant.id,
        generation,
      );
      this.state.storage.sql.exec(
        `DELETE FROM participant_authority
         WHERE participant_id = ? AND generation = ?`,
        participant.id,
        generation,
      );
      for (const connected of this.state.getWebSockets(participantTag(participant.id))) {
        connected.close(1000, "left");
      }
    }
    return result;
  }

  private async ensureInternalControlContext(
    instanceId: string,
    generation: number,
  ): Promise<void> {
    const instance = await this.container.multiplayerInstanceRepo.findById(instanceId);
    if (!instance || instance.generation !== generation) {
      throw new Error("internal multiplayer context is stale");
    }
    const profileRecord = await this.container.multiplayerProfileRepo.findById(instance.profileId);
    const profile = profileRecord?.profile;
    if (
      !profileRecord ||
      !profile ||
      profile.gameId !== instance.gameId ||
      profile.gameVersionId !== instance.gameVersionId ||
      profile.profileRevision !== instance.profileRevision ||
      profile.contentHash !== instance.contentHash
    ) {
      throw new Error("unsupported internal Relay context");
    }

    const nowSeconds = Math.floor(Date.now() / 1_000);
    this.establishRuntimeMeta(instance, generation, nowSeconds);
    if (
      !this.relay.establishAuthority(
        instance.profileId,
        profile.contentHash,
        {
          kind: "relay",
          protocolVersion: profile.protocolVersion,
          reconnect: profile.reconnectPolicy,
          directMessages: profile.directMessages,
          hostSnapshot: profile.hostSnapshot,
          maxMessageBytes: profile.maxMessageBytes,
          maxSnapshotBytes: profile.maxSnapshotBytes,
          messagesPerSecond: profile.messagesPerSecond,
          roomBytesPerSecond: profile.roomBytesPerSecond,
          roomTtlSeconds: profile.roomTtlSeconds,
          hostDeparturePolicy: profile.hostDeparturePolicy,
          resultTrust: profile.resultTrust,
        },
        nowSeconds * 1_000,
      )
    ) {
      throw new Error("internal Relay authority mismatch");
    }

    const participants = (
      await this.container.multiplayerInstanceRepo.listParticipants(instance.id)
    ).filter((participant) => participant.status === "JOINED" || participant.status === "READY");
    for (const participant of participants) {
      if (participant.seatIndex < 0 || participant.seatIndex > 7) {
        throw new Error("invalid internal Relay participant seat");
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
        throw new Error("internal Relay participant authority mismatch");
      }
    }
  }

  private consumeAdmission(
    claims: MultiplayerJoinTicketClaims,
    nowSeconds: number,
  ): AdmissionResult {
    if (claims.seatIndex < 0 || claims.seatIndex > 7) {
      return { ok: false, code: "CONTEXT_MISMATCH" };
    }
    this.state.storage.sql.exec(
      "DELETE FROM consumed_ticket_nonces WHERE expires_at <= ?",
      nowSeconds,
    );
    const existingNonce = this.state.storage.sql
      .exec<{ present: number }>(
        "SELECT 1 AS present FROM consumed_ticket_nonces WHERE jti = ?",
        claims.jti,
      )
      .toArray()[0];
    if (existingNonce) return { ok: false, code: "REPLAYED" };

    const meta = this.readRuntimeMeta();
    if (meta) {
      if (
        meta.instanceId !== claims.instanceId ||
        meta.gameVersionId !== claims.gameVersionId ||
        meta.profileRevision !== claims.profileRevision ||
        claims.generation < meta.generation ||
        claims.generation > meta.generation + 1
      ) {
        return { ok: false, code: "CONTEXT_MISMATCH" };
      }
      if (
        claims.generation === meta.generation &&
        this.relay.readRuntime()?.lifecycle === "CLOSED"
      ) {
        return { ok: false, code: "CONTEXT_MISMATCH" };
      }
      if (claims.generation === meta.generation + 1) {
        this.advanceGeneration(claims.generation, meta.generation, nowSeconds);
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

    const relayAuthority = this.relay.readAuthority();
    if (
      (relayAuthority &&
        (relayAuthority.profileId !== claims.profileId ||
          relayAuthority.contentHash !== claims.contentHash)) ||
      !this.relay.establishAuthority(
        claims.profileId,
        claims.contentHash,
        claims.runtime,
        nowSeconds * 1_000,
      )
    ) {
      return { ok: false, code: "CONTEXT_MISMATCH" };
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

    const current = this.currentConnection(claims.participantId);
    if (
      current &&
      current.disconnectedAt !== null &&
      current.disconnectedAt <= nowSeconds - RECONNECT_GRACE_SECONDS
    ) {
      return { ok: false, code: "STALE" };
    }
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
    return {
      ok: true,
      previousConnectionGeneration: current?.connectionGeneration ?? null,
    };
  }

  private establishRuntimeMeta(
    instance: {
      readonly id: string;
      readonly gameVersionId: number;
      readonly profileRevision: number;
    },
    generation: number,
    nowSeconds: number,
  ): void {
    const meta = this.readRuntimeMeta();
    if (meta) {
      if (
        meta.instanceId !== instance.id ||
        meta.gameVersionId !== instance.gameVersionId ||
        meta.profileRevision !== instance.profileRevision ||
        generation < meta.generation ||
        generation > meta.generation + 1
      ) {
        throw new Error("internal Relay context mismatch");
      }
      if (generation === meta.generation + 1) {
        this.advanceGeneration(generation, meta.generation, nowSeconds);
      }
      return;
    }
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

  private readRuntimeMeta(): {
    readonly instanceId: string;
    readonly gameVersionId: number;
    readonly profileRevision: number;
    readonly generation: number;
  } | null {
    const row = this.state.storage.sql
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
    return row
      ? {
          instanceId: row.instance_id,
          gameVersionId: row.game_version_id,
          profileRevision: row.profile_revision,
          generation: row.generation,
        }
      : null;
  }

  private advanceGeneration(
    generation: number,
    previousGeneration: number,
    nowSeconds: number,
  ): void {
    const update = this.state.storage.sql.exec(
      `UPDATE runtime_meta
       SET generation = ?, lifecycle_status = 'INERT', state_schema_version = ?, updated_at = ?
       WHERE singleton = 1 AND generation = ?`,
      generation,
      STATE_SCHEMA_VERSION,
      nowSeconds,
      previousGeneration,
    );
    if (update.rowsWritten !== 1) throw new Error("Relay generation compare-and-set failed");
    this.relay.resetGeneration();
    this.readyConnections.clear();
    this.state.storage.sql.exec("DELETE FROM relay_connection_readiness");
    this.state.storage.sql.exec("DELETE FROM relay_close_pending");
  }

  private currentAuthority(participantId: string, generation: number): ParticipantAuthority | null {
    const row = this.state.storage.sql
      .exec<{ user_id: number; role: string; seat_index: number }>(
        `SELECT user_id, role, seat_index FROM participant_authority
         WHERE participant_id = ? AND generation = ?`,
        participantId,
        generation,
      )
      .toArray()[0];
    if (
      !row ||
      !isPositiveInteger(row.user_id) ||
      (row.role !== "HOST" && row.role !== "PLAYER") ||
      !isNonNegativeInteger(row.seat_index) ||
      row.seat_index > 7
    ) {
      return null;
    }
    return {
      participantId,
      generation,
      userId: row.user_id,
      role: row.role,
      seatIndex: row.seat_index,
    };
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

  private readAttachment(socket: WebSocket): RelayConnectionAttachment | null {
    try {
      return parseRelayConnectionAttachment(socket.deserializeAttachment());
    } catch {
      return null;
    }
  }

  private markDisconnected(attachment: RelayConnectionAttachment, nowSeconds: number): boolean {
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
           SELECT 1 FROM participant_connections
           WHERE generation = ? AND disconnected_at IS NULL
         )`,
      nowSeconds,
      attachment.generation,
    );
    return result.rowsWritten === 1;
  }

  private async disconnectUnavailable(
    socket: WebSocket,
    attachment: RelayConnectionAttachment,
  ): Promise<void> {
    if (socket.readyState === 1) {
      socket.send(
        JSON.stringify({
          type: "RELAY_CLOSED",
          v: MULTIPLAYER_BRIDGE_PROTOCOL_VERSION,
          generation: attachment.generation,
          code: "SERVER_UNAVAILABLE",
        }),
      );
      socket.close(RUNTIME_UNAVAILABLE_CLOSE_CODE, "Relay runtime unavailable");
    }
    await this.handleRelayConnectionLoss(attachment);
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

  private async scheduleNextAlarm(desiredMs: number): Promise<void> {
    if (!Number.isFinite(desiredMs) || desiredMs <= Date.now()) return;
    const current = await this.state.storage.getAlarm();
    if (current === null || desiredMs < current) await this.state.storage.setAlarm(desiredMs);
  }
}
