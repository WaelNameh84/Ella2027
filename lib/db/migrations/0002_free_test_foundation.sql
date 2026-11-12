-- Free/test foundation: additive only; no provider calls or paid storage.
CREATE TABLE IF NOT EXISTS studio_dialogue_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES studio_projects(id) ON DELETE CASCADE,
  scene_id uuid NOT NULL REFERENCES studio_scenes(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  character_id text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  text text NOT NULL DEFAULT '',
  start_seconds double precision NOT NULL DEFAULT 0,
  end_seconds double precision,
  voice_id text,
  voice_url text,
  voice_volume integer NOT NULL DEFAULT 100,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS studio_dialogue_scene_order_idx ON studio_dialogue_lines(scene_id, sort_order);
CREATE INDEX IF NOT EXISTS studio_dialogue_project_user_idx ON studio_dialogue_lines(project_id, user_id);

CREATE TABLE IF NOT EXISTS studio_storyboard_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES studio_projects(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  name text NOT NULL DEFAULT 'Untitled storyboard',
  source text NOT NULL DEFAULT 'free-template',
  status text NOT NULL DEFAULT 'draft',
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  version_number integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS studio_storyboard_project_version_idx ON studio_storyboard_versions(project_id, version_number);

CREATE TABLE IF NOT EXISTS studio_wizard_progress (
  project_id uuid PRIMARY KEY REFERENCES studio_projects(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  current_step integer NOT NULL DEFAULT 1,
  completed_steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  draft jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS studio_storage_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  project_id uuid REFERENCES studio_projects(id) ON DELETE CASCADE,
  scene_id uuid REFERENCES studio_scenes(id) ON DELETE CASCADE,
  kind text NOT NULL,
  storage_key text NOT NULL,
  public_url text,
  content_type text NOT NULL,
  size_bytes integer NOT NULL DEFAULT 0,
  backend text NOT NULL DEFAULT 'local-test',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (backend, storage_key)
);
CREATE INDEX IF NOT EXISTS studio_storage_project_idx ON studio_storage_assets(project_id, created_at);

CREATE TABLE IF NOT EXISTS studio_provider_pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  model text NOT NULL,
  service_type text NOT NULL,
  unit text NOT NULL,
  unit_price_usd double precision NOT NULL DEFAULT 0,
  is_estimate boolean NOT NULL DEFAULT true,
  source_url text,
  checked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, model, service_type, unit)
);
