import type {
  AdminGameCatalogPage,
  AdminGameCatalogRepository,
  GameSettingRecord,
} from "@owogg/core";
import type { D1Database } from "./D1UserRepository.js";
import { mapGameIdentityRow } from "./D1GameIdentityRepository.js";

const PAGE_SELECT = `
  SELECT
    g.id, g.slug, g.publisher_type, g.publisher_user_id, g.visibility, g.live_version_id,
    g.deleted_at, g.created_at, g.updated_at,
    (SELECT MAX(gv.uploaded_at) FROM game_versions gv WHERE gv.game_id = g.id) AS latest_uploaded_at,
    gs.enabled AS setting_enabled, gs.disabled_reason AS setting_disabled_reason,
    gs.catalog_role AS setting_catalog_role,
    gs.updated_by_admin_id AS setting_updated_by_admin_id,
    gs.updated_at AS setting_updated_at
  FROM games g
  LEFT JOIN game_settings gs ON gs.game_id = g.slug`;

function mapSetting(row: Record<string, unknown>): GameSettingRecord | null {
  if (row.setting_enabled === null || row.setting_enabled === undefined) return null;
  return {
    gameId: String(row.slug),
    enabled: Number(row.setting_enabled) === 1,
    catalogRole: row.setting_catalog_role === "INTERNAL_TOOL" ? "INTERNAL_TOOL" : "GAME",
    disabledReason: row.setting_disabled_reason ? String(row.setting_disabled_reason) : null,
    updatedByAdminId:
      row.setting_updated_by_admin_id === null || row.setting_updated_by_admin_id === undefined
        ? null
        : Number(row.setting_updated_by_admin_id),
    updatedAt: String(row.setting_updated_at),
  };
}

export class D1AdminGameCatalogRepository implements AdminGameCatalogRepository {
  constructor(private db: D1Database) {}

  async listPage(input: {
    publisherType: "OWOGG" | "USER";
    catalogRole: "GAME" | "INTERNAL_TOOL";
    limit: number;
    offset: number;
  }): Promise<AdminGameCatalogPage> {
    const [rows, count] = await Promise.all([
      this.db
        .prepare(
          `${PAGE_SELECT}
           WHERE g.publisher_type = ? AND g.deleted_at IS NULL
             AND COALESCE(gs.catalog_role, 'GAME') = ?
           ORDER BY COALESCE(latest_uploaded_at, g.created_at) DESC, g.id DESC
           LIMIT ? OFFSET ?`,
        )
        .bind(input.publisherType, input.catalogRole, input.limit, input.offset)
        .all<Record<string, unknown>>(),
      this.db
        .prepare(
          `SELECT COUNT(*) AS total
           FROM games
           LEFT JOIN game_settings ON game_settings.game_id = games.slug
           WHERE publisher_type = ? AND deleted_at IS NULL
             AND COALESCE(game_settings.catalog_role, 'GAME') = ?`,
        )
        .bind(input.publisherType, input.catalogRole)
        .first<{ total: number }>(),
    ]);

    return {
      items: (rows.results || []).map((row) => ({
        identity: mapGameIdentityRow(row),
        latestUploadedAt: row.latest_uploaded_at ? String(row.latest_uploaded_at) : null,
        setting: mapSetting(row),
      })),
      total: Number(count?.total ?? 0),
    };
  }
}
