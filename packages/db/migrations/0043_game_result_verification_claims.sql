-- Migration: 0043_game_result_verification_claims.sql
-- First-evidence claim for verifier-backed gs2 attempts. The table stores only a canonical SHA-256
-- hash, never raw evidence. A rare Worker failure may leave PROCESSING; the MVP deliberately has no
-- queue, cron, recovery worker, or evidence replacement path.

CREATE TABLE game_result_verification_claims (
  attempt_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  version_id INTEGER NOT NULL REFERENCES game_versions(id) ON DELETE CASCADE,
  evidence_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PROCESSING', 'VERIFIED', 'REJECTED')),
  rejection_code TEXT,
  result_id INTEGER UNIQUE REFERENCES game_results(id) ON DELETE CASCADE,
  score_id INTEGER UNIQUE REFERENCES scores(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(attempt_id) > 0 AND attempt_id = trim(attempt_id)),
  CHECK (
    length(evidence_hash) = 64
    AND evidence_hash = lower(evidence_hash)
    AND evidence_hash NOT GLOB '*[^0-9a-f]*'
  ),
  CHECK (
    rejection_code IS NULL
    OR (
      length(rejection_code) BETWEEN 1 AND 96
      AND rejection_code = trim(rejection_code)
    )
  ),
  CHECK (length(created_at) > 0 AND length(updated_at) > 0 AND updated_at >= created_at),
  CHECK (
    (
      status = 'PROCESSING'
      AND rejection_code IS NULL
      AND result_id IS NULL
      AND score_id IS NULL
    )
    OR (
      status = 'VERIFIED'
      AND rejection_code IS NULL
      AND result_id IS NOT NULL
    )
    OR (
      status = 'REJECTED'
      AND rejection_code IS NOT NULL
      AND result_id IS NULL
      AND score_id IS NULL
    )
  )
);

CREATE INDEX idx_game_result_verification_claims_user_created
  ON game_result_verification_claims(user_id, created_at DESC);
CREATE INDEX idx_game_result_verification_claims_game_created
  ON game_result_verification_claims(game_id, created_at DESC);

CREATE TRIGGER trg_game_result_verification_claims_validate_insert
BEFORE INSERT ON game_result_verification_claims
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Verification claim version must belong to its game')
  WHERE NOT EXISTS (
    SELECT 1
    FROM game_versions version
    WHERE version.id = NEW.version_id
      AND version.game_id = NEW.game_id
  );
END;

CREATE TRIGGER trg_game_result_verification_claims_terminal_transition
BEFORE UPDATE ON game_result_verification_claims
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Verification claim identity is immutable')
  WHERE OLD.attempt_id IS NOT NEW.attempt_id
    OR OLD.user_id IS NOT NEW.user_id
    OR OLD.game_id IS NOT NEW.game_id
    OR OLD.version_id IS NOT NEW.version_id
    OR OLD.evidence_hash IS NOT NEW.evidence_hash
    OR OLD.created_at IS NOT NEW.created_at;

  SELECT RAISE(ABORT, 'Verification claim may finalize exactly once')
  WHERE OLD.status <> 'PROCESSING'
    OR NEW.status NOT IN ('VERIFIED', 'REJECTED');

  SELECT RAISE(ABORT, 'Verified result must match the claimed attempt context')
  WHERE NEW.status = 'VERIFIED'
    AND NOT EXISTS (
      SELECT 1
      FROM game_results result
      WHERE result.id = NEW.result_id
        AND result.attempt_id = NEW.attempt_id
        AND result.user_id = NEW.user_id
        AND result.game_id = NEW.game_id
        AND result.version_id = NEW.version_id
    );

  SELECT RAISE(ABORT, 'Verified score must project the claimed result and user')
  WHERE NEW.status = 'VERIFIED'
    AND NEW.score_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM scores score
      WHERE score.id = NEW.score_id
        AND score.result_id = NEW.result_id
        AND score.user_id = NEW.user_id
    );
END;
