/**
 * Provider-neutral boundary for server-trusted game verification.
 *
 * Implementations are platform code selected by a stable ID. A game bundle may only request an
 * already-registered ID; it can never provide executable verifier code.
 */

export type VerifiedGameOutcome = "neutral" | "success" | "failure" | "win" | "loss" | "draw";

export interface GameVerifierPlayConfig {
  readonly difficultyId: string;
  readonly variantId: string;
}

export interface GameVerifierInput {
  readonly gameId: number;
  readonly versionId: number;
  /** Stable runtime identity lets a reviewed verifier fail closed outside its intended game. */
  readonly slug: string;
  readonly challengeSeed: string;
  readonly playConfig: GameVerifierPlayConfig;
  readonly rulesetRevision: number;
  readonly issuedAtMs: number;
  readonly submittedAtMs: number;
  readonly serverElapsedMs: number;
  /** Already bounded and JSON-safe before the verifier is called. */
  readonly evidence: unknown;
}

export interface VerifiedGameFacts {
  readonly outcome?: VerifiedGameOutcome | undefined;
  readonly score: number;
  readonly progression?: { readonly value: number } | undefined;
  readonly metrics?: Readonly<Record<string, number>> | undefined;
  readonly events?: Readonly<Record<string, number>> | undefined;
}

export type GameVerifierResult =
  | {
      readonly accepted: true;
      readonly facts: VerifiedGameFacts;
      /** Server-only debugging data. It is never persisted as game evidence or exposed publicly. */
      readonly diagnostics?: Readonly<Record<string, unknown>> | undefined;
    }
  | {
      readonly accepted: false;
      readonly code: string;
    };

export interface GameVerifier {
  verify(input: GameVerifierInput): Promise<GameVerifierResult>;
}

/** Small publication/session capability surface that does not expose verifier implementations. */
export interface GameVerifierCatalog {
  has(verifierId: string): boolean;
}

export interface GameVerifierRegistry extends GameVerifierCatalog {
  resolve(verifierId: string): GameVerifier | null;
}

/** Default for compositions that have not explicitly installed a trusted verifier registry. */
export const EMPTY_GAME_VERIFIER_REGISTRY: GameVerifierRegistry = Object.freeze({
  has: () => false,
  resolve: () => null,
});
