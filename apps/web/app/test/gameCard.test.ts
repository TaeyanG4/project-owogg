import test from "node:test";
import assert from "node:assert/strict";
import { gameCardHref } from "../components/ui/GameCard";
import { shouldRenderGameThumbnailImage } from "../components/ui/GameThumbnail";

/**
 * gameCardHref is the pure routing decision GameCard's <Link> renders — extracted specifically so
 * it's testable without a DOM renderer (this suite has none; same honest-scoping call as
 * sandboxGamePlayUrl elsewhere in this test directory). Before this PR, GameCard branched on a
 * `version === "sandbox"` marker to send Game Creator games to /sandbox-games/:slug instead; these
 * tests pin that the branch is gone and every slug — SYSTEM or GAME_CREATOR — now routes the same way.
 */

test("a SYSTEM game's card routes to /games/:slug — unchanged from before this PR", () => {
  assert.equal(gameCardHref("reaction-time"), "/games/reaction-time");
  assert.equal(gameCardHref("memory-test"), "/games/memory-test");
});

test("a Game Creator (sandbox) game's card also routes to /games/:slug now, not /sandbox-games/:slug", () => {
  assert.equal(gameCardHref("ball-dodge"), "/games/ball-dodge");
});

test("the route is identical regardless of the slug's shape — no lingering owner-based branch", () => {
  for (const slug of ["reaction-time", "ball-dodge", "some-other-creator-game", "sandbox"]) {
    assert.equal(gameCardHref(slug), `/games/${slug}`);
  }
});

test("a failed logo is retried when re-upload changes its asset revision URL", () => {
  const oldUrl = "https://api.example.test/api/games/aim-test/media/logo?v=old";
  const newUrl = "https://api.example.test/api/games/aim-test/media/logo?v=new";

  assert.equal(shouldRenderGameThumbnailImage(oldUrl, oldUrl), false);
  assert.equal(shouldRenderGameThumbnailImage(newUrl, oldUrl), true);
});
