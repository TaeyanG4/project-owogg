import test from "node:test";
import assert from "node:assert/strict";
import { YouTubeStreamerProvider } from "../src/infrastructure/streamers/youtube.js";
import { TwitchStreamerProvider } from "../src/infrastructure/streamers/twitch.js";
import { ChzzkStreamerProvider } from "../src/infrastructure/streamers/chzzk.js";
import { SoopStreamerProvider } from "../src/infrastructure/streamers/soop.js";

// UNKNOWN vs known-zero audience must be distinguished in both ownership verification and
// manual metric refresh. A provider omitting the audience field must never be coerced to 0.

function withMockFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
  fn: () => Promise<void>,
) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: URL | RequestInfo | string, init?: RequestInit) => {
    return handler(String(input), init);
  }) as unknown as typeof fetch;
  return fn().finally(() => {
    globalThis.fetch = originalFetch;
  });
}

test("YouTube: channel hiding subscriberCount leaves audienceCount undefined (UNKNOWN)", async () => {
  await withMockFetch(
    (url) => {
      if (url.includes("oauth2.googleapis.com/token")) {
        return Response.json({ access_token: "tok" });
      }
      if (url.includes("youtube/v3/channels")) {
        return Response.json({
          items: [{ id: "UC1", snippet: { title: "Ch", publishedAt: "2020-01-01T00:00:00Z" } }],
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    },
    async () => {
      const provider = new YouTubeStreamerProvider("id", "secret", "apikey");
      const info = await provider.verifyOwnershipCode("code", "redirect");
      assert.equal(info.audienceCount, undefined);
      assert.equal(info.platformUserId, "UC1");
    },
  );
});

test("Twitch: canonical identity comes from the user bound to the exchanged access token", async () => {
  const provider = new TwitchStreamerProvider("id", "secret");
  const authorizeUrl = new URL(provider.getAuthorizeUrl("nonce", "https://app.test/callback"));
  assert.equal(authorizeUrl.searchParams.get("scope"), "");
  assert.equal(authorizeUrl.searchParams.has("state"), true);

  await withMockFetch(
    (url) => {
      if (url.includes("id.twitch.tv/oauth2/token")) {
        return Response.json({ access_token: "user-token" });
      }
      if (url.includes("api.twitch.tv/helix/users")) {
        return Response.json({
          data: [
            {
              id: "canonical-twitch-id",
              login: "owner_login",
              display_name: "Owner",
              created_at: "2020-01-01T00:00:00Z",
            },
          ],
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    },
    async () => {
      const info = await provider.verifyOwnershipCode("one-time-code", "redirect");
      assert.equal(info.platformUserId, "canonical-twitch-id");
      assert.equal(info.channelHandle, "@owner_login");
    },
  );
});

test("YouTube: explicit subscriberCount of 0 is a known zero", async () => {
  await withMockFetch(
    (url) => {
      if (url.includes("oauth2.googleapis.com/token")) {
        return Response.json({ access_token: "tok" });
      }
      if (url.includes("youtube/v3/channels")) {
        return Response.json({
          items: [
            {
              id: "UC1",
              snippet: { title: "Ch", publishedAt: "2020-01-01T00:00:00Z" },
              statistics: { subscriberCount: "0" },
            },
          ],
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    },
    async () => {
      const provider = new YouTubeStreamerProvider("id", "secret", "apikey");
      const info = await provider.verifyOwnershipCode("code", "redirect");
      assert.equal(info.audienceCount, 0);
    },
  );
});

test("CHZZK: current OAuth contract returns canonical channel with UNKNOWN audience", async () => {
  const provider = new ChzzkStreamerProvider("id", "secret");
  const authorizeUrl = new URL(provider.getAuthorizeUrl("nonce", "https://app.test/callback"));
  assert.equal(
    authorizeUrl.origin + authorizeUrl.pathname,
    "https://chzzk.naver.com/account-interlock",
  );
  assert.equal(authorizeUrl.searchParams.get("clientId"), "id");
  assert.equal(authorizeUrl.searchParams.get("redirectUri"), "https://app.test/callback");
  assert.equal(authorizeUrl.searchParams.get("state"), "nonce");

  let tokenRequest: RequestInit | undefined;
  await withMockFetch(
    (url, init) => {
      if (url.includes("openapi.chzzk.naver.com/auth/v1/token")) {
        tokenRequest = init;
        return Response.json({ content: { accessToken: "tok" } });
      }
      if (url.includes("openapi.chzzk.naver.com/open/v1/users/me")) {
        return Response.json({ content: { channelId: "abc123", channelName: "Ch" } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    },
    async () => {
      const info = await provider.verifyOwnershipCode("code", "redirect", { state: "nonce" });
      assert.equal(info.audienceCount, undefined);
      assert.equal(info.platformUserId, "abc123");
    },
  );

  assert.equal(
    tokenRequest?.headers && new Headers(tokenRequest.headers).get("Content-Type"),
    "application/json",
  );
  assert.deepEqual(JSON.parse(String(tokenRequest?.body)), {
    grantType: "authorization_code",
    clientId: "id",
    clientSecret: "secret",
    code: "code",
    state: "nonce",
  });
});

test("CHZZK: metric refresh preserves an explicit followerCount of 0", async () => {
  await withMockFetch(
    (url) => {
      if (url.includes("openapi.chzzk.naver.com/open/v1/channels")) {
        return Response.json({ content: { data: [{ followerCount: 0 }] } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    },
    async () => {
      const provider = new ChzzkStreamerProvider("id", "secret");
      const metrics = await provider.fetchChannelMetrics("abc123");
      assert.equal(metrics.audienceCount, 0);
    },
  );
});

test("SOOP: browser ownership verification stays fail-closed while callback binding is unavailable", async () => {
  const provider = new SoopStreamerProvider("id", "secret");
  assert.equal(provider.isConfigured(), true);
  assert.equal(provider.verificationMethod, "UNAVAILABLE");
  assert.throws(
    () => provider.getAuthorizeUrl("nonce", "https://app.test/callback"),
    /not safely supported/,
  );
  await assert.rejects(
    () => provider.verifyOwnershipCode("code", "https://app.test/callback"),
    /deferred/,
  );
});
