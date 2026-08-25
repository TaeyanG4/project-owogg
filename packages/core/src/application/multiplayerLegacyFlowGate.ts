import type { MultiplayerProfileRepository } from "../modules/multiplayer/ports/multiplayerProfileRepository.js";

export type MultiplayerLegacyFlowGateResult =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly error: "MULTIPLAYER_MANAGED" | "MULTIPLAYER_AUTHORITY_UNAVAILABLE";
    };

/**
 * One authoritative boundary shared by generic session, score, and result flows. An enabled
 * exact-version profile means canonical multiplayer authority owns completion and rewards. A
 * storage/mapping failure also blocks the legacy path; it must never be interpreted as “no
 * profile” and silently reopen client-authored score/result acceptance.
 */
export class MultiplayerLegacyFlowGate {
  constructor(private readonly profiles: MultiplayerProfileRepository) {}

  async evaluate(gameId: number, gameVersionId: number): Promise<MultiplayerLegacyFlowGateResult> {
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
