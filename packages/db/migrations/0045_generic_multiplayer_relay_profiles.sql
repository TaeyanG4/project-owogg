-- Migration: 0045_generic_multiplayer_relay_profiles.sql
-- Cut managed multiplayer authority from game-specific rulesets to an exact-version Relay profile.

ALTER TABLE multiplayer_profile_requests ADD COLUMN content_hash TEXT;

UPDATE multiplayer_profile_requests
SET content_hash = (
  SELECT version.content_hash FROM game_versions version
  WHERE version.id = multiplayer_profile_requests.game_version_id
    AND version.game_id = multiplayer_profile_requests.game_id
);

CREATE TRIGGER trg_multiplayer_profile_requests_content_hash_insert
BEFORE INSERT ON multiplayer_profile_requests
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Multiplayer request requires the exact version content hash')
  WHERE NEW.content_hash IS NULL
     OR length(NEW.content_hash) <> 64
     OR NEW.content_hash GLOB '*[^0-9a-f]*'
     OR NOT EXISTS (
       SELECT 1 FROM game_versions version
       WHERE version.id = NEW.game_version_id
         AND version.game_id = NEW.game_id
         AND version.content_hash = NEW.content_hash
     );
END;

CREATE TRIGGER trg_multiplayer_profile_requests_content_hash_immutable
BEFORE UPDATE OF content_hash ON multiplayer_profile_requests
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Multiplayer request content hash is immutable');
END;

ALTER TABLE multiplayer_profiles ADD COLUMN profile_kind TEXT NOT NULL DEFAULT 'LEGACY_RULESET';
ALTER TABLE multiplayer_profiles ADD COLUMN content_hash TEXT;
ALTER TABLE multiplayer_profiles ADD COLUMN transport_kind TEXT;
ALTER TABLE multiplayer_profiles ADD COLUMN runtime_kind TEXT;
ALTER TABLE multiplayer_profiles ADD COLUMN direct_messages INTEGER;
ALTER TABLE multiplayer_profiles ADD COLUMN host_snapshot INTEGER;
ALTER TABLE multiplayer_profiles ADD COLUMN host_departure_policy TEXT;
ALTER TABLE multiplayer_profiles ADD COLUMN result_trust TEXT;
ALTER TABLE multiplayer_profiles ADD COLUMN max_message_bytes INTEGER;
ALTER TABLE multiplayer_profiles ADD COLUMN max_snapshot_bytes INTEGER;
ALTER TABLE multiplayer_profiles ADD COLUMN messages_per_second INTEGER;
ALTER TABLE multiplayer_profiles ADD COLUMN room_bytes_per_second INTEGER;
ALTER TABLE multiplayer_profiles ADD COLUMN room_ttl_seconds INTEGER;

UPDATE multiplayer_profiles
SET content_hash = (
      SELECT version.content_hash FROM game_versions version
      WHERE version.id = multiplayer_profiles.game_version_id
        AND version.game_id = multiplayer_profiles.game_id
    ),
    enabled = 0
WHERE profile_kind = 'LEGACY_RULESET';

CREATE INDEX idx_multiplayer_profiles_relay_version
  ON multiplayer_profiles(profile_kind, game_id, game_version_id, profile_revision DESC);

