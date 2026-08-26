import {
  MULTIPLAYER_ABORT_CODES,
  MULTIPLAYER_ACTION_RESULT_CODES,
  MULTIPLAYER_MATCH_OUTCOMES,
  MULTIPLAYER_MATCH_STATUSES,
  MULTIPLAYER_PLAYER_RESULT_STATUSES,
  MULTIPLAYER_REWARD_OUTBOX_STATUSES,
  type CreatePendingMultiplayerMatchInput,
  type CreatePendingMultiplayerMatchResult,
  type ClaimMultiplayerRewardInput,
  type FinalizeMultiplayerPlayerInput,
  type FinalizeMultiplayerMatchInput,
  type FinalizeMultiplayerMatchResult,
  type MultiplayerMatchActionRecord,
  type MultiplayerMatchPlayerRecord,
  type MultiplayerMatchRecord,
  type MultiplayerMatchRepository,
  type MultiplayerRewardOutboxRecord,
  type RecordMultiplayerActionInput,
  type RecordMultiplayerActionResult,
} from "@owogg/core";
import type { D1Database, D1Result } from "./D1UserRepository.js";

const MATCH_SELECT_COLUMNS =
  "id, instance_id, generation, game_id, game_version_id, profile_id, profile_revision, status, state_revision, terminal_result_json, terminal_result_hash, abort_code, created_at, started_at, finalizing_at, committed_at, aborted_at, updated_at";
const PLAYER_SELECT_COLUMNS =
  "match_id, user_id, participant_id, result_status, outcome, placement, result_json, reward_eligible, committed_at, aborted_at, created_at";
const ACTION_SELECT_COLUMNS =
  "id, match_id, user_id, participant_id, client_seq, server_seq, client_action_id, payload_hash, expected_revision, result_revision, result_code, response_json, created_at";
const REWARD_SELECT_COLUMNS =
  "id, source_id, match_id, user_id, game_id, reward_policy_id, reward_payload_json, status, attempt_count, available_at, lock_token_hash, locked_at, applied_at, last_error_code, created_at, updated_at";

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid ${field} in multiplayer row: ${String(value)}`);
  }
  return value;
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  return requiredString(value, field);
}

function requiredPositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid ${field} in multiplayer row: ${String(value)}`);
  }
  return value;
}

function requiredNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid ${field} in multiplayer row: ${String(value)}`);
  }
  return value;
}

function nullablePositiveInteger(value: unknown, field: string): number | null {
  if (value === null) return null;
  return requiredPositiveInteger(value, field);
}

function booleanInteger(value: unknown, field: string): boolean {
  if (value !== 0 && value !== 1) {
    throw new Error(`Invalid ${field} in multiplayer row: ${String(value)}`);
  }
  return value === 1;
}

function enumValue<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new Error(`Invalid ${field} in multiplayer row: ${String(value)}`);
  }
  return value as T;
}

function nullableEnumValue<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T | null {
  if (value === null) return null;
  return enumValue(value, field, allowed);
}

function sha256Hex(value: unknown, field: string): string {
  const text = requiredString(value, field);
  if (!/^[0-9a-f]{64}$/.test(text)) {
    throw new Error(`Invalid ${field} in multiplayer row: ${text}`);
  }
  return text;
}

function jsonObjectString(value: unknown, field: string): string {
  const text = requiredString(value, field);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Invalid ${field} JSON in multiplayer row`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Invalid ${field} object in multiplayer row`);
  }
  return text;
}

function nullableJsonObjectString(value: unknown, field: string): string | null {
  if (value === null) return null;
  return jsonObjectString(value, field);
}

function writtenRows(result: D1Result | undefined): number | null {
  // D1 rows_written includes index maintenance; changes is the CAS-relevant table-row count.
  const value = result?.meta?.changes ?? result?.meta?.rows_written;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isJsonObjectString(value: string): boolean {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

export function mapMultiplayerMatchRow(row: Record<string, unknown>): MultiplayerMatchRecord {
  return {
    id: requiredString(row.id, "id"),
    instanceId: requiredString(row.instance_id, "instance_id"),
    generation: requiredPositiveInteger(row.generation, "generation"),
    gameId: requiredPositiveInteger(row.game_id, "game_id"),
    gameVersionId: requiredPositiveInteger(row.game_version_id, "game_version_id"),
    profileId: requiredPositiveInteger(row.profile_id, "profile_id"),
    profileRevision: requiredPositiveInteger(row.profile_revision, "profile_revision"),
    status: enumValue(row.status, "status", MULTIPLAYER_MATCH_STATUSES),
    stateRevision: requiredNonNegativeInteger(row.state_revision, "state_revision"),
    terminalResultJson: nullableJsonObjectString(row.terminal_result_json, "terminal_result_json"),
    terminalResultHash:
      row.terminal_result_hash === null
        ? null
        : sha256Hex(row.terminal_result_hash, "terminal_result_hash"),
    abortCode: nullableEnumValue(row.abort_code, "abort_code", MULTIPLAYER_ABORT_CODES),
    createdAt: requiredString(row.created_at, "created_at"),
    startedAt: nullableString(row.started_at, "started_at"),
    finalizingAt: nullableString(row.finalizing_at, "finalizing_at"),
    committedAt: nullableString(row.committed_at, "committed_at"),
    abortedAt: nullableString(row.aborted_at, "aborted_at"),
    updatedAt: requiredString(row.updated_at, "updated_at"),
  };
}

export function mapMultiplayerMatchPlayerRow(
  row: Record<string, unknown>,
): MultiplayerMatchPlayerRecord {
  return {
    matchId: requiredString(row.match_id, "match_id"),
    userId: requiredPositiveInteger(row.user_id, "user_id"),
    participantId: requiredString(row.participant_id, "participant_id"),
    resultStatus: enumValue(row.result_status, "result_status", MULTIPLAYER_PLAYER_RESULT_STATUSES),
    outcome: nullableEnumValue(row.outcome, "outcome", MULTIPLAYER_MATCH_OUTCOMES),
    placement: nullablePositiveInteger(row.placement, "placement"),
    resultJson: nullableJsonObjectString(row.result_json, "result_json"),
    rewardEligible: booleanInteger(row.reward_eligible, "reward_eligible"),
    committedAt: nullableString(row.committed_at, "committed_at"),
    abortedAt: nullableString(row.aborted_at, "aborted_at"),
    createdAt: requiredString(row.created_at, "created_at"),
  };
}

export function mapMultiplayerMatchActionRow(
  row: Record<string, unknown>,
): MultiplayerMatchActionRecord {
  return {
    id: requiredPositiveInteger(row.id, "id"),
    matchId: requiredString(row.match_id, "match_id"),
    userId: requiredPositiveInteger(row.user_id, "user_id"),
    participantId: requiredString(row.participant_id, "participant_id"),
    clientSeq: requiredNonNegativeInteger(row.client_seq, "client_seq"),
    serverSeq: requiredNonNegativeInteger(row.server_seq, "server_seq"),
    clientActionId: requiredString(row.client_action_id, "client_action_id"),
    payloadHash: sha256Hex(row.payload_hash, "payload_hash"),
    expectedRevision: requiredNonNegativeInteger(row.expected_revision, "expected_revision"),
    resultRevision: requiredNonNegativeInteger(row.result_revision, "result_revision"),
    resultCode: enumValue(row.result_code, "result_code", MULTIPLAYER_ACTION_RESULT_CODES),
    responseJson: jsonObjectString(row.response_json, "response_json"),
    createdAt: requiredString(row.created_at, "created_at"),
  };
}

export function mapMultiplayerRewardOutboxRow(
  row: Record<string, unknown>,
): MultiplayerRewardOutboxRecord {
  return {
    id: requiredPositiveInteger(row.id, "id"),
    sourceId: requiredString(row.source_id, "source_id"),
    matchId: requiredString(row.match_id, "match_id"),
    userId: requiredPositiveInteger(row.user_id, "user_id"),
    gameId: requiredPositiveInteger(row.game_id, "game_id"),
    rewardPolicyId: requiredString(row.reward_policy_id, "reward_policy_id"),
    rewardPayloadJson: jsonObjectString(row.reward_payload_json, "reward_payload_json"),
    status: enumValue(row.status, "status", MULTIPLAYER_REWARD_OUTBOX_STATUSES),
    attemptCount: requiredNonNegativeInteger(row.attempt_count, "attempt_count"),
    availableAt: requiredString(row.available_at, "available_at"),
    lockTokenHash:
      row.lock_token_hash === null ? null : sha256Hex(row.lock_token_hash, "lock_token_hash"),
    lockedAt: nullableString(row.locked_at, "locked_at"),
    appliedAt: nullableString(row.applied_at, "applied_at"),
    lastErrorCode: nullableString(row.last_error_code, "last_error_code"),
    createdAt: requiredString(row.created_at, "created_at"),
    updatedAt: requiredString(row.updated_at, "updated_at"),
  };
}

export class D1MultiplayerMatchRepository implements MultiplayerMatchRepository {
  constructor(private readonly db: D1Database) {}

  async createPendingWithPlayers(
    input: CreatePendingMultiplayerMatchInput,
  ): Promise<CreatePendingMultiplayerMatchResult> {
    const existing = await this.findMatchByInstanceGeneration(
      input.instanceId,
      input.expectedGeneration,
    );
    if (existing) return this.replayCreatedMatch(existing, input.matchId);

    let results: D1Result[] = [];
    try {
      results = await this.db.batch([
        this.db
          .prepare(
            `INSERT OR IGNORE INTO multiplayer_matches (
               id, instance_id, generation, game_id, game_version_id,
               profile_id, profile_revision, status, state_revision,
               created_at, updated_at
             )
             SELECT ?, instance.id, instance.generation, instance.game_id,
                    instance.game_version_id, instance.profile_id,
                    instance.profile_revision, 'PENDING', 0, ?, ?
             FROM multiplayer_instances instance
             JOIN multiplayer_profiles profile ON profile.id = instance.profile_id
             WHERE instance.id = ?
               AND instance.generation = ?
               AND instance.status = 'STARTING'
               AND instance.participant_count >= profile.min_players
               AND instance.participant_count = (
                 SELECT COUNT(*) FROM multiplayer_participants participant
                 WHERE participant.instance_id = instance.id
                   AND participant.status = 'READY'
               )`,
          )
          .bind(
            input.matchId,
            input.nowIso,
            input.nowIso,
            input.instanceId,
            input.expectedGeneration,
          ),
        this.db
          .prepare(
            `INSERT OR IGNORE INTO multiplayer_match_players (
               match_id, user_id, participant_id, result_status,
               reward_eligible, created_at
             )
             SELECT match.id, participant.user_id, participant.id,
                    'PENDING', 0, ?
             FROM multiplayer_matches match
             JOIN multiplayer_participants participant
               ON participant.instance_id = match.instance_id
             WHERE match.id = ?
               AND match.instance_id = ?
               AND match.generation = ?
               AND participant.status = 'READY'`,
          )
          .bind(input.nowIso, input.matchId, input.instanceId, input.expectedGeneration),
      ]);
    } catch {
      // Re-read below so concurrent idempotent creation is distinguishable from corruption.
    }

    const created = await this.findMatchByInstanceGeneration(
      input.instanceId,
      input.expectedGeneration,
    );
    if (created) {
      const replay = await this.replayCreatedMatch(created, input.matchId);
      if (replay.status === "REJECTED") return replay;
      return {
        ...replay,
        status: writtenRows(results[0]) === 1 ? "CREATED" : "REPLAYED",
      };
    }

    if (await this.findMatch(input.matchId)) {
      return { status: "REJECTED", code: "IDENTIFIER_CONFLICT" };
    }
    const instance = await this.db
      .prepare(
        `SELECT instance.generation, instance.status, instance.participant_count,
                profile.min_players,
                (
                  SELECT COUNT(*) FROM multiplayer_participants participant
                  WHERE participant.instance_id = instance.id
                    AND participant.status = 'READY'
                ) AS ready_count
         FROM multiplayer_instances instance
         JOIN multiplayer_profiles profile ON profile.id = instance.profile_id
         WHERE instance.id = ?`,
      )
      .bind(input.instanceId)
      .first<Record<string, unknown>>();
    if (!instance) return { status: "REJECTED", code: "INSTANCE_NOT_FOUND" };
    if (Number(instance.generation) !== input.expectedGeneration) {
      return { status: "REJECTED", code: "STALE_GENERATION" };
    }
    if (instance.status !== "STARTING") {
      return { status: "REJECTED", code: "INSTANCE_NOT_STARTING" };
    }
    if (
      Number(instance.participant_count) < Number(instance.min_players) ||
      Number(instance.ready_count) !== Number(instance.participant_count)
    ) {
      return { status: "REJECTED", code: "PLAYERS_NOT_READY" };
    }
    return { status: "REJECTED", code: "INTERNAL_RETRYABLE" };
  }

  async findMatch(matchId: string): Promise<MultiplayerMatchRecord | null> {
    const row = await this.db
      .prepare(`SELECT ${MATCH_SELECT_COLUMNS} FROM multiplayer_matches WHERE id = ?`)
      .bind(matchId)
      .first<Record<string, unknown>>();
    return row ? mapMultiplayerMatchRow(row) : null;
  }

  async findMatchByInstanceGeneration(
    instanceId: string,
    generation: number,
  ): Promise<MultiplayerMatchRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT ${MATCH_SELECT_COLUMNS}
         FROM multiplayer_matches WHERE instance_id = ? AND generation = ?`,
      )
      .bind(instanceId, generation)
      .first<Record<string, unknown>>();
    return row ? mapMultiplayerMatchRow(row) : null;
  }

  async listPlayers(matchId: string): Promise<readonly MultiplayerMatchPlayerRecord[]> {
    const result = await this.db
      .prepare(
        `SELECT ${PLAYER_SELECT_COLUMNS}
         FROM multiplayer_match_players WHERE match_id = ? ORDER BY user_id`,
      )
      .bind(matchId)
      .all<Record<string, unknown>>();
    return (result.results ?? []).map(mapMultiplayerMatchPlayerRow);
  }

  async listActionsAfterRevision(
    matchId: string,
    afterRevision: number,
    limit: number,
  ): Promise<readonly MultiplayerMatchActionRecord[]> {
    const safeLimit = Math.min(500, Math.max(1, Math.trunc(limit)));
    const result = await this.db
      .prepare(
        `SELECT ${ACTION_SELECT_COLUMNS}
         FROM multiplayer_match_actions
         WHERE match_id = ? AND result_revision > ?
         ORDER BY result_revision, id LIMIT ?`,
      )
      .bind(matchId, Math.max(0, Math.trunc(afterRevision)), safeLimit)
      .all<Record<string, unknown>>();
    return (result.results ?? []).map(mapMultiplayerMatchActionRow);
  }

  async findLatestAction(matchId: string): Promise<MultiplayerMatchActionRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT ${ACTION_SELECT_COLUMNS}
         FROM multiplayer_match_actions
         WHERE match_id = ?
         ORDER BY server_seq DESC, id DESC
         LIMIT 1`,
      )
      .bind(matchId)
      .first<Record<string, unknown>>();
    return row ? mapMultiplayerMatchActionRow(row) : null;
  }

  async recordAction(input: RecordMultiplayerActionInput): Promise<RecordMultiplayerActionResult> {
    if (!this.isValidActionInput(input)) {
      return { status: "REJECTED", code: "INVALID_INPUT", currentRevision: null };
    }
    const existing = await this.findAction(input.matchId, input.userId, input.clientActionId);
    if (existing) return this.replayAction(existing, input.payloadHash);

    let insertResult: D1Result | undefined;
    try {
      if (input.resultCode === "ACCEPTED") {
        const results = await this.db.batch([
          this.db
            .prepare(
              `UPDATE multiplayer_matches
               SET state_revision = ?, updated_at = ?
               WHERE id = ? AND status = 'ACTIVE' AND state_revision = ?`,
            )
            .bind(input.resultRevision, input.nowIso, input.matchId, input.expectedRevision),
          this.db
            .prepare(
              `INSERT INTO multiplayer_match_actions (
                 match_id, user_id, participant_id, client_seq, server_seq,
                 client_action_id, payload_hash, expected_revision, result_revision,
                 result_code, response_json, created_at
               )
               SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
               WHERE changes() = 1`,
            )
            .bind(
              input.matchId,
              input.userId,
              input.participantId,
              input.clientSeq,
              input.serverSeq,
              input.clientActionId,
              input.payloadHash,
              input.expectedRevision,
              input.resultRevision,
              input.resultCode,
              input.responseJson,
              input.nowIso,
            ),
        ]);
        insertResult = results[1];
      } else {
        [insertResult] = await this.db.batch([
          this.db
            .prepare(
              `INSERT OR IGNORE INTO multiplayer_match_actions (
                 match_id, user_id, participant_id, client_seq, server_seq,
                 client_action_id, payload_hash, expected_revision, result_revision,
                 result_code, response_json, created_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              input.matchId,
              input.userId,
              input.participantId,
              input.clientSeq,
              input.serverSeq,
              input.clientActionId,
              input.payloadHash,
              input.expectedRevision,
              input.resultRevision,
              input.resultCode,
              input.responseJson,
              input.nowIso,
            ),
        ]);
      }
    } catch {
      // Typed classification below prevents raw SQL details from becoming an API contract.
    }

    const recorded = await this.findAction(input.matchId, input.userId, input.clientActionId);
    if (recorded) {
      if (recorded.payloadHash !== input.payloadHash) {
        return {
          status: "REJECTED",
          code: "ACTION_ID_REUSED",
          currentRevision: (await this.findMatch(input.matchId))?.stateRevision ?? null,
        };
      }
      return {
        // D1 may include index maintenance in rows_written, so a successful single-row table
        // insert can report more than one billed write. Zero is the only replay signal here.
        status: (writtenRows(insertResult) ?? 0) > 0 ? "RECORDED" : "REPLAYED",
        action: recorded,
      };
    }

    const match = await this.findMatch(input.matchId);
    if (!match || (input.resultCode === "ACCEPTED" && match.status !== "ACTIVE")) {
      return {
        status: "REJECTED",
        code: "MATCH_NOT_ACTIVE",
        currentRevision: match?.stateRevision ?? null,
      };
    }
    if (!(await this.isExactParticipant(input.matchId, input.userId, input.participantId))) {
      return {
        status: "REJECTED",
        code: "NOT_PARTICIPANT",
        currentRevision: match.stateRevision,
      };
    }
    return {
      status: "REJECTED",
      code: "ACTION_CONFLICT",
      currentRevision: match.stateRevision,
    };
  }

  async finalize(input: FinalizeMultiplayerMatchInput): Promise<FinalizeMultiplayerMatchResult> {
    if (!this.isValidFinalizationInput(input)) {
      return { status: "REJECTED", code: "INVALID_INPUT" };
    }

    const match = await this.findMatch(input.matchId);
    if (!match) return { status: "REJECTED", code: "MATCH_NOT_FOUND" };
    if (match.status === "PENDING" || match.status === "ABORTED") {
      return { status: "REJECTED", code: "MATCH_NOT_ACTIVE" };
    }
    if (match.status === "ACTIVE" && match.stateRevision !== input.expectedStateRevision) {
      return { status: "REJECTED", code: "STALE_REVISION" };
    }
    if (
      (match.status === "FINALIZING" || match.status === "COMMITTED") &&
      (match.terminalResultHash !== input.terminalResultHash ||
        match.terminalResultJson !== input.terminalResultJson)
    ) {
      return { status: "REJECTED", code: "TERMINAL_CONFLICT" };
    }

    const [players, rewards, policyRow] = await Promise.all([
      this.listPlayers(input.matchId),
      this.listRewards(input.matchId),
      this.db
        .prepare(
          `SELECT profile.reward_policy_id
           FROM multiplayer_matches match
           JOIN multiplayer_profiles profile ON profile.id = match.profile_id
           WHERE match.id = ?`,
        )
        .bind(input.matchId)
        .first<Record<string, unknown>>(),
    ]);
    const conflict = this.findFinalizationConflict(
      match,
      players,
      rewards,
      policyRow?.reward_policy_id === null || policyRow?.reward_policy_id === undefined
        ? null
        : String(policyRow.reward_policy_id),
      input,
    );
    if (conflict) return { status: "REJECTED", code: conflict };

    if (match.status === "COMMITTED") {
      return { status: "REPLAYED", match, players, rewards };
    }

    const statements = [
      this.db
        .prepare(
          `UPDATE multiplayer_matches
           SET status = 'FINALIZING', terminal_result_json = ?, terminal_result_hash = ?,
               finalizing_at = COALESCE(finalizing_at, ?), updated_at = ?
           WHERE id = ?
             AND (
               (status = 'ACTIVE' AND state_revision = ?)
               OR (
                 status = 'FINALIZING'
                 AND terminal_result_hash = ?
                 AND terminal_result_json = ?
               )
             )`,
        )
        .bind(
          input.terminalResultJson,
          input.terminalResultHash,
          input.nowIso,
          input.nowIso,
          input.matchId,
          input.expectedStateRevision,
          input.terminalResultHash,
          input.terminalResultJson,
        ),
    ];

    for (const player of input.players) {
      statements.push(
        this.db
          .prepare(
            `UPDATE multiplayer_match_players
             SET result_status = 'COMMITTED', outcome = ?, placement = ?,
                 result_json = ?, reward_eligible = ?, committed_at = ?
             WHERE match_id = ? AND user_id = ? AND participant_id = ?
               AND result_status = 'PENDING'
               AND EXISTS (
                 SELECT 1 FROM multiplayer_matches match
                 WHERE match.id = multiplayer_match_players.match_id
                   AND match.status = 'FINALIZING'
                   AND match.terminal_result_hash = ?
                   AND match.terminal_result_json = ?
               )`,
          )
          .bind(
            player.outcome,
            player.placement,
            player.resultJson,
            player.rewardEligible ? 1 : 0,
            input.nowIso,
            input.matchId,
            player.userId,
            player.participantId,
            input.terminalResultHash,
            input.terminalResultJson,
          ),
      );
    }

    for (const player of input.players) {
      if (!player.reward) continue;
      statements.push(
        this.db
          .prepare(
            `INSERT OR IGNORE INTO multiplayer_reward_outbox (
               source_id, match_id, user_id, game_id, reward_policy_id,
               reward_payload_json, status, attempt_count, available_at,
               created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 0, ?, ?, ?)`,
          )
          .bind(
            player.reward.sourceId,
            input.matchId,
            player.userId,
            match.gameId,
            player.reward.rewardPolicyId,
            player.reward.payloadJson,
            input.nowIso,
            input.nowIso,
            input.nowIso,
          ),
      );
    }

    statements.push(
      this.db
        .prepare(
          `UPDATE multiplayer_matches
           SET status = 'COMMITTED', committed_at = ?, updated_at = ?
           WHERE id = ? AND status = 'FINALIZING'
             AND terminal_result_hash = ? AND terminal_result_json = ?
             AND NOT EXISTS (
               SELECT 1 FROM multiplayer_match_players player
               WHERE player.match_id = multiplayer_matches.id
                 AND player.result_status <> 'COMMITTED'
             )`,
        )
        .bind(
          input.nowIso,
          input.nowIso,
          input.matchId,
          input.terminalResultHash,
          input.terminalResultJson,
        ),
    );

    try {
      await this.db.batch(statements);
    } catch {
      // Re-read below. A concurrent identical commit is a replay, not an internal failure.
    }

    const committed = await this.findMatch(input.matchId);
    if (!committed) return { status: "REJECTED", code: "MATCH_NOT_FOUND" };
    if (
      committed.terminalResultHash !== input.terminalResultHash ||
      committed.terminalResultJson !== input.terminalResultJson
    ) {
      return { status: "REJECTED", code: "TERMINAL_CONFLICT" };
    }
    const [committedPlayers, committedRewards] = await Promise.all([
      this.listPlayers(input.matchId),
      this.listRewards(input.matchId),
    ]);
    const postConflict = this.findFinalizationConflict(
      committed,
      committedPlayers,
      committedRewards,
      policyRow?.reward_policy_id === null || policyRow?.reward_policy_id === undefined
        ? null
        : String(policyRow.reward_policy_id),
      input,
    );
    if (postConflict) return { status: "REJECTED", code: postConflict };
    if (committed.status !== "COMMITTED") {
      return { status: "REJECTED", code: "INTERNAL_RETRYABLE" };
    }
    return {
      status: "COMMITTED",
      match: committed,
      players: committedPlayers,
      rewards: committedRewards,
    };
  }

  private async findAction(
    matchId: string,
    userId: number,
    clientActionId: string,
  ): Promise<MultiplayerMatchActionRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT ${ACTION_SELECT_COLUMNS}
         FROM multiplayer_match_actions
         WHERE match_id = ? AND user_id = ? AND client_action_id = ?`,
      )
      .bind(matchId, userId, clientActionId)
      .first<Record<string, unknown>>();
    return row ? mapMultiplayerMatchActionRow(row) : null;
  }

  private async isExactParticipant(
    matchId: string,
    userId: number,
    participantId: string,
  ): Promise<boolean> {
    const row = await this.db
      .prepare(
        `SELECT 1
         FROM multiplayer_match_players
         WHERE match_id = ? AND user_id = ? AND participant_id = ?`,
      )
      .bind(matchId, userId, participantId)
      .first();
    return Boolean(row);
  }

  private replayAction(
    action: MultiplayerMatchActionRecord,
    payloadHash: string,
  ): RecordMultiplayerActionResult {
    return action.payloadHash === payloadHash
      ? { status: "REPLAYED", action }
      : {
          status: "REJECTED",
          code: "ACTION_ID_REUSED",
          currentRevision: action.resultRevision,
        };
  }

  private isValidActionInput(input: RecordMultiplayerActionInput): boolean {
    return (
      input.matchId.length >= 16 &&
      input.participantId.length >= 8 &&
      input.clientActionId.length >= 16 &&
      input.clientActionId.length <= 128 &&
      /^[0-9a-f]{64}$/.test(input.payloadHash) &&
      Number.isInteger(input.clientSeq) &&
      input.clientSeq >= 0 &&
      Number.isInteger(input.serverSeq) &&
      input.serverSeq >= 0 &&
      Number.isInteger(input.expectedRevision) &&
      input.expectedRevision >= 0 &&
      Number.isInteger(input.resultRevision) &&
      input.resultRevision >= 0 &&
      (input.resultCode !== "ACCEPTED" || input.resultRevision > input.expectedRevision) &&
      isJsonObjectString(input.responseJson)
    );
  }

  private async replayCreatedMatch(
    match: MultiplayerMatchRecord,
    requestedMatchId: string,
  ): Promise<CreatePendingMultiplayerMatchResult> {
    if (match.id !== requestedMatchId) {
      return { status: "REJECTED", code: "IDENTIFIER_CONFLICT" };
    }
    const players = await this.listPlayers(match.id);
    if (players.length === 0) {
      return { status: "REJECTED", code: "INTERNAL_RETRYABLE" };
    }
    return { status: "REPLAYED", match, players };
  }

  private async listRewards(matchId: string): Promise<readonly MultiplayerRewardOutboxRecord[]> {
    const result = await this.db
      .prepare(
        `SELECT ${REWARD_SELECT_COLUMNS}
         FROM multiplayer_reward_outbox WHERE match_id = ? ORDER BY user_id, id`,
      )
      .bind(matchId)
      .all<Record<string, unknown>>();
    return (result.results ?? []).map(mapMultiplayerRewardOutboxRow);
  }

  private isValidFinalizationInput(input: FinalizeMultiplayerMatchInput): boolean {
    if (
      input.matchId.length < 16 ||
      !Number.isInteger(input.expectedStateRevision) ||
      input.expectedStateRevision < 0 ||
      !/^[0-9a-f]{64}$/.test(input.terminalResultHash) ||
      !isJsonObjectString(input.terminalResultJson) ||
      input.players.length < 1 ||
      input.players.length > 8
    ) {
      return false;
    }
    const userIds = new Set<number>();
    const participantIds = new Set<string>();
    for (const player of input.players) {
      if (
        !Number.isInteger(player.userId) ||
        player.userId <= 0 ||
        player.participantId.length < 8 ||
        userIds.has(player.userId) ||
        participantIds.has(player.participantId) ||
        !(["WIN", "LOSS", "DRAW", "COMPLETED"] as readonly string[]).includes(player.outcome) ||
        (player.placement !== null &&
          (!Number.isInteger(player.placement) || player.placement < 1 || player.placement > 8)) ||
        !isJsonObjectString(player.resultJson) ||
        player.rewardEligible !== Boolean(player.reward)
      ) {
        return false;
      }
      userIds.add(player.userId);
      participantIds.add(player.participantId);
      if (
        player.reward &&
        (player.reward.sourceId !== `${input.matchId}:${player.userId}` ||
          player.reward.rewardPolicyId.length < 1 ||
          player.reward.rewardPolicyId.length > 96 ||
          player.reward.rewardPolicyId !== player.reward.rewardPolicyId.trim() ||
          !isJsonObjectString(player.reward.payloadJson))
      ) {
        return false;
      }
    }
    return true;
  }

  private findFinalizationConflict(
    match: MultiplayerMatchRecord,
    storedPlayers: readonly MultiplayerMatchPlayerRecord[],
    storedRewards: readonly MultiplayerRewardOutboxRecord[],
    rewardPolicyId: string | null,
    input: FinalizeMultiplayerMatchInput,
  ): "PLAYER_SET_MISMATCH" | "RESULT_CONFLICT" | "REWARD_CONFLICT" | null {
    if (storedPlayers.length !== input.players.length) return "PLAYER_SET_MISMATCH";
    const requestedByUser = new Map(input.players.map((player) => [player.userId, player]));
    for (const stored of storedPlayers) {
      const requested = requestedByUser.get(stored.userId);
      if (!requested || requested.participantId !== stored.participantId) {
        return "PLAYER_SET_MISMATCH";
      }
      if (stored.resultStatus === "ABORTED") return "RESULT_CONFLICT";
      if (
        stored.resultStatus === "COMMITTED" &&
        (stored.outcome !== requested.outcome ||
          stored.placement !== requested.placement ||
          stored.resultJson !== requested.resultJson ||
          stored.rewardEligible !== requested.rewardEligible)
      ) {
        return "RESULT_CONFLICT";
      }
      if (requested.rewardEligible) {
        if (!requested.reward || !rewardPolicyId) return "REWARD_CONFLICT";
        if (requested.reward.rewardPolicyId !== rewardPolicyId) return "REWARD_CONFLICT";
      }
    }

    const rewardsByUser = new Map<number, NonNullable<FinalizeMultiplayerPlayerInput["reward"]>>();
    for (const player of input.players) {
      if (player.reward) rewardsByUser.set(player.userId, player.reward);
    }
    if (
      storedRewards.length > rewardsByUser.size ||
      (match.status === "COMMITTED" && storedRewards.length !== rewardsByUser.size)
    ) {
      return "REWARD_CONFLICT";
    }
    for (const stored of storedRewards) {
      const requested = rewardsByUser.get(stored.userId);
      if (
        !requested ||
        stored.matchId !== match.id ||
        stored.gameId !== match.gameId ||
        stored.sourceId !== requested.sourceId ||
        stored.rewardPolicyId !== requested.rewardPolicyId ||
        stored.rewardPayloadJson !== requested.payloadJson
      ) {
        return "REWARD_CONFLICT";
      }
    }
    return null;
  }

  private isValidOutboxErrorCode(errorCode: string): boolean {
    return errorCode.length >= 1 && errorCode.length <= 64 && errorCode === errorCode.trim();
  }

  async claimNextReward(
    input: ClaimMultiplayerRewardInput,
  ): Promise<MultiplayerRewardOutboxRecord | null> {
    if (!/^[0-9a-f]{64}$/.test(input.lockTokenHash)) return null;
    const row = await this.db
      .prepare(
        `UPDATE multiplayer_reward_outbox
         SET status = 'PROCESSING', attempt_count = attempt_count + 1,
             lock_token_hash = ?, locked_at = ?, applied_at = NULL,
             last_error_code = NULL, updated_at = ?
         WHERE id = (
           SELECT outbox.id
           FROM multiplayer_reward_outbox outbox
           JOIN multiplayer_matches match ON match.id = outbox.match_id
           WHERE outbox.status IN ('PENDING', 'RETRYABLE')
             AND outbox.available_at <= ?
             AND match.status = 'COMMITTED'
           ORDER BY outbox.available_at, outbox.id
           LIMIT 1
         )
         RETURNING ${REWARD_SELECT_COLUMNS}`,
      )
      .bind(input.lockTokenHash, input.nowIso, input.nowIso, input.nowIso)
      .first<Record<string, unknown>>();
    return row ? mapMultiplayerRewardOutboxRow(row) : null;
  }

  async markRewardApplied(
    rewardId: number,
    lockTokenHash: string,
    nowIso: string,
  ): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE multiplayer_reward_outbox
         SET status = 'APPLIED', lock_token_hash = NULL, locked_at = NULL,
             applied_at = ?, last_error_code = NULL, updated_at = ?
         WHERE id = ? AND status = 'PROCESSING' AND lock_token_hash = ?`,
      )
      .bind(nowIso, nowIso, rewardId, lockTokenHash)
      .run();
    return (writtenRows(result) ?? 0) === 1;
  }

  async markRewardRetryable(
    rewardId: number,
    lockTokenHash: string,
    errorCode: string,
    nextAvailableAt: string,
    nowIso: string,
  ): Promise<boolean> {
    if (!this.isValidOutboxErrorCode(errorCode)) return false;
    const result = await this.db
      .prepare(
        `UPDATE multiplayer_reward_outbox
         SET status = 'RETRYABLE', available_at = ?, lock_token_hash = NULL,
             locked_at = NULL, applied_at = NULL, last_error_code = ?, updated_at = ?
         WHERE id = ? AND status = 'PROCESSING' AND lock_token_hash = ?`,
      )
      .bind(nextAvailableAt, errorCode, nowIso, rewardId, lockTokenHash)
      .run();
    return (writtenRows(result) ?? 0) === 1;
  }

  async markRewardDeadLetter(
    rewardId: number,
    lockTokenHash: string,
    errorCode: string,
    nowIso: string,
  ): Promise<boolean> {
    if (!this.isValidOutboxErrorCode(errorCode)) return false;
    const result = await this.db
      .prepare(
        `UPDATE multiplayer_reward_outbox
         SET status = 'DEAD_LETTER', lock_token_hash = NULL, locked_at = NULL,
             applied_at = NULL, last_error_code = ?, updated_at = ?
         WHERE id = ? AND status = 'PROCESSING' AND lock_token_hash = ?`,
      )
      .bind(errorCode, nowIso, rewardId, lockTokenHash)
      .run();
    return (writtenRows(result) ?? 0) === 1;
  }

  async requeueStaleRewards(staleBeforeIso: string, nowIso: string): Promise<number> {
    const result = await this.db
      .prepare(
        `UPDATE multiplayer_reward_outbox
         SET status = 'RETRYABLE', available_at = ?, lock_token_hash = NULL,
             locked_at = NULL, applied_at = NULL,
             last_error_code = 'WORKER_LOCK_EXPIRED', updated_at = ?
         WHERE status = 'PROCESSING' AND locked_at < ?`,
      )
      .bind(nowIso, nowIso, staleBeforeIso)
      .run();
    return writtenRows(result) ?? 0;
  }
}
