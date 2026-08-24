import test from "node:test";
import assert from "node:assert/strict";
import {
  AccountMergeUseCases,
  type AccountMergeRepository,
  type AdminAccountRepository,
  type AdminAccountRecord,
  type MergeChallenge,
  type MergePreview,
  type OAuthAccount,
  type User,
  type UserRepository,
} from "../src/index.js";

interface ScoreRow {
  userId: number;
  gameId: string;
}

class FixtureState {
  users = new Map<number, User>();
  oauth = new Map<string, OAuthAccount>();
  scores: ScoreRow[] = [];
  favorites = new Map<number, Set<string>>();
  recentPlays = new Map<number, Map<string, string>>();
  xpEvents: { id: number; userId: number }[] = [];
  progress = new Map<number, { totalXp: number; eligibleCompletions: number }>();
  achievements = new Map<number, Set<string>>();
  streamerConflict = false;
  streamerProfileOwner: number | null = null;
  streamerSettings = new Map<number, string>();
  streamerReviewJobAccountIds: number[] = [];
  streamerAuditAccountIds: number[] = [];
  guildManagers: { guildId: string; userId: number }[] = [];
  guildOwners: { guildId: string; userId: number }[] = [];
  guildXpEvents: { guildId: string; userId: number; sourceXpEventId: number }[] = [];
  playContexts: { discordUserId: string; userId: number }[] = [];
  sessionUser = new Map<string, number>();
  challenges = new Map<string, MergeChallenge>();
  nextId = 1;
  failMerge = false;
  /** userId -> admin account status, for the merge-blocks-when-Secondary-is-admin invariant. */
  adminAccounts = new Map<number, "ACTIVE" | "DISABLED">();
}

/** Minimal fixture — only `findByUserId` is needed by AccountMergeUseCases. */
class FixtureAdminAccountRepo implements Pick<AdminAccountRepository, "findByUserId"> {
  constructor(private s: FixtureState) {}
  async findByUserId(userId: number): Promise<AdminAccountRecord | null> {
    const status = this.s.adminAccounts.get(userId);
    if (!status) return null;
    return {
      id: userId,
      userId,
      googleSub: `sub-${userId}`,
      username: `admin-${userId}`,
      passwordHash: "hash",
      role: "ADMIN",
      status,
      mustChangePassword: false,
      createdByAdminId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      passwordChangedAt: new Date().toISOString(),
    };
  }
}

class FixtureUserRepo implements UserRepository {
  constructor(private s: FixtureState) {}
  async findById(id: number): Promise<User | null> {
    return this.s.users.get(id) ?? null;
  }
  async findByOAuth(): Promise<User | null> {
    return null;
  }
  async findOrCreateUser(data: {
    provider: string;
    providerUserId: string;
    email: string | null;
    nickname: string;
    avatarUrl: string | null;
  }): Promise<User> {
    const id = this.s.nextId++;
    const user: User = {
      id,
      nickname: data.nickname,
      email: data.email,
      avatar_url: data.avatarUrl,
      avatar_provider: data.provider,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      providers: [data.provider],
    };
    this.s.users.set(id, user);
    this.s.oauth.set(`${data.provider}:${data.providerUserId}`, {
      id: this.s.nextId,
      user_id: id,
      provider: data.provider,
      provider_user_id: data.providerUserId,
      provider_email: data.email,
      avatar_url: data.avatarUrl,
      created_at: new Date().toISOString(),
    });
    return user;
  }
  async getOAuthAccounts(userId: number): Promise<OAuthAccount[]> {
    return Array.from(this.s.oauth.values()).filter((a) => a.user_id === userId);
  }
  async findOAuthAccount(provider: string, providerUserId: string): Promise<OAuthAccount | null> {
    return this.s.oauth.get(`${provider}:${providerUserId}`) ?? null;
  }
  async linkOAuthAccount(
    userId: number,
    provider: string,
    providerUserId: string,
    providerEmail: string | null,
    avatarUrl: string | null,
  ): Promise<void> {
    this.s.oauth.set(`${provider}:${providerUserId}`, {
      id: this.s.nextId,
      user_id: userId,
      provider,
      provider_user_id: providerUserId,
      provider_email: providerEmail,
      avatar_url: avatarUrl,
      created_at: new Date().toISOString(),
    });
  }
  async unlinkOAuthAccount(userId: number, provider: string): Promise<void> {
    for (const [key, acc] of this.s.oauth.entries()) {
      if (acc.user_id === userId && acc.provider === provider) {
        this.s.oauth.delete(key);
      }
    }
  }
  async updateAvatarPreference(
    userId: number,
    provider: string,
    avatarUrl: string,
    updatedAt: string,
  ): Promise<User> {
    const user = this.s.users.get(userId);
    if (!user) throw new Error("user not found");
    const updated = {
      ...user,
      avatar_provider: provider,
      avatar_url: avatarUrl,
      updated_at: updatedAt,
    };
    this.s.users.set(userId, updated);
    return updated;
  }
}

