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

test("GameFrame keeps auto scrolling implicit and honors explicit enabled or disabled modes", () => {
  const automatic = renderToStaticMarkup(
    createElement(GameFrame, {
      src: "https://play.example.test/play/automatic-demo",
      title: "Automatic demo",
      autoStart: true,
    }),
  );
  const scrollable = renderToStaticMarkup(
    createElement(GameFrame, {
      src: "https://play.example.test/play/scrollable-demo",
      title: "Scrollable demo",
      autoStart: true,
      documentScrolling: "enabled",
    }),
  );
  const fitted = renderToStaticMarkup(
    createElement(GameFrame, {
      src: "https://play.example.test/play/fitted-demo",
      title: "Fitted demo",
      autoStart: true,
      documentScrolling: "disabled",
    }),
  );

  assert.doesNotMatch(automatic, /scrolling=/);
  assert.match(automatic, /overflow-hidden/);
  assert.match(scrollable, /scrolling="yes"/);
  assert.match(scrollable, /<iframe class="[^"]*overflow-auto[^"]*"/);
  assert.doesNotMatch(scrollable, /<iframe class="[^"]*overflow-hidden[^"]*"/);
  assert.match(fitted, /scrolling="no"/);
  assert.match(fitted, /<iframe class="[^"]*overflow-hidden[^"]*"/);
});
