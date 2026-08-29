import type {
  BeginGameResultVerificationClaimResult,
  GameResultVerificationClaimKey,
  GameResultVerificationClaimRepository,
} from "@owogg/core";
import type { D1Database } from "./D1UserRepository.js";

interface ClaimRow {
  readonly user_id: number;
  readonly game_id: number;
  readonly version_id: number;
  readonly evidence_hash: string;
  readonly status: string;
  readonly rejection_code: string | null;
  readonly result_id: number | null;
  readonly score_id: number | null;
}

function changed(result: { meta?: { changes?: number; rows_written?: number } }): boolean {
  return (result.meta?.changes ?? result.meta?.rows_written ?? 0) > 0;
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/** D1 implementation of the immutable first-evidence claim state machine from migration 0043. */
export class D1GameResultVerificationClaimRepository implements GameResultVerificationClaimRepository {
  constructor(private readonly db: D1Database) {}

  async begin(
    input: GameResultVerificationClaimKey & { readonly nowIso: string },
  ): Promise<BeginGameResultVerificationClaimResult> {
    const inserted = await this.db
      .prepare(
        `INSERT INTO game_result_verification_claims (
           attempt_id, user_id, game_id, version_id, evidence_hash, status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'PROCESSING', ?, ?)
         ON CONFLICT(attempt_id) DO NOTHING`,
      )
      .bind(
        input.attemptId,
        input.userId,
        input.gameId,
        input.versionId,
        input.evidenceHash,
        input.nowIso,
        input.nowIso,
      )
      .run();
    if (changed(inserted)) return { status: "ACQUIRED" };

    const row = await this.db
      .prepare(
        `SELECT user_id, game_id, version_id, evidence_hash, status, rejection_code, result_id,
                score_id
         FROM game_result_verification_claims
         WHERE attempt_id = ?`,
      )
      .bind(input.attemptId)
      .first<ClaimRow>();
    if (!row) throw new Error("Verification claim conflict row disappeared");

    if (
      Number(row.user_id) !== input.userId ||
      Number(row.game_id) !== input.gameId ||
      Number(row.version_id) !== input.versionId
    ) {
      return { status: "CONFLICT", reason: "ATTEMPT_CONTEXT_MISMATCH" };
    }
    if (row.evidence_hash !== input.evidenceHash) {
      return { status: "CONFLICT", reason: "EVIDENCE_MISMATCH" };
    }
    if (row.status === "PROCESSING") return { status: "PROCESSING" };
    if (row.status === "REJECTED" && row.rejection_code) {
      return { status: "REJECTED", rejectionCode: row.rejection_code };
    }
    if (row.status === "VERIFIED") {
      const resultId = positiveInteger(row.result_id);
      const scoreId = row.score_id === null ? null : positiveInteger(row.score_id);
      if (resultId !== null && (row.score_id === null || scoreId !== null)) {
        return { status: "VERIFIED", resultId, scoreId };
      }
    }
    throw new Error("Invalid verification claim row");
  }

  async finalizeRejected(
    input: GameResultVerificationClaimKey & {
      readonly rejectionCode: string;
      readonly nowIso: string;
    },
  ): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE game_result_verification_claims
         SET status = 'REJECTED', rejection_code = ?, updated_at = ?
         WHERE attempt_id = ?
           AND user_id = ?
           AND game_id = ?
           AND version_id = ?
           AND evidence_hash = ?
           AND status = 'PROCESSING'`,
      )
      .bind(
        input.rejectionCode,
        input.nowIso,
        input.attemptId,
        input.userId,
        input.gameId,
        input.versionId,
        input.evidenceHash,
      )
      .run();
    return changed(result);
  }
}
