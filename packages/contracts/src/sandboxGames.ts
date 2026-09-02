import { z } from "zod";

/** External-developer sandbox game contracts — see docs/GAME_CREATION_GUIDE.md §3 and
 * packages/db/migrations/0024_sandbox_games.sql. Review (per-version) and visibility (per-game)
 * are independent axes: approving a version never makes a game PUBLIC by itself. */

export const SandboxGameVisibilitySchema = z.enum(["PRIVATE", "PUBLIC"]);
export type SandboxGameVisibility = z.infer<typeof SandboxGameVisibilitySchema>;

export const SandboxGameVersionStatusSchema = z.enum([
  "DRAFT",
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
  "WITHDRAWN",
]);
export type SandboxGameVersionStatus = z.infer<typeof SandboxGameVersionStatusSchema>;

export const SandboxGameModeSchema = z.enum(["single", "multi"]);
export type SandboxGameMode = z.infer<typeof SandboxGameModeSchema>;

export const GameContentLocaleSchema = z.enum(["en", "ko", "ja", "zh"]);
export type GameContentLocale = z.infer<typeof GameContentLocaleSchema>;

/** The wire shape of a sandbox game, as it actually travels over HTTP.
 *
 * MUST stay symmetric — i.e. `Schema.parse(JSON.parse(JSON.stringify(Schema.parse(x))))` has to
 * succeed. Both sides use this one schema: the API parses it to build a response, and the web
 * client parses that same response back. An earlier version of this was a `.transform()` that took
 * the core record's internal `logoKey` as *input* and emitted `hasLogo` as *output*, which broke
 * that invariant: the API's own response no longer contained `logoKey`, so every client-side parse
 * failed with "logoKey: Required" and the Game Creator Center / admin review pages showed a
 * blanket contract error (2026-08-18). Internal-only fields are now dropped by an explicit mapper
 * on the server ({@link toSandboxGameRecordResponse}) instead of by schema magic. */
