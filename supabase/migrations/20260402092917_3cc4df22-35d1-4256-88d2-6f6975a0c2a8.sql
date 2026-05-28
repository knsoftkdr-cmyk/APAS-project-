
-- Diagnostic question approval requests
CREATE TABLE public.diagnostic_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  class_name text NOT NULL,
  section text NOT NULL DEFAULT 'A',
  subject text NOT NULL,
  purpose text NOT NULL,
  suggested_count integer NOT NULL,
  approved_count integer,
  status text NOT NULL DEFAULT 'pending',
  admin_notes text,
  approved_by uuid REFERENCES public.profiles(id),
  approved_at timestamptz,
  assigned_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.diagnostic_requests ENABLE ROW LEVEL SECURITY;

-- Admin full access
CREATE POLICY "Admins full access diagnostic_requests"
  ON public.diagnostic_requests FOR ALL TO authenticated
  USING (get_user_role(auth.uid()) = 'admin')
  WITH CHECK (get_user_role(auth.uid()) = 'admin');

-- Teachers can insert their own requests
CREATE POLICY "Teachers can insert own diagnostic requests"
  ON public.diagnostic_requests FOR INSERT TO authenticated
  WITH CHECK (teacher_id = auth.uid() AND get_user_role(auth.uid()) = 'teacher');

-- Teachers can read their own requests
CREATE POLICY "Teachers can read own diagnostic requests"
  ON public.diagnostic_requests FOR SELECT TO authenticated
  USING (teacher_id = auth.uid());

-- Teachers can update their own requests (for marking assigned)
CREATE POLICY "Teachers can update own diagnostic requests"
  ON public.diagnostic_requests FOR UPDATE TO authenticated
  USING (teacher_id = auth.uid())
  WITH CHECK (teacher_id = auth.uid());
