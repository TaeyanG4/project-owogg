import test from "node:test";
import assert from "node:assert/strict";
import { D1StreamerVerificationIntentRepository, hashSessionToken } from "../src/index.js";
import { createSqliteD1 } from "./helpers/sqliteD1.js";

const SCHEMA = `
CREATE TABLE users (id INTEGER PRIMARY KEY);
CREATE TABLE streamer_verification_intents (
  state_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_token_hash TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('YOUTUBE', 'CHZZK', 'TWITCH')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
`;

function setup() {
  const { db, raw } = createSqliteD1(`PRAGMA foreign_keys = ON; ${SCHEMA}`);
  raw.exec("INSERT INTO users (id) VALUES (7), (8);");
  return { raw, repo: new D1StreamerVerificationIntentRepository(db) };
}

test("verification intent stores hashes and consumes only an exact user/session/platform match", async () => {
  const { raw, repo } = setup();
  const state = "browser-visible-state";
  const sessionToken = "raw-owogg-session";
  await repo.create({
    state,
    userId: 7,
    sessionToken,
    platform: "YOUTUBE",
    createdAt: "2026-08-31T00:00:00.000Z",
    expiresAt: "2026-08-31T00:10:00.000Z",
  });

  const stored = raw.prepare("SELECT * FROM streamer_verification_intents").get() as Record<
    string,
    unknown
  >;
  assert.equal(stored.state_hash, await hashSessionToken(state));
  assert.equal(stored.session_token_hash, await hashSessionToken(sessionToken));
  assert.notEqual(stored.state_hash, state);
  assert.notEqual(stored.session_token_hash, sessionToken);

  const base = {
    state,
    userId: 7,
    sessionToken,
    platform: "YOUTUBE" as const,
    consumedAt: "2026-08-31T00:01:00.000Z",
  };
  assert.equal(await repo.consume({ ...base, userId: 8 }), false, "another user");
  assert.equal(
    await repo.consume({ ...base, sessionToken: "another-session" }),
    false,
    "another OwOGG session",
  );
  assert.equal(await repo.consume({ ...base, platform: "TWITCH" }), false, "platform swap");
  assert.equal(await repo.consume(base), true);
  assert.equal(await repo.consume(base), false, "replay");
  assert.equal(
    raw.prepare("SELECT COUNT(*) AS count FROM streamer_verification_intents").get()?.count,
    0,
    "successful consume removes the short-lived credential",
  );
});

test("verification intent fails closed after its configurable expiry", async () => {
  const { repo } = setup();
  await repo.create({
    state: "expired-state",
    userId: 7,
    sessionToken: "session",
    platform: "CHZZK",
    createdAt: "2026-08-31T00:00:00.000Z",
    expiresAt: "2026-08-31T00:10:00.000Z",
  });

  assert.equal(
    await repo.consume({
      state: "expired-state",
      userId: 7,
      sessionToken: "session",
      platform: "CHZZK",
      consumedAt: "2026-08-31T00:10:00.000Z",
    }),
    false,
  );
});
