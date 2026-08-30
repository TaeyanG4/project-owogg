import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { MultiplayerGameAvailabilityResponse } from "@owogg/contracts";
import {
  buildMultiplayerRoomShareValue,
  clearMultiplayerRoomResumeValue,
  parseMultiplayerRoomJoinValue,
  readMultiplayerRoomShareValue,
  readMultiplayerRoomResumeValue,
  supportsPrivateOpenRoomLauncher,
  stripMultiplayerRoomCredentials,
  writeMultiplayerRoomResumeValue,
} from "../features/game/runtime/MultiplayerGameSurface";
import {
  MultiplayerIframeRuntime,
  multiplayerPingLabel,
  multiplayerPingTone,
  multiplayerRoomClipboardValue,
  multiplayerRuntimeInitialRoster,
  updateMultiplayerLatencies,
} from "../features/game/runtime/MultiplayerIframeRuntime";

test("active multiplayer keeps room controls above an independently viewport-fitted game", () => {
  const room = {
    replayed: false,
    instance: {
      id: "instance_12345678",
      publicCode: "ROOMCODE1234",
      gameId: 1,
      gameVersionId: 1,
      contentHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      profileRevision: 1,
      visibility: "PRIVATE",
      joinPolicy: "OPEN",
      status: "ACTIVE",
      generation: 1,
      participantCount: 2,
      maxPlayers: 2,
      expiresAt: "2026-08-28T10:00:00.000Z",
    },
    participant: {
      id: "participant_host_0001",
      role: "HOST",
      seatIndex: 0,
      status: "READY",
      connectionGeneration: 1,
    },
  } as const;
  const markup = renderToStaticMarkup(
    createElement(MultiplayerIframeRuntime, {
      src: "https://play.example.test/game",
      title: "Generic multiplayer",
      room,
      attemptKey: 1,
      frameClassName: "mx-auto max-w-full",
      frameStyle: { width: 960, height: 540 },
      onExit: () => undefined,
    }),
  );

  assert.match(markup, /data-testid="multiplayer-runtime-surface"/);
  assert.match(markup, /data-testid="multiplayer-game-stage"/);
  assert.match(markup, /data-testid="multiplayer-room-controls"/);
  assert.match(markup, /mx-auto max-w-full relative overflow-hidden/);
  assert.match(markup, /data-testid="multiplayer-game-stage"[^>]*style="width:960px;height:540px"/);
  assert.match(markup, /style="width:100%;height:100%"/);
  assert.ok(
    markup.indexOf('data-testid="multiplayer-room-controls"') <
      markup.indexOf('data-testid="multiplayer-game-stage"'),
  );
});

test("participant ping labels distinguish measuring, healthy, delayed, and poor links", () => {
  assert.equal(multiplayerPingLabel(null), "Ping —");
  assert.equal(multiplayerPingLabel(42), "Ping 42ms");
  assert.equal(multiplayerPingLabel(42, true), "연결 끊김");
  assert.match(multiplayerPingTone(null), /text-text-muted/);
  assert.match(multiplayerPingTone(80), /text-emerald-300/);
  assert.match(multiplayerPingTone(81), /text-amber-200/);
  assert.match(multiplayerPingTone(180), /text-amber-200/);
  assert.match(multiplayerPingTone(181), /text-red-300/);
  assert.match(multiplayerPingTone(42, true), /text-text-muted/);
});

test("authoritative latency samples mark absent known participants disconnected until they return", () => {
  let latencies = updateMultiplayerLatencies(
    new Map(),
    [{ participantId: "host", rttMs: 42 }],
    "MERGE",
  );
  latencies = updateMultiplayerLatencies(
    latencies,
    [
      { participantId: "host", rttMs: 45 },
      { participantId: "guest", rttMs: 91 },
    ],
    "REPLACE",
  );
  latencies = updateMultiplayerLatencies(
    latencies,
    [{ participantId: "host", rttMs: 47 }],
    "REPLACE",
  );

  assert.deepEqual(latencies.get("host"), { rttMs: 47, connected: true });
  assert.deepEqual(latencies.get("guest"), { rttMs: 91, connected: false });

  latencies = updateMultiplayerLatencies(
    latencies,
    [{ participantId: "guest", rttMs: 88 }],
    "MERGE",
  );
  assert.deepEqual(latencies.get("guest"), { rttMs: 88, connected: true });
});

