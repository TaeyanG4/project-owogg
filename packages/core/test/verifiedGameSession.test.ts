import test from "node:test";
import assert from "node:assert/strict";
import {
  verifiedGameSessionMatches,
  signVerifiedGameSession,
  verifyGameSession,
  verifyVerifiedGameSession,
  type VerifiedGameSessionPayload,
} from "../src/index.js";

const SECRET = "gs2-test-secret-do-not-use";
const NOW_SECONDS = 2_000_000_000;

function samplePayload(
  overrides: Partial<VerifiedGameSessionPayload> = {},
): VerifiedGameSessionPayload {
  return {
    userId: 7,
    gameId: 41,
    versionId: 9,
    attemptId: "11111111-1111-1111-1111-111111111111",
    playMode: "local-multi",
    difficultyId: "hard",
    variantId: "standard",
    rewardFactor: 1.25,
    rulesetRevision: 3,
    verifierId: "owogg:verified-board-v1",
    challengeSeed: "22222222-2222-2222-2222-222222222222",
    issuedAtMs: NOW_SECONDS * 1000,
    exp: NOW_SECONDS + 300,
    ...overrides,
  };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signRawPayload(payload: unknown): Promise<string> {
  const encoded = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const input = `gs2.${encoded}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(input)),
  );
  return `${input}.${bytesToBase64Url(signature)}`;
}

test("gs2 signs and verifies the exact canonical attempt context", async () => {
  const payload = samplePayload();
  const token = await signVerifiedGameSession(payload, SECRET);
  assert.equal(token.split(".")[0], "gs2");
  const verified = await verifyVerifiedGameSession(token, SECRET, NOW_SECONDS);
  assert.deepEqual(verified, { ok: true, payload });
});

test("gs1 and gs2 remain mutually exclusive without changing gs1 verification", async () => {
  const token = await signVerifiedGameSession(samplePayload(), SECRET);
  assert.deepEqual(await verifyGameSession(token, SECRET, NOW_SECONDS), {
    ok: false,
    error: "MALFORMED",
  });
  assert.deepEqual(
    await verifyVerifiedGameSession(token.replace(/^gs2\./, "gs1."), SECRET, NOW_SECONDS),
    {
      ok: false,
      error: "MALFORMED",
    },
  );
});

test("gs2 rejects a correctly signed payload with unknown or malformed fields", async () => {
  const valid = samplePayload();
  for (const malformed of [
    { ...valid, unexpected: true },
    { ...valid, playMode: "online-multi" },
    { ...valid, rewardFactor: 0 },
    { ...valid, rulesetRevision: 0 },
    { ...valid, challengeSeed: "short" },
    { ...valid, issuedAtMs: valid.exp * 1000 },
  ]) {
    const verified = await verifyVerifiedGameSession(
      await signRawPayload(malformed),
      SECRET,
      NOW_SECONDS,
    );
    assert.equal(verified.ok, false, JSON.stringify(malformed));
    assert.equal(verified.ok ? null : verified.error, "MALFORMED");
  }
});

test("gs2 rejects every unsigned claim substitution", async () => {
  const token = await signVerifiedGameSession(samplePayload(), SECRET);
  const [version, encodedPayload, signature] = token.split(".");
  assert.ok(version && encodedPayload && signature);
  const decoded = JSON.parse(
    new TextDecoder().decode(
      Uint8Array.from(
        atob(
          encodedPayload.replace(/-/g, "+").replace(/_/g, "/") +
            "=".repeat((4 - (encodedPayload.length % 4)) % 4),
        ),
        (character) => character.charCodeAt(0),
      ),
    ),
  ) as VerifiedGameSessionPayload;
  const substitutions: Partial<VerifiedGameSessionPayload>[] = [
    { userId: 8 },
    { gameId: 42 },
    { versionId: 10 },
    { playMode: "single" },
    { difficultyId: "normal" },
    { variantId: "precision" },
    { rewardFactor: 99 },
    { rulesetRevision: 4 },
    { verifierId: "official:other" },
    { challengeSeed: "33333333-3333-3333-3333-333333333333" },
    { issuedAtMs: decoded.issuedAtMs + 1 },
  ];
  for (const substitution of substitutions) {
    const tamperedPayload = bytesToBase64Url(
      new TextEncoder().encode(JSON.stringify({ ...decoded, ...substitution })),
    );
    const verified = await verifyVerifiedGameSession(
      `${version}.${tamperedPayload}.${signature}`,
      SECRET,
      NOW_SECONDS,
    );
    assert.equal(verified.ok, false, JSON.stringify(substitution));
    assert.equal(verified.ok ? null : verified.error, "BAD_SIGNATURE");
  }
});

test("gs2 expiry is exclusive", async () => {
  const token = await signVerifiedGameSession(samplePayload({ exp: NOW_SECONDS + 1 }), SECRET);
  assert.equal((await verifyVerifiedGameSession(token, SECRET, NOW_SECONDS)).ok, true);
  assert.deepEqual(await verifyVerifiedGameSession(token, SECRET, NOW_SECONDS + 1), {
    ok: false,
    error: "EXPIRED",
  });
});

test("verifiedGameSessionMatches rejects stale runtime and PlayConfig claims", () => {
  const payload = samplePayload();
  const expected = {
    userId: payload.userId,
    gameId: payload.gameId,
    versionId: payload.versionId,
    playMode: payload.playMode,
    difficultyId: payload.difficultyId,
    variantId: payload.variantId,
    rewardFactor: payload.rewardFactor,
    rulesetRevision: payload.rulesetRevision,
    verifierId: payload.verifierId,
  };
  assert.equal(verifiedGameSessionMatches(payload, expected), true);
  assert.equal(verifiedGameSessionMatches(payload, { ...expected, variantId: "precision" }), false);
  assert.equal(verifiedGameSessionMatches(payload, { ...expected, playMode: "single" }), false);
});

test("the gs2 signer refuses non-canonical caller objects", async () => {
  await assert.rejects(
    () =>
      signVerifiedGameSession(
        { ...samplePayload(), verifierId: "INVALID VERIFIER" } as VerifiedGameSessionPayload,
        SECRET,
      ),
    /Invalid gs2 payload/,
  );
});
