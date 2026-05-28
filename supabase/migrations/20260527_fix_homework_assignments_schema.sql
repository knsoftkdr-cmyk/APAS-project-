-- Comprehensive fix for homework_assignments table schema
-- This migration aligns the table structure with the application code expectations
-- Note: assigned_by is the primary field for RLS checks, teacher_id is an alias for queries

-- Step 1: Add missing columns to homework_assignments
ALTER TABLE public.homework_assignments
ADD COLUMN IF NOT EXISTS period_number INTEGER,
ADD COLUMN IF NOT EXISTS period_title TEXT,
ADD COLUMN IF NOT EXISTS topic TEXT,
ADD COLUMN IF NOT EXISTS exit_ticket_content TEXT,
ADD COLUMN IF NOT EXISTS assignment_type TEXT DEFAULT 'at-home',
ADD COLUMN IF NOT EXISTS assigned_student_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS class_performance_score NUMERIC,
ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ DEFAULT now(),
ADD COLUMN IF NOT EXISTS teacher_id UUID GENERATED ALWAYS AS (assigned_by) STORED;

-- Step 2: Ensure title column exists (required by original schema)
ALTER TABLE public.homework_assignments
ADD COLUMN IF NOT EXISTS title TEXT DEFAULT 'Homework Assignment';

-- Step 3: Update title for existing rows if they don't have one
UPDATE public.homework_assignments 
SET title = COALESCE(title, subject || ' - Assignment')
WHERE title IS NULL;

-- Step 4: Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_homework_assignments_teacher_id ON public.homework_assignments(assigned_by);
CREATE INDEX IF NOT EXISTS idx_homework_assignments_class_section ON public.homework_assignments(class_level, section);
CREATE INDEX IF NOT EXISTS idx_homework_assignments_type ON public.homework_assignments(assignment_type);
CREATE INDEX IF NOT EXISTS idx_homework_assignments_created_at ON public.homework_assignments(created_at DESC);

-- Step 5: Add comment documenting the fields
COMMENT ON COLUMN public.homework_assignments.assigned_by IS 'Teacher ID (used for RLS checks)';
COMMENT ON COLUMN public.homework_assignments.teacher_id IS 'Alias for assigned_by (generated column for easier queries)';
COMMENT ON COLUMN public.homework_assignments.assignment_type IS 'Type: in-class or at-home';
COMMENT ON COLUMN public.homework_assignments.exit_ticket_content IS 'Exit ticket questions/content in text format';
