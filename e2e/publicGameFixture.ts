import type { PublicGame } from "../packages/contracts/src/games.js";

/**
 * Synthetic, platform-only public games used by the browser harness. These documents deliberately
 * exercise the same provider-neutral contract that production GameHost reads from `/api/games`;
 * they are not entries in the build-time game registry and never represent a real game.
 */
export const E2E_PUBLIC_GAMES: readonly PublicGame[] = [
  {
    publisherType: "OWOGG",
    publisherName: "OWOGG",
    slug: "e2e-responsive",
    title: "Platform E2E fixture (e2e-responsive)",
    shortDescription: "Synthetic platform fixture.",
    description: "Synthetic platform-only fixture for browser E2E presentation and security tests.",
    publishedAt: "2026-01-01T00:00:00.000Z",
    stats: { playerCount: 12, bookmarkCount: 3, popularityScore: 21 },
    catalog: { type: "GENRE_MODE", genre: "platform-e2e", mode: "single" },
    playModes: ["single"],
    policy: { requiresAuth: false, leaderboard: false, score: null, xpPerCompletion: 0 },
    presentation: {
      viewport: { mode: "responsive", preferredWidth: 800, minWidth: 600 },
      fullscreen: { supported: false },
      mobile: { support: "supported" },
    },
    supportsReplay: false,
    mediaUrl: null,
  },
  {
    publisherType: "OWOGG",
    publisherName: "OWOGG",
    slug: "e2e-fixed",
    title: "Platform E2E fixture (e2e-fixed)",
    shortDescription: "Synthetic platform fixture.",
    description: "Synthetic platform-only fixture for browser E2E presentation and security tests.",
    publishedAt: "2026-01-02T00:00:00.000Z",
    stats: { playerCount: 8, bookmarkCount: 5, popularityScore: 23 },
    catalog: { type: "GENRE_MODE", genre: "platform-e2e", mode: "single" },
    playModes: ["single"],
    policy: { requiresAuth: false, leaderboard: false, score: null, xpPerCompletion: 0 },
    presentation: {
      viewport: { mode: "fixed", preferredWidth: 1280, preferredHeight: 720 },
      fullscreen: { supported: true, recommended: true },
      mobile: { support: "unsupported", orientation: "landscape" },
    },
    supportsReplay: false,
    mediaUrl: null,
  },
  {
    publisherType: "OWOGG",
    publisherName: "OWOGG",
    slug: "e2e-mobile-experimental",
    title: "Platform E2E fixture (e2e-mobile-experimental)",
    shortDescription: "Synthetic platform fixture.",
    description: "Synthetic platform-only fixture for browser E2E presentation and security tests.",
    publishedAt: "2026-01-03T00:00:00.000Z",
    stats: { playerCount: 4, bookmarkCount: 1, popularityScore: 7 },
    catalog: { type: "GENRE_MODE", genre: "platform-e2e", mode: "single" },
    playModes: ["single"],
    policy: { requiresAuth: false, leaderboard: false, score: null, xpPerCompletion: 0 },
    presentation: {
      viewport: { mode: "responsive" },
      fullscreen: { supported: false },
      mobile: { support: "experimental" },
    },
    supportsReplay: false,
    mediaUrl: null,
  },
];

export const E2E_PUBLIC_GAME_BY_SLUG = new Map(
  E2E_PUBLIC_GAMES.map((game) => [game.slug, game] as const),
);
