import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMultiplayerRoomShareValue,
  parseMultiplayerRoomJoinValue,
  readMultiplayerRoomShareValue,
  stripMultiplayerRoomCredentials,
} from "../features/game/runtime/MultiplayerGameSurface";
import { multiplayerRoomClipboardValue } from "../features/game/runtime/MultiplayerIframeRuntime";

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

test("pasting an invite link fills both credentials while a public code alone stays non-authorizing", () => {
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
  assert.equal(parseMultiplayerRoomJoinValue("ROOMCODE1234"), null);
});

test("room-code and invite-link clipboard actions never substitute for each other", () => {
  const inviteLink =
    "https://stg.owogg.com/games/official-omok#room=ROOMCODE1234&invite=invite_token_12345678901234567890";
  assert.equal(multiplayerRoomClipboardValue("CODE", "ROOMCODE1234", inviteLink), "ROOMCODE1234");
  assert.equal(multiplayerRoomClipboardValue("LINK", "ROOMCODE1234", inviteLink), inviteLink);
  assert.equal(multiplayerRoomClipboardValue("LINK", "ROOMCODE1234"), null);
});
