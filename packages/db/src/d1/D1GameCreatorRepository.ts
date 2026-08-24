import type {
  GameCreatorAccessRepository,
  GameCreatorAccessRecord,
  GameCreatorAccessAuditEntry,
  GameCreatorApplicationRepository,
  GameCreatorApplicationRecord,
} from "@owogg/core";
import type {
  GameCreatorAccessStatus,
  GameCreatorAccessAuditAction,
  GameCreatorApplicationStatus,
} from "@owogg/core";
import type { D1Database } from "./D1UserRepository.js";

function mapAccessRow(row: Record<string, unknown>): GameCreatorAccessRecord {
  return {
    userId: Number(row.user_id),
    grantedByAdminId: Number(row.granted_by_admin_id),
    status: row.status as GameCreatorAccessStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapAccessAuditRow(row: Record<string, unknown>): GameCreatorAccessAuditEntry {
  return {
    id: Number(row.id),
    targetUserId: Number(row.target_user_id),
    actorAdminId: Number(row.actor_admin_id),
    action: row.action as GameCreatorAccessAuditAction,
    createdAt: String(row.created_at),
  };
}

function mapApplicationRow(row: Record<string, unknown>): GameCreatorApplicationRecord {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    status: row.status as GameCreatorApplicationStatus,
    message: row.message === null || row.message === undefined ? null : String(row.message),
    reviewedByAdminId:
      row.reviewed_by_admin_id === null || row.reviewed_by_admin_id === undefined
        ? null
        : Number(row.reviewed_by_admin_id),
    reviewedAt:
      row.reviewed_at === null || row.reviewed_at === undefined ? null : String(row.reviewed_at),
    rejectReason:
      row.reject_reason === null || row.reject_reason === undefined
        ? null
        : String(row.reject_reason),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/** Persists both Game Creator concerns (see packages/core/src/ports/gameCreator.ts) against the
 * tables migration 0025 renamed/created: game_creator_access (formerly game_developers),
 * game_creator_access_audit_log (formerly game_developer_audit_log), and the new
 * game_creator_applications. Kept in one class, like D1SandboxGameRepository already does for its
 * several related concerns, rather than splitting into two repository classes for two tables that
 * are only ever used together. */
export class D1GameCreatorRepository
  implements GameCreatorAccessRepository, GameCreatorApplicationRepository
{
  constructor(private db: D1Database) {}

  // ── GameCreatorAccessRepository ──────────────────────────────────────────

  async findByUserId(userId: number): Promise<GameCreatorAccessRecord | null> {
    const row = await this.db
      .prepare(`SELECT * FROM game_creator_access WHERE user_id = ?`)
      .bind(userId)
      .first<Record<string, unknown>>();
    return row ? mapAccessRow(row) : null;
  }

  async list(): Promise<GameCreatorAccessRecord[]> {
    const res = await this.db
      .prepare(`SELECT * FROM game_creator_access ORDER BY created_at ASC`)
      .all<Record<string, unknown>>();
    return (res.results || []).map(mapAccessRow);
  }

  async grant(
    userId: number,
    grantedByAdminId: number,
    nowIso: string,
  ): Promise<GameCreatorAccessRecord> {
    await this.db
      .prepare(
        `INSERT INTO game_creator_access (user_id, granted_by_admin_id, status, created_at, updated_at)
         VALUES (?, ?, 'ACTIVE', ?, ?)`,
      )
      .bind(userId, grantedByAdminId, nowIso, nowIso)
      .run();
    return {
      userId,
      grantedByAdminId,
      status: "ACTIVE",
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  }

  async setStatus(
    userId: number,
    status: GameCreatorAccessStatus,
    nowIso: string,
  ): Promise<GameCreatorAccessRecord> {
    await this.db
      .prepare(`UPDATE game_creator_access SET status = ?, updated_at = ? WHERE user_id = ?`)
      .bind(status, nowIso, userId)
      .run();
    const record = await this.findByUserId(userId);
    if (!record) throw new Error(`game_creator_access row for user ${userId} vanished mid-update`);
    return record;
  }

  async appendAudit(entry: {
    targetUserId: number;
    actorAdminId: number;
    action: GameCreatorAccessAuditAction;
    nowIso: string;
  }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO game_creator_access_audit_log (target_user_id, actor_admin_id, action, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(entry.targetUserId, entry.actorAdminId, entry.action, entry.nowIso)
      .run();
  }

  async listAudit(targetUserId: number, limit = 50): Promise<GameCreatorAccessAuditEntry[]> {
    const res = await this.db
      .prepare(
        `SELECT * FROM game_creator_access_audit_log WHERE target_user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .bind(targetUserId, limit)
      .all<Record<string, unknown>>();
    return (res.results || []).map(mapAccessAuditRow);
  }

  // ── GameCreatorApplicationRepository ─────────────────────────────────────

  async findById(id: number): Promise<GameCreatorApplicationRecord | null> {
    const row = await this.db
      .prepare(`SELECT * FROM game_creator_applications WHERE id = ?`)
      .bind(id)
      .first<Record<string, unknown>>();
    return row ? mapApplicationRow(row) : null;
  }

  async findLatestByUserId(userId: number): Promise<GameCreatorApplicationRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT * FROM game_creator_applications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
      )
      .bind(userId)
      .first<Record<string, unknown>>();
    return row ? mapApplicationRow(row) : null;
  }

  async create(
    userId: number,
    message: string | null,
    nowIso: string,
  ): Promise<GameCreatorApplicationRecord> {
    // RETURNING, not a follow-up SELECT by last_insert_rowid() — D1 shares one connection across
    // "concurrent" callers, so last_insert_rowid() can reflect a DIFFERENT caller's row under real
    // concurrency (see packages/db/src/d1/D1SandboxGameRepository.ts's header comment for the full
    // finding). This endpoint is guarded by the one-PENDING-per-user partial unique index, but
    // RETURNING is used everywhere new sandbox/Game Creator code is written regardless, since it's
    // simply the correct pattern rather than a targeted fix for one known-race table.
    const row = await this.db
      .prepare(
        `INSERT INTO game_creator_applications (user_id, status, message, created_at, updated_at)
         VALUES (?, 'PENDING', ?, ?, ?)
         RETURNING *`,
      )
      .bind(userId, message, nowIso, nowIso)
      .first<Record<string, unknown>>();
    if (!row) throw new Error("game_creator_applications insert did not return a row");
    return mapApplicationRow(row);
  }

  async listByStatus(
    status: GameCreatorApplicationStatus,
    limit: number,
    offset: number,
  ): Promise<{ items: GameCreatorApplicationRecord[]; total: number }> {
    const [itemsRes, totalRow] = await Promise.all([
      this.db
        .prepare(
          `SELECT * FROM game_creator_applications WHERE status = ?
           ORDER BY created_at ASC, id ASC LIMIT ? OFFSET ?`,
        )
        .bind(status, limit, offset)
        .all<Record<string, unknown>>(),
      this.db
        .prepare(`SELECT COUNT(*) AS total FROM game_creator_applications WHERE status = ?`)
        .bind(status)
        .first<{ total: number }>(),
    ]);
    return {
      items: (itemsRes.results || []).map(mapApplicationRow),
      total: Number(totalRow?.total ?? 0),
    };
  }

  async decide(input: {
    id: number;
    status: "APPROVED" | "REJECTED";
    reviewedByAdminId: number;
    rejectReason: string | null;
    nowIso: string;
  }): Promise<GameCreatorApplicationRecord | null> {
    // WHERE status = 'PENDING' makes this the atomic guard against a double-decide race (two
    // reviewers approving the same application) — RETURNING is empty iff the row didn't match
    // (already decided, or never existed), and the caller (GameCreatorUseCases) turns an empty
    // result into a specific domain failure rather than silently double-processing.
    const row = await this.db
      .prepare(
        `UPDATE game_creator_applications
         SET status = ?, reviewed_by_admin_id = ?, reviewed_at = ?, reject_reason = ?, updated_at = ?
         WHERE id = ? AND status = 'PENDING'
         RETURNING *`,
      )
      .bind(
        input.status,
        input.reviewedByAdminId,
        input.nowIso,
        input.rejectReason,
        input.nowIso,
        input.id,
      )
      .first<Record<string, unknown>>();
    return row ? mapApplicationRow(row) : null;
  }

  async withdraw(
    id: number,
    userId: number,
    nowIso: string,
  ): Promise<GameCreatorApplicationRecord | null> {
    // Same atomic-guard shape as decide(): WHERE user_id = ? AND status = 'PENDING' means a
    // withdraw request can only ever affect the caller's own still-pending application.
    const row = await this.db
      .prepare(
        `UPDATE game_creator_applications
         SET status = 'WITHDRAWN', updated_at = ?
         WHERE id = ? AND user_id = ? AND status = 'PENDING'
         RETURNING *`,
      )
      .bind(nowIso, id, userId)
      .first<Record<string, unknown>>();
    return row ? mapApplicationRow(row) : null;
  }
}
