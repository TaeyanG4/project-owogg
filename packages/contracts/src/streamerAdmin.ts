import { z } from "zod";
import {
  StreamerPlatformAccountDtoSchema,
  StreamerPlatformSchema,
  FeaturedStatusSchema,
  StreamerStatusSchema,
} from "./streamer.js";

export const StreamerManualReviewActionSchema = z.enum([
  "APPROVE_FEATURED",
  "REJECT_FEATURED",
  "KEEP_FOR_REVIEW",
]);
export type StreamerManualReviewAction = z.infer<typeof StreamerManualReviewActionSchema>;

export const StreamerManualReviewActionRequestSchema = z
  .object({
    action: StreamerManualReviewActionSchema,
    reason: z.string().trim().min(3).max(1000),
  })
  .strict();
export type StreamerManualReviewActionRequest = z.infer<
  typeof StreamerManualReviewActionRequestSchema
>;

export const StreamerManualReviewJobDtoSchema = z.object({
  id: z.number(),
  streamerPlatformAccountId: z.number(),
  reviewType: z.enum(["ACQUISITION", "REVALIDATION"]),
  status: z.enum([
    "AUTO_REVIEW_PENDING",
    "FEATURED",
    "NOT_ELIGIBLE",
    "MANUAL_REVIEW",
    "FAILED_RETRYABLE",
    "REVALIDATION_PENDING",
    "REVALIDATION_FAILED_RETRYABLE",
  ]),
  initialAudience: z.number().nullable(),
  initialChannelCreatedAt: z.string().nullable(),
  nextCheckAt: z.string(),
  attemptCount: z.number(),
  reviewReason: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
});

export const StreamerManualReviewItemDtoSchema = z.object({
  job: StreamerManualReviewJobDtoSchema,
  userId: z.number(),
  nickname: z.string(),
  streamerId: z.number(),
  streamerStatus: StreamerStatusSchema,
  featuredStatus: FeaturedStatusSchema,
  platformAccount: StreamerPlatformAccountDtoSchema,
});
export type StreamerManualReviewItemDto = z.infer<typeof StreamerManualReviewItemDtoSchema>;

export const StreamerReviewAuditMetricSnapshotSchema = z.object({
  platform: StreamerPlatformSchema,
  channelName: z.string(),
  channelUrl: z.string(),
  verificationStatus: z.string(),
  audienceCount: z.number().nullable(),
  channelCreatedAt: z.string().nullable(),
  metricsSyncedAt: z.string().nullable(),
});

export const StreamerReviewAuditLogDtoSchema = z.object({
  id: z.number(),
  streamerPlatformAccountId: z.number(),
  reviewJobId: z.number().nullable(),
  reviewerUserId: z.number(),
  action: StreamerManualReviewActionSchema,
  reason: z.string(),
  previousStatus: z.string(),
  newStatus: z.string(),
  metricSnapshot: StreamerReviewAuditMetricSnapshotSchema.nullable(),
  createdAt: z.string(),
  platform: StreamerPlatformSchema.nullable(),
  channelName: z.string().nullable(),
});
export type StreamerReviewAuditLogDto = z.infer<typeof StreamerReviewAuditLogDtoSchema>;

export const StreamerManualReviewQueueResponseSchema = z.object({
  items: z.array(StreamerManualReviewItemDtoSchema),
  total: z.number(),
  audits: z.object({
    entries: z.array(StreamerReviewAuditLogDtoSchema),
    total: z.number(),
  }),
});
export type StreamerManualReviewQueueResponse = z.infer<
  typeof StreamerManualReviewQueueResponseSchema
>;

export const StreamerManualReviewActionResponseSchema = z.object({
  applied: z.boolean(),
  action: StreamerManualReviewActionSchema,
  previousStatus: z.string().nullable(),
  newStatus: z.string().nullable(),
});
export type StreamerManualReviewActionResponse = z.infer<
  typeof StreamerManualReviewActionResponseSchema
>;
