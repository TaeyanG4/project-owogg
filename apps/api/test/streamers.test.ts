import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { hashSessionToken } from "@owogg/db";
import { StreamerProvidersResponseSchema } from "@owogg/contracts";
import { createSqliteD1 } from "../../../packages/db/test/helpers/sqliteD1.js";
import { app } from "../src/app.js";

const SESSION_TOKEN = "streamer-route-session";
const SECOND_SESSION_TOKEN = "streamer-route-session-2";
const COOKIE = `owogg_session=${SESSION_TOKEN}`;
const SECOND_COOKIE = `owogg_session=${SECOND_SESSION_TOKEN}`;
const NOW = "2026-08-31T00:00:00.000Z";
const FUTURE = "2099-01-01T00:00:00.000Z";

function createMigratedD1() {
  const result = createSqliteD1("PRAGMA foreign_keys = ON;");
  const migrationUrl = new URL("../../../packages/db/migrations/", import.meta.url);
  for (const filename of fs
    .readdirSync(migrationUrl)
    .filter((value) => value.endsWith(".sql"))
    .sort()) {
    result.raw.exec(fs.readFileSync(new URL(filename, migrationUrl), "utf8"));
  }
  return result;
}

async function seedSession(
  raw: import("node:sqlite").DatabaseSync,
  userId = 7,
  sessionToken = SESSION_TOKEN,
) {
  const sessionHash = await hashSessionToken(sessionToken);
  raw.prepare("INSERT INTO users (id, nickname) VALUES (?, ?)").run(userId, `Tester ${userId}`);
  raw
    .prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .run(sessionHash, userId, NOW, FUTURE);
}

async function seedAdditionalSession(
  raw: import("node:sqlite").DatabaseSync,
  userId: number,
  sessionToken: string,
) {
  raw
    .prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .run(await hashSessionToken(sessionToken), userId, NOW, FUTURE);
}

test("GET /api/streamers/rankings returns the requested public ranking shape", async () => {
  const { db } = createMigratedD1();
  const res = await app.request("/api/streamers/rankings?mode=score&platform=YOUTUBE", {}, {
    DB: db,
  } as any);

  assert.equal(res.status, 200);
  const json = (await res.json()) as any;
  assert.equal(Array.isArray(json.entries), true);
  assert.equal(json.mode, "score");
  assert.equal(json.platform, "YOUTUBE");
});

test("the former broadcast-program API path remains a rolling-deploy alias", async () => {
  const { db } = createMigratedD1();
  const res = await app.request("/api/creators/rankings?mode=score&platform=YOUTUBE", {}, {
    DB: db,
  } as any);

  assert.equal(res.status, 200);
  const json = (await res.json()) as { entries: unknown[] };
  assert.ok(Array.isArray(json.entries));
});

test("GET /api/streamers/me requires authentication", async () => {
  const { db } = createMigratedD1();
  const res = await app.request("/api/streamers/me", {}, { DB: db } as any);
  assert.equal(res.status, 401);
});

test("GET /api/streamers/providers returns readiness and the persisted pause state", async () => {
  const { db } = createMigratedD1();
  const res = await app.request("/api/streamers/providers", {}, {
    DB: db,
    YOUTUBE_CLIENT_ID: "yt-client-id",
    YOUTUBE_CLIENT_SECRET: "yt-secret",
  } as any);

  assert.equal(res.status, 200);
  const json = StreamerProvidersResponseSchema.parse(await res.json());
  assert.deepEqual(json.YOUTUBE, {
    configured: true,
    paused: false,
    verificationMethod: "OAUTH_REDIRECT",
    unavailableReason: null,
  });
  assert.equal(json.TWITCH.verificationMethod, "OAUTH_REDIRECT");
  assert.equal(json.CHZZK.verificationMethod, "OAUTH_REDIRECT");
  assert.deepEqual(json.SOOP, {
    configured: false,
    paused: false,
    verificationMethod: "UNAVAILABLE",
    unavailableReason: "SECURE_OAUTH_CALLBACK_BINDING_UNAVAILABLE",
  });
});

test("GET /api/streamers/verify/:platform redirects when the provider is not configured", async () => {
  const { db, raw } = createMigratedD1();
  await seedSession(raw);
  const res = await app.request("/api/streamers/verify/youtube", { headers: { Cookie: COOKIE } }, {
    DB: db,
    FRONTEND_URL: "http://localhost:3000",
  } as any);

  assert.equal(res.status, 302);
  assert.ok(res.headers.get("location")?.includes("streamer_verify=unconfigured"));
});

