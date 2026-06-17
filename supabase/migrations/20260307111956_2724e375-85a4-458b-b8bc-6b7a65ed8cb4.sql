
-- Create teacher_assessments table
CREATE TABLE public.teacher_assessments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  teacher_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  student_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  student_name TEXT NOT NULL,
  age_group INTEGER NOT NULL,
  responses JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.teacher_assessments ENABLE ROW LEVEL SECURITY;

-- Teachers can insert their own assessments
CREATE POLICY "Teachers can insert own teacher assessments"
ON public.teacher_assessments FOR INSERT
WITH CHECK (teacher_id = auth.uid() AND get_user_role(auth.uid()) = 'teacher');

-- Teachers can read their own assessments
CREATE POLICY "Teachers can read own teacher assessments"
ON public.teacher_assessments FOR SELECT
USING (teacher_id = auth.uid());

-- Admins full access
CREATE POLICY "Admins full access teacher assessments"
ON public.teacher_assessments FOR ALL
USING (get_user_role(auth.uid()) = 'admin')
WITH CHECK (get_user_role(auth.uid()) = 'admin');

-- Students can read assessments about them
CREATE POLICY "Students can read own teacher assessments"
ON public.teacher_assessments FOR SELECT
USING (student_profile_id = auth.uid());

-- Allow teachers to read student profiles (for the dropdown)
CREATE POLICY "Teachers can read student profiles"
ON public.profiles FOR SELECT
USING (get_user_role(auth.uid()) = 'teacher');
