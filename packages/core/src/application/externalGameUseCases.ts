import { sha256Hex } from "../domain/contentHash.js";
import {
  EXTERNAL_GAME_POLICY,
  detectExternalGameImageType,
  externalGameMediaObjectKey,
  isSafeExternalGameUrl,
  isValidExternalGameSlug,
  type ExternalGameMediaKind,
  type ExternalGameVisibility,
} from "../domain/externalGames.js";
import type {
  ExternalGameContentInput,
  ExternalGamePage,
  ExternalGameRecord,
  ExternalGameRepository,
  ExternalGameMediaRecord,
} from "../ports/externalGames.js";
import type { GameBundleStorageRepository } from "../ports/sandboxGames.js";

export const EXTERNAL_GAME_FAILURE_CODES = [
  "NOT_FOUND",
  "FORBIDDEN",
  "SLUG_TAKEN",
  "INVALID_CONTENT",
  "INVALID_STATE",
  "REVIEW_SLOT_LIMIT",
  "SCREENSHOT_REQUIRED",
  "RIGHTS_CONFIRMATION_REQUIRED",
  "MEDIA_LIMIT",
  "MEDIA_INVALID",
  "MEDIA_TOO_LARGE",
  "STORAGE_ERROR",
  "CANNOT_DELETE_PUBLISHED",
  "REJECT_REASON_REQUIRED",
] as const;
export type ExternalGameFailureCode = (typeof EXTERNAL_GAME_FAILURE_CODES)[number];

export class ExternalGameUseCaseFailure extends Error {
  constructor(readonly code: ExternalGameFailureCode) {
    super(code);
    this.name = "ExternalGameUseCaseFailure";
  }
}

function validateContent(content: ExternalGameContentInput): void {
  const releaseDateValid =
    content.releaseDate === null ||
    (/^\d{4}-\d{2}-\d{2}$/.test(content.releaseDate) &&
      !Number.isNaN(Date.parse(`${content.releaseDate}T00:00:00.000Z`)) &&
      new Date(`${content.releaseDate}T00:00:00.000Z`)
        .toISOString()
        .startsWith(content.releaseDate));
  if (
    content.title.trim().length < 2 ||
    content.title.trim().length > 120 ||
    content.shortDescription.trim().length < 1 ||
    content.shortDescription.trim().length > 240 ||
    content.descriptionMarkdown.trim().length < 1 ||
    content.descriptionMarkdown.trim().length > 20_000 ||
    content.platformName.trim().length < 1 ||
    content.platformName.trim().length > 60 ||
    content.rightsNote.trim().length > 1000 ||
    content.tags.length > 8 ||
    content.tags.some((tag) => tag.trim().length < 1 || tag.trim().length > 24) ||
    !releaseDateValid ||
    !isSafeExternalGameUrl(content.externalUrl)
  ) {
    throw new ExternalGameUseCaseFailure("INVALID_CONTENT");
  }
}

function assertOwnedEditable(game: ExternalGameRecord | null, userId: number): ExternalGameRecord {
  if (!game || game.deletedAt !== null) throw new ExternalGameUseCaseFailure("NOT_FOUND");
  if (game.introducerUserId !== userId) throw new ExternalGameUseCaseFailure("FORBIDDEN");
  if (game.moderationStatus === "PENDING_REVIEW") {
    throw new ExternalGameUseCaseFailure("INVALID_STATE");
  }
  return game;
}

export class ExternalGameUseCases {
  constructor(
    private readonly games: ExternalGameRepository,
    private readonly storage: GameBundleStorageRepository,
  ) {}

  async create(input: {
    slug: string;
    introducerUserId: number;
    content: ExternalGameContentInput;
    now?: Date;
  }): Promise<ExternalGameRecord> {
    const slug = input.slug.trim();
    validateContent(input.content);
    if (!isValidExternalGameSlug(slug)) throw new ExternalGameUseCaseFailure("INVALID_CONTENT");
    if (await this.games.slugExists(slug)) throw new ExternalGameUseCaseFailure("SLUG_TAKEN");
    try {
      return await this.games.create({
        slug,
        introducerUserId: input.introducerUserId,
        content: input.content,
        nowIso: (input.now ?? new Date()).toISOString(),
      });
    } catch (error) {
      if (String(error).includes("UNIQUE constraint failed: external_games.slug")) {
        throw new ExternalGameUseCaseFailure("SLUG_TAKEN");
      }
      throw error;
    }
  }

  async updateOwn(input: {
    id: number;
    userId: number;
    content: ExternalGameContentInput;
    now?: Date;
  }): Promise<ExternalGameRecord> {
    validateContent(input.content);
    assertOwnedEditable(await this.games.findById(input.id, input.userId), input.userId);
    const updated = await this.games.updateContent({
      id: input.id,
      content: input.content,
      nowIso: (input.now ?? new Date()).toISOString(),
    });
    if (!updated) throw new ExternalGameUseCaseFailure("INVALID_STATE");
    return updated;
  }

