import assert from "node:assert/strict";
import test from "node:test";
import {
  MULTIPLAYER_ERROR_CODES,
  MULTIPLAYER_ERROR_HTTP_STATUS,
  isMultiplayerErrorCode,
  multiplayerFailure,
} from "../src/modules/multiplayer/domain/multiplayerErrors.js";

test("every stable multiplayer error code has one valid HTTP status", () => {
  assert.deepEqual(Object.keys(MULTIPLAYER_ERROR_HTTP_STATUS), [...MULTIPLAYER_ERROR_CODES]);
  for (const status of Object.values(MULTIPLAYER_ERROR_HTTP_STATUS)) {
    assert.ok(Number.isInteger(status));
    assert.ok(status >= 400 && status < 600);
  }
});

test("rejects arbitrary error strings and marks only recoverable failures retryable", () => {
  assert.equal(isMultiplayerErrorCode("STALE_GENERATION"), true);
  assert.equal(isMultiplayerErrorCode("database exploded: secret=abc"), false);
  assert.deepEqual(multiplayerFailure("STALE_GENERATION"), {
    ok: false,
    error: { code: "STALE_GENERATION", retryable: true },
  });
  assert.deepEqual(multiplayerFailure("NOT_PARTICIPANT"), {
    ok: false,
    error: { code: "NOT_PARTICIPANT", retryable: false },
  });
});
