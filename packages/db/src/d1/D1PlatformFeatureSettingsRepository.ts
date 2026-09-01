import type { PlatformFeatureSettings, PlatformFeatureSettingsRepository } from "@owogg/core";
import type { D1Database } from "./D1UserRepository.js";

export class D1PlatformFeatureSettingsRepository implements PlatformFeatureSettingsRepository {
  constructor(private readonly db: D1Database) {}

  async get(): Promise<PlatformFeatureSettings> {
    const result = await this.db
      .prepare(
        `SELECT setting_key, enabled
         FROM platform_feature_settings
         WHERE setting_key IN ('MULTIPLAYER', 'EXTERNAL_PLATFORM_GAMES')`,
      )
      .all<{ setting_key: string; enabled: number }>();
    const settings = new Map(
      (result.results ?? []).map((row) => [row.setting_key, Number(row.enabled) === 1]),
    );
    return {
      multiplayerEnabled: settings.get("MULTIPLAYER") ?? true,
      externalPlatformGamesVisible: settings.get("EXTERNAL_PLATFORM_GAMES") ?? false,
    };
  }

  async set(input: {
    multiplayerEnabled?: boolean | undefined;
    externalPlatformGamesVisible?: boolean | undefined;
    adminId: number;
    nowIso: string;
  }): Promise<PlatformFeatureSettings> {
    const statements = [
      input.multiplayerEnabled === undefined
        ? null
        : this.db
            .prepare(
              `INSERT INTO platform_feature_settings
                 (setting_key, enabled, updated_by_admin_id, updated_at)
               VALUES ('MULTIPLAYER', ?, ?, ?)
               ON CONFLICT(setting_key) DO UPDATE SET
                 enabled = excluded.enabled,
                 updated_by_admin_id = excluded.updated_by_admin_id,
                 updated_at = excluded.updated_at`,
            )
            .bind(input.multiplayerEnabled ? 1 : 0, input.adminId, input.nowIso),
      input.externalPlatformGamesVisible === undefined
        ? null
        : this.db
            .prepare(
              `INSERT INTO platform_feature_settings
                 (setting_key, enabled, updated_by_admin_id, updated_at)
               VALUES ('EXTERNAL_PLATFORM_GAMES', ?, ?, ?)
               ON CONFLICT(setting_key) DO UPDATE SET
                 enabled = excluded.enabled,
                 updated_by_admin_id = excluded.updated_by_admin_id,
                 updated_at = excluded.updated_at`,
            )
            .bind(input.externalPlatformGamesVisible ? 1 : 0, input.adminId, input.nowIso),
    ].filter((statement): statement is NonNullable<typeof statement> => statement !== null);
    if (statements.length > 0) await this.db.batch(statements);
    return this.get();
  }
}
