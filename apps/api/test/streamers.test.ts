import test from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/app.js";

function createMockDb(sessionUser?: { id: number; nickname: string }) {
  return {
    prepare() {
      return {
        bind() {
          return {
            async first() {
              if (sessionUser) {
                return {
                  id: "valid_session",
                  user_id: sessionUser.id,
                  expires_at: new Date(Date.now() + 86400000).toISOString(),
                  created_at: new Date().toISOString(),
                  nickname: sessionUser.nickname,
                  avatar_url: null,
                };
              }
              return null;
            },
            async all() {
              return { results: [] };
            },
            async run() {
              return { success: true };
            },
          };
        },
        async first() {
          return { total: 0 };
        },
        async all() {
          return { results: [] };
        },
      };
    },
  };
}

test("GET /api/streamers/rankings returns 200 and structure", async () => {
  const mockEnv = {
    DB: createMockDb(),
  };

  const res = await app.request(
    "/api/streamers/rankings?mode=score&platform=YOUTUBE",
    {},
    mockEnv as any,
  );
  assert.equal(res.status, 200);

  const json = (await res.json()) as any;
  assert.equal(Array.isArray(json.entries), true);
  assert.equal(json.mode, "score");
  assert.equal(json.platform, "YOUTUBE");
});

test("the former broadcast-program API path remains a rolling-deploy alias", async () => {
  const res = await app.request("/api/creators/rankings?mode=score&platform=YOUTUBE", {}, {
    DB: createMockDb(),
  } as any);
  assert.equal(res.status, 200);
  const json = (await res.json()) as { entries: unknown[] };
  assert.ok(Array.isArray(json.entries));
});

test("GET /api/streamers/me requires authentication", async () => {
  const mockEnv = { DB: createMockDb() };
  const res = await app.request("/api/streamers/me", {}, mockEnv as any);
  assert.equal(res.status, 401);
});

test("GET /api/streamers/providers returns configuration status for all platforms", async () => {
  const mockEnv = {
    DB: createMockDb(),
    YOUTUBE_CLIENT_ID: "yt-client-id",
    YOUTUBE_CLIENT_SECRET: "yt-secret",
  };

  const res = await app.request("/api/streamers/providers", {}, mockEnv as any);
  assert.equal(res.status, 200);

  const json = (await res.json()) as any;
  assert.equal(json.YOUTUBE.configured, true);
  assert.equal(json.TWITCH.configured, false);
  assert.equal(json.CHZZK.configured, false);
  assert.equal(json.SOOP.configured, false);
});

test("GET /api/streamers/verify/:platform returns unconfigured error when provider missing", async () => {
  const mockEnv = {
    DB: createMockDb({ id: 1, nickname: "Tester" }),
    FRONTEND_URL: "http://localhost:3000",
  };

  const res = await app.request(
    "/api/streamers/verify/youtube",
    {
      headers: { Cookie: "owogg_session=valid_session" },
    },
    mockEnv as any,
  );

  assert.equal(res.status, 302);
  const location = res.headers.get("location");
  assert.ok(location?.includes("streamer_verify=unconfigured"));
});

test("GET /api/streamers/verify/:platform initiates OAuth redirect when provider configured with mock", async () => {
  const mockEnv = {
    DB: createMockDb({ id: 1, nickname: "Tester" }),
    USE_MOCK_STREAMER_PROVIDERS: "true",
  };

  const res = await app.request(
    "/api/streamers/verify/youtube",
    {
      headers: { Cookie: "owogg_session=valid_session" },
    },
    mockEnv as any,
  );

  assert.equal(res.status, 302);
  const location = res.headers.get("location");
  assert.ok(location?.includes("https://mock.owogg.dev/auth/YOUTUBE"));
  assert.ok(location?.includes("state="));

  const setCookie = res.headers.get("set-cookie");
  assert.ok(setCookie?.includes("streamer_verify_state="));
});