class FixtureMergeRepo implements AccountMergeRepository {
  constructor(private s: FixtureState) {}
  async getAccountMergePreview(userId: number): Promise<MergePreview> {
    const user = this.s.users.get(userId);
    const firstOauth = Array.from(this.s.oauth.values()).find((a) => a.user_id === userId);
    return {
      userId,
      nickname: user?.nickname ?? "알 수 없음",
      provider: firstOauth?.provider ?? "",
      createdAt: user?.created_at ?? "",
      scoreCount: this.s.scores.filter((sc) => sc.userId === userId).length,
      favoriteCount: this.s.favorites.get(userId)?.size ?? 0,
      recentPlayCount: this.s.recentPlays.get(userId)?.size ?? 0,
    };
  }
  async createMergeChallenge(input: {
    userA: number;
    userB: number;
    provider: string;
    providerUserId: string;
    ttlSeconds: number;
  }): Promise<{ id: string; expiresAt: string }> {
    const id = `ch-${this.s.nextId++}`;
    const challenge: MergeChallenge = {
      id,
      userA: input.userA,
      userB: input.userB,
      provider: input.provider,
      providerUserId: input.providerUserId,
      expiresAt: new Date(Date.now() + input.ttlSeconds * 1000).toISOString(),
      consumedAt: null,
    };
    this.s.challenges.set(id, challenge);
    return { id, expiresAt: challenge.expiresAt };
  }
  async findMergeChallenge(id: string): Promise<MergeChallenge | null> {
    return this.s.challenges.get(id) ?? null;
  }
  async findPendingMergeChallenge(userA: number, userB: number): Promise<MergeChallenge | null> {
    for (const ch of this.s.challenges.values()) {
      if (
        ch.consumedAt === null &&
        ((ch.userA === userA && ch.userB === userB) || (ch.userA === userB && ch.userB === userA))
      ) {
        return ch;
      }
    }
    return null;
  }
  async findMergeIntegrityConflict(): Promise<"STREAMER_PLATFORM_CONFLICT" | null> {
    return this.s.streamerConflict ? "STREAMER_PLATFORM_CONFLICT" : null;
  }
  async consumeMergeChallenge(id: string): Promise<void> {
    const ch = this.s.challenges.get(id);
    if (ch) this.s.challenges.set(id, { ...ch, consumedAt: new Date().toISOString() });
  }
  async mergeAccounts(primaryId: number, secondaryId: number, challengeId: string): Promise<void> {
    if (this.s.failMerge) {
      throw new Error("forced merge failure");
    }
    // 1. delete secondary gameplay/personalization/sessions
    this.s.scores = this.s.scores.filter((sc) => sc.userId !== secondaryId);
    this.s.favorites.delete(secondaryId);
    this.s.recentPlays.delete(secondaryId);
    const secondaryXpEventIds = new Set(
      this.s.xpEvents.filter((event) => event.userId === secondaryId).map((event) => event.id),
    );
    this.s.guildXpEvents = this.s.guildXpEvents.filter(
      (event) => event.userId !== secondaryId && !secondaryXpEventIds.has(event.sourceXpEventId),
    );
    this.s.xpEvents = this.s.xpEvents.filter((event) => event.userId !== secondaryId);
    this.s.progress.delete(secondaryId);
    this.s.achievements.delete(secondaryId);
    for (const [token, uid] of Array.from(this.s.sessionUser.entries())) {
      if (uid === secondaryId) this.s.sessionUser.delete(token);
    }
    for (const manager of this.s.guildManagers) {
      if (manager.userId === secondaryId) manager.userId = primaryId;
    }
    for (const owner of this.s.guildOwners) {
      if (owner.userId === secondaryId) owner.userId = primaryId;
    }
    for (const context of this.s.playContexts) {
      if (context.userId === secondaryId) context.userId = primaryId;
    }
    if (this.s.streamerProfileOwner === secondaryId) this.s.streamerProfileOwner = primaryId;
    if (!this.s.streamerSettings.has(primaryId) && this.s.streamerSettings.has(secondaryId)) {
      this.s.streamerSettings.set(primaryId, this.s.streamerSettings.get(secondaryId)!);
    }
    this.s.streamerSettings.delete(secondaryId);
    this.s.streamerReviewJobAccountIds = this.s.streamerReviewJobAccountIds.filter(
      (accountId) => accountId > 0,
    );
    // 2. move secondary oauth_accounts to primary
    for (const acc of this.s.oauth.values()) {
      if (acc.user_id === secondaryId) acc.user_id = primaryId;
    }
    // 3. delete secondary user
    this.s.users.delete(secondaryId);
    await this.consumeMergeChallenge(challengeId);
  }
}

