-- Student Digital Learning Twin: one snapshot per student per day so progression has history.
-- Written only by the get-mastery-history edge function (service role) when action = 'student_twin'.
-- The feature works without this table; it just shows no history.

CREATE TABLE IF NOT EXISTS public.student_learning_twin_snapshots (
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  snapshot_date date NOT NULL,
  overall_ability numeric,
  risk_level text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_twin_snapshots_student_date
  ON public.student_learning_twin_snapshots (student_id, snapshot_date DESC);

-- RLS on with no policies: only the service role (edge function) can read or write.
ALTER TABLE public.student_learning_twin_snapshots ENABLE ROW LEVEL SECURITY;
