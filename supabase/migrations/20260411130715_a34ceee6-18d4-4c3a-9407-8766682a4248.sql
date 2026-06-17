
-- Enable pg_cron and pg_net for scheduled jobs
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Student predictions table
CREATE TABLE public.student_predictions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id uuid NOT NULL,
  subject text NOT NULL,
  predicted_score_next_test numeric,
  risk_level text NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high')),
  dropout_risk_percentage numeric DEFAULT 0,
  confidence_score numeric DEFAULT 0,
  contributing_factors jsonb DEFAULT '[]'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- School metrics table (daily snapshots)
CREATE TABLE public.school_metrics (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  snapshot_date date NOT NULL DEFAULT CURRENT_DATE,
  learning_gain_index numeric DEFAULT 0,
  teaching_effectiveness_score numeric DEFAULT 0,
  curriculum_coverage_pct numeric DEFAULT 0,
  ai_usage_count integer DEFAULT 0,
  total_students integer DEFAULT 0,
  total_teachers integer DEFAULT 0,
  subject_breakdown jsonb DEFAULT '{}'::jsonb,
  teacher_rankings jsonb DEFAULT '[]'::jsonb,
  risk_summary jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(snapshot_date)
);

-- Enable RLS
ALTER TABLE public.student_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_metrics ENABLE ROW LEVEL SECURITY;

-- student_predictions RLS
CREATE POLICY "Students can read own predictions"
  ON public.student_predictions FOR SELECT TO authenticated
  USING (student_id IN (SELECT s.id FROM students s WHERE s.profile_id = auth.uid()));

CREATE POLICY "Teachers and admins can read all predictions"
  ON public.student_predictions FOR SELECT TO authenticated
  USING (get_user_role(auth.uid()) IN ('teacher', 'admin', 'school_admin'));

CREATE POLICY "Service role manages predictions"
  ON public.student_predictions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- school_metrics RLS
CREATE POLICY "Teachers and admins can read school metrics"
  ON public.school_metrics FOR SELECT TO authenticated
  USING (get_user_role(auth.uid()) IN ('teacher', 'admin', 'school_admin'));

CREATE POLICY "Service role manages school metrics"
  ON public.school_metrics FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Index for fast lookups
CREATE INDEX idx_predictions_student ON public.student_predictions(student_id);
CREATE INDEX idx_predictions_risk ON public.student_predictions(risk_level);
CREATE INDEX idx_school_metrics_date ON public.school_metrics(snapshot_date DESC);
