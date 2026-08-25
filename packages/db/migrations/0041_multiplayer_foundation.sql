-- Migration: 0041_multiplayer_foundation.sql
-- Multiplayer control-plane and canonical match ledger foundation.
--
-- Live simulation state remains in one Durable Object per instance. D1 owns reviewed exact-version
-- profiles, instance membership, canonical terminal facts, reward delivery, and version leases.
-- No table in this migration makes a Creator manifest authoritative and no runtime is enabled by
-- merely applying this schema.

CREATE TABLE multiplayer_profile_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  game_version_id INTEGER NOT NULL REFERENCES game_versions(id) ON DELETE CASCADE,
  request_schema_version INTEGER NOT NULL DEFAULT 1,
  request_hash TEXT NOT NULL,
  request_json TEXT NOT NULL,
  requested_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
  reviewed_by_admin_id INTEGER REFERENCES admin_accounts(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  decision_reason_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (game_version_id),
  CHECK (request_schema_version = 1),
  CHECK (
    length(request_hash) = 64
    AND request_hash NOT GLOB '*[^0-9a-f]*'
  ),
  CHECK (
    json_valid(request_json)
    AND json_type(request_json) = 'object'
  ),
  CHECK (status IN ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
  CHECK (
    (
      status IN ('PENDING_REVIEW', 'WITHDRAWN')
      AND reviewed_by_admin_id IS NULL
      AND reviewed_at IS NULL
    )
    OR (
      status IN ('APPROVED', 'REJECTED')
      AND reviewed_by_admin_id IS NOT NULL
      AND reviewed_at IS NOT NULL
    )
  ),
  CHECK (
    (
      status = 'REJECTED'
      AND decision_reason_code IS NOT NULL
      AND length(decision_reason_code) BETWEEN 1 AND 64
      AND decision_reason_code = trim(decision_reason_code)
      AND decision_reason_code NOT GLOB '*[^A-Z0-9_]*'
      AND substr(decision_reason_code, 1, 1) GLOB '[A-Z]'
    )
    OR (
      status <> 'REJECTED'
      AND decision_reason_code IS NULL
    )
  ),
  CHECK (length(created_at) > 0),
  CHECK (length(updated_at) > 0)
);

CREATE INDEX idx_multiplayer_profile_requests_review
  ON multiplayer_profile_requests(status, created_at, id);
CREATE INDEX idx_multiplayer_profile_requests_game
  ON multiplayer_profile_requests(game_id, game_version_id);

CREATE TRIGGER trg_multiplayer_profile_requests_validate_insert
BEFORE INSERT ON multiplayer_profile_requests
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Multiplayer request version must belong to the exact game')
  WHERE NOT EXISTS (
    SELECT 1
    FROM game_versions version
    WHERE version.id = NEW.game_version_id
      AND version.game_id = NEW.game_id
  );

  SELECT RAISE(ABORT, 'USER multiplayer request must be submitted by the game owner')
  WHERE EXISTS (
    SELECT 1
    FROM games game
    WHERE game.id = NEW.game_id
      AND game.publisher_type = 'USER'
      AND game.publisher_user_id IS NOT NEW.requested_by_user_id
  );

  SELECT RAISE(ABORT, 'OWOGG multiplayer request must not claim a Creator identity')
  WHERE EXISTS (
    SELECT 1
    FROM games game
    WHERE game.id = NEW.game_id
      AND game.publisher_type = 'OWOGG'
      AND NEW.requested_by_user_id IS NOT NULL
  );
END;

CREATE TRIGGER trg_multiplayer_profile_requests_immutable_source
BEFORE UPDATE OF
  game_id,
  game_version_id,
  request_schema_version,
  request_hash,
  request_json,
  created_at
ON multiplayer_profile_requests
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Multiplayer profile request source is immutable');
END;

CREATE TRIGGER trg_multiplayer_profile_requests_status_transition
BEFORE UPDATE OF status ON multiplayer_profile_requests
FOR EACH ROW
WHEN NOT (
  NEW.status = OLD.status
  OR (
    OLD.status = 'PENDING_REVIEW'
    AND NEW.status IN ('APPROVED', 'REJECTED', 'WITHDRAWN')
  )
)
BEGIN
  SELECT RAISE(ABORT, 'Invalid multiplayer profile request status transition');
END;

CREATE TABLE multiplayer_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_request_id INTEGER REFERENCES multiplayer_profile_requests(id) ON DELETE RESTRICT,
  source_request_hash TEXT,
  profile_version INTEGER NOT NULL,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  game_version_id INTEGER NOT NULL REFERENCES game_versions(id) ON DELETE CASCADE,
  profile_revision INTEGER NOT NULL,
  protocol_version INTEGER NOT NULL,
  resolved_class TEXT NOT NULL,
  simulation_model TEXT NOT NULL,
  runtime_backend TEXT NOT NULL,
  ruleset_key TEXT NOT NULL,
  ruleset_revision INTEGER NOT NULL,
  resolved_config_json TEXT NOT NULL,
  lifecycle TEXT NOT NULL,
  persistence TEXT NOT NULL,
  latency_profile TEXT NOT NULL,
  reconnect_policy TEXT NOT NULL,
  min_players INTEGER NOT NULL,
  max_players INTEGER NOT NULL,
  allowed_visibility_json TEXT NOT NULL,
  allowed_join_policies_json TEXT NOT NULL,
  max_action_bytes INTEGER NOT NULL,
  max_state_bytes INTEGER NOT NULL,
  action_rate_limit INTEGER NOT NULL,
  reward_policy_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  created_by_admin_id INTEGER REFERENCES admin_accounts(id) ON DELETE SET NULL,
  approved_at TEXT NOT NULL,
  disabled_at TEXT,
  disabled_reason_code TEXT,
  disabled_by_admin_id INTEGER REFERENCES admin_accounts(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (game_id, game_version_id, profile_revision),
  CHECK (
    source_request_hash IS NULL
    OR (
      length(source_request_hash) = 64
      AND source_request_hash NOT GLOB '*[^0-9a-f]*'
    )
  ),
  CHECK (source_request_id IS NULL OR source_request_hash IS NOT NULL),
  CHECK (profile_version = 1),
  CHECK (profile_revision > 0),
  CHECK (protocol_version = 1),
  CHECK (resolved_class IN ('M1', 'M2')),
  CHECK (simulation_model IN ('turn', 'event', 'realtime')),
  CHECK (runtime_backend = 'durable-object'),
  CHECK (
    length(ruleset_key) BETWEEN 1 AND 96
    AND ruleset_key = trim(ruleset_key)
  ),
  CHECK (ruleset_revision > 0),
  CHECK (
    json_valid(resolved_config_json)
    AND json_type(resolved_config_json) = 'object'
  ),
  CHECK (lifecycle IN ('match', 'continuous')),
  CHECK (persistence = 'match'),
  CHECK (latency_profile IN ('relaxed', 'interactive')),
  CHECK (reconnect_policy IN ('none', 'rejoin', 'resume')),
  CHECK (min_players BETWEEN 2 AND 8),
  CHECK (max_players BETWEEN 2 AND 8),
  CHECK (min_players <= max_players),
  CHECK (
    json_valid(allowed_visibility_json)
    AND json_type(allowed_visibility_json) = 'array'
    AND json_array_length(allowed_visibility_json) > 0
  ),
  CHECK (
    json_valid(allowed_join_policies_json)
    AND json_type(allowed_join_policies_json) = 'array'
    AND json_array_length(allowed_join_policies_json) > 0
  ),
  CHECK (max_action_bytes BETWEEN 1 AND 4096),
  CHECK (max_state_bytes BETWEEN 1 AND 16384),
  CHECK (action_rate_limit BETWEEN 1 AND 60),
  CHECK (
    reward_policy_id IS NULL
    OR (
      length(reward_policy_id) BETWEEN 1 AND 96
      AND reward_policy_id = trim(reward_policy_id)
    )
  ),
  CHECK (enabled IN (0, 1)),
  CHECK (
    enabled = 0
    OR (
      disabled_at IS NULL
      AND disabled_reason_code IS NULL
      AND disabled_by_admin_id IS NULL
    )
  ),
  CHECK (
    (
      disabled_at IS NULL
      AND disabled_reason_code IS NULL
      AND disabled_by_admin_id IS NULL
    )
    OR (
      enabled = 0
      AND disabled_at IS NOT NULL
      AND disabled_reason_code IS NOT NULL
      AND disabled_by_admin_id IS NOT NULL
    )
  ),
  CHECK (
    disabled_reason_code IS NULL
    OR (
      length(disabled_reason_code) BETWEEN 1 AND 64
      AND disabled_reason_code = trim(disabled_reason_code)
      AND disabled_reason_code NOT GLOB '*[^A-Z0-9_]*'
      AND substr(disabled_reason_code, 1, 1) GLOB '[A-Z]'
    )
  ),
  CHECK (
    (
      resolved_class = 'M1'
      AND simulation_model IN ('turn', 'event')
      AND latency_profile = 'relaxed'
      AND lifecycle = 'match'
    )
    OR (
      resolved_class = 'M2'
      AND simulation_model IN ('event', 'realtime')
      AND latency_profile = 'interactive'
    )
  ),
  CHECK (length(approved_at) > 0),
  CHECK (length(updated_at) > 0)
);

CREATE UNIQUE INDEX idx_multiplayer_profiles_one_enabled_version
  ON multiplayer_profiles(game_version_id)
  WHERE enabled = 1;
CREATE INDEX idx_multiplayer_profiles_game_version
  ON multiplayer_profiles(game_id, game_version_id, profile_revision DESC);
CREATE INDEX idx_multiplayer_profiles_enabled
  ON multiplayer_profiles(enabled, game_id, game_version_id);

CREATE TRIGGER trg_multiplayer_profiles_validate_insert
BEFORE INSERT ON multiplayer_profiles
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Multiplayer profile requires an exact READY game version')
  WHERE NOT EXISTS (
    SELECT 1
    FROM game_versions version
    JOIN games game ON game.id = version.game_id
    WHERE version.id = NEW.game_version_id
      AND version.game_id = NEW.game_id
      AND version.publish_status = 'READY'
      AND game.deleted_at IS NULL
  );

  SELECT RAISE(ABORT, 'USER multiplayer profile requires an approved version')
  WHERE EXISTS (
    SELECT 1
    FROM games game
    JOIN game_versions version ON version.game_id = game.id
    WHERE game.id = NEW.game_id
      AND version.id = NEW.game_version_id
      AND game.publisher_type = 'USER'
      AND version.moderation_status IS NOT 'APPROVED'
  );

  SELECT RAISE(ABORT, 'Creator multiplayer profile requires its approved exact-version request')
  WHERE EXISTS (
    SELECT 1
    FROM games game
    WHERE game.id = NEW.game_id
      AND game.publisher_type = 'USER'
      AND NEW.source_request_id IS NULL
  );

  SELECT RAISE(ABORT, 'Multiplayer profile source request does not match')
  WHERE NEW.source_request_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM multiplayer_profile_requests request
      WHERE request.id = NEW.source_request_id
        AND request.game_id = NEW.game_id
        AND request.game_version_id = NEW.game_version_id
        AND request.request_hash = NEW.source_request_hash
        AND request.status = 'APPROVED'
    );

  SELECT RAISE(ABORT, 'Multiplayer profile contains an unsupported visibility')
  WHERE EXISTS (
    SELECT 1
    FROM json_each(NEW.allowed_visibility_json) allowed
    WHERE allowed.type <> 'text'
       OR allowed.value NOT IN ('PUBLIC', 'UNLISTED', 'PRIVATE')
  );

  SELECT RAISE(ABORT, 'Multiplayer profile visibility list contains duplicates')
  WHERE (
    SELECT COUNT(*) FROM json_each(NEW.allowed_visibility_json)
  ) <> (
    SELECT COUNT(DISTINCT value) FROM json_each(NEW.allowed_visibility_json)
  );

  SELECT RAISE(ABORT, 'Multiplayer profile contains an unsupported join policy')
  WHERE EXISTS (
    SELECT 1
    FROM json_each(NEW.allowed_join_policies_json) allowed
    WHERE allowed.type <> 'text'
       OR allowed.value NOT IN ('OPEN', 'INVITE_ONLY')
  );

  SELECT RAISE(ABORT, 'Multiplayer profile join policy list contains duplicates')
  WHERE (
    SELECT COUNT(*) FROM json_each(NEW.allowed_join_policies_json)
  ) <> (
    SELECT COUNT(DISTINCT value) FROM json_each(NEW.allowed_join_policies_json)
  );
