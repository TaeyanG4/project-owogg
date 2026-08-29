/** Identity and first-evidence hash bound to one signed gs2 attempt. Raw evidence is never stored. */
export interface GameResultVerificationClaimKey {
  readonly attemptId: string;
  readonly userId: number;
  readonly gameId: number;
  readonly versionId: number;
  readonly evidenceHash: string;
}

export type BeginGameResultVerificationClaimResult =
  | { readonly status: "ACQUIRED" }
  | { readonly status: "PROCESSING" }
  | {
      readonly status: "VERIFIED";
      readonly resultId: number;
      readonly scoreId: number | null;
    }
  | { readonly status: "REJECTED"; readonly rejectionCode: string }
  | {
      readonly status: "CONFLICT";
      readonly reason: "ATTEMPT_CONTEXT_MISMATCH" | "EVIDENCE_MISMATCH";
    };

/** Atomic first-evidence state machine. Only PROCESSING may transition to a terminal state. */
export interface GameResultVerificationClaimRepository {
  begin(
    input: GameResultVerificationClaimKey & { readonly nowIso: string },
  ): Promise<BeginGameResultVerificationClaimResult>;

  finalizeRejected(
    input: GameResultVerificationClaimKey & {
      readonly rejectionCode: string;
      readonly nowIso: string;
    },
  ): Promise<boolean>;
}
