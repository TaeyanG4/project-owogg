import assert from "node:assert/strict";
import test from "node:test";
import { D1UserRepository } from "../src/d1/D1UserRepository.js";
import { createSqliteD1 } from "./helpers/sqliteD1.js";

const PROFILE_IDENTITY_SCHEMA = `
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname TEXT NOT NULL,
  email TEXT,
  avatar_url TEXT,
  avatar_provider TEXT,
  country TEXT,
  nickname_updated_at TEXT,
  country_updated_at TEXT,
  locale TEXT,
  current_streak INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  last_active_date TEXT,
  show_favorites INTEGER NOT NULL DEFAULT 0,
  show_recent_plays INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE oauth_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  provider_email TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(provider, provider_user_id),
  UNIQUE(user_id, provider)
);
CREATE TABLE oauth_identity_registrations (
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  registered_user_id INTEGER NOT NULL,
  registered_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (provider, provider_user_id),
  UNIQUE (registered_user_id, provider)
);
CREATE TRIGGER trg_oauth_accounts_before_insert_registration_guard
BEFORE INSERT ON oauth_accounts
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM oauth_identity_registrations registration
  WHERE registration.provider = NEW.provider
    AND (
      (registration.provider_user_id = NEW.provider_user_id
       AND registration.registered_user_id <> NEW.user_id)
      OR
      (registration.registered_user_id = NEW.user_id
       AND registration.provider_user_id <> NEW.provider_user_id)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'OAUTH_IDENTITY_ALREADY_REGISTERED');
END;
CREATE TRIGGER trg_oauth_accounts_after_insert_registration
AFTER INSERT ON oauth_accounts
FOR EACH ROW
BEGIN
  INSERT OR IGNORE INTO oauth_identity_registrations
    (provider, provider_user_id, registered_user_id, registered_at)
  VALUES (NEW.provider, NEW.provider_user_id, NEW.user_id, NEW.created_at);
END;
CREATE TRIGGER trg_oauth_accounts_before_identity_owner_update_guard
BEFORE UPDATE OF user_id, provider, provider_user_id ON oauth_accounts
FOR EACH ROW
WHEN NEW.user_id <> OLD.user_id
  OR NEW.provider <> OLD.provider
  OR NEW.provider_user_id <> OLD.provider_user_id
BEGIN
  SELECT RAISE(ABORT, 'OAUTH_IDENTITY_OWNER_IMMUTABLE');
END;
CREATE TRIGGER trg_oauth_identity_registrations_before_owner_update_guard
BEFORE UPDATE OF registered_user_id, provider, provider_user_id ON oauth_identity_registrations
FOR EACH ROW
WHEN NEW.registered_user_id <> OLD.registered_user_id
  OR NEW.provider <> OLD.provider
  OR NEW.provider_user_id <> OLD.provider_user_id
BEGIN
  SELECT RAISE(ABORT, 'OAUTH_IDENTITY_OWNER_IMMUTABLE');
END;
CREATE TRIGGER trg_oauth_accounts_after_delete_registration_release
AFTER DELETE ON oauth_accounts
FOR EACH ROW
BEGIN
  DELETE FROM oauth_identity_registrations
  WHERE provider = OLD.provider
    AND provider_user_id = OLD.provider_user_id
    AND registered_user_id = OLD.user_id;
END;
`;

test("new OAuth users keep a provider-specific avatar and select it by default", async () => {
  const { db } = createSqliteD1(PROFILE_IDENTITY_SCHEMA);
  const repo = new D1UserRepository(db);
  const user = await repo.findOrCreateUser({
    provider: "google",
    providerUserId: "google-123",
    email: "user@example.com",
    nickname: "Taeyang",
    avatarUrl: "https://google.example/avatar.png",
  });

  assert.equal(user.id, 1);
  assert.equal(user.avatar_provider, "google");
  assert.equal(user.avatar_url, "https://google.example/avatar.png");
  const accounts = await repo.getOAuthAccounts(user.id);
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0]?.avatar_url, "https://google.example/avatar.png");
});

test("OAuth refresh updates only that provider candidate until the user selects it", async () => {
  const { db } = createSqliteD1(PROFILE_IDENTITY_SCHEMA);
  const repo = new D1UserRepository(db);
  const user = await repo.findOrCreateUser({
    provider: "google",
    providerUserId: "google-123",
    email: "user@example.com",
    nickname: "Taeyang",
    avatarUrl: "https://google.example/avatar.png",
  });
  await repo.linkOAuthAccount(
    user.id,
    "discord",
    "discord-123",
    null,
    "https://discord.example/old.png",
  );

  const refreshed = await repo.findOrCreateUser({
    provider: "discord",
    providerUserId: "discord-123",
    email: null,
    nickname: "DiscordName",
    avatarUrl: "https://discord.example/new.png",
  });
  assert.equal(refreshed.nickname, "Taeyang", "OAuth display names never overwrite the alias");
  assert.equal(refreshed.avatar_provider, "google");
  assert.equal(refreshed.avatar_url, "https://google.example/avatar.png");
  const discord = (await repo.getOAuthAccounts(user.id)).find(
    (account) => account.provider === "discord",
  );
  assert.equal(discord?.avatar_url, "https://discord.example/new.png");

  const selected = await repo.updateAvatarPreference(
    user.id,
    "discord",
    "https://discord.example/new.png",
    "2026-08-24T00:00:00.000Z",
  );
  assert.equal(selected.avatar_provider, "discord");
  assert.equal(selected.avatar_url, "https://discord.example/new.png");

  await repo.unlinkOAuthAccount(user.id, "discord");
  const fallback = await repo.findById(user.id);
  assert.equal(fallback?.avatar_provider, "google");
  assert.equal(fallback?.avatar_url, "https://google.example/avatar.png");
});

