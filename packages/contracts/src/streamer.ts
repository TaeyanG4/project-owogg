import { z } from "zod";

export const StreamerPlatformSchema = z.enum(["YOUTUBE", "CHZZK", "SOOP", "TWITCH"]);
export type StreamerPlatform = z.infer<typeof StreamerPlatformSchema>;

export const StreamerOwnershipVerificationMethodSchema = z.enum(["OAUTH_REDIRECT", "UNAVAILABLE"]);
export type StreamerOwnershipVerificationMethod = z.infer<
  typeof StreamerOwnershipVerificationMethodSchema
>;

export const StreamerProviderAvailabilitySchema = z
  .object({
    configured: z.boolean(),
    paused: z.boolean(),
    verificationMethod: StreamerOwnershipVerificationMethodSchema,
    unavailableReason: z.enum(["SECURE_OAUTH_CALLBACK_BINDING_UNAVAILABLE"]).nullable(),
  })
  .strict();

export const StreamerProvidersResponseSchema = z
  .object({
    YOUTUBE: StreamerProviderAvailabilitySchema,
    TWITCH: StreamerProviderAvailabilitySchema,
    CHZZK: StreamerProviderAvailabilitySchema,
    SOOP: StreamerProviderAvailabilitySchema,
  })
  .strict();
export type StreamerProvidersResponse = z.infer<typeof StreamerProvidersResponseSchema>;

/**
 * Aggregate Streamer programme state. A user is VERIFIED when at least one platform account has
 * passed the independent staff review. UNVERIFIED includes users whose connected accounts are
 * still pending or were rejected. SUSPENDED is an explicit staff action.
 */
export const StreamerStatusSchema = z.enum(["UNVERIFIED", "VERIFIED", "SUSPENDED"]);
export type StreamerStatus = z.infer<typeof StreamerStatusSchema>;

/** OAuth ownership and staff approval are separate facts. */
export const StreamerPlatformApprovalStatusSchema = z.enum(["PENDING", "APPROVED", "REJECTED"]);
export type StreamerPlatformApprovalStatus = z.infer<typeof StreamerPlatformApprovalStatusSchema>;

export const StreamerPlatformAccountDtoSchema = z.object({
  id: z.number().int().positive(),
  streamerId: z.number().int().positive(),
  platform: StreamerPlatformSchema,
  platformUserId: z.string(),
  channelName: z.string(),
  channelHandle: z.string().nullable(),
  channelUrl: z.string().url(),
  avatarUrl: z.string().url().nullable(),
  verificationStatus: z.enum(["UNVERIFIED", "VERIFIED", "REJECTED"]),
  verifiedAt: z.string().datetime().nullable(),
  ownershipExpiresAt: z.string().datetime().nullable(),
  approvalStatus: StreamerPlatformApprovalStatusSchema,
  approvalReasonCode: z.string().nullable(),
  approvedAt: z.string().datetime().nullable(),
  /** null = official provider value is unknown; zero is a provider-confirmed real zero. */
  audienceCount: z.number().int().nonnegative().nullable(),
  channelCreatedAt: z.string().datetime().nullable(),
  metricsSyncedAt: z.string().datetime().nullable(),
  rowVersion: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type StreamerPlatformAccountDto = z.infer<typeof StreamerPlatformAccountDtoSchema>;

export const StreamerProfileDtoSchema = z.object({
  id: z.number().int().positive(),
  userId: z.number().int().positive(),
  status: StreamerStatusSchema,
  suspendedUntil: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  platformAccounts: z.array(StreamerPlatformAccountDtoSchema),
});
export type StreamerProfileDto = z.infer<typeof StreamerProfileDtoSchema>;

export const StreamerDisconnectResponseSchema = z
  .object({
    disconnected: z.literal(true),
    platform: StreamerPlatformSchema,
    remainingConnections: z.number().int().nonnegative(),
  })
  .strict();
export type StreamerDisconnectResponse = z.infer<typeof StreamerDisconnectResponseSchema>;

export const StreamerRankEntrySchema = z.object({
  userId: z.number(),
  nickname: z.string(),
  avatarUrl: z.string().nullable(),
  country: z.string().nullable(),
  streamerId: z.number(),
  platformAccounts: z.array(
    z.object({
      platform: StreamerPlatformSchema,
      channelName: z.string(),
      channelUrl: z.string().url(),
      avatarUrl: z.string().url().nullable(),
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
