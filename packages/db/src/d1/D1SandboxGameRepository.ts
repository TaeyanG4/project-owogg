import type {
  SandboxGameRepository,
  SandboxGameRecord,
  SandboxGameVersionRecord,
  SandboxGameReviewAuditEntry,
  SandboxGameMetadataInput,
  SandboxGamePendingVersionsPage,
  SandboxGameVisibility,
  SandboxGameVersionStatus,
  SandboxGamePublishStatus,
  SandboxGameMode,
} from "@owogg/core";
import type { D1Database } from "./D1UserRepository.js";

const USER_GAME_SELECT = `
  SELECT
    g.id, g.slug, g.publisher_user_id AS developer_user_id,
    g.title, g.short_description, g.description, g.genre, g.mode,
    g.tags_json, g.default_screen_mode, cooldown.last_edited_at AS content_last_edited_at,
    a.object_key AS logo_key,
    g.xp_per_completion, g.score_unit, g.score_direction, g.score_min, g.score_max,
    g.score_display_prefix, g.score_display_suffix,
    g.visibility, g.live_version_id, g.review_slot, g.deleted_at, g.deleted_by_admin_id,
    g.created_at, g.updated_at
  FROM games g
  LEFT JOIN game_assets a ON a.game_id = g.id AND a.kind = 'LOGO'
  LEFT JOIN game_content_edit_cooldowns cooldown ON cooldown.game_id = g.id`;

const USER_VERSION_SELECT = `
  SELECT
    gv.id, gv.game_id, gv.object_key, gv.content_hash, gv.bundle_bytes,
    gv.moderation_status AS status, gv.reviewed_by_admin_id, gv.reviewed_at, gv.reject_reason,
    gv.uploaded_at, gv.publish_status, gv.publish_error, gv.published_at, gv.manifest_key,
    gv.published_size_bytes, gv.file_count
  FROM game_versions gv
  JOIN games g ON g.id = gv.game_id AND g.publisher_type = 'USER'`;

