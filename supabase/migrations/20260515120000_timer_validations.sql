-- Timer validations table for tracking and preventing cheating
CREATE TABLE public.timer_validations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  test_id uuid NOT NULL,
  student_id uuid NOT NULL,
  client_elapsed_ms integer NOT NULL,
  server_elapsed_ms integer NOT NULL,
  time_delta_ms integer NOT NULL,
  is_valid boolean NOT NULL DEFAULT true,
  severity text NOT NULL DEFAULT 'none' CHECK (severity IN ('none', 'warning', 'violation')),
  action_taken text NOT NULL DEFAULT 'accept' CHECK (action_taken IN ('accept', 'flag', 'reject')),
  details text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (test_id) REFERENCES public.academic_tests(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE
);

-- Enable RLS
ALTER TABLE public.timer_validations ENABLE ROW LEVEL SECURITY;

-- Admins can read all validations
CREATE POLICY "Admins read all timer validations"
  ON public.timer_validations FOR SELECT
  USING (public.get_user_role(auth.uid()) = 'admin');

-- Service role can insert
CREATE POLICY "Service role can insert timer validations"
  ON public.timer_validations FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Create index for faster queries
CREATE INDEX idx_timer_validations_student_id
  ON public.timer_validations(student_id);

CREATE INDEX idx_timer_validations_test_id
  ON public.timer_validations(test_id);

CREATE INDEX idx_timer_validations_created_at
  ON public.timer_validations(created_at DESC);