  async submitOwn(input: {
    id: number;
    userId: number;
    rightsConfirmed: boolean;
    now?: Date;
  }): Promise<ExternalGameRecord> {
    const game = assertOwnedEditable(
      await this.games.findById(input.id, input.userId),
      input.userId,
    );
    if (!input.rightsConfirmed) {
      throw new ExternalGameUseCaseFailure("RIGHTS_CONFIRMATION_REQUIRED");
    }
    if ((await this.games.countMedia(game.id, "SCREENSHOT")) < 1) {
      throw new ExternalGameUseCaseFailure("SCREENSHOT_REQUIRED");
    }
    const submitted = await this.games.submitForReview({
      id: game.id,
      introducerUserId: input.userId,
      nowIso: (input.now ?? new Date()).toISOString(),
    });
    if (!submitted) throw new ExternalGameUseCaseFailure("REVIEW_SLOT_LIMIT");
    return submitted;
  }

  async withdrawOwn(id: number, userId: number, now = new Date()): Promise<ExternalGameRecord> {
    const game = await this.games.findById(id, userId);
    if (!game || game.deletedAt !== null) throw new ExternalGameUseCaseFailure("NOT_FOUND");
    if (game.introducerUserId !== userId) throw new ExternalGameUseCaseFailure("FORBIDDEN");
    if (game.moderationStatus !== "PENDING_REVIEW") {
      throw new ExternalGameUseCaseFailure("INVALID_STATE");
    }
    const withdrawn = await this.games.withdrawReview(id, userId, now.toISOString());
    if (!withdrawn) throw new ExternalGameUseCaseFailure("INVALID_STATE");
    return withdrawn;
  }

  async deleteOwn(id: number, userId: number): Promise<void> {
    const game = assertOwnedEditable(await this.games.findById(id, userId), userId);
    if (game.publishedAt !== null) {
      throw new ExternalGameUseCaseFailure("CANNOT_DELETE_PUBLISHED");
    }
    const media = await this.games.listMedia(game.id);
    await this.games.hardDelete(game.id);
    await Promise.all(
      media.map((item) => this.storage.deleteObject(item.objectKey).catch(() => {})),
    );
  }

  async uploadMedia(input: {
    id: number;
    userId: number;
    kind: ExternalGameMediaKind;
    bytes: ArrayBuffer;
    altText: string;
    now?: Date;
  }): Promise<ExternalGameMediaRecord> {
    assertOwnedEditable(await this.games.findById(input.id, input.userId), input.userId);
    if (input.bytes.byteLength < 1) throw new ExternalGameUseCaseFailure("MEDIA_INVALID");
    if (input.bytes.byteLength > EXTERNAL_GAME_POLICY.MAX_MEDIA_BYTES) {
      throw new ExternalGameUseCaseFailure("MEDIA_TOO_LARGE");
    }
    const contentType = detectExternalGameImageType(input.bytes);
    if (!contentType) throw new ExternalGameUseCaseFailure("MEDIA_INVALID");
    const existingMedia = await this.games.listMedia(input.id);
    const currentCount = existingMedia.filter((item) => item.kind === input.kind).length;
    const limit = input.kind === "BANNER" ? 1 : EXTERNAL_GAME_POLICY.MAX_SCREENSHOTS;
    if (currentCount >= limit) throw new ExternalGameUseCaseFailure("MEDIA_LIMIT");
    const contentHash = await sha256Hex(input.bytes);
    if (existingMedia.some((item) => item.contentHash === contentHash)) {
      throw new ExternalGameUseCaseFailure("MEDIA_INVALID");
    }
    const objectKey = externalGameMediaObjectKey(input.id, contentHash, contentType);
    try {
      await this.storage.putObject({ key: objectKey, bytes: input.bytes, contentType });
      const editable = await this.games.prepareForEdit(
        input.id,
        (input.now ?? new Date()).toISOString(),
      );
      if (!editable) throw new ExternalGameUseCaseFailure("INVALID_STATE");
      return await this.games.addMedia({
        externalGameId: input.id,
        kind: input.kind,
        objectKey,
        contentType,
        byteSize: input.bytes.byteLength,
        contentHash,
        altText: input.altText.trim().slice(0, 160),
        sortOrder: currentCount,
        nowIso: (input.now ?? new Date()).toISOString(),
      });
    } catch (error) {
      const objectIsReferenced = await this.games
        .listMedia(input.id)
        .then((items) => items.some((item) => item.objectKey === objectKey))
        .catch(() => false);
      if (!objectIsReferenced) {
        await this.storage.deleteObject(objectKey).catch(() => {});
      }
      if (error instanceof ExternalGameUseCaseFailure) throw error;
      if (
        String(error).includes("external game screenshot limit") ||
        String(error).includes("idx_external_game_single_banner") ||
        String(error).includes("UNIQUE constraint failed: external_game_media.external_game_id")
      ) {
        throw new ExternalGameUseCaseFailure("MEDIA_LIMIT");
      }
      if (String(error).includes("UNIQUE constraint failed: external_game_media.object_key")) {
        throw new ExternalGameUseCaseFailure("MEDIA_INVALID");
      }
      throw new ExternalGameUseCaseFailure("STORAGE_ERROR");
    }
  }