test("GET /api/streamers/verify/:platform uses the active policy for a configured connection", async () => {
  const { db, raw } = createMigratedD1();
  await seedSession(raw);
  const res = await app.request("/api/streamers/verify/youtube", { headers: { Cookie: COOKIE } }, {
    DB: db,
    USE_MOCK_STREAMER_PROVIDERS: "true",
  } as any);

  assert.equal(res.status, 302);
  const location = res.headers.get("location");
  assert.ok(location?.includes("https://mock.owogg.dev/auth/YOUTUBE"));
  assert.ok(location?.includes("state="));
  assert.equal(res.headers.get("set-cookie"), null);
  const rawState = new URL(String(location)).searchParams.get("state");
  assert.ok(rawState);
  const stored = raw
    .prepare("SELECT state_hash, session_token_hash FROM streamer_verification_intents")
    .get() as { state_hash: string; session_token_hash: string };
  assert.equal(stored.state_hash, await hashSessionToken(rawState));
  assert.equal(stored.session_token_hash, await hashSessionToken(SESSION_TOKEN));
  assert.notEqual(stored.state_hash, rawState);
});

test("SOOP verification is explicitly deferred instead of opening an unbound OAuth callback", async () => {
  const { db, raw } = createMigratedD1();
  await seedSession(raw);
  const res = await app.request("/api/streamers/verify/soop", { headers: { Cookie: COOKIE } }, {
    DB: db,
    FRONTEND_URL: "http://localhost:3000",
    SOOP_CLIENT_ID: "soop-client",
    SOOP_CLIENT_SECRET: "soop-secret",
  } as any);

  assert.equal(res.status, 302);
  assert.ok(res.headers.get("location")?.includes("streamer_verify=deferred"));
  assert.equal(
    raw.prepare("SELECT COUNT(*) AS count FROM streamer_verification_intents").get()?.count,
    0,
  );
});

test("GET /api/streamers/verify/:platform/callback rejects state mismatch", async () => {
  const { db, raw } = createMigratedD1();
  await seedSession(raw);
  const res = await app.request(
    "/api/streamers/verify/youtube/callback?code=abc&state=badstate",
    { headers: { Cookie: COOKIE } },
    {
      DB: db,
      FRONTEND_URL: "http://localhost:3000",
      USE_MOCK_STREAMER_PROVIDERS: "true",
    } as any,
  );

  assert.equal(res.status, 302);
  const location = res.headers.get("location");
  assert.ok(location?.includes("streamer_verify=error"));
  assert.ok(location?.includes("state_mismatch"));
});

test("OAuth intent cannot be used by another OwOGG user or another session", async () => {
  const { db, raw } = createMigratedD1();
  await seedSession(raw, 7, SESSION_TOKEN);
  await seedSession(raw, 8, SECOND_SESSION_TOKEN);
  const thirdSession = "same-user-different-session";
  await seedAdditionalSession(raw, 7, thirdSession);
  const env = {
    DB: db,
    FRONTEND_URL: "http://localhost:3000",
    USE_MOCK_STREAMER_PROVIDERS: "true",
  } as any;

  const initiation = await app.request(
    "/api/streamers/verify/youtube",
    { headers: { Cookie: COOKIE } },
    env,
  );
  const state = new URL(String(initiation.headers.get("location"))).searchParams.get("state");
  assert.ok(state);

  for (const [label, cookie] of [
    ["another user", SECOND_COOKIE],
    ["another session for the same user", `owogg_session=${thirdSession}`],
  ] as const) {
    const rejected = await app.request(
      `/api/streamers/verify/youtube/callback?code=owner-channel&state=${state}`,
      { headers: { Cookie: cookie } },
      env,
    );
    assert.ok(rejected.headers.get("location")?.includes("state_mismatch"), label);
    assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM streamer_profiles").get()?.count, 0);
  }

  const ownerCallback = await app.request(
    `/api/streamers/verify/youtube/callback?code=owner-channel&state=${state}`,
    { headers: { Cookie: COOKIE } },
    env,
  );
  assert.ok(ownerCallback.headers.get("location")?.includes("streamer_verify=success"));
});

