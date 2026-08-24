import test from "node:test";
import assert from "node:assert/strict";
import { ProfileUseCases } from "../src/application/profileUseCases.js";
import type { OAuthAccount, User, UserRepository } from "../src/ports/repositories.js";

class FakeUserRepository implements UserRepository {
  users = new Map<number, User>();
  oauthAccounts: OAuthAccount[] = [];

  seed(user: User) {
    this.users.set(user.id, user);
  }

  async findById(id: number): Promise<User | null> {
    return this.users.get(id) ?? null;
  }
  async findByOAuth(): Promise<User | null> {
    return null;
  }
  async findOrCreateUser(): Promise<User> {
    throw new Error("not used in this test");
  }
  async getOAuthAccounts(userId: number): Promise<OAuthAccount[]> {
    return this.oauthAccounts.filter((account) => account.user_id === userId);
  }
  async findOAuthAccount(): Promise<OAuthAccount | null> {
    return null;
  }
  async linkOAuthAccount(): Promise<void> {}
  async unlinkOAuthAccount(): Promise<void> {}
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

  async updateNickname(userId: number, nickname: string, updatedAt: string): Promise<User> {
    const user = this.users.get(userId);
    if (!user) throw new Error("user not found");
    const updated: User = { ...user, nickname, nickname_updated_at: updatedAt };
    this.users.set(userId, updated);
    return updated;
  }

  async updateCountry(userId: number, country: string | null, updatedAt: string): Promise<User> {
    const user = this.users.get(userId);
    if (!user) throw new Error("user not found");
    const updated: User = { ...user, country, country_updated_at: updatedAt };
    this.users.set(userId, updated);
    return updated;
  }

  async updateLocale(userId: number, locale: string, updatedAt: string): Promise<User> {
    const user = this.users.get(userId);
    if (!user) throw new Error("user not found");
    const updated: User = { ...user, locale, updated_at: updatedAt };
    this.users.set(userId, updated);
    return updated;
  }

  async updateVisibility(
    userId: number,
    showFavorites: boolean,
    showRecentPlays: boolean,
    updatedAt: string,
  ): Promise<User> {
    const user = this.users.get(userId);
    if (!user) throw new Error("user not found");
    const updated: User = {
      ...user,
      show_favorites: showFavorites,
      show_recent_plays: showRecentPlays,
      updated_at: updatedAt,
    };
    this.users.set(userId, updated);
    return updated;
  }
}

function baseUser(overrides: Partial<User> = {}): User {
  return {
    id: 1,
    nickname: "OldName",
    email: "a@example.com",
    avatar_url: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    nickname_updated_at: null,
    country: null,
    country_updated_at: null,
    locale: null,
    ...overrides,
  };
}

test("updateNickname succeeds on first change (no prior cooldown)", async () => {
  const repo = new FakeUserRepository();
  repo.seed(baseUser());
  const useCases = new ProfileUseCases(repo);

  const result = await useCases.updateNickname(1, "NewName");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.user.nickname, "NewName");
});

test("updateNickname rejects invalid input without touching cooldown", async () => {
  const repo = new FakeUserRepository();
  repo.seed(baseUser());
  const useCases = new ProfileUseCases(repo);

  const result = await useCases.updateNickname(1, "");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "INVALID_NICKNAME");
});

test("updateNickname blocks a second change inside the cooldown window", async () => {
  const repo = new FakeUserRepository();
  repo.seed(baseUser({ nickname_updated_at: new Date().toISOString() }));
  const useCases = new ProfileUseCases(repo);

  const result = await useCases.updateNickname(1, "AnotherName");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "NICKNAME_COOLDOWN_ACTIVE");
});

test("updateNickname allows a change once the cooldown has elapsed", async () => {
  const repo = new FakeUserRepository();
  const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
  repo.seed(baseUser({ nickname_updated_at: thirtyOneDaysAgo }));
  const useCases = new ProfileUseCases(repo);

  const result = await useCases.updateNickname(1, "FreshName");
  assert.equal(result.ok, true);
});

test("updateNickname reports USER_NOT_FOUND for a missing user", async () => {
  const repo = new FakeUserRepository();
  const useCases = new ProfileUseCases(repo);

  const result = await useCases.updateNickname(999, "Name");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "USER_NOT_FOUND");
});

test("updateAvatarPreference selects only an avatar from a linked OAuth identity", async () => {
  const repo = new FakeUserRepository();
  repo.seed(baseUser({ avatar_url: "https://google.example/old.png", avatar_provider: "google" }));
  repo.oauthAccounts.push({
    id: 1,
    user_id: 1,
    provider: "google",
    provider_user_id: "google-1",
    provider_email: "a@example.com",
    avatar_url: "https://google.example/avatar.png",
    created_at: "2026-01-01T00:00:00.000Z",
  });
  repo.oauthAccounts.push({
    id: 2,
    user_id: 1,
    provider: "discord",
    provider_user_id: "discord-1",
    provider_email: null,
    avatar_url: "https://discord.example/avatar.png",
    created_at: "2026-01-02T00:00:00.000Z",
  });

  const result = await new ProfileUseCases(repo).updateAvatarPreference(1, "discord");
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.user.avatar_provider, "discord");
    assert.equal(result.user.avatar_url, "https://discord.example/avatar.png");
  }
});

