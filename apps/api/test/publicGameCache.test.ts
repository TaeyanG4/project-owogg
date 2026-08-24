import assert from "node:assert/strict";
import test from "node:test";
import { publicGameReadCacheUrls } from "../src/routes/publicGameCache.js";

test("public game cache invalidation also targets the separate live resolver origin", () => {
  assert.deepEqual(
    publicGameReadCacheUrls(
      "https://api-stg.owogg.com/api/admin/games/aim%20test",
      ["aim test"],
      "https://play-stg.owogg.com",
    ),
    [
      "https://api-stg.owogg.com/api/games",
      "https://api-stg.owogg.com/api/games/availability",
      "https://api-stg.owogg.com/api/games/aim%20test",
      "https://api-stg.owogg.com/api/games/aim%20test/media/logo",
      "https://play-stg.owogg.com/play/aim%20test",
    ],
  );
});
