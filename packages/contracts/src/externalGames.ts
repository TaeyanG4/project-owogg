import { z } from "zod";

export const ExternalGameModerationStatusSchema = z.enum([
  "DRAFT",
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
]);
export const ExternalGameVisibilitySchema = z.enum(["PRIVATE", "PUBLIC"]);
export const ExternalGameOwnershipTypeSchema = z.enum(["OWN_GAME", "THIRD_PARTY"]);
export const ExternalGameMediaKindSchema = z.enum(["BANNER", "SCREENSHOT"]);
export type ExternalGameModerationStatus = z.infer<typeof ExternalGameModerationStatusSchema>;
export type ExternalGameVisibility = z.infer<typeof ExternalGameVisibilitySchema>;
export type ExternalGameOwnershipType = z.infer<typeof ExternalGameOwnershipTypeSchema>;
export type ExternalGameMediaKind = z.infer<typeof ExternalGameMediaKindSchema>;

const ExternalGameSlugSchema = z
  .string()
  .trim()
  .min(3)
  .max(48)
  .regex(/^[a-z0-9-]+$/);
const ExternalGameReleaseDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();
const ExternalGameTagsSchema = z.array(z.string().trim().min(1).max(24)).max(8);
const ExternalGameUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((value) => new URL(value).protocol === "https:", {
    message: "외부 게임 링크는 HTTPS URL이어야 합니다.",
  });

export const ExternalGameContentRequestSchema = z.object({
  title: z.string().trim().min(2).max(120),
  shortDescription: z.string().trim().min(1).max(240),
  descriptionMarkdown: z.string().trim().min(1).max(20_000),
  platformName: z.string().trim().min(1).max(60),
  externalUrl: ExternalGameUrlSchema,
  releaseDate: ExternalGameReleaseDateSchema,
  tags: ExternalGameTagsSchema,
  ownershipType: ExternalGameOwnershipTypeSchema,
  rightsNote: z.string().trim().max(1000).default(""),
});

export const ExternalGameCreateRequestSchema = ExternalGameContentRequestSchema.extend({
  slug: ExternalGameSlugSchema,
});
export type ExternalGameCreateRequest = z.infer<typeof ExternalGameCreateRequestSchema>;

export const ExternalGameUpdateRequestSchema = ExternalGameContentRequestSchema;
export type ExternalGameUpdateRequest = z.infer<typeof ExternalGameUpdateRequestSchema>;

export const ExternalGameSubmitRequestSchema = z.object({
  rightsConfirmed: z.literal(true),
});

export const ExternalGameMediaSchema = z.object({
  id: z.number().int().positive(),
  kind: ExternalGameMediaKindSchema,
  url: z.string(),
  contentType: z.enum(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]),
  byteSize: z.number().int().positive(),
  altText: z.string(),
  sortOrder: z.number().int().nonnegative(),
});
export type ExternalGameMedia = z.infer<typeof ExternalGameMediaSchema>;

export const ExternalGameRecordSchema = z.object({
  id: z.number().int().positive(),
  slug: ExternalGameSlugSchema,
  introducerUserId: z.number().int().positive(),
  introducerName: z.string(),
  title: z.string(),
  shortDescription: z.string(),
  descriptionMarkdown: z.string(),
  platformName: z.string(),
  externalUrl: ExternalGameUrlSchema,
  releaseDate: ExternalGameReleaseDateSchema,
  tags: z.array(z.string()),
  ownershipType: ExternalGameOwnershipTypeSchema,
  rightsNote: z.string(),
  rightsAttestedAt: z.string().nullable(),
  moderationStatus: ExternalGameModerationStatusSchema,
  visibility: ExternalGameVisibilitySchema,
  reviewSlot: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable(),
  rejectReason: z.string().nullable(),
  publishedAt: z.string().nullable(),
  deletedAt: z.string().nullable(),
  bookmarkCount: z.number().int().nonnegative(),
  isBookmarked: z.boolean(),
  media: z.array(ExternalGameMediaSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ExternalGameRecord = z.infer<typeof ExternalGameRecordSchema>;

export const ExternalGameMineListResponseSchema = z.object({
  games: z.array(ExternalGameRecordSchema),
});

export const ExternalGameListResponseSchema = z.object({
  games: z.array(ExternalGameRecordSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalPages: z.number().int().positive(),
});
export type ExternalGameListResponse = z.infer<typeof ExternalGameListResponseSchema>;

export const ExternalGameListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(48).default(24),
  sort: z.enum(["newest", "bookmarks"]).default("newest"),
  search: z.string().trim().max(100).default(""),
});

export const AdminExternalGameListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: ExternalGameModerationStatusSchema.optional(),
});

export const ExternalGameReviewDecisionRequestSchema = z.object({
  reason: z.string().trim().max(1000).nullable().optional(),
});

export const ExternalGameVisibilityUpdateRequestSchema = z.object({
  visibility: ExternalGameVisibilitySchema,
});

export const ExternalGameBookmarkResponseSchema = z.object({
  bookmarked: z.boolean(),
  bookmarkCount: z.number().int().nonnegative(),
});

export const ExternalGameDeleteResponseSchema = z.object({ deleted: z.literal(true) });