test("OAuth intent rejects platform swaps, expiry, and callback replay", async () => {
  const { db, raw } = createMigratedD1();
  await seedSession(raw);
  const env = {
    DB: db,
    FRONTEND_URL: "http://localhost:3000",
    USE_MOCK_STREAMER_PROVIDERS: "true",
  } as any;

  const initiation = await app.request(
    "/api/streamers/verify/youtube",
    { headers: { Cookie: COOKIE } },
    env,
  );
  const state = new URL(String(initiation.headers.get("location"))).searchParams.get("state");
  assert.ok(state);

  const swapped = await app.request(
    `/api/streamers/verify/twitch/callback?code=swapped&state=${state}`,
    { headers: { Cookie: COOKIE } },
    env,
  );
  assert.ok(swapped.headers.get("location")?.includes("state_mismatch"));

  const valid = await app.request(
    `/api/streamers/verify/youtube/callback?code=owner&state=${state}`,
    { headers: { Cookie: COOKIE } },
    env,
  );
  assert.ok(valid.headers.get("location")?.includes("streamer_verify=success"));

  const replay = await app.request(
    `/api/streamers/verify/youtube/callback?code=owner&state=${state}`,
    { headers: { Cookie: COOKIE } },
    env,
  );
  assert.ok(replay.headers.get("location")?.includes("state_mismatch"));

  const expiring = await app.request(
    "/api/streamers/verify/twitch",
    { headers: { Cookie: COOKIE } },
    env,
  );
  const expiredState = new URL(String(expiring.headers.get("location"))).searchParams.get("state");
  assert.ok(expiredState);
  raw
    .prepare(
      `UPDATE streamer_verification_intents
       SET created_at = ?, expires_at = ?`,
    )
    .run("1999-01-01T00:00:00.000Z", "2000-01-01T00:00:00.000Z");
  const expired = await app.request(
    `/api/streamers/verify/twitch/callback?code=expired&state=${expiredState}`,
    { headers: { Cookie: COOKIE } },
    env,
  );
  assert.ok(expired.headers.get("location")?.includes("state_mismatch"));
  assert.equal(
    raw.prepare("SELECT COUNT(*) AS count FROM streamer_platform_accounts").get()?.count,
    1,
  );
});

test("a platform-confirmed channel identity cannot be claimed by a second OwOGG user", async () => {
  const { db, raw } = createMigratedD1();
  await seedSession(raw, 7, SESSION_TOKEN);
  await seedSession(raw, 8, SECOND_SESSION_TOKEN);
  const env = {
    DB: db,
    FRONTEND_URL: "http://localhost:3000",
    USE_MOCK_STREAMER_PROVIDERS: "true",
  } as any;

  for (const cookie of [COOKIE, SECOND_COOKIE]) {
    const initiation = await app.request(
      "/api/streamers/verify/chzzk",
      { headers: { Cookie: cookie } },
      env,
    );
    const state = new URL(String(initiation.headers.get("location"))).searchParams.get("state");
    assert.ok(state);
    const callback = await app.request(
      `/api/streamers/verify/chzzk/callback?code=canonical-shared-channel&state=${state}`,
      { headers: { Cookie: cookie } },
      env,
    );
    if (cookie === COOKIE) {
      assert.ok(callback.headers.get("location")?.includes("streamer_verify=success"));
    } else {
      assert.ok(callback.headers.get("location")?.includes("streamer_verify=conflict"));
    }
  }

  assert.equal(
    raw.prepare("SELECT COUNT(*) AS count FROM streamer_platform_accounts").get()?.count,
    1,
  );
});

test("one user receives a separate pending manual review from every supported OAuth callback", async () => {
  const { db, raw } = createMigratedD1();
  await seedSession(raw);
  const env = {
    DB: db,
    FRONTEND_URL: "http://localhost:3000",
    USE_MOCK_STREAMER_PROVIDERS: "true",
  } as any;

  for (const [platform, code] of [
    ["youtube", "yt-channel"],
    ["twitch", "tw-channel"],
    ["chzzk", "chzzk-channel"],
  ] as const) {
    const initiation = await app.request(
      `/api/streamers/verify/${platform}`,
      { headers: { Cookie: COOKIE } },
      env,
    );
    const state = new URL(String(initiation.headers.get("location"))).searchParams.get("state");
    assert.ok(state);

    const callback = await app.request(
      `/api/streamers/verify/${platform}/callback?code=${code}&state=${state}`,
      { headers: { Cookie: COOKIE } },
      env,
    );
    assert.equal(callback.status, 302);
    assert.ok(callback.headers.get("location")?.includes("streamer_verify=success"));
  }

  assert.deepEqual(
    raw
      .prepare(
        `SELECT account.platform, account.approval_status, review.work_state
         FROM streamer_platform_accounts account
         JOIN streamer_platform_reviews review
           ON review.streamer_platform_account_id = account.id
         ORDER BY account.platform`,
      )
      .all()
      .map((row) => ({ ...row })),
    [
      { platform: "CHZZK", approval_status: "PENDING", work_state: "QUEUED" },
      { platform: "TWITCH", approval_status: "PENDING", work_state: "QUEUED" },
      { platform: "YOUTUBE", approval_status: "PENDING", work_state: "QUEUED" },
    ],
  );
});

