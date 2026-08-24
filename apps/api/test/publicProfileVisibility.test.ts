import test from "node:test";
import assert from "node:assert/strict";
import { getPublicProfileData, type AppContainer } from "../src/container.js";
import type { User } from "@owogg/core";

// getPublicProfileData decides what a given viewer is allowed to SEE, so its gating is
// security-relevant rather than cosmetic: a regression here silently discloses one user's
// activity to everyone. These tests pin the four combinations that matter.

const FAVORITES = ["aim-test", "reaction-time"];
const RECENT_PLAYS = [{ gameId: "aim-test", lastPlayedAt: "2026-08-14T00:00:00.000Z" }];

function baseUser(overrides: Partial<User> = {}): User {
  return {
    id: 7,
    nickname: "Player",
    email: "p@example.com",
    avatar_url: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    country: null,
    current_streak: 3,
    longest_streak: 9,
    show_favorites: false,
    show_recent_plays: false,
    ...overrides,
  };
}

/** Only the collaborators getPublicProfileData actually touches; the rest of AppContainer is
 * irrelevant to the disclosure decision under test. */
function fakeContainer(user: User): AppContainer {
  return {
    userRepo: { findById: async () => user },
    progressionUseCases: {
      getProgressionSummary: async () => ({
        summary: {
          level: 2,
          totalXp: 150,
          currentLevelProgressXp: 50,
          currentLevelSpanXp: 100,
          progressPercent: 50,
        },
        eligibleCompletions: 15,
      }),
      getGlobalXpRank: async () => 4,
    },
    achievementUseCases: {
      getSummary: async () => ({ unlockedCodes: ["FIRST_PLAY"], totalAchievements: 7 }),
    },
    scoreReadUseCases: { getUserBestsFormatted: async () => [] },
    streamerUseCases: { getStreamerProfileByUserId: async () => null },
    personalizationUseCases: {
      getPersonalizationState: async () => ({
        favoriteGameIds: FAVORITES,
        recentPlays: RECENT_PLAYS,
      }),
    },
  } as unknown as AppContainer;
}

test("a guest viewer sees neither list while both flags are private", async () => {
  const data = await getPublicProfileData(fakeContainer(baseUser()), 7, null);

  assert.ok(data);
  assert.equal(data.favoriteGameIds, null);
  assert.equal(data.recentPlays, null);
  // visibilitySettings is the owner's own toggle state and must never leak to other viewers.
  assert.equal(data.visibilitySettings, null);
});

test("a different logged-in viewer is treated exactly like a guest", async () => {
  const data = await getPublicProfileData(fakeContainer(baseUser()), 7, 999);

  assert.ok(data);
  assert.equal(data.favoriteGameIds, null);
  assert.equal(data.recentPlays, null);
  assert.equal(data.visibilitySettings, null);
});

test("each flag opens exactly one list, not both", async () => {
  const favOnly = await getPublicProfileData(
    fakeContainer(baseUser({ show_favorites: true })),
    7,
    999,
  );
  assert.ok(favOnly);
  assert.deepEqual(favOnly.favoriteGameIds, FAVORITES);
  assert.equal(favOnly.recentPlays, null);

  const recentOnly = await getPublicProfileData(
    fakeContainer(baseUser({ show_recent_plays: true })),
    7,
    999,
  );
  assert.ok(recentOnly);
  assert.equal(recentOnly.favoriteGameIds, null);
  assert.deepEqual(recentOnly.recentPlays, RECENT_PLAYS);
});

test("the owner sees their own lists even with both flags private, plus the toggle state", async () => {
  const data = await getPublicProfileData(fakeContainer(baseUser()), 7, 7);

  assert.ok(data);
  assert.deepEqual(data.favoriteGameIds, FAVORITES);
  assert.deepEqual(data.recentPlays, RECENT_PLAYS);
  assert.deepEqual(data.visibilitySettings, { showFavorites: false, showRecentPlays: false });
});

test("visibilitySettings reflects the owner's actual saved flags", async () => {
  const data = await getPublicProfileData(
    fakeContainer(baseUser({ show_favorites: true, show_recent_plays: false })),
    7,
    7,
  );

  assert.ok(data);
  assert.deepEqual(data.visibilitySettings, { showFavorites: true, showRecentPlays: false });
});
