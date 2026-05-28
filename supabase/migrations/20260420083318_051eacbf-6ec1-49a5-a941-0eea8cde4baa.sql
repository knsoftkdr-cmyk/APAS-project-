-- Add teacher evaluation fields to homework submissions
ALTER TABLE public.homework_submissions
  ADD COLUMN IF NOT EXISTS teacher_score integer,
  ADD COLUMN IF NOT EXISTS teacher_feedback text,
  ADD COLUMN IF NOT EXISTS evaluated_at timestamptz,
  ADD COLUMN IF NOT EXISTS evaluated_by uuid;

-- Enable RLS (table currently has none) and add policies
ALTER TABLE public.homework_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homework_assignments ENABLE ROW LEVEL SECURITY;

-- homework_assignments policies
DROP POLICY IF EXISTS "Teachers manage own assignments" ON public.homework_assignments;
CREATE POLICY "Teachers manage own assignments" ON public.homework_assignments
  FOR ALL TO authenticated
  USING (teacher_id = auth.uid() OR public.get_user_role(auth.uid()) = ANY (ARRAY['admin','school_admin']))
  WITH CHECK (teacher_id = auth.uid() OR public.get_user_role(auth.uid()) = ANY (ARRAY['admin','school_admin']));

DROP POLICY IF EXISTS "Students read assigned assignments" ON public.homework_assignments;
CREATE POLICY "Students read assigned assignments" ON public.homework_assignments
  FOR SELECT TO authenticated
  USING (public.get_user_role(auth.uid()) = 'student');

-- homework_submissions policies
DROP POLICY IF EXISTS "Students manage own submissions" ON public.homework_submissions;
CREATE POLICY "Students manage own submissions" ON public.homework_submissions
  FOR ALL TO authenticated
  USING (student_id = auth.uid())
  WITH CHECK (student_id = auth.uid());

DROP POLICY IF EXISTS "Teachers read all submissions" ON public.homework_submissions;
CREATE POLICY "Teachers read all submissions" ON public.homework_submissions
  FOR SELECT TO authenticated
  USING (public.get_user_role(auth.uid()) = ANY (ARRAY['teacher','admin','school_admin']));

DROP POLICY IF EXISTS "Teachers evaluate submissions" ON public.homework_submissions;
CREATE POLICY "Teachers evaluate submissions" ON public.homework_submissions
  FOR UPDATE TO authenticated
  USING (public.get_user_role(auth.uid()) = ANY (ARRAY['teacher','admin','school_admin']))
  WITH CHECK (public.get_user_role(auth.uid()) = ANY (ARRAY['teacher','admin','school_admin']));