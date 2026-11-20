CREATE TABLE account_profiles (
  user_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE saved_structures (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  size_x INTEGER NOT NULL,
  size_y INTEGER NOT NULL,
  size_z INTEGER NOT NULL,
  blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
  coordinate_mode TEXT NOT NULL DEFAULT 'relative',
  origin_x INTEGER NOT NULL DEFAULT 0,
  origin_y INTEGER NOT NULL DEFAULT 0,
  origin_z INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_saved_structures_user_updated
  ON saved_structures(user_id, updated_at DESC);