import test from "node:test";
import assert from "node:assert/strict";
import {
  GameCreatorUseCases,
  GameCreatorUseCaseFailure,
} from "../src/application/gameCreatorUseCases.js";
import type {
  GameCreatorAccessRepository,
  GameCreatorAccessRecord,
  GameCreatorAccessAuditEntry,
  GameCreatorApplicationRepository,
  GameCreatorApplicationRecord,
} from "../src/ports/gameCreator.js";
import type { UserRepository, User } from "../src/ports/repositories.js";

function createFakeAccessRepo(): GameCreatorAccessRepository & {
  records: Map<number, GameCreatorAccessRecord>;
  audit: GameCreatorAccessAuditEntry[];
} {
  const records = new Map<number, GameCreatorAccessRecord>();
  const audit: GameCreatorAccessAuditEntry[] = [];
  let nextAuditId = 1;

  return {
    records,
    audit,
    async findByUserId(userId) {
      return records.get(userId) ?? null;
    },
    async list() {
      return [...records.values()];
    },
    async grant(userId, grantedByAdminId, nowIso) {
      const record: GameCreatorAccessRecord = {
        userId,
        grantedByAdminId,
        status: "ACTIVE",
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      records.set(userId, record);
      return record;
    },
    async setStatus(userId, status, nowIso) {
      const existing = records.get(userId);
      if (!existing) throw new Error("not found");
      const record = { ...existing, status, updatedAt: nowIso };
      records.set(userId, record);
      return record;
    },
    async appendAudit(entry) {
      audit.push({
        id: nextAuditId++,
        targetUserId: entry.targetUserId,
        actorAdminId: entry.actorAdminId,
        action: entry.action,
        createdAt: entry.nowIso,
      });
    },
    async listAudit(targetUserId) {
      return audit.filter((a) => a.targetUserId === targetUserId).reverse();
    },
  };
}

function createFakeApplicationRepo(): GameCreatorApplicationRepository & {
  rows: GameCreatorApplicationRecord[];
} {
  const rows: GameCreatorApplicationRecord[] = [];
  let nextId = 1;

  return {
    rows,
    async findById(id) {
      return rows.find((r) => r.id === id) ?? null;
    },
    async findLatestByUserId(userId) {
      const matches = rows.filter((r) => r.userId === userId);
      return matches.length ? matches[matches.length - 1]! : null;
    },
    async create(userId, message, nowIso) {
      // Mirrors the DB's partial-unique-index behavior for this fake, so use-case-level tests
      // exercise the same "second concurrent apply() fails" path the real repo enforces.
      if (rows.some((r) => r.userId === userId && r.status === "PENDING")) {
        throw new Error("UNIQUE constraint failed: game_creator_applications.user_id (PENDING)");
      }
      const record: GameCreatorApplicationRecord = {
        id: nextId++,
        userId,
        status: "PENDING",
        message,
        reviewedByAdminId: null,
        reviewedAt: null,
        rejectReason: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      rows.push(record);
      return record;
    },
    async listByStatus(status, limit, offset) {
      const items = rows.filter((r) => r.status === status);
      return { items: items.slice(offset, offset + limit), total: items.length };
    },
    async decide(input) {
      const row = rows.find((r) => r.id === input.id && r.status === "PENDING");
      if (!row) return null;
      row.status = input.status;
      row.reviewedByAdminId = input.reviewedByAdminId;
      row.reviewedAt = input.nowIso;
      row.rejectReason = input.rejectReason;
      row.updatedAt = input.nowIso;
      return { ...row };
    },
    async withdraw(id, userId, nowIso) {
      const row = rows.find((r) => r.id === id && r.userId === userId && r.status === "PENDING");
      if (!row) return null;
      row.status = "WITHDRAWN";
      row.updatedAt = nowIso;
      return { ...row };
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

// ── Admin-direct grant/revoke (unchanged since the game_developers days) ──────

test("grant rejects a nonexistent target user with USER_NOT_FOUND", async () => {
  const accessRepo = createFakeAccessRepo();
  const useCases = new GameCreatorUseCases(accessRepo, createFakeUserRepo([]));
  await assert.rejects(
    () => useCases.grant(1, 99),
    (err: unknown) => err instanceof GameCreatorUseCaseFailure && err.code === "USER_NOT_FOUND",
  );
});

test("grant writes a GRANTED audit entry on first grant, REINSTATED on a second grant after revoke", async () => {
  const accessRepo = createFakeAccessRepo();
  const useCases = new GameCreatorUseCases(accessRepo, createFakeUserRepo([1]));

  await useCases.grant(1, 99);
  assert.equal(accessRepo.audit.at(-1)?.action, "GRANTED");

  await useCases.revoke(1, 99);
  await useCases.grant(1, 99);
  assert.equal(accessRepo.audit.at(-1)?.action, "REINSTATED");
  assert.equal((await useCases.getByUserId(1))?.status, "ACTIVE");
});

test("grant on an already-ACTIVE creator is rejected with ALREADY_ACTIVE", async () => {
  const accessRepo = createFakeAccessRepo();
  const useCases = new GameCreatorUseCases(accessRepo, createFakeUserRepo([1]));
  await useCases.grant(1, 99);
  await assert.rejects(
    () => useCases.grant(1, 99),
    (err: unknown) => err instanceof GameCreatorUseCaseFailure && err.code === "ALREADY_ACTIVE",
  );
});

test("revoke on a never-granted or already-revoked user is rejected with NOT_A_CREATOR", async () => {
  const accessRepo = createFakeAccessRepo();
  const useCases = new GameCreatorUseCases(accessRepo, createFakeUserRepo([1]));
  await assert.rejects(
    () => useCases.revoke(1, 99),
    (err: unknown) => err instanceof GameCreatorUseCaseFailure && err.code === "NOT_A_CREATOR",
  );

  await useCases.grant(1, 99);
  await useCases.revoke(1, 99);
  await assert.rejects(
    () => useCases.revoke(1, 99),
    (err: unknown) => err instanceof GameCreatorUseCaseFailure && err.code === "NOT_A_CREATOR",
  );
});

test("isActiveGameCreator reflects grant/revoke state", async () => {
  const accessRepo = createFakeAccessRepo();
  const useCases = new GameCreatorUseCases(accessRepo, createFakeUserRepo([1]));
  assert.equal(await useCases.isActiveGameCreator(1), false);
  await useCases.grant(1, 99);
  assert.equal(await useCases.isActiveGameCreator(1), true);
  await useCases.revoke(1, 99);
  assert.equal(await useCases.isActiveGameCreator(1), false);
});

// ── Self-serve application flow ────────────────────────────────────────────

test("apply rejects a nonexistent user with USER_NOT_FOUND", async () => {
  const accessRepo = createFakeAccessRepo();
  const applicationRepo = createFakeApplicationRepo();
  const useCases = new GameCreatorUseCases(
    accessRepo,
    createFakeUserRepo([]),
    applicationRepo,
    () => true,
  );
  await assert.rejects(
    () => useCases.apply(1, null),
    (err: unknown) => err instanceof GameCreatorUseCaseFailure && err.code === "USER_NOT_FOUND",
  );
});

test("apply rejects a user who already has ACTIVE access with ALREADY_ACTIVE", async () => {
  const accessRepo = createFakeAccessRepo();
  const applicationRepo = createFakeApplicationRepo();
  const useCases = new GameCreatorUseCases(
    accessRepo,
    createFakeUserRepo([1]),
    applicationRepo,
    () => true,
  );
  await useCases.grant(1, 99);
  await assert.rejects(
    () => useCases.apply(1, null),
    (err: unknown) => err instanceof GameCreatorUseCaseFailure && err.code === "ALREADY_ACTIVE",
  );
});

test("apply creates a PENDING application; a second apply while one is PENDING is rejected", async () => {
  const accessRepo = createFakeAccessRepo();
  const applicationRepo = createFakeApplicationRepo();
  const useCases = new GameCreatorUseCases(
    accessRepo,
    createFakeUserRepo([1]),
    applicationRepo,
    () => true,
  );

  const application = await useCases.apply(1, "  저는 인디 게임 개발자입니다  ");
  assert.equal(application.status, "PENDING");
  assert.equal(application.message, "저는 인디 게임 개발자입니다"); // trimmed

  await assert.rejects(
    () => useCases.apply(1, null),
    (err: unknown) =>
      err instanceof GameCreatorUseCaseFailure && err.code === "APPLICATION_ALREADY_PENDING",
  );
});

test("apply is allowed again after a previous application was REJECTED or WITHDRAWN", async () => {
  const accessRepo = createFakeAccessRepo();
  const applicationRepo = createFakeApplicationRepo();
  const useCases = new GameCreatorUseCases(
    accessRepo,
    createFakeUserRepo([1, 2]),
    applicationRepo,
    () => true,
  );

  const first = await useCases.apply(1, null);
  await useCases.decideApplication({
    applicationId: first.id,
    reviewerAdminId: 99,
    decision: "REJECTED",
    rejectReason: "기준 미달",
  });
  const second = await useCases.apply(1, null);
  assert.equal(second.status, "PENDING");
  assert.notEqual(second.id, first.id);

  const third = await useCases.apply(2, null);
  const withdrawn = await useCases.withdrawApplication(third.id, 2);
  assert.equal(withdrawn.status, "WITHDRAWN");
  const fourth = await useCases.apply(2, null);
  assert.equal(fourth.status, "PENDING");
});

test("withdrawApplication only affects the caller's own PENDING application", async () => {
  const accessRepo = createFakeAccessRepo();
  const applicationRepo = createFakeApplicationRepo();
  const useCases = new GameCreatorUseCases(
    accessRepo,
    createFakeUserRepo([1, 2]),
    applicationRepo,
    () => true,
  );

  const application = await useCases.apply(1, null);

  // A different user's withdraw attempt does not affect user 1's application.
  await assert.rejects(
    () => useCases.withdrawApplication(application.id, 2),
    (err: unknown) =>
      err instanceof GameCreatorUseCaseFailure && err.code === "APPLICATION_NOT_FOUND",
  );
  assert.equal((await useCases.getMyApplication(1))?.status, "PENDING");

  const withdrawn = await useCases.withdrawApplication(application.id, 1);
  assert.equal(withdrawn.status, "WITHDRAWN");

  // Withdrawing an already-withdrawn application fails cleanly.
  await assert.rejects(
    () => useCases.withdrawApplication(application.id, 1),
    (err: unknown) =>
      err instanceof GameCreatorUseCaseFailure && err.code === "APPLICATION_NOT_FOUND",
  );
});

test("decideApplication(APPROVED) grants Game Creator access; REJECTED does not", async () => {
  const accessRepo = createFakeAccessRepo();
  const applicationRepo = createFakeApplicationRepo();
  const useCases = new GameCreatorUseCases(
    accessRepo,
    createFakeUserRepo([1, 2]),
    applicationRepo,
    () => true,
  );

  const approved = await useCases.apply(1, null);
  const decidedApproved = await useCases.decideApplication({
    applicationId: approved.id,
    reviewerAdminId: 99,
    decision: "APPROVED",
  });
  assert.equal(decidedApproved.status, "APPROVED");
  assert.equal(await useCases.isActiveGameCreator(1), true);

  const rejected = await useCases.apply(2, null);
  const decidedRejected = await useCases.decideApplication({
    applicationId: rejected.id,
    reviewerAdminId: 99,
    decision: "REJECTED",
    rejectReason: "부적절한 콘텐츠",
  });
  assert.equal(decidedRejected.status, "REJECTED");
  assert.equal(decidedRejected.rejectReason, "부적절한 콘텐츠");
  assert.equal(await useCases.isActiveGameCreator(2), false);
});

test("decideApplication on an already-decided application is rejected with APPLICATION_NOT_PENDING", async () => {
  const accessRepo = createFakeAccessRepo();
  const applicationRepo = createFakeApplicationRepo();
  const useCases = new GameCreatorUseCases(
    accessRepo,
    createFakeUserRepo([1]),
    applicationRepo,
    () => true,
  );

  const application = await useCases.apply(1, null);
  await useCases.decideApplication({
    applicationId: application.id,
    reviewerAdminId: 99,
    decision: "APPROVED",
  });

  await assert.rejects(
    () =>
      useCases.decideApplication({
        applicationId: application.id,
        reviewerAdminId: 99,
        decision: "REJECTED",
      }),
    (err: unknown) =>
      err instanceof GameCreatorUseCaseFailure && err.code === "APPLICATION_NOT_PENDING",
  );
});

test("decideApplication(APPROVED) is idempotent-safe when the applicant already separately received a direct admin grant", async () => {
  const accessRepo = createFakeAccessRepo();
  const applicationRepo = createFakeApplicationRepo();
  const useCases = new GameCreatorUseCases(
    accessRepo,
    createFakeUserRepo([1]),
    applicationRepo,
    () => true,
  );

  const application = await useCases.apply(1, null);
  // An admin grants access directly (e.g. an unrelated invite) while the application is still
  // pending — approving the application afterward must not throw ALREADY_ACTIVE back at the
  // reviewer; the desired end state (ACTIVE access) already holds either way.
  await useCases.grant(1, 42);

  const decided = await useCases.decideApplication({
    applicationId: application.id,
    reviewerAdminId: 99,
    decision: "APPROVED",
  });
  assert.equal(decided.status, "APPROVED");
  assert.equal(await useCases.isActiveGameCreator(1), true);
});

test("listPendingApplications only returns PENDING items, oldest first", async () => {
  const accessRepo = createFakeAccessRepo();
  const applicationRepo = createFakeApplicationRepo();
  const useCases = new GameCreatorUseCases(
    accessRepo,
    createFakeUserRepo([1, 2, 3]),
    applicationRepo,
    () => true,
  );

  const a = await useCases.apply(1, null);
  await useCases.apply(2, null);
  await useCases.decideApplication({
    applicationId: a.id,
    reviewerAdminId: 99,
    decision: "REJECTED",
  });
  await useCases.apply(3, null);

  const { items, total } = await useCases.listPendingApplications();
  assert.equal(total, 2);
  assert.deepEqual(
    items.map((i) => i.userId),
    [2, 3],
  );
});

test("apply(): with no canApply override, uses the real (currently closed) domain policy and rejects", async () => {
  const accessRepo = createFakeAccessRepo();
  const applicationRepo = createFakeApplicationRepo();
  // No 4th constructor arg — this is exactly how container.ts wires it in production.
  const useCases = new GameCreatorUseCases(accessRepo, createFakeUserRepo([1]), applicationRepo);

  await assert.rejects(
    () => useCases.apply(1, null),
    (err: unknown) =>
      err instanceof GameCreatorUseCaseFailure && err.code === "APPLICATION_NOT_ALLOWED",
  );
});
