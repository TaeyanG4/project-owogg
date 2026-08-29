import assert from "node:assert/strict";
import test from "node:test";
import {
  MULTIPLAYER_JOIN_TICKET_POLICY,
  MULTIPLAYER_TICKET_AUDIENCE,
  MULTIPLAYER_TICKET_ISSUER,
  MULTIPLAYER_TICKET_PROTOCOL_PREFIX,
  MULTIPLAYER_WEBSOCKET_PROTOCOL,
  buildMultiplayerWebSocketProtocols,
  createMultiplayerTicketKeyring,
  parseMultiplayerJoinTicketClaims,
  parseMultiplayerWebSocketProtocols,
  signMultiplayerJoinTicket,
  verifyMultiplayerJoinTicket,
  type MultiplayerRelayJoinTicketClaims,
} from "../src/index.js";

const NOW = 1_800_000_000;
const ACTIVE_SECRET = "active-multiplayer-ticket-secret-32-bytes-minimum";
const PREVIOUS_SECRET = "previous-multiplayer-ticket-secret-32-bytes-minimum";

function claims(
  overrides: Partial<MultiplayerRelayJoinTicketClaims> = {},
): MultiplayerRelayJoinTicketClaims {
  return {
    iss: MULTIPLAYER_TICKET_ISSUER,
    aud: MULTIPLAYER_TICKET_AUDIENCE,
    kid: "active_2026_08",
    iat: NOW,
    exp: NOW + MULTIPLAYER_JOIN_TICKET_POLICY.EXPIRY_SECONDS,
    jti: "join_nonce_1234567890",
    instanceId: "instance_12345678",
    participantId: "participant_12345678",
    userId: 17,
    gameVersionId: 41,
    profileId: 19,
    profileRevision: 3,
    generation: 2,
    connectionGeneration: 4,
    seatIndex: 1,
    role: "PLAYER",
    contentHash: "b".repeat(64),
    runtime: {
      kind: "relay",
      protocolVersion: 1,
      reconnect: "resume",
      directMessages: true,
      hostSnapshot: true,
      maxMessageBytes: 4 * 1024,
      maxSnapshotBytes: 16 * 1024,
      messagesPerSecond: 20,
      roomBytesPerSecond: 256 * 1024,
      roomTtlSeconds: 2 * 60 * 60,
      hostDeparturePolicy: "close",
      resultTrust: "UNVERIFIED",
    },
    ...overrides,
  };
}

const keyring = createMultiplayerTicketKeyring({ kid: "active_2026_08", secret: ACTIVE_SECRET }, [
  { kid: "previous_2026_07", secret: PREVIOUS_SECRET },
]);

test("multiplayer join ticket signs and verifies exact route/admission context", async () => {
  const token = await signMultiplayerJoinTicket(claims(), keyring);
  const result = await verifyMultiplayerJoinTicket(
    token,
    keyring,
    {
      instanceId: "instance_12345678",
      participantId: "participant_12345678",
      userId: 17,
      profileId: 19,
      generation: 2,
      connectionGeneration: 4,
      seatIndex: 1,
    },
    NOW,
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.claims, claims());
});

test("Relay ticket carries only generic server-owned runtime authority", async () => {
  const expected = claims();
  const token = await signMultiplayerJoinTicket(expected, keyring);
  const result = await verifyMultiplayerJoinTicket(token, keyring, {}, NOW);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.claims, expected);
  assert.equal("rulesetKey" in result.claims, false);
  assert.equal("rulesetRevision" in result.claims, false);
});

test("Relay ticket rejects elevated, contradictory, and unknown runtime policy", () => {
  const valid = claims();
  assert.equal(parseMultiplayerJoinTicketClaims({ ...valid, contentHash: "latest" }), null);
  assert.equal(
    parseMultiplayerJoinTicketClaims({
      ...valid,
      runtime: { ...valid.runtime, roomBytesPerSecond: 256 * 1024 + 1 },
    }),
    null,
  );
  assert.equal(
    parseMultiplayerJoinTicketClaims({
      ...valid,
      runtime: { ...valid.runtime, hostSnapshot: false },
    }),
    null,
  );
  assert.equal(
    parseMultiplayerJoinTicketClaims({
      ...valid,
      runtime: { ...valid.runtime, gameRules: "creator-supplied" },
    }),
    null,
  );
});

test("multiplayer join ticket supports an explicit previous verification key", async () => {
  const oldKeyring = createMultiplayerTicketKeyring({
    kid: "previous_2026_07",
    secret: PREVIOUS_SECRET,
  });
  const token = await signMultiplayerJoinTicket(claims({ kid: "previous_2026_07" }), oldKeyring);
  const result = await verifyMultiplayerJoinTicket(token, keyring, {}, NOW);
  assert.equal(result.ok, true);
});

