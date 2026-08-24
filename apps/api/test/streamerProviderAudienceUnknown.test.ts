import test from "node:test";
import assert from "node:assert/strict";
import { YouTubeStreamerProvider } from "../src/infrastructure/streamers/youtube.js";
import { ChzzkStreamerProvider } from "../src/infrastructure/streamers/chzzk.js";
import { SoopStreamerProvider } from "../src/infrastructure/streamers/soop.js";

// UNKNOWN vs known-zero audience must be distinguished at initial channel-ownership
// verification, not just at the 6-hour metric-refresh path (which already handled this
// correctly). A provider omitting the audience field must never be coerced to 0.

function withMockFetch(handler: (url: string) => Response, fn: () => Promise<void>) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: URL | RequestInfo | string) => {
    return handler(String(input));
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

test("CHZZK: missing followerCount leaves audienceCount undefined (UNKNOWN)", async () => {
  await withMockFetch(
    (url) => {
      if (url.includes("nid.naver.com/oauth2.0/token")) {
        return Response.json({ access_token: "tok" });
      }
      if (url.includes("openapi.chzzk.naver.com/open/v1/users/me")) {
        return Response.json({ content: { channelId: "abc123", channelName: "Ch" } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    },
    async () => {
      const provider = new ChzzkStreamerProvider("id", "secret");
      const info = await provider.verifyOwnershipCode("code", "redirect");
      assert.equal(info.audienceCount, undefined);
    },
  );
});

test("CHZZK: explicit followerCount of 0 is a known zero", async () => {
  await withMockFetch(
    (url) => {
      if (url.includes("nid.naver.com/oauth2.0/token")) {
        return Response.json({ access_token: "tok" });
      }
      if (url.includes("openapi.chzzk.naver.com/open/v1/users/me")) {
        return Response.json({
          content: { channelId: "abc123", channelName: "Ch", followerCount: 0 },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    },
    async () => {
      const provider = new ChzzkStreamerProvider("id", "secret");
      const info = await provider.verifyOwnershipCode("code", "redirect");
      assert.equal(info.audienceCount, 0);
    },
  );
});

test("SOOP: missing fan_count leaves audienceCount undefined (UNKNOWN)", async () => {
  await withMockFetch(
    (url) => {
      if (url.includes("openapi.sooplive.co.kr/auth/token")) {
        return Response.json({ access_token: "tok" });
      }
      if (url.includes("openapi.sooplive.co.kr/user/me")) {
        return Response.json({ user_id: "streamer1" });
      }
      throw new Error(`unexpected fetch: ${url}`);
    },
    async () => {
      const provider = new SoopStreamerProvider("id", "secret");
      const info = await provider.verifyOwnershipCode("code", "redirect");
      assert.equal(info.audienceCount, undefined);
    },
  );
});

test("SOOP: explicit fan_count of 0 is a known zero", async () => {
  await withMockFetch(
    (url) => {
      if (url.includes("openapi.sooplive.co.kr/auth/token")) {
        return Response.json({ access_token: "tok" });
      }
      if (url.includes("openapi.sooplive.co.kr/user/me")) {
        return Response.json({ user_id: "streamer1", fan_count: 0 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    },
    async () => {
      const provider = new SoopStreamerProvider("id", "secret");
      const info = await provider.verifyOwnershipCode("code", "redirect");
      assert.equal(info.audienceCount, 0);
    },
  );
});
