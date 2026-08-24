import test from "node:test";
import assert from "node:assert/strict";
import {
  UserModerationUseCases,
  UserModerationUseCaseFailure,
} from "../src/application/userModerationUseCases.js";
import type {
  UserModerationRepository,
  UserModerationRecord,
  SessionRepository,
  UserRepository,
  User,
} from "../src/ports/repositories.js";

// Minimal in-memory fakes — this suite exercises the *application-level invariants* (reason
// required, duration must be one of the approved presets, unknown-user rejection, and the
// suspend/ban → session-revocation side effect), not SQL — see
// packages/db/test/D1UserModerationRepository.test.ts for the real-SQLite coverage.

function createFakeModerationRepo(): UserModerationRepository & {
  records: Map<number, UserModerationRecord>;
} {
  const records = new Map<number, UserModerationRecord>();
  const clean = (userId: number): UserModerationRecord => ({
    userId,
    status: "ACTIVE",
    suspendedUntil: null,
    scoreSubmissionBlocked: false,
    reason: null,
    updatedByAdminId: null,
    updatedAt: new Date().toISOString(),
  });

  return {
    records,
    async searchUsers() {
      return { users: [], total: 0 };
    },
    async getModeration(userId) {
      return records.get(userId) ?? null;
    },
    async suspendUser(userId, adminId, suspendedUntil, _durationDays, reason) {
      const record: UserModerationRecord = {
        userId,
        status: "SUSPENDED",
        suspendedUntil,
        scoreSubmissionBlocked: records.get(userId)?.scoreSubmissionBlocked ?? false,
        reason,
        updatedByAdminId: adminId,
        updatedAt: new Date().toISOString(),
      };
      records.set(userId, record);
      return record;
    },
    async banUser(userId, adminId, reason) {
      const record: UserModerationRecord = {
        userId,
        status: "BANNED",
        suspendedUntil: null,
        scoreSubmissionBlocked: records.get(userId)?.scoreSubmissionBlocked ?? false,
        reason,
        updatedByAdminId: adminId,
        updatedAt: new Date().toISOString(),
      };
      records.set(userId, record);
      return record;
    },
    async unsuspendUser(userId, adminId) {
      const existing = records.get(userId) ?? clean(userId);
      const record: UserModerationRecord = {
        ...clean(userId),
        scoreSubmissionBlocked: existing.scoreSubmissionBlocked,
        updatedByAdminId: adminId,
      };
      records.set(userId, record);
      return record;
    },
    async setScoreSubmissionBlocked(userId, adminId, blocked, reason) {
      const existing = records.get(userId) ?? clean(userId);
      const record: UserModerationRecord = {
        ...existing,
        scoreSubmissionBlocked: blocked,
        reason,
        updatedByAdminId: adminId,
        updatedAt: new Date().toISOString(),
      };
      records.set(userId, record);
      return record;
    },
    async resetUserScores() {
      return { affectedCount: 3 };
    },
    async restoreUserScores() {
      return { restoredCount: 3 };
    },
    async getAuditLog() {
      return [];
    },
  };
}

function createFakeSessionRepo(): SessionRepository & { revokedUserIds: number[] } {
  const revokedUserIds: number[] = [];
  return {
    revokedUserIds,
    async createSession() {
      throw new Error("not used in this suite");
    },
    async findSession() {
      return null;
    },
    async deleteSession() {},
    async deleteAllSessionsForUser(userId) {
      revokedUserIds.push(userId);
    },
  };
}

