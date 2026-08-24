import { z } from "zod";

export const StreamerPlatformSchema = z.enum(["YOUTUBE", "CHZZK", "SOOP", "TWITCH"]);
export type StreamerPlatform = z.infer<typeof StreamerPlatformSchema>;

export const StreamerStatusSchema = z.enum(["UNVERIFIED", "VERIFIED", "SUSPENDED"]);
export type StreamerStatus = z.infer<typeof StreamerStatusSchema>;

export const FeaturedStatusSchema = z.enum(["NONE", "FEATURED", "PARTNER"]);
export type FeaturedStatus = z.infer<typeof FeaturedStatusSchema>;

export const StreamerPlatformAccountDtoSchema = z.object({
  id: z.number(),
  streamerId: z.number(),
  platform: StreamerPlatformSchema,
  platformUserId: z.string(),
  channelName: z.string(),
  channelHandle: z.string().nullable(),
  channelUrl: z.string(),
  avatarUrl: z.string().nullable(),
  verificationStatus: z.string(),
  verifiedAt: z.string().nullable(),
  /** null = 공식 API로 확인되지 않은 미지(UNKNOWN) 값. 0은 공식 API가 확정한 실제 0명. */
  audienceCount: z.number().nullable(),
  channelCreatedAt: z.string().nullable(),
  metricsSyncedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type StreamerPlatformAccountDto = z.infer<typeof StreamerPlatformAccountDtoSchema>;

export const StreamerFeaturedReviewSchema = z.object({
  status: z.enum([
    "AUTO_REVIEW_PENDING",
    "FEATURED",
    "NOT_ELIGIBLE",
    "MANUAL_REVIEW",
    "FAILED_RETRYABLE",
    "REVALIDATION_PENDING",
    "REVALIDATION_FAILED_RETRYABLE",
  ]),
  reason: z.string().nullable(),
  nextCheckAt: z.string().nullable(),
  attemptCount: z.number(),
});
export type StreamerFeaturedReview = z.infer<typeof StreamerFeaturedReviewSchema>;

export const StreamerProfileDtoSchema = z.object({
  id: z.number(),
  userId: z.number(),
  status: StreamerStatusSchema,
  featuredStatus: FeaturedStatusSchema,
  featuredReason: z.string().nullable(),
  featuredSince: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  platformAccounts: z.array(StreamerPlatformAccountDtoSchema),
  featuredReview: StreamerFeaturedReviewSchema.nullable(),
});
export type StreamerProfileDto = z.infer<typeof StreamerProfileDtoSchema>;

export const StreamerRankEntrySchema = z.object({
  userId: z.number(),
  nickname: z.string(),
  avatarUrl: z.string().nullable(),
  country: z.string().nullable(),
  streamerId: z.number(),
  featuredStatus: FeaturedStatusSchema,
  platformAccounts: z.array(
    z.object({
      platform: StreamerPlatformSchema,
      channelName: z.string(),
      channelUrl: z.string(),
      avatarUrl: z.string().nullable(),
    }),
  ),
  score: z.number().optional(),
  formattedScore: z.string().optional(),
  gameId: z.string().trim().min(1).max(64).optional(),
  gameTitle: z.string().optional(),
  totalXp: z.number().optional(),
  level: z.number().optional(),
  rank: z.number(),
});
export type StreamerRankEntryDto = z.infer<typeof StreamerRankEntrySchema>;

export const StreamerRankingQuerySchema = z.object({
  mode: z.enum(["score", "xp"]).default("score"),
  gameId: z.string().optional(),
  platform: StreamerPlatformSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export type StreamerRankingQuery = z.infer<typeof StreamerRankingQuerySchema>;