test("the shared room launcher accepts only an exact available PRIVATE + OPEN profile", () => {
  const available: Extract<MultiplayerGameAvailabilityResponse, { readonly status: "AVAILABLE" }> =
    {
      status: "AVAILABLE",
      protocolVersion: 1,
      gameSlug: "creator-relay-demo",
      profile: {
        gameVersionId: 1,
        contentHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        profileRevision: 1,
        transportKind: "websocket",
        runtimeKind: "relay",
        reconnectPolicy: "resume",
        directMessages: true,
        hostSnapshot: true,
        minPlayers: 2,
        maxPlayers: 2,
        allowedVisibility: ["PRIVATE"],
        allowedJoinPolicies: ["OPEN"],
        resultTrust: "UNVERIFIED",
      },
    };
  assert.equal(supportsPrivateOpenRoomLauncher(available), true);
  assert.equal(
    supportsPrivateOpenRoomLauncher({
      ...available,
      profile: { ...available.profile, allowedJoinPolicies: ["INVITE_ONLY"] },
    }),
    false,
  );
  assert.equal(
    supportsPrivateOpenRoomLauncher({ status: "UNAVAILABLE", protocolVersion: 1 }),
    false,
  );
});

test("multiplayer room share link keeps code and invite out of HTTP query data", () => {
  const result = buildMultiplayerRoomShareValue(
    "https://stg.owogg.com/games/creator-relay-demo?old=value#result",
    "ROOMCODE1234",
    "invite_token_123456789",
  );
  const url = new URL(result);
  assert.equal(url.origin, "https://stg.owogg.com");
  assert.equal(url.pathname, "/games/creator-relay-demo");
  assert.equal(url.searchParams.get("old"), "value");
  assert.equal(url.searchParams.has("room"), false);
  assert.equal(url.searchParams.has("invite"), false);
  const fragment = new URLSearchParams(url.hash.slice(1));
  assert.equal(fragment.get("room"), "ROOMCODE1234");
  assert.equal(fragment.get("invite"), "invite_token_123456789");
  assert.equal(result.includes("ticket"), false);
  assert.equal(result.includes("socket"), false);
});

test("share parsing prefers fragments and strips consumed credentials", () => {
  const open = new URL(
    buildMultiplayerRoomShareValue(
      "https://owogg.com/games/creator-relay-demo?invite=stale",
      "OPENROOM1234",
    ),
  );
  assert.equal(open.searchParams.has("room"), false);
  assert.equal(open.searchParams.has("invite"), false);
  assert.deepEqual(readMultiplayerRoomShareValue(open.toString()), {
    publicCode: "OPENROOM1234",
    inviteToken: "",
  });
  assert.deepEqual(
    readMultiplayerRoomShareValue(
      "https://stg.owogg.com/games/creator-relay-demo?room=OLDROOM12345&invite=invite-token",
    ),
    { publicCode: "OLDROOM12345", inviteToken: "invite-token" },
  );
  assert.equal(
    stripMultiplayerRoomCredentials(
      "https://stg.owogg.com/games/creator-relay-demo?room=OLD&keep=1#room=NEW&invite=secret&tab=game",
    ),
    "https://stg.owogg.com/games/creator-relay-demo?keep=1#tab=game",
  );
  assert.equal(
    buildMultiplayerRoomShareValue("", "ROOMCODE1234", "invite-token"),
    "ROOMCODE1234\ninvite-token",
  );
});

test("room-code links, plain codes, and optional invite values all normalize safely", () => {
  const inviteLink = buildMultiplayerRoomShareValue(
    "https://stg.owogg.com/games/creator-relay-demo",
    "ROOMCODE1234",
    "invite_token_12345678901234567890",
  );
  assert.deepEqual(parseMultiplayerRoomJoinValue(inviteLink), {
    publicCode: "ROOMCODE1234",
    inviteToken: "invite_token_12345678901234567890",
  });
  assert.deepEqual(
    parseMultiplayerRoomJoinValue("ROOMCODE1234\ninvite_token_12345678901234567890"),
    {
      publicCode: "ROOMCODE1234",
      inviteToken: "invite_token_12345678901234567890",
    },
  );
  assert.deepEqual(parseMultiplayerRoomJoinValue("ROOMCODE1234"), {
    publicCode: "ROOMCODE1234",
    inviteToken: "",
  });
  assert.deepEqual(
    parseMultiplayerRoomJoinValue(
      buildMultiplayerRoomShareValue(
        "https://stg.owogg.com/games/creator-relay-demo",
        "ROOMCODE1234",
      ),
    ),
    { publicCode: "ROOMCODE1234", inviteToken: "" },
  );
});

