import type {
  ExternalGameContentInput,
  ExternalGameMediaKind,
  ExternalGameMediaRecord,
  ExternalGameModerationStatus,
  ExternalGamePage,
  ExternalGameRecord,
  ExternalGameRepository,
  ExternalGameVisibility,
} from "@owogg/core";
import type { D1Database } from "./D1UserRepository.js";

const RECORD_SELECT = `
  SELECT external_game.*,
         introducer.nickname AS introducer_name,
         (SELECT COUNT(*) FROM external_game_bookmarks bookmark
           WHERE bookmark.external_game_id = external_game.id) AS bookmark_count,
         CASE WHEN ? IS NULL THEN 0 ELSE EXISTS(
           SELECT 1 FROM external_game_bookmarks viewer_bookmark
            WHERE viewer_bookmark.external_game_id = external_game.id
              AND viewer_bookmark.user_id = ?
         ) END AS is_bookmarked
    FROM external_games external_game
    JOIN users introducer ON introducer.id = external_game.introducer_user_id`;

function parseTags(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function mapRecord(row: Record<string, unknown>): ExternalGameRecord {
  const slot = row.review_slot === null ? null : Number(row.review_slot);
  return {
    id: Number(row.id),
    slug: String(row.slug),
    introducerUserId: Number(row.introducer_user_id),
    introducerName: String(row.introducer_name),
    title: String(row.title),
    shortDescription: String(row.short_description),
    descriptionMarkdown: String(row.description_markdown),
    platformName: String(row.platform_name),
    externalUrl: String(row.external_url),
    releaseDate: row.release_date === null ? null : String(row.release_date),
    tags: parseTags(row.tags_json),
    ownershipType: String(row.ownership_type) as ExternalGameRecord["ownershipType"],
    rightsNote: String(row.rights_note ?? ""),
    rightsAttestedAt: row.rights_attested_at === null ? null : String(row.rights_attested_at),
    moderationStatus: String(row.moderation_status) as ExternalGameModerationStatus,
    visibility: String(row.visibility) as ExternalGameVisibility,
    reviewSlot: slot === 1 || slot === 2 || slot === 3 ? slot : null,
    rejectReason: row.reject_reason === null ? null : String(row.reject_reason),
    reviewedByAdminId: row.reviewed_by_admin_id === null ? null : Number(row.reviewed_by_admin_id),
    reviewedAt: row.reviewed_at === null ? null : String(row.reviewed_at),
    publishedAt: row.published_at === null ? null : String(row.published_at),
    deletedAt: row.deleted_at === null ? null : String(row.deleted_at),
    deletedByAdminId: row.deleted_by_admin_id === null ? null : Number(row.deleted_by_admin_id),
    bookmarkCount: Number(row.bookmark_count ?? 0),
    isBookmarked: Boolean(row.is_bookmarked),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapMedia(row: Record<string, unknown>): ExternalGameMediaRecord {
  return {
    id: Number(row.id),
    externalGameId: Number(row.external_game_id),
    kind: String(row.media_kind) as ExternalGameMediaKind,
    objectKey: String(row.object_key),
    contentType: String(row.content_type) as ExternalGameMediaRecord["contentType"],
    byteSize: Number(row.byte_size),
    contentHash: String(row.content_hash),
    altText: String(row.alt_text ?? ""),
    sortOrder: Number(row.sort_order),
    createdAt: String(row.created_at),
  };
}

export class D1ExternalGameRepository implements ExternalGameRepository {
  constructor(private readonly db: D1Database) {}

  async findById(
    id: number,
    viewerUserId: number | null = null,
  ): Promise<ExternalGameRecord | null> {
    const row = await this.db
      .prepare(`${RECORD_SELECT} WHERE external_game.id = ?`)
      .bind(viewerUserId, viewerUserId, id)
      .first<Record<string, unknown>>();
    return row ? mapRecord(row) : null;
  }

  async findBySlug(
    slug: string,
    viewerUserId: number | null = null,
  ): Promise<ExternalGameRecord | null> {
    const row = await this.db
      .prepare(`${RECORD_SELECT} WHERE external_game.slug = ?`)
      .bind(viewerUserId, viewerUserId, slug)
      .first<Record<string, unknown>>();
    return row ? mapRecord(row) : null;
  }

  async slugExists(slug: string): Promise<boolean> {
    return Boolean(
      await this.db.prepare(`SELECT 1 FROM external_games WHERE slug = ?`).bind(slug).first(),
    );
  }

  async listByIntroducer(userId: number): Promise<ExternalGameRecord[]> {
    const result = await this.db
      .prepare(
        `${RECORD_SELECT}
         WHERE external_game.introducer_user_id = ?
         ORDER BY external_game.updated_at DESC, external_game.id DESC`,
      )
      .bind(userId, userId, userId)
      .all<Record<string, unknown>>();
    return (result.results ?? []).map(mapRecord);
  }

  async listPublicPage(input: {
    limit: number;
    offset: number;
    sort: "newest" | "bookmarks";
    search: string;
    viewerUserId: number | null;
  }): Promise<ExternalGamePage> {
    const pattern = `%${input.search.replace(/[\\%_]/g, "\\$&")}%`;
    const filter = `external_game.deleted_at IS NULL
      AND external_game.moderation_status = 'APPROVED'
      AND external_game.visibility = 'PUBLIC'
      AND (? = '' OR external_game.title LIKE ? ESCAPE '\\'
        OR external_game.platform_name LIKE ? ESCAPE '\\'
        OR external_game.tags_json LIKE ? ESCAPE '\\')`;
    const order =
      input.sort === "bookmarks"
        ? "bookmark_count DESC, external_game.published_at DESC, external_game.id DESC"
        : "external_game.published_at DESC, external_game.id DESC";
    const rows = await this.db
      .prepare(`${RECORD_SELECT} WHERE ${filter} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .bind(
        input.viewerUserId,
        input.viewerUserId,
        input.search,
        pattern,
        pattern,
        pattern,
        input.limit,
        input.offset,
      )
      .all<Record<string, unknown>>();
    const count = await this.db
      .prepare(`SELECT COUNT(*) AS total FROM external_games external_game WHERE ${filter}`)
      .bind(input.search, pattern, pattern, pattern)
      .first<{ total: number }>();
    return { games: (rows.results ?? []).map(mapRecord), total: Number(count?.total ?? 0) };
  }

  async listAdminPage(input: {
    limit: number;
    offset: number;
    status?: ExternalGameModerationStatus | undefined;
  }): Promise<ExternalGamePage> {
    const filter = input.status ? "external_game.moderation_status = ?" : "1 = 1";
    const values = input.status ? [input.status] : [];
    const rows = await this.db
      .prepare(
        `${RECORD_SELECT} WHERE ${filter}
         ORDER BY CASE WHEN external_game.moderation_status = 'PENDING_REVIEW' THEN 0 ELSE 1 END,
                  external_game.updated_at DESC, external_game.id DESC
         LIMIT ? OFFSET ?`,
      )
      .bind(null, null, ...values, input.limit, input.offset)
      .all<Record<string, unknown>>();
    const count = await this.db
      .prepare(`SELECT COUNT(*) AS total FROM external_games external_game WHERE ${filter}`)
      .bind(...values)
      .first<{ total: number }>();
    return { games: (rows.results ?? []).map(mapRecord), total: Number(count?.total ?? 0) };
  }

  async create(input: {
    slug: string;
    introducerUserId: number;
    content: ExternalGameContentInput;
    nowIso: string;
  }): Promise<ExternalGameRecord> {
    const result = await this.db
      .prepare(
        `INSERT INTO external_games
          (slug, introducer_user_id, title, short_description, description_markdown,
           platform_name, external_url, release_date, tags_json, ownership_type, rights_note,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id`,
      )
      .bind(
        input.slug,
        input.introducerUserId,
        input.content.title.trim(),
        input.content.shortDescription.trim(),
        input.content.descriptionMarkdown.trim(),
        input.content.platformName.trim(),
        input.content.externalUrl.trim(),
        input.content.releaseDate,
        JSON.stringify(input.content.tags.map((tag) => tag.trim())),
        input.content.ownershipType,
        input.content.rightsNote.trim(),
        input.nowIso,
        input.nowIso,
      )
      .first<{ id: number }>();
    if (!result) throw new Error("external game insert returned no row");
    const created = await this.findById(Number(result.id), input.introducerUserId);
    if (!created) throw new Error("external game disappeared after insert");
    return created;
  }

  async prepareForEdit(id: number, nowIso: string): Promise<ExternalGameRecord | null> {
    const result = await this.db
      .prepare(
        `UPDATE external_games
            SET moderation_status = 'DRAFT', visibility = 'PRIVATE', review_slot = NULL,
                rights_attested_at = NULL, reject_reason = NULL,
                reviewed_by_admin_id = NULL, reviewed_at = NULL, updated_at = ?
          WHERE id = ? AND moderation_status <> 'PENDING_REVIEW'`,
      )
      .bind(nowIso, id)
      .run();
    if (Number(result.meta?.changes ?? 0) !== 1) return null;
    const game = await this.findById(id);
    if (!game) throw new Error("external game not found after edit preparation");
    return game;
  }

  async updateContent(input: {
    id: number;
    content: ExternalGameContentInput;
    nowIso: string;
  }): Promise<ExternalGameRecord | null> {
    const result = await this.db
      .prepare(
        `UPDATE external_games
            SET title = ?, short_description = ?, description_markdown = ?, platform_name = ?,
                external_url = ?, release_date = ?, tags_json = ?, ownership_type = ?,
                rights_note = ?, moderation_status = 'DRAFT', visibility = 'PRIVATE',
                review_slot = NULL, rights_attested_at = NULL, reject_reason = NULL,
                reviewed_by_admin_id = NULL, reviewed_at = NULL, updated_at = ?
          WHERE id = ? AND moderation_status <> 'PENDING_REVIEW'`,
      )
      .bind(
        input.content.title.trim(),
        input.content.shortDescription.trim(),
        input.content.descriptionMarkdown.trim(),
        input.content.platformName.trim(),
        input.content.externalUrl.trim(),
        input.content.releaseDate,
        JSON.stringify(input.content.tags.map((tag) => tag.trim())),
        input.content.ownershipType,
        input.content.rightsNote.trim(),
        input.nowIso,
        input.id,
      )
      .run();
    if (Number(result.meta?.changes ?? 0) !== 1) return null;
    const updated = await this.findById(input.id);
    if (!updated) throw new Error("external game not found after update");
    return updated;
  }

  async submitForReview(input: {
    id: number;
    introducerUserId: number;
    nowIso: string;
  }): Promise<ExternalGameRecord | null> {
    try {
      const result = await this.db
        .prepare(
          `UPDATE external_games
              SET moderation_status = 'PENDING_REVIEW',
                  review_slot = (
                    SELECT candidate.slot
                      FROM (SELECT 1 AS slot UNION ALL SELECT 2 UNION ALL SELECT 3) candidate
                     WHERE NOT EXISTS (
                       SELECT 1 FROM external_games occupied
                        WHERE occupied.introducer_user_id = ?
                          AND occupied.review_slot = candidate.slot
                     )
                     ORDER BY candidate.slot
                     LIMIT 1
                  ),
                  rights_attested_at = ?,
                  reject_reason = NULL, reviewed_by_admin_id = NULL, reviewed_at = NULL,
                  updated_at = ?
            WHERE id = ? AND introducer_user_id = ? AND deleted_at IS NULL
              AND moderation_status IN ('DRAFT', 'REJECTED') AND review_slot IS NULL
              AND (
                SELECT COUNT(*) FROM external_games occupied
                 WHERE occupied.introducer_user_id = ? AND occupied.review_slot IS NOT NULL
              ) < 3
            RETURNING id`,
        )
        .bind(
          input.introducerUserId,
          input.nowIso,
          input.nowIso,
          input.id,
          input.introducerUserId,
          input.introducerUserId,
        )
        .first<{ id: number }>();
      if (!result) return null;
      return this.findById(input.id, input.introducerUserId);
    } catch (error) {
      if (String(error).includes("UNIQUE constraint failed")) return null;
      throw error;
    }
  }

  async withdrawReview(
    id: number,
    introducerUserId: number,
    nowIso: string,
  ): Promise<ExternalGameRecord | null> {
    const result = await this.db
      .prepare(
        `UPDATE external_games
            SET moderation_status = 'DRAFT', review_slot = NULL, rights_attested_at = NULL,
                updated_at = ?
          WHERE id = ? AND introducer_user_id = ? AND moderation_status = 'PENDING_REVIEW'`,
      )
      .bind(nowIso, id, introducerUserId)
      .run();
    if (Number(result.meta?.changes ?? 0) !== 1) return null;
    const game = await this.findById(id, introducerUserId);
    if (!game) throw new Error("external game not found after withdrawal");
    return game;
  }

  async decideReview(input: {
    id: number;
    decision: "APPROVED" | "REJECTED";
    adminId: number;
    reason: string | null;
    nowIso: string;
  }): Promise<ExternalGameRecord | null> {
    const statements = [
      this.db
        .prepare(
          `UPDATE external_games
              SET moderation_status = ?, visibility = ?, review_slot = NULL,
                  reject_reason = ?, reviewed_by_admin_id = ?, reviewed_at = ?,
                  published_at = CASE WHEN ? = 'APPROVED' THEN COALESCE(published_at, ?) ELSE published_at END,
                  updated_at = ?
            WHERE id = ? AND moderation_status = 'PENDING_REVIEW'`,
        )
        .bind(
          input.decision,
          input.decision === "APPROVED" ? "PUBLIC" : "PRIVATE",
          input.decision === "REJECTED" ? input.reason : null,
          input.adminId,
          input.nowIso,
          input.decision,
          input.nowIso,
          input.nowIso,
          input.id,
        ),
      this.db
        .prepare(
          `INSERT INTO external_game_review_audit
             (external_game_id, actor_admin_id, action, reason, metadata_json, created_at)
           SELECT id, ?, ?, ?, NULL, ? FROM external_games
            WHERE id = ? AND moderation_status = ? AND reviewed_by_admin_id = ?
              AND reviewed_at = ? AND updated_at = ?`,
        )
        .bind(
          input.adminId,
          input.decision,
          input.reason,
          input.nowIso,
          input.id,
          input.decision,
          input.adminId,
          input.nowIso,
          input.nowIso,
        ),
    ];
    if (input.decision === "APPROVED") {
      statements.push(
        this.db
          .prepare(
            `INSERT OR IGNORE INTO profile_contribution_events
               (user_id, contribution_type, source_key, metadata_json, created_at)
             SELECT introducer_user_id, 'EXTERNAL_GAME_PUBLISHED', ?, ?, ?
               FROM external_games
              WHERE id = ? AND moderation_status = 'APPROVED'
                AND reviewed_by_admin_id = ? AND reviewed_at = ? AND updated_at = ?`,
          )
          .bind(
            `external-game:${input.id}`,
            JSON.stringify({ externalGameId: input.id }),
            input.nowIso,
            input.id,
            input.adminId,
            input.nowIso,
            input.nowIso,
          ),
      );
    }
    const results = await this.db.batch(statements);
    if (Number(results[0]?.meta?.changes ?? 0) !== 1) return null;
    const game = await this.findById(input.id);
    if (!game) throw new Error("external game not found after review decision");
    return game;
  }

  async setVisibility(input: {
    id: number;
    visibility: ExternalGameVisibility;
    adminId: number;
    nowIso: string;
  }): Promise<ExternalGameRecord | null> {
    const results = await this.db.batch([
      this.db
        .prepare(
          `UPDATE external_games SET visibility = ?, updated_at = ?
            WHERE id = ? AND moderation_status = 'APPROVED' AND deleted_at IS NULL
              AND visibility <> ?`,
        )
        .bind(input.visibility, input.nowIso, input.id, input.visibility),
      this.db
        .prepare(
          `INSERT INTO external_game_review_audit
             (external_game_id, actor_admin_id, action, reason, metadata_json, created_at)
           SELECT id, ?, 'VISIBILITY_CHANGED', NULL, ?, ? FROM external_games
            WHERE id = ? AND moderation_status = 'APPROVED' AND deleted_at IS NULL
              AND visibility = ? AND updated_at = ?`,
        )
        .bind(
          input.adminId,
          JSON.stringify({ visibility: input.visibility }),
          input.nowIso,
          input.id,
          input.visibility,
          input.nowIso,
        ),
    ]);
    if (Number(results[0]?.meta?.changes ?? 0) !== 1) return null;
    const game = await this.findById(input.id);
    if (!game) throw new Error("external game not found after visibility update");
    return game;
  }

  async softDelete(input: {
    id: number;
    adminId: number;
    reason: string | null;
    nowIso: string;
  }): Promise<ExternalGameRecord | null> {
    const results = await this.db.batch([
      this.db
        .prepare(
          `UPDATE external_games
              SET moderation_status = CASE
                    WHEN moderation_status = 'PENDING_REVIEW' THEN 'REJECTED'
                    ELSE moderation_status
                  END,
                  visibility = 'PRIVATE', review_slot = NULL, deleted_at = ?,
                  deleted_by_admin_id = ?, updated_at = ?
            WHERE id = ? AND deleted_at IS NULL`,
        )
        .bind(input.nowIso, input.adminId, input.nowIso, input.id),
      this.db
        .prepare(
          `INSERT INTO external_game_review_audit
             (external_game_id, actor_admin_id, action, reason, metadata_json, created_at)
           SELECT id, ?, 'DELETED', ?, NULL, ? FROM external_games
            WHERE id = ? AND deleted_at = ? AND deleted_by_admin_id = ? AND updated_at = ?`,
        )
        .bind(
          input.adminId,
          input.reason,
          input.nowIso,
          input.id,
          input.nowIso,
          input.adminId,
          input.nowIso,
        ),
    ]);
    if (Number(results[0]?.meta?.changes ?? 0) !== 1) return null;
    const game = await this.findById(input.id);
    if (!game) throw new Error("external game not found after delete");
    return game;
  }

  async hardDelete(id: number): Promise<void> {
    await this.db.batch([
      this.db.prepare(`DELETE FROM external_game_bookmarks WHERE external_game_id = ?`).bind(id),
      this.db.prepare(`DELETE FROM external_game_review_audit WHERE external_game_id = ?`).bind(id),
      this.db.prepare(`DELETE FROM external_game_media WHERE external_game_id = ?`).bind(id),
      this.db.prepare(`DELETE FROM external_games WHERE id = ?`).bind(id),
    ]);
  }

  async listMedia(gameId: number): Promise<ExternalGameMediaRecord[]> {
    const result = await this.db
      .prepare(
        `SELECT * FROM external_game_media WHERE external_game_id = ?
         ORDER BY CASE WHEN media_kind = 'BANNER' THEN 0 ELSE 1 END, sort_order, id`,
      )
      .bind(gameId)
      .all<Record<string, unknown>>();
    return (result.results ?? []).map(mapMedia);
  }

  async listMediaByGameIds(
    gameIds: readonly number[],
  ): Promise<Map<number, ExternalGameMediaRecord[]>> {
    if (gameIds.length === 0) return new Map();
    const uniqueIds = [...new Set(gameIds)];
    const placeholders = uniqueIds.map(() => "?").join(", ");
    const result = await this.db
      .prepare(
        `SELECT * FROM external_game_media WHERE external_game_id IN (${placeholders})
         ORDER BY external_game_id,
                  CASE WHEN media_kind = 'BANNER' THEN 0 ELSE 1 END, sort_order, id`,
      )
      .bind(...uniqueIds)
      .all<Record<string, unknown>>();
    const grouped = new Map<number, ExternalGameMediaRecord[]>();
    for (const row of result.results ?? []) {
      const media = mapMedia(row);
      const current = grouped.get(media.externalGameId) ?? [];
      current.push(media);
      grouped.set(media.externalGameId, current);
    }
    return grouped;
  }

  async findMedia(gameId: number, mediaId: number): Promise<ExternalGameMediaRecord | null> {
    const row = await this.db
      .prepare(`SELECT * FROM external_game_media WHERE external_game_id = ? AND id = ?`)
      .bind(gameId, mediaId)
      .first<Record<string, unknown>>();
    return row ? mapMedia(row) : null;
  }

  async countMedia(gameId: number, kind: ExternalGameMediaKind): Promise<number> {
    const row = await this.db
      .prepare(
        `SELECT COUNT(*) AS total FROM external_game_media
          WHERE external_game_id = ? AND media_kind = ?`,
      )
      .bind(gameId, kind)
      .first<{ total: number }>();
    return Number(row?.total ?? 0);
  }

  async addMedia(input: {
    externalGameId: number;
    kind: ExternalGameMediaKind;
    objectKey: string;
    contentType: ExternalGameMediaRecord["contentType"];
    byteSize: number;
    contentHash: string;
    altText: string;
    sortOrder: number;
    nowIso: string;
  }): Promise<ExternalGameMediaRecord> {
    const row = await this.db
      .prepare(
        `INSERT INTO external_game_media
           (external_game_id, media_kind, object_key, content_type, byte_size, content_hash,
            alt_text, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING *`,
      )
      .bind(
        input.externalGameId,
        input.kind,
        input.objectKey,
        input.contentType,
        input.byteSize,
        input.contentHash,
        input.altText,
        input.sortOrder,
        input.nowIso,
      )
      .first<Record<string, unknown>>();
    if (!row) throw new Error("external game media insert returned no row");
    return mapMedia(row);
  }

  async deleteMedia(gameId: number, mediaId: number): Promise<ExternalGameMediaRecord | null> {
    const media = await this.findMedia(gameId, mediaId);
    if (!media) return null;
    await this.db
      .prepare(`DELETE FROM external_game_media WHERE external_game_id = ? AND id = ?`)
      .bind(gameId, mediaId)
      .run();
    return media;
  }

  async addBookmark(userId: number, gameId: number, nowIso: string): Promise<number> {
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO external_game_bookmarks (user_id, external_game_id, created_at)
         VALUES (?, ?, ?)`,
      )
      .bind(userId, gameId, nowIso)
      .run();
    return this.bookmarkCount(gameId);
  }

  async removeBookmark(userId: number, gameId: number): Promise<number> {
    await this.db
      .prepare(`DELETE FROM external_game_bookmarks WHERE user_id = ? AND external_game_id = ?`)
      .bind(userId, gameId)
      .run();
    return this.bookmarkCount(gameId);
  }

  private async bookmarkCount(gameId: number): Promise<number> {
    const row = await this.db
      .prepare(`SELECT COUNT(*) AS total FROM external_game_bookmarks WHERE external_game_id = ?`)
      .bind(gameId)
      .first<{ total: number }>();
    return Number(row?.total ?? 0);
  }
}