async function setupTwoAccounts(): Promise<{
  state: FixtureState;
  userRepo: FixtureUserRepo;
  mergeRepo: FixtureMergeRepo;
  useCases: AccountMergeUseCases;
  userA: User;
  userB: User;
  challengeId: string;
}> {
  const state = new FixtureState();
  const userRepo = new FixtureUserRepo(state);
  const mergeRepo = new FixtureMergeRepo(state);
  const adminAccountRepo = new FixtureAdminAccountRepo(state);
  const useCases = new AccountMergeUseCases(mergeRepo, userRepo, adminAccountRepo);

  const userA = await userRepo.findOrCreateUser({
    provider: "google",
    providerUserId: "google-sub-A",
    email: "a@example.com",
    nickname: "Alpha",
    avatarUrl: null,
  });
  const userB = await userRepo.findOrCreateUser({
    provider: "discord",
    providerUserId: "discord-id-B",
    email: "b@example.com",
    nickname: "Bravo",
    avatarUrl: null,
  });

  // Seed data for A
  state.scores.push({ userId: userA.id, gameId: "reaction-time" });
  state.favorites.set(userA.id, new Set(["aim-test"]));
  state.recentPlays.set(userA.id, new Map([["memory-test", "2026-08-13T00:00:00Z"]]));
  state.sessionUser.set("sess-A", userA.id);
  state.xpEvents.push({ id: 100, userId: userA.id });
  state.progress.set(userA.id, { totalXp: 10, eligibleCompletions: 1 });
  state.achievements.set(userA.id, new Set(["FIRST_PLAY"]));
  state.guildXpEvents.push({ guildId: "guild-a", userId: userA.id, sourceXpEventId: 100 });
  state.guildManagers.push({ guildId: "guild-a", userId: userA.id });

  // Seed data for B
  state.scores.push({ userId: userB.id, gameId: "typing-test" });
  state.favorites.set(userB.id, new Set(["reaction-time"]));
  state.recentPlays.set(userB.id, new Map([["aim-test", "2026-08-13T00:00:00Z"]]));
  state.sessionUser.set("sess-B", userB.id);
  state.xpEvents.push({ id: 200, userId: userB.id });
  state.progress.set(userB.id, { totalXp: 500, eligibleCompletions: 50 });
  state.achievements.set(userB.id, new Set(["PLAY_10", "LEVEL_5"]));
  state.guildXpEvents.push({ guildId: "guild-a", userId: userB.id, sourceXpEventId: 200 });
  state.guildXpEvents.push({ guildId: "guild-b", userId: userB.id, sourceXpEventId: 200 });
  state.guildManagers.push({ guildId: "guild-b", userId: userB.id });
  state.guildOwners.push({ guildId: "guild-b", userId: userB.id });
  state.playContexts.push({ discordUserId: "discord-id-B", userId: userB.id });

  const challenge = await mergeRepo.createMergeChallenge({
    userA: userA.id,
    userB: userB.id,
    provider: "discord",
    providerUserId: "discord-id-B",
    ttlSeconds: 600,
  });

  return {
    state,
    userRepo,
    mergeRepo,
    useCases,
    userA,
    userB,
    challengeId: challenge.id,
  };
}

