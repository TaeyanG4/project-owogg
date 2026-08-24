import type {
  AdminAccountRepository,
  AdminAccountRecord,
  AdminAccountAuditEntry,
  AdminAccountRole,
  AdminAccountStatus,
  AdminAccountAuditAction,
  ConfigurableStaffRole,
  Permission,
} from "@owogg/core";
import type { D1Database } from "./D1UserRepository.js";

function mapAccountRow(r: Record<string, unknown>): AdminAccountRecord {
  return {
    id: Number(r.id),
    userId: Number(r.user_id),
    googleSub: String(r.google_sub),
    username: String(r.username),
    passwordHash: String(r.password_hash),
    role: r.role as AdminAccountRole,
    status: r.status as AdminAccountStatus,
    mustChangePassword: Number(r.must_change_password) === 1,
    createdByAdminId: r.created_by_admin_id === null ? null : Number(r.created_by_admin_id),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    passwordChangedAt: String(r.password_changed_at),
  };
}

function mapAuditRow(r: Record<string, unknown>): AdminAccountAuditEntry {
  let metadata: Record<string, unknown> | null = null;
  if (r.metadata_json) {
    try {
      metadata = JSON.parse(String(r.metadata_json));
    } catch {
      metadata = null;
    }
  }
  return {
    id: Number(r.id),
    actorAdminId: r.actor_admin_id === null ? null : Number(r.actor_admin_id),
    targetAdminId: r.target_admin_id === null ? null : Number(r.target_admin_id),
    action: r.action as AdminAccountAuditAction,
    metadata,
    createdAt: String(r.created_at),
  };
}

export class D1AdminAccountRepository implements AdminAccountRepository {
  constructor(private db: D1Database) {}

  async countActive(): Promise<number> {
    const row = await this.db
      .prepare(`SELECT COUNT(*) AS total FROM admin_accounts WHERE status = 'ACTIVE'`)
      .first<{ total: number }>();
    return Number(row?.total ?? 0);
  }

  async countActiveByRole(role: AdminAccountRole): Promise<number> {
    const row = await this.db
      .prepare(`SELECT COUNT(*) AS total FROM admin_accounts WHERE status = 'ACTIVE' AND role = ?`)
      .bind(role)
      .first<{ total: number }>();
    return Number(row?.total ?? 0);
  }

  async findById(id: number): Promise<AdminAccountRecord | null> {
    const row = await this.db
      .prepare(`SELECT * FROM admin_accounts WHERE id = ?`)
      .bind(id)
      .first<Record<string, unknown>>();
    return row ? mapAccountRow(row) : null;
  }

  async findByUserId(userId: number): Promise<AdminAccountRecord | null> {
    const row = await this.db
      .prepare(`SELECT * FROM admin_accounts WHERE user_id = ?`)
      .bind(userId)
      .first<Record<string, unknown>>();
    return row ? mapAccountRow(row) : null;
  }

  async findByUsername(username: string): Promise<AdminAccountRecord | null> {
    const row = await this.db
      .prepare(`SELECT * FROM admin_accounts WHERE username = ?`)
      .bind(username)
      .first<Record<string, unknown>>();
    return row ? mapAccountRow(row) : null;
  }

  async findByGoogleSub(googleSub: string): Promise<AdminAccountRecord | null> {
    const row = await this.db
      .prepare(`SELECT * FROM admin_accounts WHERE google_sub = ?`)
      .bind(googleSub)
      .first<Record<string, unknown>>();
    return row ? mapAccountRow(row) : null;
  }

  async list(): Promise<AdminAccountRecord[]> {
    const res = await this.db
      .prepare(`SELECT * FROM admin_accounts ORDER BY created_at ASC`)
      .all<Record<string, unknown>>();
    return (res.results || []).map(mapAccountRow);
  }

