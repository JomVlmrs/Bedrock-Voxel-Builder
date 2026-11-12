CREATE TABLE IF NOT EXISTS site_visit_stats (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  total_visits BIGINT NOT NULL DEFAULT 0 CHECK (total_visits >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO site_visit_stats (id, total_visits)
VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS site_active_visitors (
  session_id UUID PRIMARY KEY,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_site_active_visitors_last_seen
  ON site_active_visitors (last_seen_at DESC);