test("confirmMerge keeping A keeps A data, deletes B data and transfers B provider to A", async () => {
  const { state, useCases, userA, userB, challengeId } = await setupTwoAccounts();

  const result = await useCases.confirmMerge(challengeId, userA.id, userA.id);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.primaryId, userA.id);
  assert.equal(result.secondaryId, userB.id);

  // A user remains, B user deleted
  assert.ok(state.users.has(userA.id));
  assert.equal(state.users.has(userB.id), false);

  // A scores/favorites/recent remain
  assert.equal(
    state.scores.some((s) => s.userId === userA.id),
    true,
  );
  assert.ok(state.favorites.get(userA.id));
  assert.ok(state.recentPlays.get(userA.id));

  // B scores/favorites/recent and sessions deleted
  assert.equal(
    state.scores.some((s) => s.userId === userB.id),
    false,
  );
  assert.equal(state.favorites.has(userB.id), false);
  assert.equal(state.recentPlays.has(userB.id), false);
  assert.equal(state.sessionUser.has("sess-B"), false);
  // A current session preserved
  assert.equal(state.sessionUser.has("sess-A"), true);

  // Primary XP/progression/achievement totals remain unchanged. Secondary XP is deleted,
  // and both Guild XP rows derived from it disappear instead of becoming ghost activity.
  assert.deepEqual(state.progress.get(userA.id), { totalXp: 10, eligibleCompletions: 1 });
  assert.equal(state.progress.has(userB.id), false);
  assert.deepEqual(state.achievements.get(userA.id), new Set(["FIRST_PLAY"]));
  assert.equal(state.achievements.has(userB.id), false);
  assert.deepEqual(state.guildXpEvents, [
    { guildId: "guild-a", userId: userA.id, sourceXpEventId: 100 },
  ]);
  assert.deepEqual(state.guildManagers, [
    { guildId: "guild-a", userId: userA.id },
    { guildId: "guild-b", userId: userA.id },
  ]);
  assert.deepEqual(state.guildOwners, [{ guildId: "guild-b", userId: userA.id }]);
  assert.deepEqual(state.playContexts, [{ discordUserId: "discord-id-B", userId: userA.id }]);

  // B provider (discord) transferred to A
  const aAccounts = await useCases.findPendingMergeChallenge(userA.id, userB.id);
  void aAccounts;
  const oauthAccounts = Array.from(state.oauth.values()).filter((o) => o.user_id === userA.id);
  const providers = oauthAccounts.map((o) => o.provider).sort();
  assert.deepEqual(providers, ["discord", "google"]);
});