END;

CREATE TRIGGER trg_multiplayer_profiles_immutable_semantics
BEFORE UPDATE OF
  source_request_id,
  source_request_hash,
  profile_version,
  game_id,
  game_version_id,
  profile_revision,
  protocol_version,
  resolved_class,
  simulation_model,
  runtime_backend,
  ruleset_key,
  ruleset_revision,
  resolved_config_json,
  lifecycle,
  persistence,
  latency_profile,
  reconnect_policy,
  min_players,
  max_players,
  allowed_visibility_json,
  allowed_join_policies_json,
  max_action_bytes,
  max_state_bytes,
  action_rate_limit,
  reward_policy_id,
  approved_at
ON multiplayer_profiles
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Multiplayer profile semantics are immutable; create a new revision');
END;

CREATE TRIGGER trg_multiplayer_profiles_validate_enable
BEFORE UPDATE OF enabled ON multiplayer_profiles
FOR EACH ROW
WHEN OLD.enabled = 0 AND NEW.enabled = 1
BEGIN
  SELECT RAISE(ABORT, 'Multiplayer profile can enable only for the current eligible exact version')
  WHERE NOT EXISTS (
    SELECT 1
    FROM games game
    JOIN game_versions version
      ON version.id = NEW.game_version_id
     AND version.game_id = game.id
    WHERE game.id = NEW.game_id
      AND game.deleted_at IS NULL
      AND game.live_version_id = version.id
      AND version.publish_status = 'READY'
      AND (
        game.publisher_type = 'OWOGG'
        OR (
          game.publisher_type = 'USER'
          AND version.moderation_status = 'APPROVED'
          AND EXISTS (
            SELECT 1
            FROM multiplayer_profile_requests request
            WHERE request.id = NEW.source_request_id
              AND request.game_id = NEW.game_id
              AND request.game_version_id = NEW.game_version_id
              AND request.request_hash = NEW.source_request_hash
              AND request.status = 'APPROVED'
          )
        )
      )
  );
END;

