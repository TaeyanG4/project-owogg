import { z } from "zod";

export const SocialProviderSchema = z.enum(["google", "discord"]);
export type SocialProvider = z.infer<typeof SocialProviderSchema>;

export const AuthUserSchema = z.object({
  id: z.number(),
  nickname: z.string(),
  email: z.string().nullable(),
  avatar_url: z.string().nullable(),
  avatar_provider: SocialProviderSchema.nullable().optional(),
  providers: z.array(SocialProviderSchema),
  created_at: z.string(),
  // Self-reported "국가/지역" (ISO 3166-1 alpha-2), not verified nationality. Optional so
  // older cached responses without these fields still parse.
  country: z.string().nullable().optional(),
  nickname_updated_at: z.string().nullable().optional(),
  country_updated_at: z.string().nullable().optional(),
  // Loose string (not the strict enum) so a stale/legacy value never fails to parse — the
  // client-side i18n resolver treats anything unsupported as "no saved preference".
  locale: z.string().nullable().optional(),
});
export type AuthUser = z.infer<typeof AuthUserSchema>;

export const AuthMeResponseSchema = z.object({
  authenticated: z.boolean(),
  user: AuthUserSchema.optional(),
});
export type AuthMeResponse = z.infer<typeof AuthMeResponseSchema>;

export const GoogleLoginRequestSchema = z.object({
  credential: z.string().min(1, "Credential is required"),
});
export type GoogleLoginRequest = z.infer<typeof GoogleLoginRequestSchema>;

export const GoogleAuthorizationCodeLoginRequestSchema = z.object({
  code: z.string().min(1, "Authorization code is required").max(4096),
});
export type GoogleAuthorizationCodeLoginRequest = z.infer<
  typeof GoogleAuthorizationCodeLoginRequestSchema
>;

export const AuthProvidersResponseSchema = z.object({
  google: z.object({
    configured: z.boolean(),
    clientId: z.string().optional(),
  }),
  discord: z.object({
    configured: z.boolean(),
  }),
});
export type AuthProvidersResponse = z.infer<typeof AuthProvidersResponseSchema>;
