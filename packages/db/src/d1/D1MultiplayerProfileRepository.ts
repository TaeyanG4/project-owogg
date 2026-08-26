import {
  MultiplayerProfileRequestValidationError,
  assertManagedMultiplayerProfileMatchesRequestV1,
  parseApprovedMultiplayerProfileV1,
  type CreateApprovedMultiplayerProfileInput,
  type CreateApprovedMultiplayerProfileResult,
  type MultiplayerProfileRecord,
  type MultiplayerProfileRepository,
  type SetMultiplayerProfileEnabledInput,
  type SetMultiplayerProfileEnabledResult,
} from "@owogg/core";
import type { D1Database, D1Result } from "./D1UserRepository.js";
import { D1MultiplayerProfileRequestRepository } from "./D1MultiplayerProfileRequestRepository.js";

const PROFILE_SELECT_COLUMNS = `
  profile.id, profile.source_request_id, profile.source_request_hash, profile.profile_version,
  profile.game_id, profile.game_version_id, profile.profile_revision, profile.protocol_version,
  profile.resolved_class, profile.simulation_model, profile.runtime_backend, profile.ruleset_key,
  profile.ruleset_revision, profile.resolved_config_json, profile.lifecycle, profile.persistence,
  profile.latency_profile, profile.reconnect_policy, profile.min_players, profile.max_players,
  profile.allowed_visibility_json, profile.allowed_join_policies_json, profile.max_action_bytes,
  profile.max_state_bytes, profile.action_rate_limit, profile.reward_policy_id, profile.enabled,
  profile.created_by_admin_id, profile.approved_at, profile.disabled_at,
  profile.disabled_reason_code, profile.disabled_by_admin_id, profile.updated_at
`;

function requiredPositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid ${field} in multiplayer_profiles row: ${String(value)}`);
  }
  return value;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid ${field} in multiplayer_profiles row: ${String(value)}`);
  }
  return value;
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  return requiredString(value, field);
}

function booleanInteger(value: unknown, field: string): boolean {
  if (value !== 0 && value !== 1) {
    throw new Error(`Invalid ${field} in multiplayer_profiles row: ${String(value)}`);
  }
  return value === 1;
}

function parseJson(value: unknown, field: string): unknown {
  const source = requiredString(value, field);
  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw new Error(`Invalid ${field} JSON in multiplayer_profiles row`);
  }
}