test("updateAvatarPreference rejects unlinked or image-less providers", async () => {
  const repo = new FakeUserRepository();
  repo.seed(baseUser());
  const useCases = new ProfileUseCases(repo);

  const unlinked = await useCases.updateAvatarPreference(1, "discord");
  assert.equal(unlinked.ok, false);
  if (!unlinked.ok) assert.equal(unlinked.code, "AVATAR_PROVIDER_NOT_LINKED");

  repo.oauthAccounts.push({
    id: 1,
    user_id: 1,
    provider: "discord",
    provider_user_id: "discord-1",
    provider_email: null,
    avatar_url: null,
    created_at: "2026-01-01T00:00:00.000Z",
  });
  const unavailable = await useCases.updateAvatarPreference(1, "discord");
  assert.equal(unavailable.ok, false);
  if (!unavailable.ok) assert.equal(unavailable.code, "AVATAR_UNAVAILABLE");
});

test("updateCountry succeeds on first change and normalizes casing", async () => {
  const repo = new FakeUserRepository();
  repo.seed(baseUser());
  const useCases = new ProfileUseCases(repo);

  const result = await useCases.updateCountry(1, "kr");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.user.country, "KR");
});

test("updateCountry rejects an invalid ISO code", async () => {
  const repo = new FakeUserRepository();
  repo.seed(baseUser());
  const useCases = new ProfileUseCases(repo);

  const result = await useCases.updateCountry(1, "Korea");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "INVALID_COUNTRY");
});

test("updateCountry blocks a second change inside its (longer) cooldown window", async () => {
  const repo = new FakeUserRepository();
  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  repo.seed(baseUser({ country: "KR", country_updated_at: tenDaysAgo }));
  const useCases = new ProfileUseCases(repo);

  // Both profile identity fields now use a 30-day cooldown.
  const result = await useCases.updateCountry(1, "JP");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "COUNTRY_COOLDOWN_ACTIVE");
});

test("updateCountry accepts unsetting the country back to null", async () => {
  const repo = new FakeUserRepository();
  repo.seed(baseUser());
  const useCases = new ProfileUseCases(repo);

  const result = await useCases.updateCountry(1, null);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.user.country, null);
});

test("updateLocale succeeds for each of the four supported locales, no cooldown involved", async () => {
  for (const locale of ["ko-KR", "en-US", "ja-JP", "zh-CN"]) {
    const repo = new FakeUserRepository();
    repo.seed(baseUser());
    const useCases = new ProfileUseCases(repo);

    const result = await useCases.updateLocale(1, locale);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.user.locale, locale);
  }
});

test("updateLocale rejects an unsupported locale (e.g. zh-TW, out of scope this sprint)", async () => {
  const repo = new FakeUserRepository();
  repo.seed(baseUser());
  const useCases = new ProfileUseCases(repo);

  const result = await useCases.updateLocale(1, "zh-TW");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "INVALID_LOCALE");
});

test("updateLocale rejects a garbage value without touching the stored locale", async () => {
  const repo = new FakeUserRepository();
  repo.seed(baseUser({ locale: "ko-KR" }));
  const useCases = new ProfileUseCases(repo);

  const result = await useCases.updateLocale(1, "not-a-locale");
  assert.equal(result.ok, false);
  assert.equal(repo.users.get(1)?.locale, "ko-KR");
});

test("updateLocale allows switching immediately right after a previous change (no cooldown)", async () => {
  const repo = new FakeUserRepository();
  repo.seed(baseUser({ locale: "ko-KR" }));
  const useCases = new ProfileUseCases(repo);

  const first = await useCases.updateLocale(1, "en-US");
  assert.equal(first.ok, true);
  const second = await useCases.updateLocale(1, "ja-JP");
  assert.equal(second.ok, true);
  if (second.ok) assert.equal(second.user.locale, "ja-JP");
});

test("updateLocale reports USER_NOT_FOUND for a missing user", async () => {
  const repo = new FakeUserRepository();
  const useCases = new ProfileUseCases(repo);

  const result = await useCases.updateLocale(999, "en-US");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "USER_NOT_FOUND");
});

test("updateVisibility sets both flags independently, defaults false", async () => {
  const repo = new FakeUserRepository();
  repo.seed(baseUser());
  const useCases = new ProfileUseCases(repo);

  const result = await useCases.updateVisibility(1, true, false);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.user.show_favorites, true);
    assert.equal(result.user.show_recent_plays, false);
  }
});

test("updateVisibility reports USER_NOT_FOUND for a missing user", async () => {
  const repo = new FakeUserRepository();
  const useCases = new ProfileUseCases(repo);

  const result = await useCases.updateVisibility(999, true, true);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "USER_NOT_FOUND");
});
