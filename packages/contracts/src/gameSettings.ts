import { z } from "zod";

// Admin-controlled live enable/disable override per game (see
// packages/db/migrations/0019_game_settings.sql). GameManifest.status is a static, build-time
// value shared with the Discord bot — this is the separate, DB-backed layer an admin can flip
// without a deploy.

export const GameAvailabilityDtoSchema = z.object({
  gameId: z.string(),
  title: z.string(),
  publisherType: z.enum(["OWOGG", "USER"]),
  status: z.string(),
  enabled: z.boolean(),
  disabledReason: z.string().nullable(),
  updatedByAdminId: z.number().nullable(),
  updatedAt: z.string().nullable(),
});
export type GameAvailabilityDto = z.infer<typeof GameAvailabilityDtoSchema>;

export const AdminGameListResponseSchema = z.object({
  games: z.array(GameAvailabilityDtoSchema),
});
export type AdminGameListResponse = z.infer<typeof AdminGameListResponseSchema>;

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

// GET /api/games/availability — public, no auth. Just the disabled set, nothing about who/why.
export const PublicGameAvailabilityResponseSchema = z.object({
  disabledGameIds: z.array(z.string()),
});
export type PublicGameAvailabilityResponse = z.infer<typeof PublicGameAvailabilityResponseSchema>;
