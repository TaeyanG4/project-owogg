import {
  ADMIN_AUTH_POLICY,
  evaluateLoginRateLimit,
  type RateLimitDecision,
} from "../domain/adminAuth.js";
import type { AdminAuthRepository, AdminSessionRecord } from "../ports/adminAuth.js";

/**
 * Orchestrates the admin step-up authentication layer on top of ADMIN_USER_IDS eligibility.
 * ADMIN_USER_IDS itself is checked by the caller (route layer) before any of these methods run —
 * this class only concerns itself with the elevated proof (Google step-up + admin password +
 * short-lived admin session), never with root eligibility.
 */
export class AdminAuthUseCases {
  constructor(private repo: AdminAuthRepository) {}

  async beginStepUp(input: {
    userId: number;
    googleSub: string;
    rawSessionToken: string;
    now?: Date;
  }): Promise<{ rawToken: string }> {
    const now = input.now ?? new Date();
    const expiresAt = new Date(now.getTime() + ADMIN_AUTH_POLICY.STEP_UP_CHALLENGE_TTL_MS);
    return this.repo.createStepUpChallenge({
      userId: input.userId,
      googleSub: input.googleSub,
      rawSessionToken: input.rawSessionToken,
      nowIso: now.toISOString(),
      expiresAtIso: expiresAt.toISOString(),
    });
  }

  async checkRateLimit(userId: number, now?: Date): Promise<RateLimitDecision> {
    const nowDate = now ?? new Date();
    const sinceIso = new Date(
      nowDate.getTime() - ADMIN_AUTH_POLICY.LOGIN_RATE_LIMIT_WINDOW_MS,
    ).toISOString();
    const timestamps = await this.repo.listRecentFailedAttempts(userId, sinceIso);
    return evaluateLoginRateLimit(timestamps, nowDate.getTime());
  }

  /** Returns the step-up-verified googleSub on success. Also rejects if the challenge belongs
   * to a different userId than the currently authenticated session (defense in depth — should
   * already be guaranteed by the session-token binding). */
  async consumeStepUp(input: {
    rawToken: string | undefined;
    rawSessionToken: string;
    expectedUserId: number;
    now?: Date;
  }): Promise<{ googleSub: string } | null> {
    if (!input.rawToken) return null;
    const now = input.now ?? new Date();
    const consumed = await this.repo.consumeStepUpChallenge({
      rawToken: input.rawToken,
      rawSessionToken: input.rawSessionToken,
      nowIso: now.toISOString(),
    });
    if (!consumed || consumed.userId !== input.expectedUserId) return null;
    return { googleSub: consumed.googleSub };
  }

  async recordAttempt(userId: number, success: boolean, now?: Date): Promise<void> {
    await this.repo.recordLoginAttempt({
      userId,
      success,
      nowIso: (now ?? new Date()).toISOString(),
    });
  }

  async issueAdminSession(input: {
    userId: number;
    rawSessionToken: string;
    ttlMs?: number;
    now?: Date;
  }): Promise<{ rawToken: string; session: AdminSessionRecord }> {
    const now = input.now ?? new Date();
    const ttlMs = input.ttlMs ?? ADMIN_AUTH_POLICY.ADMIN_SESSION_TTL_MS;
    if (
      !Number.isSafeInteger(ttlMs) ||
      ttlMs <= 0 ||
      ttlMs > ADMIN_AUTH_POLICY.ADMIN_SESSION_MAX_TTL_MS
    ) {
      throw new RangeError("admin session ttl is outside the allowed policy range");
    }
    const expiresAt = new Date(now.getTime() + ttlMs);
    return this.repo.createAdminSession({
      userId: input.userId,
      rawSessionToken: input.rawSessionToken,
      nowIso: now.toISOString(),
      expiresAtIso: expiresAt.toISOString(),
    });
  }

  async validateAdminSession(input: {
    rawToken: string | undefined;
    rawSessionToken: string;
    now?: Date;
  }): Promise<AdminSessionRecord | null> {
    if (!input.rawToken) return null;
    const now = input.now ?? new Date();
    return this.repo.findValidAdminSession({
      rawToken: input.rawToken,
      rawSessionToken: input.rawSessionToken,
      nowIso: now.toISOString(),
    });
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    await this.repo.revokeAdminSession(rawToken);
  }

  /** Called from normal OwOGG logout so no admin session can outlive its underlying session. */
  async logoutAllForSession(rawSessionToken: string): Promise<void> {
    await this.repo.revokeAdminSessionsForSessionToken(rawSessionToken);
  }

  async cleanupExpired(now?: Date): Promise<void> {
    await this.repo.cleanupExpired((now ?? new Date()).toISOString());
  }
}
