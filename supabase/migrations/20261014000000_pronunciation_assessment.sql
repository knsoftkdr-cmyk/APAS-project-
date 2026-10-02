-- Pronunciation Assessment: one row per practice attempt so students can see progress and tricky words.
-- Written and read only by the get-mastery-history edge function (service role) via the
-- 'pronunciation_assess' / 'pronunciation_history' actions. Scoring works without this table;
-- results just aren't saved.

CREATE TABLE IF NOT EXISTS public.pronunciation_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  language text NOT NULL,
  reference_text text NOT NULL,
  transcript text NOT NULL,
  overall_score numeric NOT NULL,
  accuracy numeric NOT NULL,
  completeness numeric NOT NULL,
  fluency numeric,
  clarity numeric,
  words_per_minute numeric,
  words jsonb NOT NULL DEFAULT '[]'::jsonb,
  extra_words jsonb NOT NULL DEFAULT '[]'::jsonb,
  coaching jsonb,
  model_version text NOT NULL DEFAULT '1.0',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pronunciation_attempts_student_created
  ON public.pronunciation_attempts (student_id, created_at DESC);

-- RLS on with no policies: only the service role (edge function) can read or write.
ALTER TABLE public.pronunciation_attempts ENABLE ROW LEVEL SECURITY;
