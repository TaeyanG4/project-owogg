-- Migration: 0042_multiplayer_rematch.sql
-- Two-party, server-authoritative rematch consent for committed multiplayer matches.
--
-- A request is an append-only fact tied to one exact instance generation. Only two authenticated
-- active participants can advance CLOSING -> LOBBY, and the existing foundation trigger resets
-- both READY states before the next match. The exact-version lease follows that generation so a
-- new ticket cannot be issued against stale serving authority.

CREATE TABLE multiplayer_rematch_requests (
  instance_id TEXT NOT NULL REFERENCES multiplayer_instances(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL,
  participant_id TEXT NOT NULL REFERENCES multiplayer_participants(id) ON DELETE RESTRICT,
  requested_at TEXT NOT NULL,
  PRIMARY KEY (instance_id, generation, participant_id),
  CHECK (generation > 0),
  CHECK (length(requested_at) > 0)
);

CREATE INDEX idx_multiplayer_rematch_requests_instance
  ON multiplayer_rematch_requests(instance_id, generation, requested_at);

CREATE TRIGGER trg_multiplayer_rematch_requests_validate_insert
BEFORE INSERT ON multiplayer_rematch_requests
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Rematch requires an exact active participant and committed generation')
  WHERE NOT EXISTS (
    SELECT 1
    FROM multiplayer_instances instance
    JOIN multiplayer_participants participant
      ON participant.instance_id = instance.id
    JOIN multiplayer_matches match
      ON match.instance_id = instance.id
     AND match.generation = instance.generation
    WHERE instance.id = NEW.instance_id
      AND instance.generation = NEW.generation
      AND instance.status = 'CLOSING'
      AND instance.expires_at > NEW.requested_at
      AND participant.id = NEW.participant_id
      AND participant.status = 'READY'
      AND match.status = 'COMMITTED'
      AND match.committed_at IS NOT NULL
      AND unixepoch(NEW.requested_at) < unixepoch(match.committed_at) + 120
  );
END;

CREATE TRIGGER trg_multiplayer_rematch_requests_append_only_update
BEFORE UPDATE ON multiplayer_rematch_requests
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Multiplayer rematch consent is append-only');
END;

-- Foundation made a lease generation fully immutable before the rematch path was connected.
-- Preserve every other identity field while allowing exactly the instance's audited +1 rematch.
DROP TRIGGER trg_game_version_leases_immutable_identity;

CREATE TRIGGER trg_game_version_leases_immutable_identity
BEFORE UPDATE OF
  game_version_id,
  instance_id,
  generation,
  acquired_at,
  expires_at
ON game_version_leases
FOR EACH ROW
WHEN OLD.game_version_id IS NOT NEW.game_version_id
  OR OLD.instance_id IS NOT NEW.instance_id
  OR OLD.acquired_at IS NOT NEW.acquired_at
  OR OLD.expires_at IS NOT NEW.expires_at
  OR (
    OLD.generation IS NOT NEW.generation
    AND NOT (
      NEW.generation = OLD.generation + 1
      AND EXISTS (
        SELECT 1
        FROM multiplayer_instances instance
        WHERE instance.id = OLD.instance_id
          AND instance.generation = NEW.generation
          AND instance.status = 'LOBBY'
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'Game version lease identity is immutable outside rematch');
END;

CREATE TRIGGER trg_multiplayer_instances_advance_lease_on_rematch
AFTER UPDATE OF status, generation ON multiplayer_instances
FOR EACH ROW
WHEN OLD.status = 'CLOSING'
  AND NEW.status = 'LOBBY'
  AND NEW.generation = OLD.generation + 1
BEGIN
  UPDATE game_version_leases
  SET generation = NEW.generation,
      updated_at = NEW.updated_at
  WHERE instance_id = NEW.id
    AND status = 'ACTIVE'
    AND generation = OLD.generation;

  UPDATE multiplayer_invites
  SET revoked_at = COALESCE(revoked_at, NEW.updated_at),
      updated_at = NEW.updated_at
  WHERE instance_id = NEW.id
    AND generation = OLD.generation
    AND revoked_at IS NULL;
END;
