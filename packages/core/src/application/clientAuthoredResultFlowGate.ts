import type { GameCanonicalDocument } from "../modules/game/domain/gameCanonicalDocument.js";

export type ClientAuthoredResultFlowGateResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly error: "PLAY_CONFIG_AUTHORITY_UNAVAILABLE" };

/**
 * PlayConfig declares that competitive results require a trusted server verifier. The existing
 * gs1 score/result path accepts iframe-authored facts, so it must never be used as a fallback for
 * a canonical document carrying PlayConfig. The verified gs2 path will branch before this gate.
 */
export function evaluateClientAuthoredResultFlow(
  canonical: Pick<GameCanonicalDocument, "playConfig">,
): ClientAuthoredResultFlowGateResult {
  return canonical.playConfig === undefined
    ? { allowed: true }
    : { allowed: false, error: "PLAY_CONFIG_AUTHORITY_UNAVAILABLE" };
}
