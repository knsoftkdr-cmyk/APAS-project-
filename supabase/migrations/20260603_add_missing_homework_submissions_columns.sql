-- Add missing columns to homework_submissions table to match application schema
-- This migration aligns the table with the application code expectations

ALTER TABLE public.homework_submissions
ADD COLUMN IF NOT EXISTS completed BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now(),
ADD COLUMN IF NOT EXISTS evaluated_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS evaluated_by UUID,
ADD COLUMN IF NOT EXISTS student_name TEXT,
ADD COLUMN IF NOT EXISTS submission_percentage NUMERIC,
ADD COLUMN IF NOT EXISTS teacher_feedback TEXT,
ADD COLUMN IF NOT EXISTS teacher_score NUMERIC,
ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_homework_submissions_student_id ON public.homework_submissions(student_id);
CREATE INDEX IF NOT EXISTS idx_homework_submissions_assignment_id ON public.homework_submissions(assignment_id);
CREATE INDEX IF NOT EXISTS idx_homework_submissions_completed ON public.homework_submissions(completed);
CREATE INDEX IF NOT EXISTS idx_homework_submissions_created_at ON public.homework_submissions(created_at DESC);

-- Add comment documenting the fields
COMMENT ON COLUMN public.homework_submissions.completed IS 'Whether the submission has been completed/finalized';
COMMENT ON COLUMN public.homework_submissions.submission_percentage IS 'Percentage of questions answered by student';
COMMENT ON COLUMN public.homework_submissions.teacher_score IS 'Score given by teacher after evaluation';
COMMENT ON COLUMN public.homework_submissions.teacher_feedback IS 'Feedback from teacher on the submission';
