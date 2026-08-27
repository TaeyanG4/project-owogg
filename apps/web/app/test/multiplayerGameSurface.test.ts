import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMultiplayerRoomShareValue,
  parseMultiplayerRoomJoinValue,
  readMultiplayerRoomShareValue,
  stripMultiplayerRoomCredentials,
} from "../features/game/runtime/MultiplayerGameSurface";
import {
  multiplayerPeerConnectionMessage,
  multiplayerRoomClipboardValue,
} from "../features/game/runtime/MultiplayerIframeRuntime";

test("multiplayer room share link keeps code and invite out of HTTP query data", () => {
  const result = buildMultiplayerRoomShareValue(
    "https://stg.owogg.com/games/official-omok?old=value#result",
    "ROOMCODE1234",
    "invite_token_123456789",
  );
  const url = new URL(result);
  assert.equal(url.origin, "https://stg.owogg.com");
  assert.equal(url.pathname, "/games/official-omok");
  assert.equal(url.searchParams.get("old"), "value");
  assert.equal(url.searchParams.has("room"), false);
  assert.equal(url.searchParams.has("invite"), false);
  const fragment = new URLSearchParams(url.hash.slice(1));
  assert.equal(fragment.get("room"), "ROOMCODE1234");
  assert.equal(fragment.get("invite"), "invite_token_123456789");
  assert.equal(result.includes("ticket"), false);
  assert.equal(result.includes("socket"), false);
});

test("share parsing prefers fragments, supports legacy query links, and strips consumed credentials", () => {
  const open = new URL(
    buildMultiplayerRoomShareValue(
      "https://owogg.com/games/official-omok?invite=stale",
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
      "https://stg.owogg.com/games/official-omok?room=LEGACY&invite=legacy-token",
    ),
    { publicCode: "LEGACY", inviteToken: "legacy-token" },
  );
  assert.equal(
    stripMultiplayerRoomCredentials(
      "https://stg.owogg.com/games/official-omok?room=OLD&keep=1#room=NEW&invite=secret&tab=game",
    ),
    "https://stg.owogg.com/games/official-omok?keep=1#tab=game",
  );
  assert.equal(
    buildMultiplayerRoomShareValue("", "ROOMCODE1234", "invite-token"),
    "ROOMCODE1234\ninvite-token",
  );
});

test("room-code links, plain codes, and historical invite links all normalize safely", () => {
  const inviteLink = buildMultiplayerRoomShareValue(
    "https://stg.owogg.com/games/official-omok",
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
      buildMultiplayerRoomShareValue("https://stg.owogg.com/games/official-omok", "ROOMCODE1234"),
    ),
    { publicCode: "ROOMCODE1234", inviteToken: "" },
  );
});

test("room-code and invite-link clipboard actions never substitute for each other", () => {
  const inviteLink =
    "https://stg.owogg.com/games/official-omok#room=ROOMCODE1234&invite=invite_token_12345678901234567890";
  assert.equal(multiplayerRoomClipboardValue("CODE", "ROOMCODE1234", inviteLink), "ROOMCODE1234");
  assert.equal(multiplayerRoomClipboardValue("LINK", "ROOMCODE1234", inviteLink), inviteLink);
  assert.equal(multiplayerRoomClipboardValue("LINK", "ROOMCODE1234"), null);
});

test("disconnect notice counts down and then reports official forfeit finalization", () => {
  const reconnecting = {
    participantId: "participant-2",
    status: "RECONNECTING",
    reconnectDeadlineAt: "2026-08-27T00:00:30.000Z",
  } as const;
  assert.equal(
    multiplayerPeerConnectionMessage(reconnecting, Date.parse("2026-08-27T00:00:01.000Z")),
    "상대 네트워크 연결이 불안정합니다. 29초 동안 재접속을 기다립니다.",
  );
  assert.equal(
    multiplayerPeerConnectionMessage(reconnecting, Date.parse("2026-08-27T00:00:30.000Z")),
    "재접속 유예 시간이 끝났습니다. 공식 기권 결과를 확인하고 있습니다.",
  );
  assert.equal(
    multiplayerPeerConnectionMessage({
      participantId: "participant-2",
      status: "TIMED_OUT",
      reconnectDeadlineAt: null,
    }),
    "상대가 30초 안에 재접속하지 않아 기권 처리되었습니다.",
  );
});