CREATE TRIGGER trg_multiplayer_profiles_relay_insert_only
BEFORE INSERT ON multiplayer_profiles
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Only generic Relay profiles may be created')
  WHERE NEW.profile_kind <> 'RELAY';

  SELECT RAISE(ABORT, 'Relay profile requires an approved exact-version request and content hash')
  WHERE NEW.source_request_id IS NULL
     OR NEW.source_request_hash IS NULL
     OR NEW.content_hash IS NULL
     OR length(NEW.content_hash) <> 64
     OR NEW.content_hash GLOB '*[^0-9a-f]*'
     OR NOT EXISTS (
       SELECT 1
       FROM multiplayer_profile_requests request
       JOIN game_versions version
         ON version.id = request.game_version_id
        AND version.game_id = request.game_id
       WHERE request.id = NEW.source_request_id
         AND request.game_id = NEW.game_id
         AND request.game_version_id = NEW.game_version_id
         AND request.request_hash = NEW.source_request_hash
         AND request.content_hash = NEW.content_hash
         AND version.content_hash = NEW.content_hash
         AND request.status = 'APPROVED'
     );

  SELECT RAISE(ABORT, 'Invalid generic Relay profile policy')
  WHERE NEW.transport_kind <> 'websocket'
     OR NEW.runtime_kind <> 'relay'
     OR NEW.protocol_version <> 1
     OR NEW.lifecycle <> 'match'
     OR NEW.reconnect_policy NOT IN ('none', 'resume')
     OR NEW.direct_messages NOT IN (0, 1)
     OR NEW.host_snapshot NOT IN (0, 1)
     OR NEW.host_departure_policy <> 'close'
     OR NEW.result_trust <> 'UNVERIFIED'
     OR NEW.max_message_bytes NOT BETWEEN 1 AND 4096
     OR NEW.max_snapshot_bytes NOT BETWEEN 0 AND 16384
     OR (NEW.host_snapshot = 0 AND NEW.max_snapshot_bytes <> 0)
     OR (NEW.host_snapshot = 1 AND NEW.max_snapshot_bytes = 0)
     OR NEW.messages_per_second NOT BETWEEN 1 AND 20
     OR NEW.room_bytes_per_second NOT BETWEEN 1 AND 262144
     OR NEW.room_ttl_seconds NOT BETWEEN 1 AND 7200
     OR NEW.allowed_visibility_json <> '["PRIVATE"]'
     OR NEW.allowed_join_policies_json <> '["OPEN"]'
     OR NEW.enabled <> 0;
END;

CREATE TRIGGER trg_multiplayer_profiles_relay_semantics_immutable
BEFORE UPDATE OF
  profile_kind,
  content_hash,
  transport_kind,
  runtime_kind,
  direct_messages,
  host_snapshot,
  host_departure_policy,
  result_trust,
  max_message_bytes,
  max_snapshot_bytes,
  messages_per_second,
  room_bytes_per_second,
  room_ttl_seconds
ON multiplayer_profiles
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Relay profile semantics are immutable; create a new revision');
END;

CREATE TRIGGER trg_multiplayer_profiles_relay_enable_only
BEFORE UPDATE OF enabled ON multiplayer_profiles
FOR EACH ROW
WHEN OLD.enabled = 0 AND NEW.enabled = 1
BEGIN
  SELECT RAISE(ABORT, 'Only an approved exact-version Relay profile can be enabled')
  WHERE NEW.profile_kind <> 'RELAY'
     OR NOT EXISTS (
       SELECT 1
       FROM multiplayer_profile_requests request
       JOIN game_versions version
         ON version.id = request.game_version_id
        AND version.game_id = request.game_id
       WHERE request.id = NEW.source_request_id
         AND request.game_id = NEW.game_id
         AND request.game_version_id = NEW.game_version_id
         AND request.request_hash = NEW.source_request_hash
         AND request.content_hash = NEW.content_hash
         AND version.content_hash = NEW.content_hash
         AND request.status = 'APPROVED'
     );
END;

ALTER TABLE multiplayer_instances ADD COLUMN content_hash TEXT;

UPDATE multiplayer_instances
SET content_hash = (
  SELECT version.content_hash FROM game_versions version
  WHERE version.id = multiplayer_instances.game_version_id
    AND version.game_id = multiplayer_instances.game_id
);

CREATE TRIGGER trg_multiplayer_instances_relay_content_insert
BEFORE INSERT ON multiplayer_instances
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Multiplayer instance requires the exact Relay content hash')
  WHERE NEW.content_hash IS NULL
     OR length(NEW.content_hash) <> 64
     OR NEW.content_hash GLOB '*[^0-9a-f]*'
     OR NOT EXISTS (
       SELECT 1
       FROM multiplayer_profiles profile
       JOIN game_versions version
         ON version.id = profile.game_version_id
        AND version.game_id = profile.game_id
       WHERE profile.id = NEW.profile_id
         AND profile.profile_kind = 'RELAY'
         AND profile.enabled = 1
         AND profile.content_hash = NEW.content_hash
         AND version.content_hash = NEW.content_hash
     );
END;

CREATE TRIGGER trg_multiplayer_instances_content_hash_immutable
BEFORE UPDATE OF content_hash ON multiplayer_instances
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Multiplayer instance content hash is immutable');
END;
