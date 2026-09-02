import test from "node:test";
import assert from "node:assert/strict";
import { signGamePreview, verifyGamePreview } from "../src/domain/gamePreview.js";

const secret = "preview-test-secret-with-enough-entropy";
const payload = {
  userId: 7,
  gameId: 11,
  versionId: 13,
  nonce: "preview-nonce",
  exp: 2_000,
} as const;

test("gp1 signs and verifies one exact creator draft capability", async () => {
  const token = await signGamePreview(payload, secret);
  assert.match(token, /^gp1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(await verifyGamePreview(token, secret, 1_999), { ok: true, payload });
});

test("gp1 rejects claim or signature substitutions", async () => {
  const token = await signGamePreview(payload, secret);
  const [version, encodedPayload, signature] = token.split(".");
  assert.ok(version && encodedPayload && signature);

  const changedPayload = `${encodedPayload.slice(0, -1)}${encodedPayload.endsWith("A") ? "B" : "A"}`;
  assert.equal(
    (await verifyGamePreview(`${version}.${changedPayload}.${signature}`, secret)).ok,
    false,
  );
  assert.deepEqual(await verifyGamePreview(token, `${secret}-wrong`, 1_999), {
    ok: false,
    error: "BAD_SIGNATURE",
  });
});

test("gp1 expiry is exclusive and malformed tokens never throw", async () => {
  const token = await signGamePreview(payload, secret);
  assert.deepEqual(await verifyGamePreview(token, secret, payload.exp), {
    ok: false,
    error: "EXPIRED",
  });
  assert.deepEqual(await verifyGamePreview("gs1.not-a-preview.signature", secret), {
    ok: false,
    error: "MALFORMED",
  });
});
