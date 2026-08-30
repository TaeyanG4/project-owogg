-- Migration: 0046_internal_game_tools.sql
-- Purpose: Keep operator-owned protocol probes and other internal QA surfaces out of the public
-- game catalog without binding application code to a fixture slug. Upload manifests cannot set
-- this field; an elevated administrator must explicitly classify an existing identity.

ALTER TABLE game_settings
  ADD COLUMN catalog_role TEXT NOT NULL DEFAULT 'GAME'
  CHECK (catalog_role IN ('GAME', 'INTERNAL_TOOL'));

CREATE INDEX IF NOT EXISTS idx_game_settings_catalog_role
  ON game_settings(catalog_role, game_id);
