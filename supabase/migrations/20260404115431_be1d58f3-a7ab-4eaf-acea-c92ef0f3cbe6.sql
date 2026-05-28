
-- Add questions column to diagnostic_requests
ALTER TABLE public.diagnostic_requests ADD COLUMN IF NOT EXISTS questions jsonb DEFAULT NULL;

-- Create diagnostic_submissions table
CREATE TABLE public.diagnostic_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.diagnostic_requests(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  score integer NOT NULL DEFAULT 0,
  total_questions integer NOT NULL DEFAULT 0,
  completed_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(request_id, student_id)
);

-- Enable RLS
ALTER TABLE public.diagnostic_submissions ENABLE ROW LEVEL SECURITY;

-- Students can insert their own submissions
CREATE POLICY "Students can insert own diagnostic submissions"
ON public.diagnostic_submissions FOR INSERT TO authenticated
WITH CHECK (student_id = auth.uid());

-- Students can read their own submissions
CREATE POLICY "Students can read own diagnostic submissions"
ON public.diagnostic_submissions FOR SELECT TO authenticated
USING (student_id = auth.uid());

-- Teachers and admins can read all submissions
CREATE POLICY "Teachers and admins can read all diagnostic submissions"
ON public.diagnostic_submissions FOR SELECT TO authenticated
USING (get_user_role(auth.uid()) = ANY(ARRAY['teacher'::text, 'admin'::text]));

-- Admins full access
CREATE POLICY "Admins full access diagnostic submissions"
ON public.diagnostic_submissions FOR ALL TO authenticated
USING (get_user_role(auth.uid()) = 'admin'::text)
WITH CHECK (get_user_role(auth.uid()) = 'admin'::text);
