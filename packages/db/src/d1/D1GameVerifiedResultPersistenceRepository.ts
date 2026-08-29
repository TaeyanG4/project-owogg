import type {
  GameVerifiedResultPersistenceRepository,
  NormalizedGameCreatorResult,
  PersistedVerifiedGameResult,
} from "@owogg/core";
import type { D1Database, D1Result } from "./D1UserRepository.js";

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function changed(result: D1Result<Record<string, unknown>> | undefined): boolean {
  return (
    (result?.meta?.changes ?? 0) > 0 ||
    (result?.results?.length ?? 0) > 0 ||
    (result?.meta?.rows_written ?? 0) > 0
  );
}

function parseFactMap(value: unknown): Readonly<Record<string, number>> | null {
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const normalized: Record<string, number> = {};
    for (const [key, candidate] of Object.entries(parsed)) {
      if (typeof candidate !== "number" || !Number.isFinite(candidate)) return null;
      normalized[key] = Object.is(candidate, -0) ? 0 : candidate;
    }
    return normalized;
  } catch {
    return null;
  }
}

/** D1 implementation of the all-or-nothing gs2 result/score/claim transaction. */
export class D1GameVerifiedResultPersistenceRepository implements GameVerifiedResultPersistenceRepository {
  constructor(private readonly db: D1Database) {}

