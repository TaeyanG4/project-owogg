import {
  MULTIPLAYER_PROFILE_REQUEST_STATUSES,
  hashManagedMultiplayerProfileRequestV1,
  parseManagedMultiplayerProfileRequestV1,
  serializeManagedMultiplayerProfileRequestV1,
  type MultiplayerProfileRequestRecord,
  type MultiplayerProfileRequestRepository,
  type ReviewMultiplayerProfileRequestInput,
  type ReviewMultiplayerProfileRequestResult,
  type SubmitMultiplayerProfileRequestInput,
  type SubmitMultiplayerProfileRequestResult,
  type WithdrawMultiplayerProfileRequestResult,
} from "@owogg/core";
import type { D1Database, D1Result } from "./D1UserRepository.js";

const REQUEST_SELECT_COLUMNS = `
  id, game_id, game_version_id, request_schema_version, request_hash, request_json,
  requested_by_user_id, status, reviewed_by_admin_id, reviewed_at,
  decision_reason_code, created_at, updated_at
`;

function requiredPositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid ${field} in multiplayer_profile_requests row: ${String(value)}`);
  }
  return value;
}

function nullablePositiveInteger(value: unknown, field: string): number | null {
  if (value === null) return null;
  return requiredPositiveInteger(value, field);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid ${field} in multiplayer_profile_requests row: ${String(value)}`);
  }
  return value;
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  return requiredString(value, field);
}

function requestHash(value: unknown): string {
  const hash = requiredString(value, "request_hash");
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw new Error(`Invalid request_hash in multiplayer_profile_requests row: ${hash}`);
  }
  return hash;
}

