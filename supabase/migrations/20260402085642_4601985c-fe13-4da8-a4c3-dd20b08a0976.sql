
ALTER TABLE public.class_teachers
  ADD COLUMN IF NOT EXISTS teacher_role text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS subject text;

-- Ensure only one primary teacher per class
CREATE UNIQUE INDEX IF NOT EXISTS unique_primary_teacher_per_class
  ON public.class_teachers (class_id)
  WHERE teacher_role = 'primary';
