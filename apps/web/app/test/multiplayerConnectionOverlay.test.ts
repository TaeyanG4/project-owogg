import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MultiplayerConnectionOverlay } from "../features/game/runtime/MultiplayerConnectionOverlay";
import { multiplayerTerminalLabel } from "../features/game/runtime/MultiplayerIframeRuntime";

test("canonical Omok result is projected to the viewer without rendering raw terminal fields", () => {
  assert.equal(multiplayerTerminalLabel({ kind: "WIN", winnerSeatIndex: 0 }, 0), "승리");
  assert.equal(multiplayerTerminalLabel({ kind: "WIN", winnerSeatIndex: 0 }, 1), "패배");
  assert.equal(multiplayerTerminalLabel({ kind: "DRAW" }, 1), "무승부");
  assert.equal(multiplayerTerminalLabel({ hidden: "server-only" }, 0), "경기 종료");
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

test("disconnected state exposes parent retry/leave controls without credential-shaped props", () => {
  const html = renderToStaticMarkup(
    createElement(MultiplayerConnectionOverlay, {
      state: { status: "DISCONNECTED", code: "NETWORK_LOST" },
      onRetry: () => undefined,
      onLeave: () => undefined,
    }),
  );
  assert.match(html, /다시 연결/);
  assert.match(html, /나가기/);
  assert.doesNotMatch(html, /ticket|socket|userId/i);
});

test("terminal result renders only the canonical parent node, never serializes raw result state", () => {
  const html = renderToStaticMarkup(
    createElement(MultiplayerConnectionOverlay, {
      state: {
        status: "TERMINAL_COMMITTED",
        result: { hiddenServerField: "must-not-render" },
      },
      canonicalResult: createElement("strong", null, "승리"),
    }),
  );
  assert.match(html, /승리/);
  assert.doesNotMatch(html, /hiddenServerField|must-not-render/);
});