function writtenRows(result: D1Result | undefined): number | null {
  const value = result?.meta?.rows_written ?? result?.meta?.changes;
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

function sameNullable(left: number | null, right: number | null): boolean {
  return left === right;
}

export async function mapMultiplayerProfileRequestRow(
  row: Record<string, unknown>,
): Promise<MultiplayerProfileRequestRecord> {
  const schemaVersion = requiredPositiveInteger(
    row.request_schema_version,
    "request_schema_version",
  );
  if (schemaVersion !== 1) {
    throw new Error(
      `Invalid request_schema_version in multiplayer_profile_requests row: ${schemaVersion}`,
    );
  }

  const json = requiredString(row.request_json, "request_json");
  let source: unknown;
  try {
    source = JSON.parse(json) as unknown;
  } catch {
    throw new Error("Invalid request_json JSON in multiplayer_profile_requests row");
  }
  const request = parseManagedMultiplayerProfileRequestV1(source);
  const canonicalJson = serializeManagedMultiplayerProfileRequestV1(request);
  if (canonicalJson !== json) {
    throw new Error("Non-canonical request_json in multiplayer_profile_requests row");
  }
  const storedHash = requestHash(row.request_hash);
  const calculatedHash = await hashManagedMultiplayerProfileRequestV1(request);
  if (calculatedHash !== storedHash) {
    throw new Error("request_hash does not match request_json in multiplayer_profile_requests row");
  }

  const status = row.status;
  if (!(MULTIPLAYER_PROFILE_REQUEST_STATUSES as readonly unknown[]).includes(status)) {
    throw new Error(`Invalid status in multiplayer_profile_requests row: ${String(status)}`);
  }

  const reviewedByAdminId = nullablePositiveInteger(
    row.reviewed_by_admin_id,
    "reviewed_by_admin_id",
  );
  const reviewedAt = nullableString(row.reviewed_at, "reviewed_at");
  const decisionReasonCode = nullableString(row.decision_reason_code, "decision_reason_code");
  if (
    (status === "PENDING_REVIEW" || status === "WITHDRAWN") &&
    (reviewedByAdminId !== null || reviewedAt !== null || decisionReasonCode !== null)
  ) {
    throw new Error(`Invalid ${String(status)} review fields in multiplayer_profile_requests row`);
  }
  if (
    (status === "APPROVED" || status === "REJECTED") &&
    (reviewedByAdminId === null || reviewedAt === null)
  ) {
    throw new Error(`Missing ${String(status)} review fields in multiplayer_profile_requests row`);
  }
  if (status === "REJECTED" && decisionReasonCode === null) {
    throw new Error("Missing REJECTED decision_reason_code in multiplayer_profile_requests row");
  }
  if (status !== "REJECTED" && decisionReasonCode !== null) {
    throw new Error(
      `Unexpected ${String(status)} decision_reason_code in multiplayer_profile_requests row`,
    );
  }

  return {
    id: requiredPositiveInteger(row.id, "id"),
    gameId: requiredPositiveInteger(row.game_id, "game_id"),
    gameVersionId: requiredPositiveInteger(row.game_version_id, "game_version_id"),
    requestSchemaVersion: 1,
    requestHash: storedHash,
    requestJson: canonicalJson,
    request,
    requestedByUserId: nullablePositiveInteger(row.requested_by_user_id, "requested_by_user_id"),
    status: status as MultiplayerProfileRequestRecord["status"],
    reviewedByAdminId,
    reviewedAt,
    decisionReasonCode,
    createdAt: requiredString(row.created_at, "created_at"),
    updatedAt: requiredString(row.updated_at, "updated_at"),
  };
}

interface ExactVersionOwner {
  readonly publisherType: "OWOGG" | "USER";
  readonly publisherUserId: number | null;
}

export class D1MultiplayerProfileRequestRepository implements MultiplayerProfileRequestRepository {
  constructor(private readonly db: D1Database) {}

  private async findExactVersionOwner(
    gameId: number,
    gameVersionId: number,
  ): Promise<ExactVersionOwner | null> {
    const row = await this.db
      .prepare(
        `SELECT game.publisher_type, game.publisher_user_id
         FROM game_versions version
         JOIN games game ON game.id = version.game_id
         WHERE version.id = ? AND version.game_id = ? AND game.deleted_at IS NULL
         LIMIT 1`,
      )
      .bind(gameVersionId, gameId)
      .first<Record<string, unknown>>();
    if (!row) return null;
    if (row.publisher_type !== "OWOGG" && row.publisher_type !== "USER") {
      throw new Error(
        `Invalid publisher_type for multiplayer request: ${String(row.publisher_type)}`,
      );
    }
    return {
      publisherType: row.publisher_type,
      publisherUserId: nullablePositiveInteger(row.publisher_user_id, "publisher_user_id"),
    };
  }

  async submit(
    input: SubmitMultiplayerProfileRequestInput,
  ): Promise<SubmitMultiplayerProfileRequestResult> {
    assertPositiveId(input.gameId, "gameId");
    assertPositiveId(input.gameVersionId, "gameVersionId");
    if (input.requestedByUserId !== null) {
      assertPositiveId(input.requestedByUserId, "requestedByUserId");
    }
    assertNowIso(input.nowIso);

    const owner = await this.findExactVersionOwner(input.gameId, input.gameVersionId);
    if (!owner) return { status: "REJECTED", code: "GAME_VERSION_NOT_FOUND" };
    if (
      (owner.publisherType === "OWOGG" && input.requestedByUserId !== null) ||
      (owner.publisherType === "USER" && owner.publisherUserId !== input.requestedByUserId)
    ) {
      return { status: "REJECTED", code: "REQUESTER_NOT_OWNER" };
    }

    const canonicalJson = serializeManagedMultiplayerProfileRequestV1(input.request);
    const hash = await hashManagedMultiplayerProfileRequestV1(input.request);
    const existing = await this.findByExactVersion(input.gameVersionId);
    if (existing) {
      return existing.gameId === input.gameId &&
        existing.requestHash === hash &&
        existing.requestJson === canonicalJson &&
        sameNullable(existing.requestedByUserId, input.requestedByUserId)
        ? { status: "REPLAYED", record: existing }
        : { status: "REJECTED", code: "REQUEST_CONFLICT" };
    }

    let write: D1Result;
    try {
      write = await this.db
        .prepare(
          `INSERT OR IGNORE INTO multiplayer_profile_requests (
             game_id, game_version_id, request_schema_version, request_hash, request_json,
             requested_by_user_id, status, reviewed_by_admin_id, reviewed_at,
             decision_reason_code, created_at, updated_at
           ) VALUES (?, ?, 1, ?, ?, ?, 'PENDING_REVIEW', NULL, NULL, NULL, ?, ?)`,
        )
        .bind(
          input.gameId,
          input.gameVersionId,
          hash,
          canonicalJson,
          input.requestedByUserId,
          input.nowIso,
          input.nowIso,
        )
        .run();
    } catch (error) {
      const currentOwner = await this.findExactVersionOwner(input.gameId, input.gameVersionId);
      if (!currentOwner) return { status: "REJECTED", code: "GAME_VERSION_NOT_FOUND" };
      if (
        (currentOwner.publisherType === "OWOGG" && input.requestedByUserId !== null) ||
        (currentOwner.publisherType === "USER" &&
          currentOwner.publisherUserId !== input.requestedByUserId)
      ) {
        return { status: "REJECTED", code: "REQUESTER_NOT_OWNER" };
      }
      throw error;
    }

    const stored = await this.findByExactVersion(input.gameVersionId);
    if (!stored) {
      throw new Error("multiplayer_profile_requests insert did not produce a readable row");
    }
    if (
      stored.gameId !== input.gameId ||
      stored.requestHash !== hash ||
      stored.requestJson !== canonicalJson ||
      !sameNullable(stored.requestedByUserId, input.requestedByUserId)
    ) {
      return { status: "REJECTED", code: "REQUEST_CONFLICT" };
    }
    return {
      status: writtenRows(write) === 1 ? "CREATED" : "REPLAYED",
      record: stored,
    };
  }

  async findById(requestId: number): Promise<MultiplayerProfileRequestRecord | null> {
    assertPositiveId(requestId, "requestId");
    const row = await this.db
      .prepare(`SELECT ${REQUEST_SELECT_COLUMNS} FROM multiplayer_profile_requests WHERE id = ?`)
      .bind(requestId)
      .first<Record<string, unknown>>();
    return row ? mapMultiplayerProfileRequestRow(row) : null;
  }

  async findByExactVersion(gameVersionId: number): Promise<MultiplayerProfileRequestRecord | null> {
    assertPositiveId(gameVersionId, "gameVersionId");
    const row = await this.db
      .prepare(
        `SELECT ${REQUEST_SELECT_COLUMNS}
         FROM multiplayer_profile_requests WHERE game_version_id = ? LIMIT 1`,
      )
      .bind(gameVersionId)
      .first<Record<string, unknown>>();
    return row ? mapMultiplayerProfileRequestRow(row) : null;
  }

  async listPending(limit: number): Promise<readonly MultiplayerProfileRequestRecord[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new RangeError("limit must be an integer between 1 and 100");
    }
    const rows = await this.db
      .prepare(
        `SELECT ${REQUEST_SELECT_COLUMNS}
         FROM multiplayer_profile_requests
         WHERE status = 'PENDING_REVIEW'
         ORDER BY created_at ASC, id ASC
         LIMIT ?`,
      )
      .bind(limit)
      .all<Record<string, unknown>>();
    return Promise.all((rows.results ?? []).map(mapMultiplayerProfileRequestRow));
  }

  async review(
    input: ReviewMultiplayerProfileRequestInput,
  ): Promise<ReviewMultiplayerProfileRequestResult> {
    assertPositiveId(input.requestId, "requestId");
    assertPositiveId(input.reviewedByAdminId, "reviewedByAdminId");
    assertNowIso(input.nowIso);
    if (input.decision === "APPROVED" && input.decisionReasonCode !== null) {
      throw new RangeError("APPROVED decisionReasonCode must be null");
    }
    if (
      input.decision === "REJECTED" &&
      (input.decisionReasonCode === null ||
        !/^[A-Z][A-Z0-9_]{0,63}$/.test(input.decisionReasonCode))
    ) {
      throw new RangeError("REJECTED decisionReasonCode must be a stable uppercase code");
    }

    const write = await this.db
      .prepare(
        `UPDATE multiplayer_profile_requests
         SET status = ?, reviewed_by_admin_id = ?, reviewed_at = ?,
             decision_reason_code = ?, updated_at = ?
         WHERE id = ? AND status = 'PENDING_REVIEW'`,
      )
      .bind(
        input.decision,
        input.reviewedByAdminId,
        input.nowIso,
        input.decisionReasonCode,
        input.nowIso,
        input.requestId,
      )
      .run();
    const record = await this.findById(input.requestId).catch((error: unknown) => {
      if (error instanceof RangeError) return null;
      throw error;
    });
    if (!record) return { status: "NOT_FOUND" };
    if (writtenRows(write) === 1) return { status: "UPDATED", record };
    return record.status === input.decision &&
      record.reviewedByAdminId === input.reviewedByAdminId &&
      record.decisionReasonCode === input.decisionReasonCode
      ? { status: "REPLAYED", record }
      : { status: "CONFLICT", record };
  }

  async withdraw(
    requestId: number,
    requestedByUserId: number,
    nowIso: string,
  ): Promise<WithdrawMultiplayerProfileRequestResult> {
    assertPositiveId(requestId, "requestId");
    assertPositiveId(requestedByUserId, "requestedByUserId");
    assertNowIso(nowIso);
    const write = await this.db
      .prepare(
        `UPDATE multiplayer_profile_requests
         SET status = 'WITHDRAWN', updated_at = ?
         WHERE id = ? AND requested_by_user_id = ? AND status = 'PENDING_REVIEW'`,
      )
      .bind(nowIso, requestId, requestedByUserId)
      .run();
    const record = await this.findById(requestId);
    if (!record || record.requestedByUserId !== requestedByUserId) {
      return { status: "NOT_FOUND_OR_NOT_OWNER" };
    }
    if (writtenRows(write) === 1) return { status: "UPDATED", record };
    return record.status === "WITHDRAWN"
      ? { status: "REPLAYED", record }
      : { status: "CONFLICT", record };
  }
}
