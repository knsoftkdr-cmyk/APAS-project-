-- Optional: Student predictions table for storing historical prediction data
CREATE TABLE public.student_predictions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id uuid NOT NULL,
  predicted_score_pct integer NOT NULL,
  risk_level text NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
  confidence_level integer NOT NULL DEFAULT 50,
  subject_predictions jsonb,
  weekly_forecast jsonb,
  recommendations text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE
);

-- Index for fast lookups
CREATE INDEX idx_student_predictions_student_id
  ON public.student_predictions(student_id);

CREATE INDEX idx_student_predictions_created_at
  ON public.student_predictions(created_at DESC);
