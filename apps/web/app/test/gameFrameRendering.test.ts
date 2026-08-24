import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GameFrame } from "../features/game/GameFrame";

test("GameFrame always owns the full available width inside a flex player surface", () => {
  const html = renderToStaticMarkup(
    createElement(GameFrame, {
      src: "https://play.example.test/play/demo",
      title: "Demo",
    }),
  );

  assert.match(html, /class="w-full"/);
  assert.match(html, />PLAY</);
});

test("GameFrame autoStart mounts the iframe immediately without a PLAY gate", () => {
  const html = renderToStaticMarkup(
    createElement(GameFrame, {
      src: "https://play.example.test/play/demo",
      title: "Demo",
      autoStart: true,
    }),
  );

  assert.match(html, /<iframe/);
  assert.match(html, /src="https:\/\/play\.example\.test\/play\/demo"/);
  assert.doesNotMatch(html, />PLAY</);
});
