import {
  MULTIPLAYER_ABORT_CODES,
  MULTIPLAYER_MATCH_OUTCOMES,
  MULTIPLAYER_MATCH_STATUSES,
  MULTIPLAYER_PLAYER_RESULT_STATUSES,
  type CreatePendingMultiplayerMatchInput,
  type CreatePendingMultiplayerMatchResult,
  type MultiplayerMatchPlayerRecord,
  type MultiplayerMatchRecord,
  type MultiplayerMatchRepository,
} from "@owogg/core";
import type { D1Database, D1Result } from "./D1UserRepository.js";

const MATCH_SELECT_COLUMNS =
  "id, instance_id, generation, game_id, game_version_id, profile_id, profile_revision, status, state_revision, terminal_result_json, terminal_result_hash, abort_code, created_at, started_at, finalizing_at, committed_at, aborted_at, updated_at";
const PLAYER_SELECT_COLUMNS =
  "match_id, user_id, participant_id, result_status, outcome, placement, result_json, reward_eligible, committed_at, aborted_at, created_at";

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
}
