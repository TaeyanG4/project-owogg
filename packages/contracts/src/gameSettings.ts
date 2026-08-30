import { z } from "zod";

export const AdminGameCatalogRoleSchema = z.enum(["GAME", "INTERNAL_TOOL"]);
export type AdminGameCatalogRole = z.infer<typeof AdminGameCatalogRoleSchema>;

// Admin-controlled live enable/disable override per game (see
// packages/db/migrations/0019_game_settings.sql). GameManifest.status is a static, build-time
// value shared with the Discord bot — this is the separate, DB-backed layer an admin can flip
// without a deploy.

export const GameAvailabilityDtoSchema = z.object({
  gameId: z.string(),
  title: z.string(),
  shortDescription: z.string().nullable(),
  description: z.string().nullable(),
  genre: z.string().nullable(),
  mode: z.enum(["single", "multi"]).nullable(),
  latestUploadedAt: z.string().nullable(),
  publisherType: z.enum(["OWOGG", "USER"]),
  catalogRole: AdminGameCatalogRoleSchema,
  catalogState: z.enum(["READY", "PRIVATE", "NO_LIVE_VERSION", "CANONICAL_UNAVAILABLE"]),
  status: z.string(),
  enabled: z.boolean(),
  disabledReason: z.string().nullable(),
  updatedByAdminId: z.number().nullable(),
  updatedAt: z.string().nullable(),
});
export type GameAvailabilityDto = z.infer<typeof GameAvailabilityDtoSchema>;

export const AdminGameListResponseSchema = z.object({
  games: z.array(GameAvailabilityDtoSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.union([z.literal(10), z.literal(20), z.literal(30)]),
  totalPages: z.number().int().positive(),
});
export type AdminGameListResponse = z.infer<typeof AdminGameListResponseSchema>;

export const AdminGameListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .refine((value): value is 10 | 20 | 30 => value === 10 || value === 20 || value === 30)
    .default(10),
  catalogRole: AdminGameCatalogRoleSchema.default("GAME"),
});

export const AdminGameToggleRequestSchema = z.object({
  enabled: z.boolean(),
  /** Only meaningful when disabling — ignored (cleared) when re-enabling. */
  reason: z.string().trim().max(200).nullable().optional(),
});
export type AdminGameToggleRequest = z.infer<typeof AdminGameToggleRequestSchema>;

export const AdminGameToggleResponseSchema = z.object({
  gameId: z.string(),
  enabled: z.boolean(),
  disabledReason: z.string().nullable(),
});
export type AdminGameToggleResponse = z.infer<typeof AdminGameToggleResponseSchema>;

export const AdminGameCatalogRoleRequestSchema = z.object({
  catalogRole: AdminGameCatalogRoleSchema,
});
export type AdminGameCatalogRoleRequest = z.infer<typeof AdminGameCatalogRoleRequestSchema>;

export const AdminGameCatalogRoleResponseSchema = z.object({
  gameId: z.string(),
  catalogRole: AdminGameCatalogRoleSchema,
});
export type AdminGameCatalogRoleResponse = z.infer<typeof AdminGameCatalogRoleResponseSchema>;

// GET /api/games/availability — public, no auth. Just the disabled set, nothing about who/why.
export const PublicGameAvailabilityResponseSchema = z.object({
  disabledGameIds: z.array(z.string()),
});
export type PublicGameAvailabilityResponse = z.infer<typeof PublicGameAvailabilityResponseSchema>;
