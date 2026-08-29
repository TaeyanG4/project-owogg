import {
  MULTIPLAYER_BRIDGE_PROTOCOL_VERSION,
  type MultiplayerRelayCloseCode,
  type MultiplayerRelayRejectionCode,
  type RelaySendMessage,
  type RelaySnapshotSetMessage,
} from "@owogg/game-sdk/bridge";
import {
  parseMultiplayerRelayTicketRuntimeV1,
  type MultiplayerRelayTicketRuntimeV1,
} from "@owogg/core";

const RELAY_SLOW_CONSUMER_BYTES = 32 * 1024;
const RELAY_RATE_WINDOW_MS = 1_000;
const textEncoder = new TextEncoder();

export function classifyRelayDeliveryBackpressure(bufferedAmount: number): "send" | "close" {
  return Number.isFinite(bufferedAmount) &&
    bufferedAmount >= 0 &&
    bufferedAmount < RELAY_SLOW_CONSUMER_BYTES
    ? "send"
    : "close";
}

export interface RelayConnectionAttachment {
  readonly participantId: string;
  readonly generation: number;
  readonly connectionGeneration: number;
  readonly runtime: "relay";
  readonly lastClientSeq: number;
  readonly rateWindowStartedAt: number;
  readonly rateMessageCount: number;
}

export interface RelayParticipantAuthority {
  readonly participantId: string;
  readonly userId: number;
  readonly role: "HOST" | "PLAYER";
  readonly seatIndex: number;
  readonly generation: number;
}

export interface RelayRuntimeRecord {
  readonly generation: number;
  readonly lifecycle: "INERT" | "ACTIVE" | "CLOSED";
  readonly serverSeq: number;
  readonly snapshotRevision: number;
  readonly snapshotHash: string | null;
  readonly snapshotJson: string | null;
  readonly byteWindowStartedAt: number;
  readonly byteWindowTotal: number;
  readonly expiresAt: number;
}

export interface RelayRuntimeAuthority {
  readonly profileId: number;
  readonly contentHash: string;
  readonly policy: MultiplayerRelayTicketRuntimeV1;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isOpaqueId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(value);
}

function exactKeys(source: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(source);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

export function parseRelayConnectionAttachment(value: unknown): RelayConnectionAttachment | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (
    !exactKeys(source, [
      "participantId",
      "generation",
      "connectionGeneration",
      "runtime",
      "lastClientSeq",
      "rateWindowStartedAt",
      "rateMessageCount",
    ]) ||
    !isOpaqueId(source.participantId) ||
    !isPositiveInteger(source.generation) ||
    !isPositiveInteger(source.connectionGeneration) ||
    source.runtime !== "relay" ||
    !isNonNegativeInteger(source.lastClientSeq) ||
    !isNonNegativeInteger(source.rateWindowStartedAt) ||
    !isNonNegativeInteger(source.rateMessageCount)
  ) {
    return null;
  }
  return {
    participantId: source.participantId,
    generation: source.generation,
    connectionGeneration: source.connectionGeneration,
    runtime: "relay",
    lastClientSeq: source.lastClientSeq,
    rateWindowStartedAt: source.rateWindowStartedAt,
    rateMessageCount: source.rateMessageCount,
  };
}

export function createRelayConnectionAttachment(input: {
  readonly participantId: string;
  readonly generation: number;
  readonly connectionGeneration: number;
}): RelayConnectionAttachment {
  return {
    participantId: input.participantId,
    generation: input.generation,
    connectionGeneration: input.connectionGeneration,
    runtime: "relay",
    lastClientSeq: 0,
    rateWindowStartedAt: 0,
    rateMessageCount: 0,
  };
}

function stablePolicyJson(policy: MultiplayerRelayTicketRuntimeV1): string {
  return JSON.stringify({
    kind: policy.kind,
    protocolVersion: policy.protocolVersion,
    reconnect: policy.reconnect,
    directMessages: policy.directMessages,
    hostSnapshot: policy.hostSnapshot,
    maxMessageBytes: policy.maxMessageBytes,
    maxSnapshotBytes: policy.maxSnapshotBytes,
    messagesPerSecond: policy.messagesPerSecond,
    roomBytesPerSecond: policy.roomBytesPerSecond,
    roomTtlSeconds: policy.roomTtlSeconds,
    hostDeparturePolicy: policy.hostDeparturePolicy,
    resultTrust: policy.resultTrust,
  });
}

