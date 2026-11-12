-- Additive schema updates introduced after the original studio tables.
-- Safe to run repeatedly and preserves all existing rows.
ALTER TABLE studio_scenes
  ADD COLUMN IF NOT EXISTS subtitle_text text,
  ADD COLUMN IF NOT EXISTS subtitle_start_seconds double precision NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS subtitle_end_seconds double precision;

ALTER TABLE studio_provider_settings
  ADD COLUMN IF NOT EXISTS free_mode boolean NOT NULL DEFAULT true;
