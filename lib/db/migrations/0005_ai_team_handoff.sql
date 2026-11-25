CREATE TABLE IF NOT EXISTS studio_ai_handoffs (
  project_id uuid PRIMARY KEY REFERENCES studio_projects(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  current_provider text,
  current_provider_key_id uuid,
  stage text NOT NULL DEFAULT 'idle',
  last_completed_step text,
  next_step text,
  summary text NOT NULL DEFAULT '',
  completed_steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  artifacts jsonb NOT NULL DEFAULT '{}'::jsonb,
  handoff_count integer NOT NULL DEFAULT 0,
  revision integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS studio_ai_handoffs_user_updated_idx
  ON studio_ai_handoffs(user_id, updated_at DESC);