test("confirmMerge keeping B (reverse) keeps B data and deletes A data", async () => {
  const { state, useCases, userA, userB, challengeId } = await setupTwoAccounts();

  const result = await useCases.confirmMerge(challengeId, userB.id, userA.id);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.primaryId, userB.id);
  assert.equal(result.secondaryId, userA.id);

  // B remains, A deleted
  assert.ok(state.users.has(userB.id));
  assert.equal(state.users.has(userA.id), false);

  // B data remain
  assert.equal(
    state.scores.some((s) => s.userId === userB.id),
    true,
  );
  assert.ok(state.recentPlays.get(userB.id));
  // A data deleted
  assert.equal(
    state.scores.some((s) => s.userId === userA.id),
    false,
  );
  assert.equal(state.favorites.has(userA.id), false);
  assert.equal(state.progress.has(userA.id), false);
  assert.deepEqual(state.progress.get(userB.id), { totalXp: 500, eligibleCompletions: 50 });

  // A session (current) invalidated; B session preserved
  assert.equal(state.sessionUser.has("sess-A"), false);
  assert.equal(state.sessionUser.has("sess-B"), true);

  // A provider (google) transferred to B, which already has discord
  const providers = Array.from(state.oauth.values())
    .filter((o) => o.user_id === userB.id)
    .map((o) => o.provider)
    .sort();
  assert.deepEqual(providers, ["discord", "google"]);
});

test("conflicting Streamer platform ownership blocks merge before destructive work", async () => {
  const { state, useCases, userA, userB, challengeId } = await setupTwoAccounts();
  state.streamerConflict = true;

  const result = await useCases.confirmMerge(challengeId, userA.id, userA.id);

  assert.deepEqual(result, { ok: false, code: "MERGE_STREAMER_CONFLICT" });
  assert.ok(state.users.has(userA.id));
  assert.ok(state.users.has(userB.id));
  assert.equal(state.scores.length, 2);
  assert.equal(state.challenges.get(challengeId)?.consumedAt, null);
});

test("merge is blocked when the Secondary (to-be-deleted) account is an ACTIVE administrator — privilege must never silently vanish or move", async () => {
  const { state, useCases, userA, userB, challengeId } = await setupTwoAccounts();
  // Keeping A means B (Secondary) would be deleted. B is an active admin.
  state.adminAccounts.set(userB.id, "ACTIVE");

  const result = await useCases.confirmMerge(challengeId, userA.id, userA.id);

  assert.deepEqual(result, { ok: false, code: "MERGE_ADMIN_CONFLICT" });
  // Nothing destructive happened.
  assert.ok(state.users.has(userA.id));
  assert.ok(state.users.has(userB.id));
  assert.equal(state.challenges.get(challengeId)?.consumedAt, null);
});

test("merge is allowed when the Secondary account's admin status is DISABLED (not ACTIVE)", async () => {
  const { state, useCases, userA, userB, challengeId } = await setupTwoAccounts();
  state.adminAccounts.set(userB.id, "DISABLED");

  const result = await useCases.confirmMerge(challengeId, userA.id, userA.id);

  assert.equal(result.ok, true);
});

test("merge is allowed when the PRIMARY (kept) account is the administrator — only Secondary's admin status blocks the merge", async () => {
  const { state, useCases, userA, userB, challengeId } = await setupTwoAccounts();
  // Keeping A means B is Secondary; A being an admin is irrelevant to the Secondary-side check.
  state.adminAccounts.set(userA.id, "ACTIVE");

  const result = await useCases.confirmMerge(challengeId, userA.id, userA.id);

  assert.equal(result.ok, true);
});

test("conflict-free Streamer ownership transfers with review and audit identity intact", async () => {
  const { state, useCases, userA, userB, challengeId } = await setupTwoAccounts();
  state.streamerProfileOwner = userB.id;
  state.streamerSettings.set(userA.id, "primary presentation");
  state.streamerSettings.set(userB.id, "secondary presentation");
  state.streamerReviewJobAccountIds.push(7001);
  state.streamerAuditAccountIds.push(7001);

  const result = await useCases.confirmMerge(challengeId, userA.id, userA.id);

  assert.equal(result.ok, true);
  assert.equal(state.streamerProfileOwner, userA.id);
  assert.equal(state.streamerSettings.get(userA.id), "primary presentation");
  assert.equal(state.streamerSettings.has(userB.id), false);
  assert.deepEqual(state.streamerReviewJobAccountIds, [7001]);
  assert.deepEqual(state.streamerAuditAccountIds, [7001]);
});