test("a disconnected OAuth identity is released and can create a new account", async () => {
  const { db, raw } = createSqliteD1(PROFILE_IDENTITY_SCHEMA);
  const repo = new D1UserRepository(db);
  const original = await repo.findOrCreateUser({
    provider: "google",
    providerUserId: "google-once",
    email: "owner@example.com",
    nickname: "Owner",
    avatarUrl: null,
  });
  await repo.linkOAuthAccount(original.id, "discord", "discord-backup", null, null);
  await repo.unlinkOAuthAccount(original.id, "google");

  const signedInAgain = await repo.findOrCreateUser({
    provider: "google",
    providerUserId: "google-once",
    email: "owner-new@example.com",
    nickname: "Ignored replacement",
    avatarUrl: null,
  });

  assert.notEqual(signedInAgain.id, original.id);
  assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM users").get()?.count, 2);
  assert.equal(
    raw
      .prepare(
        "SELECT user_id FROM oauth_accounts WHERE provider = 'google' AND provider_user_id = 'google-once'",
      )
      .get()?.user_id,
    signedInAgain.id,
  );
});

test("a disconnected OAuth identity can be linked to another user", async () => {
  const { db, raw } = createSqliteD1(PROFILE_IDENTITY_SCHEMA);
  const repo = new D1UserRepository(db);
  const owner = await repo.findOrCreateUser({
    provider: "google",
    providerUserId: "google-owner",
    email: null,
    nickname: "Owner",
    avatarUrl: null,
  });
  const other = await repo.findOrCreateUser({
    provider: "discord",
    providerUserId: "discord-other",
    email: null,
    nickname: "Other",
    avatarUrl: null,
  });
  await repo.linkOAuthAccount(owner.id, "discord", "discord-owner", null, null);
  await repo.unlinkOAuthAccount(owner.id, "google");

  await repo.linkOAuthAccount(other.id, "google", "google-owner", null, null);

  assert.equal((await repo.findOAuthAccount("google", "google-owner"))?.user_id, other.id);
  assert.equal(
    raw
      .prepare(
        `SELECT registered_user_id
         FROM oauth_identity_registrations
         WHERE provider = 'google' AND provider_user_id = 'google-owner'`,
      )
      .get()?.registered_user_id,
    other.id,
  );
});

test("an active OAuth identity cannot move to another user", async () => {
  const { db } = createSqliteD1(PROFILE_IDENTITY_SCHEMA);
  const repo = new D1UserRepository(db);
  const owner = await repo.findOrCreateUser({
    provider: "google",
    providerUserId: "google-owner",
    email: null,
    nickname: "Owner",
    avatarUrl: null,
  });
  const other = await repo.findOrCreateUser({
    provider: "google",
    providerUserId: "google-other",
    email: null,
    nickname: "Other",
    avatarUrl: null,
  });
  await repo.linkOAuthAccount(owner.id, "discord", "discord-owner", null, null);

  await assert.rejects(
    () => repo.linkOAuthAccount(other.id, "discord", "discord-owner", null, null),
    (error: unknown) =>
      error instanceof Error &&
      error.name === "OAuthIdentityConflictError" &&
      error.message === "ACCOUNT_PREVIOUSLY_REGISTERED",
  );
  assert.equal((await repo.findOAuthAccount("discord", "discord-owner"))?.user_id, owner.id);
});

test("a user can link a different identity after disconnecting that provider", async () => {
  const { db } = createSqliteD1(PROFILE_IDENTITY_SCHEMA);
  const repo = new D1UserRepository(db);
  const user = await repo.findOrCreateUser({
    provider: "google",
    providerUserId: "google-first",
    email: null,
    nickname: "Owner",
    avatarUrl: null,
  });
  await repo.linkOAuthAccount(user.id, "discord", "discord-backup", null, null);
  await repo.unlinkOAuthAccount(user.id, "google");

  await repo.linkOAuthAccount(user.id, "google", "google-second", null, null);

  assert.equal((await repo.findOAuthAccount("google", "google-first"))?.user_id, undefined);
  assert.equal((await repo.findOAuthAccount("google", "google-second"))?.user_id, user.id);
});
