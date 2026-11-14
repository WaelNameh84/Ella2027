CREATE TABLE IF NOT EXISTS studio_saved_characters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  costume text NOT NULL DEFAULT '',
  voice_description text NOT NULL DEFAULT '',
  reference_image_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT studio_saved_characters_user_name_unique UNIQUE (user_id, name)
);
