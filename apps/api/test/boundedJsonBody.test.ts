import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_GAME_RESULT_REQUEST_BYTES,
  readBoundedJsonBody,
} from "../src/routes/boundedJsonBody.js";

test("bounded JSON reader parses a body within the byte limit", async () => {
  const request = new Request("https://example.test/result", {
    method: "POST",
    body: JSON.stringify({ message: "안녕" }),
  });
  assert.deepEqual(await readBoundedJsonBody(request, 64), {
    ok: true,
    value: { message: "안녕" },
  });
});

test("bounded JSON reader rejects malformed and absent bodies", async () => {
  assert.deepEqual(
    await readBoundedJsonBody(
      new Request("https://example.test/result", { method: "POST", body: "{" }),
      64,
    ),
    { ok: false, error: "INVALID_JSON" },
  );
  assert.deepEqual(
    await readBoundedJsonBody(new Request("https://example.test/result", { method: "POST" }), 64),
    { ok: false, error: "INVALID_JSON" },
  );
  assert.deepEqual(
    await readBoundedJsonBody(
      new Request("https://example.test/result", {
        method: "POST",
        body: new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]),
      }),
      64,
    ),
    { ok: false, error: "INVALID_JSON" },
  );
});

test("bounded JSON reader rejects declared and streamed bodies above the limit", async () => {
  assert.deepEqual(
    await readBoundedJsonBody(
      new Request("https://example.test/result", {
        method: "POST",
        headers: { "content-length": String(MAX_GAME_RESULT_REQUEST_BYTES + 1) },
        body: "{}",
      }),
      MAX_GAME_RESULT_REQUEST_BYTES,
    ),
    { ok: false, error: "REQUEST_TOO_LARGE" },
  );
  assert.deepEqual(
    await readBoundedJsonBody(
      new Request("https://example.test/result", {
        method: "POST",
        body: JSON.stringify({ evidence: "x".repeat(65) }),
      }),
      64,
    ),
    { ok: false, error: "REQUEST_TOO_LARGE" },
  );
});

test("bounded JSON reader rejects invalid limits", async () => {
  await assert.rejects(
    () =>
      readBoundedJsonBody(
        new Request("https://example.test/result", { method: "POST", body: "{}" }),
        0,
      ),
    RangeError,
  );
});