test("confirmMerge challenge is consumed after a successful merge", async () => {
  const { useCases, userA, userB, challengeId } = await setupTwoAccounts();

  let ch = await useCases.findMergeChallenge(challengeId);
  assert.ok(ch);
  assert.equal(ch!.consumedAt, null);

  const first = await useCases.confirmMerge(challengeId, userA.id, userA.id);
  assert.equal(first.ok, true);

  ch = await useCases.findMergeChallenge(challengeId);
  assert.ok(ch!.consumedAt, "challenge must be marked consumed");

  const second = await useCases.confirmMerge(challengeId, userA.id, userA.id);
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.code, "MERGE_CHALLENGE_CONSUMED");
});

test("confirmMerge rejects an expired challenge", async () => {
  const { state, useCases, userA, userB, challengeId } = await setupTwoAccounts();
  // Force expiry
  const ch = state.challenges.get(challengeId)!;
  ch.expiresAt = new Date(Date.now() - 1000).toISOString();

  const result = await useCases.confirmMerge(challengeId, userA.id, userA.id);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "MERGE_CHALLENGE_EXPIRED");

  // Nothing destructive happened — both users intact
  assert.ok(state.users.has(userA.id));
  assert.ok(state.users.has(userB.id));
});

test("confirmMerge rejects when the current session is not one of the candidates", async () => {
  const { useCases, userA, challengeId } = await setupTwoAccounts();
  const result = await useCases.confirmMerge(challengeId, userA.id, 99999);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "MERGE_CHALLENGE_MISMATCH");
});

test("confirmMerge rejects when keepUserId is neither candidate", async () => {
  const { useCases, challengeId } = await setupTwoAccounts();
  const result = await useCases.confirmMerge(challengeId, 99999, 1);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "MERGE_CHALLENGE_MISMATCH");
});

test("confirmMerge blocks same-provider conflict (both accounts have the same provider)", async () => {
  // A has google, B has google AND discord; proof provider is discord (B's fresh proof).
  // Keeping A would require moving B's google onto A, which already has google -> conflict.
  const state = new FixtureState();
  const userRepo = new FixtureUserRepo(state);
  const mergeRepo = new FixtureMergeRepo(state);
  const adminAccountRepo = new FixtureAdminAccountRepo(state);
  const useCases = new AccountMergeUseCases(mergeRepo, userRepo, adminAccountRepo);

  const userA = await userRepo.findOrCreateUser({
    provider: "google",
    providerUserId: "google-sub-A",
    email: "a@example.com",
    nickname: "Alpha",
    avatarUrl: null,
  });
  const userB = await userRepo.findOrCreateUser({
    provider: "discord",
    providerUserId: "discord-id-B",
    email: "b@example.com",
    nickname: "Bravo",
    avatarUrl: null,
  });
  // B also has a google identity
  await userRepo.linkOAuthAccount(userB.id, "google", "google-sub-B", "b2@example.com", null);

  const challenge = await mergeRepo.createMergeChallenge({
    userA: userA.id,
    userB: userB.id,
    provider: "discord",
    providerUserId: "discord-id-B",
    ttlSeconds: 600,
  });

  const result = await useCases.confirmMerge(challenge.id, userA.id, userA.id);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "MERGE_PROVIDER_CONFLICT");

  // Nothing destructive happened
  assert.ok(state.users.has(userA.id));
  assert.ok(state.users.has(userB.id));
});

test("confirmMerge is atomic: a failure leaves both accounts intact and challenge unconsumed", async () => {
  const { state, useCases, userA, userB, challengeId } = await setupTwoAccounts();
  state.failMerge = true;

  await assert.rejects(async () => {
    await useCases.confirmMerge(challengeId, userA.id, userA.id);
  }, /forced merge failure/);

  // Both users still exist (mock mergeAccounts throws before any mutation in this fixture)
  assert.ok(state.users.has(userA.id));
  assert.ok(state.users.has(userB.id));

  // Challenge not consumed
  const ch = await useCases.findMergeChallenge(challengeId);
  assert.equal(ch!.consumedAt, null);
});
