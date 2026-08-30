import test from "node:test";
import assert from "node:assert/strict";
import {
  IdentityUseCases,
  OAuthIdentityConflictError,
  type OAuthAccount,
  type User,
  type UserRepository,
} from "../src/index.js";

class MockUserRepository implements UserRepository {
  users = new Map<number, User>();
  oauth = new Map<string, OAuthAccount>(); // key: `${provider}:${providerUserId}`
  nextUserId = 1;

  async findById(id: number): Promise<User | null> {
    return this.users.get(id) ?? null;
  }
  async findByOAuth(provider: string, providerUserId: string): Promise<User | null> {
    const acc = this.oauth.get(`${provider}:${providerUserId}`);
    if (!acc) return null;
    return this.users.get(acc.user_id) ?? null;
  }
  async findOrCreateUser(data: {
    provider: string;
    providerUserId: string;
    email: string | null;
    nickname: string;
    avatarUrl: string | null;
  }): Promise<User> {
    const existing = await this.findByOAuth(data.provider, data.providerUserId);
    if (existing) return existing;
    const id = this.nextUserId++;
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
    this.users.set(id, user);
    this.oauth.set(`${data.provider}:${data.providerUserId}`, {
      id: this.nextUserId,
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
    return Array.from(this.oauth.values()).filter((a) => a.user_id === userId);
  }
  async findOAuthAccount(provider: string, providerUserId: string): Promise<OAuthAccount | null> {
    return this.oauth.get(`${provider}:${providerUserId}`) ?? null;
  }
  async linkOAuthAccount(
    userId: number,
    provider: string,
    providerUserId: string,
    providerEmail: string | null,
    avatarUrl: string | null,
  ): Promise<void> {
    this.oauth.set(`${provider}:${providerUserId}`, {
      id: this.nextUserId,
      user_id: userId,
      provider,
      provider_user_id: providerUserId,
      provider_email: providerEmail,
      avatar_url: avatarUrl,
      created_at: new Date().toISOString(),
    });
  }
  async unlinkOAuthAccount(userId: number, provider: string): Promise<void> {
    for (const [key, acc] of this.oauth.entries()) {
      if (acc.user_id === userId && acc.provider === provider) {
        this.oauth.delete(key);
      }
    }
  }
  async updateAvatarPreference(
    userId: number,
    provider: string,
    avatarUrl: string,
    updatedAt: string,
  ): Promise<User> {
    const user = this.users.get(userId);
    if (!user) throw new Error("user not found");
    const updated = {
      ...user,
      avatar_provider: provider,
      avatar_url: avatarUrl,
      updated_at: updatedAt,
    };
    this.users.set(userId, updated);
    return updated;
  }
}

async function seedTwoAccounts(repo: MockUserRepository): Promise<{ userA: User; userB: User }> {
  const userA = await repo.findOrCreateUser({
    provider: "google",
    providerUserId: "google-sub-A",
    email: "a@example.com",
    nickname: "A",
    avatarUrl: null,
  });
  const userB = await repo.findOrCreateUser({
    provider: "discord",
    providerUserId: "discord-id-B",
    email: "b@example.com",
    nickname: "B",
    avatarUrl: null,
  });
  return { userA, userB };
}

test("linkProvider attaches an unused provider identity to the current account", async () => {
  const repo = new MockUserRepository();
  const { userA } = await seedTwoAccounts(repo);
  const useCases = new IdentityUseCases(repo);

  const result = await useCases.linkProvider(
    userA.id,
    "discord",
    "discord-id-free",
    "d@example.com",
    "https://discord.example/avatar.png",
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.provider, "discord");
    assert.equal(result.alreadyLinked, false);
  }

  const connected = await useCases.getConnectedProviders(userA.id);
  const providers = connected.map((p) => p.provider).sort();
  assert.deepEqual(providers, ["discord", "google"]);
});

test("linkProvider linking an identity already on the same account is idempotent", async () => {
  const repo = new MockUserRepository();
  const { userA } = await seedTwoAccounts(repo);
  const useCases = new IdentityUseCases(repo);

  // Attaching the same Google identity that userA already owns
  const result = await useCases.linkProvider(
    userA.id,
    "google",
    "google-sub-A",
    "a@example.com",
    null,
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.alreadyLinked, true);

  // Still only one provider for A
  const connected = await useCases.getConnectedProviders(userA.id);
  assert.equal(connected.length, 1);
});

test("linkProvider rejects an active identity that belongs to another user without offering a merge", async () => {
  const repo = new MockUserRepository();
  const { userA, userB } = await seedTwoAccounts(repo);
  const useCases = new IdentityUseCases(repo);

  // userA tries to link the Discord identity that userB owns
  const result = await useCases.linkProvider(
    userA.id,
    "discord",
    "discord-id-B",
    "b@example.com",
    null,
  );
  assert.deepEqual(result, { ok: false, code: "ACCOUNT_PREVIOUSLY_REGISTERED" });
});

test("linkProvider rejects a second provider identity before offering an account merge", async () => {
  const repo = new MockUserRepository();
  const { userA, userB } = await seedTwoAccounts(repo);
  await repo.linkOAuthAccount(userB.id, "google", "google-test-account", null, null);
  const useCases = new IdentityUseCases(repo);

  const result = await useCases.linkProvider(userA.id, "google", "google-test-account", null, null);

  assert.deepEqual(result, { ok: false, code: "PROVIDER_ALREADY_LINKED" });
});

test("linkProvider maps a durable historical registration conflict to a hard rejection", async () => {
  const repo = new MockUserRepository();
  const { userA } = await seedTwoAccounts(repo);
  repo.linkOAuthAccount = async () => {
    throw new OAuthIdentityConflictError("ACCOUNT_PREVIOUSLY_REGISTERED", 99);
  };
  const useCases = new IdentityUseCases(repo);

  const result = await useCases.linkProvider(
    userA.id,
    "discord",
    "discord-previously-registered",
    null,
    null,
  );

  assert.deepEqual(result, { ok: false, code: "ACCOUNT_PREVIOUSLY_REGISTERED" });
});

test("linkProvider blocks a second identity for a provider the account already has", async () => {
  const repo = new MockUserRepository();
  const { userA } = await seedTwoAccounts(repo);
  const useCases = new IdentityUseCases(repo);

  // userA already has google-sub-A; try linking a different Google sub
  const result = await useCases.linkProvider(
    userA.id,
    "google",
    "google-sub-second",
    "a2@example.com",
    null,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "PROVIDER_ALREADY_LINKED");
});

test("unlinkProvider is blocked when it is the last login method (LAST_AUTH_PROVIDER)", async () => {
  const repo = new MockUserRepository();
  const { userA } = await seedTwoAccounts(repo);
  const useCases = new IdentityUseCases(repo);

  const result = await useCases.unlinkProvider(userA.id, "google");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "LAST_AUTH_PROVIDER");

  // Identity remains intact
  const connected = await useCases.getConnectedProviders(userA.id);
  assert.equal(connected.length, 1);
});

