import {
  type GameCanonicalDocument,
  type GamePublicationFacts,
  type GamePublicationTarget,
  type GameVersion,
  type OfficialGameDeletionPlan,
  type OfficialGameLifecycleRepository,
  type OfficialGameUploadRepository,
} from "@owogg/core";
import { mapGameIdentityRow } from "./D1GameIdentityRepository.js";
import { mapGameVersionRow } from "./D1GameVersionRepository.js";
import type { D1Database } from "./D1UserRepository.js";

const IDENTITY_COLUMNS =
  "id, slug, publisher_type, publisher_user_id, visibility, live_version_id, deleted_at, created_at, updated_at";
const VERSION_COLUMNS =
  "id, game_id, object_key, content_hash, bundle_bytes, publish_status, publish_error, published_at, manifest_key, published_size_bytes, file_count, uploaded_at";

/** Worker-side OWOGG publication adapter. Every mutation is scoped to publisher_type=OWOGG and
 * has no sandbox table or USER owner write path. */
export class D1OfficialGameUploadRepository implements OfficialGameUploadRepository {
  constructor(private readonly db: D1Database) {}

  async ensureOwoggIdentity(input: { slug: string; nowIso: string }) {
    await this.db
      .prepare(
        `INSERT INTO games
           (slug, publisher_type, publisher_user_id, visibility, live_version_id,
            created_at, updated_at)
         VALUES (?, 'OWOGG', NULL, 'PRIVATE', NULL, ?, ?)
         ON CONFLICT(slug) DO NOTHING`,
      )
      .bind(input.slug, input.nowIso, input.nowIso)
      .run();

    const row = await this.db
      .prepare(`SELECT ${IDENTITY_COLUMNS} FROM games WHERE slug = ?`)
      .bind(input.slug)
      .first<Record<string, unknown>>();
    if (!row) throw new Error(`OWOGG identity was not created for ${input.slug}`);
    const identity = mapGameIdentityRow(row);
    if (identity.publisher.type !== "OWOGG" || identity.deletedAt !== null) {
      return null;
    }
    return identity;
  }

  async findVersionByContentHash(gameId: number, contentHash: string): Promise<GameVersion | null> {
    const row = await this.db
      .prepare(
        `SELECT ${VERSION_COLUMNS}
         FROM game_versions
         WHERE game_id = ? AND content_hash = ?
         ORDER BY CASE publish_status WHEN 'READY' THEN 0 ELSE 1 END, id DESC
         LIMIT 1`,
      )
      .bind(gameId, contentHash)
      .first<Record<string, unknown>>();
    return row ? mapGameVersionRow(row) : null;
  }

  async createVersion(input: {
    gameId: number;
    objectKey: string;
    contentHash: string;
    bundleBytes: number;
    nowIso: string;
  }): Promise<GameVersion> {
    const row = await this.db
      .prepare(
        `INSERT INTO game_versions
           (game_id, object_key, content_hash, bundle_bytes, publish_status, publish_error,
            published_at, manifest_key, published_size_bytes, file_count, uploaded_at,
            moderation_status)
         VALUES (?, ?, ?, ?, 'UPLOADED', NULL, NULL, NULL, NULL, NULL, ?, 'APPROVED')
         RETURNING ${VERSION_COLUMNS}`,
      )
      .bind(input.gameId, input.objectKey, input.contentHash, input.bundleBytes, input.nowIso)
      .first<Record<string, unknown>>();
    if (!row) throw new Error("OWOGG version allocation returned no row");
    return mapGameVersionRow(row);
  }

  async markPublishing(target: GamePublicationTarget): Promise<void> {
    const result = await this.db
      .prepare(
        `UPDATE game_versions
         SET publish_status = 'PUBLISHING', publish_error = NULL, published_at = NULL,
             manifest_key = NULL, published_size_bytes = NULL, file_count = NULL
         WHERE id = ? AND game_id = ? AND content_hash = ? AND publish_status <> 'READY'`,
      )
      .bind(target.versionId, target.gameId, target.contentHash)
      .run();
    if ((result.meta?.changes ?? result.meta?.rows_written ?? 0) === 0) {
      throw new Error(`OWOGG version ${target.versionId} cannot enter PUBLISHING`);
    }
  }

