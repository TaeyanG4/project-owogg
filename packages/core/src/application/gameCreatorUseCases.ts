import { canApplyForGameCreator } from "../domain/gameCreator.js";
import type {
  GameCreatorAccessRepository,
  GameCreatorAccessRecord,
  GameCreatorAccessAuditEntry,
  GameCreatorApplicationRepository,
  GameCreatorApplicationRecord,
} from "../ports/gameCreator.js";
import type { UserRepository } from "../ports/repositories.js";

export type GameCreatorUseCaseError =
  | "USER_NOT_FOUND"
  | "ALREADY_ACTIVE"
  | "NOT_A_CREATOR"
  | "APPLICATION_NOT_ALLOWED"
  | "APPLICATION_ALREADY_PENDING"
  | "APPLICATION_NOT_FOUND"
  | "APPLICATION_NOT_PENDING";

export class GameCreatorUseCaseFailure extends Error {
  constructor(public readonly code: GameCreatorUseCaseError) {
    super(code);
  }
}

/**
 * Orchestrates Game Creator program access on top of GameCreatorAccessRepository (admin-direct
 * grant, unchanged since the game_developers days — see migration 0025's rename comment) plus the
 * new self-serve application flow on top of GameCreatorApplicationRepository. The two paths both
 * end at the same place: an ACTIVE row in GameCreatorAccessRepository. Approving an application
 * calls grant() internally rather than duplicating its logic.
 */
export class GameCreatorUseCases {
  constructor(
    private accessRepo: GameCreatorAccessRepository,
    private userRepo: UserRepository,
    private applicationRepo?: GameCreatorApplicationRepository,
    // Defaults to the real domain policy (currently closed, see canApplyForGameCreator's doc
    // comment) — injectable purely so tests can exercise apply()'s own mechanics (atomicity,
    // ALREADY_ACTIVE/APPLICATION_ALREADY_PENDING guards, decide/withdraw) independent of today's
    // open/closed toggle. Production wiring (container.ts) never overrides this.
    private canApply: () => boolean = canApplyForGameCreator,
  ) {}

  // ── Access (admin-direct grant/revoke — predates the application flow) ──────

  async getByUserId(userId: number): Promise<GameCreatorAccessRecord | null> {
    return this.accessRepo.findByUserId(userId);
  }

  async isActiveGameCreator(userId: number): Promise<boolean> {
    const record = await this.accessRepo.findByUserId(userId);
    return record?.status === "ACTIVE";
  }

  async list(): Promise<GameCreatorAccessRecord[]> {
    return this.accessRepo.list();
  }

  async grant(targetUserId: number, adminId: number): Promise<GameCreatorAccessRecord> {
    const user = await this.userRepo.findById(targetUserId);
    if (!user) throw new GameCreatorUseCaseFailure("USER_NOT_FOUND");

    const existing = await this.accessRepo.findByUserId(targetUserId);
    if (existing?.status === "ACTIVE") {
      throw new GameCreatorUseCaseFailure("ALREADY_ACTIVE");
    }

    const nowIso = new Date().toISOString();
    const record = existing
      ? await this.accessRepo.setStatus(targetUserId, "ACTIVE", nowIso)
      : await this.accessRepo.grant(targetUserId, adminId, nowIso);
    await this.accessRepo.appendAudit({
      targetUserId,
      actorAdminId: adminId,
      action: existing ? "REINSTATED" : "GRANTED",
      nowIso,
    });
    return record;
  }

  async revoke(targetUserId: number, adminId: number): Promise<GameCreatorAccessRecord> {
    const existing = await this.accessRepo.findByUserId(targetUserId);
    if (!existing || existing.status !== "ACTIVE") {
      throw new GameCreatorUseCaseFailure("NOT_A_CREATOR");
    }

    const nowIso = new Date().toISOString();
    const record = await this.accessRepo.setStatus(targetUserId, "REVOKED", nowIso);
    await this.accessRepo.appendAudit({
      targetUserId,
      actorAdminId: adminId,
      action: "REVOKED",
      nowIso,
    });
    return record;
  }

  async getAudit(targetUserId: number, limit = 50): Promise<GameCreatorAccessAuditEntry[]> {
    return this.accessRepo.listAudit(targetUserId, limit);
  }

  // ── Application (self-serve) ─────────────────────────────────────────────

  private requireApplicationRepo(): GameCreatorApplicationRepository {
    if (!this.applicationRepo) {
      throw new Error("GameCreatorUseCases constructed without an applicationRepo");
    }
    return this.applicationRepo;
  }

