import { z } from "zod";

const ScoreConfigSchema = z.object({
  unit: z.string(),
  direction: z.enum(["asc", "desc"]),
  min: z.number(),
  max: z.number(),
  precision: z.number().int().min(0).max(6).optional(),
  outOfRange: z.enum(["clamp", "reject"]).optional(),
  displayPrefix: z.string().optional(),
  displaySuffix: z.string().optional(),
});

const DifficultyConfigSchema = z.object({
  levels: z.array(z.object({ id: z.string(), label: z.string() })),
  defaultLevelId: z.string(),
});

const GamePolicySchema = z.object({
  score: ScoreConfigSchema.nullable(),
  leaderboard: z.boolean(),
  xpPerCompletion: z.number().int().nonnegative(),
  requiresAuth: z.boolean(),
});

const GamePresentationSchema = z.object({
  viewport: z.discriminatedUnion("mode", [
    z.object({
      mode: z.literal("responsive"),
      preferredWidth: z.number().positive().optional(),
      preferredHeight: z.number().positive().optional(),
      minWidth: z.number().positive().optional(),
      minHeight: z.number().positive().optional(),
      maxWidth: z.number().positive().optional(),
      maxHeight: z.number().positive().optional(),
    }),
    z.object({
      mode: z.literal("fixed"),
      preferredWidth: z.number().positive(),
      preferredHeight: z.number().positive(),
      minWidth: z.number().positive().optional(),
      minHeight: z.number().positive().optional(),
      maxWidth: z.number().positive().optional(),
      maxHeight: z.number().positive().optional(),
    }),
  ]),
  fullscreen: z.object({
    supported: z.boolean(),
    recommended: z.boolean().optional(),
  }),
  mobile: z.object({
    support: z.enum(["supported", "experimental", "unsupported"]),
    orientation: z.enum(["any", "portrait", "landscape"]).optional(),
  }),
});

const TaxonomyCatalogSchema = z.object({
  type: z.literal("TAXONOMY"),
  categories: z.array(z.string()),
  tags: z.array(z.string()),
  modes: z.array(z.enum(["single", "local-multi", "online-multi"])),
  inputMethods: z.array(z.enum(["mouse", "keyboard", "touch", "gamepad"])),
  minPlayers: z.number().int().positive(),
  maxPlayers: z.number().int().positive(),
  thumbnail: z.string(),
  accent: z.string().optional(),
  estimatedRoundSeconds: z.number().positive().optional(),
});

const GenreModeCatalogSchema = z.object({
  type: z.literal("GENRE_MODE"),
  genre: z.string(),
  mode: z.enum(["single", "multi"]),
  tags: z.array(z.string()).optional(),
  inputMethods: z.array(z.enum(["mouse", "keyboard", "touch", "gamepad"])).optional(),
});

const PublicGameSchemaBase = {
  slug: z.string(),
  title: z.string(),
  shortDescription: z.string(),
  description: z.string(),
  catalog: z.union([TaxonomyCatalogSchema, GenreModeCatalogSchema]),
  policy: GamePolicySchema,
  presentation: GamePresentationSchema.optional(),
  difficulty: DifficultyConfigSchema.optional(),
  supportsReplay: z.boolean(),
  mediaUrl: z.union([z.string().url(), z.string().startsWith("/")]).nullable(),
};

/** Provider authority is an explicit wire discriminant. No publisher user id or review fields
 * are part of either branch; the canonical catalog shape remains the only metadata union. */
export const PublicGameSchema = z.discriminatedUnion("publisherType", [
  z.object({
    ...PublicGameSchemaBase,
    publisherType: z.literal("OWOGG"),
    publisherName: z.literal("OWOGG"),
  }),
  z.object({
    ...PublicGameSchemaBase,
    publisherType: z.literal("USER"),
    publisherName: z.string().min(1),
  }),
]);
export type PublicGame = z.infer<typeof PublicGameSchema>;

export const PublicGameListResponseSchema = z.object({
  games: z.array(PublicGameSchema),
});
export type PublicGameListResponse = z.infer<typeof PublicGameListResponseSchema>;

export const AdminOfficialGameUploadResponseSchema = z.object({
  gameId: z.number().int().positive(),
  versionId: z.number().int().positive(),
  slug: z.string().min(1),
  title: z.string().min(1),
  publisherName: z.literal("OWOGG"),
  reusedReadyVersion: z.boolean(),
  publishedAt: z.string().min(1),
});
export type AdminOfficialGameUploadResponse = z.infer<typeof AdminOfficialGameUploadResponseSchema>;

export const AdminOfficialGameDeleteResponseSchema = z.object({
  gameId: z.number().int().positive(),
  slug: z.string().min(1),
  deletedVersionCount: z.number().int().nonnegative(),
  deletedObjectCount: z.number().int().nonnegative(),
  deletedAt: z.string().min(1),
});
export type AdminOfficialGameDeleteResponse = z.infer<typeof AdminOfficialGameDeleteResponseSchema>;

/** POST /api/games/:slug/session — short-lived parent-side Game Session token. */
export const GameSessionResponseSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
});
export type GameSessionResponse = z.infer<typeof GameSessionResponseSchema>;

export const GameScoreAcceptRequestSchema = z.object({
  token: z.string(),
  score: z.number(),
  difficulty: z.string().optional(),
  playToken: z.string().optional(),
});
export type GameScoreAcceptRequest = z.infer<typeof GameScoreAcceptRequestSchema>;

export const GameScoreAcceptResponseSchema = z.object({
  success: z.literal(true),
  score_id: z.number().int().positive().optional(),
  game_id: z.string().optional(),
  score: z.number().optional(),
  nickname: z.string().optional(),
  xpAwarded: z.number().int().min(0).optional(),
  guildXpAwarded: z.number().int().min(0).optional(),
  guildId: z.string().optional(),
  newlyUnlockedAchievements: z.array(z.string()).optional(),
});
export type GameScoreAcceptResponse = z.infer<typeof GameScoreAcceptResponseSchema>;

const CreatorFactKeySchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);

export const GameResultAcceptRequestSchema = z
  .object({
    token: z.string(),
    outcome: z.enum(["neutral", "success", "failure", "win", "loss", "draw"]).optional(),
    score: z.number().finite().optional(),
    progression: z.object({ value: z.number().finite() }).strict().optional(),
    metrics: z.record(CreatorFactKeySchema, z.number().finite()).optional(),
    events: z.record(CreatorFactKeySchema, z.number().int().positive().max(10_000)).optional(),
    difficulty: z.string().optional(),
    playToken: z.string().optional(),
  })
  .strict();
export type GameResultAcceptRequest = z.infer<typeof GameResultAcceptRequestSchema>;

export const GameResultAcceptResponseSchema = z.object({
  success: z.literal(true),
  result_id: z.number().int().positive(),
  score_id: z.number().int().positive().nullable(),
  game_id: z.string(),
  score: z.number().nullable(),
  adjusted: z.boolean(),
  rewardEligible: z.boolean(),
  xpAwarded: z.number().int().min(0),
  guildXpAwarded: z.number().int().min(0).optional(),
  guildId: z.string().optional(),
  newlyUnlockedAchievements: z.array(z.string()),
});
export type GameResultAcceptResponse = z.infer<typeof GameResultAcceptResponseSchema>;
