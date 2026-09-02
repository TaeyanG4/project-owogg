import type {
  ExternalGameImageType,
  ExternalGameMediaKind,
  ExternalGameModerationStatus,
  ExternalGameOwnershipType,
  ExternalGameVisibility,
} from "../domain/externalGames.js";

export interface ExternalGameMediaRecord {
  id: number;
  externalGameId: number;
  kind: ExternalGameMediaKind;
  objectKey: string;
  contentType: ExternalGameImageType;
  byteSize: number;
  contentHash: string;
  altText: string;
  sortOrder: number;
  createdAt: string;
}

export interface ExternalGameRecord {
  id: number;
  slug: string;
  introducerUserId: number;
  introducerName: string;
  title: string;
  shortDescription: string;
  descriptionMarkdown: string;
  platformName: string;
  externalUrl: string;
  releaseDate: string | null;
  tags: readonly string[];
  ownershipType: ExternalGameOwnershipType;
  rightsNote: string;
  rightsAttestedAt: string | null;
  moderationStatus: ExternalGameModerationStatus;
  visibility: ExternalGameVisibility;
  reviewSlot: 1 | 2 | 3 | null;
  rejectReason: string | null;
  reviewedByAdminId: number | null;
  reviewedAt: string | null;
  publishedAt: string | null;
  deletedAt: string | null;
  deletedByAdminId: number | null;
  bookmarkCount: number;
  isBookmarked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ExternalGameContentInput {
  title: string;
  shortDescription: string;
  descriptionMarkdown: string;
  platformName: string;
  externalUrl: string;
  releaseDate: string | null;
  tags: readonly string[];
  ownershipType: ExternalGameOwnershipType;
  rightsNote: string;
}

export interface ExternalGamePage {
  games: ExternalGameRecord[];
  total: number;
}

export interface ExternalGameRepository {
  findById(id: number, viewerUserId?: number | null): Promise<ExternalGameRecord | null>;
  findBySlug(slug: string, viewerUserId?: number | null): Promise<ExternalGameRecord | null>;
  slugExists(slug: string): Promise<boolean>;
  listByIntroducer(userId: number): Promise<ExternalGameRecord[]>;
  listPublicPage(input: {
    limit: number;
    offset: number;
    sort: "newest" | "bookmarks";
    search: string;
    viewerUserId: number | null;
  }): Promise<ExternalGamePage>;
  listAdminPage(input: {
    limit: number;
    offset: number;
    status?: ExternalGameModerationStatus | undefined;
  }): Promise<ExternalGamePage>;
  create(input: {
    slug: string;
    introducerUserId: number;
    content: ExternalGameContentInput;
    nowIso: string;
  }): Promise<ExternalGameRecord>;
  updateContent(input: {
    id: number;
    content: ExternalGameContentInput;
    nowIso: string;
  }): Promise<ExternalGameRecord | null>;
  prepareForEdit(id: number, nowIso: string): Promise<ExternalGameRecord | null>;
  submitForReview(input: {
    id: number;
    introducerUserId: number;
    nowIso: string;
  }): Promise<ExternalGameRecord | null>;
  withdrawReview(
    id: number,
    introducerUserId: number,
    nowIso: string,
  ): Promise<ExternalGameRecord | null>;
  decideReview(input: {
    id: number;
    decision: "APPROVED" | "REJECTED";
    adminId: number;
    reason: string | null;
    nowIso: string;
  }): Promise<ExternalGameRecord | null>;
  setVisibility(input: {
    id: number;
    visibility: ExternalGameVisibility;
    adminId: number;
    nowIso: string;
  }): Promise<ExternalGameRecord | null>;
  softDelete(input: {
    id: number;
    adminId: number;
    reason: string | null;
    nowIso: string;
  }): Promise<ExternalGameRecord | null>;
  hardDelete(id: number): Promise<void>;

  listMedia(gameId: number): Promise<ExternalGameMediaRecord[]>;
  listMediaByGameIds(gameIds: readonly number[]): Promise<Map<number, ExternalGameMediaRecord[]>>;
  findMedia(gameId: number, mediaId: number): Promise<ExternalGameMediaRecord | null>;
  countMedia(gameId: number, kind: ExternalGameMediaKind): Promise<number>;
  addMedia(input: {
    externalGameId: number;
    kind: ExternalGameMediaKind;
    objectKey: string;
    contentType: ExternalGameImageType;
    byteSize: number;
    contentHash: string;
    altText: string;
    sortOrder: number;
    nowIso: string;
  }): Promise<ExternalGameMediaRecord>;
  deleteMedia(gameId: number, mediaId: number): Promise<ExternalGameMediaRecord | null>;

  addBookmark(userId: number, gameId: number, nowIso: string): Promise<number>;
  removeBookmark(userId: number, gameId: number): Promise<number>;
}