CREATE TABLE multiplayer_instances (
  id TEXT PRIMARY KEY,
  public_code TEXT NOT NULL UNIQUE,
  created_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  create_idempotency_hash TEXT NOT NULL,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  game_version_id INTEGER NOT NULL REFERENCES game_versions(id) ON DELETE CASCADE,
  profile_id INTEGER NOT NULL REFERENCES multiplayer_profiles(id) ON DELETE RESTRICT,
  profile_revision INTEGER NOT NULL,
  visibility TEXT NOT NULL,
  join_policy TEXT NOT NULL,
  lifecycle TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'CREATED',
  generation INTEGER NOT NULL DEFAULT 1,
  participant_count INTEGER NOT NULL DEFAULT 0,
  max_players INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  closed_at TEXT,
  abort_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (created_by_user_id, create_idempotency_hash),
  CHECK (length(id) BETWEEN 16 AND 128),
  CHECK (length(public_code) BETWEEN 12 AND 64),
  CHECK (
    length(create_idempotency_hash) = 64
    AND create_idempotency_hash NOT GLOB '*[^0-9a-f]*'
  ),
  CHECK (profile_revision > 0),
  CHECK (visibility IN ('PUBLIC', 'UNLISTED', 'PRIVATE')),
  CHECK (join_policy IN ('OPEN', 'INVITE_ONLY')),
  CHECK (lifecycle IN ('match', 'continuous')),
  CHECK (
    status IN (
      'CREATED',
      'LOBBY',
      'STARTING',
      'ACTIVE',
      'CLOSING',
      'CLOSED',
      'ABORTED',
      'EXPIRED'
    )
  ),
  CHECK (generation > 0),
  CHECK (max_players BETWEEN 2 AND 8),
  CHECK (participant_count BETWEEN 0 AND max_players),
  CHECK (
    (
      status IN ('CLOSED', 'ABORTED', 'EXPIRED')
      AND closed_at IS NOT NULL
    )
    OR (
      status NOT IN ('CLOSED', 'ABORTED', 'EXPIRED')
      AND closed_at IS NULL
    )
  ),
  CHECK (
    (
      status = 'ABORTED'
      AND abort_code IN (
        'INSUFFICIENT_PLAYERS',
        'PARTICIPANT_LEFT',
        'RULE_VIOLATION',
        'INFRA_FAILURE',
        'ADMIN_KILLED',
        'VERSION_UNAVAILABLE'
      )
    )
    OR (
      status <> 'ABORTED'
      AND abort_code IS NULL
    )
  ),
  CHECK (expires_at > created_at),
  CHECK (length(created_at) > 0),
  CHECK (length(updated_at) > 0)
);

CREATE INDEX idx_multiplayer_instances_discovery
  ON multiplayer_instances(status, visibility, game_id, created_at DESC);
CREATE INDEX idx_multiplayer_instances_version
  ON multiplayer_instances(game_version_id, status);
CREATE INDEX idx_multiplayer_instances_creator
  ON multiplayer_instances(created_by_user_id, created_at DESC);

CREATE TRIGGER trg_multiplayer_instances_validate_insert
BEFORE INSERT ON multiplayer_instances
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Multiplayer instance requires the enabled exact profile')
  WHERE NOT EXISTS (
    SELECT 1
    FROM multiplayer_profiles profile
    WHERE profile.id = NEW.profile_id
      AND profile.game_id = NEW.game_id
      AND profile.game_version_id = NEW.game_version_id
      AND profile.profile_revision = NEW.profile_revision
      AND profile.lifecycle = NEW.lifecycle
      AND profile.max_players = NEW.max_players
      AND profile.enabled = 1
  );

  SELECT RAISE(ABORT, 'Multiplayer instance requires the current live READY version')
  WHERE NOT EXISTS (
    SELECT 1
    FROM games game
    JOIN game_versions version
      ON version.id = game.live_version_id
     AND version.game_id = game.id
    WHERE game.id = NEW.game_id
      AND game.deleted_at IS NULL
      AND version.id = NEW.game_version_id
      AND version.publish_status = 'READY'
  );

  SELECT RAISE(ABORT, 'Multiplayer instance visibility is not approved by the profile')
  WHERE NOT EXISTS (
    SELECT 1
    FROM multiplayer_profiles profile, json_each(profile.allowed_visibility_json) allowed
    WHERE profile.id = NEW.profile_id
      AND allowed.value = NEW.visibility
  );

  SELECT RAISE(ABORT, 'Multiplayer instance join policy is not approved by the profile')
  WHERE NOT EXISTS (
    SELECT 1
    FROM multiplayer_profiles profile, json_each(profile.allowed_join_policies_json) allowed
    WHERE profile.id = NEW.profile_id
      AND allowed.value = NEW.join_policy
  );
END;

CREATE TRIGGER trg_multiplayer_instances_immutable_identity
BEFORE UPDATE OF
  id,
  public_code,
  create_idempotency_hash,
  game_id,
  game_version_id,
  profile_id,
  profile_revision,
  lifecycle,
  max_players,
  created_at
ON multiplayer_instances
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Multiplayer instance identity snapshot is immutable');
END;

CREATE TRIGGER trg_multiplayer_instances_validate_access_update
BEFORE UPDATE OF visibility, join_policy ON multiplayer_instances
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Multiplayer instance visibility is not approved by the profile')
  WHERE NOT EXISTS (
    SELECT 1
    FROM multiplayer_profiles profile, json_each(profile.allowed_visibility_json) allowed
    WHERE profile.id = OLD.profile_id
      AND allowed.value = NEW.visibility
  );

  SELECT RAISE(ABORT, 'Multiplayer instance join policy is not approved by the profile')
  WHERE NOT EXISTS (
    SELECT 1
    FROM multiplayer_profiles profile, json_each(profile.allowed_join_policies_json) allowed
    WHERE profile.id = OLD.profile_id
      AND allowed.value = NEW.join_policy
  );
END;

CREATE TRIGGER trg_multiplayer_instances_status_transition
BEFORE UPDATE OF status, generation ON multiplayer_instances
FOR EACH ROW
WHEN NOT (
  (
    NEW.status = OLD.status
    AND NEW.generation = OLD.generation
  )
  OR (
    NEW.generation = OLD.generation
    AND (
      (OLD.status = 'CREATED' AND NEW.status IN ('LOBBY', 'ABORTED', 'EXPIRED'))
      OR (OLD.status = 'LOBBY' AND NEW.status IN ('STARTING', 'ABORTED', 'EXPIRED'))
      OR (OLD.status = 'STARTING' AND NEW.status IN ('ACTIVE', 'ABORTED', 'EXPIRED'))
      OR (OLD.status = 'ACTIVE' AND NEW.status IN ('CLOSING', 'ABORTED', 'EXPIRED'))
      OR (OLD.status = 'CLOSING' AND NEW.status IN ('CLOSED', 'ABORTED', 'EXPIRED'))
    )
  )
  OR (
    OLD.status = 'CLOSING'
    AND NEW.status = 'LOBBY'
    AND NEW.generation = OLD.generation + 1
  )
)
BEGIN
  SELECT RAISE(ABORT, 'Invalid multiplayer instance status or generation transition');
END;

CREATE TRIGGER trg_multiplayer_instances_prevent_active_delete
BEFORE DELETE ON multiplayer_instances
FOR EACH ROW
WHEN OLD.status NOT IN ('CLOSED', 'ABORTED', 'EXPIRED')
BEGIN
  SELECT RAISE(ABORT, 'Active multiplayer instance must be closed before deletion');
END;

