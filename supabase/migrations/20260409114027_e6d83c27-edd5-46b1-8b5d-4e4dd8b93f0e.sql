
-- Homework assignments (teacher assigns exit ticket questions to class/section)
CREATE TABLE public.homework_assignments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lesson_id UUID REFERENCES public.lessons(id) ON DELETE CASCADE NOT NULL,
  class_level TEXT NOT NULL,
  section TEXT NOT NULL,
  subject TEXT,
  title TEXT NOT NULL,
  questions JSONB NOT NULL DEFAULT '[]',
  assigned_by UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.homework_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers can view their own assignments"
  ON public.homework_assignments FOR SELECT
  USING (auth.uid() = assigned_by);

CREATE POLICY "Teachers can create assignments"
  ON public.homework_assignments FOR INSERT
  WITH CHECK (auth.uid() = assigned_by);

CREATE POLICY "Teachers can update their own assignments"
  ON public.homework_assignments FOR UPDATE
  USING (auth.uid() = assigned_by);

-- Students can view assignments for their class/section
CREATE POLICY "Students can view assignments for their class"
  ON public.homework_assignments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.students s
      JOIN public.class_students cs ON cs.student_id = s.id
      JOIN public.classes c ON c.id = cs.class_id
      WHERE s.profile_id = auth.uid()
        AND c.name = homework_assignments.class_level
        AND c.section = homework_assignments.section
    )
  );

-- Homework submissions (student answers)
CREATE TABLE public.homework_submissions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  assignment_id UUID REFERENCES public.homework_assignments(id) ON DELETE CASCADE NOT NULL,
  student_id UUID NOT NULL,
  answers JSONB NOT NULL DEFAULT '[]',
  score NUMERIC,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(assignment_id, student_id)
);

ALTER TABLE public.homework_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students can view their own submissions"
  ON public.homework_submissions FOR SELECT
  USING (auth.uid() = student_id);

CREATE POLICY "Students can create their own submissions"
  ON public.homework_submissions FOR INSERT
  WITH CHECK (auth.uid() = student_id);

CREATE POLICY "Students can update their own submissions"
  ON public.homework_submissions FOR UPDATE
  USING (auth.uid() = student_id);

CREATE POLICY "Teachers can view submissions for their assignments"
  ON public.homework_submissions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.homework_assignments ha
      WHERE ha.id = homework_submissions.assignment_id
        AND ha.assigned_by = auth.uid()
    )
  );
