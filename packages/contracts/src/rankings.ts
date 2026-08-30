import { z } from "zod";
import { StreamerPlatformSchema } from "./streamer.js";

export const RankingScopeSchema = z.enum(["general", "streamer"]);
export type RankingScope = z.infer<typeof RankingScopeSchema>;

export const RankingMetricSchema = z.enum(["score", "xp", "streak"]);
export type RankingMetric = z.infer<typeof RankingMetricSchema>;

export const RankingPeriodSchema = z.enum(["daily", "weekly", "monthly"]);
export type RankingPeriod = z.infer<typeof RankingPeriodSchema>;

export const PublicRankingPlatformAccountSchema = z.object({
  platform: StreamerPlatformSchema,
  channelName: z.string(),
  channelUrl: z.string(),
  avatarUrl: z.string().nullable(),
});

export const PublicRankingEntrySchema = z.object({
  rank: z.number().int().positive(),
  userId: z.number().int().positive(),
  nickname: z.string(),
  avatarUrl: z.string().nullable(),
  /** Self-reported ISO country/region code. null also represents unset, hidden, or unknown. */
  country: z.string().nullable(),
  value: z.number().finite(),
  formattedValue: z.string(),
  /** ISO timestamp/date at which the value represented by this row was reached. */
  achievedAt: z.string(),
  gameId: z.string().optional(),
  variantId: z.string().optional(),
  streamerId: z.number().int().positive().optional(),
  platformAccounts: z.array(PublicRankingPlatformAccountSchema).default([]),
});
export type PublicRankingEntry = z.infer<typeof PublicRankingEntrySchema>;

export const PublicRankingQuerySchema = z
  .object({
    scope: RankingScopeSchema.default("general"),
    metric: RankingMetricSchema.default("score"),
    period: RankingPeriodSchema.default("daily"),
    gameId: z.string().trim().min(1).max(64).optional(),
    difficulty: z.string().trim().min(1).max(64).optional(),
    platform: StreamerPlatformSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .superRefine((query, context) => {
    if (query.metric === "score" && !query.gameId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["gameId"],
        message: "gameId is required for score rankings",
      });
    }
    if (query.scope !== "streamer" && query.platform !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["platform"],
        message: "platform is available only for streamer rankings",
      });
    }
    if (query.metric !== "score" && query.difficulty !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["difficulty"],
        message: "difficulty is available only for score rankings",
      });
    }
  });
export type PublicRankingQuery = z.infer<typeof PublicRankingQuerySchema>;

export const PublicRankingResponseSchema = z.object({
  scope: RankingScopeSchema,
  metric: RankingMetricSchema,
  period: RankingPeriodSchema,
  periodStart: z.string(),
  periodEnd: z.string(),
  entries: z.array(PublicRankingEntrySchema),
});
export type PublicRankingResponse = z.infer<typeof PublicRankingResponseSchema>;
