import {
  GAME_VERSION_LEASE_STATUSES,
  MULTIPLAYER_ABORT_CODES,
  MULTIPLAYER_INSTANCE_STATUSES,
  MULTIPLAYER_JOIN_POLICIES,
  MULTIPLAYER_PARTICIPANT_ROLES,
  MULTIPLAYER_PARTICIPANT_STATUSES,
  MULTIPLAYER_REMATCH_WINDOW_MS,
  MULTIPLAYER_VISIBILITIES,
  type AdvanceMultiplayerConnectionInput,
  type AdminKillMultiplayerInstanceInput,
  type AdminKillMultiplayerInstanceResult,
  type CreateMultiplayerInviteInput,
  type CreateMultiplayerInviteResult,
  type CreateMultiplayerInstanceInput,
  type CreateMultiplayerInstanceResult,
  type GameVersionLeaseRecord,
  type JoinMultiplayerInstanceInput,
  type JoinMultiplayerInstanceResult,
  type MultiplayerInviteRecord,
  type MultiplayerInstanceRecord,
  type MultiplayerInstanceAdminActionRecord,
  type MultiplayerInstanceRepository,
  type MultiplayerParticipantRecord,
  type RequestMultiplayerRematchInput,
  type RequestMultiplayerRematchResult,
  type TransitionMultiplayerParticipantInput,
  type TransitionMultiplayerInstanceInput,
} from "@owogg/core";
import type { D1Database, D1Result } from "./D1UserRepository.js";

const INSTANCE_SELECT_COLUMNS =
  "id, public_code, created_by_user_id, create_idempotency_hash, game_id, game_version_id, profile_id, profile_revision, visibility, join_policy, lifecycle, status, generation, participant_count, max_players, expires_at, closed_at, abort_code, created_at, updated_at";
const PARTICIPANT_SELECT_COLUMNS =
  "id, instance_id, user_id, role, seat_index, status, connection_generation, joined_at, ready_at, left_at, updated_at";
const INVITE_SELECT_COLUMNS =
  "id, instance_id, generation, token_hash, created_by_user_id, max_uses, used_count, expires_at, revoked_at, created_at, updated_at";
const LEASE_SELECT_COLUMNS =
  "id, game_version_id, instance_id, generation, status, acquired_at, expires_at, ended_at, end_reason_code, updated_at";
const ADMIN_ACTION_SELECT_COLUMNS =
  "operation_id, instance_id, expected_generation, previous_status, admin_account_id, action, reason_code, created_at";

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid ` + field + ` in multiplayer row: ` + String(value));
  }
  return value;
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  return requiredString(value, field);
}

function requiredPositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid ` + field + ` in multiplayer row: ` + String(value));
  }
  return value;
}

function requiredNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid ` + field + ` in multiplayer row: ` + String(value));
  }
  return value;
}

function enumValue<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new Error(`Invalid ` + field + ` in multiplayer row: ` + String(value));
  }
  return value as T;
}

function sha256Hex(value: unknown, field: string): string {
  const text = requiredString(value, field);
  if (!/^[0-9a-f]{64}$/.test(text)) {
    throw new Error(`Invalid ` + field + ` in multiplayer row: ` + text);
  }
  return text;
}

function nullableAbortCode(value: unknown) {
  if (value === null) return null;
  return enumValue(value, "abort_code", MULTIPLAYER_ABORT_CODES);
}

function writtenRows(result: D1Result | undefined): number | null {
  // D1 rows_written includes index maintenance; changes is the CAS-relevant table-row count.
  const value = result?.meta?.changes ?? result?.meta?.rows_written;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function mapMultiplayerInstanceRow(row: Record<string, unknown>): MultiplayerInstanceRecord {
  const lifecycle = row.lifecycle;
  if (lifecycle !== "match" && lifecycle !== "continuous") {
    throw new Error(`Invalid lifecycle in multiplayer_instances row: ` + String(lifecycle));
  }
  return {
    id: requiredString(row.id, "id"),
    publicCode: requiredString(row.public_code, "public_code"),
    createdByUserId: requiredPositiveInteger(row.created_by_user_id, "created_by_user_id"),
    createIdempotencyHash: requiredString(row.create_idempotency_hash, "create_idempotency_hash"),
    gameId: requiredPositiveInteger(row.game_id, "game_id"),
    gameVersionId: requiredPositiveInteger(row.game_version_id, "game_version_id"),
    profileId: requiredPositiveInteger(row.profile_id, "profile_id"),
    profileRevision: requiredPositiveInteger(row.profile_revision, "profile_revision"),
    visibility: enumValue(row.visibility, "visibility", MULTIPLAYER_VISIBILITIES),
    joinPolicy: enumValue(row.join_policy, "join_policy", MULTIPLAYER_JOIN_POLICIES),
    lifecycle,
    status: enumValue(row.status, "status", MULTIPLAYER_INSTANCE_STATUSES),
    generation: requiredPositiveInteger(row.generation, "generation"),
    participantCount: requiredNonNegativeInteger(row.participant_count, "participant_count"),
    maxPlayers: requiredPositiveInteger(row.max_players, "max_players"),
    expiresAt: requiredString(row.expires_at, "expires_at"),
    closedAt: nullableString(row.closed_at, "closed_at"),
    abortCode: nullableAbortCode(row.abort_code),
    createdAt: requiredString(row.created_at, "created_at"),
    updatedAt: requiredString(row.updated_at, "updated_at"),
  };
}

export function mapMultiplayerParticipantRow(
  row: Record<string, unknown>,
): MultiplayerParticipantRecord {
  return {
    id: requiredString(row.id, "id"),
    instanceId: requiredString(row.instance_id, "instance_id"),
    userId: requiredPositiveInteger(row.user_id, "user_id"),
    role: enumValue(row.role, "role", MULTIPLAYER_PARTICIPANT_ROLES),
    seatIndex: requiredNonNegativeInteger(row.seat_index, "seat_index"),
    status: enumValue(row.status, "status", MULTIPLAYER_PARTICIPANT_STATUSES),
    connectionGeneration: requiredNonNegativeInteger(
      row.connection_generation,
      "connection_generation",
    ),
    joinedAt: requiredString(row.joined_at, "joined_at"),
    readyAt: nullableString(row.ready_at, "ready_at"),
    leftAt: nullableString(row.left_at, "left_at"),
    updatedAt: requiredString(row.updated_at, "updated_at"),
  };
}

export function mapMultiplayerInstanceAdminActionRow(
  row: Record<string, unknown>,
): MultiplayerInstanceAdminActionRecord {
  const previousStatus = enumValue(
    row.previous_status,
    "previous_status",
    MULTIPLAYER_INSTANCE_STATUSES,
  );
  if (["CLOSED", "ABORTED", "EXPIRED"].includes(previousStatus)) {
    throw new Error(`Invalid previous_status in multiplayer admin action row: ${previousStatus}`);
  }
  if (row.action !== "ADMIN_KILL") {
    throw new Error(`Invalid action in multiplayer admin action row: ${String(row.action)}`);
  }
  const reasonCode = requiredString(row.reason_code, "reason_code");
  if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(reasonCode)) {
    throw new Error(`Invalid reason_code in multiplayer admin action row: ${reasonCode}`);
  }
  return {
    operationId: requiredString(row.operation_id, "operation_id"),
    instanceId: requiredString(row.instance_id, "instance_id"),
    expectedGeneration: requiredPositiveInteger(row.expected_generation, "expected_generation"),
    previousStatus,
    adminAccountId:
      row.admin_account_id === null
        ? null
        : requiredPositiveInteger(row.admin_account_id, "admin_account_id"),
    action: "ADMIN_KILL",
    reasonCode,
    createdAt: requiredString(row.created_at, "created_at"),
  };
}

export function mapMultiplayerInviteRow(row: Record<string, unknown>): MultiplayerInviteRecord {
  return {
    id: requiredPositiveInteger(row.id, "id"),
    instanceId: requiredString(row.instance_id, "instance_id"),
    generation: requiredPositiveInteger(row.generation, "generation"),
    tokenHash: sha256Hex(row.token_hash, "token_hash"),
    createdByUserId: requiredPositiveInteger(row.created_by_user_id, "created_by_user_id"),
    maxUses: requiredPositiveInteger(row.max_uses, "max_uses"),
    usedCount: requiredNonNegativeInteger(row.used_count, "used_count"),
    expiresAt: requiredString(row.expires_at, "expires_at"),
    revokedAt: nullableString(row.revoked_at, "revoked_at"),
    createdAt: requiredString(row.created_at, "created_at"),
    updatedAt: requiredString(row.updated_at, "updated_at"),
  };
}

export function mapGameVersionLeaseRow(row: Record<string, unknown>): GameVersionLeaseRecord {
  return {
    id: requiredPositiveInteger(row.id, "id"),
    gameVersionId: requiredPositiveInteger(row.game_version_id, "game_version_id"),
    instanceId: requiredString(row.instance_id, "instance_id"),
    generation: requiredPositiveInteger(row.generation, "generation"),
    status: enumValue(row.status, "status", GAME_VERSION_LEASE_STATUSES),
    acquiredAt: requiredString(row.acquired_at, "acquired_at"),
    expiresAt: requiredString(row.expires_at, "expires_at"),
    endedAt: nullableString(row.ended_at, "ended_at"),
    endReasonCode: nullableString(row.end_reason_code, "end_reason_code"),
    updatedAt: requiredString(row.updated_at, "updated_at"),
  };
}

function sameCreateSemantics(
  instance: MultiplayerInstanceRecord,
  input: CreateMultiplayerInstanceInput,
): boolean {
  return (
    instance.createdByUserId === input.createdByUserId &&
    instance.createIdempotencyHash === input.createIdempotencyHash &&
    instance.gameId === input.gameId &&
    instance.gameVersionId === input.gameVersionId &&
    instance.profileId === input.profileId &&
    instance.profileRevision === input.profileRevision &&
    instance.visibility === input.visibility &&
    instance.joinPolicy === input.joinPolicy &&
    instance.lifecycle === input.lifecycle &&
    instance.maxPlayers === input.maxPlayers
  );
}

function sameAdminKillSemantics(
  action: MultiplayerInstanceAdminActionRecord,
  input: AdminKillMultiplayerInstanceInput,
): boolean {
  return (
    action.instanceId === input.instanceId &&
    action.expectedGeneration === input.expectedGeneration &&
    action.adminAccountId === input.adminAccountId &&
    action.reasonCode === input.reasonCode
  );
}

export class D1MultiplayerInstanceRepository implements MultiplayerInstanceRepository {
  constructor(private readonly db: D1Database) {}

  async createWithHostAndLease(
    input: CreateMultiplayerInstanceInput,
  ): Promise<CreateMultiplayerInstanceResult> {
    const nowMs = Date.parse(input.nowIso);
    const instanceExpiresMs = Date.parse(input.instanceExpiresAt);
    const leaseExpiresMs = Date.parse(input.leaseExpiresAt);
    if (
      !Number.isFinite(nowMs) ||
      !Number.isFinite(instanceExpiresMs) ||
      !Number.isFinite(leaseExpiresMs) ||
      instanceExpiresMs <= nowMs ||
      leaseExpiresMs < instanceExpiresMs
    ) {
      throw new RangeError(
        "instance expiry must be in the future and the exact-version lease must cover it",
      );
    }
    const replay = await this.findByIdempotency(input.createdByUserId, input.createIdempotencyHash);
    if (replay) return this.replayedAggregate(replay, input);

    let results: D1Result[];
    try {
      results = await this.db.batch([
        this.db
          .prepare(
            `INSERT OR IGNORE INTO multiplayer_instances (
               id, public_code, created_by_user_id, create_idempotency_hash,
               game_id, game_version_id, profile_id, profile_revision,
               visibility, join_policy, lifecycle, status, generation,
               participant_count, max_players, expires_at, created_at, updated_at
             ) VALUES (
               ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CREATED', 1, 0, ?, ?, ?, ?
             )`,
          )
          .bind(
            input.instanceId,
            input.publicCode,
            input.createdByUserId,
            input.createIdempotencyHash,
            input.gameId,
            input.gameVersionId,
            input.profileId,
            input.profileRevision,
            input.visibility,
            input.joinPolicy,
            input.lifecycle,
            input.maxPlayers,
            input.instanceExpiresAt,
            input.nowIso,
            input.nowIso,
          ),
        this.db
          .prepare(
            `INSERT INTO multiplayer_participants (
               id, instance_id, user_id, role, seat_index, status,
               connection_generation, joined_at, updated_at
             )
             SELECT ?, instance.id, instance.created_by_user_id, 'HOST', 0, 'JOINED', 0, ?, ?
             FROM multiplayer_instances instance
             WHERE instance.id = ?
               AND instance.created_by_user_id = ?
               AND instance.create_idempotency_hash = ?
               AND NOT EXISTS (
                 SELECT 1 FROM multiplayer_participants participant
                 WHERE participant.instance_id = instance.id
                   AND participant.user_id = ?
               )`,
          )
          .bind(
            input.hostParticipantId,
            input.nowIso,
            input.nowIso,
            input.instanceId,
            input.createdByUserId,
            input.createIdempotencyHash,
            input.createdByUserId,
          ),
        this.db
          .prepare(
            `INSERT INTO game_version_leases (
               game_version_id, instance_id, generation, status,
               acquired_at, expires_at, updated_at
             )
             SELECT instance.game_version_id, instance.id, instance.generation,
                    'ACTIVE', ?, ?, ?
             FROM multiplayer_instances instance
             WHERE instance.id = ?
               AND instance.created_by_user_id = ?
               AND instance.create_idempotency_hash = ?
               AND NOT EXISTS (
                 SELECT 1 FROM game_version_leases lease
                 WHERE lease.game_version_id = instance.game_version_id
                   AND lease.instance_id = instance.id
               )`,
          )
          .bind(
            input.nowIso,
            input.leaseExpiresAt,
            input.nowIso,
            input.instanceId,
            input.createdByUserId,
            input.createIdempotencyHash,
          ),
      ]);
    } catch (error) {
      const concurrentReplay = await this.findByIdempotency(
        input.createdByUserId,
        input.createIdempotencyHash,
      );
      if (concurrentReplay) return this.replayedAggregate(concurrentReplay, input);
      throw error;
    }

    const instance = await this.findByIdempotency(
      input.createdByUserId,
      input.createIdempotencyHash,
    );
    if (!instance) return { status: "IDENTIFIER_CONFLICT" };
    if (!sameCreateSemantics(instance, input)) {
      return { status: "IDEMPOTENCY_CONFLICT" };
    }
    const aggregate = await this.loadAggregate(instance);
    return {
      status: writtenRows(results[0]) === 0 ? "REPLAYED" : "CREATED",
      ...aggregate,
    };
  }

  async findById(instanceId: string): Promise<MultiplayerInstanceRecord | null> {
    const row = await this.db
      .prepare(`SELECT ` + INSTANCE_SELECT_COLUMNS + ` FROM multiplayer_instances WHERE id = ?`)
      .bind(instanceId)
      .first<Record<string, unknown>>();
    return row ? mapMultiplayerInstanceRow(row) : null;
  }

  async findByPublicCode(publicCode: string): Promise<MultiplayerInstanceRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT ` + INSTANCE_SELECT_COLUMNS + ` FROM multiplayer_instances WHERE public_code = ?`,
      )
      .bind(publicCode)
      .first<Record<string, unknown>>();
    return row ? mapMultiplayerInstanceRow(row) : null;
  }

  async listParticipants(instanceId: string): Promise<readonly MultiplayerParticipantRecord[]> {
    const result = await this.db
      .prepare(
        `SELECT ` +
          PARTICIPANT_SELECT_COLUMNS +
          ` FROM multiplayer_participants WHERE instance_id = ? ORDER BY seat_index, id`,
      )
      .bind(instanceId)
      .all<Record<string, unknown>>();
    return (result.results ?? []).map(mapMultiplayerParticipantRow);
  }

  async join(input: JoinMultiplayerInstanceInput): Promise<JoinMultiplayerInstanceResult> {
    const existing = await this.findParticipant(input.instanceId, input.userId);
    if (existing) {
      if (existing.status === "JOINED" || existing.status === "READY") {
        return { status: "REPLAYED", participant: existing };
      }
      if (existing.status === "KICKED") {
        return { status: "REJECTED", code: "ALREADY_JOINED" };
      }

      // A voluntary lobby leave retains the immutable participant row for audit and reconnect
      // identity. Reclaim that exact seat atomically instead of treating the retained LEFT row as
      // a second participant. The original admission already consumed its invite, so a rejoin does
      // not consume another invite use; the opaque room code and authenticated user must still
      // match this exact instance participant.
      const rejoined = await this.db
        .prepare(
          `UPDATE multiplayer_participants
           SET status = 'JOINED', ready_at = NULL, left_at = NULL, updated_at = ?
           WHERE instance_id = ? AND user_id = ? AND status = 'LEFT'
             AND EXISTS (
               SELECT 1
               FROM multiplayer_instances instance
               JOIN multiplayer_profiles profile ON profile.id = instance.profile_id
               JOIN games game ON game.id = instance.game_id
               JOIN game_versions version
                 ON version.id = instance.game_version_id AND version.game_id = game.id
               WHERE instance.id = multiplayer_participants.instance_id
                 AND instance.generation = ?
                 AND instance.status IN ('CREATED', 'LOBBY')
                 AND instance.expires_at > ?
                 AND instance.participant_count < instance.max_players
                 AND profile.enabled = 1
                 AND game.deleted_at IS NULL
                 AND game.live_version_id = version.id
                 AND version.publish_status = 'READY'
                 AND (
                   game.publisher_type = 'OWOGG'
                   OR (game.publisher_type = 'USER' AND version.moderation_status = 'APPROVED')
                 )
             )`,
        )
        .bind(input.nowIso, input.instanceId, input.userId, input.expectedGeneration, input.nowIso)
        .run();
      if ((writtenRows(rejoined) ?? 0) === 1) {
        const participant = await this.findParticipant(input.instanceId, input.userId);
        if (participant?.status === "JOINED") return { status: "JOINED", participant };
      }
      return this.classifyJoinAfterWrite(input, 0);
    }

    let results: D1Result[];
    try {
      results = await this.db.batch([
        this.db
          .prepare(
            `INSERT OR IGNORE INTO multiplayer_participants (
               id, instance_id, user_id, role, seat_index, status,
               connection_generation, joined_at, updated_at
             )
             SELECT ?, instance.id, ?, 'PLAYER',
                    (
                      SELECT CAST(seat.value AS INTEGER)
                      FROM json_each('[0,1,2,3,4,5,6,7]') seat
                      WHERE CAST(seat.value AS INTEGER) < instance.max_players
                        AND NOT EXISTS (
                          SELECT 1 FROM multiplayer_participants occupied
                          WHERE occupied.instance_id = instance.id
                            AND occupied.seat_index = CAST(seat.value AS INTEGER)
                        )
                      ORDER BY CAST(seat.value AS INTEGER)
                      LIMIT 1
                    ),
                    'JOINED', 0, ?, ?
             FROM multiplayer_instances instance
             WHERE instance.id = ?
               AND instance.generation = ?
               AND instance.status IN ('CREATED', 'LOBBY')
               AND instance.expires_at > ?
               AND instance.participant_count < instance.max_players
               AND EXISTS (
                 SELECT 1
                 FROM multiplayer_profiles profile
                 JOIN games game ON game.id = instance.game_id
                 JOIN game_versions version
                   ON version.id = instance.game_version_id
                  AND version.game_id = game.id
                 WHERE profile.id = instance.profile_id
                   AND profile.enabled = 1
                   AND game.deleted_at IS NULL
                   AND game.live_version_id = version.id
                   AND version.publish_status = 'READY'
                   AND (
                     game.publisher_type = 'OWOGG'
                     OR (
                       game.publisher_type = 'USER'
                       AND version.moderation_status = 'APPROVED'
                     )
                   )
               )
               AND NOT EXISTS (
                 SELECT 1 FROM multiplayer_participants existing
                 WHERE existing.instance_id = instance.id AND existing.user_id = ?
               )
               AND (
                 instance.join_policy = 'OPEN'
                 OR (
                   ? IS NOT NULL
                   AND EXISTS (
                     SELECT 1 FROM multiplayer_invites invite
                     WHERE invite.instance_id = instance.id
                       AND invite.generation = instance.generation
                       AND invite.token_hash = ?
                       AND invite.revoked_at IS NULL
                       AND invite.expires_at > ?
                       AND invite.used_count < invite.max_uses
                   )
                 )
               )`,
          )
          .bind(
            input.participantId,
            input.userId,
            input.nowIso,
            input.nowIso,
            input.instanceId,
            input.expectedGeneration,
            input.nowIso,
            input.userId,
            input.inviteTokenHash,
            input.inviteTokenHash,
            input.nowIso,
          ),
        this.db
          .prepare(
            `UPDATE multiplayer_invites
             SET used_count = used_count + 1, updated_at = ?
             WHERE token_hash = ?
               AND instance_id = ?
               AND generation = ?
               AND revoked_at IS NULL
               AND expires_at > ?
               AND used_count < max_uses
               AND EXISTS (
                 SELECT 1 FROM multiplayer_instances instance
                 WHERE instance.id = multiplayer_invites.instance_id
                   AND instance.join_policy = 'INVITE_ONLY'
               )
               AND changes() = 1`,
          )
          .bind(
            input.nowIso,
            input.inviteTokenHash,
            input.instanceId,
            input.expectedGeneration,
            input.nowIso,
          ),
      ]);
    } catch {
      return this.classifyJoinAfterWrite(input, null);
    }

    return this.classifyJoinAfterWrite(input, writtenRows(results[0]));
  }

  async createInvite(input: CreateMultiplayerInviteInput): Promise<CreateMultiplayerInviteResult> {
    if (
      !/^[0-9a-f]{64}$/.test(input.tokenHash) ||
      !Number.isInteger(input.maxUses) ||
      input.maxUses < 1 ||
      input.maxUses > 8 ||
      input.expiresAt <= input.nowIso
    ) {
      return { status: "REJECTED", code: "INVALID_REQUEST" };
    }

    let result: D1Result | undefined;
    try {
      [result] = await this.db.batch([
        this.db
          .prepare(
            `INSERT OR IGNORE INTO multiplayer_invites (
               instance_id, generation, token_hash, created_by_user_id,
               max_uses, used_count, expires_at, created_at, updated_at
             )
             SELECT instance.id, instance.generation, ?, ?, ?, 0, ?, ?, ?
             FROM multiplayer_instances instance
             WHERE instance.id = ?
               AND instance.generation = ?
               AND instance.status IN ('CREATED', 'LOBBY')
               AND instance.expires_at > ?
               AND EXISTS (
                 SELECT 1
                 FROM multiplayer_profiles profile
                 JOIN games game ON game.id = instance.game_id
                 JOIN game_versions version
                   ON version.id = instance.game_version_id
                  AND version.game_id = game.id
                 WHERE profile.id = instance.profile_id
                   AND profile.enabled = 1
                   AND game.deleted_at IS NULL
                   AND game.live_version_id = version.id
                   AND version.publish_status = 'READY'
                   AND (
                     game.publisher_type = 'OWOGG'
                     OR (
                       game.publisher_type = 'USER'
                       AND version.moderation_status = 'APPROVED'
                     )
                   )
               )
               AND ? > ?
               AND ? <= instance.max_players
               AND EXISTS (
                 SELECT 1 FROM multiplayer_participants participant
                 WHERE participant.instance_id = instance.id
                   AND participant.user_id = ?
                   AND participant.status IN ('JOINED', 'READY')
               )`,
          )
          .bind(
            input.tokenHash,
            input.createdByUserId,
            input.maxUses,
            input.expiresAt,
            input.nowIso,
            input.nowIso,
            input.instanceId,
            input.expectedGeneration,
            input.nowIso,
            input.expiresAt,
            input.nowIso,
            input.maxUses,
            input.createdByUserId,
          ),
      ]);
    } catch {
      // Classification below deliberately hides raw database details from callers.
    }

    const invite = await this.findInviteByTokenHash(input.tokenHash);
    if (invite) {
      const sameRequest =
        invite.instanceId === input.instanceId &&
        invite.generation === input.expectedGeneration &&
        invite.createdByUserId === input.createdByUserId &&
        invite.maxUses === input.maxUses;
      return sameRequest
        ? { status: writtenRows(result) === 1 ? "CREATED" : "REPLAYED", invite }
        : { status: "REJECTED", code: "INTERNAL_RETRYABLE" };
    }

    const instance = await this.findById(input.instanceId);
    if (!instance) return { status: "REJECTED", code: "INSTANCE_NOT_FOUND" };
    if (instance.generation !== input.expectedGeneration) {
      return { status: "REJECTED", code: "STALE_GENERATION" };
    }
    if (!["CREATED", "LOBBY"].includes(instance.status) || instance.expiresAt <= input.nowIso) {
      return { status: "REJECTED", code: "INSTANCE_NOT_JOINABLE" };
    }
    if (!(await this.isProfileAdmissionEnabled(instance))) {
      return { status: "REJECTED", code: "PROFILE_DISABLED" };
    }
    if (input.maxUses > instance.maxPlayers) {
      return { status: "REJECTED", code: "INVALID_REQUEST" };
    }
    const creator = await this.findParticipant(input.instanceId, input.createdByUserId);
    if (!creator || (creator.status !== "JOINED" && creator.status !== "READY")) {
      return { status: "REJECTED", code: "NOT_PARTICIPANT" };
    }
    return { status: "REJECTED", code: "INTERNAL_RETRYABLE" };
  }

  async findInviteByTokenHash(tokenHash: string): Promise<MultiplayerInviteRecord | null> {
    const row = await this.db
      .prepare(`SELECT ` + INVITE_SELECT_COLUMNS + ` FROM multiplayer_invites WHERE token_hash = ?`)
      .bind(tokenHash)
      .first<Record<string, unknown>>();
    return row ? mapMultiplayerInviteRow(row) : null;
  }

  async revokeInvite(inviteId: number, createdByUserId: number, nowIso: string): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE multiplayer_invites
         SET revoked_at = ?, updated_at = ?
         WHERE id = ? AND created_by_user_id = ? AND revoked_at IS NULL`,
      )
      .bind(nowIso, nowIso, inviteId, createdByUserId)
      .run();
    return (writtenRows(result) ?? 0) === 1;
  }

  async transitionParticipant(
    input: TransitionMultiplayerParticipantInput,
  ): Promise<MultiplayerParticipantRecord | null> {
    const result = await this.db
      .prepare(
        `UPDATE multiplayer_participants
         SET status = ?, ready_at = ?, left_at = ?, updated_at = ?
         WHERE instance_id = ? AND user_id = ? AND status = ?
           AND EXISTS (
             SELECT 1 FROM multiplayer_instances instance
             WHERE instance.id = multiplayer_participants.instance_id
               AND instance.generation = ?
               AND (? IS NULL OR instance.status = ?)
               AND (? <> 'READY' OR instance.status = 'LOBBY')
               AND (
                 ? <> 'LEFT'
                 OR ? <> 'JOINED'
                 OR EXISTS (
                   SELECT 1
                   FROM multiplayer_profiles profile
                   JOIN games game ON game.id = instance.game_id
                   JOIN game_versions version
                     ON version.id = instance.game_version_id
                    AND version.game_id = game.id
                   WHERE profile.id = instance.profile_id
                     AND profile.enabled = 1
                     AND game.deleted_at IS NULL
                     AND game.live_version_id = version.id
                     AND version.publish_status = 'READY'
                     AND (
                       game.publisher_type = 'OWOGG'
                       OR (
                         game.publisher_type = 'USER'
                         AND version.moderation_status = 'APPROVED'
                       )
                     )
                 )
               )
           )`,
      )
      .bind(
        input.nextStatus,
        input.readyAt,
        input.leftAt,
        input.nowIso,
        input.instanceId,
        input.userId,
        input.expectedStatus,
        input.expectedInstanceGeneration,
        input.expectedInstanceStatus ?? null,
        input.expectedInstanceStatus ?? null,
        input.nextStatus,
        input.expectedStatus,
        input.nextStatus,
      )
      .run();
    if ((writtenRows(result) ?? 0) !== 1) return null;
    return this.findParticipant(input.instanceId, input.userId);
  }

  async advanceConnectionGeneration(
    input: AdvanceMultiplayerConnectionInput,
  ): Promise<MultiplayerParticipantRecord | null> {
    const result = await this.db
      .prepare(
        `UPDATE multiplayer_participants
         SET connection_generation = connection_generation + 1, updated_at = ?
         WHERE instance_id = ? AND user_id = ?
           AND connection_generation = ?
           AND status IN ('JOINED', 'READY')
           AND EXISTS (
             SELECT 1 FROM multiplayer_instances instance
             WHERE instance.id = multiplayer_participants.instance_id
               AND instance.generation = ?
               AND instance.status NOT IN ('CLOSED', 'ABORTED', 'EXPIRED')
           )`,
      )
      .bind(
        input.nowIso,
        input.instanceId,
        input.userId,
        input.expectedConnectionGeneration,
        input.expectedInstanceGeneration,
      )
      .run();
    if ((writtenRows(result) ?? 0) !== 1) return null;
    return this.findParticipant(input.instanceId, input.userId);
  }

  async listRematchRequesterParticipantIds(
    instanceId: string,
    generation: number,
  ): Promise<readonly string[]> {
    const result = await this.db
      .prepare(
        `SELECT participant_id
         FROM multiplayer_rematch_requests
         WHERE instance_id = ? AND generation = ?
         ORDER BY requested_at, participant_id`,
      )
      .bind(instanceId, generation)
      .all<{ participant_id: string }>();
    return (result.results ?? []).map((row) =>
      requiredString(row.participant_id, "participant_id"),
    );
  }

  async requestRematch(
    input: RequestMultiplayerRematchInput,
  ): Promise<RequestMultiplayerRematchResult> {
    const current = await this.findById(input.instanceId);
    if (!current) return { status: "REJECTED", code: "INSTANCE_NOT_FOUND" };
    if (current.generation !== input.expectedGeneration) {
      if (current.generation === input.expectedGeneration + 1) {
        return this.classifyRematchAfterWrite(input, false);
      }
      return { status: "REJECTED", code: "STALE_GENERATION" };
    }
    const participant = await this.findParticipant(input.instanceId, input.userId);
    if (!participant || participant.id !== input.participantId || participant.status !== "READY") {
      return { status: "REJECTED", code: "NOT_PARTICIPANT" };
    }
    if (current.status !== "CLOSING" || current.expiresAt <= input.nowIso) {
      return { status: "REJECTED", code: "INSTANCE_NOT_JOINABLE" };
    }

    const existingRequesters = await this.listRematchRequesterParticipantIds(
      input.instanceId,
      input.expectedGeneration,
    );
    const replayed = existingRequesters.includes(input.participantId);
    try {
      await this.db.batch([
        this.db
          .prepare(
            `INSERT OR IGNORE INTO multiplayer_rematch_requests (
               instance_id, generation, participant_id, requested_at
             )
             SELECT instance.id, instance.generation, participant.id, ?
             FROM multiplayer_instances instance
             JOIN multiplayer_participants participant
               ON participant.instance_id = instance.id
             WHERE instance.id = ?
               AND instance.generation = ?
               AND instance.status = 'CLOSING'
               AND instance.expires_at > ?
               AND participant.id = ?
               AND participant.user_id = ?
               AND participant.status = 'READY'`,
          )
          .bind(
            input.nowIso,
            input.instanceId,
            input.expectedGeneration,
            input.nowIso,
            input.participantId,
            input.userId,
          ),
        this.db
          .prepare(
            `UPDATE multiplayer_instances
             SET status = 'LOBBY', generation = generation + 1,
                 closed_at = NULL, abort_code = NULL, updated_at = ?
             WHERE id = ?
               AND generation = ?
               AND status = 'CLOSING'
               AND expires_at > ?
               AND participant_count >= 2
               AND participant_count = (
                 SELECT COUNT(*)
                 FROM multiplayer_participants participant
                 WHERE participant.instance_id = multiplayer_instances.id
                   AND participant.status = 'READY'
               )
               AND participant_count = (
                 SELECT COUNT(DISTINCT request.participant_id)
                 FROM multiplayer_rematch_requests request
                 WHERE request.instance_id = multiplayer_instances.id
                   AND request.generation = multiplayer_instances.generation
               )
               AND EXISTS (
                 SELECT 1
                 FROM multiplayer_matches match
                 WHERE match.instance_id = multiplayer_instances.id
                   AND match.generation = multiplayer_instances.generation
                   AND match.status = 'COMMITTED'
                   AND match.committed_at IS NOT NULL
                   AND unixepoch(?) < unixepoch(match.committed_at) + ?
               )`,
          )
          .bind(
            input.nowIso,
            input.instanceId,
            input.expectedGeneration,
            input.nowIso,
            input.nowIso,
            MULTIPLAYER_REMATCH_WINDOW_MS / 1_000,
          ),
      ]);
    } catch {
      return this.classifyRematchAfterWrite(input, replayed);
    }
    return this.classifyRematchAfterWrite(input, replayed);
  }

  private async classifyRematchAfterWrite(
    input: RequestMultiplayerRematchInput,
    replayed: boolean,
  ): Promise<RequestMultiplayerRematchResult> {
    const [instance, participant, requesterParticipantIds] = await Promise.all([
      this.findById(input.instanceId),
      this.findParticipant(input.instanceId, input.userId),
      this.listRematchRequesterParticipantIds(input.instanceId, input.expectedGeneration),
    ]);
    if (!instance) return { status: "REJECTED", code: "INSTANCE_NOT_FOUND" };
    if (!participant || participant.id !== input.participantId) {
      return { status: "REJECTED", code: "NOT_PARTICIPANT" };
    }
    if (
      instance.generation === input.expectedGeneration + 1 &&
      (instance.status === "LOBBY" ||
        instance.status === "STARTING" ||
        instance.status === "ACTIVE")
    ) {
      return {
        status: "STARTED",
        instance,
        participant,
        requesterParticipantIds,
      };
    }
    if (instance.generation !== input.expectedGeneration) {
      return { status: "REJECTED", code: "STALE_GENERATION" };
    }
    if (instance.status !== "CLOSING") {
      return { status: "REJECTED", code: "INSTANCE_NOT_JOINABLE" };
    }
    if (!requesterParticipantIds.includes(input.participantId)) {
      return { status: "REJECTED", code: "INTERNAL_RETRYABLE" };
    }
    return {
      status: replayed ? "REPLAYED" : "REQUESTED",
      instance,
      participant,
      requesterParticipantIds,
    };
  }

  async findLease(instanceId: string): Promise<GameVersionLeaseRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT ` +
          LEASE_SELECT_COLUMNS +
          ` FROM game_version_leases WHERE instance_id = ? ORDER BY id DESC LIMIT 1`,
      )
      .bind(instanceId)
      .first<Record<string, unknown>>();
    return row ? mapGameVersionLeaseRow(row) : null;
  }

  async adminKill(
    input: AdminKillMultiplayerInstanceInput,
  ): Promise<AdminKillMultiplayerInstanceResult> {
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(input.operationId)) {
      throw new RangeError("operationId must be an opaque 16-128 character identifier");
    }
    if (!Number.isInteger(input.expectedGeneration) || input.expectedGeneration <= 0) {
      throw new RangeError("expectedGeneration must be positive");
    }
    if (!Number.isInteger(input.adminAccountId) || input.adminAccountId <= 0) {
      throw new RangeError("adminAccountId must be positive");
    }
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(input.reasonCode)) {
      throw new RangeError("reasonCode must be a stable uppercase code");
    }
    if (Number.isNaN(Date.parse(input.nowIso)))
      throw new RangeError("nowIso must be an ISO timestamp");

    const replay = await this.findAdminAction(input.operationId);
    if (replay) {
      const instance = await this.findById(replay.instanceId);
      return sameAdminKillSemantics(replay, input) && instance !== null
        ? { status: "REPLAYED", instance, action: replay }
        : { status: "CONFLICT", instance };
    }

    const current = await this.findById(input.instanceId);
    if (!current) return { status: "NOT_FOUND" };
    if (
      current.generation !== input.expectedGeneration ||
      ["CLOSED", "ABORTED", "EXPIRED"].includes(current.status)
    ) {
      return { status: "CONFLICT", instance: current };
    }

    const results = await this.db.batch([
      this.db
        .prepare(
          `UPDATE multiplayer_instances
           SET status = 'ABORTED', closed_at = ?, abort_code = 'ADMIN_KILLED', updated_at = ?
           WHERE id = ? AND generation = ? AND status = ?`,
        )
        .bind(
          input.nowIso,
          input.nowIso,
          input.instanceId,
          input.expectedGeneration,
          current.status,
        ),
      this.db
        .prepare(
          `INSERT INTO multiplayer_instance_admin_actions (
             operation_id, instance_id, expected_generation, previous_status,
             admin_account_id, action, reason_code, created_at
           )
           SELECT ?, ?, ?, ?, ?, 'ADMIN_KILL', ?, ?
           WHERE changes() = 1`,
        )
        .bind(
          input.operationId,
          input.instanceId,
          input.expectedGeneration,
          current.status,
          input.adminAccountId,
          input.reasonCode,
          input.nowIso,
        ),
    ]);
    const [instance, action] = await Promise.all([
      this.findById(input.instanceId),
      this.findAdminAction(input.operationId),
    ]);
    if (writtenRows(results[0]) === 1 && instance && action) {
      return { status: "KILLED", instance, action };
    }
    const concurrentReplay = await this.findAdminAction(input.operationId);
    if (concurrentReplay) {
      const concurrentInstance = await this.findById(input.instanceId);
      return concurrentInstance && sameAdminKillSemantics(concurrentReplay, input)
        ? { status: "REPLAYED", instance: concurrentInstance, action: concurrentReplay }
        : { status: "CONFLICT", instance: concurrentInstance };
    }
    return { status: "CONFLICT", instance };
  }

  async expireDueInstances(nowIso: string, limit: number): Promise<readonly string[]> {
    if (Number.isNaN(Date.parse(nowIso))) throw new RangeError("nowIso must be an ISO timestamp");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new RangeError("limit must be an integer between 1 and 100");
    }
    const result = await this.db
      .prepare(
        `UPDATE multiplayer_instances
         SET status = 'EXPIRED', closed_at = ?, abort_code = NULL, updated_at = ?
         WHERE id IN (
           SELECT instance.id
           FROM multiplayer_instances instance
           JOIN game_version_leases lease
             ON lease.instance_id = instance.id AND lease.status = 'ACTIVE'
           WHERE instance.status NOT IN ('CLOSED', 'ABORTED', 'EXPIRED')
             AND (instance.expires_at <= ? OR lease.expires_at <= ?)
           ORDER BY
             CASE
               WHEN instance.expires_at < lease.expires_at
                 THEN instance.expires_at
               ELSE lease.expires_at
             END ASC,
             instance.id ASC
           LIMIT ?
         )
         RETURNING id`,
      )
      .bind(nowIso, nowIso, nowIso, nowIso, limit)
      .all<{ id: string }>();
    return (result.results ?? []).map((row) => row.id).sort();
  }

  async transition(input: TransitionMultiplayerInstanceInput): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE multiplayer_instances
         SET status = ?, generation = ?, closed_at = ?, abort_code = ?, updated_at = ?
         WHERE id = ? AND status = ? AND generation = ?`,
      )
      .bind(
        input.nextStatus,
        input.nextGeneration,
        input.closedAt,
        input.abortCode,
        input.nowIso,
        input.instanceId,
        input.expectedStatus,
        input.expectedGeneration,
      )
      .run();
    return (writtenRows(result) ?? 0) === 1;
  }

  private async findByIdempotency(
    createdByUserId: number,
    idempotencyHash: string,
  ): Promise<MultiplayerInstanceRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT ` +
          INSTANCE_SELECT_COLUMNS +
          ` FROM multiplayer_instances
             WHERE created_by_user_id = ? AND create_idempotency_hash = ?`,
      )
      .bind(createdByUserId, idempotencyHash)
      .first<Record<string, unknown>>();
    return row ? mapMultiplayerInstanceRow(row) : null;
  }

  async findParticipant(
    instanceId: string,
    userId: number,
  ): Promise<MultiplayerParticipantRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT ` +
          PARTICIPANT_SELECT_COLUMNS +
          ` FROM multiplayer_participants WHERE instance_id = ? AND user_id = ?`,
      )
      .bind(instanceId, userId)
      .first<Record<string, unknown>>();
    return row ? mapMultiplayerParticipantRow(row) : null;
  }

  private async isProfileAdmissionEnabled(instance: MultiplayerInstanceRecord): Promise<boolean> {
    const row = await this.db
      .prepare(
        `SELECT 1
         FROM multiplayer_profiles profile
         JOIN games game ON game.id = profile.game_id
         JOIN game_versions version
           ON version.id = profile.game_version_id AND version.game_id = game.id
         WHERE profile.id = ? AND profile.enabled = 1
           AND game.id = ? AND version.id = ?
           AND game.deleted_at IS NULL AND game.live_version_id = version.id
           AND version.publish_status = 'READY'
           AND (
             game.publisher_type = 'OWOGG'
             OR (game.publisher_type = 'USER' AND version.moderation_status = 'APPROVED')
           )
         LIMIT 1`,
      )
      .bind(instance.profileId, instance.gameId, instance.gameVersionId)
      .first();
    return row !== null;
  }

  private async findAdminAction(
    operationId: string,
  ): Promise<MultiplayerInstanceAdminActionRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT ${ADMIN_ACTION_SELECT_COLUMNS}
         FROM multiplayer_instance_admin_actions WHERE operation_id = ?`,
      )
      .bind(operationId)
      .first<Record<string, unknown>>();
    return row ? mapMultiplayerInstanceAdminActionRow(row) : null;
  }

  private async classifyJoinAfterWrite(
    input: JoinMultiplayerInstanceInput,
    rowsWritten: number | null,
  ): Promise<JoinMultiplayerInstanceResult> {
    const [participant, instance] = await Promise.all([
      this.findParticipant(input.instanceId, input.userId),
      this.findById(input.instanceId),
    ]);
    if (!instance) return { status: "REJECTED", code: "INSTANCE_NOT_FOUND" };
    if (instance.generation !== input.expectedGeneration) {
      return { status: "REJECTED", code: "STALE_GENERATION" };
    }
    if (!["CREATED", "LOBBY"].includes(instance.status) || instance.expiresAt <= input.nowIso) {
      return { status: "REJECTED", code: "INSTANCE_NOT_JOINABLE" };
    }
    if (participant) {
      if (participant.status === "JOINED" || participant.status === "READY") {
        return { status: rowsWritten === 1 ? "JOINED" : "REPLAYED", participant };
      }
      if (participant.status === "KICKED") {
        return { status: "REJECTED", code: "ALREADY_JOINED" };
      }
    }
    if (!(await this.isProfileAdmissionEnabled(instance))) {
      return { status: "REJECTED", code: "PROFILE_DISABLED" };
    }

    if (participant?.status === "LEFT") {
      if (instance.participantCount >= instance.maxPlayers) {
        return { status: "REJECTED", code: "INSTANCE_FULL" };
      }
      // A joinable LEFT row should normally have been reclaimed above. Reaching this branch means
      // an admission precondition changed concurrently; surface it as retryable, not as a false
      // claim that the user is still participating.
      return { status: "REJECTED", code: "INTERNAL_RETRYABLE" };
    }

    if (instance.joinPolicy === "INVITE_ONLY") {
      if (!input.inviteTokenHash) return { status: "REJECTED", code: "INVITE_INVALID" };
      const invite = await this.findInviteByTokenHash(input.inviteTokenHash);
      if (
        !invite ||
        invite.instanceId !== input.instanceId ||
        invite.generation !== input.expectedGeneration ||
        invite.revokedAt !== null ||
        invite.expiresAt <= input.nowIso
      ) {
        return { status: "REJECTED", code: "INVITE_INVALID" };
      }
      if (invite.usedCount >= invite.maxUses) {
        return { status: "REJECTED", code: "INVITE_EXHAUSTED" };
      }
    }

    if (instance.participantCount >= instance.maxPlayers) {
      return { status: "REJECTED", code: "INSTANCE_FULL" };
    }
    return { status: "REJECTED", code: "INTERNAL_RETRYABLE" };
  }

  private async replayedAggregate(
    instance: MultiplayerInstanceRecord,
    input: CreateMultiplayerInstanceInput,
  ): Promise<CreateMultiplayerInstanceResult> {
    if (!sameCreateSemantics(instance, input)) {
      return { status: "IDEMPOTENCY_CONFLICT" };
    }
    const aggregate = await this.loadAggregate(instance);
    return { status: "REPLAYED", ...aggregate };
  }

  private async loadAggregate(instance: MultiplayerInstanceRecord): Promise<{
    instance: MultiplayerInstanceRecord;
    host: MultiplayerParticipantRecord;
    lease: GameVersionLeaseRecord;
  }> {
    const [hostRow, leaseRow] = await Promise.all([
      this.db
        .prepare(
          `SELECT ` +
            PARTICIPANT_SELECT_COLUMNS +
            ` FROM multiplayer_participants
               WHERE instance_id = ? AND user_id = ?
               ORDER BY seat_index LIMIT 1`,
        )
        .bind(instance.id, instance.createdByUserId)
        .first<Record<string, unknown>>(),
      this.db
        .prepare(
          `SELECT ` +
            LEASE_SELECT_COLUMNS +
            ` FROM game_version_leases
               WHERE game_version_id = ? AND instance_id = ?`,
        )
        .bind(instance.gameVersionId, instance.id)
        .first<Record<string, unknown>>(),
    ]);
    if (!hostRow || !leaseRow) {
      throw new Error("Corrupt multiplayer instance aggregate: host or lease is missing");
    }
    return {
      instance,
      host: mapMultiplayerParticipantRow(hostRow),
      lease: mapGameVersionLeaseRow(leaseRow),
    };
  }
}
