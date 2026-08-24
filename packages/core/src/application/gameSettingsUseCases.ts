import type { GameSettingsRepository, GameSettingRecord } from "../ports/repositories.js";
import type { GameCanonicalRepository } from "../modules/game/ports/gameCanonicalRepository.js";
import type { GameIdentityRepository } from "../modules/game/ports/gameIdentityRepository.js";

export interface GameAvailability {
  gameId: string;
  title: string;
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
  ) {}

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
