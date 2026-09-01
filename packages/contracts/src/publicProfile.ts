import { z } from "zod";
import { ProgressionSummarySchema, AchievementCodeSchema } from "./progression.js";
import { StreamerPlatformSchema } from "./streamer.js";
import { RecentPlaySchema } from "./personalization.js";

// Public-facing profile ("/users/:id"). A strict subset of what /api/profile/* and
// /api/progression/* expose to the account owner — never includes email, linked-provider
// list, cooldown timestamps, or anything from the private /profile "My Page".

export const PublicGameBestSchema = z.object({
  gameId: z.string(),
  score: z.number(),
  formattedScore: z.string(),
});
export type PublicGameBest = z.infer<typeof PublicGameBestSchema>;

export const PublicStreamerBadgeSchema = z.object({
  platform: StreamerPlatformSchema,
  channelName: z.string(),
  channelUrl: z.string(),
  channelHandle: z.string().nullable(),
});
export type PublicStreamerBadge = z.infer<typeof PublicStreamerBadgeSchema>;

const UtcCalendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const PublicProfileActivityDaySchema = z.object({
  date: UtcCalendarDateSchema,
  playCount: z.number().int().min(1),
});
export type PublicProfileActivityDay = z.infer<typeof PublicProfileActivityDaySchema>;

export const PublicProfilePlayActivitySchema = z.object({
  periodStart: UtcCalendarDateSchema,
  periodEnd: UtcCalendarDateSchema,
  timeZone: z.literal("UTC"),
  activeDays: z.number().int().min(0),
  totalPlays: z.number().int().min(0),
  todayPlays: z.number().int().min(0),
  /** Sparse list: dates with zero accepted completions are omitted. */
  days: z.array(PublicProfileActivityDaySchema),
});
export type PublicProfilePlayActivity = z.infer<typeof PublicProfilePlayActivitySchema>;

export const PublicProfileResponseSchema = z.object({
  id: z.number(),
  nickname: z.string(),
  avatarUrl: z.string().nullable(),
  /** Self-reported ISO 3166-1 alpha-2 code, or null if unset — same field as the private profile. */
  country: z.string().nullable(),
  joinedAt: z.string(),
  progression: ProgressionSummarySchema,
  globalRank: z.number().int().min(1).nullable(),
  currentStreak: z.number().int().min(0),
  longestStreak: z.number().int().min(0),
  /** Exact daily completion counts follow the existing recent-play visibility preference.
   * Owners always receive the data; null means hidden from this viewer. The default keeps the
   * Web compatible with an older API response during a rolling Staging deployment. */
  playActivity: PublicProfilePlayActivitySchema.nullable().default(null),
  unlockedAchievementCodes: z.array(AchievementCodeSchema),
  totalAchievements: z.number().int().min(0),
  gameBests: z.array(PublicGameBestSchema),
  streamerBadges: z.array(PublicStreamerBadgeSchema),
  /** null = hidden from this viewer — either the owner set it private and the viewer isn't the
   * owner, or (when the viewer IS the owner) there's nothing special here: owners always see
   * their own lists regardless of the privacy flag, so null only ever means "hidden from you". */
  favoriteGameIds: z.array(z.string()).nullable(),
  recentPlays: z.array(RecentPlaySchema).nullable(),
  /** The owner's OWN current visibility settings — only ever non-null when the viewer IS the
   * owner (so /settings and the profile page itself can reflect the current toggle state
   * without a second request). Always null for other viewers. */
  visibilitySettings: z
    .object({ showFavorites: z.boolean(), showRecentPlays: z.boolean() })
    .nullable(),
});
export type PublicProfileResponse = z.infer<typeof PublicProfileResponseSchema>;
