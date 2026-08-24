import type {
  GameCreatorAccessStatus,
  GameCreatorAccessAuditAction,
  GameCreatorApplicationStatus,
} from "../domain/gameCreator.js";

export interface GameCreatorAccessRecord {
  userId: number;
  grantedByAdminId: number;
  status: GameCreatorAccessStatus;
  createdAt: string;
  updatedAt: string;
}

export interface GameCreatorAccessAuditEntry {
  id: number;
  targetUserId: number;
  actorAdminId: number;
  action: GameCreatorAccessAuditAction;
  createdAt: string;
}

/**
 * Persistence port for Game Creator upload-permission grants (migration 0024, table renamed by
 * migration 0025 — see that file's comment for why this is a pure rename, no data migration).
 * One row per user who has ever been granted upload access — a missing row means "never a
 * Game Creator", same as a REVOKED row means "was one, no longer".
 */
export interface GameCreatorAccessRepository {
  findByUserId(userId: number): Promise<GameCreatorAccessRecord | null>;
  list(): Promise<GameCreatorAccessRecord[]>;
  grant(userId: number, grantedByAdminId: number, nowIso: string): Promise<GameCreatorAccessRecord>;
  setStatus(
    userId: number,
    status: GameCreatorAccessStatus,
    nowIso: string,
  ): Promise<GameCreatorAccessRecord>;
  appendAudit(entry: {
    targetUserId: number;
    actorAdminId: number;
    action: GameCreatorAccessAuditAction;
    nowIso: string;
  }): Promise<void>;
  listAudit(targetUserId: number, limit: number): Promise<GameCreatorAccessAuditEntry[]>;
}

export interface GameCreatorApplicationRecord {
  id: number;
  userId: number;
  status: GameCreatorApplicationStatus;
  message: string | null;
  reviewedByAdminId: number | null;
  reviewedAt: string | null;
  rejectReason: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Persistence port for the self-serve "apply to become a Game Creator" flow (migration 0025).
 * Independent of {@link GameCreatorAccessRepository}'s admin-direct grant path — an application
 * being APPROVED is what triggers a grant() call in GameCreatorUseCases, not a DB trigger, so the
 * two tables can be reasoned about (and tested) separately.
 */
export interface GameCreatorApplicationRepository {
  findById(id: number): Promise<GameCreatorApplicationRecord | null>;
  /** The caller's own most recent application (any status) — used to render "당신의 신청은 現
   * 대기 중입니다" / "지난번에 거절되었습니다" style UI without a separate list endpoint. */
  findLatestByUserId(userId: number): Promise<GameCreatorApplicationRecord | null>;
  /** Relies on the partial unique index (one PENDING row per user) — a second create() call while
   * one is already PENDING must surface as a distinct, catchable conflict, not a generic DB error
   * leaking to the caller. Implementations should translate the constraint violation accordingly. */
  create(
    userId: number,
    message: string | null,
    nowIso: string,
  ): Promise<GameCreatorApplicationRecord>;
  listByStatus(
    status: GameCreatorApplicationStatus,
    limit: number,
    offset: number,
  ): Promise<{ items: GameCreatorApplicationRecord[]; total: number }>;
  /** Transitions a PENDING application to APPROVED or REJECTED. Returns null if the application
   * doesn't exist or isn't PENDING (caller maps that to a domain failure) rather than throwing, so
   * the "already decided" race is an ordinary control-flow branch. */
  decide(input: {
    id: number;
    status: "APPROVED" | "REJECTED";
    reviewedByAdminId: number;
    rejectReason: string | null;
    nowIso: string;
  }): Promise<GameCreatorApplicationRecord | null>;
  /** Withdraws the caller's own PENDING application. Returns null on the same "doesn't exist / not
   * PENDING / not owned by this user" conditions as {@link decide}. */
  withdraw(
    id: number,
    userId: number,
    nowIso: string,
  ): Promise<GameCreatorApplicationRecord | null>;
}
