import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createSign, type KeyObject } from "node:crypto";
import {
  buildDiscordAuthorizeUrl,
  exchangeDiscordCode,
} from "../src/infrastructure/oauth/discord.js";
import {
  exchangeGoogleAuthorizationCode,
  verifyGoogleToken,
  clearGoogleJwksCache,
} from "../src/infrastructure/oauth/google.ts";

test("buildDiscordAuthorizeUrl constructs correct Discord OAuth URL", () => {
  const url = buildDiscordAuthorizeUrl({
    clientId: "12345",
    redirectUri: "http://localhost/api/auth/discord/callback",
    state: "random-csrf-token",
  });

  assert.ok(url.startsWith("https://discord.com/oauth2/authorize"));
  assert.ok(url.includes("client_id=12345"));
  assert.ok(url.includes("response_type=code"));
  assert.ok(url.includes("scope=identify+email"));
  assert.ok(url.includes("state=random-csrf-token"));
});

test("exchangeDiscordCode handles token exchange failure gracefully", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => {
      return new Response("Unauthorized", { status: 401 });
    }) as unknown as typeof fetch;

    const res = await exchangeDiscordCode({
      code: "bad-code",
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: "http://localhost/callback",
    });

    assert.equal(res.valid, false);
    assert.equal(res.reason, "Failed to exchange code for token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("exchangeGoogleAuthorizationCode sends the exact popup grant and returns only the ID token", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  try {
    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      capturedInit = init;
      return new Response(
        JSON.stringify({
          access_token: "must-not-leave-the-exchange-boundary",
          refresh_token: "must-not-be-retained",
          id_token: "signed-google-id-token",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const result = await exchangeGoogleAuthorizationCode({
      code: "one-time-browser-code",
      clientId: "client.apps.googleusercontent.com",
      clientSecret: "server-only-secret",
      redirectUri: "https://stg.owogg.com",
    });

    assert.equal(capturedUrl, "https://oauth2.googleapis.com/token");
    assert.equal(capturedInit?.method, "POST");
    const form = new URLSearchParams(String(capturedInit?.body));
    assert.deepEqual(Object.fromEntries(form), {
      code: "one-time-browser-code",
      client_id: "client.apps.googleusercontent.com",
      client_secret: "server-only-secret",
      redirect_uri: "https://stg.owogg.com",
      grant_type: "authorization_code",
    });
    assert.deepEqual(result, { valid: true, idToken: "signed-google-id-token" });
    assert.equal("accessToken" in result, false);
    assert.equal("refreshToken" in result, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("exchangeGoogleAuthorizationCode fails closed on rejection or a missing ID token", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response("invalid_grant", { status: 400 })) as typeof fetch;
    const rejected = await exchangeGoogleAuthorizationCode({
      code: "rejected",
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: "https://stg.owogg.com",
    });
    assert.deepEqual(rejected, {
      valid: false,
      reason: "Google authorization code exchange failed",
    });

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ access_token: "ignored" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;
    const missingIdToken = await exchangeGoogleAuthorizationCode({
      code: "no-id-token",
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: "https://stg.owogg.com",
    });
    assert.deepEqual(missingIdToken, {
      valid: false,
      reason: "Google token response did not contain an ID token",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// Google ID Token (JWT) verification tests — JWKS/network boundaries mocked.
// ---------------------------------------------------------------------------

const GOOGLE_JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs";
const CLIENT_ID = "test-google-client-id.apps.googleusercontent.com";

function base64UrlEncode(buf: Uint8Array): string {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function buildJwt(
  privateKey: KeyObject,
  payload: Record<string, unknown>,
  headerKid = "test-kid-1",
  signWithKey = true,
): string {
  const headerB64 = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT", kid: headerKid })),
  );
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  let signatureB64: string;
  if (signWithKey) {
    const signer = createSign("RSA-SHA256");
    signer.update(signingInput);
    const sig = signer.sign(privateKey);
    signatureB64 = base64UrlEncode(new Uint8Array(sig));
  } else {
    signatureB64 = base64UrlEncode(new TextEncoder().encode("not-a-valid-signature"));
  }

  return `${signingInput}.${signatureB64}`;
}

interface TestKeySet {
  privateKey: KeyObject;
  publicJwk: Record<string, string>;
}

function createRsaKeySet(): TestKeySet {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicJwk = publicKey.export({ format: "jwk" }) as Record<string, string>;
  return { privateKey, publicJwk };
}

function mockJwksFetch(keys: Record<string, string>[]): {
  install: () => void;
  restore: () => void;
} {
  const originalFetch = globalThis.fetch;
  return {
    install() {
      globalThis.fetch = (async (input: URL | RequestInfo | string) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === GOOGLE_JWKS_URI) {
          return new Response(JSON.stringify({ keys }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("Not Found", { status: 404 });
      }) as unknown as typeof fetch;
    },
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    exp: Math.floor(Date.now() / 1000) + 3600,
    sub: "google-sub-123",
    email: "user@example.com",
    email_verified: true,
    name: "Test User",
    picture: "https://example.com/avatar.png",
    ...overrides,
  };
}

test("verifyGoogleToken accepts a valid signed token and returns the profile", async () => {
  clearGoogleJwksCache();
  const { privateKey, publicJwk } = createRsaKeySet();
  const mock = mockJwksFetch([{ ...publicJwk, kid: "test-kid-1", use: "sig", alg: "RS256" }]);
  mock.install();
  try {
    const token = buildJwt(privateKey, validPayload());
    const res = await verifyGoogleToken(token, CLIENT_ID);
    assert.equal(res.valid, true);
    assert.ok(res.profile);
    assert.equal(res.profile.sub, "google-sub-123");
    assert.equal(res.profile.email, "user@example.com");
    assert.equal(res.profile.emailVerified, true);
    assert.equal(res.profile.name, "Test User");
    assert.equal(res.profile.picture, "https://example.com/avatar.png");
  } finally {
    mock.restore();
  }
});

test("verifyGoogleToken rejects an invalid signature", async () => {
  clearGoogleJwksCache();
  const { privateKey, publicJwk } = createRsaKeySet();
  // JWKS contains a DIFFERENT public key than the signing key.
  const other = createRsaKeySet();
  const mock = mockJwksFetch([{ ...other.publicJwk, kid: "test-kid-1", use: "sig", alg: "RS256" }]);
  mock.install();
  try {
    const token = buildJwt(privateKey, validPayload());
    const res = await verifyGoogleToken(token, CLIENT_ID);
    assert.equal(res.valid, false);
    assert.equal(res.reason, "Invalid signature");
  } finally {
    mock.restore();
  }
});

test("verifyGoogleToken rejects a wrong audience", async () => {
  clearGoogleJwksCache();
  const { privateKey } = createRsaKeySet();
  const token = buildJwt(privateKey, validPayload({ aud: "some-other-client-id" }));
  const res = await verifyGoogleToken(token, CLIENT_ID);
  assert.equal(res.valid, false);
  assert.equal(res.reason, "Audience mismatch");
});

test("verifyGoogleToken rejects a wrong issuer", async () => {
  clearGoogleJwksCache();
  const { privateKey } = createRsaKeySet();
  const token = buildJwt(privateKey, validPayload({ iss: "https://evil.example.com" }));
  const res = await verifyGoogleToken(token, CLIENT_ID);
  assert.equal(res.valid, false);
  assert.equal(res.reason, "Invalid issuer");
});

test("verifyGoogleToken rejects an expired token", async () => {
  clearGoogleJwksCache();
  const { privateKey } = createRsaKeySet();
  const token = buildJwt(privateKey, validPayload({ exp: Math.floor(Date.now() / 1000) - 3600 }));
  const res = await verifyGoogleToken(token, CLIENT_ID);
  assert.equal(res.valid, false);
  assert.equal(res.reason, "Token expired");
});

test("verifyGoogleToken rejects a token missing sub", async () => {
  clearGoogleJwksCache();
  const { privateKey } = createRsaKeySet();
  const token = buildJwt(privateKey, validPayload({ sub: undefined }));
  const res = await verifyGoogleToken(token, CLIENT_ID);
  assert.equal(res.valid, false);
  assert.equal(res.reason, "Missing subject (sub)");
});

test("verifyGoogleToken rejects a malformed token", async () => {
  clearGoogleJwksCache();
  const res = await verifyGoogleToken("not-a-jwt", CLIENT_ID);
  assert.equal(res.valid, false);
  assert.equal(res.reason, "Malformed Google ID token");
});

test("verifyGoogleToken rejects when no client ID is configured", async () => {
  clearGoogleJwksCache();
  const { privateKey } = createRsaKeySet();
  const token = buildJwt(privateKey, validPayload());
  const res = await verifyGoogleToken(token, undefined);
  assert.equal(res.valid, false);
  assert.equal(res.reason, "Audience cannot be verified without a configured client ID");
});

test("verifyGoogleToken handles JWKS fetch failure gracefully", async () => {
  clearGoogleJwksCache();
  const { privateKey } = createRsaKeySet();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response("Internal Server Error", { status: 500 });
  }) as unknown as typeof fetch;
  try {
    const token = buildJwt(privateKey, validPayload());
    const res = await verifyGoogleToken(token, CLIENT_ID);
    assert.equal(res.valid, false);
    assert.match(res.reason ?? "", /Failed to fetch Google JWKS/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