  async markReady(target: GamePublicationTarget, facts: GamePublicationFacts): Promise<void> {
    const result = await this.db
      .prepare(
        `UPDATE game_versions
         SET publish_status = 'READY', publish_error = NULL, published_at = ?, manifest_key = ?,
             published_size_bytes = ?, file_count = ?
         WHERE id = ? AND game_id = ? AND content_hash = ? AND publish_status = 'PUBLISHING'`,
      )
      .bind(
        facts.publishedAt,
        facts.manifestKey,
        facts.publishedSizeBytes,
        facts.fileCount,
        target.versionId,
        target.gameId,
        target.contentHash,
      )
      .run();
    if ((result.meta?.changes ?? result.meta?.rows_written ?? 0) === 0) {
      throw new Error(`OWOGG version ${target.versionId} cannot become READY`);
    }
  }

  async markFailed(target: GamePublicationTarget, error: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE game_versions
         SET publish_status = 'FAILED', publish_error = ?, published_at = NULL,
             manifest_key = NULL, published_size_bytes = NULL, file_count = NULL
         WHERE id = ? AND game_id = ? AND content_hash = ? AND publish_status <> 'READY'`,
      )
      .bind(error, target.versionId, target.gameId, target.contentHash)
      .run();
  }

  async markGarbageCollected(target: GamePublicationTarget, marker: string): Promise<void> {
    const result = await this.db
      .prepare(
        `UPDATE game_versions
         SET publish_status = 'FAILED', publish_error = ?, published_at = NULL,
             manifest_key = NULL, published_size_bytes = NULL, file_count = NULL
         WHERE id = ? AND game_id = ? AND content_hash = ?`,
      )
      .bind(marker, target.versionId, target.gameId, target.contentHash)
      .run();
    if ((result.meta?.changes ?? result.meta?.rows_written ?? 0) === 0) {
      throw new Error(`OWOGG version ${target.versionId} could not be retired`);
    }
  }

  async upsertLogo(input: { gameId: number; objectKey: string; nowIso: string }): Promise<void> {
    const result = await this.db
      .prepare(
        `INSERT INTO game_assets (game_id, kind, object_key, updated_at)
         SELECT id, 'LOGO', ?, ? FROM games WHERE id = ? AND publisher_type = 'OWOGG'
         ON CONFLICT(game_id, kind) DO UPDATE SET
           object_key = excluded.object_key,
           updated_at = excluded.updated_at`,
      )
      .bind(input.objectKey, input.nowIso, input.gameId)
      .run();
    if ((result.meta?.changes ?? result.meta?.rows_written ?? 0) === 0) {
      throw new Error(`OWOGG logo target ${input.gameId} does not exist`);
    }
  }

  async activate(input: {
    gameId: number;
    versionId: number;
    canonical: GameCanonicalDocument;
    nowIso: string;
  }): Promise<void> {
    const score = input.canonical.policy.score;
    const genre =
      input.canonical.catalog.type === "GENRE_MODE" ? input.canonical.catalog.genre : null;
    const mode =
      input.canonical.catalog.type === "GENRE_MODE" ? input.canonical.catalog.mode : null;
    const result = await this.db
      .prepare(
        `UPDATE games
         SET leaderboard_generation = leaderboard_generation +
               CASE WHEN live_version_id IS NOT ? THEN 1 ELSE 0 END,
             visibility = 'PUBLIC', live_version_id = ?, title = ?, short_description = ?,
             description = ?, genre = ?, mode = ?, xp_per_completion = ?, score_unit = ?,
             score_direction = ?, score_min = ?, score_max = ?, score_display_prefix = ?,
             score_display_suffix = ?, updated_at = ?
         WHERE id = ? AND publisher_type = 'OWOGG' AND deleted_at IS NULL
           AND EXISTS (
             SELECT 1 FROM game_versions
             WHERE id = ? AND game_id = games.id AND publish_status = 'READY'
           )`,
      )
      .bind(
        input.versionId,
        input.versionId,
        input.canonical.title,
        input.canonical.shortDescription,
        input.canonical.description,
        genre,
        mode,
        input.canonical.policy.xpPerCompletion,
        score?.unit ?? null,
        score?.direction ?? null,
        score?.min ?? null,
        score?.max ?? null,
        score?.displayPrefix ?? null,
        score?.displaySuffix ?? null,
        input.nowIso,
        input.gameId,
        input.versionId,
      )
      .run();
    if ((result.meta?.changes ?? result.meta?.rows_written ?? 0) === 0) {
      throw new Error(`OWOGG game ${input.gameId} could not activate version ${input.versionId}`);
    }
  }
}

export interface OfficialGameDeletionAuditInput {
  gameId: number;
  slug: string;
  actorAdminId: number;
  versionCount: number;
  objectCount: number;
  nowIso: string;
}

/** The same OWOGG-scoped adapter also owns permanent lifecycle cleanup. Keeping the upload and
 * deletion predicates together prevents either path from accidentally crossing into USER rows. */
export class D1OfficialGameLifecycleRepository implements OfficialGameLifecycleRepository {
  constructor(private readonly db: D1Database) {}

  async prepareDeletion(input: {
    slug: string;
    nowIso: string;
  }): Promise<OfficialGameDeletionPlan | null> {
    const results = await this.db.batch([
      this.db
        .prepare(
          `UPDATE games
           SET visibility = 'PRIVATE', live_version_id = NULL,
               deleted_at = COALESCE(deleted_at, ?), updated_at = ?
           WHERE slug = ? AND publisher_type = 'OWOGG'`,
        )
        .bind(input.nowIso, input.nowIso, input.slug),
      this.db
        .prepare(`SELECT id, slug FROM games WHERE slug = ? AND publisher_type = 'OWOGG'`)
        .bind(input.slug),
      this.db
        .prepare(
          `SELECT ${VERSION_COLUMNS}
           FROM game_versions
           WHERE game_id = (
             SELECT id FROM games WHERE slug = ? AND publisher_type = 'OWOGG'
           )
           ORDER BY id ASC`,
        )
        .bind(input.slug),
      this.db
        .prepare(
          `SELECT object_key FROM game_assets
           WHERE game_id = (
             SELECT id FROM games WHERE slug = ? AND publisher_type = 'OWOGG'
           )
           ORDER BY kind ASC`,
        )
        .bind(input.slug),
    ]);

    const identityRow = results[1]?.results?.[0] as Record<string, unknown> | undefined;
    if (!identityRow) return null;
    const gameId = Number(identityRow.id);
    const versions = ((results[2]?.results ?? []) as Record<string, unknown>[]).map(
      mapGameVersionRow,
    );
    const assetObjectKeys = ((results[3]?.results ?? []) as Record<string, unknown>[]).map((row) =>
      String(row.object_key),
    );
    return { gameId, slug: String(identityRow.slug), versions, assetObjectKeys };
  }

  async purgeDeletion(input: OfficialGameDeletionAuditInput): Promise<void> {
    const ownsDeletion = `EXISTS (
      SELECT 1 FROM games
      WHERE id = ? AND slug = ? AND publisher_type = 'OWOGG' AND deleted_at IS NOT NULL
    )`;
    const results = await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO official_game_deletion_audit_log
             (game_id, slug, actor_admin_id, version_count, object_count, deleted_at)
           SELECT ?, ?, ?, ?, ?, ? WHERE ${ownsDeletion}`,
        )
        .bind(
          input.gameId,
          input.slug,
          input.actorAdminId,
          input.versionCount,
          input.objectCount,
          input.nowIso,
          input.gameId,
          input.slug,
        ),
      this.db
        .prepare(`DELETE FROM scores WHERE game_id = ? AND ${ownsDeletion}`)
        .bind(input.slug, input.gameId, input.slug),
      this.db
        .prepare(`DELETE FROM user_favorites WHERE game_id = ? AND ${ownsDeletion}`)
        .bind(input.slug, input.gameId, input.slug),
      this.db
        .prepare(`DELETE FROM user_recent_plays WHERE game_id = ? AND ${ownsDeletion}`)
        .bind(input.slug, input.gameId, input.slug),
      this.db
        .prepare(`DELETE FROM discord_play_contexts WHERE game_id = ? AND ${ownsDeletion}`)
        .bind(input.slug, input.gameId, input.slug),
      this.db
        .prepare(`DELETE FROM game_settings WHERE game_id = ? AND ${ownsDeletion}`)
        .bind(input.slug, input.gameId, input.slug),
      this.db
        .prepare(
          `DELETE FROM game_slug_reservations
           WHERE slug = ? AND source_game_id = ? AND ${ownsDeletion}`,
        )
        .bind(input.slug, input.gameId, input.gameId, input.slug),
      this.db
        .prepare(
          `DELETE FROM games
           WHERE id = ? AND slug = ? AND publisher_type = 'OWOGG' AND deleted_at IS NOT NULL`,
        )
        .bind(input.gameId, input.slug),
    ]);

    const gameDelete = results.at(-1);
    if ((gameDelete?.meta?.changes ?? gameDelete?.meta?.rows_written ?? 0) === 0) {
      throw new Error(`OWOGG game ${input.gameId}/${input.slug} is not prepared for deletion`);
    }
  }
}
