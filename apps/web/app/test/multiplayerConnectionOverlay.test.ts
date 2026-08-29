import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MultiplayerConnectionOverlay } from "../features/game/runtime/MultiplayerConnectionOverlay";
import { multiplayerReconnectDelay } from "../features/game/runtime/MultiplayerIframeRuntime";

test("only transient disconnects receive a bounded automatic reconnect schedule", () => {
  assert.equal(multiplayerReconnectDelay("NETWORK_LOST", 0), 750);
  assert.equal(multiplayerReconnectDelay("SERVER_UNAVAILABLE", 1), 1_500);
  assert.equal(multiplayerReconnectDelay("AUTH_EXPIRED", 2), 3_000);
  assert.equal(multiplayerReconnectDelay("NETWORK_LOST", 3), null);
  assert.equal(multiplayerReconnectDelay("REPLACED_BY_NEW_CONNECTION", 0), null);
  assert.equal(multiplayerReconnectDelay("SLOW_CONSUMER", 0), null);
  assert.equal(multiplayerReconnectDelay("LEFT", 0), null);
});

test("connected state is rendered by the parent as a non-interactive status badge", () => {
  const html = renderToStaticMarkup(
    createElement(MultiplayerConnectionOverlay, {
      state: { status: "CONNECTED", connectionGeneration: 2 },
    }),
  );
  assert.match(html, /role="status"/);
  assert.match(html, /서버 연결됨/);
});

test("disconnected and closed states expose no credential-shaped data", () => {
  const disconnected = renderToStaticMarkup(
    createElement(MultiplayerConnectionOverlay, {
      state: { status: "DISCONNECTED", code: "NETWORK_LOST" },
      onRetry: () => undefined,
      onLeave: () => undefined,
    }),
  );
  assert.match(disconnected, /다시 연결/);
  assert.match(disconnected, /나가기/);
  assert.doesNotMatch(disconnected, /ticket|socket|userId/i);

  const closed = renderToStaticMarkup(
    createElement(MultiplayerConnectionOverlay, {
      state: { status: "CLOSED", code: "ROOM_EXPIRED" },
      onLeave: () => undefined,
    }),
  );
  assert.match(closed, /방이 종료/);
  assert.doesNotMatch(closed, /다시 연결/);
});
