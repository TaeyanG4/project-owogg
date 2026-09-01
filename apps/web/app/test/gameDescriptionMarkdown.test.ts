import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PublicGame } from "@owogg/contracts";
import {
  GameDescriptionMarkdown,
  selectLocalizedGameDescription,
} from "../components/game/GameDescriptionMarkdown";

const game = {
  description: "Legacy fallback",
  descriptions: [
    { locale: "en", path: "description.md", markdown: "# English guide" },
    { locale: "ko", path: "description_kr.md", markdown: "# 한국어 안내" },
  ],
  descriptionImages: [{ path: "guide/board.png", url: "https://cdn.example/board.png" }],
} as PublicGame;

test("localized description selects the requested document and falls back to English then legacy", () => {
  assert.equal(selectLocalizedGameDescription(game, "ko"), "# 한국어 안내");
  assert.equal(selectLocalizedGameDescription(game, "ja"), "# English guide");
  assert.equal(
    selectLocalizedGameDescription({ ...game, descriptions: [] }, "zh"),
    "Legacy fallback",
  );
});

test("description Markdown removes raw HTML and only resolves allowlisted bundle images", () => {
  const markup = renderToStaticMarkup(
    createElement(GameDescriptionMarkdown, {
      locale: "en-US",
      game: {
        ...game,
        descriptions: [
          {
            locale: "en",
            path: "description.md",
            markdown:
              '<script>alert("x")</script>\n\n![Board](guide/board.png)\n\n![Blocked](guide/private.png)',
          },
        ],
      },
    }),
  );

  assert.doesNotMatch(markup, /script|alert/);
  assert.match(markup, /src="https:\/\/cdn\.example\/board\.png"/);
  assert.doesNotMatch(markup, /private\.png/);
  assert.match(markup, /loading="lazy"/);
});