test("refresh resume stores only a user-and-game-scoped public room code", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };

  assert.equal(
    writeMultiplayerRoomResumeValue(storage, "creator-relay-demo", 7, "ROOMCODE1234"),
    true,
  );
  assert.equal(readMultiplayerRoomResumeValue(storage, "creator-relay-demo", 7), "ROOMCODE1234");
  assert.equal(readMultiplayerRoomResumeValue(storage, "creator-relay-demo", 8), "");
  assert.equal(readMultiplayerRoomResumeValue(storage, "different-game", 7), "");
  assert.equal(
    [...values.values()].some((value) => value.includes("invite")),
    false,
  );

  clearMultiplayerRoomResumeValue(storage, "creator-relay-demo", 7);
  assert.equal(readMultiplayerRoomResumeValue(storage, "creator-relay-demo", 7), "");
});

test("refresh resume fails closed for malformed identities, codes, and stored values", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };

  assert.equal(writeMultiplayerRoomResumeValue(storage, "Bad Slug", 7, "ROOMCODE1234"), false);
  assert.equal(
    writeMultiplayerRoomResumeValue(storage, "creator-relay-demo", 0, "ROOMCODE1234"),
    false,
  );
  assert.equal(writeMultiplayerRoomResumeValue(storage, "creator-relay-demo", 7, "short"), false);
  assert.equal(
    writeMultiplayerRoomResumeValue(storage, "creator-relay-demo", 7, "ROOMCODE1234"),
    true,
  );
  const [key] = values.keys();
  assert.ok(key);
  values.set(key, '{"version":1,"publicCode":"short"}');
  assert.equal(readMultiplayerRoomResumeValue(storage, "creator-relay-demo", 7), "");
  values.set(key, "not-json");
  assert.equal(readMultiplayerRoomResumeValue(storage, "creator-relay-demo", 7), "");
});

test("room-code and invite-link clipboard actions never substitute for each other", () => {
  const inviteLink =
    "https://stg.owogg.com/games/creator-relay-demo#room=ROOMCODE1234&invite=invite_token_12345678901234567890";
  assert.equal(multiplayerRoomClipboardValue("CODE", "ROOMCODE1234", inviteLink), "ROOMCODE1234");
  assert.equal(multiplayerRoomClipboardValue("LINK", "ROOMCODE1234", inviteLink), inviteLink);
  assert.equal(multiplayerRoomClipboardValue("LINK", "ROOMCODE1234"), null);
});

test("active runtime reuses a complete authenticated lobby roster without another read", () => {
  const room = {
    replayed: false,
    instance: {
      id: "instance_12345678",
      publicCode: "ROOMCODE1234",
      gameId: 1,
      gameVersionId: 1,
      contentHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      profileRevision: 1,
      visibility: "PRIVATE",
      joinPolicy: "OPEN",
      status: "ACTIVE",
      generation: 1,
      participantCount: 2,
      maxPlayers: 2,
      expiresAt: "2026-08-28T10:00:00.000Z",
    },
    participant: {
      id: "participant_host_0001",
      role: "HOST",
      seatIndex: 0,
      status: "READY",
      connectionGeneration: 1,
    },
  } as const;
  const players = [
    {
      participantId: "participant_host_0001",
      role: "HOST",
      seatIndex: 0,
      status: "READY",
      nickname: "Host",
      avatarUrl: null,
    },
    {
      participantId: "participant_player_0001",
      role: "PLAYER",
      seatIndex: 1,
      status: "READY",
      nickname: "Player",
      avatarUrl: null,
    },
  ] as const;

  assert.equal(multiplayerRuntimeInitialRoster(room, players), players);
  assert.equal(multiplayerRuntimeInitialRoster(room, players.slice(0, 1)), null);
  assert.equal(multiplayerRuntimeInitialRoster(room, [players[1], players[1]]), null);

  const fourPlayerRoom = {
    ...room,
    instance: { ...room.instance, participantCount: 4, maxPlayers: 4 },
  } as const;
  const fourPlayers = [
    ...players,
    {
      ...players[1],
      participantId: "participant_player_0002",
      seatIndex: 2,
      nickname: "Player 2",
    },
    {
      ...players[1],
      participantId: "participant_player_0003",
      seatIndex: 3,
      nickname: "Player 3",
    },
  ] as const;
  assert.equal(multiplayerRuntimeInitialRoster(fourPlayerRoom, fourPlayers), fourPlayers);
  assert.equal(
    multiplayerRuntimeInitialRoster(fourPlayerRoom, [
      ...fourPlayers.slice(0, 3),
      { ...fourPlayers[3], seatIndex: 2 },
    ]),
    null,
  );
});
