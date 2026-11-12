-- Additive migration for the One Idea to Full Movie audio mix.
ALTER TABLE studio_projects
  ADD COLUMN IF NOT EXISTS sound_effects_url text,
  ADD COLUMN IF NOT EXISTS sound_effects_volume integer NOT NULL DEFAULT 35;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'studio_projects_sound_effects_volume_range'
  ) THEN
    ALTER TABLE studio_projects
      ADD CONSTRAINT studio_projects_sound_effects_volume_range
      CHECK (sound_effects_volume BETWEEN 0 AND 100);
  END IF;
END $$;
