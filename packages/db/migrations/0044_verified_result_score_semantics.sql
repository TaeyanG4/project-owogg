-- Migration: 0044_verified_result_score_semantics.sql
-- Additive gs2 score semantics. Historical rows remain readable as standard/revision 1 and keep
-- competitive_score NULL; no old migration is rewritten.

ALTER TABLE game_results ADD COLUMN competitive_score REAL;
ALTER TABLE game_results ADD COLUMN variant_id TEXT NOT NULL DEFAULT 'standard'
  CHECK (length(variant_id) BETWEEN 1 AND 100 AND variant_id = trim(variant_id));
ALTER TABLE game_results ADD COLUMN ruleset_revision INTEGER NOT NULL DEFAULT 1
  CHECK (ruleset_revision > 0);
ALTER TABLE game_results ADD COLUMN verifier_id TEXT
  CHECK (
    verifier_id IS NULL
    OR (
      length(verifier_id) BETWEEN 1 AND 96
      AND verifier_id = trim(verifier_id)
      AND verifier_id NOT GLOB '*[^A-Za-z0-9._:-]*'
    )
  );
ALTER TABLE game_results ADD COLUMN evidence_hash TEXT
  CHECK (
    evidence_hash IS NULL
    OR (
      length(evidence_hash) = 64
      AND evidence_hash = lower(evidence_hash)
      AND evidence_hash NOT GLOB '*[^0-9a-f]*'
    )
  );

ALTER TABLE scores ADD COLUMN variant_id TEXT NOT NULL DEFAULT 'standard'
  CHECK (length(variant_id) BETWEEN 1 AND 100 AND variant_id = trim(variant_id));
ALTER TABLE scores ADD COLUMN ruleset_revision INTEGER NOT NULL DEFAULT 1
  CHECK (ruleset_revision > 0);

CREATE INDEX idx_scores_game_generation_difficulty_revision_score
  ON scores(game_id, leaderboard_generation, difficulty, ruleset_revision, score);

-- A result is either historical/client-authored (all three server-verification facts are NULL)
-- or fully verifier-backed. Partial rows would make score provenance ambiguous and are rejected.
CREATE TRIGGER trg_game_results_verified_context_insert
BEFORE INSERT ON game_results
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Verified result context must be complete')
  WHERE NOT (
    (
      NEW.competitive_score IS NULL
      AND NEW.verifier_id IS NULL
      AND NEW.evidence_hash IS NULL
    )
    OR (
      NEW.competitive_score IS NOT NULL
      AND NEW.verifier_id IS NOT NULL
      AND NEW.evidence_hash IS NOT NULL
      AND NEW.raw_score IS NOT NULL
      AND NEW.normalized_score IS NOT NULL
      AND NEW.adjusted = 0
      AND NEW.adjustment_reason IS NULL
      AND NEW.reward_eligible = 1
    )
  );
END;

CREATE TRIGGER trg_game_results_verified_context_update
BEFORE UPDATE OF competitive_score, verifier_id, evidence_hash, raw_score, normalized_score,
  adjusted, adjustment_reason, reward_eligible ON game_results
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Verified result context must be complete')
  WHERE NOT (
    (
      NEW.competitive_score IS NULL
      AND NEW.verifier_id IS NULL
      AND NEW.evidence_hash IS NULL
    )
    OR (
      NEW.competitive_score IS NOT NULL
      AND NEW.verifier_id IS NOT NULL
      AND NEW.evidence_hash IS NOT NULL
      AND NEW.raw_score IS NOT NULL
      AND NEW.normalized_score IS NOT NULL
      AND NEW.adjusted = 0
      AND NEW.adjustment_reason IS NULL
      AND NEW.reward_eligible = 1
    )
  );
END;
