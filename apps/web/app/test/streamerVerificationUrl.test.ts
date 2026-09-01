import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { streamerVerificationUrl } from "../features/streamers/streamerApi.js";
import { STREAMER_UI_PLATFORMS } from "../features/streamers/streamerPlatforms.js";
import { streamerVerificationRedirectTarget } from "../routes/streamerVerificationRedirect.js";

test("every supported Streamer OAuth entry uses the configured API origin", () => {
  const apiOrigin = "https://api-stg.owogg.com";
  assert.deepEqual(
    STREAMER_UI_PLATFORMS.map((platform) => streamerVerificationUrl(platform, apiOrigin)),
    [
      "https://api-stg.owogg.com/api/streamers/verify/youtube",
      "https://api-stg.owogg.com/api/streamers/verify/chzzk",
      "https://api-stg.owogg.com/api/streamers/verify/twitch",
    ],
  );
});

test("Streamer OAuth URL normalization never emits a double slash", () => {
  assert.equal(
    streamerVerificationUrl("YOUTUBE", "https://api.example.com///"),
    "https://api.example.com/api/streamers/verify/youtube",
  );
});

test("the settings CTA uses the API-origin URL builder instead of a Web-relative route", () => {
  const settingsSource = readFileSync(new URL("../routes/settings.tsx", import.meta.url), "utf8");
  assert.match(settingsSource, /href=\{streamerVerificationUrl\(platform\)\}/);
  assert.doesNotMatch(settingsSource, /href=\{`\/api\/streamers\/verify\//);
});

test("legacy Web-origin Streamer OAuth paths redirect to the configured API Worker", () => {
  for (const platform of STREAMER_UI_PLATFORMS) {
    const target = streamerVerificationRedirectTarget(
      platform.toLowerCase(),
      "https://api-stg.owogg.com",
    );
    assert.equal(
      target,
      `https://api-stg.owogg.com/api/streamers/verify/${platform.toLowerCase()}`,
    );
  }
});

test("legacy Web-origin Streamer OAuth paths reject unknown providers", () => {
  assert.equal(streamerVerificationRedirectTarget("not-a-provider"), null);
});

test("the route table preserves the legacy Web-origin redirect", () => {
  const routesSource = readFileSync(new URL("../routes.ts", import.meta.url), "utf8");
  assert.match(routesSource, /api\/streamers\/verify\/:platform/);
  assert.match(routesSource, /routes\/streamerVerificationRedirect\.tsx/);
});

test("the legacy route replaces browser history with an API-origin navigation", () => {
  const redirectSource = readFileSync(
    new URL("../routes/streamerVerificationRedirect.tsx", import.meta.url),
    "utf8",
  );
  assert.match(redirectSource, /window\.location\.replace\(target\)/);
});