  async removeMedia(input: {
    id: number;
    mediaId: number;
    userId: number;
    now?: Date;
  }): Promise<void> {
    assertOwnedEditable(await this.games.findById(input.id, input.userId), input.userId);
    const existing = await this.games.findMedia(input.id, input.mediaId);
    if (!existing) throw new ExternalGameUseCaseFailure("NOT_FOUND");
    const editable = await this.games.prepareForEdit(
      input.id,
      (input.now ?? new Date()).toISOString(),
    );
    if (!editable) throw new ExternalGameUseCaseFailure("INVALID_STATE");
    const media = await this.games.deleteMedia(input.id, input.mediaId);
    if (!media) throw new ExternalGameUseCaseFailure("NOT_FOUND");
    await this.storage.deleteObject(media.objectKey).catch(() => {});
  }

  async listMine(userId: number): Promise<ExternalGameRecord[]> {
    return this.games.listByIntroducer(userId);
  }

  async listPublic(input: {
    page: number;
    pageSize: number;
    sort: "newest" | "bookmarks";
    search: string;
    viewerUserId: number | null;
  }): Promise<ExternalGamePage> {
    return this.games.listPublicPage({
      limit: input.pageSize,
      offset: (input.page - 1) * input.pageSize,
      sort: input.sort,
      search: input.search,
      viewerUserId: input.viewerUserId,
    });
  }

  async getPublicBySlug(slug: string, viewerUserId: number | null): Promise<ExternalGameRecord> {
    const game = await this.games.findBySlug(slug, viewerUserId);
    if (
      !game ||
      game.deletedAt !== null ||
      game.moderationStatus !== "APPROVED" ||
      game.visibility !== "PUBLIC"
    ) {
      throw new ExternalGameUseCaseFailure("NOT_FOUND");
    }
    return game;
  }

  async bookmark(input: { id: number; userId: number; bookmarked: boolean; now?: Date }) {
    const game = await this.games.findById(input.id, input.userId);
    if (
      !game ||
      game.deletedAt !== null ||
      game.moderationStatus !== "APPROVED" ||
      game.visibility !== "PUBLIC"
    ) {
      throw new ExternalGameUseCaseFailure("NOT_FOUND");
    }
    const bookmarkCount = input.bookmarked
      ? await this.games.addBookmark(
          input.userId,
          input.id,
          (input.now ?? new Date()).toISOString(),
        )
      : await this.games.removeBookmark(input.userId, input.id);
    return { bookmarked: input.bookmarked, bookmarkCount };
  }

  listAdmin(input: {
    page: number;
    pageSize: number;
    status?: ExternalGameRecord["moderationStatus"] | undefined;
  }): Promise<ExternalGamePage> {
    return this.games.listAdminPage({
      limit: input.pageSize,
      offset: (input.page - 1) * input.pageSize,
      status: input.status,
    });
  }

  async decide(input: {
    id: number;
    decision: "APPROVED" | "REJECTED";
    adminId: number;
    reason: string | null;
    now?: Date;
  }): Promise<ExternalGameRecord> {
    const game = await this.games.findById(input.id);
    if (!game || game.deletedAt !== null) throw new ExternalGameUseCaseFailure("NOT_FOUND");
    if (game.moderationStatus !== "PENDING_REVIEW") {
      throw new ExternalGameUseCaseFailure("INVALID_STATE");
    }
    if (input.decision === "REJECTED" && !input.reason?.trim()) {
      throw new ExternalGameUseCaseFailure("REJECT_REASON_REQUIRED");
    }
    const decided = await this.games.decideReview({
      ...input,
      reason: input.reason?.trim() || null,
      nowIso: (input.now ?? new Date()).toISOString(),
    });
    if (!decided) throw new ExternalGameUseCaseFailure("INVALID_STATE");
    return decided;
  }

  async setVisibility(input: {
    id: number;
    visibility: ExternalGameVisibility;
    adminId: number;
    now?: Date;
  }): Promise<ExternalGameRecord> {
    const game = await this.games.findById(input.id);
    if (!game || game.deletedAt !== null) throw new ExternalGameUseCaseFailure("NOT_FOUND");
    if (game.moderationStatus !== "APPROVED") {
      throw new ExternalGameUseCaseFailure("INVALID_STATE");
    }
    const updated = await this.games.setVisibility({
      ...input,
      nowIso: (input.now ?? new Date()).toISOString(),
    });
    if (!updated) throw new ExternalGameUseCaseFailure("INVALID_STATE");
    return updated;
  }

  async deleteAsAdmin(input: {
    id: number;
    adminId: number;
    reason: string | null;
    now?: Date;
  }): Promise<ExternalGameRecord> {
    const game = await this.games.findById(input.id);
    if (!game || game.deletedAt !== null) throw new ExternalGameUseCaseFailure("NOT_FOUND");
    const deleted = await this.games.softDelete({
      ...input,
      reason: input.reason?.trim() || null,
      nowIso: (input.now ?? new Date()).toISOString(),
    });
    if (!deleted) throw new ExternalGameUseCaseFailure("NOT_FOUND");
    return deleted;
  }
}
