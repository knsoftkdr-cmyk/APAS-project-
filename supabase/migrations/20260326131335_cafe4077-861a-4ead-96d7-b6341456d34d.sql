
CREATE TABLE public.academic_tests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID NOT NULL,
  student_class TEXT NOT NULL,
  section TEXT,
  subject TEXT NOT NULL,
  questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  score INTEGER NOT NULL DEFAULT 0,
  total_questions INTEGER NOT NULL DEFAULT 10,
  completed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT fk_student FOREIGN KEY (student_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

ALTER TABLE public.academic_tests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students can read own academic tests"
  ON public.academic_tests
  FOR SELECT
  TO authenticated
  USING (student_id = auth.uid());

CREATE POLICY "Students can insert own academic tests"
  ON public.academic_tests
  FOR INSERT
  TO authenticated
  WITH CHECK (student_id = auth.uid());

CREATE POLICY "Teachers can read all academic tests"
  ON public.academic_tests
  FOR SELECT
  TO authenticated
  USING (get_user_role(auth.uid()) IN ('teacher', 'admin'));