export class RelayRuntimeSession {
  constructor(private readonly state: DurableObjectState) {}

  initializeStorage(): void {
    this.state.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS relay_authority (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        profile_id INTEGER NOT NULL,
        policy_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS relay_runtime (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        generation INTEGER NOT NULL,
        lifecycle_status TEXT NOT NULL CHECK (lifecycle_status IN ('INERT', 'ACTIVE', 'CLOSED')),
        server_seq INTEGER NOT NULL,
        snapshot_revision INTEGER NOT NULL,
        snapshot_hash TEXT,
        snapshot_json TEXT,
        byte_window_started_at INTEGER NOT NULL,
        byte_window_total INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS relay_bundle_authority (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        profile_id INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS relay_startup_deadline (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        generation INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `);
  }

  establishAuthority(
    profileId: number,
    contentHash: string,
    policy: MultiplayerRelayTicketRuntimeV1,
    nowMs: number,
  ): boolean {
    const parsed = parseMultiplayerRelayTicketRuntimeV1(policy);
    if (!isPositiveInteger(profileId) || !/^[a-f0-9]{64}$/.test(contentHash) || !parsed)
      return false;
    const existing = this.readAuthority();
    if (existing) {
      return (
        existing.profileId === profileId &&
        existing.contentHash === contentHash &&
        stablePolicyJson(existing.policy) === stablePolicyJson(parsed)
      );
    }
    const oldPolicy = this.readPolicyAuthority();
    if (oldPolicy) {
      if (
        oldPolicy.profileId !== profileId ||
        stablePolicyJson(oldPolicy.policy) !== stablePolicyJson(parsed)
      ) {
        return false;
      }
      this.state.storage.sql.exec(
        `INSERT OR IGNORE INTO relay_bundle_authority
           (singleton, profile_id, content_hash, created_at) VALUES (1, ?, ?, ?)`,
        profileId,
        contentHash,
        nowMs,
      );
      return this.readAuthority()?.contentHash === contentHash;
    }
    this.state.storage.sql.exec(
      `INSERT INTO relay_authority (singleton, profile_id, policy_json, created_at, updated_at)
       VALUES (1, ?, ?, ?, ?)`,
      profileId,
      stablePolicyJson(parsed),
      nowMs,
      nowMs,
    );
    this.state.storage.sql.exec(
      `INSERT INTO relay_bundle_authority
         (singleton, profile_id, content_hash, created_at) VALUES (1, ?, ?, ?)`,
      profileId,
      contentHash,
      nowMs,
    );
    return true;
  }

  readAuthority(): RelayRuntimeAuthority | null {
    const policy = this.readPolicyAuthority();
    if (!policy) return null;
    const bundle = this.state.storage.sql
      .exec<{ profile_id: number; content_hash: string }>(
        "SELECT profile_id, content_hash FROM relay_bundle_authority WHERE singleton = 1",
      )
      .toArray()[0];
    return bundle &&
      bundle.profile_id === policy.profileId &&
      /^[a-f0-9]{64}$/.test(bundle.content_hash)
      ? { ...policy, contentHash: bundle.content_hash }
      : null;
  }

  private readPolicyAuthority(): Omit<RelayRuntimeAuthority, "contentHash"> | null {
    const row = this.state.storage.sql
      .exec<{ profile_id: number; policy_json: string }>(
        "SELECT profile_id, policy_json FROM relay_authority WHERE singleton = 1",
      )
      .toArray()[0];
    if (!row || !isPositiveInteger(row.profile_id) || typeof row.policy_json !== "string") {
      return null;
    }
    try {
      const policy = parseMultiplayerRelayTicketRuntimeV1(JSON.parse(row.policy_json));
      return policy ? { profileId: row.profile_id, policy } : null;
    } catch {
      return null;
    }
  }

  resetGeneration(): void {
    this.state.storage.sql.exec("DELETE FROM relay_runtime");
    this.state.storage.sql.exec("DELETE FROM relay_startup_deadline");
  }

  prepare(generation: number, nowMs: number, startupDeadlineAt: number): RelayRuntimeRecord {
    if (
      !isPositiveInteger(generation) ||
      !isNonNegativeInteger(nowMs) ||
      !isNonNegativeInteger(startupDeadlineAt) ||
      startupDeadlineAt <= nowMs
    ) {
      throw new Error("invalid Relay startup context");
    }
    const authority = this.readAuthority();
    if (!authority) throw new Error("Relay authority unavailable");
    const current = this.readRuntime();
    if (current && current.generation !== generation) {
      throw new Error("Relay generation mismatch");
    }
    if (!current) {
      this.state.storage.sql.exec(
        `INSERT INTO relay_runtime (
           singleton, generation, lifecycle_status, server_seq, snapshot_revision,
           snapshot_hash, snapshot_json, byte_window_started_at, byte_window_total,
           expires_at, updated_at
         ) VALUES (1, ?, 'INERT', 0, 0, NULL, NULL, ?, 0, ?, ?)`,
        generation,
        nowMs,
        nowMs + authority.policy.roomTtlSeconds * 1_000,
        nowMs,
      );
      this.state.storage.sql.exec(
        `INSERT INTO relay_startup_deadline (singleton, generation, expires_at)
         VALUES (1, ?, ?)`,
        generation,
        startupDeadlineAt,
      );
    } else if (current.lifecycle === "INERT") {
      this.state.storage.sql.exec(
        `INSERT OR IGNORE INTO relay_startup_deadline (singleton, generation, expires_at)
         VALUES (1, ?, ?)`,
        generation,
        startupDeadlineAt,
      );
    }
    return this.requiredRuntime();
  }

  activate(generation: number, nowMs: number): RelayRuntimeRecord {
    if (!isPositiveInteger(generation) || !isNonNegativeInteger(nowMs)) {
      throw new Error("invalid Relay activation context");
    }
    const authority = this.readAuthority();
    if (!authority) throw new Error("Relay authority unavailable");
    const current = this.readRuntime();
    if (current && current.generation !== generation) {
      throw new Error("Relay generation mismatch");
    }
    if (!current) throw new Error("Relay runtime was not prepared");
    if (current.lifecycle === "INERT") {
      this.state.storage.sql.exec(
        `UPDATE relay_runtime
         SET lifecycle_status = 'ACTIVE', expires_at = ?, updated_at = ?
         WHERE singleton = 1 AND generation = ? AND lifecycle_status = 'INERT'`,
        nowMs + authority.policy.roomTtlSeconds * 1_000,
        nowMs,
        generation,
      );
      this.state.storage.sql.exec(
        "DELETE FROM relay_startup_deadline WHERE singleton = 1 AND generation = ?",
        generation,
      );
    }
    const activated = this.readRuntime();
    if (!activated || activated.lifecycle !== "ACTIVE") {
      throw new Error("Relay runtime failed to activate");
    }
    return activated;
  }

  readRuntime(): RelayRuntimeRecord | null {
    const row = this.state.storage.sql
      .exec<{
        generation: number;
        lifecycle_status: "INERT" | "ACTIVE" | "CLOSED";
        server_seq: number;
        snapshot_revision: number;
        snapshot_hash: string | null;
        snapshot_json: string | null;
        byte_window_started_at: number;
        byte_window_total: number;
        expires_at: number;
      }>(
        `SELECT generation, lifecycle_status, server_seq, snapshot_revision, snapshot_hash,
                snapshot_json, byte_window_started_at, byte_window_total, expires_at
         FROM relay_runtime WHERE singleton = 1`,
      )
      .toArray()[0];
    if (
      !row ||
      !isPositiveInteger(row.generation) ||
      !["INERT", "ACTIVE", "CLOSED"].includes(row.lifecycle_status) ||
      !isNonNegativeInteger(row.server_seq) ||
      !isNonNegativeInteger(row.snapshot_revision) ||
      !isNonNegativeInteger(row.byte_window_started_at) ||
      !isNonNegativeInteger(row.byte_window_total) ||
      !isNonNegativeInteger(row.expires_at) ||
      (row.snapshot_hash !== null && !/^[a-f0-9]{64}$/.test(row.snapshot_hash)) ||
      (row.snapshot_json !== null && typeof row.snapshot_json !== "string") ||
      (row.snapshot_revision === 0) !== (row.snapshot_json === null)
    ) {
      return null;
    }
    return {
      generation: row.generation,
      lifecycle: row.lifecycle_status,
      serverSeq: row.server_seq,
      snapshotRevision: row.snapshot_revision,
      snapshotHash: row.snapshot_hash,
      snapshotJson: row.snapshot_json,
      byteWindowStartedAt: row.byte_window_started_at,
      byteWindowTotal: row.byte_window_total,
      expiresAt: row.expires_at,
    };
  }

  async handleSend(
    socket: WebSocket,
    attachment: RelayConnectionAttachment,
    authority: RelayParticipantAuthority,
    message: RelaySendMessage,
    rawBytes: number,
  ): Promise<void> {
    const relayAuthority = this.readAuthority();
    const runtime = this.readRuntime();
    if (
      !relayAuthority ||
      !runtime ||
      runtime.lifecycle !== "ACTIVE" ||
      runtime.generation !== attachment.generation ||
      authority.generation !== attachment.generation
    ) {
      this.sendRejection(socket, attachment.generation, message.clientSeq, "MATCH_NOT_ACTIVE");
      return;
    }
    const payloadJson = JSON.stringify(message.payload);
    if (textEncoder.encode(payloadJson).byteLength > relayAuthority.policy.maxMessageBytes) {
      socket.close(1008, "Relay payload exceeds profile limit");
      return;
    }
    let recipients: WebSocket[];
    if (message.delivery === "direct") {
      if (!relayAuthority.policy.directMessages) {
        this.sendRejection(
          socket,
          attachment.generation,
          message.clientSeq,
          "DIRECT_MESSAGES_DISABLED",
        );
        return;
      }
      if (!this.isLiveTarget(message.targetParticipantId, runtime.generation)) {
        this.sendRejection(socket, attachment.generation, message.clientSeq, "TARGET_UNAVAILABLE");
        return;
      }
      recipients = this.state
        .getWebSockets(`participant:${message.targetParticipantId}`)
        .filter(
          (candidate) =>
            candidate.readyState === 1 && this.isRelaySocket(candidate, runtime.generation),
        );
      if (recipients.length === 0) {
        this.sendRejection(socket, attachment.generation, message.clientSeq, "TARGET_UNAVAILABLE");
        return;
      }
    } else {
      recipients = this.state
        .getWebSockets()
        .filter(
          (candidate) =>
            candidate.readyState === 1 && this.isRelaySocket(candidate, runtime.generation),
        );
    }
    const sequenced = this.reserveSequenceAndBytes(runtime, rawBytes, Date.now());
    if (!sequenced) {
      socket.close(1008, "Relay room byte rate exceeded");
      return;
    }
    const outbound = JSON.stringify({
      type: "RELAY_MESSAGE",
      v: MULTIPLAYER_BRIDGE_PROTOCOL_VERSION,
      generation: sequenced.generation,
      serverSeq: sequenced.serverSeq,
      sender: {
        participantId: authority.participantId,
        seatIndex: authority.seatIndex,
        role: authority.role,
      },
      delivery: message.delivery,
      ...(message.delivery === "direct"
        ? { targetParticipantId: message.targetParticipantId }
        : {}),
      payload: message.payload,
    });
    for (const recipient of recipients) this.sendBounded(recipient, outbound);
  }

  async handleSnapshot(
    socket: WebSocket,
    attachment: RelayConnectionAttachment,
    authority: RelayParticipantAuthority,
    message: RelaySnapshotSetMessage,
    rawBytes: number,
  ): Promise<void> {
    const relayAuthority = this.readAuthority();
    const runtime = this.readRuntime();
    if (
      !relayAuthority ||
      !runtime ||
      runtime.lifecycle !== "ACTIVE" ||
      runtime.generation !== attachment.generation ||
      authority.generation !== attachment.generation
    ) {
      this.sendRejection(socket, attachment.generation, message.clientSeq, "MATCH_NOT_ACTIVE");
      return;
    }
    if (!relayAuthority.policy.hostSnapshot) {
      this.sendRejection(socket, attachment.generation, message.clientSeq, "SNAPSHOT_DISABLED");
      return;
    }
    if (authority.role !== "HOST") {
      this.sendRejection(socket, attachment.generation, message.clientSeq, "HOST_REQUIRED");
      return;
    }
    const snapshotJson = JSON.stringify(message.payload);
    if (textEncoder.encode(snapshotJson).byteLength > relayAuthority.policy.maxSnapshotBytes) {
      socket.close(1008, "Relay snapshot exceeds profile limit");
      return;
    }
    const snapshotHash = await sha256Hex(
      `${runtime.generation}\u0000${runtime.snapshotRevision + 1}\u0000${snapshotJson}`,
    );
    const sequenced = this.reserveSequenceAndBytes(runtime, rawBytes, Date.now(), {
      revision: runtime.snapshotRevision + 1,
      hash: snapshotHash,
      json: snapshotJson,
    });
    if (!sequenced) {
      socket.close(1008, "Relay room byte rate exceeded");
      return;
    }
    this.broadcastSync(sequenced);
  }

  sendReconnectSync(socket: WebSocket, attachment: RelayConnectionAttachment): void {
    const runtime = this.readRuntime();
    if (
      !runtime ||
      runtime.generation !== attachment.generation ||
      runtime.lifecycle !== "ACTIVE"
    ) {
      return;
    }
    this.sendBounded(socket, this.syncMessage(runtime));
  }

  broadcastSync(runtime: RelayRuntimeRecord = this.requiredRuntime()): void {
    const message = this.syncMessage(runtime);
    for (const socket of this.state.getWebSockets()) {
      if (socket.readyState === 1 && this.isRelaySocket(socket, runtime.generation)) {
        this.sendBounded(socket, message);
      }
    }
  }

  close(code: MultiplayerRelayCloseCode): void {
    const runtime = this.readRuntime();
    if (!runtime || runtime.lifecycle === "CLOSED") return;
    this.state.storage.sql.exec(
      `UPDATE relay_runtime SET lifecycle_status = 'CLOSED', updated_at = ? WHERE singleton = 1`,
      Date.now(),
    );
    const message = JSON.stringify({
      type: "RELAY_CLOSED",
      v: MULTIPLAYER_BRIDGE_PROTOCOL_VERSION,
      generation: runtime.generation,
      code,
    });
    for (const socket of this.state.getWebSockets()) {
      if (!this.isRelaySocket(socket, runtime.generation)) continue;
      if (socket.readyState === 1) socket.send(message);
      socket.close(1000, "Relay room closed");
    }
  }

  nextExpiryAt(): number | null {
    const runtime = this.readRuntime();
    if (!runtime || runtime.lifecycle === "CLOSED") return null;
    if (runtime.lifecycle === "ACTIVE") return runtime.expiresAt > 0 ? runtime.expiresAt : null;
    return this.startupDeadlineAt(runtime.generation);
  }

  startupDeadlineAt(generation: number): number | null {
    const row = this.state.storage.sql
      .exec<{ expires_at: number }>(
        `SELECT expires_at FROM relay_startup_deadline
         WHERE singleton = 1 AND generation = ?`,
        generation,
      )
      .toArray()[0];
    return isNonNegativeInteger(row?.expires_at) ? row.expires_at : null;
  }

  private reserveSequenceAndBytes(
    runtime: RelayRuntimeRecord,
    rawBytes: number,
    nowMs: number,
    snapshot?: { readonly revision: number; readonly hash: string; readonly json: string },
  ): RelayRuntimeRecord | null {
    const authority = this.readAuthority();
    if (!authority || runtime.lifecycle !== "ACTIVE") return null;
    const windowReset = nowMs - runtime.byteWindowStartedAt >= RELAY_RATE_WINDOW_MS;
    const byteWindowStartedAt = windowReset ? nowMs : runtime.byteWindowStartedAt;
    const byteWindowTotal = (windowReset ? 0 : runtime.byteWindowTotal) + rawBytes;
    if (byteWindowTotal > authority.policy.roomBytesPerSecond) return null;
    const serverSeq = runtime.serverSeq + 1;
    this.state.storage.sql.exec(
      `UPDATE relay_runtime
       SET server_seq = ?, snapshot_revision = ?, snapshot_hash = ?, snapshot_json = ?,
           byte_window_started_at = ?, byte_window_total = ?, updated_at = ?
       WHERE singleton = 1 AND generation = ? AND lifecycle_status = 'ACTIVE'`,
      serverSeq,
      snapshot?.revision ?? runtime.snapshotRevision,
      snapshot?.hash ?? runtime.snapshotHash,
      snapshot?.json ?? runtime.snapshotJson,
      byteWindowStartedAt,
      byteWindowTotal,
      nowMs,
      runtime.generation,
    );
    return this.requiredRuntime();
  }

  private sendRejection(
    socket: WebSocket,
    generation: number,
    clientSeq: number,
    code: MultiplayerRelayRejectionCode,
  ): void {
    if (socket.readyState !== 1) return;
    socket.send(
      JSON.stringify({
        type: "RELAY_REJECTED",
        v: MULTIPLAYER_BRIDGE_PROTOCOL_VERSION,
        generation,
        clientSeq,
        code,
      }),
    );
  }

  private syncMessage(runtime: RelayRuntimeRecord): string {
    let snapshot: { revision: number; hash: string; payload: unknown } | null = null;
    if (runtime.snapshotJson !== null && runtime.snapshotHash !== null) {
      snapshot = {
        revision: runtime.snapshotRevision,
        hash: runtime.snapshotHash,
        payload: JSON.parse(runtime.snapshotJson) as unknown,
      };
    }
    return JSON.stringify({
      type: "RELAY_SYNC",
      v: MULTIPLAYER_BRIDGE_PROTOCOL_VERSION,
      generation: runtime.generation,
      serverSeq: runtime.serverSeq,
      snapshot,
    });
  }

  private sendBounded(socket: WebSocket, message: string): void {
    const bufferedAmount = typeof socket.bufferedAmount === "number" ? socket.bufferedAmount : 0;
    if (classifyRelayDeliveryBackpressure(bufferedAmount) === "close") {
      socket.close(1013, "slow Relay consumer");
      return;
    }
    if (socket.readyState === 1) socket.send(message);
  }

  private isLiveTarget(participantId: string, generation: number): boolean {
    const row = this.state.storage.sql
      .exec<{ connection_generation: number; disconnected_at: number | null }>(
        `SELECT connection.connection_generation, connection.disconnected_at
         FROM participant_authority AS authority
         JOIN participant_connections AS connection
           ON connection.participant_id = authority.participant_id
          AND connection.generation = authority.generation
         WHERE authority.participant_id = ? AND authority.generation = ?`,
        participantId,
        generation,
      )
      .toArray()[0];
    return Boolean(
      row && isPositiveInteger(row.connection_generation) && row.disconnected_at === null,
    );
  }

  private isRelaySocket(socket: WebSocket, generation: number): boolean {
    try {
      const attachment = parseRelayConnectionAttachment(socket.deserializeAttachment());
      return attachment?.generation === generation;
    } catch {
      return false;
    }
  }

  private requiredRuntime(): RelayRuntimeRecord {
    const runtime = this.readRuntime();
    if (!runtime) throw new Error("Relay runtime unavailable");
    return runtime;
  }
}

export function consumeRelayConnectionEnvelope(
  socket: WebSocket,
  attachment: RelayConnectionAttachment,
  clientSeq: number,
  messagesPerSecond: number,
  nowMs: number,
): RelayConnectionAttachment | null {
  if (clientSeq !== attachment.lastClientSeq + 1) return null;
  const reset = nowMs - attachment.rateWindowStartedAt >= RELAY_RATE_WINDOW_MS;
  const rateMessageCount = (reset ? 0 : attachment.rateMessageCount) + 1;
  if (rateMessageCount > messagesPerSecond) return null;
  const next: RelayConnectionAttachment = {
    ...attachment,
    lastClientSeq: clientSeq,
    rateWindowStartedAt: reset ? nowMs : attachment.rateWindowStartedAt,
    rateMessageCount,
  };
  socket.serializeAttachment(next);
  return next;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", textEncoder.encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
