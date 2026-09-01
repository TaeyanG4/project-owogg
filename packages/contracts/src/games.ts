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

const PublicGamePlayConfigSchema = z
  .object({
    version: z.literal(1),
    rulesetRevision: z.number().int().positive(),
    defaultVariantId: z.string().min(1).max(100),
    variants: z
      .array(
        z
          .object({
            id: z.string().min(1).max(100),
            label: z.string().min(1).max(60),
          })
          .strict(),
      )
      .min(1),
    allowedConfigs: z
      .array(
        z
          .object({
            difficultyId: z.string().min(1).max(100),
            variantId: z.string().min(1).max(100),
            rewardFactor: z.number().finite().positive(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

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
  defaultMode: z.enum(["default", "theater"]).optional(),
});

export const PublicGameDescriptionDocumentSchema = z
  .object({
    locale: z.enum(["en", "ko", "ja", "zh"]),
    path: z.enum(["description.md", "description_kr.md", "description_ja.md", "description_zh.md"]),
    markdown: z.string(),
  })
  .strict();

export const PublicGameDescriptionImageSchema = z
  .object({ path: z.string().min(1), url: z.string().url() })
  .strict();

export const PublicGameLocalizationSchema = z
  .object({
    title: z.string().min(1).max(60).optional(),
    shortDescription: z.string().max(200).optional(),
  })
  .strict();

export const PublicGameLocalizationsSchema = z
  .object({
    ko: PublicGameLocalizationSchema.optional(),
    ja: PublicGameLocalizationSchema.optional(),
    zh: PublicGameLocalizationSchema.optional(),
  })
  .strict();

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
  playModes: z.array(z.enum(["single", "local-multi", "online-multi"])).min(1),
  catalog: z.union([TaxonomyCatalogSchema, GenreModeCatalogSchema]),
  policy: GamePolicySchema,
  presentation: GamePresentationSchema.optional(),
  difficulty: DifficultyConfigSchema.optional(),
  playConfig: PublicGamePlayConfigSchema.optional(),
  supportsReplay: z.boolean(),
  publishedAt: z.string().min(1),
  stats: z.object({
    playerCount: z.number().int().nonnegative(),
    bookmarkCount: z.number().int().nonnegative(),
    popularityScore: z.number().int().nonnegative(),
  }),
  mediaUrl: z.union([z.string().url(), z.string().startsWith("/")]).nullable(),
  /** Optional translated display metadata. Top-level title/summary are always the English/default
   * fallback and therefore remain required for every game. */
  localizations: PublicGameLocalizationsSchema.optional(),
  descriptions: z.array(PublicGameDescriptionDocumentSchema).optional(),
  descriptionImages: z.array(PublicGameDescriptionImageSchema).max(5).optional(),
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

const GameEditorContextBaseSchema = {
  gameId: z.number().int().positive(),
  contentEditAvailableAt: z.string().datetime().nullable(),
};

export const GameEditorContextSchema = z.discriminatedUnion("mode", [
  z.object({
    ...GameEditorContextBaseSchema,
    mode: z.literal("OFFICIAL_ADMIN"),
    publisherType: z.literal("OWOGG"),
  }),
  z.object({
    ...GameEditorContextBaseSchema,
    mode: z.literal("USER_ADMIN"),
    publisherType: z.literal("USER"),
  }),
  z.object({
    ...GameEditorContextBaseSchema,
    mode: z.literal("USER_CREATOR"),
    publisherType: z.literal("USER"),
  }),
]);
export type GameEditorContext = z.infer<typeof GameEditorContextSchema>;

export const GameEditorContextResponseSchema = z.object({
  editor: GameEditorContextSchema.nullable(),
});
export type GameEditorContextResponse = z.infer<typeof GameEditorContextResponseSchema>;

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
  identityRetainedForHistory: z.boolean(),
});
export type AdminOfficialGameDeleteResponse = z.infer<typeof AdminOfficialGameDeleteResponseSchema>;

const GameSessionCanonicalIdSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => value === value.trim(), "ID must not have surrounding whitespace");

export const GameSessionPlayConfigSelectionSchema = z
  .object({
    difficultyId: GameSessionCanonicalIdSchema,
    variantId: GameSessionCanonicalIdSchema,
  })
  .strict();

export const LegacyGameSessionRequestSchema = z
  .object({ difficulty: GameSessionCanonicalIdSchema.optional() })
  .strict();

/** `online-multi` is intentionally absent: managed online uses profile/ticket/DO authority. */
export const PlayConfigGameSessionRequestSchema = z
  .object({
    playMode: z.enum(["single", "local-multi"]),
    playConfig: GameSessionPlayConfigSelectionSchema,
  })
  .strict();

/** Strict request union for the existing session endpoint. */
export const GameSessionRequestSchema = z.union([
  PlayConfigGameSessionRequestSchema,
  LegacyGameSessionRequestSchema,
]);
export type GameSessionRequest = z.infer<typeof GameSessionRequestSchema>;
export type PlayConfigGameSessionRequest = z.infer<typeof PlayConfigGameSessionRequestSchema>;

export const AuthorizedGameStartContextSchema = z
  .object({
    ranked: z.boolean(),
    playConfig: GameSessionPlayConfigSelectionSchema,
    rulesetRevision: z.number().int().positive(),
    challengeSeed: z
      .string()
      .min(16)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/),
    rewardFactor: z.number().finite().positive(),
  })
  .strict();
