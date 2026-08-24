import { z } from "zod";
import { SocialProviderSchema } from "./auth.js";

export const AccountErrorCodeSchema = z.enum([
  "ACCOUNT_ALREADY_LINKED",
  "PROVIDER_ALREADY_LINKED",
  "LAST_AUTH_PROVIDER",
  "MERGE_CHALLENGE_EXPIRED",
  "MERGE_PROVIDER_CONFLICT",
  "MERGE_CREATOR_CONFLICT",
  // Discord bot /owogg link challenge (packages/contracts/src/discord.ts)
  "LINK_CHALLENGE_EXPIRED",
  "LINK_CHALLENGE_CONSUMED",
]);
export type AccountErrorCode = z.infer<typeof AccountErrorCodeSchema>;

export const ConnectedProviderSchema = z.object({
  provider: SocialProviderSchema,
  providerUserId: z.string(),
  providerEmail: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  isAvatarSelected: z.boolean(),
});
export type ConnectedProvider = z.infer<typeof ConnectedProviderSchema>;

export const ConnectedProvidersResponseSchema = z.object({
  providers: z.array(ConnectedProviderSchema),
});
export type ConnectedProvidersResponse = z.infer<typeof ConnectedProvidersResponseSchema>;

export const LinkProviderResponseSchema = z.object({
  linked: z.boolean(),
  provider: SocialProviderSchema,
  alreadyLinked: z.boolean().optional(),
});
export type LinkProviderResponse = z.infer<typeof LinkProviderResponseSchema>;

export const UnlinkProviderResponseSchema = z.object({
  unlinked: z.boolean(),
  provider: SocialProviderSchema,
});
export type UnlinkProviderResponse = z.infer<typeof UnlinkProviderResponseSchema>;

export const AccountLinkConflictSchema = z.object({
  error: z.object({
    code: AccountErrorCodeSchema,
    message: z.string(),
  }),
  conflictUserId: z.number().optional(),
});
export type AccountLinkConflict = z.infer<typeof AccountLinkConflictSchema>;

export const LinkProviderRequestSchema = z.object({
  credential: z.string().min(1, "Credential is required"),
});
export type LinkProviderRequest = z.infer<typeof LinkProviderRequestSchema>;

// ---------------------------------------------------------------------------
// Account merge (Primary Account Wins)
// ---------------------------------------------------------------------------

export const MergePreviewSchema = z.object({
  userId: z.number(),
  nickname: z.string(),
  provider: z.string(),
  createdAt: z.string(),
  scoreCount: z.number(),
  favoriteCount: z.number(),
  recentPlayCount: z.number(),
});
export type MergePreview = z.infer<typeof MergePreviewSchema>;

export const MergePreviewPairSchema = z.object({
  userA: MergePreviewSchema,
  userB: MergePreviewSchema,
});
export type MergePreviewPair = z.infer<typeof MergePreviewPairSchema>;

export const MergePreviewQuerySchema = z.object({
  challenge: z.string().min(1).max(128),
});
export type MergePreviewQuery = z.infer<typeof MergePreviewQuerySchema>;

export const CreateMergeChallengeResponseSchema = z.object({
  challengeId: z.string(),
  expiresAt: z.string(),
  conflictUserId: z.number(),
  provider: SocialProviderSchema,
});
export type CreateMergeChallengeResponse = z.infer<typeof CreateMergeChallengeResponseSchema>;

export const MergeChallengeResolveRequestSchema = z
  .object({
    conflictUserId: z.number(),
    provider: SocialProviderSchema,
  })
  .strict();
export type MergeChallengeResolveRequest = z.infer<typeof MergeChallengeResolveRequestSchema>;

export const ConfirmAccountMergeRequestSchema = z
  .object({
    challengeId: z.string().min(1),
    keepUserId: z.number(),
  })
  .strict();
export type ConfirmAccountMergeRequest = z.infer<typeof ConfirmAccountMergeRequestSchema>;

export const ConfirmAccountMergeResponseSchema = z.object({
  merged: z.boolean(),
  primaryId: z.number(),
  secondaryId: z.number(),
});
export type ConfirmAccountMergeResponse = z.infer<typeof ConfirmAccountMergeResponseSchema>;