test("unlinkProvider succeeds when another provider remains", async () => {
  const repo = new MockUserRepository();
  const { userA } = await seedTwoAccounts(repo);
  const useCases = new IdentityUseCases(repo);

  // attach discord first
  await useCases.linkProvider(userA.id, "discord", "discord-d", "d@example.com", null);
  const unlink = await useCases.unlinkProvider(userA.id, "google");
  assert.equal(unlink.ok, true);

  const connected = await useCases.getConnectedProviders(userA.id);
  assert.deepEqual(
    connected.map((p) => p.provider),
    ["discord"],
  );
});

test("an identity can be linked to another account after the previous account disconnects it", async () => {
  const repo = new MockUserRepository();
  const { userA, userB } = await seedTwoAccounts(repo);
  const useCases = new IdentityUseCases(repo);

  await repo.linkOAuthAccount(userB.id, "google", "google-backup", null, null);
  const unlink = await useCases.unlinkProvider(userB.id, "discord");
  assert.deepEqual(unlink, { ok: true, provider: "discord" });

  const link = await useCases.linkProvider(
    userA.id,
    "discord",
    "discord-id-B",
    "b@example.com",
    null,
  );
  assert.deepEqual(link, { ok: true, provider: "discord", alreadyLinked: false });
  assert.equal((await repo.findOAuthAccount("discord", "discord-id-B"))?.user_id, userA.id);
});

test("linkProvider never uses matching email as proof of identity", async () => {
  const repo = new MockUserRepository();
  const { userA, userB } = await seedTwoAccounts(repo);
  const useCases = new IdentityUseCases(repo);

  // Link a brand-new Discord identity to A, but reuse B's email value.
  // Email must NOT be treated as canonical identity, so it links to A (the authenticated user).
  const result = await useCases.linkProvider(
    userA.id,
    "discord",
    "discord-id-free",
    "b@example.com",
    null,
  );
  assert.equal(result.ok, true);

  // A and B remain distinct users; B still owns only its own Discord identity
  const aConnected = (await useCases.getConnectedProviders(userA.id)).map((p) => p.provider).sort();
  const bConnected = await useCases.getConnectedProviders(userB.id);
  assert.deepEqual(aConnected, ["discord", "google"]);
  assert.deepEqual(
    bConnected.map((p) => p.provider),
    ["discord"],
  );
  assert.deepEqual(bConnected[0].providerUserId, "discord-id-B");
});
