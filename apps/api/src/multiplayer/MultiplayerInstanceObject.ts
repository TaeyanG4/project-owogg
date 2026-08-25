import { DurableObject } from "cloudflare:workers";
import {
  MULTIPLAYER_BRIDGE_PROTOCOL_VERSION,
  parseGameToHostMultiplayerMessage,
} from "@owogg/game-sdk/bridge";
import { MULTIPLAYER_WEBSOCKET_PROTOCOL, type MultiplayerJoinTicketClaims } from "@owogg/core";
import {
  MULTIPLAYER_INTERNAL_CLAIMS_HEADER,
  MULTIPLAYER_INTERNAL_CONNECT_PATH,
  MULTIPLAYER_INTERNAL_PROTOCOL_HEADER,
  decodeVerifiedMultiplayerClaims,
} from "./internalProtocol.js";

const STATE_SCHEMA_VERSION = 1;
const REPLACED_CONNECTION_CLOSE_CODE = 4001;
const STALE_CONNECTION_CLOSE_CODE = 4002;
const POLICY_CLOSE_CODE = 1008;
const RUNTIME_UNAVAILABLE_CLOSE_CODE = 1013;
const textEncoder = new TextEncoder();

interface ConnectionAttachment {
  readonly participantId: string;
  readonly generation: number;
  readonly connectionGeneration: number;
}

type AdmissionResult =
  | { readonly ok: true; readonly previousConnectionGeneration: number | null }
  | { readonly ok: false; readonly code: "CONTEXT_MISMATCH" | "REPLAYED" | "STALE" };

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
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

function integerValue(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

/**
 * Provider-specific realtime shell. It owns only admission nonce consumption, connection
 * generation, hibernation attachments, and minimal lifecycle persistence. Game state/rules are
 * deliberately absent until the M1 Omok phase supplies an explicit server ruleset.
 *
 * This class uses Cloudflare's DurableObject base so WebSocket upgrades and hibernation events
 * follow the provider's current module contract. `worker.ts` isolates this provider-only import;
 * plain Node tooling imports `app.ts`/`index.ts` and never resolves `cloudflare:workers`.
 */
export class MultiplayerInstanceObject extends DurableObject<Cloudflare.Env> {
  constructor(
    private readonly state: DurableObjectState,
    env: Cloudflare.Env,
  ) {
    super(state, env);
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
      `);
    });
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
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
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (!claims || claims.exp <= nowSeconds) return new Response(null, { status: 401 });

    // Create the pair before SQLite writes so workerd can retain the pending upgrade through its
    // storage output gate. The client endpoint is not returned and the server endpoint is not
    // accepted unless every authority check below succeeds.
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    const admission = this.consumeAdmission(claims, nowSeconds);
    if (!admission.ok) {
      return new Response(null, { status: admission.code === "REPLAYED" ? 401 : 409 });
    }

    // All synchronous SQLite authority updates complete before any socket is accepted. A crash
    // after this point can at worst consume a short-lived ticket without opening a socket; it can
    // never open two sockets from one nonce. The client obtains a fresh generation/ticket through
    // the API. Cleanup alarm I/O is deferred through waitUntil after the upgrade is established.
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
    this.ctx.waitUntil(this.scheduleNonceCleanup(claims.exp));

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  override webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
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

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (parsed.type === "MULTI_LEAVE") {
      this.markDisconnected(attachment, nowSeconds);
      socket.close(1000, "left");
      return;
    }

    // Phase 2 is an inert transport baseline. Never echo or persist an untrusted action before a
    // concrete ruleset owns its schema and authority in the next phase.
    socket.send(
      JSON.stringify({
        type: "MULTI_DISCONNECTED",
        v: MULTIPLAYER_BRIDGE_PROTOCOL_VERSION,
        generation: attachment.generation,
        code: "SERVER_UNAVAILABLE",
      }),
    );
    this.markDisconnected(attachment, nowSeconds);
    socket.close(RUNTIME_UNAVAILABLE_CLOSE_CODE, "ruleset unavailable");
  }

  override webSocketClose(socket: WebSocket): void {
    const attachment = this.readAttachment(socket);
    if (attachment) this.markDisconnected(attachment, Math.floor(Date.now() / 1000));
  }

  override webSocketError(socket: WebSocket): void {
    const attachment = this.readAttachment(socket);
    if (attachment) this.markDisconnected(attachment, Math.floor(Date.now() / 1000));
  }

  override async alarm(): Promise<void> {
    const nowSeconds = Math.floor(Date.now() / 1000);
    this.state.storage.sql.exec(
      "DELETE FROM consumed_ticket_nonces WHERE expires_at <= ?",
      nowSeconds,
    );
    this.state.storage.sql.exec(
      `DELETE FROM participant_connections
       WHERE disconnected_at IS NOT NULL AND disconnected_at <= ?`,
      nowSeconds - 24 * 60 * 60,
    );
    const next = this.state.storage.sql
      .exec<{ expires_at: number }>(
        "SELECT MIN(expires_at) AS expires_at FROM consumed_ticket_nonces",
      )
      .toArray()[0];
    const nextExpiry = integerValue(next?.expires_at);
    if (nextExpiry !== null) await this.scheduleNonceCleanup(nextExpiry);
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
             SET generation = ?, lifecycle_status = 'INERT', updated_at = ?
             WHERE singleton = 1 AND generation = ?`,
          claims.generation,
          nowSeconds,
          meta.generation,
        );
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
    // SqlStorageCursor counters are final only after the cursor is fully consumed.
    nonceInsert.toArray();
    // The expiry index contributes an additional billed row write, so a successful insert can
    // report more than one. INSERT OR IGNORE reports zero only when this nonce already exists.
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
      "UPDATE runtime_meta SET lifecycle_status = 'ACTIVE', updated_at = ? WHERE singleton = 1",
      nowSeconds,
    );
    return {
      ok: true,
      previousConnectionGeneration: current?.connectionGeneration ?? null,
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

  private readAttachment(socket: WebSocket): ConnectionAttachment | null {
    try {
      return parseAttachment(socket.deserializeAttachment());
    } catch {
      return null;
    }
  }

  private markDisconnected(attachment: ConnectionAttachment, nowSeconds: number): void {
    this.state.storage.sql.exec(
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
  }

  private async scheduleNonceCleanup(expiresAtSeconds: number): Promise<void> {
    const desired = expiresAtSeconds * 1000 + 1_000;
    const current = await this.state.storage.getAlarm();
    if (current === null || desired < current) await this.state.storage.setAlarm(desired);
  }
}