export const SandboxGameRecordSchema = z.object({
  id: z.number().int().positive(),
  slug: z.string(),
  developerUserId: z.number().int().positive(),
  title: z.string(),
  shortDescription: z.string().nullable(),
  description: z.string().nullable(),
  genre: z.string(),
  mode: SandboxGameModeSchema,
  tags: z.array(z.string().min(1).max(40)).max(20),
  defaultScreenMode: z.enum(["default", "theater"]),
  contentEditAvailableAt: z.string().datetime().nullable(),
  /** Whether GET /api/games/sandbox/:slug/logo will actually return an image. The raw B2 storage
   * key it is derived from (`logoKey`) is deliberately never on the wire — mirrors how
   * `objectKey`/`manifestKey` are kept off SandboxGameVersionRecordSchema. */
  hasLogo: z.boolean(),
  xpPerCompletion: z.number().int().nonnegative(),
  scoreUnit: z.string().nullable(),
  scoreDirection: z.enum(["asc", "desc"]).nullable(),
  scoreMin: z.number().nullable(),
  scoreMax: z.number().nullable(),
  scoreDisplayPrefix: z.string().nullable(),
  scoreDisplaySuffix: z.string().nullable(),
  visibility: SandboxGameVisibilitySchema,
  liveVersionId: z.number().int().nullable(),
  /** Beta concurrent-submission quota slot (1 or 2) — non-null while this game is still awaiting
   * its first review decision. A client can derive "N/2 슬롯 사용 중" for its own games by counting
   * entries with a non-null reviewSlot in the response of GET /api/dev/games. */
  reviewSlot: z.union([z.literal(1), z.literal(2)]).nullable(),
  /** Soft delete (migration 0026) — non-null means an ADMIN/OPERATOR removed this game. */
  deletedAt: z.string().nullable(),
  deletedByAdminId: z.number().int().positive().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type SandboxGameRecord = z.infer<typeof SandboxGameRecordSchema>;

/** Core record -> wire record. The one place `logoKey` is turned into `hasLogo` and dropped.
 *
 * Server-side only: every API route returning a game must run its core record through this before
 * `SandboxGameRecordSchema.parse`. Structurally typed rather than importing `@owogg/core`'s
 * `SandboxGameRecord`, since `@owogg/contracts` sits below core and must not depend on it.
 *
 * Forgetting it is loud, not silent: the schema requires `hasLogo`, so a raw core record fails to
 * parse immediately instead of shipping a storage key to a client. */
export function toSandboxGameRecordResponse<T extends { logoKey: string | null }>(
  game: T,
): Omit<T, "logoKey"> & { hasLogo: boolean } {
  const { logoKey, ...rest } = game;
  return { ...rest, hasLogo: logoKey !== null };
}

export const SandboxGamePublishStatusSchema = z.enum(["UPLOADED", "PUBLISHING", "READY", "FAILED"]);
export type SandboxGamePublishStatus = z.infer<typeof SandboxGamePublishStatusSchema>;

/** Note what is absent: `objectKey`/`manifestKey`. Storage keys are internal — a client is told
 * *whether* a version is published, never where its bytes live. */
export const SandboxGameVersionRecordSchema = z.object({
  id: z.number().int().positive(),
  gameId: z.number().int().positive(),
  contentHash: z.string(),
  bundleBytes: z.number().int().nonnegative(),
  status: SandboxGameVersionStatusSchema,
  reviewedByAdminId: z.number().int().nullable(),
  reviewedAt: z.string().nullable(),
  rejectReason: z.string().nullable(),
  uploadedAt: z.string(),
  /** Publish axis — independent of `status`. Only READY versions are servable or promotable. */
  publishStatus: SandboxGamePublishStatusSchema,
  publishError: z.string().nullable(),
  publishedAt: z.string().nullable(),
  publishedSizeBytes: z.number().int().nonnegative().nullable(),
  fileCount: z.number().int().nonnegative().nullable(),
});
export type SandboxGameVersionRecord = z.infer<typeof SandboxGameVersionRecordSchema>;

export const SandboxGameReviewAuditEntrySchema = z.object({
  id: z.number().int(),
  gameId: z.number().int(),
  versionId: z.number().int().nullable(),
  actorAdminId: z.number().int(),
  action: z.string(),
  reason: z.string().nullable(),
  metadata: z.record(z.unknown()).nullable(),
  createdAt: z.string(),
});
export type SandboxGameReviewAuditEntry = z.infer<typeof SandboxGameReviewAuditEntrySchema>;

// ── Developer-facing ──

export const SandboxGameListResponseSchema = z.object({
  games: z.array(SandboxGameRecordSchema),
});
export type SandboxGameListResponse = z.infer<typeof SandboxGameListResponseSchema>;

export const SandboxGameDraftListResponseSchema = z.object({
  drafts: z.array(SandboxGameVersionRecordSchema),
});
export type SandboxGameDraftListResponse = z.infer<typeof SandboxGameDraftListResponseSchema>;

export const SandboxGameDetailResponseSchema = z.object({
  game: SandboxGameRecordSchema,
  versions: z.array(SandboxGameVersionRecordSchema),
  auditLog: z.array(SandboxGameReviewAuditEntrySchema),
});
export type SandboxGameDetailResponse = z.infer<typeof SandboxGameDetailResponseSchema>;

/** POST /api/dev/games/upload response — the combined "drag a ZIP with owogg.json onto the
 * Game Creator Center" flow (see AUTHORIZATION.md/GAME_CREATION_GUIDE.md). Both the created game
 * and its first version, since that one call does what the manual flow does in two. */
export const SandboxGameUploadResponseSchema = z.object({
  game: SandboxGameRecordSchema,
  version: SandboxGameVersionRecordSchema,
});
export type SandboxGameUploadResponse = z.infer<typeof SandboxGameUploadResponseSchema>;

export const SandboxGameReviewSubmitResponseSchema = z.object({
  game: SandboxGameRecordSchema,
  version: SandboxGameVersionRecordSchema,
});
export type SandboxGameReviewSubmitResponse = z.infer<typeof SandboxGameReviewSubmitResponseSchema>;

export const SandboxGamePreviewTokenSchema = z
  .string()
  .regex(/^gp1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

export const SandboxGamePreviewSessionResponseSchema = z.object({
  gameId: z.number().int().positive(),
  versionId: z.number().int().positive(),
  previewToken: SandboxGamePreviewTokenSchema,
  previewPath: z.string().regex(/^\/preview\/gp1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\/index\.html$/),
  expiresAt: z.string().datetime(),
});
export type SandboxGamePreviewSessionResponse = z.infer<
  typeof SandboxGamePreviewSessionResponseSchema
>;

export const SandboxGameReviewSubmitRequestSchema = z.object({
  previewToken: SandboxGamePreviewTokenSchema,
});
export type SandboxGameReviewSubmitRequest = z.infer<typeof SandboxGameReviewSubmitRequestSchema>;

// ── Admin-facing ──

/** One row in the admin review queue — the version plus just enough of its parent game to
 * render without a second round-trip per row. */
export const SandboxGameReviewQueueEntrySchema = z.object({
  version: SandboxGameVersionRecordSchema,
  gameId: z.number().int().positive(),
  gameSlug: z.string(),
  gameTitle: z.string(),
  developerUserId: z.number().int().positive(),
});
export type SandboxGameReviewQueueEntry = z.infer<typeof SandboxGameReviewQueueEntrySchema>;

export const SandboxGameReviewQueueQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type SandboxGameReviewQueueQuery = z.infer<typeof SandboxGameReviewQueueQuerySchema>;

export const SandboxGameReviewQueueResponseSchema = z.object({
  entries: z.array(SandboxGameReviewQueueEntrySchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type SandboxGameReviewQueueResponse = z.infer<typeof SandboxGameReviewQueueResponseSchema>;

export const AdminSandboxGameListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .refine((value): value is 10 | 20 | 30 => value === 10 || value === 20 || value === 30)
    .default(10),
});

export const AdminSandboxGameListEntrySchema = z.object({
  game: SandboxGameRecordSchema,
  latestUploadedAt: z.string().nullable(),
});
export type AdminSandboxGameListEntry = z.infer<typeof AdminSandboxGameListEntrySchema>;

export const AdminSandboxGameListResponseSchema = z.object({
  entries: z.array(AdminSandboxGameListEntrySchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.union([z.literal(10), z.literal(20), z.literal(30)]),
  totalPages: z.number().int().positive(),
});
export type AdminSandboxGameListResponse = z.infer<typeof AdminSandboxGameListResponseSchema>;

export const SandboxGameVersionDecisionRequestSchema = z.object({
  reason: z.string().trim().max(1000).nullable().optional(),
});
export type SandboxGameVersionDecisionRequest = z.infer<
  typeof SandboxGameVersionDecisionRequestSchema
>;

export const SandboxGameMetadataUpdateRequestSchema = z.object({
  title: z.string().trim().min(1).max(60).optional(),
  shortDescription: z.string().trim().max(200).nullable().optional(),
  genre: z.string().trim().min(1).max(40).optional(),
  mode: SandboxGameModeSchema.optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  defaultScreenMode: z.enum(["default", "theater"]).optional(),
  xpPerCompletion: z.number().int().min(0).max(100_000).optional(),
  scoreUnit: z.string().trim().max(20).nullable().optional(),
  scoreDirection: z.enum(["asc", "desc"]).nullable().optional(),
  scoreMin: z.number().nullable().optional(),
  scoreMax: z.number().nullable().optional(),
  scoreDisplayPrefix: z.string().trim().max(20).nullable().optional(),
  scoreDisplaySuffix: z.string().trim().max(20).nullable().optional(),
});
export type SandboxGameMetadataUpdateRequest = z.infer<
  typeof SandboxGameMetadataUpdateRequestSchema
>;

/** Safe, creator-editable `owogg.json.game` subset. Saving this creates a new immutable version;
 * slug is intentionally absent because it is the game's permanent D1 identity. */
export const SandboxGameBasicMetadataUpdateRequestSchema = z
  .object({
    /** Omitted means the required English/default fields. Non-English values are written into
     * owogg.json.game.localizations without changing the English fallback. */
    locale: GameContentLocaleSchema.optional(),
    title: z.string().trim().min(1).max(60).optional(),
    shortDescription: z.string().trim().max(200).nullable().optional(),
    genre: z.string().trim().min(1).max(40).optional(),
    mode: SandboxGameModeSchema.optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    defaultScreenMode: z.enum(["default", "theater"]).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "변경할 속성이 필요합니다." });
export type SandboxGameBasicMetadataUpdateRequest = z.infer<
  typeof SandboxGameBasicMetadataUpdateRequestSchema
>;

/** One inline game-information edit. Metadata, tags, and an optional localized Markdown document
 * are rebuilt into one immutable version so a creator's 24-hour content limit is claimed at most
 * once per save. `title` is required for the selected locale; English remains the mandatory
 * default and translated titles live in `game.localizations`. */
export const GameContentUpdateRequestSchema = z.object({
  locale: GameContentLocaleSchema,
  title: z.string().trim().min(1).max(60),
  shortDescription: z.string().trim().max(200).nullable(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20),
  descriptionMarkdown: z
    .string()
    .min(1)
    .max(64 * 1024)
    .optional(),
});
export type GameContentUpdateRequest = z.infer<typeof GameContentUpdateRequestSchema>;

export const GameLogoUpdateResponseSchema = z.object({
  gameId: z.number().int().positive(),
  slug: z.string(),
  hasLogo: z.literal(true),
  updatedAt: z.string(),
});
export type GameLogoUpdateResponse = z.infer<typeof GameLogoUpdateResponseSchema>;

export const SandboxGameVisibilityUpdateRequestSchema = z.object({
  visibility: SandboxGameVisibilitySchema,
});
export type SandboxGameVisibilityUpdateRequest = z.infer<
  typeof SandboxGameVisibilityUpdateRequestSchema
>;

/** Rollback / roll-forward: point the game at a different approved+published version. */
export const SandboxGameLiveVersionUpdateRequestSchema = z.object({
  versionId: z.number().int().positive(),
});
export type SandboxGameLiveVersionUpdateRequest = z.infer<
  typeof SandboxGameLiveVersionUpdateRequestSchema
>;
