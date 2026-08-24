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