CREATE TABLE multiplayer_participants (
  id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL REFERENCES multiplayer_instances(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role TEXT NOT NULL,
  seat_index INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'JOINED',
  connection_generation INTEGER NOT NULL DEFAULT 0,
  joined_at TEXT NOT NULL,
  ready_at TEXT,
  left_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (instance_id, user_id),
  UNIQUE (instance_id, seat_index),
  UNIQUE (id, user_id),
  CHECK (length(id) BETWEEN 8 AND 128),
  CHECK (role IN ('HOST', 'PLAYER')),
  CHECK (seat_index BETWEEN 0 AND 7),
  CHECK (status IN ('JOINED', 'READY', 'LEFT', 'KICKED')),
  CHECK (connection_generation >= 0),
  CHECK (
    (
      status IN ('JOINED', 'READY')
      AND left_at IS NULL
    )
    OR (
      status IN ('LEFT', 'KICKED')
      AND left_at IS NOT NULL
    )
  ),
  CHECK (
    (status = 'READY' AND ready_at IS NOT NULL)
    OR (status <> 'READY' AND ready_at IS NULL)
  ),
  CHECK (length(joined_at) > 0),
  CHECK (length(updated_at) > 0)
);

CREATE UNIQUE INDEX idx_multiplayer_participants_one_active_host
  ON multiplayer_participants(instance_id)
  WHERE role = 'HOST' AND status IN ('JOINED', 'READY');
CREATE INDEX idx_multiplayer_participants_user
  ON multiplayer_participants(user_id, joined_at DESC);
CREATE INDEX idx_multiplayer_participants_instance_status
  ON multiplayer_participants(instance_id, status, seat_index);

CREATE TRIGGER trg_multiplayer_participants_validate_insert
BEFORE INSERT ON multiplayer_participants
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'New multiplayer participant must start JOINED')
  WHERE NEW.status <> 'JOINED';

  SELECT RAISE(ABORT, 'Multiplayer instance is not joinable or is full')
  WHERE NOT EXISTS (
    SELECT 1
    FROM multiplayer_instances instance
    JOIN multiplayer_profiles profile ON profile.id = instance.profile_id
    JOIN games game ON game.id = instance.game_id
    JOIN game_versions version
      ON version.id = instance.game_version_id
     AND version.game_id = game.id
    WHERE instance.id = NEW.instance_id
      AND instance.status IN ('CREATED', 'LOBBY')
      AND instance.participant_count < instance.max_players
      AND NEW.seat_index < instance.max_players
      AND profile.enabled = 1
      AND game.deleted_at IS NULL
      AND game.live_version_id = version.id
      AND version.publish_status = 'READY'
      AND (
        game.publisher_type = 'OWOGG'
        OR (game.publisher_type = 'USER' AND version.moderation_status = 'APPROVED')
      )
  );
END;

CREATE TRIGGER trg_multiplayer_participants_after_insert_count
AFTER INSERT ON multiplayer_participants
FOR EACH ROW
BEGIN
  UPDATE multiplayer_instances
  SET participant_count = participant_count + 1
  WHERE id = NEW.instance_id;
END;

CREATE TRIGGER trg_multiplayer_participants_validate_rejoin
BEFORE UPDATE OF status ON multiplayer_participants
FOR EACH ROW
WHEN OLD.status IN ('LEFT', 'KICKED') AND NEW.status IN ('JOINED', 'READY')
BEGIN
  SELECT RAISE(ABORT, 'Kicked multiplayer participant cannot rejoin')
  WHERE OLD.status = 'KICKED';

  SELECT RAISE(ABORT, 'Multiplayer instance is not joinable or is full')
  WHERE NOT EXISTS (
    SELECT 1
    FROM multiplayer_instances instance
    JOIN multiplayer_profiles profile ON profile.id = instance.profile_id
    JOIN games game ON game.id = instance.game_id
    JOIN game_versions version
      ON version.id = instance.game_version_id
     AND version.game_id = game.id
    WHERE instance.id = OLD.instance_id
      AND instance.status IN ('CREATED', 'LOBBY')
      AND instance.participant_count < instance.max_players
      AND profile.enabled = 1
      AND game.deleted_at IS NULL
      AND game.live_version_id = version.id
      AND version.publish_status = 'READY'
      AND (
        game.publisher_type = 'OWOGG'
        OR (game.publisher_type = 'USER' AND version.moderation_status = 'APPROVED')
      )
  );
END;

CREATE TRIGGER trg_multiplayer_participants_status_transition
BEFORE UPDATE OF status ON multiplayer_participants
FOR EACH ROW
WHEN NOT (
  NEW.status = OLD.status
  OR (OLD.status = 'JOINED' AND NEW.status IN ('READY', 'LEFT', 'KICKED'))
  OR (OLD.status = 'READY' AND NEW.status IN ('JOINED', 'LEFT', 'KICKED'))
  OR (OLD.status = 'LEFT' AND NEW.status = 'JOINED')
)
BEGIN
  SELECT RAISE(ABORT, 'Invalid multiplayer participant status transition');
END;

CREATE TRIGGER trg_multiplayer_participants_ready_only_in_lobby
BEFORE UPDATE OF status ON multiplayer_participants
FOR EACH ROW
WHEN NEW.status = 'READY' AND OLD.status IS NOT 'READY'
BEGIN
  SELECT RAISE(ABORT, 'Multiplayer participant can become READY only in LOBBY')
  WHERE NOT EXISTS (
    SELECT 1
    FROM multiplayer_instances instance
    WHERE instance.id = OLD.instance_id
      AND instance.status = 'LOBBY'
  );
END;

CREATE TRIGGER trg_multiplayer_participants_after_status_count
AFTER UPDATE OF status ON multiplayer_participants
FOR EACH ROW
WHEN OLD.status IS NOT NEW.status
BEGIN
  UPDATE multiplayer_instances
  SET participant_count = participant_count
    + CASE
        WHEN OLD.status IN ('LEFT', 'KICKED') AND NEW.status IN ('JOINED', 'READY') THEN 1
        WHEN OLD.status IN ('JOINED', 'READY') AND NEW.status IN ('LEFT', 'KICKED') THEN -1
        ELSE 0
      END
  WHERE id = NEW.instance_id;
END;

CREATE TRIGGER trg_multiplayer_participants_after_delete_count
AFTER DELETE ON multiplayer_participants
FOR EACH ROW
WHEN OLD.status IN ('JOINED', 'READY')
BEGIN
  UPDATE multiplayer_instances
  SET participant_count = participant_count - 1
  WHERE id = OLD.instance_id;
END;

CREATE TRIGGER trg_multiplayer_participants_immutable_identity
BEFORE UPDATE OF id, instance_id, seat_index, joined_at ON multiplayer_participants
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Multiplayer participant identity is immutable');
END;

CREATE TRIGGER trg_multiplayer_participants_connection_generation
BEFORE UPDATE OF connection_generation ON multiplayer_participants
FOR EACH ROW
WHEN NEW.connection_generation < OLD.connection_generation
BEGIN
  SELECT RAISE(ABORT, 'Multiplayer connection generation cannot decrease');
END;

CREATE TABLE multiplayer_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id TEXT NOT NULL REFERENCES multiplayer_instances(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  max_uses INTEGER NOT NULL,
  used_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (generation > 0),
  CHECK (
    length(token_hash) = 64
    AND token_hash NOT GLOB '*[^0-9a-f]*'
  ),
  CHECK (max_uses BETWEEN 1 AND 8),
  CHECK (used_count BETWEEN 0 AND max_uses),
  CHECK (expires_at > created_at),
  CHECK (length(updated_at) > 0)
);

CREATE INDEX idx_multiplayer_invites_instance
  ON multiplayer_invites(instance_id, generation, expires_at);

CREATE TRIGGER trg_multiplayer_invites_validate_insert
BEFORE INSERT ON multiplayer_invites
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Multiplayer invite must target the current joinable generation')
  WHERE NOT EXISTS (
    SELECT 1
    FROM multiplayer_instances instance
    WHERE instance.id = NEW.instance_id
      AND instance.generation = NEW.generation
      AND instance.status IN ('CREATED', 'LOBBY')
      AND NEW.max_uses <= instance.max_players
  );

  SELECT RAISE(ABORT, 'Multiplayer invite creator must be an active participant')
  WHERE NOT EXISTS (
    SELECT 1
    FROM multiplayer_participants participant
    WHERE participant.instance_id = NEW.instance_id
      AND participant.user_id = NEW.created_by_user_id
      AND participant.status IN ('JOINED', 'READY')
  );
END;

CREATE TRIGGER trg_multiplayer_invites_immutable_identity
BEFORE UPDATE OF
  instance_id,
  generation,
  token_hash,
  max_uses,
  expires_at,
  created_at
ON multiplayer_invites
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Multiplayer invite identity is immutable');
END;

CREATE TRIGGER trg_multiplayer_invites_use_counter
BEFORE UPDATE OF used_count ON multiplayer_invites
FOR EACH ROW
WHEN NEW.used_count NOT IN (OLD.used_count, OLD.used_count + 1)
BEGIN
  SELECT RAISE(ABORT, 'Multiplayer invite use counter must increment exactly once');