  async create(input: {
    userId: number;
    googleSub: string;
    username: string;
    passwordHash: string;
    role: AdminAccountRole;
    mustChangePassword: boolean;
    createdByAdminId: number | null;
    nowIso: string;
  }): Promise<AdminAccountRecord> {
    await this.db
      .prepare(
        `INSERT INTO admin_accounts
           (user_id, google_sub, username, password_hash, role, status, must_change_password,
            created_by_admin_id, created_at, updated_at, password_changed_at)
         VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.userId,
        input.googleSub,
        input.username,
        input.passwordHash,
        input.role,
        input.mustChangePassword ? 1 : 0,
        input.createdByAdminId,
        input.nowIso,
        input.nowIso,
        input.nowIso,
      )
      .run();

    const created = await this.db
      .prepare(`SELECT * FROM admin_accounts WHERE rowid = last_insert_rowid()`)
      .first<Record<string, unknown>>();
    if (!created) throw new Error("admin_accounts insert did not produce a readable row");
    return mapAccountRow(created);
  }

  async updateRole(id: number, role: AdminAccountRole, nowIso: string): Promise<void> {
    await this.db
      .prepare(`UPDATE admin_accounts SET role = ?, updated_at = ? WHERE id = ?`)
      .bind(role, nowIso, id)
      .run();
  }

  async updateStatus(id: number, status: AdminAccountStatus, nowIso: string): Promise<void> {
    await this.db
      .prepare(`UPDATE admin_accounts SET status = ?, updated_at = ? WHERE id = ?`)
      .bind(status, nowIso, id)
      .run();
  }

  async updatePassword(
    id: number,
    passwordHash: string,
    mustChangePassword: boolean,
    nowIso: string,
  ): Promise<void> {
    await this.db
      .prepare(
        `UPDATE admin_accounts
         SET password_hash = ?, must_change_password = ?, password_changed_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(passwordHash, mustChangePassword ? 1 : 0, nowIso, nowIso, id)
      .run();
  }

  async appendAudit(entry: {
    actorAdminId: number | null;
    targetAdminId: number | null;
    action: AdminAccountAuditAction;
    metadata: Record<string, unknown> | null;
    nowIso: string;
  }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO admin_account_audit_log
           (actor_admin_id, target_admin_id, action, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        entry.actorAdminId,
        entry.targetAdminId,
        entry.action,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
        entry.nowIso,
      )
      .run();
  }

  async listAudit(limit: number): Promise<AdminAccountAuditEntry[]> {
    // Secondary `id DESC` tiebreak — two audit rows can share the same millisecond timestamp
    // (e.g. two actions in the same request), and insertion order must still be preserved.
    const res = await this.db
      .prepare(`SELECT * FROM admin_account_audit_log ORDER BY created_at DESC, id DESC LIMIT ?`)
      .bind(limit)
      .all<Record<string, unknown>>();
    return (res.results || []).map(mapAuditRow);
  }

  async grantPermission(
    accountId: number,
    permission: Permission,
    grantedByAdminId: number,
    nowIso: string,
  ): Promise<void> {
    // INSERT OR IGNORE against UNIQUE(account_id, permission) — granting an already-granted
    // permission is an idempotent no-op, not a conflict the caller needs to special-case.
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO admin_permission_grants (account_id, permission, granted_by_admin_id, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(accountId, permission, grantedByAdminId, nowIso)
      .run();
  }

  async revokePermission(accountId: number, permission: Permission): Promise<void> {
    await this.db
      .prepare(`DELETE FROM admin_permission_grants WHERE account_id = ? AND permission = ?`)
      .bind(accountId, permission)
      .run();
  }

  async listPermissions(accountId: number): Promise<Permission[]> {
    const res = await this.db
      .prepare(`SELECT permission FROM admin_permission_grants WHERE account_id = ?`)
      .bind(accountId)
      .all<{ permission: string }>();
    return (res.results || []).map((r) => r.permission as Permission);
  }

  async listRolePermissions(role: ConfigurableStaffRole): Promise<Permission[]> {
    const res = await this.db
      .prepare(`SELECT permission FROM admin_role_permissions WHERE role = ? ORDER BY permission`)
      .bind(role)
      .all<{ permission: string }>();
    return (res.results || []).map((row) => row.permission as Permission);
  }

  async replaceRolePermissions(input: {
    role: ConfigurableStaffRole;
    permissions: readonly Permission[];
    grantedByAdminId: number;
    nowIso: string;
  }): Promise<void> {
    const statements = [
      this.db.prepare(`DELETE FROM admin_role_permissions WHERE role = ?`).bind(input.role),
      ...input.permissions.map((permission) =>
        this.db
          .prepare(
            `INSERT INTO admin_role_permissions
               (role, permission, granted_by_admin_id, updated_at)
             VALUES (?, ?, ?, ?)`,
          )
          .bind(input.role, permission, input.grantedByAdminId, input.nowIso),
      ),
    ];
    await this.db.batch(statements);
  }
}
