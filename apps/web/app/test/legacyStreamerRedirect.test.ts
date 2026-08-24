import assert from "node:assert/strict";
import test from "node:test";
import { legacyStreamerRedirectTarget } from "../routes/legacyStreamerRedirect.js";

test("former broadcast-program bookmarks redirect to Streamer routes", () => {
  assert.equal(legacyStreamerRedirectTarget("/admin/creators"), "/admin/streamers");
  assert.equal(legacyStreamerRedirectTarget("/wiki/creator"), "/wiki/streamer");
  assert.equal(
    legacyStreamerRedirectTarget("/wiki/creator/verification"),
    "/wiki/streamer/verification",
  );
  assert.equal(legacyStreamerRedirectTarget("/wiki/creator/featured"), "/wiki/streamer/featured");
});