END;

CREATE TABLE multiplayer_matches (
  id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL REFERENCES multiplayer_instances(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  game_version_id INTEGER NOT NULL REFERENCES game_versions(id) ON DELETE CASCADE,
  profile_id INTEGER NOT NULL REFERENCES multiplayer_profiles(id) ON DELETE RESTRICT,
  profile_revision INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  state_revision INTEGER NOT NULL DEFAULT 0,
  terminal_result_json TEXT,
  terminal_result_hash TEXT,
  abort_code TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finalizing_at TEXT,
  committed_at TEXT,
  aborted_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (instance_id, generation),
  CHECK (length(id) BETWEEN 16 AND 128),
  CHECK (generation > 0),
  CHECK (profile_revision > 0),
  CHECK (status IN ('PENDING', 'ACTIVE', 'FINALIZING', 'COMMITTED', 'ABORTED')),
  CHECK (state_revision >= 0),
  CHECK (
    terminal_result_json IS NULL
    OR (
      json_valid(terminal_result_json)
      AND json_type(terminal_result_json) = 'object'
    )
  ),
  CHECK (
    terminal_result_hash IS NULL
    OR (
      length(terminal_result_hash) = 64
      AND terminal_result_hash NOT GLOB '*[^0-9a-f]*'
    )
  ),
  CHECK (
    status IN ('FINALIZING', 'COMMITTED')
    OR (
      terminal_result_json IS NULL
      AND terminal_result_hash IS NULL
      AND finalizing_at IS NULL
      AND committed_at IS NULL
    )
  ),
  CHECK (
    status <> 'FINALIZING'
    OR (
      terminal_result_json IS NOT NULL
      AND terminal_result_hash IS NOT NULL
      AND finalizing_at IS NOT NULL
    )
  ),
  CHECK (
    status <> 'COMMITTED'
    OR (
      terminal_result_json IS NOT NULL
      AND terminal_result_hash IS NOT NULL
      AND finalizing_at IS NOT NULL
      AND committed_at IS NOT NULL
    )
  ),
  CHECK (
    (
      status = 'ABORTED'
      AND abort_code IN (
        'INSUFFICIENT_PLAYERS',
        'PARTICIPANT_LEFT',
        'RULE_VIOLATION',
        'INFRA_FAILURE',
        'ADMIN_KILLED',
        'VERSION_UNAVAILABLE'
      )
      AND aborted_at IS NOT NULL
    )
    OR (
      status <> 'ABORTED'
      AND abort_code IS NULL
      AND aborted_at IS NULL
    )
  ),
  CHECK (length(created_at) > 0),
  CHECK (length(updated_at) > 0)
);

CREATE INDEX idx_multiplayer_matches_instance
  ON multiplayer_matches(instance_id, generation DESC);
CREATE INDEX idx_multiplayer_matches_status
  ON multiplayer_matches(status, updated_at);
CREATE INDEX idx_multiplayer_matches_version
  ON multiplayer_matches(game_version_id, created_at DESC);

CREATE TRIGGER trg_multiplayer_matches_validate_insert
BEFORE INSERT ON multiplayer_matches
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'New multiplayer match must start PENDING')
  WHERE NEW.status <> 'PENDING';

  SELECT RAISE(ABORT, 'Multiplayer match snapshot must match the current instance generation')
  WHERE NOT EXISTS (
    SELECT 1
    FROM multiplayer_instances instance
    WHERE instance.id = NEW.instance_id
      AND instance.generation = NEW.generation
      AND instance.game_id = NEW.game_id
      AND instance.game_version_id = NEW.game_version_id
      AND instance.profile_id = NEW.profile_id
      AND instance.profile_revision = NEW.profile_revision
      AND instance.status IN ('STARTING', 'ACTIVE')
  );
END;

CREATE TRIGGER trg_multiplayer_matches_immutable_identity
BEFORE UPDATE OF
  id,
  instance_id,
  generation,
  game_id,
  game_version_id,
  profile_id,
  profile_revision,
  created_at
ON multiplayer_matches
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Multiplayer match identity snapshot is immutable');
END;

CREATE TRIGGER trg_multiplayer_matches_status_transition
BEFORE UPDATE OF status ON multiplayer_matches
FOR EACH ROW
WHEN NOT (
  NEW.status = OLD.status
  OR (OLD.status = 'PENDING' AND NEW.status IN ('ACTIVE', 'ABORTED'))
  OR (OLD.status = 'ACTIVE' AND NEW.status IN ('FINALIZING', 'ABORTED'))
  OR (OLD.status = 'FINALIZING' AND NEW.status IN ('COMMITTED', 'ABORTED'))
)
BEGIN
  SELECT RAISE(ABORT, 'Invalid multiplayer match status transition');
END;

CREATE TRIGGER trg_multiplayer_matches_state_revision
BEFORE UPDATE OF state_revision ON multiplayer_matches
FOR EACH ROW
WHEN NEW.state_revision < OLD.state_revision
BEGIN
  SELECT RAISE(ABORT, 'Multiplayer match state revision cannot decrease');
END;

CREATE TRIGGER trg_multiplayer_matches_validate_commit
BEFORE UPDATE OF status ON multiplayer_matches
FOR EACH ROW
WHEN NEW.status = 'COMMITTED' AND OLD.status IS NOT 'COMMITTED'
BEGIN
  SELECT RAISE(ABORT, 'Committed multiplayer match requires every player result')
  WHERE EXISTS (
    SELECT 1
    FROM multiplayer_match_players player
    WHERE player.match_id = OLD.id
      AND player.result_status <> 'COMMITTED'
  );

  SELECT RAISE(ABORT, 'Committed multiplayer match has too few player results')
  WHERE (
    SELECT COUNT(*)
    FROM multiplayer_match_players player
    WHERE player.match_id = OLD.id
      AND player.result_status = 'COMMITTED'
  ) < (
    SELECT profile.min_players
    FROM multiplayer_profiles profile
    WHERE profile.id = OLD.profile_id
  );
END;

CREATE TRIGGER trg_multiplayer_matches_prevent_active_delete
BEFORE DELETE ON multiplayer_matches
FOR EACH ROW
WHEN OLD.status NOT IN ('COMMITTED', 'ABORTED')
BEGIN
  SELECT RAISE(ABORT, 'Active multiplayer match must be terminal before deletion');
END;