  /** The caller's own latest application (any status), or null if they've never applied. Used to
   * render "신청 대기 중" / "지난 신청이 거절됨: ..." UI without a separate admin-facing endpoint. */
  async getMyApplication(userId: number): Promise<GameCreatorApplicationRecord | null> {
    return this.requireApplicationRepo().findLatestByUserId(userId);
  }

  /**
   * Submits a Game Creator application. Rejects outright if the user already has ACTIVE access
   * (nothing to apply for) or already has a PENDING application (the DB's partial unique index is
   * the real backstop against a race here — see migration 0025 — this check just gives a faster,
   * friendlier failure on the common non-race path).
   */
  async apply(userId: number, message: string | null): Promise<GameCreatorApplicationRecord> {
    if (!this.canApply()) {
      throw new GameCreatorUseCaseFailure("APPLICATION_NOT_ALLOWED");
    }
    const user = await this.userRepo.findById(userId);
    if (!user) throw new GameCreatorUseCaseFailure("USER_NOT_FOUND");

    const existingAccess = await this.accessRepo.findByUserId(userId);
    if (existingAccess?.status === "ACTIVE") {
      throw new GameCreatorUseCaseFailure("ALREADY_ACTIVE");
    }

    const applicationRepo = this.requireApplicationRepo();
    const latest = await applicationRepo.findLatestByUserId(userId);
    if (latest?.status === "PENDING") {
      throw new GameCreatorUseCaseFailure("APPLICATION_ALREADY_PENDING");
    }

    const nowIso = new Date().toISOString();
    const trimmed = message?.trim();
    try {
      return await applicationRepo.create(userId, trimmed ? trimmed : null, nowIso);
    } catch (err) {
      // The partial unique index is the authoritative guard against a genuinely concurrent
      // double-submit that the check above can't catch — translate its constraint violation into
      // the same domain failure as the non-race path so callers never see a raw DB error.
      throw err instanceof Error && /UNIQUE/i.test(err.message)
        ? new GameCreatorUseCaseFailure("APPLICATION_ALREADY_PENDING")
        : err;
    }
  }

  /** Withdraws the caller's own PENDING application — no-ops nothing, throws a specific failure so
   * the UI can distinguish "already decided" from "never applied". */
  async withdrawApplication(
    applicationId: number,
    userId: number,
  ): Promise<GameCreatorApplicationRecord> {
    const nowIso = new Date().toISOString();
    const result = await this.requireApplicationRepo().withdraw(applicationId, userId, nowIso);
    if (!result) throw new GameCreatorUseCaseFailure("APPLICATION_NOT_FOUND");
    return result;
  }

  /** Admin/operator review queue — PENDING applications only; the review UI doesn't need to see
   * already-decided history in the primary queue view. */
  async listPendingApplications(
    limit = 20,
    offset = 0,
  ): Promise<{ items: GameCreatorApplicationRecord[]; total: number }> {
    return this.requireApplicationRepo().listByStatus("PENDING", limit, offset);
  }

  /**
   * Approves or rejects a PENDING application. Approval also grants Game Creator access
   * (delegates to {@link grant}, so the audit trail and "already active" handling stay in one
   * place) — a rejected application never touches GameCreatorAccessRepository at all.
   */
  async decideApplication(input: {
    applicationId: number;
    reviewerAdminId: number;
    decision: "APPROVED" | "REJECTED";
    rejectReason?: string | null;
  }): Promise<GameCreatorApplicationRecord> {
    const applicationRepo = this.requireApplicationRepo();
    const application = await applicationRepo.findById(input.applicationId);
    if (!application) throw new GameCreatorUseCaseFailure("APPLICATION_NOT_FOUND");
    if (application.status !== "PENDING") {
      throw new GameCreatorUseCaseFailure("APPLICATION_NOT_PENDING");
    }

    const nowIso = new Date().toISOString();
    const decided = await applicationRepo.decide({
      id: input.applicationId,
      status: input.decision,
      reviewedByAdminId: input.reviewerAdminId,
      rejectReason: input.decision === "REJECTED" ? (input.rejectReason?.trim() ?? null) : null,
      nowIso,
    });
    if (!decided) throw new GameCreatorUseCaseFailure("APPLICATION_NOT_PENDING");

    if (input.decision === "APPROVED") {
      try {
        await this.grant(application.userId, input.reviewerAdminId);
      } catch (err) {
        // ALREADY_ACTIVE here means the applicant separately received a direct admin grant while
        // their application was pending — not an error worth failing the approval over, since the
        // desired end state (ACTIVE access) already holds.
        if (!(err instanceof GameCreatorUseCaseFailure && err.code === "ALREADY_ACTIVE")) throw err;
      }
    }

    return decided;
  }
}