test("multiplayer join ticket rejects tampering, unknown keys, and mismatched context", async () => {
  const token = await signMultiplayerJoinTicket(claims(), keyring);
  const tokenParts = token.split(".");
  const signature = tokenParts[3] ?? "";
  tokenParts[3] = `${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`;
  const tampered = tokenParts.join(".");
  assert.deepEqual(await verifyMultiplayerJoinTicket(tampered, keyring, {}, NOW), {
    ok: false,
    error: "BAD_SIGNATURE",
  });

  const unknownKeyring = createMultiplayerTicketKeyring({
    kid: "other_key",
    secret: "other-multiplayer-ticket-secret-32-bytes-minimum",
  });
  assert.deepEqual(await verifyMultiplayerJoinTicket(token, unknownKeyring, {}, NOW), {
    ok: false,
    error: "UNKNOWN_KEY",
  });
  assert.deepEqual(
    await verifyMultiplayerJoinTicket(token, keyring, { instanceId: "instance_different" }, NOW),
    { ok: false, error: "CONTEXT_MISMATCH" },
  );
});

test("multiplayer join ticket enforces expiry, future issuance, and maximum lifetime", async () => {
  const token = await signMultiplayerJoinTicket(claims(), keyring);
  assert.deepEqual(
    await verifyMultiplayerJoinTicket(
      token,
      keyring,
      {},
      NOW + MULTIPLAYER_JOIN_TICKET_POLICY.EXPIRY_SECONDS,
    ),
    { ok: false, error: "EXPIRED" },
  );
  assert.deepEqual(await verifyMultiplayerJoinTicket(token, keyring, {}, NOW - 6), {
    ok: false,
    error: "NOT_YET_VALID",
  });
  assert.equal(
    parseMultiplayerJoinTicketClaims(
      claims({ exp: NOW + MULTIPLAYER_JOIN_TICKET_POLICY.MAX_EXPIRY_SECONDS + 1 }),
    ),
    null,
  );
});

test("multiplayer join ticket claims are exact-shape and require post-issuance connection generation", () => {
  assert.equal(parseMultiplayerJoinTicketClaims({ ...claims(), extra: true }), null);
  assert.equal(parseMultiplayerJoinTicketClaims(claims({ connectionGeneration: 0 })), null);
  assert.equal(parseMultiplayerJoinTicketClaims(claims({ userId: 1.5 })), null);
  assert.equal(parseMultiplayerJoinTicketClaims(claims({ seatIndex: 8 })), null);
  assert.equal(parseMultiplayerJoinTicketClaims({ ...claims(), rulesetKey: "LATEST" }), null);
  assert.equal(parseMultiplayerJoinTicketClaims(claims({ role: "SPECTATOR" as "PLAYER" })), null);
});

test("multiplayer ticket keyring requires strong, unique, whitespace-free secrets", () => {
  assert.throws(
    () => createMultiplayerTicketKeyring({ kid: "active", secret: "too-short" }),
    /at least 32 bytes/,
  );
  assert.throws(
    () =>
      createMultiplayerTicketKeyring({
        kid: "active",
        secret: " surrounding-multiplayer-ticket-secret-32-bytes ",
      }),
    /surrounding whitespace/,
  );
  assert.throws(
    () =>
      createMultiplayerTicketKeyring({ kid: "duplicate", secret: ACTIVE_SECRET }, [
        { kid: "duplicate", secret: PREVIOUS_SECRET },
      ]),
    /must be unique/,
  );
});

test("WebSocket subprotocol transport accepts only one app protocol and one ticket", async () => {
  const token = await signMultiplayerJoinTicket(claims(), keyring);
  const protocols = buildMultiplayerWebSocketProtocols(token);
  assert.deepEqual(protocols, [
    MULTIPLAYER_WEBSOCKET_PROTOCOL,
    `${MULTIPLAYER_TICKET_PROTOCOL_PREFIX}${token}`,
  ]);
  assert.deepEqual(parseMultiplayerWebSocketProtocols(protocols.join(", ")), {
    ok: true,
    ticket: token,
  });
  assert.deepEqual(parseMultiplayerWebSocketProtocols([...protocols].reverse().join(",")), {
    ok: true,
    ticket: token,
  });

  for (const bad of [
    null,
    MULTIPLAYER_WEBSOCKET_PROTOCOL,
    `${protocols.join(",")},unknown.protocol`,
    `${MULTIPLAYER_WEBSOCKET_PROTOCOL},${MULTIPLAYER_WEBSOCKET_PROTOCOL}`,
    `${protocols[1]},${protocols[1]}`,
    `${MULTIPLAYER_WEBSOCKET_PROTOCOL},owogg.ticket.`,
  ]) {
    assert.deepEqual(parseMultiplayerWebSocketProtocols(bad), { ok: false });
  }
});
