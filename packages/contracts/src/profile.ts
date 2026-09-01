import { z } from "zod";

export const ProfileErrorCodeSchema = z.enum([
  "INVALID_NICKNAME",
  "NICKNAME_COOLDOWN_ACTIVE",
  "INVALID_COUNTRY",
  "COUNTRY_COOLDOWN_ACTIVE",
  "INVALID_VISIBILITY",
  "INVALID_AVATAR_PROVIDER",
  "AVATAR_PROVIDER_NOT_LINKED",
  "AVATAR_UNAVAILABLE",
  "USER_NOT_FOUND",
]);
export type ProfileErrorCode = z.infer<typeof ProfileErrorCodeSchema>;

export const UpdateNicknameRequestSchema = z.object({
  nickname: z.string().min(1, "닉네임을 입력해주세요."),
});
export type UpdateNicknameRequest = z.infer<typeof UpdateNicknameRequestSchema>;

export const UpdateNicknameResponseSchema = z.object({
  success: z.literal(true),
  nickname: z.string(),
  nicknameUpdatedAt: z.string(),
});
export type UpdateNicknameResponse = z.infer<typeof UpdateNicknameResponseSchema>;

export const UpdateAvatarPreferenceRequestSchema = z.object({
  provider: z.enum(["google", "discord"]),
});
export type UpdateAvatarPreferenceRequest = z.infer<typeof UpdateAvatarPreferenceRequestSchema>;

export const UpdateAvatarPreferenceResponseSchema = z.object({
  success: z.literal(true),
  avatarProvider: z.enum(["google", "discord"]),
  avatarUrl: z.string(),
});
export type UpdateAvatarPreferenceResponse = z.infer<typeof UpdateAvatarPreferenceResponseSchema>;

// null = unset ("국가/지역" not provided). Server accepts "UNSET"/"" as the same intent.
export const UpdateCountryRequestSchema = z.object({
  country: z.string().nullable(),
});
export type UpdateCountryRequest = z.infer<typeof UpdateCountryRequestSchema>;

export const UpdateCountryResponseSchema = z.object({
  success: z.literal(true),
  country: z.string().nullable(),
  countryUpdatedAt: z.string(),
});
export type UpdateCountryResponse = z.infer<typeof UpdateCountryResponseSchema>;

// Controls disclosure of favorites and recent-play activity (list + daily calendar) on the
// PUBLIC profile. Data is stored regardless; this only decides whether other viewers see it.
// No cooldown (see ProfileUseCases.updateVisibility).
export const UpdateVisibilityRequestSchema = z.object({
  showFavorites: z.boolean(),
  showRecentPlays: z.boolean(),
});
export type UpdateVisibilityRequest = z.infer<typeof UpdateVisibilityRequestSchema>;

export const UpdateVisibilityResponseSchema = z.object({
  success: z.literal(true),
  showFavorites: z.boolean(),
  showRecentPlays: z.boolean(),
});
export type UpdateVisibilityResponse = z.infer<typeof UpdateVisibilityResponseSchema>;
