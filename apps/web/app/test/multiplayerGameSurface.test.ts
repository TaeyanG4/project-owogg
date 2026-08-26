import assert from "node:assert/strict";
import test from "node:test";
import { buildMultiplayerRoomShareValue } from "../features/game/runtime/MultiplayerGameSurface";

test("multiplayer room share link carries code and invite only in parent URL query", () => {
  const result = buildMultiplayerRoomShareValue(
    "https://stg.owogg.com/games/official-omok?old=value#result",
    "ROOMCODE1234",
    "invite_token_123456789",
  );
  const url = new URL(result);
  assert.equal(url.origin, "https://stg.owogg.com");
  assert.equal(url.pathname, "/games/official-omok");
  assert.equal(url.searchParams.get("room"), "ROOMCODE1234");
  assert.equal(url.searchParams.get("invite"), "invite_token_123456789");
  assert.equal(url.searchParams.get("old"), "value");
  assert.equal(url.hash, "");
  assert.equal(result.includes("ticket"), false);
  assert.equal(result.includes("socket"), false);
});

test("open-room share link removes a stale invite query and invalid URL falls back safely", () => {
  const open = new URL(
    buildMultiplayerRoomShareValue(
      "https://owogg.com/games/official-omok?invite=stale",
      "OPENROOM1234",
    ),
  );
  assert.equal(open.searchParams.get("room"), "OPENROOM1234");
  assert.equal(open.searchParams.has("invite"), false);
  assert.equal(
    buildMultiplayerRoomShareValue("", "ROOMCODE1234", "invite-token"),
    "ROOMCODE1234\ninvite-token",
  );
});