  async acceptVerifiedResult(
    input: Parameters<GameVerifiedResultPersistenceRepository["acceptVerifiedResult"]>[0],
  ): Promise<{ accepted: boolean; resultId: number | null; scoreId: number | null }> {
    const results = (await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO game_attempt_consumptions (
             attempt_id, user_id, game_id, version_id, consumed_at
           )
           SELECT ?, ?, ?, ?, ?
           FROM games game
           JOIN game_versions version
             ON version.id = ? AND version.game_id = game.id
           WHERE game.id = ?
             AND game.slug = ?
             AND game.live_version_id = ?
             AND game.visibility = 'PUBLIC'
             AND game.deleted_at IS NULL
             AND version.publish_status = 'READY'
             AND NOT EXISTS (
               SELECT 1
               FROM game_settings setting
               WHERE setting.game_id = game.slug AND setting.enabled = 0
             )
             AND EXISTS (
             SELECT 1
             FROM game_result_verification_claims claim
             WHERE claim.attempt_id = ?
               AND claim.user_id = ?
               AND claim.game_id = ?
               AND claim.version_id = ?
               AND claim.evidence_hash = ?
               AND claim.status = 'PROCESSING'
           )
           ON CONFLICT(attempt_id) DO NOTHING`,
        )
        .bind(
          input.attemptId,
          input.userId,
          input.gameId,
          input.versionId,
          input.nowIso,
          input.versionId,
          input.gameId,
          input.slug,
          input.versionId,
          input.attemptId,
          input.userId,
          input.gameId,
          input.versionId,
          input.evidenceHash,
        ),
      this.db
        .prepare(
          `INSERT INTO game_results (
             attempt_id, user_id, game_id, version_id, outcome, raw_score, normalized_score,
             progression_value, metrics_json, events_json, difficulty, adjusted,
             adjustment_reason, reward_eligible, created_at, competitive_score, variant_id,
             ruleset_revision, verifier_id, evidence_hash
           )
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 1, ?, ?, ?, ?, ?, ?
           WHERE changes() = 1
           RETURNING id`,
        )
        .bind(
          input.attemptId,
          input.userId,
          input.gameId,
          input.versionId,
          input.normalized.outcome,
          input.normalized.rawScore,
          input.normalized.normalizedScore,
          input.normalized.progressionValue,
          JSON.stringify(input.normalized.metrics),
          JSON.stringify(input.normalized.events),
          input.difficultyId,
          input.nowIso,
          input.competitiveScore,
          input.variantId,
          input.rulesetRevision,
          input.verifierId,
          input.evidenceHash,
        ),
      this.db
        .prepare(
          `INSERT INTO scores (
             user_id, nickname, avatar_url, game_id, score, difficulty, created_at, result_id,
             leaderboard_generation, variant_id, ruleset_revision
           )
           SELECT ?, ?, ?, ?, gr.competitive_score, ?, ?, gr.id, g.leaderboard_generation, ?, ?
           FROM game_results gr
           JOIN games g ON g.id = gr.game_id AND g.live_version_id = gr.version_id
           WHERE gr.attempt_id = ?
             AND gr.user_id = ?
             AND gr.game_id = ?
             AND gr.version_id = ?
             AND gr.evidence_hash = ?
             AND gr.verifier_id = ?
             AND gr.variant_id = ?
             AND gr.ruleset_revision = ?
             AND g.deleted_at IS NULL
             AND ? = 1
           ON CONFLICT(result_id) WHERE result_id IS NOT NULL DO NOTHING
           RETURNING id`,
        )
        .bind(
          input.userId,
          input.nickname || "플레이어",
          input.avatarUrl,
          input.slug,
          input.difficultyId,
          input.nowIso,
          input.variantId,
          input.rulesetRevision,
          input.attemptId,
          input.userId,
          input.gameId,
          input.versionId,
          input.evidenceHash,
          input.verifierId,
          input.variantId,
          input.rulesetRevision,
          input.leaderboardEnabled ? 1 : 0,
        ),
      this.db
        .prepare(
          `UPDATE game_result_verification_claims
           SET status = 'VERIFIED',
               result_id = (
                 SELECT result.id
                 FROM game_results result
                 WHERE result.attempt_id = game_result_verification_claims.attempt_id
                   AND result.user_id = game_result_verification_claims.user_id
                   AND result.game_id = game_result_verification_claims.game_id
                   AND result.version_id = game_result_verification_claims.version_id
                   AND result.evidence_hash = game_result_verification_claims.evidence_hash
                   AND result.verifier_id = ?
                   AND result.variant_id = ?
                   AND result.ruleset_revision = ?
               ),
               score_id = (
                 SELECT score.id
                 FROM scores score
                 JOIN game_results result ON result.id = score.result_id
                 WHERE result.attempt_id = game_result_verification_claims.attempt_id
               ),
               updated_at = ?
           WHERE attempt_id = ?
             AND user_id = ?
             AND game_id = ?
             AND version_id = ?
             AND evidence_hash = ?
             AND status = 'PROCESSING'
             AND EXISTS (
               SELECT 1
               FROM game_results result
               WHERE result.attempt_id = game_result_verification_claims.attempt_id
                 AND result.user_id = game_result_verification_claims.user_id
                 AND result.game_id = game_result_verification_claims.game_id
                 AND result.version_id = game_result_verification_claims.version_id
                 AND result.evidence_hash = game_result_verification_claims.evidence_hash
                 AND result.verifier_id = ?
                 AND result.variant_id = ?
                 AND result.ruleset_revision = ?
             )
           RETURNING result_id, score_id`,
        )
        .bind(
          input.verifierId,
          input.variantId,
          input.rulesetRevision,
          input.nowIso,
          input.attemptId,
          input.userId,
          input.gameId,
          input.versionId,
          input.evidenceHash,
          input.verifierId,
          input.variantId,
          input.rulesetRevision,
        ),
    ])) as Array<D1Result<Record<string, unknown>>>;

    const finalization = results[3];
    if (!changed(finalization)) {
      return { accepted: false, resultId: null, scoreId: null };
    }
    const row = finalization?.results?.[0];
    const resultId = positiveInteger(row?.result_id);
    const scoreId = row?.score_id == null ? null : positiveInteger(row.score_id);
    if (resultId === null || (row?.score_id != null && scoreId === null)) {
      return { accepted: false, resultId: null, scoreId: null };
    }
    return { accepted: true, resultId, scoreId };
  }

  async findVerifiedResult(
    input: Parameters<GameVerifiedResultPersistenceRepository["findVerifiedResult"]>[0],
  ): Promise<PersistedVerifiedGameResult | null> {
    const row = await this.db
      .prepare(
        `SELECT result.id, result.outcome, result.raw_score, result.normalized_score,
                result.progression_value, result.metrics_json, result.events_json,
                result.difficulty, result.adjusted, result.adjustment_reason,
                result.reward_eligible, result.competitive_score, result.variant_id,
                result.ruleset_revision, result.verifier_id, claim.score_id
         FROM game_results result
         JOIN game_result_verification_claims claim
           ON claim.result_id = result.id AND claim.status = 'VERIFIED'
         WHERE result.id = ?
           AND result.user_id = ?
           AND result.game_id = ?
           AND result.version_id = ?`,
      )
      .bind(input.resultId, input.userId, input.gameId, input.versionId)
      .first<Record<string, unknown>>();
    if (!row) return null;

    const resultId = positiveInteger(row.id);
    const scoreId = row.score_id == null ? null : positiveInteger(row.score_id);
    const rawScore = Number(row.raw_score);
    const normalizedScore = Number(row.normalized_score);
    const competitiveScore = Number(row.competitive_score);
    const rulesetRevision = positiveInteger(row.ruleset_revision);
    const metrics = parseFactMap(row.metrics_json);
    const events = parseFactMap(row.events_json);
    if (
      resultId === null ||
      (row.score_id != null && scoreId === null) ||
      !Number.isFinite(rawScore) ||
      !Number.isFinite(normalizedScore) ||
      !Number.isFinite(competitiveScore) ||
      rulesetRevision === null ||
      metrics === null ||
      events === null ||
      typeof row.difficulty !== "string" ||
      typeof row.variant_id !== "string" ||
      typeof row.verifier_id !== "string"
    ) {
      return null;
    }

    const progressionValue = row.progression_value == null ? null : Number(row.progression_value);
    if (progressionValue !== null && !Number.isFinite(progressionValue)) return null;
    const normalized: NormalizedGameCreatorResult = {
      outcome: row.outcome == null ? null : String(row.outcome),
      rawScore,
      normalizedScore,
      progressionValue,
      metrics,
      events,
      adjusted: Boolean(Number(row.adjusted)),
      adjustmentReason: row.adjustment_reason == null ? null : String(row.adjustment_reason),
      rewardEligible: Boolean(Number(row.reward_eligible)),
    };
    if (normalized.adjusted || !normalized.rewardEligible) return null;

    return {
      resultId,
      scoreId,
      normalized,
      competitiveScore,
      difficultyId: row.difficulty,
      variantId: row.variant_id,
      rulesetRevision,
      verifierId: row.verifier_id,
    };
  }
}