test("pausing a provider also closes an already-started callback", async () => {
  const { db, raw } = createMigratedD1();
  await seedSession(raw);
  const env = {
    DB: db,
    FRONTEND_URL: "http://localhost:3000",
    USE_MOCK_STREAMER_PROVIDERS: "true",
  } as any;
  const initiation = await app.request(
    "/api/streamers/verify/youtube",
    { headers: { Cookie: COOKIE } },
    env,
  );
  const state = new URL(String(initiation.headers.get("location"))).searchParams.get("state");
  assert.ok(state);
  raw
    .prepare(
      "UPDATE streamer_provider_settings SET new_connections_paused = 1 WHERE platform = 'YOUTUBE'",
    )
    .run();

  const callback = await app.request(
    `/api/streamers/verify/youtube/callback?code=paused-channel&state=${state}`,
    { headers: { Cookie: COOKIE } },
    env,
  );
  assert.equal(callback.status, 302);
  assert.ok(callback.headers.get("location")?.includes("streamer_verify=paused"));
  assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM streamer_profiles").get()?.count, 0);
});

test("GET /api/streamers/me returns independent platform approval states and metrics", async () => {
  const { db, raw } = createMigratedD1();
  await seedSession(raw);
  const profile = raw
    .prepare(
      `INSERT INTO streamer_profiles (user_id, status, created_at, updated_at)
       VALUES (7, 'VERIFIED', ?, ?)`,
    )
    .run(NOW, NOW);
  const streamerId = Number(profile.lastInsertRowid);
  const insertAccount = raw.prepare(
    `INSERT INTO streamer_platform_accounts
       (streamer_id, platform, platform_user_id, channel_name, channel_url,
        verification_status, verified_at, ownership_expires_at, approval_status,
        approval_reason_code, approved_at, audience_count, audience_count_known,
        channel_created_at, metrics_synced_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'VERIFIED', ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
  );
  insertAccount.run(
    streamerId,
    "YOUTUBE",
    "UC123",
    "YouTube Channel",
    "https://youtube.com/@test",
    NOW,
    FUTURE,
    "PENDING",
    null,
    null,
    25_000,
    "2023-01-01T00:00:00.000Z",
    NOW,
    NOW,
    NOW,
  );
  insertAccount.run(
    streamerId,
    "TWITCH",
    "twitch-test",
    "Twitch Channel",
    "https://twitch.tv/test",
    NOW,
    FUTURE,
    "APPROVED",
    "MANUAL_REVIEW_APPROVED",
    NOW,
    12_000,
    "2022-01-01T00:00:00.000Z",
    NOW,
    NOW,
    NOW,
  );

  const res = await app.request("/api/streamers/me", { headers: { Cookie: COOKIE } }, {
    DB: db,
  } as any);
  assert.equal(res.status, 200);

  const json = (await res.json()) as any;
  assert.deepEqual(Object.keys(json.profile).sort(), [
    "createdAt",
    "id",
    "platformAccounts",
    "status",
    "suspendedUntil",
    "updatedAt",
    "userId",
  ]);
  assert.equal(json.profile.status, "VERIFIED");
  assert.equal(json.profile.platformAccounts[0].platform, "YOUTUBE");
  assert.equal(json.profile.platformAccounts[0].approvalStatus, "PENDING");
  assert.equal(json.profile.platformAccounts[0].audienceCount, 25_000);
  assert.equal(json.profile.platformAccounts[1].platform, "TWITCH");
  assert.equal(json.profile.platformAccounts[1].approvalStatus, "APPROVED");
});
