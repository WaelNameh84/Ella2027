ALTER TABLE studio_projects
  ADD COLUMN IF NOT EXISTS brand_kit jsonb NOT NULL DEFAULT '{"primaryColor":"#F4F0E8","accentColor":"#C96B4B","fontFamily":"sans","watermarkText":"","watermarkPosition":"bottom-right"}'::jsonb;