CREATE TABLE multiplayer_match_players (
  match_id TEXT NOT NULL REFERENCES multiplayer_matches(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  participant_id TEXT NOT NULL REFERENCES multiplayer_participants(id) ON DELETE RESTRICT,
  result_status TEXT NOT NULL DEFAULT 'PENDING',
  outcome TEXT,
  placement INTEGER,
  result_json TEXT,
  reward_eligible INTEGER NOT NULL DEFAULT 0,
  committed_at TEXT,
  aborted_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (match_id, user_id),
  UNIQUE (match_id, participant_id),
  FOREIGN KEY (participant_id, user_id)
    REFERENCES multiplayer_participants(id, user_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CHECK (result_status IN ('PENDING', 'COMMITTED', 'ABORTED')),
  CHECK (
    outcome IS NULL
    OR outcome IN ('WIN', 'LOSS', 'DRAW', 'COMPLETED', 'ABORTED')
  ),
  CHECK (placement IS NULL OR placement BETWEEN 1 AND 8),
  CHECK (
    result_json IS NULL
    OR (
      json_valid(result_json)
      AND json_type(result_json) = 'object'
    )
  ),
  CHECK (reward_eligible IN (0, 1)),
  CHECK (
    (
      result_status = 'PENDING'
      AND outcome IS NULL
      AND placement IS NULL
      AND result_json IS NULL
      AND reward_eligible = 0
      AND committed_at IS NULL
      AND aborted_at IS NULL
    )
    OR (
      result_status = 'COMMITTED'
      AND outcome IN ('WIN', 'LOSS', 'DRAW', 'COMPLETED')
      AND result_json IS NOT NULL
      AND committed_at IS NOT NULL
      AND aborted_at IS NULL
    )
    OR (
      result_status = 'ABORTED'
      AND outcome = 'ABORTED'
      AND reward_eligible = 0
      AND committed_at IS NULL
      AND aborted_at IS NOT NULL
    )
  ),
  CHECK (length(created_at) > 0)
);

CREATE INDEX idx_multiplayer_match_players_user
  ON multiplayer_match_players(user_id, created_at DESC);

CREATE TRIGGER trg_multiplayer_match_players_validate_insert
BEFORE INSERT ON multiplayer_match_players
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Multiplayer match player must be the exact instance participant')
  WHERE NOT EXISTS (
    SELECT 1
    FROM multiplayer_matches match
    JOIN multiplayer_participants participant
      ON participant.instance_id = match.instance_id
    WHERE match.id = NEW.match_id
      AND participant.id = NEW.participant_id
      AND participant.user_id = NEW.user_id
  );
END;

CREATE TRIGGER trg_multiplayer_match_players_immutable_identity
BEFORE UPDATE ON multiplayer_match_players
FOR EACH ROW
WHEN OLD.match_id IS NOT NEW.match_id
  OR OLD.participant_id IS NOT NEW.participant_id
  OR OLD.created_at IS NOT NEW.created_at
BEGIN
  SELECT RAISE(ABORT, 'Multiplayer match player identity is immutable');
END;

CREATE TRIGGER trg_multiplayer_match_players_validate_terminal_write
BEFORE UPDATE OF result_status ON multiplayer_match_players
FOR EACH ROW
WHEN NEW.result_status = 'COMMITTED' AND OLD.result_status IS NOT 'COMMITTED'
BEGIN
  SELECT RAISE(ABORT, 'Canonical multiplayer player result requires a finalizing match')
  WHERE NOT EXISTS (
    SELECT 1
    FROM multiplayer_matches match
    WHERE match.id = OLD.match_id
      AND match.status IN ('FINALIZING', 'COMMITTED')
  );
END;

CREATE TRIGGER trg_multiplayer_match_players_status_transition
BEFORE UPDATE OF result_status ON multiplayer_match_players
FOR EACH ROW
WHEN NOT (
  NEW.result_status = OLD.result_status
  OR (
    OLD.result_status = 'PENDING'
    AND NEW.result_status IN ('COMMITTED', 'ABORTED')
  )
)
BEGIN
  SELECT RAISE(ABORT, 'Invalid multiplayer match player status transition');
END;

CREATE TRIGGER trg_multiplayer_match_players_terminal_immutable
BEFORE UPDATE OF
  result_status,
  outcome,
  placement,
  result_json,
  reward_eligible,
  committed_at,
  aborted_at,
  created_at
ON multiplayer_match_players
FOR EACH ROW
WHEN OLD.result_status IN ('COMMITTED', 'ABORTED')
BEGIN
  SELECT RAISE(ABORT, 'Terminal multiplayer match player result is immutable');
END;

CREATE TRIGGER trg_multiplayer_match_players_prevent_terminal_delete
BEFORE DELETE ON multiplayer_match_players
FOR EACH ROW
WHEN OLD.result_status IN ('COMMITTED', 'ABORTED')
BEGIN
  SELECT RAISE(ABORT, 'Terminal multiplayer match player result is immutable');
END;

CREATE TABLE multiplayer_match_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id TEXT NOT NULL REFERENCES multiplayer_matches(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  participant_id TEXT NOT NULL REFERENCES multiplayer_participants(id) ON DELETE RESTRICT,
  client_seq INTEGER NOT NULL,
  server_seq INTEGER NOT NULL,
  client_action_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  expected_revision INTEGER NOT NULL,
  result_revision INTEGER NOT NULL,
  result_code TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (match_id, user_id, client_action_id),
  UNIQUE (match_id, server_seq),
  FOREIGN KEY (participant_id, user_id)
    REFERENCES multiplayer_participants(id, user_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CHECK (client_seq >= 0),
  CHECK (server_seq >= 0),
  CHECK (length(client_action_id) BETWEEN 16 AND 128),
  CHECK (
    length(payload_hash) = 64
    AND payload_hash NOT GLOB '*[^0-9a-f]*'
  ),
  CHECK (expected_revision >= 0),
  CHECK (result_revision >= 0),
  CHECK (
    result_code IN (
      'ACCEPTED',
      'MATCH_NOT_ACTIVE',
      'NOT_PARTICIPANT',
      'NOT_YOUR_TURN',
      'ACTION_INVALID',
      'ACTION_CONFLICT',
      'STALE_GENERATION',
      'RATE_LIMITED'
    )
  ),
  CHECK (result_code <> 'ACCEPTED' OR result_revision > expected_revision),
  CHECK (
    json_valid(response_json)
    AND json_type(response_json) = 'object'
  ),
  CHECK (length(created_at) > 0)
);

CREATE INDEX idx_multiplayer_match_actions_match_revision
  ON multiplayer_match_actions(match_id, result_revision, id);

CREATE TRIGGER trg_multiplayer_match_actions_validate_insert
BEFORE INSERT ON multiplayer_match_actions
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Multiplayer action actor must be the exact match participant')
  WHERE NOT EXISTS (
    SELECT 1
    FROM multiplayer_matches match
    JOIN multiplayer_participants participant
      ON participant.instance_id = match.instance_id
    WHERE match.id = NEW.match_id
      AND participant.id = NEW.participant_id
      AND participant.user_id = NEW.user_id
  );

  SELECT RAISE(ABORT, 'Accepted multiplayer action requires the exact ACTIVE match revision')
  WHERE NEW.result_code = 'ACCEPTED'
    AND NOT EXISTS (
      SELECT 1
      FROM multiplayer_matches match
      WHERE match.id = NEW.match_id
        AND match.status = 'ACTIVE'
        AND match.state_revision = NEW.result_revision
    );
END;

CREATE TRIGGER trg_multiplayer_match_actions_immutable_update
BEFORE UPDATE ON multiplayer_match_actions
FOR EACH ROW
WHEN OLD.match_id IS NOT NEW.match_id
  OR OLD.participant_id IS NOT NEW.participant_id
  OR OLD.client_seq IS NOT NEW.client_seq
  OR OLD.server_seq IS NOT NEW.server_seq
  OR OLD.client_action_id IS NOT NEW.client_action_id
  OR OLD.payload_hash IS NOT NEW.payload_hash
  OR OLD.expected_revision IS NOT NEW.expected_revision
  OR OLD.result_revision IS NOT NEW.result_revision
  OR OLD.result_code IS NOT NEW.result_code
  OR OLD.response_json IS NOT NEW.response_json
  OR OLD.created_at IS NOT NEW.created_at
BEGIN
  SELECT RAISE(ABORT, 'Multiplayer action ledger is immutable');
END;

CREATE TRIGGER trg_multiplayer_match_actions_immutable_delete
BEFORE DELETE ON multiplayer_match_actions
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Multiplayer action ledger is immutable');
END;

CREATE TABLE multiplayer_reward_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL UNIQUE,
  match_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  reward_policy_id TEXT NOT NULL,
  reward_payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL,
  lock_token_hash TEXT,
  locked_at TEXT,
  applied_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (match_id, user_id, reward_policy_id),
  FOREIGN KEY (match_id, user_id)
    REFERENCES multiplayer_match_players(match_id, user_id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  CHECK (length(source_id) BETWEEN 3 AND 260),
  CHECK (
    length(reward_policy_id) BETWEEN 1 AND 96
    AND reward_policy_id = trim(reward_policy_id)
  ),
  CHECK (
    json_valid(reward_payload_json)
    AND json_type(reward_payload_json) = 'object'
  ),
  CHECK (status IN ('PENDING', 'PROCESSING', 'RETRYABLE', 'APPLIED', 'DEAD_LETTER')),
  CHECK (attempt_count >= 0),
  CHECK (
    lock_token_hash IS NULL
    OR (
      length(lock_token_hash) = 64
      AND lock_token_hash NOT GLOB '*[^0-9a-f]*'
    )
  ),
  CHECK (
    (
      status IN ('PENDING', 'RETRYABLE', 'DEAD_LETTER')
      AND lock_token_hash IS NULL
      AND locked_at IS NULL
      AND applied_at IS NULL
    )
    OR (
      status = 'PROCESSING'
      AND lock_token_hash IS NOT NULL
      AND locked_at IS NOT NULL
      AND applied_at IS NULL
    )
    OR (
      status = 'APPLIED'
      AND applied_at IS NOT NULL
      AND lock_token_hash IS NULL
      AND locked_at IS NULL
    )
  ),
  CHECK (
    (status IN ('PENDING', 'PROCESSING', 'APPLIED') AND last_error_code IS NULL)
    OR (status IN ('RETRYABLE', 'DEAD_LETTER') AND last_error_code IS NOT NULL)
  ),
  CHECK (
    last_error_code IS NULL
    OR (
      length(last_error_code) BETWEEN 1 AND 64
      AND last_error_code = trim(last_error_code)
    )
  ),
  CHECK (length(available_at) > 0),
  CHECK (length(created_at) > 0),
  CHECK (length(updated_at) > 0)
);

CREATE INDEX idx_multiplayer_reward_outbox_delivery
  ON multiplayer_reward_outbox(status, available_at, id);
CREATE INDEX idx_multiplayer_reward_outbox_match
  ON multiplayer_reward_outbox(match_id, user_id);

CREATE TRIGGER trg_multiplayer_reward_outbox_validate_insert
BEFORE INSERT ON multiplayer_reward_outbox
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Multiplayer reward requires a committed eligible player and profile policy')
  WHERE NOT EXISTS (
    SELECT 1
    FROM multiplayer_match_players player
    JOIN multiplayer_matches match ON match.id = player.match_id
    JOIN multiplayer_profiles profile ON profile.id = match.profile_id
    WHERE player.match_id = NEW.match_id
      AND player.user_id = NEW.user_id
      AND player.result_status = 'COMMITTED'
      AND player.reward_eligible = 1
      AND match.game_id = NEW.game_id
      AND match.status IN ('FINALIZING', 'COMMITTED')
      AND profile.reward_policy_id = NEW.reward_policy_id
  );
END;

CREATE TRIGGER trg_multiplayer_reward_outbox_immutable_source
BEFORE UPDATE ON multiplayer_reward_outbox
FOR EACH ROW
WHEN OLD.source_id IS NOT NEW.source_id
  OR OLD.match_id IS NOT NEW.match_id
  OR OLD.game_id IS NOT NEW.game_id
  OR OLD.reward_policy_id IS NOT NEW.reward_policy_id
  OR OLD.reward_payload_json IS NOT NEW.reward_payload_json
  OR OLD.created_at IS NOT NEW.created_at
BEGIN
  SELECT RAISE(ABORT, 'Multiplayer reward source is immutable');
END;

CREATE TRIGGER trg_multiplayer_reward_outbox_status_transition
BEFORE UPDATE OF status ON multiplayer_reward_outbox
FOR EACH ROW
WHEN NOT (
  NEW.status = OLD.status
  OR (
    OLD.status IN ('PENDING', 'RETRYABLE')
    AND NEW.status = 'PROCESSING'
  )
  OR (
    OLD.status = 'PROCESSING'
    AND NEW.status IN ('APPLIED', 'RETRYABLE', 'DEAD_LETTER')
  )
)
BEGIN
  SELECT RAISE(ABORT, 'Invalid multiplayer reward outbox status transition');
END;

CREATE TRIGGER trg_multiplayer_reward_outbox_attempt_counter
BEFORE UPDATE OF attempt_count ON multiplayer_reward_outbox
FOR EACH ROW
WHEN NOT (
  NEW.attempt_count = OLD.attempt_count
  OR (
    OLD.status IN ('PENDING', 'RETRYABLE')
    AND NEW.status = 'PROCESSING'
    AND NEW.attempt_count = OLD.attempt_count + 1
  )
)
BEGIN
  SELECT RAISE(ABORT, 'Multiplayer reward attempt counter must increment only on claim');
END;

CREATE TRIGGER trg_multiplayer_reward_outbox_preserve_applied
BEFORE DELETE ON multiplayer_reward_outbox
FOR EACH ROW
WHEN OLD.status = 'APPLIED'
BEGIN
  SELECT RAISE(ABORT, 'Applied multiplayer reward history is immutable');
END;

CREATE TABLE multiplayer_instance_admin_actions (
  operation_id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  expected_generation INTEGER NOT NULL,
  previous_status TEXT NOT NULL,
  admin_account_id INTEGER REFERENCES admin_accounts(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (length(operation_id) BETWEEN 16 AND 128),
  CHECK (length(instance_id) BETWEEN 16 AND 128),
  CHECK (expected_generation > 0),
  CHECK (
    previous_status IN ('CREATED', 'LOBBY', 'STARTING', 'ACTIVE', 'CLOSING')
  ),
  CHECK (action = 'ADMIN_KILL'),
  CHECK (
    length(reason_code) BETWEEN 1 AND 64
    AND reason_code = trim(reason_code)
    AND reason_code NOT GLOB '*[^A-Z0-9_]*'
    AND substr(reason_code, 1, 1) GLOB '[A-Z]'
  ),
  CHECK (length(created_at) > 0)
);

CREATE INDEX idx_multiplayer_instance_admin_actions_instance
  ON multiplayer_instance_admin_actions(instance_id, created_at DESC);

CREATE TRIGGER trg_multiplayer_instance_admin_actions_append_only_update
BEFORE UPDATE OF
  operation_id,
  instance_id,
  expected_generation,
  previous_status,
  action,
  reason_code,
  created_at
ON multiplayer_instance_admin_actions
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Multiplayer instance admin audit is append-only');
END;

CREATE TRIGGER trg_multiplayer_instance_admin_actions_actor_only_anonymizes
BEFORE UPDATE OF admin_account_id ON multiplayer_instance_admin_actions
FOR EACH ROW
WHEN NEW.admin_account_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'Multiplayer instance admin audit actor can only be anonymized');
END;

CREATE TRIGGER trg_multiplayer_instance_admin_actions_append_only_delete
BEFORE DELETE ON multiplayer_instance_admin_actions
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Multiplayer instance admin audit is append-only');
END;

CREATE TABLE game_version_leases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_version_id INTEGER NOT NULL REFERENCES game_versions(id) ON DELETE CASCADE,
  instance_id TEXT NOT NULL REFERENCES multiplayer_instances(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ended_at TEXT,
  end_reason_code TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (game_version_id, instance_id),
  CHECK (generation > 0),
  CHECK (status IN ('ACTIVE', 'RELEASED', 'EXPIRED', 'KILLED')),
  CHECK (expires_at > acquired_at),
  CHECK (
    (
      status = 'ACTIVE'
      AND ended_at IS NULL
      AND end_reason_code IS NULL
    )
    OR (
      status <> 'ACTIVE'
      AND ended_at IS NOT NULL
      AND end_reason_code IS NOT NULL
    )
  ),
  CHECK (
    end_reason_code IS NULL
    OR end_reason_code IN (
      'INSTANCE_CLOSED',
      'LEASE_EXPIRED',
      'ADMIN_KILLED',
      'VERSION_DELETED'
    )
  ),
  CHECK (length(updated_at) > 0)
);

CREATE INDEX idx_game_version_leases_active
  ON game_version_leases(game_version_id, expires_at)
  WHERE status = 'ACTIVE';
CREATE INDEX idx_game_version_leases_instance
  ON game_version_leases(instance_id, status);

CREATE TRIGGER trg_game_version_leases_validate_insert
BEFORE INSERT ON game_version_leases
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'New game version lease must start ACTIVE')
  WHERE NEW.status <> 'ACTIVE';

  SELECT RAISE(ABORT, 'Game version lease must match a live instance generation')
  WHERE NOT EXISTS (
    SELECT 1
    FROM multiplayer_instances instance
    WHERE instance.id = NEW.instance_id
      AND instance.game_version_id = NEW.game_version_id
      AND instance.generation = NEW.generation
      AND instance.status NOT IN ('CLOSED', 'ABORTED', 'EXPIRED')
      AND NEW.expires_at >= instance.expires_at
  );
END;

CREATE TRIGGER trg_game_version_leases_immutable_identity
BEFORE UPDATE OF
  game_version_id,
  instance_id,
  generation,
  acquired_at,
  expires_at
ON game_version_leases
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Game version lease identity is immutable');
END;

CREATE TRIGGER trg_game_version_leases_status_transition
BEFORE UPDATE OF status ON game_version_leases
FOR EACH ROW
WHEN NOT (
  NEW.status = OLD.status
  OR (
    OLD.status = 'ACTIVE'
    AND NEW.status IN ('RELEASED', 'EXPIRED', 'KILLED')
  )
)
BEGIN
  SELECT RAISE(ABORT, 'Invalid game version lease status transition');
END;

CREATE TRIGGER trg_multiplayer_instances_start_requires_ready_players
BEFORE UPDATE OF status ON multiplayer_instances
FOR EACH ROW
WHEN NEW.status = 'STARTING' AND OLD.status IS NOT 'STARTING'
BEGIN
  SELECT RAISE(ABORT, 'Multiplayer match requires every active participant to be READY')
  WHERE OLD.participant_count < (
      SELECT profile.min_players
      FROM multiplayer_profiles profile
      WHERE profile.id = OLD.profile_id
    )
    OR OLD.participant_count <> (
      SELECT COUNT(*)
      FROM multiplayer_participants participant
      WHERE participant.instance_id = OLD.id
        AND participant.status = 'READY'
    );
END;

CREATE TRIGGER trg_multiplayer_instances_activate_exact_pending_match
BEFORE UPDATE OF status ON multiplayer_instances
FOR EACH ROW
WHEN NEW.status = 'ACTIVE' AND OLD.status IS NOT 'ACTIVE'
BEGIN
  SELECT RAISE(ABORT, 'Multiplayer instance requires its exact pending match before activation')
  WHERE NOT EXISTS (
    SELECT 1
    FROM multiplayer_matches match
    WHERE match.instance_id = OLD.id
      AND match.generation = OLD.generation
      AND match.status = 'PENDING'
  );
END;

CREATE TRIGGER trg_multiplayer_instances_after_activate_match
AFTER UPDATE OF status ON multiplayer_instances
FOR EACH ROW
WHEN NEW.status = 'ACTIVE' AND OLD.status IS NOT 'ACTIVE'
BEGIN
  UPDATE multiplayer_matches
  SET status = 'ACTIVE',
      started_at = NEW.updated_at,
      updated_at = NEW.updated_at
  WHERE instance_id = NEW.id
    AND generation = NEW.generation
    AND status = 'PENDING';
END;

CREATE TRIGGER trg_multiplayer_instances_close_requires_committed_match
BEFORE UPDATE OF status ON multiplayer_instances
FOR EACH ROW
WHEN NEW.status = 'CLOSING' AND OLD.status IS NOT 'CLOSING'
BEGIN
  SELECT RAISE(ABORT, 'Multiplayer instance can close only after canonical match commit')
  WHERE NOT EXISTS (
    SELECT 1
    FROM multiplayer_matches match
    WHERE match.instance_id = OLD.id
      AND match.generation = OLD.generation
      AND match.status = 'COMMITTED'
  );
END;

CREATE TRIGGER trg_multiplayer_instances_reset_ready_on_rematch
AFTER UPDATE OF status, generation ON multiplayer_instances
FOR EACH ROW
WHEN OLD.status = 'CLOSING'
  AND NEW.status = 'LOBBY'
  AND NEW.generation = OLD.generation + 1
BEGIN
  UPDATE multiplayer_participants
  SET status = 'JOINED',
      ready_at = NULL,
      updated_at = NEW.updated_at
  WHERE instance_id = NEW.id
    AND status = 'READY';
END;

-- Closing an instance is the authority boundary for all of its join credentials and exact-version
-- serving rights. Keeping these writes in one trigger makes every close/abort/expiry path atomic,
-- including administrative paths that do not run through one particular application repository.
CREATE TRIGGER trg_multiplayer_instances_terminal_cleanup
AFTER UPDATE OF status ON multiplayer_instances
FOR EACH ROW
WHEN NEW.status IN ('CLOSED', 'ABORTED', 'EXPIRED')
  AND OLD.status NOT IN ('CLOSED', 'ABORTED', 'EXPIRED')
BEGIN
  UPDATE multiplayer_matches
  SET status = 'ABORTED',
      abort_code = CASE
        WHEN NEW.status = 'ABORTED' THEN NEW.abort_code
        ELSE 'INFRA_FAILURE'
      END,
      aborted_at = NEW.closed_at,
      updated_at = NEW.updated_at
  WHERE instance_id = NEW.id
    AND status IN ('PENDING', 'ACTIVE', 'FINALIZING');

  UPDATE multiplayer_match_players
  SET result_status = 'ABORTED',
      outcome = 'ABORTED',
      reward_eligible = 0,
      aborted_at = NEW.closed_at
  WHERE match_id IN (
      SELECT id FROM multiplayer_matches WHERE instance_id = NEW.id AND status = 'ABORTED'
    )
    AND result_status = 'PENDING';

  UPDATE multiplayer_invites
  SET revoked_at = COALESCE(revoked_at, NEW.closed_at),
      updated_at = NEW.updated_at
  WHERE instance_id = NEW.id
    AND revoked_at IS NULL;

  UPDATE game_version_leases
  SET status = CASE
        WHEN NEW.status = 'EXPIRED' THEN 'EXPIRED'
        WHEN NEW.status = 'ABORTED'
          AND NEW.abort_code IN ('ADMIN_KILLED', 'VERSION_UNAVAILABLE') THEN 'KILLED'
        ELSE 'RELEASED'
      END,
      ended_at = NEW.closed_at,
      end_reason_code = CASE
        WHEN NEW.status = 'EXPIRED' THEN 'LEASE_EXPIRED'
        WHEN NEW.status = 'ABORTED' AND NEW.abort_code = 'ADMIN_KILLED' THEN 'ADMIN_KILLED'
        WHEN NEW.status = 'ABORTED' AND NEW.abort_code = 'VERSION_UNAVAILABLE' THEN 'VERSION_DELETED'
        ELSE 'INSTANCE_CLOSED'
      END,
      updated_at = NEW.updated_at
  WHERE instance_id = NEW.id
    AND status = 'ACTIVE';
END;

CREATE TRIGGER trg_game_versions_prevent_active_lease_delete
BEFORE DELETE ON game_versions
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM game_version_leases lease
  WHERE lease.game_version_id = OLD.id
    AND lease.status = 'ACTIVE'
)
BEGIN
  SELECT RAISE(ABORT, 'Cannot delete a game version with an active multiplayer lease');
END;

CREATE TRIGGER trg_game_versions_preserve_multiplayer_match_history
BEFORE DELETE ON game_versions
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM multiplayer_matches match
  WHERE match.game_version_id = OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'Cannot delete a game version with multiplayer match history');
END;