function createFakeUserRepo(existingIds: number[]): UserRepository {
  const users = new Map<number, User>(
    existingIds.map((id) => [
      id,
      {
        id,
        nickname: `user-${id}`,
        email: null,
        avatar_url: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]),
  );
  return {
    async findById(id) {
      return users.get(id) ?? null;
    },
    async findByOAuth() {
      return null;
    },
    async findOrCreateUser() {
      throw new Error("not used in this suite");
    },
    async getOAuthAccounts() {
      return [];
    },
    async findOAuthAccount() {
      return null;
    },
    async linkOAuthAccount() {},
    async unlinkOAuthAccount() {},
    async updateAvatarPreference() {
      throw new Error("not used in this suite");
    },
    async updateNickname() {
      throw new Error("not used in this suite");
    },
    async updateCountry() {
      throw new Error("not used in this suite");
    },
    async updateLocale() {
      throw new Error("not used in this suite");
    },
    async updateVisibility() {
      throw new Error("not used in this suite");
    },
  };
}

function createUseCases(existingUserIds: number[], now = new Date("2026-08-24T00:00:00.000Z")) {
  const moderationRepo = createFakeModerationRepo();
  const sessionRepo = createFakeSessionRepo();
  const userRepo = createFakeUserRepo(existingUserIds);
  const useCases = new UserModerationUseCases(moderationRepo, sessionRepo, userRepo, () => now);
  return { useCases, moderationRepo, sessionRepo, userRepo };
}

test("suspendUser rejects an unknown user with USER_NOT_FOUND", async () => {
  const { useCases } = createUseCases([]);
  await assert.rejects(
    () => useCases.suspendUser(1, 99, 7, "abuse"),
    (err: unknown) => err instanceof UserModerationUseCaseFailure && err.code === "USER_NOT_FOUND",
  );
});

test("suspendUser rejects an empty/whitespace-only reason", async () => {
  const { useCases } = createUseCases([1]);
  await assert.rejects(
    () => useCases.suspendUser(1, 99, 7, "   "),
    (err: unknown) => err instanceof UserModerationUseCaseFailure && err.code === "REASON_REQUIRED",
  );
});

test("suspendUser rejects a duration outside the 7/30/180-day policy", async () => {
  const { useCases } = createUseCases([1]);
  await assert.rejects(
    () => useCases.suspendUser(1, 99, 1 as 7, "abuse"),
    (err: unknown) =>
      err instanceof UserModerationUseCaseFailure && err.code === "INVALID_SUSPENSION_DURATION",
  );
});

test("suspendUser calculates the expiry on the server for every approved duration", async () => {
  const now = new Date("2026-08-24T00:00:00.000Z");
  for (const durationDays of [7, 30, 180] as const) {
    const { useCases } = createUseCases([1], now);
    const record = await useCases.suspendUser(1, 99, durationDays, "policy violation");
    assert.equal(
      record.suspendedUntil,
      new Date(now.getTime() + durationDays * 86_400_000).toISOString(),
    );
  }
});

test("suspendUser and banUser both revoke the user's existing sessions", async () => {
  const { useCases, sessionRepo } = createUseCases([1, 2]);
  await useCases.suspendUser(1, 99, 7, "abuse");
  await useCases.banUser(2, 99, "cheating");

  assert.deepEqual(sessionRepo.revokedUserIds, [1, 2]);
});

test("unsuspendUser and setScoreSubmissionBlocked do NOT revoke sessions (not a lockout)", async () => {
  const { useCases, sessionRepo } = createUseCases([1]);
  await useCases.unsuspendUser(1, 99);
  await useCases.setScoreSubmissionBlocked(1, 99, true, "suspicious");

  assert.deepEqual(sessionRepo.revokedUserIds, []);
});

test("setScoreSubmissionBlocked requires a reason only when blocking, not when unblocking", async () => {
  const { useCases } = createUseCases([1]);
  await assert.rejects(
    () => useCases.setScoreSubmissionBlocked(1, 99, true, null),
    (err: unknown) => err instanceof UserModerationUseCaseFailure && err.code === "REASON_REQUIRED",
  );

  // Unblocking with no reason must succeed.
  const record = await useCases.setScoreSubmissionBlocked(1, 99, false, null);
  assert.equal(record.scoreSubmissionBlocked, false);
});

test("resetUserScores requires a non-empty reason", async () => {
  const { useCases } = createUseCases([1]);
  await assert.rejects(
    () => useCases.resetUserScores(1, 99, ""),
    (err: unknown) => err instanceof UserModerationUseCaseFailure && err.code === "REASON_REQUIRED",
  );

  const result = await useCases.resetUserScores(1, 99, "confirmed cheating");
  assert.equal(result.affectedCount, 3);
});
