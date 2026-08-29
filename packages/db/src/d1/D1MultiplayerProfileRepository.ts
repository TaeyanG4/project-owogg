import {
  isApprovedRelayMultiplayerProfileV1,
  parseApprovedRelayMultiplayerProfileV1,
  type CreateApprovedMultiplayerProfileInput,
  type CreateApprovedMultiplayerProfileResult,
  type MultiplayerProfileRecord,
  type MultiplayerProfileRepository,
  type SetMultiplayerProfileEnabledInput,
  type SetMultiplayerProfileEnabledResult,
} from "@owogg/core";
import type { D1Database, D1Result } from "./D1UserRepository.js";

const PROFILE_SELECT_COLUMNS = `
  profile.id, profile.source_request_id, profile.source_request_hash, profile.profile_version,
  profile.game_id, profile.game_version_id, profile.content_hash, profile.profile_revision,
  profile.transport_kind, profile.runtime_kind, profile.protocol_version, profile.lifecycle,
  profile.reconnect_policy, profile.direct_messages, profile.host_snapshot, profile.min_players,
  profile.max_players, profile.allowed_visibility_json, profile.allowed_join_policies_json,
  profile.host_departure_policy, profile.result_trust, profile.max_message_bytes,
  profile.max_snapshot_bytes, profile.messages_per_second, profile.room_bytes_per_second,
  profile.room_ttl_seconds, profile.enabled, profile.created_by_admin_id, profile.approved_at,
  profile.disabled_at, profile.disabled_reason_code, profile.disabled_by_admin_id,
  profile.updated_at
`;

function positive(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Invalid ${field} in multiplayer_profiles row: ${String(value)}`);
  }
  return value;
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid ${field} in multiplayer_profiles row: ${String(value)}`);
  }
  return value;
}

function nullableString(value: unknown, field: string): string | null {
  return value === null ? null : string(value, field);
}

function boolean(value: unknown, field: string): boolean {
  if (value !== 0 && value !== 1) {
    throw new Error(`Invalid ${field} in multiplayer_profiles row: ${String(value)}`);
  }
  return value === 1;
}

function json(value: unknown, field: string): unknown {
  try {
    return JSON.parse(string(value, field)) as unknown;
  } catch {
    throw new Error(`Invalid ${field} JSON in multiplayer_profiles row`);
  }
}

