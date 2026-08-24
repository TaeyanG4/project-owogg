import type {
  UserModerationRepository,
  UserModerationRecord,
  UserModerationAuditEntry,
  UserSuspensionDurationDays,
  AdminUserSearchOptions,
  AdminUserSearchPage,
  SessionRepository,
  UserRepository,
} from "../ports/repositories.js";

export type UserModerationUseCaseError =
  "USER_NOT_FOUND" | "REASON_REQUIRED" | "INVALID_SUSPENSION_DURATION";

export const USER_SUSPENSION_DURATION_DAYS = [7, 30, 180] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

export class UserModerationUseCaseFailure extends Error {
  constructor(public readonly code: UserModerationUseCaseError) {
    super(code);
  }
}

function requireReason(reason: string | null | undefined): string {
  const trimmed = (reason ?? "").trim();
  if (!trimmed) throw new UserModerationUseCaseFailure("REASON_REQUIRED");
  return trimmed;
}

/**
 * Orchestrates account-level moderation (suspend/ban — blocks login) and the independent
 * score-submission block/score-reset tools on top of UserModerationRepository. The one piece of
 * cross-cutting behavior that belongs here rather than in the repository: suspending or banning
 * a user also revokes their existing sessions immediately (SessionRepository), so an
 * already-logged-in browser is kicked out right away instead of only failing on its next
 * findSession call. Destructive/consequential actions (suspend, ban, score reset) require a
 * non-empty reason — enforced here, not at the DB layer, so it's one clear error path.
 */
export class UserModerationUseCases {
  constructor(
    private moderationRepo: UserModerationRepository,
    private sessionRepo: SessionRepository,
    private userRepo: UserRepository,
    private now: () => Date = () => new Date(),
  ) {}

  async searchUsers(options: AdminUserSearchOptions): Promise<AdminUserSearchPage> {
    return this.moderationRepo.searchUsers(options);
  }

  async getModeration(userId: number): Promise<UserModerationRecord | null> {
    return this.moderationRepo.getModeration(userId);
  }

  async getAuditLog(userId: number, limit?: number): Promise<UserModerationAuditEntry[]> {
    return this.moderationRepo.getAuditLog(userId, limit);
  }

  private async assertUserExists(userId: number): Promise<void> {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new UserModerationUseCaseFailure("USER_NOT_FOUND");
  }

  async suspendUser(
    userId: number,
    adminId: number,
    durationDays: UserSuspensionDurationDays,
    reason: string,
  ): Promise<UserModerationRecord> {
    await this.assertUserExists(userId);
    const trimmedReason = requireReason(reason);
    if (!(USER_SUSPENSION_DURATION_DAYS as readonly number[]).includes(durationDays)) {
      throw new UserModerationUseCaseFailure("INVALID_SUSPENSION_DURATION");
    }
    const suspendedUntil = new Date(this.now().getTime() + durationDays * DAY_MS).toISOString();

    const record = await this.moderationRepo.suspendUser(
      userId,
      adminId,
      suspendedUntil,
      durationDays,
      trimmedReason,
    );
    await this.sessionRepo.deleteAllSessionsForUser(userId);
    return record;
  }

  async banUser(userId: number, adminId: number, reason: string): Promise<UserModerationRecord> {
    await this.assertUserExists(userId);
    const trimmedReason = requireReason(reason);

    const record = await this.moderationRepo.banUser(userId, adminId, trimmedReason);
    await this.sessionRepo.deleteAllSessionsForUser(userId);
    return record;
  }

  /** Lifts a SUSPENDED or BANNED status back to ACTIVE ahead of a suspension's natural expiry.
   * Does not touch score_submission_blocked — that's a separate toggle an admin may still want
   * in effect after lifting a suspension/ban. */
  async unsuspendUser(userId: number, adminId: number): Promise<UserModerationRecord> {
    await this.assertUserExists(userId);
    return this.moderationRepo.unsuspendUser(userId, adminId);
  }

  async setScoreSubmissionBlocked(
    userId: number,
    adminId: number,
    blocked: boolean,
    reason: string | null,
  ): Promise<UserModerationRecord> {
    await this.assertUserExists(userId);
    const finalReason = blocked ? requireReason(reason) : (reason?.trim() ?? null);
    return this.moderationRepo.setScoreSubmissionBlocked(userId, adminId, blocked, finalReason);
  }

  async resetUserScores(
    userId: number,
    adminId: number,
    reason: string,
  ): Promise<{ affectedCount: number }> {
    await this.assertUserExists(userId);
    const trimmedReason = requireReason(reason);
    return this.moderationRepo.resetUserScores(userId, adminId, trimmedReason);
  }

  async restoreUserScores(userId: number, adminId: number): Promise<{ restoredCount: number }> {
    await this.assertUserExists(userId);
    return this.moderationRepo.restoreUserScores(userId, adminId);
  }
}
