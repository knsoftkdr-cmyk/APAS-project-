-- Create worksheet_assignments table to track assigned worksheets to classes
CREATE TABLE public.worksheet_assignments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  worksheet_id UUID NOT NULL REFERENCES public.worksheets(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  school_id UUID NOT NULL,
  class_level TEXT NOT NULL,
  section TEXT NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_date TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.worksheet_assignments ENABLE ROW LEVEL SECURITY;

-- Teachers can view their own worksheet assignments
CREATE POLICY "Teachers can view their own worksheet assignments"
  ON public.worksheet_assignments FOR SELECT
  USING (auth.uid() = teacher_id);

CREATE POLICY "Teachers can create worksheet assignments"
  ON public.worksheet_assignments FOR INSERT
  WITH CHECK (auth.uid() = teacher_id);

CREATE POLICY "Teachers can update their own worksheet assignments"
  ON public.worksheet_assignments FOR UPDATE
  USING (auth.uid() = teacher_id);

CREATE POLICY "Teachers can delete their own worksheet assignments"
  ON public.worksheet_assignments FOR DELETE
  USING (auth.uid() = teacher_id);

-- Students can view worksheet assignments for their class/section/school
CREATE POLICY "Students can view worksheet assignments for their class"
  ON public.worksheet_assignments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.school_id = worksheet_assignments.school_id
        AND CONCAT('Class ', p.class_grade) = worksheet_assignments.class_level
        AND (p.section = worksheet_assignments.section OR (p.section IS NULL AND worksheet_assignments.section IS NULL))
    )
  );

-- Create indexes for better query performance
CREATE INDEX idx_worksheet_assignments_teacher ON public.worksheet_assignments(teacher_id);
CREATE INDEX idx_worksheet_assignments_worksheet ON public.worksheet_assignments(worksheet_id);
CREATE INDEX idx_worksheet_assignments_class_section ON public.worksheet_assignments(class_level, section, school_id);
CREATE INDEX idx_worksheet_assignments_status ON public.worksheet_assignments(status);