function changed(result: D1Result | undefined): number | null {
  const value = result?.meta?.changes ?? result?.meta?.rows_written;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function assertId(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${field} must be positive`);
}

function assertNow(value: string): void {
  if (!value || Number.isNaN(Date.parse(value))) throw new RangeError("nowIso must be valid");
}

function sameProfile(
  record: MultiplayerProfileRecord,
  input: CreateApprovedMultiplayerProfileInput,
): boolean {
  return (
    record.sourceRequestId === input.sourceRequestId &&
    record.createdByAdminId === input.createdByAdminId &&
    JSON.stringify(record.profile) === JSON.stringify(input.profile)
  );
}

export function mapMultiplayerProfileRow(row: Record<string, unknown>): MultiplayerProfileRecord {
  const profile = parseApprovedRelayMultiplayerProfileV1({
    profileVersion: row.profile_version,
    gameId: row.game_id,
    gameVersionId: row.game_version_id,
    contentHash: row.content_hash,
    sourceRequestHash: row.source_request_hash,
    profileRevision: row.profile_revision,
    transportKind: row.transport_kind,
    runtimeKind: row.runtime_kind,
    protocolVersion: row.protocol_version,
    lifecycle: row.lifecycle,
    reconnectPolicy: row.reconnect_policy,
    directMessages: boolean(row.direct_messages, "direct_messages"),
    hostSnapshot: boolean(row.host_snapshot, "host_snapshot"),
    minPlayers: row.min_players,
    maxPlayers: row.max_players,
    allowedVisibility: json(row.allowed_visibility_json, "allowed_visibility_json"),
    allowedJoinPolicies: json(row.allowed_join_policies_json, "allowed_join_policies_json"),
    hostDeparturePolicy: row.host_departure_policy,
    resultTrust: row.result_trust,
    maxMessageBytes: row.max_message_bytes,
    maxSnapshotBytes: row.max_snapshot_bytes,
    messagesPerSecond: row.messages_per_second,
    roomBytesPerSecond: row.room_bytes_per_second,
    roomTtlSeconds: row.room_ttl_seconds,
    enabled: boolean(row.enabled, "enabled"),
  });
  return {
    id: positive(row.id, "id"),
    sourceRequestId: positive(row.source_request_id, "source_request_id"),
    profile,
    createdByAdminId:
      row.created_by_admin_id === null
        ? null
        : positive(row.created_by_admin_id, "created_by_admin_id"),
    approvedAt: string(row.approved_at, "approved_at"),
    disabledAt: nullableString(row.disabled_at, "disabled_at"),
    disabledReasonCode: nullableString(row.disabled_reason_code, "disabled_reason_code"),
    disabledByAdminId:
      row.disabled_by_admin_id === null
        ? null
        : positive(row.disabled_by_admin_id, "disabled_by_admin_id"),
    updatedAt: string(row.updated_at, "updated_at"),
  };
}

export class D1MultiplayerProfileRepository implements MultiplayerProfileRepository {
  constructor(private readonly db: D1Database) {}

  async createApprovedRevision(
    input: CreateApprovedMultiplayerProfileInput,
  ): Promise<CreateApprovedMultiplayerProfileResult> {
    assertId(input.createdByAdminId, "createdByAdminId");
    if (input.sourceRequestId === null)
      return { status: "REJECTED", code: "SOURCE_REQUEST_INVALID" };
    assertId(input.sourceRequestId, "sourceRequestId");
    assertNow(input.nowIso);
    if (!isApprovedRelayMultiplayerProfileV1(input.profile)) {
      return { status: "REJECTED", code: "SOURCE_REQUEST_INVALID" };
    }
    const profile = parseApprovedRelayMultiplayerProfileV1(input.profile);
    if (profile.enabled) return { status: "REJECTED", code: "PROFILE_MUST_START_DISABLED" };

    const existing = await this.findExactRevision(
      profile.gameId,
      profile.gameVersionId,
      profile.profileRevision,
    );
    if (existing) {
      return sameProfile(existing, { ...input, profile })
        ? { status: "REPLAYED", record: existing }
        : { status: "REJECTED", code: "REVISION_CONFLICT" };
    }

    const version = await this.db
      .prepare(
        `SELECT game.publisher_type, version.moderation_status, version.content_hash
         FROM game_versions version
         JOIN games game ON game.id = version.game_id
         WHERE version.id = ? AND version.game_id = ? AND version.publish_status = 'READY'
           AND game.deleted_at IS NULL LIMIT 1`,
      )
      .bind(profile.gameVersionId, profile.gameId)
      .first<Record<string, unknown>>();
    if (!version) return { status: "REJECTED", code: "GAME_VERSION_NOT_FOUND" };
    if (version.content_hash !== profile.contentHash) {
      return { status: "REJECTED", code: "MANAGED_PROFILE_MISMATCH" };
    }
    if (
      (version.publisher_type !== "OWOGG" && version.publisher_type !== "USER") ||
      (version.publisher_type === "USER" && version.moderation_status !== "APPROVED")
    ) {
      return { status: "REJECTED", code: "SOURCE_REQUEST_INVALID" };
    }

    const request = await this.db
      .prepare(
        `SELECT id FROM multiplayer_profile_requests
         WHERE id = ? AND game_id = ? AND game_version_id = ? AND content_hash = ?
           AND request_hash = ? AND status = 'APPROVED' LIMIT 1`,
      )
      .bind(
        input.sourceRequestId,
        profile.gameId,
        profile.gameVersionId,
        profile.contentHash,
        profile.sourceRequestHash,
      )
      .first<Record<string, unknown>>();
    if (!request) return { status: "REJECTED", code: "MANAGED_PROFILE_MISMATCH" };

    const revision = await this.db
      .prepare(
        `SELECT COALESCE(MAX(profile_revision), 0) + 1 AS next_revision
         FROM multiplayer_profiles WHERE game_id = ? AND game_version_id = ?`,
      )
      .bind(profile.gameId, profile.gameVersionId)
      .first<{ next_revision: number }>();
    if (Number(revision?.next_revision ?? 1) !== profile.profileRevision) {
      return { status: "REJECTED", code: "REVISION_CONFLICT" };
    }

    try {
      await this.db
        .prepare(
          `INSERT INTO multiplayer_profiles (
             source_request_id, source_request_hash, profile_version, game_id, game_version_id,
             profile_revision, protocol_version, resolved_class, simulation_model, runtime_backend,
             ruleset_key, ruleset_revision, resolved_config_json, lifecycle, persistence,
             latency_profile, reconnect_policy, min_players, max_players, allowed_visibility_json,
             allowed_join_policies_json, max_action_bytes, max_state_bytes, action_rate_limit,
             reward_policy_id, enabled, created_by_admin_id, approved_at, disabled_at,
             disabled_reason_code, disabled_by_admin_id, updated_at, profile_kind, content_hash,
             transport_kind, runtime_kind, direct_messages, host_snapshot, host_departure_policy,
             result_trust, max_message_bytes, max_snapshot_bytes, messages_per_second,
             room_bytes_per_second, room_ttl_seconds
           ) VALUES (
             ?, ?, 1, ?, ?, ?, 1, 'M1', 'event', 'durable-object', 'relay:transport-only', 1, '{}',
             'match', 'match', 'relaxed', ?, ?, ?, ?, ?, ?, 1, ?, NULL, 0, ?, ?, NULL, NULL,
             NULL, ?, 'RELAY', ?, 'websocket', 'relay', ?, ?, 'close', 'UNVERIFIED', ?, ?, ?, ?, ?
           )`,
        )
        .bind(
          input.sourceRequestId,
          profile.sourceRequestHash,
          profile.gameId,
          profile.gameVersionId,
          profile.profileRevision,
          profile.reconnectPolicy,
          profile.minPlayers,
          profile.maxPlayers,
          JSON.stringify(profile.allowedVisibility),
          JSON.stringify(profile.allowedJoinPolicies),
          profile.maxMessageBytes,
          profile.messagesPerSecond,
          input.createdByAdminId,
          input.nowIso,
          input.nowIso,
          profile.contentHash,
          profile.directMessages ? 1 : 0,
          profile.hostSnapshot ? 1 : 0,
          profile.maxMessageBytes,
          profile.maxSnapshotBytes,
          profile.messagesPerSecond,
          profile.roomBytesPerSecond,
          profile.roomTtlSeconds,
        )
        .run();
    } catch (error) {
      const concurrent = await this.findExactRevision(
        profile.gameId,
        profile.gameVersionId,
        profile.profileRevision,
      );
      if (concurrent) {
        return sameProfile(concurrent, { ...input, profile })
          ? { status: "REPLAYED", record: concurrent }
          : { status: "REJECTED", code: "REVISION_CONFLICT" };
      }
      throw error;
    }
    const created = await this.findExactRevision(
      profile.gameId,
      profile.gameVersionId,
      profile.profileRevision,
    );
    if (!created) throw new Error("multiplayer_profiles insert did not produce a readable row");
    return { status: "CREATED", record: created };
  }

  async setEnabled(
    input: SetMultiplayerProfileEnabledInput,
  ): Promise<SetMultiplayerProfileEnabledResult> {
    assertId(input.profileId, "profileId");
    assertId(input.changedByAdminId, "changedByAdminId");
    assertNow(input.nowIso);
    if (input.enabled && input.reasonCode !== null) {
      throw new RangeError("enabled profile reasonCode must be null");
    }
    if (!input.enabled && !/^[A-Z][A-Z0-9_]{0,63}$/.test(input.reasonCode ?? "")) {
      throw new RangeError("disabled profile reasonCode must be a stable uppercase code");
    }
    const current = await this.findById(input.profileId);
    if (!current) return { status: "NOT_FOUND" };
    if (current.profile.enabled === input.enabled) return { status: "REPLAYED", record: current };

    let write: D1Result;
    if (input.enabled) {
      try {
        write = await this.db
          .prepare(
            `UPDATE multiplayer_profiles AS profile
             SET enabled = 1, disabled_at = NULL, disabled_reason_code = NULL,
                 disabled_by_admin_id = NULL, updated_at = ?
             WHERE profile.id = ? AND profile.enabled = 0 AND profile.profile_kind = 'RELAY'
               AND NOT EXISTS (
                 SELECT 1 FROM multiplayer_profiles other
                 WHERE other.game_version_id = profile.game_version_id AND other.enabled = 1
               )`,
          )
          .bind(input.nowIso, input.profileId)
          .run();
      } catch {
        const conflict = await this.findById(input.profileId);
        return conflict ? { status: "CONFLICT", record: conflict } : { status: "NOT_FOUND" };
      }
    } else {
      write = await this.db
        .prepare(
          `UPDATE multiplayer_profiles SET enabled = 0, disabled_at = ?, disabled_reason_code = ?,
             disabled_by_admin_id = ?, updated_at = ?
           WHERE id = ? AND enabled = 1 AND profile_kind = 'RELAY'`,
        )
        .bind(input.nowIso, input.reasonCode, input.changedByAdminId, input.nowIso, input.profileId)
        .run();
    }
    const updated = await this.findById(input.profileId);
    if (!updated) return { status: "NOT_FOUND" };
    return changed(write) === 1 && updated.profile.enabled === input.enabled
      ? { status: "UPDATED", record: updated }
      : { status: "CONFLICT", record: updated };
  }

  async findById(profileId: number): Promise<MultiplayerProfileRecord | null> {
    assertId(profileId, "profileId");
    const row = await this.db
      .prepare(
        `SELECT ${PROFILE_SELECT_COLUMNS} FROM multiplayer_profiles profile
         WHERE profile.id = ? AND profile.profile_kind = 'RELAY'`,
      )
      .bind(profileId)
      .first<Record<string, unknown>>();
    return row ? mapMultiplayerProfileRow(row) : null;
  }

  async listManaged(limit: number): Promise<readonly MultiplayerProfileRecord[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new RangeError("limit must be an integer between 1 and 100");
    }
    const rows = await this.db
      .prepare(
        `SELECT ${PROFILE_SELECT_COLUMNS} FROM multiplayer_profiles profile
         WHERE profile.profile_kind = 'RELAY' AND profile.source_request_id IS NOT NULL
         ORDER BY profile.updated_at DESC, profile.id DESC LIMIT ?`,
      )
      .bind(limit)
      .all<Record<string, unknown>>();
    return (rows.results ?? []).map(mapMultiplayerProfileRow);
  }

  async findLatestForExactVersion(
    gameId: number,
    gameVersionId: number,
  ): Promise<MultiplayerProfileRecord | null> {
    assertId(gameId, "gameId");
    assertId(gameVersionId, "gameVersionId");
    const row = await this.db
      .prepare(
        `SELECT ${PROFILE_SELECT_COLUMNS} FROM multiplayer_profiles profile
         WHERE profile.game_id = ? AND profile.game_version_id = ? AND profile.profile_kind = 'RELAY'
         ORDER BY profile.profile_revision DESC LIMIT 1`,
      )
      .bind(gameId, gameVersionId)
      .first<Record<string, unknown>>();
    return row ? mapMultiplayerProfileRow(row) : null;
  }

  async findEnabledForExactVersion(
    gameId: number,
    gameVersionId: number,
  ): Promise<MultiplayerProfileRecord | null> {
    assertId(gameId, "gameId");
    assertId(gameVersionId, "gameVersionId");
    const row = await this.db
      .prepare(
        `SELECT ${PROFILE_SELECT_COLUMNS}
         FROM multiplayer_profiles profile
         JOIN games game ON game.id = profile.game_id
         JOIN game_versions version ON version.id = profile.game_version_id AND version.game_id = game.id
         WHERE profile.game_id = ? AND profile.game_version_id = ? AND profile.enabled = 1
           AND profile.profile_kind = 'RELAY' AND profile.content_hash = version.content_hash
           AND game.deleted_at IS NULL AND game.live_version_id = version.id
           AND version.publish_status = 'READY'
           AND (game.publisher_type = 'OWOGG'
             OR (game.publisher_type = 'USER' AND version.moderation_status = 'APPROVED'))
         LIMIT 1`,
      )
      .bind(gameId, gameVersionId)
      .first<Record<string, unknown>>();
    return row ? mapMultiplayerProfileRow(row) : null;
  }

  private async findExactRevision(
    gameId: number,
    gameVersionId: number,
    profileRevision: number,
  ): Promise<MultiplayerProfileRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT ${PROFILE_SELECT_COLUMNS} FROM multiplayer_profiles profile
         WHERE profile.game_id = ? AND profile.game_version_id = ? AND profile.profile_revision = ?
           AND profile.profile_kind = 'RELAY' LIMIT 1`,
      )
      .bind(gameId, gameVersionId, profileRevision)
      .first<Record<string, unknown>>();
    return row ? mapMultiplayerProfileRow(row) : null;
  }
}