function mapGameRow(row: Record<string, unknown>): SandboxGameRecord {
  let tags: string[] = [];
  try {
    const parsed: unknown = JSON.parse(String(row.tags_json ?? "[]"));
    if (Array.isArray(parsed))
      tags = parsed.filter((tag): tag is string => typeof tag === "string");
  } catch {
    tags = [];
  }
  const lastEditedAt = row.content_last_edited_at ? String(row.content_last_edited_at) : null;
  return {
    id: Number(row.id),
    slug: String(row.slug),
    developerUserId: Number(row.developer_user_id),
    title: String(row.title),
    shortDescription: row.short_description ? String(row.short_description) : null,
    description: row.description ? String(row.description) : null,
    genre: String(row.genre),
    tags,
    defaultScreenMode: row.default_screen_mode === "theater" ? "theater" : "default",
    contentEditAvailableAt: lastEditedAt
      ? new Date(Date.parse(lastEditedAt) + 24 * 60 * 60 * 1000).toISOString()
      : null,
    // Falls back to "single" for pre-2026-08-18 rows inserted before this column existed with a
    // NOT NULL DEFAULT (migration 0027) — the DB default already covers this, `?? "single"` here
    // is just defense in depth against a row read through a stale schema.
    mode: (row.mode as SandboxGameMode | undefined) ?? "single",
    logoKey: row.logo_key ? String(row.logo_key) : null,
    xpPerCompletion: Number(row.xp_per_completion ?? 0),
    scoreUnit: row.score_unit ? String(row.score_unit) : null,
    scoreDirection: (row.score_direction as "asc" | "desc" | null) ?? null,
    scoreMin: row.score_min === null || row.score_min === undefined ? null : Number(row.score_min),
    scoreMax: row.score_max === null || row.score_max === undefined ? null : Number(row.score_max),
    scoreDisplayPrefix: row.score_display_prefix ? String(row.score_display_prefix) : null,
    scoreDisplaySuffix: row.score_display_suffix ? String(row.score_display_suffix) : null,
    visibility: row.visibility as SandboxGameVisibility,
    liveVersionId:
      row.live_version_id === null || row.live_version_id === undefined
        ? null
        : Number(row.live_version_id),
    reviewSlot:
      row.review_slot === null || row.review_slot === undefined
        ? null
        : (Number(row.review_slot) as 1 | 2),
    deletedAt: row.deleted_at ? String(row.deleted_at) : null,
    deletedByAdminId:
      row.deleted_by_admin_id === null || row.deleted_by_admin_id === undefined
        ? null
        : Number(row.deleted_by_admin_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapVersionRow(row: Record<string, unknown>): SandboxGameVersionRecord {
  return {
    id: Number(row.id),
    gameId: Number(row.game_id),
    objectKey: String(row.object_key),
    contentHash: String(row.content_hash),
    bundleBytes: Number(row.bundle_bytes),
    status: row.status as SandboxGameVersionStatus,
    reviewedByAdminId:
      row.reviewed_by_admin_id === null || row.reviewed_by_admin_id === undefined
        ? null
        : Number(row.reviewed_by_admin_id),
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
    rejectReason: row.reject_reason ? String(row.reject_reason) : null,
    uploadedAt: String(row.uploaded_at),
    publishStatus: (row.publish_status as SandboxGamePublishStatus | undefined) ?? "UPLOADED",
    publishError: row.publish_error ? String(row.publish_error) : null,
    publishedAt: row.published_at ? String(row.published_at) : null,
    manifestKey: row.manifest_key ? String(row.manifest_key) : null,
    publishedSizeBytes:
      row.published_size_bytes === null || row.published_size_bytes === undefined
        ? null
        : Number(row.published_size_bytes),
    fileCount:
      row.file_count === null || row.file_count === undefined ? null : Number(row.file_count),
  };
}

function mapAuditRow(row: Record<string, unknown>): SandboxGameReviewAuditEntry {
  return {
    id: Number(row.id),
    gameId: Number(row.game_id),
    versionId:
      row.version_id === null || row.version_id === undefined ? null : Number(row.version_id),
    actorAdminId: Number(row.actor_admin_id),
    action: String(row.action),
    reason: row.reason ? String(row.reason) : null,
    metadata: row.metadata_json ? JSON.parse(String(row.metadata_json)) : null,
    createdAt: String(row.created_at),
  };
}

/** Column/param pairs for a partial metadata UPDATE — only fields present in `input` are
 * touched, so an admin editing just the title never clobbers score config set earlier. */
function buildMetadataAssignments(input: SandboxGameMetadataInput): {
  sets: string[];
  params: unknown[];
} {
  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    params.push(value);
  };

  if (input.title !== undefined) push("title", input.title.trim());
  if (input.shortDescription !== undefined) push("short_description", input.shortDescription);
  if (input.description !== undefined) push("description", input.description);
  if (input.genre !== undefined) push("genre", input.genre.trim());
  if (input.mode !== undefined) push("mode", input.mode);
  if (input.tags !== undefined) push("tags_json", JSON.stringify(input.tags));
  if (input.defaultScreenMode !== undefined) push("default_screen_mode", input.defaultScreenMode);
  if (input.xpPerCompletion !== undefined) push("xp_per_completion", input.xpPerCompletion);
  if (input.scoreUnit !== undefined) push("score_unit", input.scoreUnit);
  if (input.scoreDirection !== undefined) push("score_direction", input.scoreDirection);
  if (input.scoreMin !== undefined) push("score_min", input.scoreMin);
  if (input.scoreMax !== undefined) push("score_max", input.scoreMax);
  if (input.scoreDisplayPrefix !== undefined)
    push("score_display_prefix", input.scoreDisplayPrefix);
  if (input.scoreDisplaySuffix !== undefined)
    push("score_display_suffix", input.scoreDisplaySuffix);

  return { sets, params };
}

export class D1SandboxGameRepository implements SandboxGameRepository {
  constructor(private db: D1Database) {}

  async findById(id: number): Promise<SandboxGameRecord | null> {
    const row = await this.db
      .prepare(`${USER_GAME_SELECT} WHERE g.id = ? AND g.publisher_type = 'USER'`)
      .bind(id)
      .first<Record<string, unknown>>();
    return row ? mapGameRow(row) : null;
  }

  // Excludes soft-deleted games — this is the slug lookup /play/:slug resolves through, so a
  // deleted game's slug must stop resolving immediately, not just stop being servable once found.
  async findBySlug(slug: string): Promise<SandboxGameRecord | null> {
    const row = await this.db
      .prepare(
        `${USER_GAME_SELECT} WHERE g.slug = ? AND g.publisher_type = 'USER' AND g.deleted_at IS NULL`,
      )
      .bind(slug)
      .first<Record<string, unknown>>();
    return row ? mapGameRow(row) : null;
  }

  // Deliberately NOT filtered by deleted_at — see the port doc comment. A slug stays taken while
  // any generic identity row exists, and remains taken after hard deletion when approval created a
  // permanent reservation. The UNION keeps this a single fail-closed database read.
  async slugExists(slug: string): Promise<boolean> {
    const row = await this.db
      .prepare(
        `SELECT 1 FROM games WHERE slug = ?
         UNION ALL
         SELECT 1 FROM game_slug_reservations WHERE slug = ?
         LIMIT 1`,
      )
      .bind(slug, slug)
      .first<{ 1: number }>();
    return row !== null;
  }

  // Deliberately NOT filtered by deleted_at — a developer's own "my games" list still shows a
  // deleted game (with deletedAt set) so they know what happened to it, the same way a REJECTED
  // version stays visible rather than disappearing.
  async listByDeveloper(developerUserId: number): Promise<SandboxGameRecord[]> {
    const res = await this.db
      .prepare(
        `${USER_GAME_SELECT} WHERE g.publisher_type = 'USER' AND g.publisher_user_id = ? ORDER BY g.created_at DESC`,
      )
      .bind(developerUserId)
      .all<Record<string, unknown>>();
    return (res.results || []).map(mapGameRow);
  }

  // Deliberately NOT filtered by deleted_at — see the port doc comment. This is the admin's only
  // browse-everything surface, and purgeGame only ever applies to an already-deleted game, so
  // admins need to be able to find one here without already knowing its id.
  async listAll(): Promise<SandboxGameRecord[]> {
    const res = await this.db
      .prepare(`${USER_GAME_SELECT} WHERE g.publisher_type = 'USER' ORDER BY g.created_at DESC`)
      .all<Record<string, unknown>>();
    return (res.results || []).map(mapGameRow);
  }

  async listAllPage(limit: number, offset: number) {
    const [rows, count] = await Promise.all([
      this.db
        .prepare(
          `SELECT page_game.*,
             (SELECT MAX(latest_gv.uploaded_at)
              FROM game_versions latest_gv
              WHERE latest_gv.game_id = page_game.id) AS latest_uploaded_at
           FROM (${USER_GAME_SELECT} WHERE g.publisher_type = 'USER') page_game
           ORDER BY COALESCE(latest_uploaded_at, page_game.created_at) DESC, page_game.id DESC
           LIMIT ? OFFSET ?`,
        )
        .bind(limit, offset)
        .all<Record<string, unknown>>(),
      this.db
        .prepare(`SELECT COUNT(*) AS total FROM games WHERE publisher_type = 'USER'`)
        .first<{ total: number }>(),
    ]);
    return {
      entries: (rows.results || []).map((row) => ({
        game: mapGameRow(row),
        latestUploadedAt: row.latest_uploaded_at ? String(row.latest_uploaded_at) : null,
      })),
      total: Number(count?.total ?? 0),
    };
  }

  async softDelete(
    id: number,
    deletedByAdminId: number,
    nowIso: string,
  ): Promise<SandboxGameRecord> {
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE games
           SET deleted_at = ?, deleted_by_admin_id = ?, visibility = 'PRIVATE', updated_at = ?
           WHERE id = ? AND publisher_type = 'USER'`,
        )
        .bind(nowIso, deletedByAdminId, nowIso, id),
      this.db
        .prepare(
          `UPDATE sandbox_games
           SET deleted_at = ?, deleted_by_admin_id = ?, visibility = 'PRIVATE', updated_at = ?
           WHERE id = ?`,
        )
        .bind(nowIso, deletedByAdminId, nowIso, id),
    ]);
    const updated = await this.findById(id);
    if (!updated) throw new Error(`games row ${id} vanished mid-delete`);
    return updated;
  }

  async hardDelete(id: number): Promise<void> {
    // Children first, parent last — explicit rather than relying on the schema's
    // ON DELETE CASCADE actually being enforced (SQLite/D1 foreign-key enforcement is a per-
    // connection PRAGMA; being explicit here doesn't depend on it). One batch() call for
    // atomicity across the statements. The trg_sandbox_games_after_delete trigger automatically
    // removes the corresponding USER row from `games`; game_slug_reservations is deliberately not
    // part of this batch or any FK cascade.
    await this.db.batch([
      this.db.prepare(`DELETE FROM sandbox_game_review_audit_log WHERE game_id = ?`).bind(id),
      this.db.prepare(`DELETE FROM sandbox_game_versions WHERE game_id = ?`).bind(id),
      this.db.prepare(`DELETE FROM sandbox_games WHERE id = ?`).bind(id),
      this.db.prepare(`DELETE FROM game_versions WHERE game_id = ?`).bind(id),
      this.db.prepare(`DELETE FROM games WHERE id = ? AND publisher_type = 'USER'`).bind(id),
    ]);
  }

  async create(input: {
    slug: string;
    developerUserId: number;
    title: string;
    shortDescription: string | null;
    description: string | null;
    genre: string;
    mode: SandboxGameMode;
    tags: readonly string[];
    defaultScreenMode: "default" | "theater";
    nowIso: string;
  }): Promise<SandboxGameRecord | null> {
    // Shared numeric ID namespace allocation:
    // 1. Statement 1 inserts into generic `games` table, allocating the shared primary key `id`
    //    while verifying developer review slot availability atomically in a single statement.
    // 2. Statement 2 mirrors that exact identity and claimed slot into `sandbox_games` for the
    //    previous Worker revision during the rolling-deploy compatibility window.
    // 3. If both slots are already held, both statements write 0 rows atomically and create() returns null.
    // 4. Executed in a single db.batch() call so that no interleaving is possible and failure in either
    //    statement rolls back the entire batch.
    const res = await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO games
             (slug, publisher_type, publisher_user_id, visibility, live_version_id, created_at, updated_at,
              title, short_description, description, genre, mode, tags_json, default_screen_mode,
              xp_per_completion, review_slot)
           SELECT ?, 'USER', ?, 'PRIVATE', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, available.slot
           FROM (
             SELECT MIN(s.slot) AS slot
             FROM (SELECT 1 AS slot UNION ALL SELECT 2) s
             WHERE s.slot NOT IN (
               SELECT review_slot FROM games
               WHERE publisher_type = 'USER' AND publisher_user_id = ? AND review_slot IS NOT NULL
             )
           ) available
           WHERE available.slot IS NOT NULL`,
        )
        .bind(
          input.slug,
          input.developerUserId,
          input.nowIso,
          input.nowIso,
          input.title,
          input.shortDescription,
          input.description,
          input.genre,
          input.mode,
          JSON.stringify(input.tags ?? []),
          input.defaultScreenMode ?? "default",
          input.developerUserId,
        ),
      this.db
        .prepare(
          `INSERT INTO sandbox_games
             (id, slug, developer_user_id, title, short_description, description, genre, mode,
              tags_json, default_screen_mode, review_slot, created_at, updated_at)
           SELECT g.id, ?, ?, ?, ?, ?, ?, ?, ?, ?, g.review_slot, ?, ?
           FROM games g
           WHERE g.slug = ? AND g.publisher_type = 'USER' AND g.review_slot IS NOT NULL`,
        )
        .bind(
          input.slug,
          input.developerUserId,
          input.title,
          input.shortDescription,
          input.description,
          input.genre,
          input.mode,
          JSON.stringify(input.tags ?? []),
          input.defaultScreenMode ?? "default",
          input.nowIso,
          input.nowIso,
          input.slug,
        ),
    ]);

    const [gamesResult, sandboxResult] = res;
    if (!gamesResult?.meta?.changes || !sandboxResult?.meta?.changes) {
      return null; // no review slot available
    }

    // Deliberately NOT `WHERE rowid = last_insert_rowid()` here: that reads connection-global
    // state, and this repository's whole point is being safe under concurrent callers sharing one
    // connection. `slug` is UNIQUE and was just written by this exact call, so filtering on it is
    // race-proof without needing a connection-scoped identifier at all.
    const row = await this.db
      .prepare(`${USER_GAME_SELECT} WHERE g.slug = ? AND g.publisher_type = 'USER'`)
      .bind(input.slug)
      .first<Record<string, unknown>>();
    if (!row) throw new Error("sandbox_games row vanished immediately after insert");
    return mapGameRow(row);
  }

  async releaseReviewSlot(id: number, nowIso: string): Promise<SandboxGameRecord> {
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE games SET review_slot = NULL, updated_at = ?
           WHERE id = ? AND publisher_type = 'USER' AND review_slot IS NOT NULL`,
        )
        .bind(nowIso, id),
      this.db
        .prepare(
          `UPDATE sandbox_games SET review_slot = NULL, updated_at = ?
           WHERE id = ? AND review_slot IS NOT NULL`,
        )
        .bind(nowIso, id),
    ]);
    const updated = await this.findById(id);
    if (!updated) throw new Error(`sandbox_games row ${id} not found after slot release`);
    return updated;
  }

  async updateMetadata(
    id: number,
    input: SandboxGameMetadataInput,
    nowIso: string,
  ): Promise<SandboxGameRecord> {
    const { sets, params } = buildMetadataAssignments(input);
    if (sets.length > 0) {
      await this.db.batch([
        this.db
          .prepare(
            `UPDATE games SET ${sets.join(", ")}, updated_at = ?
             WHERE id = ? AND publisher_type = 'USER'`,
          )
          .bind(...params, nowIso, id),
        this.db
          .prepare(`UPDATE sandbox_games SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`)
          .bind(...params, nowIso, id),
      ]);
    }
    const updated = await this.findById(id);
    if (!updated) throw new Error(`sandbox_games row ${id} not found after metadata update`);
    return updated;
  }

  async setVisibility(
    id: number,
    visibility: SandboxGameVisibility,
    nowIso: string,
  ): Promise<SandboxGameRecord> {
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE games SET visibility = ?, updated_at = ? WHERE id = ? AND publisher_type = 'USER'`,
        )
        .bind(visibility, nowIso, id),
      this.db
        .prepare(`UPDATE sandbox_games SET visibility = ?, updated_at = ? WHERE id = ?`)
        .bind(visibility, nowIso, id),
    ]);
    const updated = await this.findById(id);
    if (!updated) throw new Error(`sandbox_games row ${id} not found after visibility update`);
    return updated;
  }

  async setLogo(id: number, logoKey: string, nowIso: string): Promise<SandboxGameRecord> {
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO game_assets (game_id, kind, object_key, updated_at)
           SELECT id, 'LOGO', ?, ? FROM games WHERE id = ? AND publisher_type = 'USER'
           ON CONFLICT(game_id, kind) DO UPDATE SET object_key = excluded.object_key, updated_at = excluded.updated_at`,
        )
        .bind(logoKey, nowIso, id),
      this.db
        .prepare(`UPDATE sandbox_games SET logo_key = ?, updated_at = ? WHERE id = ?`)
        .bind(logoKey, nowIso, id),
    ]);
    const updated = await this.findById(id);
    if (!updated) throw new Error(`sandbox_games row ${id} not found after logo update`);
    return updated;
  }

  async setLiveVersion(id: number, versionId: number, nowIso: string): Promise<SandboxGameRecord> {
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE games
           SET leaderboard_generation = leaderboard_generation +
                 CASE WHEN live_version_id IS NOT ? THEN 1 ELSE 0 END,
               live_version_id = ?, updated_at = ?
           WHERE id = ? AND publisher_type = 'USER'`,
        )
        .bind(versionId, versionId, nowIso, id),
      this.db
        .prepare(`UPDATE sandbox_games SET live_version_id = ?, updated_at = ? WHERE id = ?`)
        .bind(versionId, nowIso, id),
    ]);
    const updated = await this.findById(id);
    if (!updated) throw new Error(`sandbox_games row ${id} not found after live-version update`);
    return updated;
  }

  async clearLiveVersionIfMatches(
    id: number,
    versionId: number,
    nowIso: string,
  ): Promise<SandboxGameRecord> {
    // `AND live_version_id = ?` makes this conditional at the SQL level, not a read-then-write:
    // if the game's live version has already moved on (0 rows affected), the row is left
    // untouched rather than this racing a concurrent setLiveVersion call. visibility -> PRIVATE in
    // the same statement satisfies the CHECK (visibility = 'PRIVATE' OR live_version_id IS NOT
    // NULL) constraint — same reasoning as softDelete.
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE games
           SET live_version_id = NULL, visibility = 'PRIVATE', updated_at = ?
           WHERE id = ? AND publisher_type = 'USER' AND live_version_id = ?`,
        )
        .bind(nowIso, id, versionId),
      this.db
        .prepare(
          `UPDATE sandbox_games
           SET live_version_id = NULL, visibility = 'PRIVATE', updated_at = ?
           WHERE id = ? AND live_version_id = ?`,
        )
        .bind(nowIso, id, versionId),
    ]);
    const updated = await this.findById(id);
    if (!updated) throw new Error(`sandbox_games row ${id} not found after live-version clear`);
    return updated;
  }

  async createVersion(input: {
    gameId: number;
    objectKey: string;
    contentHash: string;
    bundleBytes: number;
    nowIso: string;
  }): Promise<SandboxGameVersionRecord> {
    // A-4 shared numeric namespace:
    // 1. Generic game_versions allocates the ID.
    // 2. The legacy USER review row consumes that exact ID via last_insert_rowid() inside the same
    //    atomic D1 batch. Unlike a separate statement/call, no concurrent writer can interleave in
    //    a batch; a failure in either statement rolls both back.
    // 3. RETURNING on statement 2 gives this call its own row without a racy post-batch MAX query.
    const results = await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO game_versions (
             game_id, object_key, content_hash, bundle_bytes, publish_status, publish_error,
             published_at, manifest_key, published_size_bytes, file_count, uploaded_at,
             moderation_status, reviewed_by_admin_id, reviewed_at, reject_reason
           ) VALUES (?, ?, ?, ?, 'UPLOADED', NULL, NULL, NULL, NULL, NULL, ?,
             'PENDING_REVIEW', NULL, NULL, NULL)`,
        )
        .bind(input.gameId, input.objectKey, input.contentHash, input.bundleBytes, input.nowIso),
      this.db
        .prepare(
          `INSERT INTO sandbox_game_versions (
             id, game_id, object_key, content_hash, bundle_bytes, uploaded_at
           ) VALUES (last_insert_rowid(), ?, ?, ?, ?, ?)
           RETURNING *`,
        )
        .bind(input.gameId, input.objectKey, input.contentHash, input.bundleBytes, input.nowIso),
    ]);

    const row = results[1]?.results?.[0] as Record<string, unknown> | undefined;
    if (!row) throw new Error("sandbox_game_versions row vanished immediately after insert");
    return mapVersionRow(row);
  }

  async findVersionById(id: number): Promise<SandboxGameVersionRecord | null> {
    const row = await this.db
      .prepare(`${USER_VERSION_SELECT} WHERE gv.id = ?`)
      .bind(id)
      .first<Record<string, unknown>>();
    return row ? mapVersionRow(row) : null;
  }

  async setVersionPublishState(
    id: number,
    state: {
      publishStatus: SandboxGamePublishStatus;
      publishError: string | null;
      publishedAt: string | null;
      manifestKey: string | null;
      publishedSizeBytes: number | null;
      fileCount: number | null;
    },
  ): Promise<SandboxGameVersionRecord> {
    const params = [
      state.publishStatus,
      state.publishError,
      state.publishedAt,
      state.manifestKey,
      state.publishedSizeBytes,
      state.fileCount,
      id,
    ] as const;
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE game_versions
           SET publish_status = ?, publish_error = ?, published_at = ?, manifest_key = ?,
               published_size_bytes = ?, file_count = ?
           WHERE id = ?`,
        )
        .bind(...params),
      this.db
        .prepare(
          `UPDATE sandbox_game_versions
           SET publish_status = ?, publish_error = ?, published_at = ?, manifest_key = ?,
               published_size_bytes = ?, file_count = ?
           WHERE id = ?`,
        )
        .bind(...params),
    ]);
    const updated = await this.findVersionById(id);
    if (!updated) throw new Error(`sandbox_game_versions row ${id} not found after publish update`);
    return updated;
  }

  async listVersionsByGame(gameId: number): Promise<SandboxGameVersionRecord[]> {
    const res = await this.db
      .prepare(`${USER_VERSION_SELECT} WHERE gv.game_id = ? ORDER BY gv.uploaded_at DESC`)
      .bind(gameId)
      .all<Record<string, unknown>>();
    return (res.results || []).map(mapVersionRow);
  }

  async listPendingVersions(
    limit: number,
    offset: number,
  ): Promise<SandboxGamePendingVersionsPage> {
    const countRow = await this.db
      .prepare(
        `SELECT COUNT(*) as c FROM game_versions gv
         JOIN games g ON g.id = gv.game_id AND g.publisher_type = 'USER'
         WHERE gv.moderation_status = 'PENDING_REVIEW'`,
      )
      .first<{ c: number }>();
    const res = await this.db
      .prepare(
        `${USER_VERSION_SELECT} WHERE gv.moderation_status = 'PENDING_REVIEW'
         ORDER BY gv.uploaded_at ASC LIMIT ? OFFSET ?`,
      )
      .bind(limit, offset)
      .all<Record<string, unknown>>();

    return {
      total: Number(countRow?.c ?? 0),
      versions: (res.results || []).map(mapVersionRow),
    };
  }

  async decideVersion(
    id: number,
    status: "APPROVED" | "REJECTED",
    adminId: number,
    reason: string | null,
    nowIso: string,
  ): Promise<SandboxGameVersionRecord> {
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE game_versions
           SET moderation_status = ?, reviewed_by_admin_id = ?, reviewed_at = ?, reject_reason = ?
           WHERE id = ?`,
        )
        .bind(status, adminId, nowIso, reason, id),
      this.db
        .prepare(
          `UPDATE sandbox_game_versions
           SET status = ?, reviewed_by_admin_id = ?, reviewed_at = ?, reject_reason = ?
           WHERE id = ?`,
        )
        .bind(status, adminId, nowIso, reason, id),
    ]);
    const updated = await this.findVersionById(id);
    if (!updated) throw new Error(`sandbox_game_versions row ${id} not found after decision`);
    return updated;
  }

  async revokeVersionApproval(id: number): Promise<SandboxGameVersionRecord> {
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE game_versions
           SET moderation_status = 'PENDING_REVIEW', reviewed_by_admin_id = NULL,
               reviewed_at = NULL, reject_reason = NULL WHERE id = ?`,
        )
        .bind(id),
      this.db
        .prepare(
          `UPDATE sandbox_game_versions
           SET status = 'PENDING_REVIEW', reviewed_by_admin_id = NULL,
               reviewed_at = NULL, reject_reason = NULL WHERE id = ?`,
        )
        .bind(id),
    ]);
    const updated = await this.findVersionById(id);
    if (!updated) throw new Error(`sandbox_game_versions row ${id} not found after revoke`);
    return updated;
  }

  async withdrawVersion(id: number): Promise<SandboxGameVersionRecord> {
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE game_versions SET moderation_status = 'WITHDRAWN'
           WHERE id = ? AND moderation_status = 'PENDING_REVIEW'`,
        )
        .bind(id),
      this.db
        .prepare(
          `UPDATE sandbox_game_versions SET status = 'WITHDRAWN'
           WHERE id = ? AND status = 'PENDING_REVIEW'`,
        )
        .bind(id),
    ]);
    const updated = await this.findVersionById(id);
    if (!updated) throw new Error(`sandbox_game_versions row ${id} not found after withdrawal`);
    return updated;
  }

  async appendReviewAudit(entry: {
    gameId: number;
    versionId: number | null;
    actorAdminId: number;
    action: string;
    reason: string | null;
    metadata: Record<string, unknown> | null;
    nowIso: string;
  }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO sandbox_game_review_audit_log
           (game_id, version_id, actor_admin_id, action, reason, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        entry.gameId,
        entry.versionId,
        entry.actorAdminId,
        entry.action,
        entry.reason,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
        entry.nowIso,
      )
      .run();
  }

  async listReviewAudit(gameId: number, limit = 50): Promise<SandboxGameReviewAuditEntry[]> {
    const res = await this.db
      .prepare(
        `SELECT * FROM sandbox_game_review_audit_log WHERE game_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .bind(gameId, limit)
      .all<Record<string, unknown>>();
    return (res.results || []).map(mapAuditRow);
  }

  async claimContentEdit(input: {
    gameId: number;
    userId: number;
    nowIso: string;
    cutoffIso: string;
  }): Promise<{ claimed: boolean; availableAt: string | null }> {
    const claimed = await this.db
      .prepare(
        `INSERT INTO game_content_edit_cooldowns (game_id, edited_by_user_id, last_edited_at)
         VALUES (?, ?, ?)
         ON CONFLICT(game_id) DO UPDATE SET
           edited_by_user_id = excluded.edited_by_user_id,
           last_edited_at = excluded.last_edited_at
         WHERE game_content_edit_cooldowns.last_edited_at <= ?
         RETURNING last_edited_at`,
      )
      .bind(input.gameId, input.userId, input.nowIso, input.cutoffIso)
      .first<{ last_edited_at: string }>();
    if (claimed) return { claimed: true, availableAt: null };

    const existing = await this.db
      .prepare(`SELECT last_edited_at FROM game_content_edit_cooldowns WHERE game_id = ?`)
      .bind(input.gameId)
      .first<{ last_edited_at: string }>();
    return {
      claimed: false,
      availableAt: existing
        ? new Date(Date.parse(existing.last_edited_at) + 24 * 60 * 60 * 1000).toISOString()
        : null,
    };
  }

  async releaseContentEditClaim(input: {
    gameId: number;
    userId: number;
    claimedAt: string;
  }): Promise<void> {
    await this.db
      .prepare(
        `DELETE FROM game_content_edit_cooldowns
         WHERE game_id = ? AND edited_by_user_id = ? AND last_edited_at = ?`,
      )
      .bind(input.gameId, input.userId, input.claimedAt)
      .run();
  }

  async isSlugPermanentlyReserved(slug: string): Promise<boolean> {
    const row = await this.db
      .prepare(`SELECT 1 FROM game_slug_reservations WHERE slug = ?`)
      .bind(slug)
      .first<{ 1: number }>();
    return row !== null;
  }
}
