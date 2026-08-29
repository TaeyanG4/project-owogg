import type { GameVerifier, GameVerifierRegistry } from "@owogg/core";
import { VERIFIED_AIM_TEST_VERIFIER_ID, verifiedAimTestV1 } from "./verifiers/VerifiedAimTestV1.js";

const VERIFIER_ID_PATTERN = /^[a-z0-9][a-z0-9._:/-]{0,95}$/;

/**
 * Trusted, statically-constructed registry. Its entries are API source imports, never rows, bundle
 * files, remote modules, environment-selected code, or runtime evaluation.
 */
export class StaticGameVerifierRegistry implements GameVerifierRegistry {
  readonly #verifiers: ReadonlyMap<string, GameVerifier>;

  constructor(entries: readonly (readonly [verifierId: string, verifier: GameVerifier])[]) {
    const verifiers = new Map<string, GameVerifier>();
    for (const [verifierId, verifier] of entries) {
      if (!VERIFIER_ID_PATTERN.test(verifierId)) {
        throw new TypeError(`Invalid trusted verifier ID: ${verifierId}`);
      }
      if (verifiers.has(verifierId)) {
        throw new TypeError(`Duplicate trusted verifier ID: ${verifierId}`);
      }
      verifiers.set(verifierId, verifier);
    }
    this.#verifiers = verifiers;
  }

  has(verifierId: string): boolean {
    return this.#verifiers.has(verifierId);
  }

  resolve(verifierId: string): GameVerifier | null {
    return this.#verifiers.get(verifierId) ?? null;
  }
}

/** Reviewed implementations only. Game bundles can request these IDs but never provide code. */
export function createTrustedGameVerifierRegistry(): GameVerifierRegistry {
  return new StaticGameVerifierRegistry([[VERIFIED_AIM_TEST_VERIFIER_ID, verifiedAimTestV1]]);
}
