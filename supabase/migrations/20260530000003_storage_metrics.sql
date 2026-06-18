-- Storage metrics table for Multi-Tenant Dashboard
CREATE TABLE IF NOT EXISTS storage_metrics (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   UUID REFERENCES schools(id) ON DELETE CASCADE,
  metric_date DATE NOT NULL DEFAULT CURRENT_DATE,
  storage_used_mb NUMERIC DEFAULT 0,
  files_count INTEGER DEFAULT 0,
  ai_calls_count INTEGER DEFAULT 0,
  active_users INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(school_id, metric_date)
);

-- Seed sample data for existing schools
INSERT INTO storage_metrics (school_id, storage_used_mb, files_count, ai_calls_count, active_users)
SELECT id, 
  (random() * 500 + 50)::numeric(10,2),
  (random() * 100 + 10)::int,
  (random() * 200 + 20)::int,
  (random() * 50 + 5)::int
FROM schools
ON CONFLICT (school_id, metric_date) DO NOTHING;