test("GET /api/streamers/verify/:platform/callback rejects state mismatch", async () => {
  const mockEnv = {
    DB: createMockDb(),
    FRONTEND_URL: "http://localhost:3000",
  };

  const res = await app.request(
    "/api/streamers/verify/youtube/callback?code=abc&state=badstate",
    {},
    mockEnv as any,
  );

  assert.equal(res.status, 302);
  const location = res.headers.get("location");
  assert.ok(location?.includes("streamer_verify=error"));
  assert.ok(location?.includes("state_mismatch"));
});

test("GET /api/streamers/me returns featuredReview and platform account metrics when present", async () => {
  const mockEnv = {
    DB: {
      prepare(sql: string) {
        if (sql.includes("JOIN users u ON s.user_id = u.id")) {
          return {
            bind() {
              return {
                async first() {
                  return {
                    session_id: "valid_session",
                    user_id: 7,
                    expires_at: new Date(Date.now() + 86400000).toISOString(),
                    session_created_at: new Date().toISOString(),
                    nickname: "Tester",
                    email: null,
                    avatar_url: null,
                    user_created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    country: "KR",
                    nickname_updated_at: null,
                    country_updated_at: null,
                  };
                },
              };
            },
          };
        }
        if (sql.includes("streamer_profiles WHERE user_id =")) {
          return {
            bind() {
              return {
                async first() {
                  return {
                    id: 1,
                    user_id: 7,
                    status: "VERIFIED",
                    featured_status: "NONE",
                    featured_reason: "자동 심사 대기",
                    featured_since: null,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                  };
                },
              };
            },
          };
        }
        if (sql.includes("streamer_platform_accounts WHERE streamer_id =")) {
          return {
            bind() {
              return {
                async all() {
                  return {
                    results: [
                      {
                        id: 11,
                        streamer_id: 1,
                        platform: "YOUTUBE",
                        platform_user_id: "UC123",
                        channel_name: "Test Channel",
                        channel_handle: null,
                        channel_url: "https://youtube.com/@test",
                        avatar_url: null,
                        verification_status: "VERIFIED",
                        verified_at: new Date().toISOString(),
                        audience_count: 25000,
                        audience_count_known: 1,
                        channel_created_at: "2023-01-01T00:00:00.000Z",
                        metrics_synced_at: new Date().toISOString(),
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                      },
                    ],
                  };
                },
              };
            },
          };
        }
        if (sql.includes("streamer_review_jobs")) {
          return {
            bind() {
              return {
                async first() {
                  return {
                    id: 21,
                    streamer_platform_account_id: 11,
                    status: "AUTO_REVIEW_PENDING",
                    initial_audience: 25000,
                    initial_channel_created_at: "2023-01-01T00:00:00.000Z",
                    next_check_at: new Date(Date.now() + 6 * 3600000).toISOString(),
                    attempt_count: 0,
                    last_error: null,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    completed_at: null,
                  };
                },
              };
            },
          };
        }
        return {
          bind() {
            return {
              async first() {
                return null;
              },
              async all() {
                return { results: [] };
              },
              async run() {
                return { success: true };
              },
            };
          },
        };
      },
    },
  };

  const res = await app.request(
    "/api/streamers/me",
    { headers: { Cookie: "owogg_session=valid_session" } },
    mockEnv as any,
  );
  assert.equal(res.status, 200);

  const json = (await res.json()) as any;
  const profile = json.profile;
  assert.equal(profile.status, "VERIFIED");
  assert.equal(profile.platformAccounts[0].platform, "YOUTUBE");
  assert.equal(profile.platformAccounts[0].audienceCount, 25000);
  assert.equal(profile.platformAccounts[0].channelCreatedAt, "2023-01-01T00:00:00.000Z");
  assert.equal(profile.featuredReview.status, "AUTO_REVIEW_PENDING");
  assert.equal(profile.featuredReview.attemptCount, 0);
  assert.ok(profile.featuredReview.nextCheckAt);
});