function writtenRows(result: D1Result | undefined): number | null {
  // D1 rows_written is a billing-oriented count that includes index maintenance. CAS and
  // idempotency decisions need the statement's affected table-row count instead.
  const value = result?.meta?.changes ?? result?.meta?.rows_written;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function assertPositiveId(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${field} must be positive`);
}

function assertNowIso(value: string): void {
  if (value.length === 0 || Number.isNaN(Date.parse(value))) {
    throw new RangeError("nowIso must be a non-empty ISO timestamp");
  }
}

function sameProfileRecord(
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
  const profile = parseApprovedMultiplayerProfileV1({
    profileVersion: row.profile_version,
    gameId: row.game_id,
    gameVersionId: row.game_version_id,
    sourceRequestHash: nullableString(row.source_request_hash, "source_request_hash"),
    profileRevision: row.profile_revision,
    protocolVersion: row.protocol_version,
    resolvedClass: row.resolved_class,
    simulationModel: row.simulation_model,
    runtimeBackend: row.runtime_backend,
    rulesetKey: row.ruleset_key,
    rulesetRevision: row.ruleset_revision,
    resolvedConfigJson: row.resolved_config_json,
    lifecycle: row.lifecycle,
    persistence: row.persistence,
    latencyProfile: row.latency_profile,
    reconnectPolicy: row.reconnect_policy,
    minPlayers: row.min_players,
    maxPlayers: row.max_players,
    allowedVisibility: parseJson(row.allowed_visibility_json, "allowed_visibility_json"),
    allowedJoinPolicies: parseJson(row.allowed_join_policies_json, "allowed_join_policies_json"),
    maxActionBytes: row.max_action_bytes,
    maxStateBytes: row.max_state_bytes,
    actionRateLimit: row.action_rate_limit,
    rewardPolicyId: nullableString(row.reward_policy_id, "reward_policy_id"),
    enabled: booleanInteger(row.enabled, "enabled"),
  });

  return {
    id: requiredPositiveInteger(row.id, "id"),
    sourceRequestId:
      row.source_request_id === null
        ? null
        : requiredPositiveInteger(row.source_request_id, "source_request_id"),
    profile,
    createdByAdminId:
      row.created_by_admin_id === null
        ? null
        : requiredPositiveInteger(row.created_by_admin_id, "created_by_admin_id"),
    approvedAt: requiredString(row.approved_at, "approved_at"),
    disabledAt: nullableString(row.disabled_at, "disabled_at"),
    disabledReasonCode: nullableString(row.disabled_reason_code, "disabled_reason_code"),
    disabledByAdminId:
      row.disabled_by_admin_id === null
        ? null
        : requiredPositiveInteger(row.disabled_by_admin_id, "disabled_by_admin_id"),
    updatedAt: requiredString(row.updated_at, "updated_at"),
  };
}

export class D1MultiplayerProfileRepository implements MultiplayerProfileRepository {
  constructor(private readonly db: D1Database) {}

  async createApprovedRevision(
    input: CreateApprovedMultiplayerProfileInput,
  ): Promise<CreateApprovedMultiplayerProfileResult> {
    assertPositiveId(input.createdByAdminId, "createdByAdminId");
    if (input.sourceRequestId !== null) assertPositiveId(input.sourceRequestId, "sourceRequestId");
    assertNowIso(input.nowIso);
    const profile = parseApprovedMultiplayerProfileV1(input.profile);
    if (profile.enabled) {
      return { status: "REJECTED", code: "PROFILE_MUST_START_DISABLED" };
    }

    const existing = await this.findByExactRevision(
      profile.gameId,
      profile.gameVersionId,
      profile.profileRevision,
    );
    if (existing) {
      return sameProfileRecord(existing, { ...input, profile })
        ? { status: "REPLAYED", record: existing }
        : { status: "REJECTED", code: "REVISION_CONFLICT" };
    }

    const version = await this.db
      .prepare(
        `SELECT game.publisher_type, version.moderation_status
         FROM game_versions version
         JOIN games game ON game.id = version.game_id
         WHERE version.id = ? AND version.game_id = ?
           AND version.publish_status = 'READY' AND game.deleted_at IS NULL
         LIMIT 1`,
      )
      .bind(profile.gameVersionId, profile.gameId)
      .first<Record<string, unknown>>();
    if (!version) return { status: "REJECTED", code: "GAME_VERSION_NOT_FOUND" };

    if (version.publisher_type === "USER") {
      if (version.moderation_status !== "APPROVED" || input.sourceRequestId === null) {
        return { status: "REJECTED", code: "SOURCE_REQUEST_INVALID" };
      }
      const request = await new D1MultiplayerProfileRequestRepository(this.db).findById(
        input.sourceRequestId,
      );
      if (
        !request ||
        request.status !== "APPROVED" ||
        request.gameId !== profile.gameId ||
        request.gameVersionId !== profile.gameVersionId ||
        request.requestHash !== profile.sourceRequestHash
      ) {
        return { status: "REJECTED", code: "SOURCE_REQUEST_INVALID" };
      }
      try {
        assertManagedMultiplayerProfileMatchesRequestV1(request.request, profile);
      } catch (error) {
        if (error instanceof MultiplayerProfileRequestValidationError) {
          return { status: "REJECTED", code: "MANAGED_PROFILE_MISMATCH" };
        }
        throw error;
      }
    } else if (
      version.publisher_type !== "OWOGG" ||
      input.sourceRequestId !== null ||
      profile.sourceRequestHash !== null ||
      !profile.rulesetKey.startsWith("official:")
    ) {
      return { status: "REJECTED", code: "SOURCE_REQUEST_INVALID" };
    }

    const revisionRow = await this.db
      .prepare(
        `SELECT COALESCE(MAX(profile_revision), 0) + 1 AS next_revision
         FROM multiplayer_profiles WHERE game_id = ? AND game_version_id = ?`,
      )
      .bind(profile.gameId, profile.gameVersionId)
      .first<{ next_revision: number }>();
    if (Number(revisionRow?.next_revision ?? 1) !== profile.profileRevision) {
      return { status: "REJECTED", code: "REVISION_CONFLICT" };
    }

    try {
      await this.db
        .prepare(
          `INSERT INTO multiplayer_profiles (
             source_request_id, source_request_hash, profile_version, game_id, game_version_id,
             profile_revision, protocol_version, resolved_class, simulation_model,
             runtime_backend, ruleset_key, ruleset_revision, resolved_config_json, lifecycle,
             persistence, latency_profile, reconnect_policy, min_players, max_players,
             allowed_visibility_json, allowed_join_policies_json, max_action_bytes,
             max_state_bytes, action_rate_limit, reward_policy_id, enabled,
             created_by_admin_id, approved_at, disabled_at, disabled_reason_code,
             disabled_by_admin_id, updated_at
           ) VALUES (
             ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0,
             ?, ?, NULL, NULL, NULL, ?
           )`,
        )
        .bind(
          input.sourceRequestId,
          profile.sourceRequestHash,
          profile.profileVersion,
          profile.gameId,
          profile.gameVersionId,
          profile.profileRevision,
          profile.protocolVersion,
          profile.resolvedClass,
          profile.simulationModel,
          profile.runtimeBackend,
          profile.rulesetKey,
          profile.rulesetRevision,
          profile.resolvedConfigJson,
          profile.lifecycle,
          profile.persistence,
          profile.latencyProfile,
          profile.reconnectPolicy,
          profile.minPlayers,
          profile.maxPlayers,
          JSON.stringify(profile.allowedVisibility),
          JSON.stringify(profile.allowedJoinPolicies),
          profile.maxActionBytes,
          profile.maxStateBytes,
          profile.actionRateLimit,
          profile.rewardPolicyId,
          input.createdByAdminId,
          input.nowIso,
          input.nowIso,
        )
        .run();
    } catch (error) {
      const concurrent = await this.findByExactRevision(
        profile.gameId,
        profile.gameVersionId,
        profile.profileRevision,
      );
      if (concurrent) {
        return sameProfileRecord(concurrent, { ...input, profile })
          ? { status: "REPLAYED", record: concurrent }
          : { status: "REJECTED", code: "REVISION_CONFLICT" };
      }
      throw error;
    }
    const created = await this.findByExactRevision(
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
    assertPositiveId(input.profileId, "profileId");
    assertPositiveId(input.changedByAdminId, "changedByAdminId");
    assertNowIso(input.nowIso);
    if (input.enabled && input.reasonCode !== null) {
      throw new RangeError("enabled profile reasonCode must be null");
    }
    if (
      !input.enabled &&
      (input.reasonCode === null || !/^[A-Z][A-Z0-9_]{0,63}$/.test(input.reasonCode))
    ) {
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
             WHERE profile.id = ? AND profile.enabled = 0
               AND NOT EXISTS (
                 SELECT 1 FROM multiplayer_profiles other
                 WHERE other.game_version_id = profile.game_version_id
                   AND other.enabled = 1
               )`,
          )
          .bind(input.nowIso, input.profileId)
          .run();
      } catch {
        const conflicted = await this.findById(input.profileId);
        return conflicted ? { status: "CONFLICT", record: conflicted } : { status: "NOT_FOUND" };
      }
    } else {
      write = await this.db
        .prepare(
          `UPDATE multiplayer_profiles
           SET enabled = 0, disabled_at = ?, disabled_reason_code = ?,
               disabled_by_admin_id = ?, updated_at = ?
           WHERE id = ? AND enabled = 1`,
        )
        .bind(input.nowIso, input.reasonCode, input.changedByAdminId, input.nowIso, input.profileId)
        .run();
    }
    const updated = await this.findById(input.profileId);
    if (!updated) return { status: "NOT_FOUND" };
    return writtenRows(write) === 1 && updated.profile.enabled === input.enabled
      ? { status: "UPDATED", record: updated }
      : { status: "CONFLICT", record: updated };
  }

  async findById(profileId: number): Promise<MultiplayerProfileRecord | null> {
    const row = await this.db
      .prepare(`SELECT ${PROFILE_SELECT_COLUMNS} FROM multiplayer_profiles profile WHERE id = ?`)
      .bind(profileId)
      .first<Record<string, unknown>>();
    return row ? mapMultiplayerProfileRow(row) : null;
  }

  async findLatestForExactVersion(
    gameId: number,
    gameVersionId: number,
  ): Promise<MultiplayerProfileRecord | null> {
    assertPositiveId(gameId, "gameId");
    assertPositiveId(gameVersionId, "gameVersionId");
    const row = await this.db
      .prepare(
        `SELECT ${PROFILE_SELECT_COLUMNS}
         FROM multiplayer_profiles profile
         WHERE profile.game_id = ? AND profile.game_version_id = ?
         ORDER BY profile.profile_revision DESC
         LIMIT 1`,
      )
      .bind(gameId, gameVersionId)
      .first<Record<string, unknown>>();
    return row ? mapMultiplayerProfileRow(row) : null;
  }

  async findEnabledForExactVersion(
    gameId: number,
    gameVersionId: number,
  ): Promise<MultiplayerProfileRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT ${PROFILE_SELECT_COLUMNS}
         FROM multiplayer_profiles profile
         JOIN games game ON game.id = profile.game_id
         JOIN game_versions version
           ON version.id = profile.game_version_id AND version.game_id = game.id
         WHERE profile.game_id = ? AND profile.game_version_id = ? AND profile.enabled = 1
           AND game.deleted_at IS NULL AND game.live_version_id = version.id
           AND version.publish_status = 'READY'
           AND (
             game.publisher_type = 'OWOGG'
             OR (game.publisher_type = 'USER' AND version.moderation_status = 'APPROVED')
           )
         LIMIT 1`,
      )
      .bind(gameId, gameVersionId)
      .first<Record<string, unknown>>();
    return row ? mapMultiplayerProfileRow(row) : null;
  }

  private async findByExactRevision(
    gameId: number,
    gameVersionId: number,
    profileRevision: number,
  ): Promise<MultiplayerProfileRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT ${PROFILE_SELECT_COLUMNS}
         FROM multiplayer_profiles profile
         WHERE game_id = ? AND game_version_id = ? AND profile_revision = ?
         LIMIT 1`,
      )
      .bind(gameId, gameVersionId, profileRevision)
      .first<Record<string, unknown>>();
    return row ? mapMultiplayerProfileRow(row) : null;
  }
}
