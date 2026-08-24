import { z } from "zod";

/** Mirrors packages/core/src/domain/i18nPolicy.ts SUPPORTED_LOCALES — kept in sync by hand,
 * matching how StreamerPlatformSchema independently mirrors StreamerPlatformType. zh-TW is
 * intentionally out of scope this sprint. */
export const SupportedLocaleSchema = z.enum(["ko-KR", "en-US", "ja-JP", "zh-CN"]);
export type SupportedLocale = z.infer<typeof SupportedLocaleSchema>;

export const UpdateLocaleRequestSchema = z.object({
  locale: SupportedLocaleSchema,
});
export type UpdateLocaleRequest = z.infer<typeof UpdateLocaleRequestSchema>;

export const UpdateLocaleResponseSchema = z.object({
  success: z.literal(true),
  locale: SupportedLocaleSchema,
});
export type UpdateLocaleResponse = z.infer<typeof UpdateLocaleResponseSchema>;
