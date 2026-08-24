import type { GameSettingsRepository, GameSettingRecord } from "../ports/repositories.js";
import type { GameCanonicalRepository } from "../modules/game/ports/gameCanonicalRepository.js";
import type { GameIdentityRepository } from "../modules/game/ports/gameIdentityRepository.js";
import type {
  AdminGameCatalogRepository,
  AdminGameCatalogPageItem,
} from "../ports/adminGameCatalog.js";

export interface GameAvailability {
  gameId: string;
  title: string;
  shortDescription: string | null;
  description: string | null;
  genre: string | null;
  mode: "single" | "multi" | null;
  /** Latest bundle/manifest revision receipt time from server-owned game_versions data. */
  latestUploadedAt: string | null;
  publisherType: "OWOGG" | "USER";
  /** The registry's own static status (draft/beta/published/hidden) — for context only, the
   * live `enabled` flag below is what actually gates play/scoring/catalog visibility. */
  status: string;
  enabled: boolean;
  disabledReason: string | null;
  updatedByAdminId: number | null;
  updatedAt: string | null;
}

export type SetGameEnabledResult =
  { ok: true; record: GameSettingRecord } | { ok: false; code: "GAME_NOT_FOUND" };

/**
 * Resolves identities from generic D1. Canonical metadata is an optional enrichment only: a B2
 * outage must never prevent the operator from listing a game or applying the D1-only kill switch.
 */
export class GameSettingsUseCases {
  constructor(
    private repo: GameSettingsRepository,
    private identities: GameIdentityRepository,
    private canonicals?: GameCanonicalRepository,
    private adminCatalog?: AdminGameCatalogRepository,
  ) {}

  private async enrich(item: AdminGameCatalogPageItem): Promise<GameAvailability> {
    let canonical = null;
    if (this.canonicals) {
      try {
        canonical = await this.canonicals.findBySlug(item.identity.slug);
      } catch {
        canonical = null;
      }
    }
    const { identity, setting } = item;
    return {
      gameId: identity.slug,
      title: canonical?.title ?? identity.slug,
      shortDescription: canonical?.shortDescription ?? null,
      description: canonical?.description ?? null,
      genre: canonical?.catalog.type === "GENRE_MODE" ? canonical.catalog.genre : null,
      mode: canonical?.catalog.type === "GENRE_MODE" ? canonical.catalog.mode : null,
      latestUploadedAt: item.latestUploadedAt,
      publisherType: identity.publisher.type,
      status: identity.visibility === "PUBLIC" ? "published" : "draft",
      enabled: setting?.enabled ?? true,
      disabledReason: setting?.disabledReason ?? null,
      updatedByAdminId: setting?.updatedByAdminId ?? null,
      updatedAt: setting?.updatedAt ?? null,
    };
  }

  async listPage(input: {
    publisherType: "OWOGG" | "USER";
    page: number;
    pageSize: number;
  }): Promise<{
    games: GameAvailability[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    if (!this.adminCatalog) throw new Error("Admin game catalog query is not configured");
    const result = await this.adminCatalog.listPage({
      publisherType: input.publisherType,
      limit: input.pageSize,
      offset: (input.page - 1) * input.pageSize,
    });
    return {
      games: await Promise.all(result.items.map((item) => this.enrich(item))),
      total: result.total,
      page: input.page,
      pageSize: input.pageSize,
      totalPages: Math.max(1, Math.ceil(result.total / input.pageSize)),
    };
  }

  /** Every known game (from the registry) merged with its live override, if any — used by the
   * admin games panel. */
  async listAll(): Promise<GameAvailability[]> {
    const [identities, overrides] = await Promise.all([
      this.identities.listAll(),
      this.repo.getAllOverrides(),
    ]);
    const overrideByGameId = new Map(overrides.map((o) => [o.gameId, o]));

    const canonicalResults = await Promise.all(
      identities.map(async (identity) => {
        if (!this.canonicals) return [identity.slug, null] as const;
        try {
          return [identity.slug, await this.canonicals.findBySlug(identity.slug)] as const;
        } catch {
          return [identity.slug, null] as const;
        }
      }),
    );
    const canonicalBySlug = new Map(canonicalResults);

    return identities.map((identity) => {
      const override = overrideByGameId.get(identity.slug);
      const canonical = canonicalBySlug.get(identity.slug);
      return {
        gameId: identity.slug,
        title: canonical?.title ?? identity.slug,
        shortDescription: canonical?.shortDescription ?? null,
        description: canonical?.description ?? null,
        genre: canonical?.catalog.type === "GENRE_MODE" ? canonical.catalog.genre : null,
        mode: canonical?.catalog.type === "GENRE_MODE" ? canonical.catalog.mode : null,
        latestUploadedAt: null,
        publisherType: identity.publisher.type,
        status: identity.visibility === "PUBLIC" ? "published" : "draft",
        enabled: override ? override.enabled : true,
        disabledReason: override?.disabledReason ?? null,
        updatedByAdminId: override?.updatedByAdminId ?? null,
        updatedAt: override?.updatedAt ?? null,
      };
    });
  }

  /** Public-safe: just the set of game_ids an admin has explicitly turned off. Used to filter
   * the catalog and gate score submission — never exposes who disabled it or why. */
  async getDisabledGameIds(): Promise<string[]> {
    return this.repo.getDisabledGameIds();
  }

  async setEnabled(
    gameId: string,
    enabled: boolean,
    reason: string | null,
    adminId: number,
  ): Promise<SetGameEnabledResult> {
    if (!(await this.identities.findBySlug(gameId))) {
      return { ok: false, code: "GAME_NOT_FOUND" };
    }
    const record = await this.repo.setEnabled(gameId, enabled, reason, adminId);
    return { ok: true, record };
  }
}
