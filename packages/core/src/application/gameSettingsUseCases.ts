import type { GameSettingsRepository, GameSettingRecord } from "../ports/repositories.js";
import type { GameCanonicalRepository } from "../modules/game/ports/gameCanonicalRepository.js";
import type { GameIdentityRepository } from "../modules/game/ports/gameIdentityRepository.js";
import type { GameIdentity } from "../modules/game/domain/gameIdentity.js";
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
  tags: readonly string[];
  defaultScreenMode: "default" | "theater";
  /** Latest bundle/manifest revision receipt time from server-owned game_versions data. */
  latestUploadedAt: string | null;
  publisherType: "OWOGG" | "USER";
  /** Server-owned UI classification. INTERNAL_TOOL identities never enter public catalogs. */
  catalogRole: "GAME" | "INTERNAL_TOOL";
  /** Why this identity is or is not eligible for the public runtime catalog. The independent
   * `enabled` flag below is only the emergency safety override and must not be presented as proof
   * that an incomplete/private identity is publicly playable. */
  catalogState: "READY" | "PRIVATE" | "NO_LIVE_VERSION" | "CANONICAL_UNAVAILABLE";
  /** The registry's own static status (draft/beta/published/hidden) — for context only, the
   * live `enabled` flag below is what actually gates play/scoring/catalog visibility. */
  status: string;
  enabled: boolean;
  disabledReason: string | null;
  updatedByAdminId: number | null;
  updatedAt: string | null;
}

function catalogState(
  identity: GameIdentity,
  canonicalAvailable: boolean,
): GameAvailability["catalogState"] {
  if (identity.liveVersionId === null) return "NO_LIVE_VERSION";
  if (identity.visibility !== "PUBLIC") return "PRIVATE";
  return canonicalAvailable ? "READY" : "CANONICAL_UNAVAILABLE";
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
      tags: canonical?.catalog.tags ?? [],
      defaultScreenMode: canonical?.presentation?.defaultMode ?? "default",
      latestUploadedAt: item.latestUploadedAt,
      publisherType: identity.publisher.type,
      catalogRole: setting?.catalogRole ?? "GAME",
      catalogState: catalogState(identity, canonical !== null),
      status: identity.visibility === "PUBLIC" ? "published" : "draft",
      enabled: setting?.enabled ?? true,
      disabledReason: setting?.disabledReason ?? null,
      updatedByAdminId: setting?.updatedByAdminId ?? null,
      updatedAt: setting?.updatedAt ?? null,
    };
  }

  async listPage(input: {
    publisherType: "OWOGG" | "USER";
    catalogRole: "GAME" | "INTERNAL_TOOL";
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
      catalogRole: input.catalogRole,
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
        tags: canonical?.catalog.tags ?? [],
        defaultScreenMode: canonical?.presentation?.defaultMode ?? "default",
        latestUploadedAt: null,
        publisherType: identity.publisher.type,
        catalogRole: override?.catalogRole ?? "GAME",
        catalogState: catalogState(identity, canonical !== null),
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

  async setCatalogRole(
    gameId: string,
    catalogRole: "GAME" | "INTERNAL_TOOL",
    adminId: number,
  ): Promise<SetGameEnabledResult> {
    const identity = await this.identities.findBySlug(gameId);
    if (!identity || identity.deletedAt !== null) return { ok: false, code: "GAME_NOT_FOUND" };
    const record = await this.repo.setCatalogRole(gameId, catalogRole, adminId);
    return { ok: true, record };
  }
}
