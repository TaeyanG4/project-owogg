import test from "node:test";
import assert from "node:assert/strict";
import { getPublicProfileData, type AppContainer } from "../src/container.js";
import type { User } from "@owogg/core";

// getPublicProfileData decides what a given viewer is allowed to SEE, so its gating is
// security-relevant rather than cosmetic: a regression here silently discloses one user's
// activity to everyone. These tests pin the four combinations that matter.

const FAVORITES = ["aim-test", "reaction-time"];
const RECENT_PLAYS = [{ gameId: "aim-test", lastPlayedAt: "2026-08-14T00:00:00.000Z" }];
const ACTIVITY_DAYS = [
  { date: "2025-09-02", playCount: 2 },
  { date: "2026-09-01", playCount: 4 },
];

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
function fakeContainer(user: User, streamerProfile: unknown = null): AppContainer {
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
      getDailyCompletionCounts: async () => ACTIVITY_DAYS,
    },
    achievementUseCases: {
      getSummary: async () => ({ unlockedCodes: ["FIRST_PLAY"], totalAchievements: 7 }),
    },
    scoreReadUseCases: { getUserBestsFormatted: async () => [] },
    streamerUseCases: { getStreamerProfileByUserId: async () => streamerProfile },
    personalizationUseCases: {
      getPersonalizationState: async () => ({
        favoriteGameIds: FAVORITES,
        recentPlays: RECENT_PLAYS,
      }),
    },
  } as unknown as AppContainer;
}

function streamerProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: 17,
    userId: 7,
    status: "VERIFIED",
    suspendedUntil: null,
    rowVersion: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    platformAccounts: [
      {
        id: 23,
        streamerId: 17,
        platform: "YOUTUBE",
        platformUserId: "UC-owner",
        channelName: "Owner channel",
        channelHandle: "@owner",
        channelUrl: "https://youtube.com/@owner",
        avatarUrl: null,
        verificationStatus: "VERIFIED",
        verifiedAt: "2026-01-01T00:00:00.000Z",
        ownershipExpiresAt: "2099-01-01T00:00:00.000Z",
        approvalStatus: "APPROVED",
        approvalReasonCode: "MANUAL_REVIEW_APPROVED",
        approvedAt: "2026-01-02T00:00:00.000Z",
        audienceCount: 20_000,
        channelCreatedAt: "2020-01-01T00:00:00.000Z",
        metricsSyncedAt: "2026-01-01T00:00:00.000Z",
        rowVersion: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

test("a guest viewer sees neither list while both flags are private", async () => {
  const data = await getPublicProfileData(fakeContainer(baseUser()), 7, null);

  assert.ok(data);
  assert.equal(data.favoriteGameIds, null);
  assert.equal(data.recentPlays, null);
  assert.equal(data.playActivity, null);
  // visibilitySettings is the owner's own toggle state and must never leak to other viewers.
  assert.equal(data.visibilitySettings, null);
});

test("a different logged-in viewer is treated exactly like a guest", async () => {
  const data = await getPublicProfileData(fakeContainer(baseUser()), 7, 999);

  assert.ok(data);
  assert.equal(data.favoriteGameIds, null);
  assert.equal(data.recentPlays, null);
  assert.equal(data.playActivity, null);
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
  assert.equal(favOnly.playActivity, null);

  const recentOnly = await getPublicProfileData(
    fakeContainer(baseUser({ show_recent_plays: true })),
    7,
    999,
  );
  assert.ok(recentOnly);
  assert.equal(recentOnly.favoriteGameIds, null);
  assert.deepEqual(recentOnly.recentPlays, RECENT_PLAYS);
  assert.ok(recentOnly.playActivity);
});

test("the owner sees their own lists even with both flags private, plus the toggle state", async () => {
  const data = await getPublicProfileData(fakeContainer(baseUser()), 7, 7);

  assert.ok(data);
  assert.deepEqual(data.favoriteGameIds, FAVORITES);
  assert.deepEqual(data.recentPlays, RECENT_PLAYS);
  assert.ok(data.playActivity);
  assert.deepEqual(data.visibilitySettings, { showFavorites: false, showRecentPlays: false });
});

test("the owner receives an exact sparse 365-day UTC completion summary", async () => {
  const data = await getPublicProfileData(
    fakeContainer(baseUser()),
    7,
    7,
    new Date("2026-09-01T23:59:59.000Z"),
  );

  assert.deepEqual(data?.playActivity, {
    periodStart: "2025-09-02",
    periodEnd: "2026-09-01",
    timeZone: "UTC",
    activeDays: 2,
    totalPlays: 6,
    todayPlays: 4,
    days: ACTIVITY_DAYS,
  });
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

test("public streamer badges require approved, current ownership on a verified profile", async () => {
  const eligible = await getPublicProfileData(
    fakeContainer(baseUser(), streamerProfile()),
    7,
    null,
  );
  assert.equal(eligible?.streamerBadges.length, 1);

  for (const [label, profile] of [
    ["profile pending", streamerProfile({ status: "UNVERIFIED" })],
    ["profile suspended", streamerProfile({ status: "SUSPENDED" })],
    [
      "staff review pending",
      streamerProfile({
        platformAccounts: [{ ...streamerProfile().platformAccounts[0], approvalStatus: "PENDING" }],
      }),
    ],
    [
      "ownership rejected",
      streamerProfile({
        platformAccounts: [
          { ...streamerProfile().platformAccounts[0], verificationStatus: "REJECTED" },
        ],
      }),
    ],
    [
      "ownership expired",
      streamerProfile({
        platformAccounts: [
          {
            ...streamerProfile().platformAccounts[0],
            ownershipExpiresAt: "2000-01-01T00:00:00.000Z",
          },
        ],
      }),
    ],
  ] as const) {
    const data = await getPublicProfileData(fakeContainer(baseUser(), profile), 7, null);
    assert.deepEqual(data?.streamerBadges, [], label);
  }
});

test("public streamer badges never expose the reserved SOOP platform", async () => {
  const youtubeAccount = streamerProfile().platformAccounts[0];
  const data = await getPublicProfileData(
    fakeContainer(
      baseUser(),
      streamerProfile({
        platformAccounts: [
          youtubeAccount,
          {
            ...youtubeAccount,
            id: 24,
            platform: "SOOP",
            platformUserId: "soop-owner",
            channelName: "Reserved channel",
            channelUrl: "https://example.com/soop-owner",
          },
        ],
      }),
    ),
    7,
    null,
  );

  assert.deepEqual(
    data?.streamerBadges.map((badge) => badge.platform),
    ["YOUTUBE"],
  );
});
