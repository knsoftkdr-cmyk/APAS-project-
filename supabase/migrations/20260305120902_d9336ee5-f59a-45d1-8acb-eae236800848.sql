
-- Allow students to read teacher profiles (for dropdown)
CREATE POLICY "Students can read teacher profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (role = 'teacher');

-- Create student_assessments table
CREATE TABLE public.student_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_name text NOT NULL,
  student_age integer NOT NULL,
  age_group integer NOT NULL,
  teacher_id uuid REFERENCES public.profiles(id) NOT NULL,
  responses jsonb NOT NULL DEFAULT '{}',
  submitted_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.student_assessments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own assessments"
ON public.student_assessments
FOR INSERT
TO authenticated
WITH CHECK (submitted_by = auth.uid());

CREATE POLICY "Users can read own assessments"
ON public.student_assessments
FOR SELECT
TO authenticated
USING (submitted_by = auth.uid());

CREATE POLICY "Teachers can read all student assessments"
ON public.student_assessments
FOR SELECT
TO authenticated
USING (get_user_role(auth.uid()) = 'teacher');

CREATE POLICY "Admins full access student assessments"
ON public.student_assessments
FOR ALL
TO authenticated
USING (get_user_role(auth.uid()) = 'admin')
WITH CHECK (get_user_role(auth.uid()) = 'admin');