export type AuthorizedGameStartContext = z.infer<typeof AuthorizedGameStartContextSchema>;

const SignedGameSessionTokenSchema = (version: "gs1" | "gs2") =>
  z.string().regex(new RegExp(`^${version}\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$`));

export const LegacyGameSessionResponseSchema = z
  .object({
    token: SignedGameSessionTokenSchema("gs1"),
    expiresAt: z.string().datetime(),
  })
  .strict();

export const PlayConfigGameSessionResponseSchema = z
  .object({
    token: SignedGameSessionTokenSchema("gs2"),
    expiresAt: z.string().datetime(),
    startContext: AuthorizedGameStartContextSchema,
  })
  .strict();

/** POST /api/games/:slug/session — parent-only token plus optional public start context. */
export const GameSessionResponseSchema = z.union([
  PlayConfigGameSessionResponseSchema,
  LegacyGameSessionResponseSchema,
]);
export type GameSessionResponse = z.infer<typeof GameSessionResponseSchema>;
export type PlayConfigGameSessionResponse = z.infer<typeof PlayConfigGameSessionResponseSchema>;

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

const GameCreatorFactKeySchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);

export const LegacyGameResultAcceptRequestSchema = z
  .object({
    token: SignedGameSessionTokenSchema("gs1"),
    outcome: z.enum(["neutral", "success", "failure", "win", "loss", "draw"]).optional(),
    score: z.number().finite().optional(),
    progression: z.object({ value: z.number().finite() }).strict().optional(),
    metrics: z.record(GameCreatorFactKeySchema, z.number().finite()).optional(),
    events: z.record(GameCreatorFactKeySchema, z.number().int().positive().max(10_000)).optional(),
    difficulty: z.string().optional(),
    playToken: z.string().optional(),
  })
  .strict();

export const VerifiedGameResultAcceptRequestSchema = z
  .object({
    token: SignedGameSessionTokenSchema("gs2"),
    evidence: z.union([
      z.null(),
      z.boolean(),
      z.number(),
      z.string(),
      z.array(z.unknown()),
      z.record(z.unknown()),
    ]),
    playToken: z.string().optional(),
  })
  .strict();

/** Token version selects one mutually exclusive result-authority path. */
export const GameResultAcceptRequestSchema = z.union([
  VerifiedGameResultAcceptRequestSchema,
  LegacyGameResultAcceptRequestSchema,
]);
export type GameResultAcceptRequest = z.infer<typeof GameResultAcceptRequestSchema>;

export const GameResultAcceptResponseSchema = z.object({
  success: z.literal(true),
  result_id: z.number().int().positive(),
  score_id: z.number().int().positive().nullable(),
  game_id: z.string(),
  /** Authoritative leaderboard value: normalizedScore for gs1, competitiveScore for gs2. */
  score: z.number().nullable(),
  rawScore: z.number().nullable(),
  normalizedScore: z.number().nullable(),
  competitiveScore: z.number().nullable(),
  difficultyId: GameSessionCanonicalIdSchema,
  variantId: z.string().min(1).max(100),
  rulesetRevision: z.number().int().positive(),
  verified: z.boolean(),
  adjusted: z.boolean(),
  rewardEligible: z.boolean(),
  xpAwarded: z.number().int().min(0),
  guildXpAwarded: z.number().int().min(0).optional(),
  guildId: z.string().optional(),
  newlyUnlockedAchievements: z.array(z.string()),
});
export type GameResultAcceptResponse = z.infer<typeof GameResultAcceptResponseSchema>;
