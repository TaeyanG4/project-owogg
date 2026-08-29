import type { MultiplayerProfileRepository } from "../modules/multiplayer/ports/multiplayerProfileRepository.js";

export type SelectedTopologyAuthorityGateResult =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly error: "MULTIPLAYER_MANAGED" | "MULTIPLAYER_AUTHORITY_UNAVAILABLE";
    };

/**
 * Keeps client-authored sessions, scores, and results behind one exact-version authority
 * boundary. If a Relay profile is enabled, that topology owns the online session and generic
 * client-authored completion must stay closed. Lookup failures also fail closed.
 */
export class SelectedTopologyAuthorityGate {
  constructor(private readonly profiles: MultiplayerProfileRepository) {}

  async evaluate(
    gameId: number,
    gameVersionId: number,
  ): Promise<SelectedTopologyAuthorityGateResult> {
    try {
      const record = await this.profiles.findEnabledForExactVersion(gameId, gameVersionId);
      if (!record) return { allowed: true };
      if (
        record.profile.gameId !== gameId ||
        record.profile.gameVersionId !== gameVersionId ||
        record.profile.enabled !== true
      ) {
        return { allowed: false, error: "MULTIPLAYER_AUTHORITY_UNAVAILABLE" };
      }
      return { allowed: false, error: "MULTIPLAYER_MANAGED" };
    } catch {
      return { allowed: false, error: "MULTIPLAYER_AUTHORITY_UNAVAILABLE" };
    }
  }
}
