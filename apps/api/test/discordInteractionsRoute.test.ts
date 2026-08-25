import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { app } from "../src/app.js";

function toHex(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf).toString("hex");
}

function makeEd25519KeyPair(): { publicKeyHex: string; privateKey: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" }) as { x: string };
  return { publicKeyHex: toHex(Buffer.from(jwk.x, "base64url")), privateKey };
}

function signMessage(privateKey: KeyObject, message: string): string {
  return toHex(sign(null, Buffer.from(message), privateKey));
}

test("GET /api/discord/status reports non-secret readiness", async () => {
  const res = await app.request("http://localhost/api/discord/status");
  assert.equal(res.status, 200);
  const data = (await res.json()) as { configured: boolean };
  assert.equal(typeof data.configured, "boolean");
});

test("GET /api/discord/status only exposes an explicitly configured Discord install URL", async () => {
  const safe = await app.request("http://localhost/api/discord/status", {}, {
    DISCORD_INSTALL_URL:
      "https://discord.com/oauth2/authorize?client_id=123&scope=applications.commands",
  } as any);
  assert.equal(
    (await safe.json()).installUrl,
    "https://discord.com/oauth2/authorize?client_id=123&scope=applications.commands",
  );

  const unsafe = await app.request("http://localhost/api/discord/status", {}, {
    DISCORD_INSTALL_URL: "https://example.com/install?token=secret",
  } as any);
  assert.equal((await unsafe.json()).installUrl, null);
});

test("POST /api/discord/interactions returns 500 when DISCORD_PUBLIC_KEY is not configured", async () => {
  const res = await app.request("http://localhost/api/discord/interactions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: 1 }),
  });
  assert.equal(res.status, 500);
});

test("POST /api/discord/interactions returns PONG for a validly-signed PING", async () => {
  const { publicKeyHex, privateKey } = makeEd25519KeyPair();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const rawBody = JSON.stringify({ type: 1 });
  const signatureHex = signMessage(privateKey, timestamp + rawBody);

  const res = await app.request(
    "http://localhost/api/discord/interactions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature-Ed25519": signatureHex,
        "X-Signature-Timestamp": timestamp,
      },
      body: rawBody,
    },
    { DISCORD_PUBLIC_KEY: publicKeyHex },
  );

  assert.equal(res.status, 200);
  const json = (await res.json()) as { type: number };
  assert.equal(json.type, 1);
});

test("POST /api/discord/interactions rejects an invalid signature with 401", async () => {
  const { publicKeyHex } = makeEd25519KeyPair();
  const rawBody = JSON.stringify({ type: 1 });

  const res = await app.request(
    "http://localhost/api/discord/interactions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature-Ed25519": "00".repeat(64),
        "X-Signature-Timestamp": "1700000000",
      },
      body: rawBody,
    },
    { DISCORD_PUBLIC_KEY: publicKeyHex },
  );

  assert.equal(res.status, 401);
});

test("POST /api/discord/interactions rejects a request with a tampered body", async () => {
  const { publicKeyHex, privateKey } = makeEd25519KeyPair();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signatureHex = signMessage(privateKey, timestamp + JSON.stringify({ type: 1 }));

  const res = await app.request(
    "http://localhost/api/discord/interactions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature-Ed25519": signatureHex,
        "X-Signature-Timestamp": timestamp,
      },
      // Signed for {type:1} but the actual body sent is different.
      body: JSON.stringify({ type: 2 }),
    },
    { DISCORD_PUBLIC_KEY: publicKeyHex },
  );

  assert.equal(res.status, 401);
});

test("POST /api/discord/interactions returns a safe fallback for an unrecognized command without a DB binding", async () => {
  const { publicKeyHex, privateKey } = makeEd25519KeyPair();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const rawBody = JSON.stringify({
    type: 2,
    data: { name: "owogg", options: [{ name: "games", type: 1 }] },
    member: { user: { id: "123", username: "tester" } },
  });
  const signatureHex = signMessage(privateKey, timestamp + rawBody);

  const res = await app.request(
    "http://localhost/api/discord/interactions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature-Ed25519": signatureHex,
        "X-Signature-Timestamp": timestamp,
      },
      body: rawBody,
    },
    { DISCORD_PUBLIC_KEY: publicKeyHex },
  );

  assert.equal(res.status, 200);
  const json = (await res.json()) as { data?: { content?: string } };
  assert.match(json.data?.content ?? "", /일시적으로/);
});
