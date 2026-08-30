import type { GameSettingsRepository } from "../ports/repositories.js";
import type { GameIdentityRepository } from "../modules/game/ports/gameIdentityRepository.js";
import type { GameVersionRepository } from "../modules/game/ports/gameVersionRepository.js";
import type { GameIdentity } from "../modules/game/domain/gameIdentity.js";
import type { RuntimeGame } from "../modules/game/domain/runtimeGame.js";

/** Minimal cross-module port used only to keep a room's immutable version servable after a later
 * live-version switch. An absent implementation fails closed for non-live versions. */
export interface RuntimeGameVersionLeaseAvailability {
  hasActiveVersionLease(gameVersionId: number, nowIso: string): Promise<boolean>;
}

/**
 * D1-only emergency availability boundary for an exact generic asset version. It intentionally
 * has no canonical/B2 dependency, so a broken metadata object can never prevent an operator's
 * kill switch from taking effect.
 */
export class RuntimeGameAvailability {
  constructor(
    private readonly identities: GameIdentityRepository,
    private readonly versions: GameVersionRepository,
    private readonly settings: Pick<
      GameSettingsRepository,
      "getDisabledGameIds" | "getPublicCatalogExcludedGameIds"
    >,
    private readonly versionLeases?: RuntimeGameVersionLeaseAvailability,
  ) {}

  async isVersionServable(gameId: number, versionId: number): Promise<boolean> {
    if (
      !Number.isInteger(gameId) ||
      gameId <= 0 ||
      !Number.isInteger(versionId) ||
      versionId <= 0
    ) {
      return false;
    }

    const identity = await this.identities.findById(gameId);
    if (
      identity === null ||
      identity.deletedAt !== null ||
      identity.visibility !== "PUBLIC" ||
      identity.liveVersionId === null
    ) {
      return false;
    }
    const version = await this.versions.findById(versionId);
    if (version === null || version.gameId !== identity.id || version.publishStatus !== "READY") {
      return false;
    }
    const disabledSlugs = await this.settings.getDisabledGameIds();
    if (disabledSlugs.includes(identity.slug)) return false;
    if (identity.liveVersionId === versionId) return true;
    return (
      (await this.versionLeases?.hasActiveVersionLease(versionId, new Date().toISOString())) ??
      false
    );
  }

  /** Checks a D1 identity that the caller already resolved, avoiding a duplicate identity query.
   * Used by public media and live-version resolver paths that intentionally do not need the B2
   * canonical document merely to authorize an immutable public object. */
  async isIdentityServable(identity: GameIdentity): Promise<boolean> {
    if (
      identity.deletedAt !== null ||
      identity.visibility !== "PUBLIC" ||
      identity.liveVersionId === null
    ) {
      return false;
    }

    const version = await this.versions.findById(identity.liveVersionId);
    if (version === null || version.gameId !== identity.id || version.publishStatus !== "READY") {
      return false;
    }

    const excludedSlugs = await this.settings.getPublicCatalogExcludedGameIds();
    return !excludedSlugs.includes(identity.slug);
  }

  /** A registry result already contains the exact validated identity/live READY version. Public
   * catalog reads only need one fresh exclusion query for the whole set, rather than repeating
   * identity + version + setting reads once per game. */
  async filterResolvedRuntimes(runtimes: readonly RuntimeGame[]): Promise<readonly RuntimeGame[]> {
    const excludedSlugs = new Set(await this.settings.getPublicCatalogExcludedGameIds());
    return runtimes.filter(
      (runtime) =>
        runtime.identity.deletedAt === null &&
        runtime.identity.visibility === "PUBLIC" &&
        runtime.identity.liveVersionId === runtime.liveVersion.id &&
        runtime.liveVersion.gameId === runtime.identity.id &&
        runtime.liveVersion.publishStatus === "READY" &&
        !excludedSlugs.has(runtime.identity.slug),
    );
  }
}
