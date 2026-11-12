CREATE TABLE custom_blocks (
  block_id TEXT PRIMARY KEY,
  block_name TEXT NOT NULL,
  model_json JSONB NOT NULL,
  texture_keys JSONB NOT NULL,
  render_mode TEXT NOT NULL DEFAULT 'cutout',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_custom_blocks_updated_at ON custom_blocks(updated_at DESC);